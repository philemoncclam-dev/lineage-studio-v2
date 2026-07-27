"""Read-only `/fabric/*` endpoints backing the Fabric-toolkit explorer.

These expose the slice of the live Fabric REST surface the explorer tree walks:
workspaces → folders + notebooks + lakehouses → lakehouse tables. Everything is
a GET; nothing here mutates Fabric.

Two failure modes are kept distinct on purpose (handoff trap — "empty means no
permission"):
  - the integration being unconfigured, or a *call* being refused, is an error
    (503 / 502) the UI can show as "couldn't read", and
  - a genuinely empty list (200 with `value: []`) is returned as-is, so the UI
    can render an empty-but-connected state without mistaking it for success.

Columns are deliberately absent: there is no reliable REST endpoint for lakehouse
table columns, and the accurate path (Delta/SQL schema) is the same fetch the
Phase-2 sandbox stands up. The tree stops at tables until that lands.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import get_settings
from .client import FabricClient, FabricError
from .notebooks import NotebookDecodeError, fetch_notebook_source
from ..sandbox._refs import workspace_of
from .pipelines import PipelineActivity, parse_pipeline_activities
from .schema import fetch_table_schema, guid_name_map, table_dirs_for_lakehouse

router = APIRouter(prefix="/fabric", tags=["fabric"])


class Workspace(BaseModel):
    id: str
    name: str
    description: str | None = None


class Folder(BaseModel):
    id: str
    name: str
    parent_id: str | None = None


class Item(BaseModel):
    id: str
    name: str
    type: str
    folder_id: str | None = None
    description: str | None = None


class WorkspaceItems(BaseModel):
    folders: list[Folder]
    notebooks: list[Item]
    lakehouses: list[Item]
    others: list[Item]


class Table(BaseModel):
    name: str
    type: str | None = None
    format: str | None = None


class CatalogEntry(BaseModel):
    """One searchable asset for the command palette (flat, self-locating)."""

    kind: str  # workspace | notebook | lakehouse | table | item
    workspace_id: str
    workspace_name: str
    id: str  # item id; for a table, the table name
    name: str
    item_type: str | None = None  # Fabric item type, or "Table"
    lakehouse_id: str | None = None
    lakehouse_name: str | None = None


class NotebookSourceResponse(BaseModel):
    name: str
    lakehouse_default: str | None = None
    cells: list[str]


class Column(BaseModel):
    name: str
    type: str | None = None


def _client() -> FabricClient:
    """A configured client, or a 503 the UI can show as 'not connected'."""
    try:
        return FabricClient()
    except FabricError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _name(obj: dict) -> str:
    return obj.get("displayName") or obj.get("name") or obj.get("id") or ""


@router.get("/status")
def fabric_status() -> dict[str, bool]:
    """Lets the explorer show a connect prompt without a failing call first."""
    return {"configured": get_settings().purview_configured}


@router.get("/workspaces", response_model=list[Workspace])
def list_workspaces() -> list[Workspace]:
    client = _client()
    try:
        raw = client.list_workspaces()
    except FabricError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [
        Workspace(id=w["id"], name=_name(w), description=w.get("description") or None)
        for w in raw
        if w.get("id")
    ]


@router.get("/catalog", response_model=list[CatalogEntry])
def catalog() -> list[CatalogEntry]:
    """A flat index of every discoverable asset, for palette search.

    Walks workspaces → items → lakehouse tables. Per-workspace and
    per-lakehouse failures are swallowed (best-effort) so one refused corner
    doesn't blank the whole index — but the top-level workspace list refusal is
    still an error (empty-means-no-permission trap).
    """
    client = _client()
    try:
        workspaces = client.list_workspaces()
    except FabricError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    out: list[CatalogEntry] = []
    for w in workspaces:
        wid = w.get("id")
        if not wid:
            continue
        wname = _name(w)
        out.append(
            CatalogEntry(kind="workspace", workspace_id=wid, workspace_name=wname, id=wid, name=wname)
        )
        try:
            items = client.list_items(wid)
        except FabricError:
            continue
        lakehouses: list[tuple[str, str]] = []
        for it in items:
            iid = it.get("id")
            if not iid:
                continue
            itype = it.get("type") or "Unknown"
            iname = _name(it)
            kind = itype.lower()
            if kind == "notebook":
                out.append(CatalogEntry(kind="notebook", workspace_id=wid, workspace_name=wname, id=iid, name=iname, item_type=itype))
            elif kind == "lakehouse":
                out.append(CatalogEntry(kind="lakehouse", workspace_id=wid, workspace_name=wname, id=iid, name=iname, item_type=itype))
                lakehouses.append((iid, iname))
            else:
                out.append(CatalogEntry(kind="item", workspace_id=wid, workspace_name=wname, id=iid, name=iname, item_type=itype))
        for lid, lname in lakehouses:
            try:
                tables = client.list_lakehouse_tables(wid, lid)
            except FabricError:
                continue
            for t in tables:
                tn = t.get("name")
                if not tn:
                    continue
                out.append(
                    CatalogEntry(
                        kind="table",
                        workspace_id=wid,
                        workspace_name=wname,
                        id=tn,
                        name=tn,
                        item_type="Table",
                        lakehouse_id=lid,
                        lakehouse_name=lname,
                    )
                )
    return out


@router.get("/workspaces/{workspace_id}/items", response_model=WorkspaceItems)
def list_workspace_items(workspace_id: str) -> WorkspaceItems:
    client = _client()
    try:
        raw_items = client.list_items(workspace_id)
        raw_folders = client.list_folders(workspace_id)
    except FabricError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    folders = [
        Folder(
            id=f["id"],
            name=_name(f),
            parent_id=f.get("parentFolderId") or f.get("parent_id"),
        )
        for f in raw_folders
        if f.get("id")
    ]

    notebooks: list[Item] = []
    lakehouses: list[Item] = []
    others: list[Item] = []
    for it in raw_items:
        if not it.get("id"):
            continue
        item = Item(
            id=it["id"],
            name=_name(it),
            type=it.get("type") or "Unknown",
            folder_id=it.get("folderId") or it.get("folder_id"),
            description=it.get("description") or None,
        )
        kind = item.type.lower()
        if kind == "notebook":
            notebooks.append(item)
        elif kind == "lakehouse":
            lakehouses.append(item)
        else:
            others.append(item)

    return WorkspaceItems(
        folders=folders, notebooks=notebooks, lakehouses=lakehouses, others=others
    )


@router.get(
    "/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/tables",
    response_model=list[Table],
)
def list_lakehouse_tables(workspace_id: str, lakehouse_id: str) -> list[Table]:
    client = _client()
    try:
        raw = client.list_lakehouse_tables(workspace_id, lakehouse_id)
    except FabricError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [
        Table(name=t["name"], type=t.get("type"), format=t.get("format"))
        for t in raw
        if t.get("name")
    ]


@router.get(
    "/workspaces/{workspace_id}/notebooks/{item_id}/source",
    response_model=NotebookSourceResponse,
)
def get_notebook_source(
    workspace_id: str, item_id: str, name: str = "notebook"
) -> NotebookSourceResponse:
    """The decoded code cells of one notebook, read-only, for the detail panel.

    Reuses the same `fetch_notebook_source` the sandbox relies on; a refused
    call or an undecodable definition is a 502 the UI shows as "couldn't read".
    """
    client = _client()
    try:
        src = fetch_notebook_source(client, workspace_id, item_id, name)
    except (FabricError, NotebookDecodeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return NotebookSourceResponse(
        name=src.name, lakehouse_default=src.lakehouse_default, cells=src.cells
    )


@router.get(
    "/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/tables/{table_name}/schema",
    response_model=list[Column],
)
def get_table_schema(
    workspace_id: str, lakehouse_id: str, table_name: str
) -> list[Column]:
    """Column list for one lakehouse table, from its OneLake Delta log.

    Same schema path the sandbox stands up (schema.py). An empty list means the
    table's `_delta_log` couldn't be read or carried no schema — not that the
    table has no columns.
    """
    client = _client()
    try:
        dirs = table_dirs_for_lakehouse(client, workspace_id, lakehouse_id)
    except FabricError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    # Schema-enabled lakehouses surface tables as schema-qualified names
    # ("dbo.raw_orders"), but table_dirs_for_lakehouse keys on the last path
    # segment only ("raw_orders"). Try the qualified name first, then fall back
    # to the segment after the last dot so both layouts resolve.
    key = table_name.lower()
    table_dir = dirs.get(key) or dirs.get(key.rsplit(".", 1)[-1])
    if not table_dir:
        raise HTTPException(
            status_code=404, detail=f"table {table_name!r} not found in lakehouse"
        )
    cols = fetch_table_schema(client, workspace_id, table_dir)
    return [Column(name=c.name, type=c.type) for c in cols]


@router.get(
    "/workspaces/{workspace_id}/pipelines/{item_id}/definition",
    response_model=list[PipelineActivity],
)
def get_pipeline_definition(workspace_id: str, item_id: str) -> list[PipelineActivity]:
    """The activity graph of one Data Pipeline, for the detail panel's canvas.

    Reads the item's `getDefinition` and parses `pipeline-content.json`'s
    activities + dependsOn edges — the same shape Fabric's authoring canvas
    draws — plus the table and column lineage a Copy activity declares inline.
    A refused read is a 502; an empty list means no activities.
    """
    client = _client()
    try:
        definition = client.get_item_definition(workspace_id, item_id)
    except FabricError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Parsed twice on purpose. A Copy stores its workspace and lakehouse as
    # GUIDs, and which GUIDs those are is only knowable from the definition —
    # so the first pass discovers them and the second renders them as names.
    # Cheap (the definition is already in memory) and it keeps the parser pure.
    first = parse_pipeline_activities(definition, default_workspace=workspace_id)
    guids = {
        workspace_of(ref)
        for activity in first
        for ref in (*activity.reads, *activity.writes)
        if workspace_of(ref)
    }
    # No tables named, so nothing to put names on — and no reason to spend a
    # workspace listing on a pipeline that is all notebooks.
    if not guids:
        return first
    try:
        name_map = guid_name_map(client, sorted(guids | {workspace_id}))
    except Exception:  # noqa: BLE001
        # An unresolved GUID is still a correct identity, just an unfriendly
        # label. Nothing about naming is worth failing a definition read for.
        name_map = {}
    return parse_pipeline_activities(
        definition, name_map=name_map, default_workspace=name_map.get(workspace_id.lower(), "")
    )
