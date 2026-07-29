"""Lineage traversal — the query engine behind the model assistant.

The assistant's whole design rests on the walk being computed rather than
reasoned about, so these tests are the ones that matter: if a path here is
wrong, an LLM will report it fluently and confidently.

The fixture is the medallion shape the sandbox actually produces:

    Landing/Files/orders/*.csv ─┐
                                ├─> Bronze/bronze_orders ─> Silver/silver_orders ─> Gold/gold_ltv
    Bronze/dim_customers ───────┘

with column edges on the bronze→silver→gold chain, and only a table-level edge
into bronze — which is exactly what a file source or a DataFrame notebook gives.
"""

from __future__ import annotations

from app.chat.graph import (
    build_index,
    describe_entity,
    find_entity,
    trace_downstream,
    trace_upstream,
)
from app.chat.model import Attribute, LineageModel


def _model() -> LineageModel:
    return LineageModel.model_validate(
        {
            "id": "m1",
            "name": "Medallion",
            "layers": [
                {
                    "id": "L_land",
                    "name": "Landing",
                    "objects": [{"id": "o_file", "name": "Files/orders/*.csv", "children": []}],
                },
                {
                    "id": "L_bronze",
                    "name": "Bronze",
                    "objects": [
                        {
                            "id": "o_bronze",
                            "name": "bronze_orders",
                            "children": [
                                {"id": "a_b_amount", "name": "amount", "children": []},
                                {"id": "a_b_cust", "name": "customer_id", "children": []},
                            ],
                        },
                        {
                            "id": "o_dim",
                            "name": "dim_customers",
                            "children": [{"id": "a_d_region", "name": "region", "children": []}],
                        },
                    ],
                },
                {
                    "id": "L_silver",
                    "name": "Silver",
                    "objects": [
                        {
                            "id": "o_silver",
                            "name": "silver_orders",
                            "children": [
                                {"id": "a_s_amt", "name": "amount_usd", "children": []},
                                {"id": "a_s_region", "name": "region", "children": []},
                            ],
                        }
                    ],
                },
                {
                    "id": "L_gold",
                    "name": "Gold",
                    "objects": [
                        {
                            "id": "o_gold",
                            "name": "gold_ltv",
                            "children": [{"id": "a_g_ltv", "name": "ltv", "children": []}],
                        }
                    ],
                },
            ],
            "transitions": [
                # Table level only into bronze — a file has no columns to trace.
                {"id": "t_file", "source": "o_file", "target": "o_bronze"},
                # Column level through the warehouse.
                {"id": "t1", "source": "a_b_amount", "target": "a_s_amt"},
                {"id": "t2", "source": "a_d_region", "target": "a_s_region"},
                {"id": "t3", "source": "a_s_amt", "target": "a_g_ltv"},
                {"id": "t4", "source": "a_s_region", "target": "a_g_ltv"},
            ],
            "properties": {
                "a_b_amount": {"Data type": "double"},
                "t1": {"Transform": "amount * 1.1", "Source": "Fabric sandbox", "Via": "enrich"},
                "t3": {"Transform": "SUM(amount_usd)", "Source": "Fabric sandbox"},
                # t2 and t4 carry nothing — hand-drawn.
            },
        }
    )


# --- the question the assistant exists to answer ----------------------------


def test_traces_a_column_from_bronze_to_gold():
    result = trace_downstream(_model(), "a_b_amount", to_layer="Gold")
    assert result.level == "attribute"
    assert len(result.paths) == 1
    hops = result.paths[0].hops
    assert [(h.source.name, h.target.name) for h in hops] == [
        ("amount", "amount_usd"),
        ("amount_usd", "ltv"),
    ]


def test_each_hop_carries_the_expression_that_produced_it():
    """Without this the answer says data moved, not what happened to it."""
    hops = trace_downstream(_model(), "a_b_amount", to_layer="Gold").paths[0].hops
    assert [h.transform for h in hops] == ["amount * 1.1", "SUM(amount_usd)"]


