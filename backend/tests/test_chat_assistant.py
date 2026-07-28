"""The LLM layer — the loop, the tool surface, and what it refuses to do.

There is no live API call here. The client is a script of canned responses, so
what these tests actually check is the part that is ours: that a tool call is
dispatched to the real traversal, that its result goes back in the shape the API
requires, that the loop terminates, and that the recorded trace tells the truth
about what was read. The model's prose is not under test; its *access* is.

The fixture is the same medallion shape as `test_chat_graph.py` — column edges
through the warehouse, table-level only into bronze — because the interesting
failures are all about reporting that distinction rather than flattening it.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.chat.assistant import MAX_TOOL_ROUNDS, AssistantError, Message, ask
from app.chat.model import MAX_INSTRUCTIONS, LineageModel
from app.chat.tools import TOOLS, outline, run_tool


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
                            "children": [{"id": "a_b_amount", "name": "amount", "children": []}],
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
                {"id": "t1", "source": "a_b_amount", "target": "a_g_ltv"},
                {"id": "t2", "source": "o_bronze", "target": "o_gold"},
            ],
            "properties": {
                "t1": {"Transform": "SUM(amount)", "Source": "Fabric sandbox"},
            },
        }
    )


# --- a scripted stand-in for the SDK ----------------------------------------


class _Block:
    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


def _text(s: str) -> _Block:
    return _Block(type="text", text=s)


def _use(call_id: str, tool: str, **args: Any) -> _Block:
    # `tool`, not `name` — a tool argument is also called `name`, and the two
    # collide as keywords.
    return _Block(type="tool_use", id=call_id, name=tool, input=args)


class _Response:
    def __init__(self, blocks: list[_Block], stop_reason: str = "end_turn") -> None:
        self.content = blocks
        self.stop_reason = stop_reason


class _FakeClient:
    """Replays `script` turn by turn, recording every request it was sent."""

    def __init__(self, script: list[_Response]) -> None:
        self._script = list(script)
        self.requests: list[dict[str, Any]] = []
        self.messages = self  # the SDK's `client.messages.create` shape

    def create(self, **kwargs: Any) -> _Response:
        self.requests.append(kwargs)
        if not self._script:
            raise AssertionError("the loop asked for more turns than were scripted")
        return self._script.pop(0)


# --- the loop ---------------------------------------------------------------


def test_a_tool_call_reaches_the_real_traversal_and_its_result_comes_back():
    client = _FakeClient(
        [
            _Response([_use("c1", "trace_downstream", entity_id="a_b_amount")]),
            _Response([_text("amount feeds ltv via SUM(amount).")]),
        ]
    )
    answer = ask(_model(), [Message(role="user", content="where does amount go?")], client=client)

    assert answer.text == "amount feeds ltv via SUM(amount)."
    assert answer.stop_reason == "end_turn"

    # The second request must carry the tool result, and it must be the walk
    # `graph.py` computed — not something the loop made up on its way past.
    results = client.requests[1]["messages"][-1]["content"]
    assert results[0]["tool_use_id"] == "c1"
    assert results[0]["is_error"] is False
    assert "SUM(amount)" in results[0]["content"]
    assert "a_g_ltv" in results[0]["content"]


def test_the_assistant_turn_is_replayed_verbatim_so_tool_ids_still_match():
    """Rebuilding the turn from its text drops the tool_use blocks, and the API
    then rejects the tool_result that references an id it can no longer see."""
    call = _use("c1", "find_entity", name="amount")
    client = _FakeClient([_Response([_text("Looking…"), call]), _Response([_text("done")])])
    ask(_model(), [Message(role="user", content="amount?")], client=client)

    replayed = client.requests[1]["messages"][-2]
    assert replayed["role"] == "assistant"
    assert replayed["content"][1] is call


def test_every_result_for_one_turn_goes_back_in_a_single_user_message():
    """Splitting parallel results across messages trains the model out of
    calling tools in parallel at all."""
    client = _FakeClient(
        [
            _Response(
                [
                    _use("c1", "find_entity", name="amount"),
                    _use("c2", "find_entity", name="ltv"),
                ]
            ),
            _Response([_text("both found")]),
        ]
    )
    ask(_model(), [Message(role="user", content="both?")], client=client)

    sent = client.requests[1]["messages"]
    assert sent[-1]["role"] == "user"
    assert [r["tool_use_id"] for r in sent[-1]["content"]] == ["c1", "c2"]


def test_a_bad_tool_call_is_answered_as_an_error_rather_than_crashing_the_turn():
    """A model that sends a malformed call should get a chance to correct it —
    a 500 to the browser loses the whole conversation instead."""
    client = _FakeClient(
        [
            _Response([_use("c1", "trace_downstream")]),  # missing entity_id
            _Response([_text("Sorry, which column?")]),
        ]
    )
    answer = ask(_model(), [Message(role="user", content="trace it")], client=client)

    result = client.requests[1]["messages"][-1]["content"][0]
    assert result["is_error"] is True
    assert "entity_id" in result["content"]
    assert answer.text == "Sorry, which column?"


def test_a_looping_model_is_stopped_and_the_answer_says_so():
    """The failure mode this guards is spend, and an answer that never arrives."""
    client = _FakeClient(
        [_Response([_use(f"c{i}", "find_entity", name="amount")]) for i in range(MAX_TOOL_ROUNDS)]
    )
    answer = ask(_model(), [Message(role="user", content="loop")], client=client)

    assert answer.stop_reason == "max_rounds"
    assert len(answer.trace) == MAX_TOOL_ROUNDS
    assert "ran out of steps" in answer.text


def test_a_refusal_is_reported_rather_than_read_as_an_empty_answer():
    """`content` is empty on a pre-output refusal, so indexing it would raise
    and the user would see a 503 for a request that actually succeeded."""
    client = _FakeClient([_Response([], stop_reason="refusal")])
    answer = ask(_model(), [Message(role="user", content="…")], client=client)

    assert answer.stop_reason == "refusal"
    assert answer.text


def test_an_upstream_failure_becomes_an_assistant_error_not_a_raw_sdk_exception():
    class _Boom:
        messages = property(lambda self: self)

        def create(self, **kwargs: Any):
            raise RuntimeError("connection reset")

    with pytest.raises(AssistantError, match="connection reset"):
        ask(_model(), [Message(role="user", content="hi")], client=_Boom())


def test_an_empty_conversation_is_refused_before_any_call_is_made():
    with pytest.raises(AssistantError):
        ask(_model(), [], client=_FakeClient([]))


# --- prompt caching ---------------------------------------------------------


def _blocks(request):
    return request["system"]


def test_the_fixed_rules_and_tool_schemas_are_cached_together():
    """Render order is tools then system, so a breakpoint at the end of the
    stable system block covers both — the largest fixed cost in a turn."""
    client = _FakeClient([_Response([_text("hi")])])
    ask(_model(), [Message(role="user", content="q")], client=client)

    blocks = _blocks(client.requests[0])
    assert blocks[0]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in blocks[1]


def test_everything_model_specific_sits_after_the_breakpoint():
    """A per-model outline before the breakpoint would change the cached prefix
    for every model — the silent invalidator, where nothing errors and the
    cache simply never hits."""
    client = _FakeClient([_Response([_text("hi")])])
    ask(_model(), [Message(role="user", content="q")], client=client)

    stable, variable = _blocks(client.requests[0])
    assert "Medallion" not in stable["text"]
    assert "Medallion" in variable["text"]
    assert "bronze_orders" in variable["text"]


def test_the_cached_block_is_byte_identical_across_different_models():
    """The whole point: two users on two models share one cache entry."""
    other = LineageModel.model_validate({"id": "m2", "name": "Other", "layers": []})
    a, b = _FakeClient([_Response([_text("x")])]), _FakeClient([_Response([_text("x")])])
    ask(_model(), [Message(role="user", content="q")], client=a)
    ask(other, [Message(role="user", content="q")], client=b)

    assert _blocks(a.requests[0])[0]["text"] == _blocks(b.requests[0])[0]["text"]


def test_the_newest_tool_results_carry_a_rolling_cache_point():
    client = _FakeClient(
        [
            _Response([_use("c1", "find_entity", name="amount")]),
            _Response([_use("c2", "find_entity", name="ltv")]),
            _Response([_text("done")]),
        ]
    )
    ask(_model(), [Message(role="user", content="q")], client=client)

    sent = client.requests[-1]["messages"]
    marked = [
        block
        for message in sent
        if isinstance(message["content"], list)
        for block in message["content"]
        if isinstance(block, dict) and "cache_control" in block
    ]
    # Exactly one, on the most recent results — not one per round.
    assert len(marked) == 1
    assert marked[0]["tool_use_id"] == "c2"


def test_a_long_turn_never_exceeds_the_four_breakpoint_limit():
    """Accumulating a breakpoint per round would be REJECTED outright by the
    API on a long turn, losing the whole answer."""
    client = _FakeClient(
        [_Response([_use(f"c{i}", "find_entity", name="amount")]) for i in range(MAX_TOOL_ROUNDS)]
    )
    ask(_model(), [Message(role="user", content="q")], client=client)

    for request in client.requests:
        count = sum(1 for b in request["system"] if "cache_control" in b)
        count += sum(
            1
            for message in request["messages"]
            if isinstance(message["content"], list)
            for block in message["content"]
            if isinstance(block, dict) and "cache_control" in block
        )
        assert count <= 4


# --- custom instructions ----------------------------------------------------


def _with_instructions(text: str) -> LineageModel:
    model = _model()
    model.assistant_instructions = text
    return model


def test_house_rules_reach_the_prompt():
    client = _FakeClient([_Response([_text("hi")])])
    ask(_with_instructions("Always answer in British English."), [Message(role="user", content="q")], client=client)

    assert "British English" in _blocks(client.requests[0])[1]["text"]


def test_house_rules_sit_after_the_cache_breakpoint():
    """Otherwise editing them invalidates the shared prefix on every request —
    and instructions are edited far more often than the rules above them."""
    client = _FakeClient([_Response([_text("hi")])])
    ask(_with_instructions("Be terse."), [Message(role="user", content="q")], client=client)

    stable, variable = _blocks(client.requests[0])
    assert "Be terse." not in stable["text"]
    assert "Be terse." in variable["text"]


def test_house_rules_are_framed_as_style_and_cannot_loosen_fidelity():
    """A rule asking for confident one-liners must not license reporting a
    table-level path as a column-level claim."""
    client = _FakeClient([_Response([_text("hi")])])
    ask(_with_instructions("Be confident."), [Message(role="user", content="q")], client=client)

    variable = _blocks(client.requests[0])[1]["text"]
    assert "do not change what counts as a fact" in variable
    assert "follow the trace" in variable


def test_no_house_rules_section_appears_when_there_are_none():
    client = _FakeClient([_Response([_text("hi")])])
    ask(_model(), [Message(role="user", content="q")], client=client)
    assert "House rules" not in _blocks(client.requests[0])[1]["text"]


def test_blank_instructions_are_not_treated_as_instructions():
    client = _FakeClient([_Response([_text("hi")])])
    ask(_with_instructions("   \n  "), [Message(role="user", content="q")], client=client)
    assert "House rules" not in _blocks(client.requests[0])[1]["text"]


def test_instructions_are_capped_rather_than_trusted_to_be_short():
    """They ride in the prompt on every round of every turn, so an unbounded
    field is an unbounded bill."""
    model = _with_instructions("x" * 9000)
    assert len(model.instructions) == MAX_INSTRUCTIONS


def test_instructions_arrive_under_the_frontend_camelcase_name():
    """The browser sends the document as it stores it."""
    parsed = LineageModel.model_validate({"assistantInstructions": "Use tables."})
    assert parsed.instructions == "Use tables."


# --- the trace: what the UI shows next to the prose -------------------------


def test_the_trace_records_every_call_in_order_with_its_arguments():
    client = _FakeClient(
        [
            _Response([_use("c1", "find_entity", name="amount")]),
            _Response([_use("c2", "trace_downstream", entity_id="a_b_amount")]),
            _Response([_text("done")]),
        ]
    )
    answer = ask(_model(), [Message(role="user", content="q")], client=client)

    assert [c.name for c in answer.trace] == ["find_entity", "trace_downstream"]
    assert answer.trace[0].input == {"name": "amount"}
    assert answer.trace[0].result == "1 match"


def test_the_trace_repeats_the_traversals_own_caveats_not_just_a_count():
    """A trace reading '1 path' beside prose implying column lineage hides the
    thing phase 1 went to trouble to preserve. It must say 'object level'."""
    client = _FakeClient(
        [
            # bronze_orders has only a table-level edge out of it.
            _Response([_use("c1", "trace_downstream", entity_id="o_bronze")]),
            _Response([_text("done")]),
        ]
    )
    answer = ask(_model(), [Message(role="user", content="q")], client=client)
    assert answer.trace[0].result == "1 path · object level"


# --- the tool surface -------------------------------------------------------


def test_the_traversal_tools_take_an_id_and_never_a_name():
    """A name is not unique in a lineage model — `id` is on a dozen tables — so
    a name-addressed trace would silently answer about the wrong entity."""
    for tool in TOOLS:
        if tool["name"].startswith("trace_") or tool["name"] == "describe_entity":
            props = tool["input_schema"]["properties"]
            assert "entity_id" in props
            assert "name" not in props


def test_find_entity_distinguishes_no_matches_from_a_failed_call():
    assert run_tool(_model(), "find_entity", {"name": "nonexistent"}) == {
        "matches": [],
        "count": 0,
    }


def test_describing_an_unknown_id_says_so_instead_of_returning_null():
    """`null` reads as "no properties" rather than "no such entity", and the
    model reports the former as a fact about the column."""
    result = run_tool(_model(), "describe_entity", {"entity_id": "nope"})
    assert "error" in result


def test_the_scans_are_reachable_as_tools_and_return_real_numbers():
    """The panel's own example chip asks 'which columns have no lineage' — with
    only the four walk tools that question had no answer and the model had to
    guess or give up."""
    gaps = run_tool(_model(), "lineage_gaps", {"kind": "attribute"})
    assert gaps["count"] == 0  # every column in this fixture is wired up

    blast = run_tool(_model(), "impact", {"entity_id": "a_b_amount"})
    assert blast["count"] == 1
    assert blast["by_layer"] == {"Gold": 1}

    cover = run_tool(_model(), "coverage", {})
    assert cover["transitions"] == 2


def test_the_gap_count_survives_serialisation():
    """`without_lineage` is computed. A plain property is dropped by
    model_dump(), and the assistant would get a report with the answer
    missing — then subtract two figures itself, or not."""
    cover = run_tool(_model(), "coverage", {})
    assert "without_lineage" in cover["attributes"]
    assert cover["attributes"]["without_lineage"] == 0


def test_impact_defaults_to_downstream_when_no_direction_is_given():
    assert run_tool(_model(), "impact", {"entity_id": "a_b_amount"})["direction"] == "downstream"


def test_a_scan_result_is_summarised_as_a_total_not_as_paths():
    """The path summariser would render every scan as 'no paths found'."""
    client = _FakeClient(
        [
            _Response([_use("c1", "coverage")]),
            _Response([_use("c2", "impact", entity_id="a_b_amount")]),
            _Response([_text("done")]),
        ]
    )
    answer = ask(_model(), [Message(role="user", content="q")], client=client)
    assert answer.trace[0].result == "2/2 columns traced · 1 hand-drawn edge"
    assert answer.trace[1].result == "1 affected across 1 layer"


def test_an_unknown_tool_name_is_rejected():
    with pytest.raises(KeyError):
        run_tool(_model(), "delete_everything", {})


# --- the outline in the system prompt ---------------------------------------


def test_the_outline_lists_layers_and_their_objects():
    text = outline(_model())
    assert "Bronze (1): bronze_orders" in text
    assert "Gold (1): gold_ltv" in text


def test_a_truncated_outline_declares_that_it_is_truncated():
    """Silently cutting the list makes a partial inventory look complete, and
    the assistant then reports 'there is no such table' about one it cannot see."""
    text = outline(_model(), max_objects=1)
    assert "1 more objects are not listed" in text
    assert "use find_entity" in text


def test_an_empty_model_is_described_rather_than_rendered_as_a_blank_prompt():
    assert "empty" in outline(LineageModel())
