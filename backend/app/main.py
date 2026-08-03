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
from pydantic import BaseModel

from fastapi import HTTPException

from .config import get_settings
from .models import IngestRequest, LineageGraph
from .parser import build_graph
from .purview.client import PurviewError
from .purview.actions import router as actions_router
from .purview.definitions import router as definitions_router
from .purview.ingest import build_graph_from_purview
from .chat.router import router as chat_router
from .products.router import router as products_router
from .fabric.router import router as fabric_router
from .sandbox.router import router as sandbox_router
from .share.router import router as share_router
from .sample import SAMPLE
from .integrations import describe_identity, describe_integrations
from .sandbox.runner import spark_available
from .startup_checks import assert_safe_to_start

# Before anything is served. Two safety properties of this app used to be
# enforced only by prose — an env var away from arbitrary code execution, and a
# Dockerfile comment away from handing every secret to a notebook cell. They are
# assertions now, and a process that violates them does not start. See
# `startup_checks.py`; nothing here fires outside `APP_ENV=production`.
assert_safe_to_start(get_settings(), spark_engine=spark_available())

app = FastAPI(title="Lineage Studio API", version="0.1.0")

# Deliberately an allow-list, not a wildcard: this API can spend Purview
# credentials, so any origin permitted here can do so on a visitor's behalf.
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(definitions_router)
app.include_router(actions_router)
app.include_router(products_router)
app.include_router(fabric_router)
app.include_router(sandbox_router)
app.include_router(chat_router)
app.include_router(share_router)

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


class IntegrationOut(BaseModel):
    key: str
    name: str
    vendor: str
    host: str
    configured: bool
    purpose: str
    degrades: str
    needs: str
    detail: str = ""
    caveats: list[str] = []


@app.get("/integrations", response_model=list[IntegrationOut])
def list_integrations() -> list[IntegrationOut]:
    """Every external service this app calls, and what breaks without each.

    Configuration, not liveness — nothing here makes a network call. See
    `app/integrations.py` for why, and for the rule that no secret leaves this
    endpoint: every field is a boolean, a hostname, or something already public.
    """
    return [
        IntegrationOut(**vars(i)) for i in describe_integrations(get_settings())
    ]


class IdentityOut(BaseModel):
    mode: str
    client_id: str = ""
    tenant_id: str = ""
    display_name: str = ""
    note: str = ""


@app.get("/integrations/identity", response_model=IdentityOut)
def get_identity() -> IdentityOut:
    """Who this backend calls Microsoft as.

    Separate from `/integrations` because it may make a Graph call, and that
    endpoint's promise is that it makes none. Best-effort throughout: an
    unresolvable name is normal and returns the ids with a note.
    """
    settings = get_settings()

    def resolve(app_id: str) -> str:
        from .purview.client import PurviewClient

        return PurviewClient(settings).service_principal_name(app_id)

    return IdentityOut(**vars(describe_identity(settings, resolve)))
