"""Reaching past the model — asking live Fabric what is actually there.

Everything else the assistant can see is the authored model: what somebody drew,
or what a sandbox run once derived. This module lets it ask the other question —
what does the lakehouse hold *now* — and therefore the one that makes the model
worth auditing: **is this model still true?**

It goes through `app/fabric/client.py`, the same credentials and the same tested
REST calls the explorer uses. Not through MCP: the Messages API's MCP connector
speaks only to remote HTTP servers, Fabric would need an Entra token to
authenticate one, and we already hold working credentials here. If a hosted
Fabric MCP endpoint later becomes the better path, it can be swapped in behind
these tool names without the assistant noticing.

Three things this module is careful about, and all three are traps this repo has
already paid for:

**Empty means "no permission" in these APIs.** `fetch_table_schema` returns `[]`
both when a table genuinely has no readable schema and when OneLake refused the
read, and a comparison built on the first reading of that would report every
column in the model as "no longer in Fabric" — a catastrophic false positive on
a model that is perfectly fine. Every call here passes a `SchemaResolution`
report, and an empty schema WITH failures is returned as unreadable, never as
empty.

**Fabric being unconfigured is a tool error, not a turn error.** A question that
touches Fabric on a backend with no Fabric credentials should get "I can't reach
Fabric" in the answer, not a 503 that loses the conversation.

**The catalog walk is expensive.** It is workspaces → items → tables, dozens of
REST calls, and an assistant will want it more than once in a turn. It is cached
briefly in-process; the cache is per-process and short-lived on purpose, because
a stale catalog would undermine the exact freshness question this module exists
to answer.
"""

from __future__ import annotations

import time
from typing import Any

from ..fabric.client import FabricClient, FabricError
from ..fabric.schema import fetch_table_schema, table_dirs_for_lakehouse
from ..sandbox.protocol import SchemaResolution
from .graph import build_index, ref_of

#: Long enough that a multi-call turn walks the catalog once, short enough that
#: "is my model current?" is never answered from a stale index.
CATALOG_TTL_SECONDS = 120

#: Payload bound — a tenant can hold thousands of tables.
MAX_RESULTS = 40

_catalog_cache: tuple[float, list[dict[str, Any]]] | None = None


class FabricUnavailable(RuntimeError):
    """Fabric cannot be reached. Reported into the answer, not raised at HTTP."""


TOOLS: list[dict[str, Any]] = [
    {
        "name": "fabric_search",
        "description": (
            "Search LIVE Microsoft Fabric for a workspace, lakehouse, table or "
            "notebook by name. This is the real tenant, not the authored model — "
            "use it when the question is about what exists in Fabric now. Start "
            "here to get the workspace_id and lakehouse_id the other Fabric "
            "tools need."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Name or partial name."},
                "kind": {
                    "type": "string",
                    "enum": ["workspace", "lakehouse", "table", "notebook"],
                    "description": "Restrict to one kind of asset.",
                },
            },
            "required": ["name"],
        },
    },
    {
        "name": "fabric_table_schema",
        "description": (
            "The columns a table ACTUALLY has in Fabric right now, read from its "
            "Delta log. Ids come from fabric_search. If the schema cannot be "
            "read the result says so explicitly — that is different from the "
            "table having no columns, and must never be reported as the latter."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "workspace_id": {"type": "string"},
                "lakehouse_id": {"type": "string"},
                "table": {"type": "string", "description": "Table name."},
            },
            "required": ["workspace_id", "lakehouse_id", "table"],
        },
    },
    {
        "name": "compare_to_fabric",
        "description": (
            "Compare an object in the AUTHORED MODEL against the live Fabric "
            "table of the same name, column by column. Answers 'is this model "
            "still true?' and 'has this table drifted?'. Returns columns only "
            "in the model (dropped or renamed in Fabric, or never real), only "
            "in Fabric (new, and missing from the model), and those that match."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "A model OBJECT id from find_entity — a table.",
                },
                "workspace_id": {
                    "type": "string",
                    "description": (
                        "Omit to locate the table by name via fabric_search. "
                        "Supply both ids when the name is ambiguous."
                    ),
                },
                "lakehouse_id": {"type": "string"},
            },
            "required": ["entity_id"],
        },
    },
]

TOOL_NAMES = {t["name"] for t in TOOLS}


def _client() -> FabricClient:
    try:
        return FabricClient()
    except FabricError as exc:
        raise FabricUnavailable(str(exc)) from exc


