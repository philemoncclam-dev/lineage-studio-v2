"""Proposed edits — the write path that does not write.

Two properties matter more than any individual rule:

  1. Nothing here mutates a model. If validation ever gained a side effect, the
     approval gate would be decorative.
  2. A proposal that reaches the user is APPLICABLE. An unapplicable one puts an
     Apply button in front of somebody that either does nothing or does
     something other than the sentence beside it promised — which is worse than
     proposing nothing at all.

The rejection cases are therefore the substance of this file, not the edge of it.
"""

from __future__ import annotations

import pytest

from app.chat.assistant import MAX_TOOL_ROUNDS, Message, ask
from app.chat.edits import MAX_EDITS, TOOLS, validate
from app.chat.model import LineageModel
from app.chat.tools import TOOLS as ALL_TOOLS
from app.chat.tools import run_tool
from tests.test_chat_assistant import _FakeClient, _Response, _text, _use


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
                            "name": "orders",
                            "children": [
                                {"id": "a_amount", "name": "amount", "children": []},
                                {"id": "a_note", "name": "note", "children": []},
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
                            "children": [{"id": "a_ltv", "name": "ltv", "children": []}],
                        }
                    ],
                },
            ],
            "transitions": [{"id": "t1", "source": "a_amount", "target": "a_ltv"}],
            "properties": {"a_amount": {"Data type": "double", "Tags": "pii"}},
        }
    )


def _edit(**kw):
    return {"describes": "because I said so", **kw}


# --- the gate ---------------------------------------------------------------


def test_validation_never_mutates_the_model():
    """If it did, the approval gate would be decorative."""
    model = _model()
    before = model.model_dump_json()
    validate(model, [_edit(kind="add_transition", source_id="a_note", target_id="a_ltv")])
    assert model.model_dump_json() == before


def test_the_tool_result_tells_the_model_nothing_was_applied():
    """Read as a success, the model reports the edits as done and the user is
    told their model changed when it did not."""
    result = run_tool(
        _model(),
        "propose_edits",
        {"edits": [_edit(kind="add_transition", source_id="a_note", target_id="a_ltv")]},
    )
    assert result["applied"] is False
    assert "NOTHING HAS BEEN CHANGED" in result["status"]


def test_accepted_proposals_travel_back_on_the_answer():
    client = _FakeClient(
        [
            _Response(
                [
                    _use(
                        "c1",
                        "propose_edits",
                        edits=[_edit(kind="add_transition", source_id="a_note", target_id="a_ltv")],
                    )
                ]
            ),
            _Response([_text("I've proposed one change.")]),
        ]
    )
    answer = ask(_model(), [Message(role="user", content="wire up note")], client=client)

    assert len(answer.proposals) == 1
    assert answer.proposals[0].kind == "add_transition"
    # Paths, not raw uuids — this is what the panel shows the user.
    assert answer.proposals[0].source_path == "Bronze / orders / note"
    assert answer.trace[0].result == "proposed 1"


def test_proposals_survive_the_loop_bound():
    """Anything validated before the bound was hit is still reviewable work;
    dropping it would throw away something the user can act on."""
    client = _FakeClient(
        [
            _Response(
                [
                    _use(
                        f"c{i}",
                        "propose_edits",
                        edits=[_edit(kind="rename", entity_id="a_note", value=f"note_{i}")],
                    )
                ]
            )
            for i in range(MAX_TOOL_ROUNDS)
        ]
    )
    answer = ask(_model(), [Message(role="user", content="loop")], client=client)
    assert answer.stop_reason == "max_rounds"
    assert answer.proposals


def test_a_read_only_turn_proposes_nothing():
    client = _FakeClient([_Response([_text("Here's what I found.")])])
    assert ask(_model(), [Message(role="user", content="q")], client=client).proposals == []


# --- rejections: an unapplicable proposal must never reach the user ----------


def test_an_edge_to_an_entity_that_does_not_exist_is_rejected():
    result = validate(_model(), [_edit(kind="add_transition", source_id="a_note", target_id="nope")])
    assert not result.accepted
    assert "No entity with id" in result.rejected[0].reason


