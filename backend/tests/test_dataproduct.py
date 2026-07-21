"""Unified Catalog data-product cataloguing.

Offline: a fake client records the paths and bodies that would go to Purview,
so the shapes stay pinned to the swagger even on a machine with no credentials.
"""

from __future__ import annotations

import pytest

from app import config
from app.models import LineageGraph, Node, NodeKind
from app.purview import dataproduct as dp
from app.purview.writer import WriteSession


class FakeUCClient:
    """Answers the Unified Catalog reads and records every write."""

    def __init__(self, assets=None, relationships=None, created_id="uc-new") -> None:
        self.assets = assets or []
        self.relationships = relationships or []
        self.created_id = created_id
        self.calls: list[tuple[str, str, dict | None]] = []

    def request(self, verb: str, path: str, **kwargs):
        body = kwargs.get("json")
        self.calls.append((verb, path, body))
        if "/dataAssets/query" in path:
            return {"value": self.assets}
        if "/relationships" in path and verb == "GET":
            return {"value": self.relationships}
        if "/businessdomains" in path:
            return {
                "value": [
                    {"id": "d-1", "name": "Sales", "type": "FunctionalUnit",
                     "status": "PUBLISHED", "description": "Sales domain"}
                ]
            }
        if "/dataProducts" in path and verb == "GET":
            return {
                "value": [
                    {"id": "p-1", "name": "Orders", "domain": "d-1",
                     "type": "Analytical", "status": "DRAFT",
                     "additionalProperties": {"assetCount": 3}}
                ]
            }
        if "/dataAssets" in path and verb == "POST":
            return {"id": self.created_id, "source": {"assetId": "dm-2"}}
        return {}


@pytest.fixture
def allow_write(monkeypatch):
    """Turn the deployment gate on without touching the real .env."""
    settings = config.get_settings().model_copy(update={"purview_allow_write": True})
    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setattr("app.purview.writer.get_settings", lambda: settings)


def test_paths_escape_the_data_map_base():
    """The client's base is `/datamap/api`; governance lives above it."""
    path = dp._uc("/dataProducts")
    assert path.startswith("/../../datagovernance/catalog/dataProducts?")
    assert f"api-version={dp.UC_API_VERSION}" in path


def test_none_valued_query_params_are_omitted():
    """`domainId=None` must not become a literal `domainId=None` filter."""
    assert "domainId" not in dp._uc("/dataProducts", domainId=None)
    assert "domainId=d-1" in dp._uc("/dataProducts", domainId="d-1")


def test_domains_and_products_are_typed():
    client = FakeUCClient()
    assert dp.list_governance_domains(client)[0].name == "Sales"
    product = dp.list_data_products(client, domain_id="d-1")[0]
    # The wire field is `domain`, not `domainId`, and the count is nested.
    assert (product.domain_id, product.asset_count) == ("d-1", 3)


def test_listing_product_assets_asks_only_for_data_assets():
    client = FakeUCClient(relationships=[{"entityId": "uc-1"}, {"noEntity": True}])
    assert dp.list_data_product_assets(client, "p-1") == ["uc-1"]
    assert f"entityType={dp.ENTITY_TYPE_DATA_ASSET}" in client.calls[0][1]


def test_find_data_assets_keys_by_the_data_map_guid():
    """Callers hold data-map GUIDs; the relationship API wants catalog ids."""
    client = FakeUCClient(assets=[{"id": "uc-1", "source": {"assetId": "dm-1"}}])
    found = dp.find_data_assets(client, ["dm-1", "dm-2"])
    assert found["dm-1"].id == "uc-1" and "dm-2" not in found
    assert client.calls[0][2] == {"sourceAssetIds": ["dm-1", "dm-2"]}


def test_no_guids_means_no_round_trip():
    client = FakeUCClient()
    assert dp.find_data_assets(client, []) == {}
    assert client.calls == []


def test_create_returns_the_id_it_queued():
    """The id is client-minted, so links can be queued before anything sends."""
    session = WriteSession(FakeUCClient())
    product_id = dp.create_data_product(
        session, "LineageStudio Test Product", "d-1", description="hi"
    )
    op = session.run().ops[0]
    assert op.body["id"] == product_id
    assert op.body["domain"] == "d-1" and op.body["status"] == "DRAFT"


def test_create_omits_an_empty_description():
    session = WriteSession(FakeUCClient())
    dp.create_data_product(session, "P", "d-1")
    assert "description" not in session.run().ops[0].body


def test_cataloguing_onboards_only_unknown_guids(allow_write):
    client = FakeUCClient(assets=[{"id": "uc-1", "source": {"assetId": "dm-1"}}])
    result = dp.catalog_datamap_assets(client, "p-1", ["dm-1", "dm-2"], apply=True)

    onboarded = [o for o in result.ops if o.path.endswith(f"api-version={dp.UC_API_VERSION}")
                 and "/dataAssets?" in o.path]
    assert [o.body for o in onboarded] == [{"source": {"assetId": "dm-2"}}]

    linked = [o.body["entityId"] for o in result.ops if "/relationships" in o.path]
    # `uc-1` was already onboarded; `uc-new` is the id the create call returned.
    assert sorted(linked) == ["uc-1", "uc-new"]


def test_existing_members_are_not_linked_twice(allow_write):
    client = FakeUCClient(
        assets=[{"id": "uc-1", "source": {"assetId": "dm-1"}}],
        relationships=[{"entityId": "uc-1"}],
    )
    result = dp.catalog_datamap_assets(client, "p-1", ["dm-1"], apply=True)
    assert [o for o in result.ops if "/relationships" in o.path] == []


def test_a_dry_run_transmits_nothing():
    client = FakeUCClient(assets=[{"id": "uc-1", "source": {"assetId": "dm-1"}}])
    result = dp.catalog_datamap_assets(client, "p-1", ["dm-1", "dm-2"])
    assert result.dry_run is True
    assert [v for v, _, _ in client.calls] == ["POST", "GET"]  # the two reads only
    assert len(result.ops) == 2  # onboard dm-2, link uc-1


def test_only_nodes_with_a_purview_guid_can_be_catalogued():
    """Parsed and manually-ingested nodes have no catalog identity at all."""
    graph = LineageGraph(
        nodes=[
            Node(id="n1", kind=NodeKind.TABLE, name="raw_orders",
                 meta={"purview_guid": "dm-1"}),
            Node(id="n2", kind=NodeKind.TABLE, name="parsed_only"),
        ]
    )
    assert dp.graph_asset_guids(graph) == {"n1": "dm-1"}
