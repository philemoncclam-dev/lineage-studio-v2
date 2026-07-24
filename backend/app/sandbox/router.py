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
from .protocol import RunRequest, RunResult
from .runner import run_sandbox

router = APIRouter(prefix="/fabric/sandbox", tags=["sandbox"])


class SandboxRunRequest(BaseModel):
    name: str = "notebook"
    workspace_id: str | None = None
    item_id: str | None = None
    #: When present, run these cells directly and skip the Fabric fetch.
    cells: list[str] | None = None


@router.post("/run", response_model=RunResult)
def sandbox_run(req: SandboxRunRequest) -> RunResult:
    cells = req.cells
    if cells is None:
        if not (req.workspace_id and req.item_id):
            raise HTTPException(
                status_code=400,
                detail="provide cells, or workspace_id + item_id to fetch the notebook",
            )
        try:
            source = fetch_notebook_source(
                FabricClient(), req.workspace_id, req.item_id, req.name
            )
        except (FabricError, NotebookDecodeError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        cells = source.cells

    return run_sandbox(RunRequest(notebook_name=req.name, cells=cells))
