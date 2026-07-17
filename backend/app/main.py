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

from .models import IngestRequest, LineageGraph
from .parser import build_graph
from .sample import SAMPLE

app = FastAPI(title="Lineage Studio API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