def catalog(force: bool = False) -> list[dict[str, Any]]:
    """A flat index of the tenant: workspaces, lakehouses, tables, notebooks.

    Per-workspace and per-lakehouse refusals are swallowed so one locked corner
    does not blank the index — but a refused WORKSPACE LIST is raised, because
    an empty tenant and an unauthorised one look identical from here and only
    one of them is a fact.
    """
    global _catalog_cache
    now = time.monotonic()
    if not force and _catalog_cache and now - _catalog_cache[0] < CATALOG_TTL_SECONDS:
        return _catalog_cache[1]

    client = _client()
    try:
        workspaces = client.list_workspaces()
    except FabricError as exc:
        raise FabricUnavailable(f"Could not list Fabric workspaces: {exc}") from exc

    out: list[dict[str, Any]] = []
    for workspace in workspaces:
        wid = workspace.get("id")
        if not wid:
            continue
        wname = workspace.get("displayName") or workspace.get("name") or wid
        out.append({"kind": "workspace", "id": wid, "name": wname, "workspace_id": wid, "workspace_name": wname})
        try:
            items = client.list_items(wid)
        except FabricError:
            continue
        lakehouses: list[tuple[str, str]] = []
        for item in items:
            iid = item.get("id")
            if not iid:
                continue
            itype = (item.get("type") or "").lower()
            iname = item.get("displayName") or item.get("name") or iid
            if itype == "notebook":
                out.append({"kind": "notebook", "id": iid, "name": iname, "workspace_id": wid, "workspace_name": wname})
            elif itype == "lakehouse":
                out.append({"kind": "lakehouse", "id": iid, "name": iname, "workspace_id": wid, "workspace_name": wname})
                lakehouses.append((iid, iname))
        for lid, lname in lakehouses:
            try:
                tables = client.list_lakehouse_tables(wid, lid)
            except FabricError:
                continue
            for table in tables:
                tname = table.get("name")
                if tname:
                    out.append(
                        {
                            "kind": "table",
                            "id": tname,
                            "name": tname,
                            "workspace_id": wid,
                            "workspace_name": wname,
                            "lakehouse_id": lid,
                            "lakehouse_name": lname,
                        }
                    )

    _catalog_cache = (now, out)
    return out


def reset_catalog_cache() -> None:
    """Drop the cached index. Used by tests, and by an explicit refresh."""
    global _catalog_cache
    _catalog_cache = None


def search(name: str, kind: str | None = None, limit: int = MAX_RESULTS) -> dict[str, Any]:
    needle = (name or "").strip().lower()
    if not needle:
        return {"matches": [], "count": 0}

    exact: list[dict[str, Any]] = []
    partial: list[dict[str, Any]] = []
    for entry in catalog():
        if kind and entry["kind"] != kind:
            continue
        lowered = str(entry["name"]).strip().lower()
        if lowered == needle:
            exact.append(entry)
        elif needle in lowered:
            partial.append(entry)

    hits = exact + partial
    return {
        "matches": hits[:limit],
        "count": len(hits),
        "truncated": len(hits) > limit,
        "note": (
            f"Nothing in Fabric matches {name!r}." if not hits else None
        ),
    }


def table_schema(workspace_id: str, lakehouse_id: str, table: str) -> dict[str, Any]:
    """Live Delta columns, with unreadable told apart from empty."""
    client = _client()
    try:
        dirs = table_dirs_for_lakehouse(client, workspace_id, lakehouse_id)
    except FabricError as exc:
        raise FabricUnavailable(f"Could not list tables in that lakehouse: {exc}") from exc

    table_dir = dirs.get(table) or dirs.get(table.lower())
    if not table_dir:
        return {
            "table": table,
            "readable": False,
            "columns": [],
            "note": (
                f"No Delta table directory named {table!r} in that lakehouse. It may "
                f"be a shortcut, a file-backed folder, or not exist."
            ),
        }

    report = SchemaResolution()
    columns = fetch_table_schema(client, workspace_id, table_dir, report=report)
    if not columns:
        # THE trap. `[]` here means "no permission" at least as often as it
        # means "no columns", and a caller that reads it as the latter reports
        # a healthy table as an empty one.
        return {
            "table": table,
            "readable": False,
            "columns": [],
            "note": (
                "The schema could not be read — this is NOT the same as the table "
                "having no columns. Usually a permissions problem on OneLake."
                + (f" Details: {'; '.join(report.failures[:3])}" if report.failures else "")
            ),
        }

    return {
        "table": table,
        "readable": True,
        "columns": [{"name": c.name, "type": c.type} for c in columns],
    }


