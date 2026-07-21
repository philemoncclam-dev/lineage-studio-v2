"""HTTP surface for the two write paths that have no router of their own.

`definitions.py` ships its own router because its upload/match/apply flow is
self-contained. Lineage push and data-product cataloguing both need to combine
several modules (Fabric fetch, the parser, the Purview graph), so that wiring
lives here rather than in any one of them.

Every endpoint takes `apply` and returns a `WriteResult`, so the UI can preview
and confirm through the same call — see `writer.WriteSession`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..fabric.client import FabricClient, FabricError
from ..fabric.notebooks import (
    notebook_source_from_definition,
    parse_notebook_qualified_name,
)
from ..models import LineageGraph, NotebookSource
from .client import PurviewClient, PurviewError
from .dataproduct import (
    catalog_datamap_assets,
    create_data_product,
    list_data_products,
    list_governance_domains,
)
from .ingest import build_graph_from_purview
from .lineage_push import push_notebook_lineage
from .writer import WriteSession

router = APIRouter(prefix="/purview", tags=["purview"])


class LineagePushRequest(BaseModel):
    apply: bool = Field(False, description="Transmit, rather than preview")


class DataProductRequest(BaseModel):
    name: str
    domain_id: str
    description: str | None = None
    #: Data-map GUIDs, which are what our graph nodes carry as their ids.
    asset_guids: list[str] = Field(default_factory=list)
    apply: bool = False


def _fabric_notebook_sources(graph: LineageGraph) -> dict[str, NotebookSource]:
    """Fetch source for every notebook in the graph that Fabric will give us.

    A notebook whose workspace the service principal cannot read is skipped
    rather than failing the request: partial lineage from the workspaces we can
    see is more useful than none, and the response reports what was covered.
    """
    client = FabricClient()
    sources: dict[str, NotebookSource] = {}
    for node in graph.nodes:
        if node.kind != "notebook":
            continue
        ids = parse_notebook_qualified_name(node.meta.get("qualified_name") or "")
        if ids is None:
            continue
        workspace_id, item_id = ids
        try:
            definition = client.get_notebook_definition(workspace_id, item_id)
        except FabricError:
            continue
        sources[node.name] = notebook_source_from_definition(node.name, definition)
    return sources


@router.post("/lineage/push")
def push_lineage(req: LineagePushRequest) -> dict:
    """Derive lineage from live notebook code and write it back to Purview."""
    try:
        graph = build_graph_from_purview()
        sources = _fabric_notebook_sources(graph)
        if not sources:
            raise HTTPException(
                status_code=503,
                detail=(
                    "No notebook source could be read from Fabric — the service "
                    "principal likely lacks workspace access."
                ),
            )
        result = push_notebook_lineage(graph, sources, apply=req.apply)
    except (PurviewError, FabricError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {**result.to_dict(), "notebooks_read": sorted(sources)}


@router.get("/domains")
def domains() -> list[dict]:
    """Governance domains a data product can be created in."""
    try:
        return [
            {"id": d.id, "name": d.name, "status": d.status}
            for d in list_governance_domains(PurviewClient())
        ]
    except PurviewError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/dataproducts")
def data_products() -> list[dict]:
    try:
        return [
            {"id": p.id, "name": p.name, "domain": p.domain, "status": p.status}
            for p in list_data_products(PurviewClient())
        ]
    except PurviewError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/dataproducts")
def catalog_data_product(req: DataProductRequest) -> dict:
    """Create a data product and put the selected assets in it.

    Creation and asset linking are two round-trips (the link needs an id only
    the create response carries), so on a dry run this previews the create plus
    the onboarding calls, and the links land on apply.
    """
    try:
        client = PurviewClient()
        session = WriteSession(client, apply=req.apply)
        product_id = create_data_product(
            session,
            req.name,
            req.domain_id,
            description=req.description,
        )
        result = session.run()
        if req.apply and result.ok and req.asset_guids:
            assets = catalog_datamap_assets(
                client, product_id, req.asset_guids, apply=True
            )
            result.ops.extend(assets.ops)
            result.responses.extend(assets.responses)
            result.errors.extend(assets.errors)
    except PurviewError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {**result.to_dict(), "data_product_id": product_id}
