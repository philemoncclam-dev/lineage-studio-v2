"""Whole-model scans — coverage, gaps, and impact.

These are the questions that start nowhere, and each one has a wrong obvious
implementation that reads as plausible:

  - counting a leaf column as a lineage gap, which buries the real gaps;
  - reporting impact through the capped path search, which understates it;
  - counting only top-level attributes, which flatters coverage;
  - reporting one transition total, which hides how much of it is unverified.

The fixture carries all four traps: a grouped column, a leaf, a genuinely
orphaned column, a hand-drawn edge, a dangling edge, and a diamond that fans
out and rejoins (many paths, few entities).
"""

from __future__ import annotations

from app.chat.analysis import coverage, impact, unconnected
from app.chat.graph import trace_downstream
from app.chat.model import LineageModel


def _model() -> LineageModel:
    return LineageModel.model_validate(
        {
            "id": "m1",
            "name": "Medallion",
            "layers": [
                {
                    "id": "L_bronze",
                    "name": "Bronze",
                    "objects": [
                        {
                            "id": "o_bronze",
                            "name": "bronze_orders",
                            "children": [
                                {
                                    # A group: a column nested under it must
                                    # still be counted.
                                    "id": "g_money",
                                    "name": "money",
                                    "children": [
                                        {"id": "a_amount", "name": "amount", "children": []}
                                    ],
                                },
                                # Nothing at either end — the real gap.
                                {"id": "a_orphan", "name": "note", "children": []},
                            ],
                        }
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
                                {"id": "a_net", "name": "net", "children": []},
                                {"id": "a_tax", "name": "tax", "children": []},
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
                            # Inbound only — a leaf, NOT a gap.
                            "children": [{"id": "a_ltv", "name": "ltv", "children": []}],
                        }
                    ],
                },
            ],
            "transitions": [
                # A diamond: amount fans into net and tax, both rejoin at ltv.
                {"id": "t1", "source": "a_amount", "target": "a_net"},
                {"id": "t2", "source": "a_amount", "target": "a_tax"},
                {"id": "t3", "source": "a_net", "target": "a_ltv"},
                {"id": "t4", "source": "a_tax", "target": "a_ltv"},
                # An edge to an entity that no longer exists.
                {"id": "t_dead", "source": "a_amount", "target": "a_deleted"},
            ],
            "properties": {
                "t1": {"Source": "Fabric sandbox"},
                "t2": {"Source": "Fabric sandbox"},
                "t3": {"Source": "Fabric sandbox"},
                # t4 carries nothing — hand-drawn.
            },
        }
    )


# --- gaps -------------------------------------------------------------------


def test_a_column_with_nothing_at_either_end_is_the_gap():
    result = unconnected(_model(), kind="attribute")
    assert [e.name for e in result.entities] == ["note"]
    assert result.count == 1


def test_a_leaf_column_is_not_reported_as_a_gap():
    """`ltv` has an inbound edge and no outbound one. Calling that a gap buries
    the real ones under every terminal column in Gold."""
    names = {e.name for e in unconnected(_model(), kind="attribute").entities}
    assert "ltv" not in names


def test_a_group_is_not_reported_as_a_gap():
    """`money` is a folder over columns, not data. Groups rarely carry edges of
    their own, so reporting them would drown the columns that are the answer —
    the same reason layers are excluded."""
    names = {e.name for e in unconnected(_model(), kind="attribute").entities}
    assert "money" not in names


def test_layers_are_left_out_of_an_unfiltered_scan():
    """Layer-to-layer transitions are legal but rare, so including layers would
    report every layer in the model as a gap and drown the real answer."""
    assert all(e.kind != "layer" for e in unconnected(_model()).entities)
    # Asking for them explicitly still works.
    assert unconnected(_model(), kind="layer").count == 3


def test_a_scan_can_be_narrowed_to_one_layer():
    assert unconnected(_model(), kind="attribute", layer="Gold").count == 0
    assert unconnected(_model(), kind="attribute", layer="Bronze").count == 1


def test_a_capped_list_reports_the_true_total_and_says_it_was_capped():
    result = unconnected(_model(), limit=1)
    assert result.truncated is True
    assert len(result.entities) == 1
    assert result.count > 1
    assert "of" in (result.note or "")