def compare(
    model,
    entity_id: str,
    workspace_id: str | None = None,
    lakehouse_id: str | None = None,
) -> dict[str, Any]:
    """Diff a model object's columns against the live Fabric table."""
    index = build_index(model)
    entry = index.entries.get(entity_id)
    if entry is None:
        return {"error": f"No entity with id {entity_id!r} in this model."}
    if entry.kind != "object":
        return {
            "error": (
                f"{entry.name!r} is a {entry.kind}, and only an object (a table) "
                f"can be compared against Fabric."
            )
        }

    if not (workspace_id and lakehouse_id):
        hits = [m for m in search(entry.name, kind="table")["matches"]]
        if not hits:
            return {
                "model_table": entry.name,
                "found_in_fabric": False,
                "note": (
                    f"No table named {entry.name!r} exists in Fabric. Either it was "
                    f"dropped, it is named differently there, or this model names "
                    f"something that was never created."
                ),
            }
        if len(hits) > 1 and not workspace_id:
            return {
                "model_table": entry.name,
                "found_in_fabric": True,
                "ambiguous": True,
                "candidates": hits[:10],
                "note": (
                    f"{len(hits)} tables in Fabric are named {entry.name!r}. Pick one "
                    f"and call again with its workspace_id and lakehouse_id — "
                    f"comparing against the wrong one would report drift that is not there."
                ),
            }
        workspace_id = workspace_id or hits[0]["workspace_id"]
        lakehouse_id = lakehouse_id or hits[0]["lakehouse_id"]

    live = table_schema(workspace_id, lakehouse_id, entry.name)
    if not live["readable"]:
        # Refusing to diff is the point. An unreadable schema diffed as empty
        # reports every column in the model as dropped.
        return {
            "model_table": entry.name,
            "found_in_fabric": True,
            "comparable": False,
            "note": live["note"],
        }

    model_columns = {
        index.entries[a].name: a
        for a in _leaf_attribute_ids(index, entity_id)
    }
    fabric_columns = {c["name"]: c["type"] for c in live["columns"]}

    lowered_fabric = {n.lower(): n for n in fabric_columns}
    lowered_model = {n.lower(): n for n in model_columns}

    only_model = sorted(n for n in model_columns if n.lower() not in lowered_fabric)
    only_fabric = sorted(n for n in fabric_columns if n.lower() not in lowered_model)
    matching = sorted(n for n in model_columns if n.lower() in lowered_fabric)

    return {
        # The full path, so an answer names which table drifted when two layers
        # both hold one called `orders`.
        "model_table": ref_of(index, entity_id).path,
        "fabric_table": {
            "workspace_id": workspace_id,
            "lakehouse_id": lakehouse_id,
            "table": entry.name,
        },
        "found_in_fabric": True,
        "comparable": True,
        # Case-insensitive matching: Delta preserves case and authors rarely do,
        # so a case-only difference is a naming inconsistency, not drift, and
        # reporting it as a dropped column would bury the real findings.
        "only_in_model": only_model,
        "only_in_fabric": only_fabric,
        "matching": matching,
        "in_sync": not only_model and not only_fabric,
    }


def run_tool(model, name: str, args: dict[str, Any]) -> Any:
    """Dispatch a Fabric tool, turning unreachability into a reported result."""
    try:
        if name == "fabric_search":
            return search(str(args.get("name") or ""), args.get("kind"))
        if name == "fabric_table_schema":
            return table_schema(
                str(args["workspace_id"]), str(args["lakehouse_id"]), str(args["table"])
            )
        if name == "compare_to_fabric":
            return compare(
                model,
                str(args["entity_id"]),
                args.get("workspace_id"),
                args.get("lakehouse_id"),
            )
    except KeyError as exc:
        raise TypeError(f"{exc.args[0]!r} is required") from exc
    except FabricUnavailable as exc:
        # Reported, not raised: a Fabric question on a backend with no Fabric
        # credentials should be answered with "I can't reach Fabric", not lose
        # the conversation to a 503.
        return {"error": str(exc), "fabric_available": False}
    raise KeyError(name)


def _leaf_attribute_ids(index, object_id: str) -> list[str]:
    """Leaf columns under an object — groups are folders, not columns.

    Same rule as `analysis.py`. A group counted as a column would show up as
    drift against every Fabric table, since no Delta schema has one.
    """
    out: list[str] = []
    stack = list(index.entries[object_id].child_ids)
    while stack:
        attr_id = stack.pop()
        entry = index.entries[attr_id]
        if entry.kind != "attribute":
            continue
        if entry.child_ids:
            stack.extend(entry.child_ids)
            continue
        out.append(attr_id)
    return out
