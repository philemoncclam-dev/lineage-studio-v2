"""Fetch input-table schemas from OneLake so the sandbox can register empty
temp views the notebook's reads resolve against.

The chain (verified against a live schema-enabled lakehouse):
  1. static-scan the notebook cells for the tables it reads;
  2. build a name → table-directory index across the workspace's lakehouses
     from a recursive OneLake listing (`_delta_log` marks a Delta table);
  3. for each read table, read its Delta transaction log — newline-JSON commit
     files, highest version first — until a commit carrying `metaData` is found,
     and lift the schema out of `metaData.schemaString` (which is Spark's own
     StructType JSON).

Everything network-touching takes a client; the parsing is pure and unit-tested,
because the live shapes here have historically been the ones that bite
(handoff: verify against the tenant, the swagger has been wrong).
"""

from __future__ import annotations

import json

from ..parser import _READ_PATTERNS, _find_raw, _without_python_imports
from ..sandbox._refs import parse_ref, qualify, table_of
from ..sandbox.protocol import ColumnSchema, SchemaResolution
from .client import FabricError


def _note(report: SchemaResolution | None, message: str) -> None:
    """Record a failure that is otherwise swallowed.

    Every `except FabricError` below continues rather than raising — one
    unreadable table must not fail a run that can still resolve the rest. That
    is right, but it made a refusal silent. The `report` out-parameter is how a
    caller that wants the diagnosis gets it, without any of them changing
    behaviour for a caller that does not.
    """
    if report is not None:
        report.failures.append(message)

# Delta type name → a Spark-DDL-parseable type string (for empty-view creation).
_DELTA_TO_DDL = {
    "long": "bigint",
    "integer": "int",
    "short": "smallint",
    "byte": "tinyint",
    "float": "float",
    "double": "double",
    "string": "string",
    "boolean": "boolean",
    "binary": "binary",
    "date": "date",
    "timestamp": "timestamp",
    "timestamp_ntz": "timestamp",
}


def delta_type_to_ddl(t: object) -> str:
    """A Delta field `type` → a DDL type string.

    Nested types (struct/array/map arrive as dicts) are flattened to `string`:
    the empty view only needs a resolvable column of the right name; nested
    fidelity isn't required for lineage shape.
    """
    if isinstance(t, dict):
        return "string"
    ts = str(t)
    if ts.startswith("decimal"):
        return ts
    return _DELTA_TO_DDL.get(ts, "string")


def parse_delta_schema(commit_texts_desc: list[str]) -> list[ColumnSchema]:
    """Columns from the first (highest-version) commit that carries a schema.

    `commit_texts_desc` is the content of `_delta_log/*.json` commits in
    descending version order; the newest `metaData` is the current schema
    because Delta writes the *full* schema into each `metaData`, not a diff.
    """
    for text in commit_texts_desc:
        meta = None
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if isinstance(obj, dict) and obj.get("metaData"):
                meta = obj["metaData"]
        if meta and meta.get("schemaString"):
            fields = json.loads(meta["schemaString"]).get("fields", [])
            return [
                ColumnSchema(name=f["name"], type=delta_type_to_ddl(f.get("type")))
                for f in fields
                if f.get("name")
            ]
    return []


def scan_read_tables(
    cells: list[str],
    default_workspace: str = "",
    default_lakehouse: str = "",
    name_map: dict[str, str] | None = None,
) -> set[str]:
    """Best-effort static pass for the tables a notebook reads, as canonical refs.

    Needed because view registration has to happen *before* the run, so the
    accurate reads (from Spark's plans) aren't available yet. Refs rather than
    bare names because a notebook may read across workspaces, and the schema for
    `Finance/Gold/customers` is not the one for `Marketing/Gold/customers`.
    """
    reads: set[str] = set()
    for cell in cells:
        for raw in _find_raw(_READ_PATTERNS, _without_python_imports(cell)):
            ref = qualify(raw, default_workspace, default_lakehouse, name_map)
            if table_of(ref):
                reads.add(ref)
    return reads


def table_dirs_for_lakehouse(client, workspace_id: str, lakehouse_id: str) -> dict[str, str]:
    """`short table name → OneLake table directory` for one lakehouse."""
    paths = client.onelake_list(workspace_id, f"{lakehouse_id}/Tables", recursive=True)
    out: dict[str, str] = {}
    for p in paths:
        name = p.get("name") or ""
        if not name.endswith("/_delta_log"):
            continue
        table_dir = name[: -len("/_delta_log")]
        short = table_dir.split("/")[-1]
        out.setdefault(short.lower(), table_dir)
    return out


