"""Deriving lineage from notebook code and shaping it for Atlas.

The GUIDs and the doubly-encoded `dbo%252F` qualified names are copied from the
live `Phil-purview-dev` catalog: name resolution is the crux of this path and
the encoding is exactly where it goes wrong.
"""

from __future__ import annotations

from app.models import LineageGraph, Node, NodeKind, NotebookSource
from app.purview.lineage_push import (
    notebook_lineage_entity,
    push_notebook_lineage,
    resolve_asset_names,
)

WS = "03e777db-4717-49bc-8ff3-7f63fe765f29"
LH = "1ccf6020-81c9-4943-b839-b6227e13c221"
LW = "19ad69c0-2444-4321-8f8e-7d20a65abc9e"
BASE = "https://app.fabric.microsoft.com/groups"


def _table(guid: str, name: str, qname: str) -> Node:
    return Node(
        id=guid,
        kind=NodeKind.TABLE,
        name=name,
        meta={"qualified_name": qname, "entity_type": "fabric_lakehouse_table"},
    )


ORDERS = _table("g-orders", "raw_orders", f"{BASE}/{WS}/lakehouses/{LH}/tables/dbo%252Fraw_orders")
CUSTOMERS = _table(
    "g-cust", "raw_customers", f"{BASE}/{WS}/lakehouses/{LH}/tables/dbo%252Fraw_customers"
)
VIEW = Node(
    id="g-view",
    kind=NodeKind.TABLE,
    name="vw_Sales",
    meta={
        "qualified_name": f"{BASE}/{WS}/lakewarehouses/{LW}/views/vw_Sales",
        "entity_type": "fabric_warehouse_view",
    },
)
NOTEBOOK = Node(
    id="g-nb",
    kind=NodeKind.NOTEBOOK,
    name="Notebook_1build_customer_ltv",
    meta={
        "qualified_name": f"{BASE}/{WS}/synapsenotebooks/62a89158-d7e8-43ba-b852-cd2897c72fc8",
        "entity_type": "fabric_synapse_notebook",
    },
)

BUILD_LTV = NotebookSource(
    name="Notebook_1build_customer_ltv",
    cells=[
        "o = spark.table('raw_orders')",
        "c = spark.sql('SELECT customer_id FROM raw_customers')",
        "df.write.mode('overwrite').saveAsTable('vw_Sales')",
    ],
)


def _graph() -> LineageGraph:
    return LineageGraph(nodes=[ORDERS, CUSTOMERS, VIEW, NOTEBOOK])


class RecordingClient:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str, dict]] = []

    def request(self, verb: str, path: str, **kwargs):
        self.sent.append((verb, path, kwargs.get("json")))
        return {"mutatedEntities": {"UPDATE": []}}


# --- name resolution ---------------------------------------------------------


def test_table_names_are_recovered_from_double_encoded_qualified_names():
    """`dbo%252Fraw_orders` needs two unquotes; one leaves the schema glued on."""
    assert resolve_asset_names([ORDERS, CUSTOMERS])["raw_orders"] == "g-orders"


def test_resolution_is_case_insensitive():
    """Code says `vw_sales`, the catalog says `vw_Sales`."""
    assert resolve_asset_names([VIEW]) == {"vw_sales": "g-view"}


def test_only_dataset_nodes_are_resolvable_targets():
    """A notebook is the process, never an input or an output of itself."""
    assert "notebook_1build_customer_ltv" not in resolve_asset_names(_graph().nodes)


def test_ambiguous_names_are_dropped_rather_than_guessed():
    """Two same-named tables cannot be told apart from notebook text alone."""
    other = _table("g-other", "raw_orders", f"{BASE}/{WS}/lakehouses/other/tables/dbo%252Fraw_orders")
    assert "raw_orders" not in resolve_asset_names([ORDERS, other])


# --- entity shape ------------------------------------------------------------


def test_reads_become_inputs_and_writes_become_outputs():
    entity = notebook_lineage_entity(NOTEBOOK, BUILD_LTV, resolve_asset_names(_graph().nodes))
    attrs = entity["attributes"]
    assert [r["guid"] for r in attrs["inputs"]] == ["g-cust", "g-orders"]
    assert [r["guid"] for r in attrs["outputs"]] == ["g-view"]


def test_the_notebook_entity_itself_is_the_process():
    """`fabric_synapse_notebook` inherits `Process`, so no synthetic node."""
    entity = notebook_lineage_entity(NOTEBOOK, BUILD_LTV, resolve_asset_names(_graph().nodes))
    assert entity["typeName"] == "fabric_synapse_notebook"
    assert entity["guid"] == NOTEBOOK.id
    assert entity["attributes"]["qualifiedName"] == NOTEBOOK.meta["qualified_name"]


def test_tables_absent_from_the_catalog_are_skipped():
    """A GUID-less reference cannot be expressed to Atlas at all."""
    source = NotebookSource(name="x", cells=["spark.table('not_in_catalog')", "spark.table('raw_orders')"])
    entity = notebook_lineage_entity(NOTEBOOK, source, resolve_asset_names(_graph().nodes))
    assert [r["guid"] for r in entity["attributes"]["inputs"]] == ["g-orders"]


def test_a_notebook_touching_nothing_known_queues_no_update():
    """Sending empty inputs/outputs would erase lineage set by another source."""
    source = NotebookSource(name="x", cells=["print('hello')"])
    assert notebook_lineage_entity(NOTEBOOK, source, resolve_asset_names(_graph().nodes)) is None


# --- the push ----------------------------------------------------------------


def test_push_is_a_dry_run_by_default():
    client = RecordingClient()
    result = push_notebook_lineage(_graph(), {NOTEBOOK.name: BUILD_LTV}, client=client)
    assert result.dry_run is True and client.sent == []
    assert result.ops[0].path == "/atlas/v2/entity"
    assert "2 input(s), 1 output(s)" in result.ops[0].describes


def test_notebooks_without_supplied_source_are_left_alone():
    """Fabric access may be refused per workspace; the rest must still push."""
    result = push_notebook_lineage(_graph(), {}, client=RecordingClient())
    assert result.ops == []


def test_the_queued_body_is_a_single_entity_update():
    result = push_notebook_lineage(_graph(), {NOTEBOOK.name: BUILD_LTV}, client=RecordingClient())
    body = result.ops[0].body
    assert set(body) == {"entity", "referredEntities"}
    assert body["entity"]["guid"] == "g-nb"