def test_stops_at_the_target_layer_rather_than_running_past_it():
    result = trace_downstream(_model(), "a_b_amount", to_layer="Silver")
    assert len(result.paths[0].hops) == 1
    assert result.paths[0].hops[0].target.name == "amount_usd"


def test_upstream_finds_every_contributor_to_a_gold_column():
    result = trace_upstream(_model(), "a_g_ltv")
    starts = {p.hops[-1].source.name for p in result.paths}
    assert starts == {"amount", "region"}


def test_upstream_reports_each_edge_in_its_own_direction():
    """Walking against the arrows must not print them backwards — a transform
    reported on a flipped edge reads as applying the wrong way round."""
    result = trace_upstream(_model(), "a_g_ltv")
    for path in result.paths:
        for hop in path.hops:
            assert (hop.source.name, hop.target.name) != ("ltv", "amount_usd")
    first = result.paths[0].hops[0]
    assert (first.source.name, first.target.name) == ("amount_usd", "ltv")


# --- provenance: derived vs hand-authored -----------------------------------


def test_marks_hand_drawn_edges_as_not_derived():
    """The distinction that keeps a hand-maintained model honest. A consumer
    that ignores it reports a stale hand-drawn claim as verified fact.

    Keyed by transition id, not by endpoint names: `region -> region` is a real
    pair in this fixture (both layers name the column the same), so matching on
    names would silently compare the wrong edge.
    """
    result = trace_upstream(_model(), "a_g_ltv")
    by_id = {h.transition_id: h for p in result.paths for h in p.hops}

    # t1 came from the sandbox; t2 was drawn by hand.
    assert by_id["t1"].derived is True
    assert by_id["t1"].source_of_claim == "Fabric sandbox"
    assert by_id["t2"].derived is False
    assert by_id["t2"].source_of_claim is None


def test_via_records_the_step_that_produced_the_edge():
    hops = trace_downstream(_model(), "a_b_amount", to_layer="Silver").paths[0].hops
    assert hops[0].via == "enrich"


# --- the table-level fallback: the DataFrame case ---------------------------


def test_falls_back_to_table_level_when_a_column_has_no_column_lineage():
    """A DataFrame notebook yields table edges and no column edges. Returning
    "no path" there would be wrong — the answer exists, it is just coarser."""
    result = trace_upstream(_model(), "a_b_amount")
    assert result.level == "object"
    assert result.paths[0].hops[0].source.name == "Files/orders/*.csv"


def test_the_fallback_says_it_is_coarser():
    result = trace_upstream(_model(), "a_b_amount")
    assert "column-level" in (result.note or "")
    assert "TABLE-level" in (result.note or "")


def test_a_column_level_answer_carries_no_fallback_note():
    assert trace_downstream(_model(), "a_b_amount", to_layer="Gold").note is None


def test_reports_honestly_when_there_is_no_lineage_at_all():
    model = _model()
    model.transitions = []
    result = trace_downstream(model, "a_b_amount")
    assert result.paths == []
    assert "No downstream lineage" in (result.note or "")


# --- termination and bounds -------------------------------------------------


def test_a_cycle_terminates_instead_of_looping():
    model = _model()
    model.transitions.append(
        model.transitions[0].model_copy(update={"id": "t_loop", "source": "a_g_ltv", "target": "a_b_amount"})
    )
    result = trace_downstream(model, "a_b_amount", to_layer="Gold")
    assert len(result.paths) >= 1
    for path in result.paths:
        seen = [h.source.id for h in path.hops]
        assert len(seen) == len(set(seen))


def test_a_depth_bound_is_reported_rather_than_hidden():
    """Bronze->Gold is two hops; at a depth of one there is no answer, and the
    caller must be able to tell that from "there is no lineage"."""
    result = trace_downstream(_model(), "a_b_amount", to_layer="Gold", max_depth=1)
    assert result.paths == []
    assert result.truncated is True


def test_a_path_bound_is_reported_as_truncated():
    result = trace_upstream(_model(), "a_g_ltv", max_paths=1)
    assert len(result.paths) == 1
    assert result.truncated is True
    assert "not the complete set" in (result.note or "")


