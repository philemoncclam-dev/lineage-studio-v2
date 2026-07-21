"""Cataloguing Fabric assets into a Purview Unified Catalog data product.

The Unified Catalog is a **different data plane from the data map**. The data
map lives under `{endpoint}/datamap/api` (that is what `PurviewClient._base`
points at); governance domains, data products and their assets live under
`{endpoint}/datagovernance/catalog`, one level above the map. `PurviewClient`
is not ours to change, and every mutation has to go through `WriteSession`,
which sends via that same client — so rather than fork the transport, we hand
the client a path that walks back out of its base (`_uc`). Verified live
against `Phil-purview-dev`: the escaped path reaches the governance surface
(it answers with the governance plane's own errors), while a bogus governance
path answers 404 — so the route is genuinely resolving, not being swallowed.

Cataloguing a table is two hops, not one. A data-map GUID is not itself a
catalog asset: it must first be *onboarded* as a Unified Catalog `dataAsset`
that points back at the map entity, and only then can that asset be related to
a data product. `catalog_datamap_assets` does both, reusing an existing
onboarded asset where one is found so re-running is idempotent.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Iterable, Literal

from ..models import LineageGraph
from .client import PurviewClient
from .writer import WriteSession, WriteResult

#: Governance-domain, data-product and data-asset operations all live here.
#: `dataAssets` and its relationships only exist from this version onwards —
#: the first preview (2025-09-15) has no data-asset API at all.
UC_API_VERSION = "2026-03-20-preview"

#: `entityType` is a required query parameter on relationship calls, and the
#: service spells the enum in upper case.
ENTITY_TYPE_DATA_ASSET = "DATAASSET"

Status = Literal["DRAFT", "PUBLISHED", "EXPIRED"]


def _uc(path: str, **query: Any) -> str:
    """A Unified Catalog path expressed relative to the data-map base.

    `PurviewClient.request` concatenates `{endpoint}/datamap/api` with what it
    is given, so the two `..` segments are what let a governance call ride the
    existing authenticated client and the existing write gate.
    """
    params = {"api-version": UC_API_VERSION, **query}
    qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
    return f"/../../datagovernance/catalog{path}?{qs}"


# --- typed views over the catalog ---------------------------------------


@dataclass(frozen=True)
class GovernanceDomain:
    """A business domain — data products can only exist inside one."""

    id: str
    name: str
    type: str | None = None
    status: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class DataProduct:
    id: str
    name: str
    domain_id: str | None = None
    type: str | None = None
    status: str | None = None
    description: str | None = None
    asset_count: int | None = None


@dataclass(frozen=True)
class DataAssetRef:
    """A Unified Catalog asset and the data-map entity it was onboarded from.

    `source_asset_id` is the GUID our graph nodes carry in
    `meta["purview_guid"]`; `id` is the catalog's own identifier for it. The
    two are never interchangeable, and the relationship API wants the latter.
    """

    id: str
    source_asset_id: str | None = None
    name: str | None = None
    type: str | None = None


def _domain(raw: dict) -> GovernanceDomain:
    return GovernanceDomain(
        id=raw.get("id", ""),
        name=raw.get("name", ""),
        type=raw.get("type"),
        status=raw.get("status"),
        description=raw.get("description"),
    )


def _product(raw: dict) -> DataProduct:
    return DataProduct(
        id=raw.get("id", ""),
        name=raw.get("name", ""),
        domain_id=raw.get("domain"),
        type=raw.get("type"),
        status=raw.get("status"),
        description=raw.get("description"),
        asset_count=(raw.get("additionalProperties") or {}).get("assetCount"),
    )


def _asset(raw: dict) -> DataAssetRef:
    return DataAssetRef(
        id=raw.get("id", ""),
        source_asset_id=(raw.get("source") or {}).get("assetId"),
        name=raw.get("name"),
        type=raw.get("type"),
    )


# --- reads ---------------------------------------------------------------


def list_governance_domains(client: PurviewClient) -> list[GovernanceDomain]:
    """Every business domain the caller can see, newest page first."""
    payload = client.request("GET", _uc("/businessdomains"))
    return [_domain(d) for d in payload.get("value", [])]


def list_data_products(
    client: PurviewClient, domain_id: str | None = None
) -> list[DataProduct]:
    """Data products, optionally narrowed to one governance domain."""
    payload = client.request("GET", _uc("/dataProducts", domainId=domain_id))
    return [_product(p) for p in payload.get("value", [])]


def list_data_product_assets(
    client: PurviewClient, data_product_id: str
) -> list[str]:
    """Catalog asset ids already related to `data_product_id`.

    The relationship records carry only the related entity's id, so callers
    that need names or source GUIDs must resolve them separately — hence the
    plain list of ids rather than a half-populated `DataAssetRef`.
    """
    payload = client.request(
        "GET",
        _uc(
            f"/dataProducts/{data_product_id}/relationships",
            entityType=ENTITY_TYPE_DATA_ASSET,
        ),
    )
    return [r["entityId"] for r in payload.get("value", []) if r.get("entityId")]


def find_data_assets(
    client: PurviewClient, datamap_guids: Iterable[str]
) -> dict[str, DataAssetRef]:
    """Map data-map GUIDs to the catalog assets already onboarded from them.

    Anything absent from the result has never been onboarded and will need a
    `dataAssets` create before it can join a data product.
    """
    guids = [g for g in datamap_guids if g]
    if not guids:
        return {}
    payload = client.request(
        "POST", _uc("/dataAssets/query"), json={"sourceAssetIds": guids}
    )
    found = (_asset(a) for a in payload.get("value", []))
    return {a.source_asset_id: a for a in found if a.source_asset_id}


def graph_asset_guids(graph: LineageGraph) -> dict[str, str]:
    """Node id -> data-map GUID, for nodes the catalog actually knows about.

    Manually-ingested and parsed nodes have no `purview_guid` and cannot be
    catalogued; silently dropping them here keeps callers from having to
    special-case the mixed graph that the UI hands them.
    """
    return {
        node.id: node.meta["purview_guid"]
        for node in graph.nodes
        if (node.meta or {}).get("purview_guid")
    }


# --- writes --------------------------------------------------------------


def create_data_product(
    session: WriteSession,
    name: str,
    domain_id: str,
    *,
    description: str | None = None,
    product_type: str = "Analytical",
    status: Status = "DRAFT",
    data_product_id: str | None = None,
) -> str:
    """Queue creation of a data product and return the id it will be given.

    The service does not mint the id — `id` is a required field on the create
    body — so the caller can hold the id before anything is transmitted and
    queue the asset links against it in the same session. That is also what
    makes the dry run a complete preview of a multi-step catalogue operation
    rather than just its first step.
    """
    product_id = data_product_id or str(uuid.uuid4())
    body: dict[str, Any] = {
        "id": product_id,
        "name": name,
        "domain": domain_id,
        "type": product_type,
        "status": status,
    }
    if description:
        body["description"] = description
    session.add(
        "POST",
        _uc("/dataProducts"),
        body,
        describes=f"create data product {name!r} in domain {domain_id}",
    )
    return product_id


def queue_asset_onboarding(session: WriteSession, datamap_guid: str) -> None:
    """Queue onboarding of a data-map entity as a Unified Catalog asset.

    The new asset's catalog id comes back in the response and cannot be known
    in advance, so linking it to a product is a separate, later step.
    """
    session.add(
        "POST",
        _uc("/dataAssets"),
        {"source": {"assetId": datamap_guid}},
        describes=f"onboard data-map asset {datamap_guid} into the catalog",
    )


def queue_asset_link(
    session: WriteSession,
    data_product_id: str,
    asset_id: str,
    description: str | None = None,
) -> None:
    """Queue a relationship from a data product to an onboarded catalog asset."""
    body: dict[str, Any] = {"entityId": asset_id, "relationshipType": "Related"}
    if description:
        body["description"] = description
    session.add(
        "POST",
        _uc(
            f"/dataProducts/{data_product_id}/relationships",
            entityType=ENTITY_TYPE_DATA_ASSET,
        ),
        body,
        describes=f"add asset {asset_id} to data product {data_product_id}",
    )


def catalog_datamap_assets(
    client: PurviewClient,
    data_product_id: str,
    datamap_guids: Iterable[str],
    *,
    apply: bool = False,
) -> WriteResult:
    """Put data-map entities into a data product, onboarding them if needed.

    Onboarding and linking cannot share one session: the link needs the catalog
    id that only the onboarding response carries. So this runs onboarding
    first, harvests the ids, then runs the links. On a dry run there are no
    responses to harvest, so the returned result previews the onboarding calls
    plus links for whatever was already onboarded — an honest preview of a
    first-run catalogue, not an invented one.
    """
    guids = [g for g in datamap_guids if g]
    known = find_data_assets(client, guids)
    already = set(list_data_product_assets(client, data_product_id))

    onboarding = WriteSession(client, apply=apply)
    for guid in guids:
        if guid not in known:
            queue_asset_onboarding(onboarding, guid)
    result = onboarding.run()

    asset_ids = [known[g].id for g in guids if g in known]
    for response in result.responses:
        if response.get("id"):
            asset_ids.append(response["id"])

    linking = WriteSession(client, apply=apply)
    for asset_id in asset_ids:
        if asset_id not in already:
            queue_asset_link(linking, data_product_id, asset_id)
    links = linking.run()

    # One combined result: callers care whether the whole catalogue landed,
    # not which of the two internal round-trips a failure came from.
    result.ops.extend(links.ops)
    result.responses.extend(links.responses)
    result.errors.extend(links.errors)
    return result
