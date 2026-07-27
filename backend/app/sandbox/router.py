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
from .protocol import ColumnSchema, RunRequest, RunResult
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
        # Names for the GUIDs the notebook's paths use, and the notebook's own
        # workspace name when the caller didn't supply it.
        try:
            ws_index = workspace_index(client)
            name_map = guid_name_map(client, [req.workspace_id])
            workspace = workspace or name_map.get(req.workspace_id.lower(), "")
        except FabricError:
            ws_index = {}
        # Fetch the read tables' schemas from OneLake so the Spark engine can
        # register empty views the notebook resolves against. Best-effort:
        # anything unresolved just surfaces as a per-cell error in the run.
        if not schemas:
            try:
                refs = scan_read_tables(cells, workspace, lakehouse, name_map)
                fetched = resolve_read_schemas(client, req.workspace_id, refs, ws_index)
                schemas = {k: list(v) for k, v in fetched.items()}
            except FabricError:
                schemas = {}

    return run_sandbox(
        RunRequest(
            notebook_name=req.name,
            cells=cells,
            schemas=schemas,
            workspace=workspace,
            lakehouse=lakehouse,
            name_map=name_map,
        )
    )