# --- finding the entity in the first place ----------------------------------


def test_finds_a_column_by_exact_name():
    hits = find_entity(_model(), "amount", kind="attribute")
    assert hits[0].name == "amount"
    assert hits[0].path == "Bronze / bronze_orders / amount"


def test_exact_matches_sort_before_substring_matches():
    """`amount` must not be buried under `amount_usd`."""
    names = [h.name for h in find_entity(_model(), "amount", kind="attribute")]
    assert names[0] == "amount"
    assert "amount_usd" in names


def test_same_named_columns_are_kept_apart_by_their_path():
    hits = find_entity(_model(), "region", kind="attribute")
    assert {h.path for h in hits} == {
        "Bronze / dim_customers / region",
        "Silver / silver_orders / region",
    }


def test_a_layer_filter_narrows_the_search():
    hits = find_entity(_model(), "region", kind="attribute", layer="Silver")
    assert len(hits) == 1
    assert hits[0].layer == "Silver"


# --- describe ---------------------------------------------------------------


def test_describe_separates_no_lineage_from_not_traced():
    detail = describe_entity(_model(), "a_b_cust")
    assert detail is not None
    assert detail.upstream_count == 0 and detail.downstream_count == 0


def test_describe_returns_the_property_bag_and_children():
    assert describe_entity(_model(), "a_b_amount").properties == {"Data type": "double"}
    assert {c.name for c in describe_entity(_model(), "o_bronze").children} == {
        "amount",
        "customer_id",
    }


def test_describe_is_none_for_an_unknown_id():
    assert describe_entity(_model(), "nope") is None


# --- shape rules the traversal depends on -----------------------------------


def test_columns_nested_in_a_group_are_indexed():
    """A Group IS an attribute with children — reading one level deep would
    lose every column inside one."""
    model = _model()
    model.layers[1].objects[0].children.append(
        Attribute(
            id="g1",
            name="audit",
            children=[Attribute(id="a_deep", name="loaded_at")],
        )
    )
    hits = find_entity(model, "loaded_at")
    assert hits[0].path == "Bronze / bronze_orders / audit / loaded_at"


def test_an_edge_to_a_deleted_entity_is_dropped_not_followed():
    """Properties outlive their entity by design, so a dangling endpoint is a
    real state — following it would walk into an entity with no name."""
    model = _model()
    model.transitions.append(
        model.transitions[0].model_copy(update={"id": "t_ghost", "source": "a_g_ltv", "target": "ghost"})
    )
    index = build_index(model)
    assert "t_ghost" not in index.edges
    assert trace_downstream(model, "a_g_ltv").paths == []


def test_a_search_limit_is_never_reported_as_an_absence_of_lineage():
    """The two are different answers and only one is a fact about the model.
    Collapsing them is how a search bound gets relayed as "no lineage exists"."""
    capped = trace_downstream(_model(), "a_b_amount", to_layer="Gold", max_depth=1)
    assert capped.truncated is True
    assert "does NOT mean none exists" in (capped.note or "")

    model = _model()
    model.transitions = []
    genuinely_absent = trace_downstream(model, "a_b_amount", to_layer="Gold")
    assert genuinely_absent.truncated is False
    assert "No downstream lineage" in (genuinely_absent.note or "")


def test_describe_entity_carries_the_transform_off_its_inbound_edge():
    """A false absence is worse than a missing answer.

    The expression lives on the TRANSITION, so `describe_entity` used to return
    properties without it — and a model told "one upstream source, no transform
    in the properties" reported the transform as NOT RECORDED. That tells
    someone their lineage is undocumented when it is documented one hop away.
    Caught by the eval: `transform_quoted` failed on exactly that sentence.
    """
    from app.chat.graph import describe_entity

    model = _model()
    detail = describe_entity(model, "a_g_ltv")
    assert detail is not None
    assert any("SUM" in t.upper() for t in detail.transforms), detail.transforms
