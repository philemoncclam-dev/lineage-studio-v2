"""JSON-file persistence for the Data Products section.

The pydantic models here are both the on-disk shape and the API contract — the
store round-trips them through `model_dump`/`model_validate`, so there is only
one schema to keep in step. Two files back the section: `products.json` (the
catalogue) and `requests.json` (the access-request workflow). Both live under
`backend/data/`, which is gitignored — this is working state, not source.

Domains are deliberately *not* persisted here: their system of record is
Purview (governance domains, with the parent field giving sub-domains). The
store only seeds a small domain tree so the section is usable on a machine with
no Purview access, mirroring how `sample.py` lets the graph render offline.

Concurrency is a single process writing a whole file at a time; that is enough
for a pilot and matches the rest of the backend's "swap for a DB when needed"
posture. Writes go through a temp-file rename so a crash mid-write cannot leave
a half-serialised catalogue behind.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

# `backend/data/` — resolved from this file so the cwd the server was launched
# from does not matter (the same reason config.py resolves .env absolutely).
_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_PRODUCTS_FILE = _DATA_DIR / "products.json"
_REQUESTS_FILE = _DATA_DIR / "requests.json"

_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# --- domains -------------------------------------------------------------


class Domain(BaseModel):
    """A governance domain. `parent_id` is what makes a sub-domain a sub-domain.

    Mirrors Purview's business-domain shape (id, name, optional parent) so the
    frontend can build the same tree whether the domains came from the seed
    below or from a live Purview account.
    """

    id: str
    name: str
    parent_id: str | None = None
    description: str | None = None


# A small starter tree so the section has structure before Purview is wired.
SEED_DOMAINS: list[Domain] = [
    Domain(id="dom_sales", name="Sales", description="Revenue, orders and pipeline."),
    Domain(id="dom_sales_orders", name="Orders", parent_id="dom_sales",
           description="Order capture and fulfilment."),
    Domain(id="dom_sales_pipeline", name="Pipeline", parent_id="dom_sales",
           description="Opportunities and forecasting."),
    Domain(id="dom_customer", name="Customer", description="Customer master and behaviour."),
    Domain(id="dom_customer_360", name="Customer 360", parent_id="dom_customer",
           description="Unified customer profile."),
    Domain(id="dom_finance", name="Finance", description="Ledger, billing and reporting."),
]


def seed_domain(domain_id: str) -> Domain | None:
    return next((d for d in SEED_DOMAINS if d.id == domain_id), None)


def get_domain_exists(domain_id: str) -> bool:
    """Whether a domain id is one we can attach a product to.

    Live Purview domain ids are opaque GUIDs the seed tree does not contain, so
    a GUID-shaped id is accepted on trust — the create would otherwise reject
    every real domain. Seed ids are validated exactly.
    """
    if seed_domain(domain_id) is not None:
        return True
    return len(domain_id) >= 12  # opaque Purview id — trust it


# --- products ------------------------------------------------------------


class Owner(BaseModel):
    """A named data-product owner. `object_id` is the Entra object id an access
    grant is assigned to; without it a grant can only be previewed, not applied."""

    name: str
    email: str
    object_id: str | None = None


AssetKind = Literal["table", "powerbi", "notebook", "lakehouse", "other"]


class Column(BaseModel):
    name: str
    data_type: str | None = None
    description: str | None = None


class Asset(BaseModel):
    """A data asset exposed by the product. `purview_guid`/`node_id` tie it back
    to the lineage graph so the UI can cross-link, and `columns` drives the
    drill-in — populated for tables, empty for a Power BI report."""

    id: str
    name: str
    kind: AssetKind = "table"
    node_id: str | None = None
    purview_guid: str | None = None
    columns: list[Column] = Field(default_factory=list)


ProductStatus = Literal["draft", "published", "deprecated"]


class DataProduct(BaseModel):
    id: str
    name: str
    domain_id: str
    description: str = ""
    use_cases: list[str] = Field(default_factory=list)
    owners: list[Owner] = Field(default_factory=list)
    assets: list[Asset] = Field(default_factory=list)
    #: The Fabric workspace an approved request grants reader access to.
    workspace_id: str | None = None
    workspace_name: str | None = None
    #: Deep-link into the modelling tab: the authored model this product maps to.
    model_id: str | None = None
    model_name: str | None = None
    status: ProductStatus = "draft"
    #: Whether the underlying data map / catalog id is known (Purview-published).
    purview_id: str | None = None
    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)


# A seed product so the section renders something real out of the box, the way
# `sampleModel()` seeds the graph. Assets mirror the sample lineage naming.
SEED_PRODUCTS: list[DataProduct] = [
    DataProduct(
        id="dp_customer_analytics",
        name="Customer Analytics",
        domain_id="dom_customer_360",
        description=(
            "A curated, gold-layer view of customer lifetime value and order "
            "history, ready for BI and analytics consumption."
        ),
        use_cases=[
            "Segment customers by lifetime value for targeted campaigns",
            "Power the executive revenue dashboard",
            "Feed the churn-prediction feature store",
        ],
        owners=[Owner(name="Ava Chen", email="ava.chen@example.com")],
        workspace_id="00000000-0000-0000-0000-000000000000",
        workspace_name="SalesLakehouse-P-S",
        status="published",
        assets=[
            Asset(
                id="a_gold_ltv",
                name="gold_customer_ltv",
                kind="table",
                columns=[
                    Column(name="customer_id", data_type="string"),
                    Column(name="lifetime_value", data_type="decimal"),
                    Column(name="order_count", data_type="int"),
                    Column(name="last_order_date", data_type="date"),
                ],
            ),
            Asset(id="a_ltv_report", name="Customer LTV Report", kind="powerbi"),
        ],
    ),
]


class _Catalogue(BaseModel):
    products: list[DataProduct] = Field(default_factory=list)


# --- access requests -----------------------------------------------------


RequestStatus = Literal["pending", "approved", "denied"]


class GrantRecord(BaseModel):
    """What the approval did (or would do) about Fabric access. `applied` is
    false on a dry run or when writes are gated off — the request can still be
    approved, with the grant recorded as intent for a later real send."""

    applied: bool = False
    dry_run: bool = True
    describes: str = ""
    role: str = "Viewer"
    error: str | None = None


class AccessRequest(BaseModel):
    id: str
    product_id: str
    product_name: str
    requester_name: str
    requester_email: str
    #: Entra object id of the requester — required to actually apply a grant.
    requester_object_id: str | None = None
    justification: str = ""
    status: RequestStatus = "pending"
    created_at: str = Field(default_factory=_now)
    decided_at: str | None = None
    decided_by: str | None = None
    grant: GrantRecord | None = None


class _Requests(BaseModel):
    requests: list[AccessRequest] = Field(default_factory=list)


# --- persistence ---------------------------------------------------------


def _read(path: Path, model: type[BaseModel], seed: BaseModel) -> BaseModel:
    if not path.exists():
        _write(path, seed)
        return seed
    return model.model_validate_json(path.read_text(encoding="utf-8"))


def _write(path: Path, data: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data.model_dump_json(indent=2), encoding="utf-8")
    os.replace(tmp, path)  # atomic on the same filesystem


def _load_catalogue() -> _Catalogue:
    return _read(_PRODUCTS_FILE, _Catalogue, _Catalogue(products=SEED_PRODUCTS))  # type: ignore[return-value]


def _load_requests() -> _Requests:
    return _read(_REQUESTS_FILE, _Requests, _Requests())  # type: ignore[return-value]


# --- product operations --------------------------------------------------


def list_products() -> list[DataProduct]:
    return _load_catalogue().products


def get_product(product_id: str) -> DataProduct | None:
    return next((p for p in list_products() if p.id == product_id), None)


def create_product(product: DataProduct) -> DataProduct:
    with _lock:
        cat = _load_catalogue()
        if not product.id:
            product.id = _new_id("dp")
        product.created_at = product.updated_at = _now()
        cat.products.append(product)
        _write(_PRODUCTS_FILE, cat)
    return product


def update_product(product_id: str, patch: dict) -> DataProduct | None:
    with _lock:
        cat = _load_catalogue()
        for i, p in enumerate(cat.products):
            if p.id == product_id:
                merged = p.model_copy(update={**patch, "updated_at": _now()})
                cat.products[i] = merged
                _write(_PRODUCTS_FILE, cat)
                return merged
    return None


def delete_product(product_id: str) -> bool:
    with _lock:
        cat = _load_catalogue()
        before = len(cat.products)
        cat.products = [p for p in cat.products if p.id != product_id]
        if len(cat.products) == before:
            return False
        _write(_PRODUCTS_FILE, cat)
    return True


# --- request operations --------------------------------------------------


def list_requests(
    *, product_id: str | None = None, status: RequestStatus | None = None
) -> list[AccessRequest]:
    reqs = _load_requests().requests
    if product_id is not None:
        reqs = [r for r in reqs if r.product_id == product_id]
    if status is not None:
        reqs = [r for r in reqs if r.status == status]
    # Newest first — an approval inbox reads top-down.
    return sorted(reqs, key=lambda r: r.created_at, reverse=True)


def get_request(request_id: str) -> AccessRequest | None:
    return next((r for r in _load_requests().requests if r.id == request_id), None)


def create_request(request: AccessRequest) -> AccessRequest:
    with _lock:
        store = _load_requests()
        if not request.id:
            request.id = _new_id("req")
        request.created_at = _now()
        request.status = "pending"
        store.requests.append(request)
        _write(_REQUESTS_FILE, store)
    return request


def save_request(request: AccessRequest) -> AccessRequest:
    """Persist a mutated request (e.g. after a decision)."""
    with _lock:
        store = _load_requests()
        for i, r in enumerate(store.requests):
            if r.id == request.id:
                store.requests[i] = request
                _write(_REQUESTS_FILE, store)
                return request
        # Not found: treat as an append so a caller is never silently dropped.
        store.requests.append(request)
        _write(_REQUESTS_FILE, store)
    return request