def fetch_table_schema(
    client,
    workspace_id: str,
    table_dir: str,
    report: SchemaResolution | None = None,
) -> list[ColumnSchema]:
    """The Delta schema of one table, or `[]` if it can't be read.

    Reads `_delta_log` commits newest-first and stops at the first with a
    `metaData` — usually one or two small reads.
    """
    try:
        log_paths = client.onelake_list(workspace_id, f"{table_dir}/_delta_log", recursive=False)
    except FabricError as exc:
        _note(report, f"{table_dir}: _delta_log not listable — {exc}")
        return []
    commits = sorted(
        (p.get("name") for p in log_paths if (p.get("name") or "").endswith(".json")),
        reverse=True,
    )
    if not commits:
        _note(report, f"{table_dir}: _delta_log listed but held no commit files")
        return []
    for commit in commits:
        try:
            text = client.onelake_read_text(workspace_id, commit)
        except FabricError as exc:
            _note(report, f"{commit}: not readable — {exc}")
            continue
        cols = parse_delta_schema([text])
        if cols:
            return cols
    _note(report, f"{table_dir}: no commit carried a parseable metaData schema")
    return []


def workspace_index(client) -> dict[str, str]:
    """`workspace name (lowered) → id`, plus id → id so a GUID ref resolves too.

    A notebook that reads across workspaces names them however the source does;
    both forms have to reach an id before OneLake can be listed.
    """
    try:
        spaces = client.list_workspaces()
    except FabricError:
        return {}
    index: dict[str, str] = {}
    for ws in spaces:
        wid = ws.get("id")
        if not wid:
            continue
        index[wid.lower()] = wid
        if ws.get("displayName"):
            index.setdefault(ws["displayName"].lower(), wid)
    return index


def guid_name_map(client, workspace_ids: list[str]) -> dict[str, str]:
    """`GUID (lowered) → display name` for workspaces and their lakehouses.

    `abfss://` paths address everything by GUID, so without this a cross-
    workspace read shows up in the graph as a pair of GUIDs. Best-effort: an
    unresolved GUID stays as itself, which is still a correct *identity* — just
    an unfriendly label.
    """
    out: dict[str, str] = {}
    try:
        for ws in client.list_workspaces():
            if ws.get("id") and ws.get("displayName"):
                out[ws["id"].lower()] = ws["displayName"]
    except FabricError:
        pass
    for wid in workspace_ids:
        if not wid:
            continue
        try:
            for item in client.list_items(wid):
                if (item.get("type") or "").lower() == "lakehouse" and item.get("id"):
                    out[item["id"].lower()] = item.get("displayName") or item["id"]
        except FabricError:
            continue
    return out


def _lakehouse_table_index(
    client, workspace_id: str, report: SchemaResolution | None = None
) -> dict[str, str]:
    """`short table name → OneLake table dir` across one workspace's lakehouses."""
    try:
        items = client.list_items(workspace_id)
    except FabricError as exc:
        _note(report, f"workspace {workspace_id}: items not listable — {exc}")
        return {}
    lakehouses = [i for i in items if (i.get("type") or "").lower() == "lakehouse"]
    if not lakehouses:
        # A workspace that lists zero lakehouses is the exact shape a workspace
        # the principal cannot see also takes — worth saying, not worth calling
        # an error.
        _note(report, f"workspace {workspace_id}: no lakehouse visible to this principal")
    index: dict[str, str] = {}
    for item in lakehouses:
        try:
            for short, table_dir in table_dirs_for_lakehouse(client, workspace_id, item["id"]).items():
                index.setdefault(short, table_dir)
        except FabricError as exc:
            _note(report, f"lakehouse {item.get('displayName') or item['id']}: Tables not listable — {exc}")
            continue
    return index


def resolve_read_schemas(
    client,
    workspace_id: str,
    read_refs: set[str],
    ws_index: dict[str, str] | None = None,
    report: SchemaResolution | None = None,
) -> dict[str, list[ColumnSchema]]:
    """Schemas for the read tables, fetched from each ref's own workspace.

    Refs are grouped by workspace so a cross-workspace read is resolved against
    the workspace it actually lives in — previously every read was looked up in
    the notebook's own workspace, so a foreign table either failed to resolve or,
    worse, silently matched a same-named local one.

    Within a workspace, names are still matched short and first lakehouse wins
    on a collision: enough to register an empty view, and the sandbox reports
    per-cell errors honestly for anything that stays unresolved.
    """
    if report is not None:
        report.requested = sorted(read_refs)
    if not read_refs:
        return {}
    ws_index = ws_index if ws_index is not None else workspace_index(client)

    by_workspace: dict[str, list[str]] = {}
    for ref in read_refs:
        ws, _lh, _table = parse_ref(ref)
        # An unqualified or unknown workspace means the notebook's own.
        wid = ws_index.get(ws.lower(), workspace_id) if ws else workspace_id
        by_workspace.setdefault(wid, []).append(ref)

    schemas: dict[str, list[ColumnSchema]] = {}
    for wid, refs in by_workspace.items():
        if not wid:
            _note(report, f"{', '.join(sorted(refs))}: workspace could not be resolved to an id")
            continue
        index = _lakehouse_table_index(client, wid, report)
        for ref in refs:
            table_dir = index.get(table_of(ref).lower())
            if not table_dir:
                _note(report, f"{ref}: no Delta table of that name in workspace {wid}")
                continue
            cols = fetch_table_schema(client, wid, table_dir, report)
            if cols:
                schemas[ref] = cols
    if report is not None:
        report.resolved = sorted(schemas)
        report.unresolved = sorted(read_refs - set(schemas))
    return schemas
