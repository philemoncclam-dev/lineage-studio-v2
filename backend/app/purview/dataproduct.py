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
from typing import Any, Iterable, Literal, Mapping

from ..models import LineageGraph
from .client import PurviewClient, PurviewError
from .writer import WriteSession, WriteResult

#: Governance-domain, data-product and data-asset operations all live here.
#: `dataAssets` and its relationships only exist from this version onwards —
#: the first preview (2025-09-15) has no data-asset API at all.
UC_API_VERSION = "2026-03-20-preview"

#: `entityType` is a required query parameter on relationship calls, and the
#: service spells the enum in upper case.
ENTITY_TYPE_DATA_ASSET = "DATAASSET"

# Title case, not upper: this is how the service echoes the value back, and the
# swagger's enum casing is not what the create endpoint accepts.
Status = Literal["Draft", "Published", "Expired"]


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
    #: Parent domain id when this is a sub-domain. Purview exposes the hierarchy
    #: through this field; a top-level domain leaves it None.
    parent_id: str | None = None


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
        parent_id=raw.get("parentId") or raw.get("parentDomain"),
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

    A just-created product 404s here for a while before it becomes queryable.
    That means "no assets related yet", which is exactly what an empty list
    says, so it is not an error — treating it as one breaks the common path of
    creating a product and filling it in the same request.
    """
    try:
        payload = client.request(
            "GET",
            _uc(
                f"/dataProducts/{data_product_id}/relationships",
                entityType=ENTITY_TYPE_DATA_ASSET,
            ),
        )
    except PurviewError:
        return []
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
    owner_ids: Iterable[str],
    *,
    description: str | None = None,
    product_type: str = "Analytical",
    status: Status = "Draft",
    data_product_id: str | None = None,
) -> str:
    """Queue creation of a data product and return the id we proposed.

    The returned id is only good for previewing. Despite `id` being accepted in
    the create body, the service assigns its own and returns it in the response
    — linking assets against the proposed id 404s with "DataProduct does not
    exist" even though the product was created. Callers that apply must read
    the id back from the response; see `created_product_id`.

    `owner_ids` are Entra object ids. At least one is required: the service
    rejects a create with no owner contact (`DataCatalogInvalidEntity`), which
    the swagger does not mark as required — it was found by being refused.
    """
    product_id = data_product_id or str(uuid.uuid4())
    owners = [{"id": oid, "description": "Lineage Studio"} for oid in owner_ids if oid]
    if not owners:
        raise ValueError("a data product needs at least one owner contact")
    body: dict[str, Any] = {
        "id": product_id,
        "name": name,
        "domain": domain_id,
        "type": product_type,
        "status": status,
        "contacts": {"owner": owners},
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


def created_product_id(result: WriteResult, proposed: str) -> str:
    """The id the service actually gave a product, falling back to `proposed`.

    On a dry run there is no response to read, so the proposed id stands in and
    the preview remains coherent.
    """
    for response in result.responses:
        if response.get("id"):
            return str(response["id"])
    return proposed


def queue_asset_onboarding(
    session: WriteSession, datamap_guid: str, name: str | None = None
) -> None:
    """Queue onboarding of a data-map entity as a Unified Catalog asset.

    The new asset's catalog id comes back in the response and cannot be known
    in advance, so linking it to a product is a separate, later step.

    Three fields the swagger does not present as required, all established by
    being refused:

      * `name` and `type` are mandatory. `type` accepts only ADLSGen2Path,
        AzureSqlTable or General — none of the data-map entity types — so
        Fabric tables and views are all General.
      * `source.type` is a *different* enum (DataMap / PurviewDataMap) and
        omitting it creates an asset with no link back to the data map, which
        looks like success and is not what anyone wants.

    `name` is required but not authoritative: the service replaces it with the
    data-map entity's real name, so the caller's value only matters when the
    lookup somehow yields nothing.
    """
    session.add(
        "POST",
        _uc("/dataAssets"),
        {
            "name": name or datamap_guid,
            "type": "General",
            "source": {"assetId": datamap_guid, "type": "DataMap"},
        },
        describes=f"onboard data-map asset {name or datamap_guid} into the catalog",
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
    names: Mapping[str, str] | None = None,
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
            queue_asset_onboarding(onboarding, guid, (names or {}).get(guid))
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
