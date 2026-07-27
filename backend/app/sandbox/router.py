"""`/fabric/sandbox/run` — execute a notebook in the isolated sandbox.

Either the cells are supplied directly (offline / test path), or a live notebook
is fetched from Fabric by workspace + item id and decoded to cells first. Either
way the run itself goes through `run_sandbox`, so the isolation guarantees hold
regardless of where the code came from.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..fabric.client import FabricClient, FabricError
from ..fabric.notebooks import NotebookDecodeError, fetch_notebook_source
from ..fabric.schema import (
    guid_name_map,
    resolve_read_schemas,
    scan_read_tables,
    workspace_index,
)
from ._refs import referenced_workspace_ids
from .protocol import ColumnSchema, RunRequest, RunResult, SchemaResolution
from .runner import run_sandbox

router = APIRouter(prefix="/fabric/sandbox", tags=["sandbox"])


class SandboxRunRequest(BaseModel):
    name: str = "notebook"
    workspace_id: str | None = None
    item_id: str | None = None
    #: When present, run these cells directly and skip the Fabric fetch.
    cells: list[str] | None = None
    #: Empty-view schemas for the tables the notebook reads, so the Spark engine
    #: can resolve them with zero data. Ignored by the stub engine.
    schemas: dict[str, list[ColumnSchema]] | None = None
    #: The notebook's own workspace and attached lakehouse — the defaults an
    #: unqualified table name resolves against. `workspace` is the display name
    #: (`workspace_id` is the GUID used for API calls); when it is omitted the
    #: name is looked up from the id.
    workspace: str | None = None
    lakehouse: str | None = None


@router.post("/run", response_model=RunResult)
def sandbox_run(req: SandboxRunRequest) -> RunResult:
    cells = req.cells
    schemas: dict[str, list[ColumnSchema]] = dict(req.schemas or {})
    # Stays None when no fetch is attempted — caller-supplied cells or schemas.
    # That is a real third state, distinct from "attempted and found nothing".
    resolution: SchemaResolution | None = None
    workspace = req.workspace or ""
    lakehouse = req.lakehouse or ""
    # GUID → display name, so `abfss://` paths (which carry GUIDs) resolve to
    # readable workspace and lakehouse names in the graph.
    name_map: dict[str, str] = {}
    if cells is None:
        if not (req.workspace_id and req.item_id):
            raise HTTPException(
                status_code=400,
                detail="provide cells, or workspace_id + item_id to fetch the notebook",
            )
        try:
            client = FabricClient()
            source = fetch_notebook_source(client, req.workspace_id, req.item_id, req.name)
        except (FabricError, NotebookDecodeError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        cells = source.cells
        # The notebook's attached lakehouse, off its own metadata header — what
        # an unqualified table name inside it resolves against.
        lakehouse = lakehouse or (source.lakehouse_default or "")
        # Names for the GUIDs the notebook's paths use, and the notebook's own
        # workspace name when the caller didn't supply it.
        try:
            ws_index = workspace_index(client)
            # Include any workspace the notebook reaches into by `abfss://`,
            # so its lakehouse GUIDs get names too — not just the notebook's own.
            name_map = guid_name_map(
                client, [req.workspace_id, *referenced_workspace_ids(cells)]
            )
            workspace = workspace or name_map.get(req.workspace_id.lower(), "")
        except FabricError:
            ws_index = {}
        # Fetch the read tables' schemas from OneLake. The Spark engine
        # registers them as empty views the notebook resolves against; the stub
        # engine needs them to resolve columns at all (see _sqllineage), so on
        # production this fetch IS the column lineage.
        #
        # Still best-effort — one unreadable table must not fail a run that can
        # resolve the rest — but no longer silent: `resolution` records what was
        # asked for, what came back, and every refusal in between, and rides out
        # on the result. Empty schemas and empty column lineage are what a
        # principal without OneLake access produces, and that used to be
        # indistinguishable from a notebook that simply had no SQL.
        if not schemas:
            resolution = SchemaResolution()
            try:
                refs = scan_read_tables(cells, workspace, lakehouse, name_map)
                fetched = resolve_read_schemas(
                    client, req.workspace_id, refs, ws_index, resolution
                )
                schemas = {k: list(v) for k, v in fetched.items()}
            except FabricError as exc:
                # The scan itself failed, so `requested` may be empty too — the
                # message is the only diagnosis there is.
                resolution.failures.append(f"schema fetch abandoned — {exc}")
                schemas = {}

    result = run_sandbox(
        RunRequest(
            notebook_name=req.name,
            cells=cells,
            schemas=schemas,
            workspace=workspace,
            lakehouse=lakehouse,
            name_map=name_map,
        )
    )
    # Attached here rather than inside the executor: the child has no network
    # and no credential, so it could not know any of this even in principle.
    result.schema_resolution = resolution
    return result