def test_no_gaps_is_stated_rather_than_returned_as_a_bare_empty_list():
    """An empty list reads as a failed scan; the assistant then says nothing."""
    result = unconnected(_model(), kind="attribute", layer="Silver")
    assert result.count == 0
    assert "at least one transition" in (result.note or "")


# --- impact -----------------------------------------------------------------


def test_impact_counts_distinct_entities_not_paths():
    """The diamond has two paths to ltv but only three affected entities. A
    path count would double-count ltv and overstate the blast radius."""
    result = impact(_model(), "a_amount")
    assert result.count == 3
    assert {e.name for e in result.reached} == {"net", "tax", "ltv"}


def test_impact_is_complete_where_the_path_search_would_truncate():
    """This is why impact exists as its own operation. With the path search
    capped low, the walk truncates; reachability still answers exactly."""
    capped = trace_downstream(_model(), "a_amount", max_paths=1)
    assert capped.truncated is True
    assert impact(_model(), "a_amount").truncated is False


def test_impact_tallies_by_layer():
    assert impact(_model(), "a_amount").by_layer == {"Silver": 2, "Gold": 1}


def test_upstream_impact_finds_every_contributor():
    result = impact(_model(), "a_ltv", direction="upstream")
    assert {e.name for e in result.reached} == {"net", "tax", "amount"}


def test_the_starting_entity_is_not_counted_as_its_own_impact():
    assert all(e.id != "a_amount" for e in impact(_model(), "a_amount").reached)


def test_a_dangling_edge_is_not_followed_into_a_nameless_entity():
    """`a_deleted` no longer exists. Walking into it would put an entity with
    no name and no layer in the blast radius."""
    assert all(e.name for e in impact(_model(), "a_amount").reached)


def test_nothing_downstream_is_stated_plainly():
    result = impact(_model(), "a_ltv")
    assert result.count == 0
    assert "Nothing depends on" in (result.note or "")


def test_the_layer_tally_stays_complete_when_the_listing_is_capped():
    """The tally is the answer; the list is illustration. Capping the number
    would understate the blast radius, which is the one direction that matters."""
    result = impact(_model(), "a_amount", limit=1)
    assert len(result.reached) == 1
    assert sum(result.by_layer.values()) == 3
    assert result.count == 3


def test_an_unknown_id_is_reported_rather_than_returning_an_empty_impact():
    """Empty would read as 'nothing depends on it' — a fact about the model."""
    assert "No entity with id" in (impact(_model(), "nope").note or "")


# --- coverage ---------------------------------------------------------------


def test_coverage_counts_columns_nested_inside_groups():
    """Counting only top-level attributes reports a better number than the
    model deserves — every grouped column silently vanishes from the total."""
    result = coverage(_model())
    bronze = next(layer for layer in result.layers if layer.layer == "Bronze")
    # amount (inside the group) and note — the group itself is not a column.
    assert bronze.attributes.total == 2


def test_coverage_agrees_with_the_gap_scan_about_what_a_column_is():
    """Both must exclude groups. If they disagree, the coverage figure and the
    list of gaps beneath it describe two different models."""
    model = _model()
    bronze = next(layer for layer in coverage(model).layers if layer.layer == "Bronze")
    gaps = unconnected(model, kind="attribute", layer="Bronze")
    assert bronze.attributes.without_lineage == gaps.count


def test_coverage_separates_traced_from_untraced():
    bronze = next(layer for layer in coverage(_model()).layers if layer.layer == "Bronze")
    assert bronze.attributes.with_lineage == 1  # amount
    assert bronze.attributes.without_lineage == 1  # note


def test_coverage_reports_hand_drawn_edges_separately_from_derived_ones():
    """One transition total lets a mostly-asserted model read as a traced one."""
    result = coverage(_model())
    assert result.derived_transitions == 3
    assert result.hand_drawn_transitions == 1


def test_coverage_surfaces_dangling_edges_that_every_walk_silently_drops():
    """They are invisible everywhere else — a model can look fine while a chunk
    of its lineage does nothing at all."""
    result = coverage(_model())
    assert result.dangling_transitions == 1
    # And they are excluded from the live total rather than inflating it.
    assert result.transitions == 4


def test_coverage_of_an_empty_model_does_not_divide_by_anything():
    result = coverage(LineageModel())
    assert result.objects.total == 0
    assert result.attributes.without_lineage == 0
