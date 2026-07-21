"""Unit tests for the Purview -> LineageGraph translation."""

from __future__ import annotations

from app.models import NodeKind
from app.purview.ingest import build_graph_from_purview, parse_fabric_qualified_name

from conftest import LH, LW, WS, FakePurviewClient


def _by_name(graph):
    return {n.name: n for n in graph.nodes}


def test_unmapped_types_are_dropped(fake_client):
    graph = build_graph_from_purview(fake_client)
    assert "Files" not in _by_name(graph)


def test_lakehouse_and_its_sql_endpoint_are_kept_apart(fake_client):
    """Same name, different GUIDs — merging them would orphan the views."""
    graph = build_graph_from_purview(fake_client)
    lakehouses = [n for n in graph.nodes if n.kind is NodeKind.LAKEHOUSE]
    assert sorted(n.id for n in lakehouses) == ["g-lh", "g-lw"]


def test_containment_resolves_regardless_of_search_order(fake_client):
    nodes = _by_name(build_graph_from_purview(fake_client))
    assert nodes["LH_Sales"].parent_id == "g-ws"
    assert nodes["raw_orders"].parent_id == "g-lh"
    assert nodes["WS_Demo"].parent_id is None


def test_view_parents_to_the_sql_endpoint_not_the_workspace(fake_client):
    """Regression: the `lakewarehouses` segment used to be unmatched."""
    nodes = _by_name(build_graph_from_purview(fake_client))
    assert nodes["vw_customer_ltv"].parent_id == "g-lw"


def test_view_columns_come_from_its_tabular_schema(fake_client):
    """Views carry no `columns` of their own — they hang off a schema entity."""
    nodes = _by_name(build_graph_from_purview(fake_client))
    cols = nodes["vw_customer_ltv"].columns
    assert [(c.name, c.data_type) for c in cols] == [("ltv", "decimal")]


def test_column_names_are_url_decoded(fake_client):
    nodes = _by_name(build_graph_from_purview(fake_client))
    assert [c.name for c in nodes["raw_orders"].columns] == ["order_id", "customer/id"]


def test_data_types_are_read_from_referred_entities(fake_client):
    nodes = _by_name(build_graph_from_purview(fake_client))
    assert [c.data_type for c in nodes["raw_orders"].columns] == ["int", None]


def test_lineage_is_only_fetched_for_tables(fake_client):
    """Twice per table: the endpoint rejects BOTH, so each direction is asked
    for separately. Workspaces and lakehouses are never queried."""
    build_graph_from_purview(fake_client)
    assert sorted(fake_client.lineage_calls) == [
        "g-orders",
        "g-orders",
        "g-view",
        "g-view",
    ]


def test_a_freshly_scanned_catalog_has_no_edges(fake_client):
    assert build_graph_from_purview(fake_client).edges == []


def test_relations_to_unkept_entities_are_skipped():
    client = FakePurviewClient(
        relations=[
            {"fromEntityId": "g-orders", "toEntityId": "g-view"},
            {"fromEntityId": "g-orders", "toEntityId": "g-view"},  # duplicate
            {"fromEntityId": "g-orders", "toEntityId": "g-process"},  # not a node
        ]
    )
    edges = build_graph_from_purview(client).edges
    assert [(e.source, e.target, e.kind) for e in edges] == [
        ("g-orders", "g-view", "derives")
    ]


def test_parse_qualified_name():
    parsed = parse_fabric_qualified_name(
        f"https://app.fabric.microsoft.com/groups/{WS}/lakehouses/{LH}/tables/x"
    )
    assert parsed == {"workspace_id": WS, "container_id": LH}
    view = parse_fabric_qualified_name(
        f"https://app.fabric.microsoft.com/groups/{WS}/lakewarehouses/{LW}/views/v"
    )
    assert view == {"workspace_id": WS, "container_id": LW}
    assert parse_fabric_qualified_name("") == {
        "workspace_id": None,
        "container_id": None,
    }
