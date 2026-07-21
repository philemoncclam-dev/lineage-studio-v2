"""Lineage Studio backend — Phase 1 API.

Endpoints:
  GET  /health            liveness check
  GET  /sample            built-in demo graph (no Fabric needed)
  POST /ingest            build a lineage graph from uploaded metadata + code

Phase 2 will add /sandbox/run (Spark execution) and /fabric/* (live REST pull).
The in-memory store here is intentionally trivial; swap for a DB when needed.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from fastapi import HTTPException

from .config import get_settings
from .models import IngestRequest, LineageGraph
from .parser import build_graph
from .purview.client import PurviewError
from .purview.definitions import router as definitions_router
from .purview.ingest import build_graph_from_purview
from .sample import SAMPLE

app = FastAPI(title="Lineage Studio API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(definitions_router)

# Trivial single-slot store; the last-built graph is what the UI reads.
_last_graph: LineageGraph = build_graph(SAMPLE)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sample", response_model=LineageGraph)
def sample() -> LineageGraph:
    return build_graph(SAMPLE)


@app.post("/ingest", response_model=LineageGraph)
def ingest(req: IngestRequest) -> LineageGraph:
    global _last_graph
    _last_graph = build_graph(req)
    return _last_graph


@app.get("/graph", response_model=LineageGraph)
def graph() -> LineageGraph:
    return _last_graph


@app.get("/purview/status")
def purview_status() -> dict[str, bool]:
    """Lets the UI show or hide the Purview source without a failing call."""
    settings = get_settings()
    return {
        "configured": settings.purview_configured,
        "write_enabled": settings.purview_allow_write,
    }


@app.get("/purview/graph", response_model=LineageGraph)
def purview_graph() -> LineageGraph:
    """Build the graph from the live Purview data map and make it current."""
    global _last_graph
    try:
        _last_graph = build_graph_from_purview()
    except PurviewError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _last_graph