def test_a_duplicate_transition_is_rejected():
    """It would apply to nothing — addTransition is a no-op on a duplicate —
    so the Apply button would silently do nothing."""
    result = validate(
        _model(), [_edit(kind="add_transition", source_id="a_amount", target_id="a_ltv")]
    )
    assert "already exists" in result.rejected[0].reason


def test_a_duplicate_within_one_batch_is_rejected():
    """Two identical edges both pass a model-only check; the second is a no-op."""
    edit = _edit(kind="add_transition", source_id="a_note", target_id="a_ltv")
    result = validate(_model(), [edit, dict(edit)])
    assert len(result.accepted) == 1
    assert "already proposed" in result.rejected[0].reason


def test_a_self_loop_is_rejected():
    result = validate(
        _model(), [_edit(kind="add_transition", source_id="a_note", target_id="a_note")]
    )
    assert "cannot flow into itself" in result.rejected[0].reason


def test_an_edit_with_no_explanation_is_rejected():
    """`describes` is all the user reads before approving. Without it the Apply
    button has no sentence attached to it."""
    result = validate(
        _model(), [{"kind": "add_transition", "source_id": "a_note", "target_id": "a_ltv"}]
    )
    assert "describes" in result.rejected[0].reason


def test_writing_the_reserved_tags_property_is_rejected_in_favour_of_add_tag():
    """A raw write bypasses the editor's tag normalisation and produces tags the
    tag panel cannot see."""
    result = validate(_model(), [_edit(kind="set_property", entity_id="a_note", key="Tags", value="x")])
    assert "add_tag" in result.rejected[0].reason


def test_setting_a_property_to_the_value_it_already_has_is_rejected():
    result = validate(
        _model(),
        [_edit(kind="set_property", entity_id="a_amount", key="Data type", value="double")],
    )
    assert "already" in result.rejected[0].reason


def test_clearing_a_property_is_rejected_as_a_deletion():
    result = validate(
        _model(), [_edit(kind="set_property", entity_id="a_amount", key="Data type", value="")]
    )
    assert "deletion" in result.rejected[0].reason


def test_a_tag_the_entity_already_carries_is_rejected():
    result = validate(_model(), [_edit(kind="add_tag", entity_id="a_amount", value="PII")])
    assert "already carries" in result.rejected[0].reason


def test_renaming_to_the_current_name_is_rejected():
    result = validate(_model(), [_edit(kind="rename", entity_id="a_note", value="note")])
    assert "already the entity's name" in result.rejected[0].reason


def test_a_batch_longer_than_a_person_can_review_is_capped():
    edits = [
        _edit(kind="rename", entity_id="a_note", value=f"n{i}") for i in range(MAX_EDITS + 5)
    ]
    result = validate(_model(), edits)
    assert len(result.accepted) <= MAX_EDITS
    assert any("can be proposed at once" in r.reason for r in result.rejected)


def test_a_malformed_edit_is_rejected_rather_than_raising():
    """A model that sends nonsense should get a reason back and a chance to fix
    it, not take the conversation down."""
    result = validate(_model(), [{"kind": "teleport", "describes": "hmm"}])
    assert not result.accepted
    assert result.rejected


def test_a_non_list_edits_argument_is_a_type_error_the_loop_can_report():
    with pytest.raises(TypeError):
        run_tool(_model(), "propose_edits", {"edits": "add a transition"})


# --- what is deliberately absent --------------------------------------------


def test_no_tool_can_delete_anything():
    """Every operation is additive or corrective, so a rubber-stamped Apply
    costs a wrong edge — visible and undoable — rather than a missing model."""
    kinds = TOOLS[0]["input_schema"]["properties"]["edits"]["items"]["properties"]["kind"]["enum"]
    assert not any("delete" in k or "remove" in k for k in kinds)


def test_the_edit_tool_is_offered_last_so_reading_comes_first():
    names = [t["name"] for t in ALL_TOOLS]
    assert names[-1] == "propose_edits"
