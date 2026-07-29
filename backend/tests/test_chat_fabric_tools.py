"""Reaching past the model into live Fabric.

No live tenant here: `FabricClient` and the Delta-schema read are substituted,
so what these cover is the judgement layer on top of them — which is where the
damage would be. Three failures matter more than the happy path:

  - an unreadable schema diffed as an empty one, which reports every column in
    a healthy model as dropped;
  - an ambiguous table name compared against whichever match came first, which
    reports drift that is not there;
  - Fabric being unreachable taking the whole conversation down with it.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.chat import fabric_tools
from app.chat.fabric_tools import FabricUnavailable, compare, search
from app.chat.model import LineageModel
from app.chat.tools import TOOLS, run_tool
from app.sandbox.protocol import ColumnSchema


def _model() -> LineageModel:
    return LineageModel.model_validate(
        {
            "id": "m1",
            "name": "Medallion",
            "layers": [
                {
                    "id": "L_silver",
                    "name": "Silver",
                    "objects": [
                        {
                            "id": "o_orders",
                            "name": "orders",
                            "children": [
                                {"id": "a_id", "name": "order_id", "children": []},
                                {"id": "a_amt", "name": "Amount", "children": []},
                                {"id": "a_gone", "name": "legacy_flag", "children": []},
                                {
                                    # A group — a folder, not a column. It must
                                    # not be diffed against the Delta schema.
                                    "id": "g",
                                    "name": "audit",
                                    "children": [{"id": "a_ts", "name": "loaded_at", "children": []}],
                                },
                            ],
                        }
                    ],
                }
            ],
            "transitions": [],
        }
    )


CATALOG = [
    {"kind": "workspace", "id": "w1", "name": "Analytics", "workspace_id": "w1", "workspace_name": "Analytics"},
    {
        "kind": "table",
        "id": "orders",
        "name": "orders",
        "workspace_id": "w1",
        "workspace_name": "Analytics",
        "lakehouse_id": "lh1",
        "lakehouse_name": "Silver",
    },
    {
        "kind": "notebook",
        "id": "nb1",
        "name": "build_orders",
        "workspace_id": "w1",
        "workspace_name": "Analytics",
    },
]

LIVE_COLUMNS = [
    ColumnSchema(name="order_id", type="bigint"),
    # Case differs from the model's `Amount` — a naming inconsistency, not drift.
    ColumnSchema(name="amount", type="double"),
    ColumnSchema(name="loaded_at", type="timestamp"),
    ColumnSchema(name="currency", type="string"),
]


@pytest.fixture(autouse=True)
def _clean_cache():
    fabric_tools.reset_catalog_cache()
    yield
    fabric_tools.reset_catalog_cache()


@pytest.fixture
def fabric(monkeypatch):
    """A tenant that answers, with knobs for each way it can fail."""
    state: dict[str, Any] = {"catalog": CATALOG, "columns": LIVE_COLUMNS, "failures": []}

    monkeypatch.setattr(
        fabric_tools, "catalog", lambda caller=None, force=False: state["catalog"]
    )
    monkeypatch.setattr(fabric_tools, "_client", lambda caller=None: object())
    monkeypatch.setattr(
        fabric_tools, "table_dirs_for_lakehouse", lambda *a, **k: {"orders": "Tables/orders"}
    )

    def _schema(_client, _workspace, _dir, report=None):
        if report is not None:
            report.failures.extend(state["failures"])
        return state["columns"]

    monkeypatch.setattr(fabric_tools, "fetch_table_schema", _schema)
    return state


# --- search -----------------------------------------------------------------


def test_search_finds_a_table_and_carries_the_ids_the_other_tools_need(fabric):
    hits = search("orders", kind="table")
    assert hits["count"] == 1
    assert hits["matches"][0]["workspace_id"] == "w1"
    assert hits["matches"][0]["lakehouse_id"] == "lh1"


def test_search_says_when_nothing_matches(fabric):
    """A bare empty list reads as a failed call rather than an answer."""
    assert "Nothing in Fabric matches" in (search("nope")["note"] or "")


# --- comparison: the point of the whole module ------------------------------


def test_a_column_in_the_model_but_not_in_fabric_is_reported_as_drift(fabric):
    result = compare(_model(), "o_orders")
    assert result["only_in_model"] == ["legacy_flag"]


def test_a_column_in_fabric_but_not_in_the_model_is_reported_too(fabric):
    assert compare(_model(), "o_orders")["only_in_fabric"] == ["currency"]


def test_a_case_only_difference_is_not_reported_as_drift(fabric):
    """Delta preserves case and authors rarely do. Reporting `Amount` vs
    `amount` as a dropped column buries the findings that are real."""
    result = compare(_model(), "o_orders")
    assert "Amount" in result["matching"]
    assert "Amount" not in result["only_in_model"]


def test_a_group_is_not_diffed_as_a_column(fabric):
    """No Delta schema has a folder in it, so counting one would show drift
    against every Fabric table in existence."""
    result = compare(_model(), "o_orders")
    assert "audit" not in result["only_in_model"]
    # The column nested inside it is still compared.
    assert "loaded_at" in result["matching"]


def test_an_unreadable_schema_refuses_to_diff_rather_than_diffing_against_empty(fabric):
    """THE trap. `[]` from OneLake means 'refused' at least as often as it
    means 'no columns', and diffing against it reports every column in a
    perfectly healthy model as dropped."""
    fabric["columns"] = []
    fabric["failures"] = ["Tables/orders: _delta_log not listable — 403"]

    result = compare(_model(), "o_orders")
    assert result["comparable"] is False
    assert "only_in_model" not in result
    assert "could not be read" in result["note"]
    assert "403" in result["note"]


def test_an_ambiguous_table_name_asks_rather_than_picking_one(fabric):
    """Two lakehouses with an `orders` each. Comparing against whichever came
    first reports drift that is not there."""
    fabric["catalog"] = CATALOG + [
        {
            "kind": "table",
            "id": "orders",
            "name": "orders",
            "workspace_id": "w2",
            "workspace_name": "Other",
            "lakehouse_id": "lh2",
            "lakehouse_name": "Bronze",
        }
    ]
    result = compare(_model(), "o_orders")
    assert result["ambiguous"] is True
    assert len(result["candidates"]) == 2
    assert "only_in_model" not in result


def test_explicit_ids_resolve_an_ambiguous_name(fabric):
    fabric["catalog"] = CATALOG + [
        {
            "kind": "table",
            "id": "orders",
            "name": "orders",
            "workspace_id": "w2",
            "workspace_name": "Other",
            "lakehouse_id": "lh2",
            "lakehouse_name": "Bronze",
        }
    ]
    result = compare(_model(), "o_orders", workspace_id="w1", lakehouse_id="lh1")
    assert result["comparable"] is True


def test_a_table_absent_from_fabric_is_stated_as_absent(fabric):
    fabric["catalog"] = [CATALOG[0]]
    result = compare(_model(), "o_orders")
    assert result["found_in_fabric"] is False
    assert "dropped" in result["note"]


def test_only_an_object_can_be_compared(fabric):
    """A column has no Fabric table to diff against, and silently comparing its
    parent would answer a question nobody asked."""
    assert "only an object" in compare(_model(), "a_id")["error"]


def test_an_unknown_entity_is_reported(fabric):
    assert "No entity with id" in compare(_model(), "nope")["error"]


def test_in_sync_is_stated_explicitly(fabric):
    fabric["columns"] = [
        ColumnSchema(name="order_id", type="bigint"),
        ColumnSchema(name="amount", type="double"),
        ColumnSchema(name="legacy_flag", type="boolean"),
        ColumnSchema(name="loaded_at", type="timestamp"),
    ]
    assert compare(_model(), "o_orders")["in_sync"] is True


# --- unreachable Fabric -----------------------------------------------------


def test_unreachable_fabric_is_answered_not_raised(monkeypatch):
    """A Fabric question on a backend with no Fabric credentials should be
    answered with 'I can't reach Fabric', not lose the conversation to a 503."""

    def _boom():
        raise FabricUnavailable("Fabric is not configured")

    monkeypatch.setattr(fabric_tools, "_client", _boom)
    monkeypatch.setattr(fabric_tools, "catalog", lambda caller=None, force=False: _boom())

    result = run_tool(_model(), "fabric_search", {"name": "orders"})
    assert result["fabric_available"] is False
    assert "not configured" in result["error"]


def test_a_missing_required_argument_is_a_type_error_the_loop_can_report(fabric):
    with pytest.raises(TypeError):
        run_tool(_model(), "fabric_table_schema", {"workspace_id": "w1"})


# --- wiring -----------------------------------------------------------------


def test_the_fabric_tools_are_offered_to_the_assistant():
    names = {t["name"] for t in TOOLS}
    assert {"fabric_search", "fabric_table_schema", "compare_to_fabric"} <= names


def test_model_reading_tools_come_first_in_the_tool_list():
    """A question is about the authored model unless it says otherwise, and
    ordering is one of the cheap nudges toward that."""
    names = [t["name"] for t in TOOLS]
    assert names.index("find_entity") < names.index("fabric_search")
