"""HTTP surface for the Data Products section.

Products, their metadata and the access-request workflow are served from the
local store (`store.py`); it is the source of truth for the *product framing*
and is always available, credentials or not. Domains prefer the live Purview
governance domains (with the parent field giving sub-domains) and fall back to
the store's seed tree when Purview is not configured — the section stays usable
either way, and the frontend builds the same tree from either source.

Approving a request performs a real, gated Fabric grant (`grant.py`); a decision
is persisted whether or not the grant could actually be sent, so the workflow
never loses an approval to a disabled write gate.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import get_settings
from ..purview.client import PurviewClient, PurviewError
from ..purview.dataproduct import list_governance_domains
from . import store
from .grant import grant_reader_access
from .store import (
    AccessRequest,
    Asset,
    DataProduct,
    Domain,
    Owner,
    SEED_DOMAINS,
)

router = APIRouter(prefix="/products", tags=["products"])


# --- domains -------------------------------------------------------------


@router.get("/domains")
def domains() -> list[Domain]:
    """The domain tree. Live Purview governance domains when configured,
    otherwise the store's seed tree. Either way each carries `parent_id`, so a
    sub-domain is just a domain whose parent is set."""
    settings = get_settings()
    if settings.purview_configured:
        try:
            live = list_governance_domains(PurviewClient())
            if live:
                return [
                    Domain(id=d.id, name=d.name, parent_id=d.parent_id,
                           description=d.description)
                    for d in live
                ]
        except PurviewError:
            # Purview unreachable — fall through to the seed tree rather than
            # 503, so the section still renders. Empty means "no permission"
            # here (see handoff), so an empty live result also falls back.
            pass
    return SEED_DOMAINS


# --- products ------------------------------------------------------------


class ProductWrite(BaseModel):
    name: str
    domain_id: str
    description: str = ""
    use_cases: list[str] = Field(default_factory=list)
    owners: list[Owner] = Field(default_factory=list)
    assets: list[Asset] = Field(default_factory=list)
    workspace_id: str | None = None
    workspace_name: str | None = None
    model_id: str | None = None
    model_name: str | None = None
    status: str = "draft"


@router.get("")
def list_products() -> list[DataProduct]:
    return store.list_products()


@router.get("/{product_id}")
def get_product(product_id: str) -> DataProduct:
    product = store.get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"no data product {product_id!r}")
    return product


@router.post("", status_code=201)
def create_product(body: ProductWrite) -> DataProduct:
    if not store.get_domain_exists(body.domain_id):
        raise HTTPException(status_code=422, detail=f"unknown domain {body.domain_id!r}")
    return store.create_product(DataProduct(id="", **body.model_dump()))


@router.put("/{product_id}")
def update_product(product_id: str, body: ProductWrite) -> DataProduct:
    updated = store.update_product(product_id, body.model_dump(exclude_none=True))
    if updated is None:
        raise HTTPException(status_code=404, detail=f"no data product {product_id!r}")
    return updated


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: str) -> None:
    if not store.delete_product(product_id):
        raise HTTPException(status_code=404, detail=f"no data product {product_id!r}")


# --- access requests -----------------------------------------------------


class RequestCreate(BaseModel):
    requester_name: str
    requester_email: str
    requester_object_id: str | None = None
    justification: str = ""


class Decision(BaseModel):
    approve: bool
    decided_by: str = ""
    #: Transmit the grant, rather than preview it. The write gate still applies.
    apply: bool = False


@router.get("/requests/all")
def all_requests(status: str | None = None) -> list[AccessRequest]:
    """Every access request, for the owner approval inbox. `/requests/all`
    rather than `/requests` so it never collides with a product id path."""
    return store.list_requests(status=status)  # type: ignore[arg-type]


@router.get("/{product_id}/requests")
def product_requests(product_id: str) -> list[AccessRequest]:
    return store.list_requests(product_id=product_id)


@router.post("/{product_id}/requests", status_code=201)
def request_access(product_id: str, body: RequestCreate) -> AccessRequest:
    product = store.get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"no data product {product_id!r}")
    return store.create_request(
        AccessRequest(
            id="",
            product_id=product.id,
            product_name=product.name,
            requester_name=body.requester_name,
            requester_email=body.requester_email,
            requester_object_id=body.requester_object_id,
            justification=body.justification,
        )
    )


@router.post("/requests/{request_id}/decide")
def decide_request(request_id: str, body: Decision) -> AccessRequest:
    """Approve or deny a request. Approving performs the gated Fabric grant and
    records what it did; the decision persists regardless of the grant outcome
    so a disabled write gate can never lose an approval."""
    from datetime import datetime, timezone

    req = store.get_request(request_id)
    if req is None:
        raise HTTPException(status_code=404, detail=f"no request {request_id!r}")
    if req.status != "pending":
        raise HTTPException(
            status_code=409, detail=f"request already {req.status}"
        )

    product = store.get_product(req.product_id)
    workspace_id = product.workspace_id if product else None

    grant = None
    if body.approve:
        grant = grant_reader_access(req, workspace_id, apply=body.apply)

    decided = req.model_copy(
        update={
            "status": "approved" if body.approve else "denied",
            "decided_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "decided_by": body.decided_by or None,
            "grant": grant,
        }
    )
    return store.save_request(decided)
