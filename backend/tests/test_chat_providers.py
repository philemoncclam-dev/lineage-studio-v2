"""The two wire formats, and the guarantees that must hold in both.

The loop's promises — a tool call reaching the real traversal, results paired to
the right call, parallel calls answered together, the bound terminating — are
provider-neutral. So the same turn is driven through the Anthropic adapter and
the OpenAI-compatible one, and the outcomes are asserted to match.

What differs is deliberate and asserted separately: Anthropic carries prompt
caching and echoes its own content blocks; the OpenAI dialect flattens the
system prompt, sends one message per tool result, and must not leak
`cache_control` to a server that would reject it.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.chat.assistant import Message, ask
from app.chat.model import LineageModel
from app.chat.providers import (
    AnthropicProvider,
    OpenAICompatibleProvider,
    ProviderError,
    _tool_to_openai,
)
from tests.test_chat_assistant import _FakeClient, _Response, _model, _text, _use


# --- an OpenAI-shaped test double -------------------------------------------


class _Obj:
    """Stands in for an SDK response object.

    Carries `model_dump` because the real ones are pydantic models, and the
    adapter uses exactly that to echo an assistant turn back verbatim. A double
    without it would exercise the rebuild fallback instead of the path
    production takes — and would have hidden the thought_signature bug.
    """

    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)

    def model_dump(self, exclude_none: bool = False) -> dict[str, Any]:
        def unwrap(value: Any) -> Any:
            if isinstance(value, _Obj):
                return value.model_dump(exclude_none=exclude_none)
            if isinstance(value, list):
                return [unwrap(v) for v in value]
            return value

        return {
            k: unwrap(v)
            for k, v in self.__dict__.items()
            if not (exclude_none and v is None)
        }


def _oai_call(call_id: str, tool: str, **args: Any) -> _Obj:
    return _Obj(
        id=call_id,
        type="function",
        function=_Obj(name=tool, arguments=json.dumps(args)),
    )


def _oai_reply(text: str | None = None, calls: list[_Obj] | None = None) -> _Obj:
    return _Obj(
        choices=[
            _Obj(
                message=_Obj(content=text, tool_calls=calls or []),
                finish_reason="tool_calls" if calls else "stop",
            )
        ]
    )


class _FakeOpenAI:
    def __init__(self, script: list[_Obj]) -> None:
        self._script = list(script)
        self.requests: list[dict[str, Any]] = []
        self.chat = _Obj(completions=self)

    def create(self, **kwargs: Any) -> _Obj:
        self.requests.append(kwargs)
        if not self._script:
            raise AssertionError("the loop asked for more turns than were scripted")
        return self._script.pop(0)


def _openai_provider(script: list[_Obj]) -> tuple[OpenAICompatibleProvider, _FakeOpenAI]:
    client = _FakeOpenAI(script)
    return OpenAICompatibleProvider(client, "gemini-2.5-flash"), client


# --- the guarantees hold in both dialects -----------------------------------


def test_a_tool_call_reaches_the_real_traversal_on_the_openai_dialect():
    provider, client = _openai_provider(
        [
            _oai_reply(calls=[_oai_call("c1", "trace_downstream", entity_id="a_b_amount")]),
            _oai_reply(text="amount feeds ltv."),
        ]
    )
    answer = ask(_model(), [Message(role="user", content="q")], provider=provider)

    assert answer.text == "amount feeds ltv."
    assert answer.trace[0].name == "trace_downstream"
    # The result carried back is the walk graph.py computed, not something the
    # adapter invented on the way past.
    tool_message = client.requests[1]["messages"][-1]
    assert tool_message["role"] == "tool"
    assert tool_message["tool_call_id"] == "c1"
    assert "a_g_ltv" in tool_message["content"]


def test_both_dialects_produce_the_same_answer_for_the_same_turn():
    anthropic_client = _FakeClient(
        [
            _Response([_use("c1", "find_entity", name="amount")]),
            _Response([_text("Found it.")]),
        ]
    )
    provider, _ = _openai_provider(
        [
            _oai_reply(calls=[_oai_call("c1", "find_entity", name="amount")]),
            _oai_reply(text="Found it."),
        ]
    )

    a = ask(_model(), [Message(role="user", content="q")], client=anthropic_client)
    b = ask(_model(), [Message(role="user", content="q")], provider=provider)

    assert a.text == b.text
    assert [c.name for c in a.trace] == [c.name for c in b.trace]
    assert [c.result for c in a.trace] == [c.result for c in b.trace]


def test_the_loop_bound_terminates_on_the_openai_dialect_too():
    provider, _ = _openai_provider(
        [_oai_reply(calls=[_oai_call(f"c{i}", "find_entity", name="amount")]) for i in range(8)]
    )
    answer = ask(_model(), [Message(role="user", content="q")], provider=provider)
    assert answer.stop_reason == "max_rounds"


def test_parallel_calls_are_all_answered_before_the_next_request():
    provider, client = _openai_provider(
        [
            _oai_reply(
                calls=[
                    _oai_call("c1", "find_entity", name="amount"),
                    _oai_call("c2", "find_entity", name="ltv"),
                ]
            ),
            _oai_reply(text="both"),
        ]
    )
    ask(_model(), [Message(role="user", content="q")], provider=provider)

    # The dialect wants one message per result, unlike Anthropic's single turn
    # carrying every block — but both mean "every result for that turn".
    sent = client.requests[1]["messages"]
    assert [m["tool_call_id"] for m in sent if m["role"] == "tool"] == ["c1", "c2"]


def test_the_assistant_turn_is_echoed_with_its_tool_call_ids():
    """Rebuilding it from text drops the ids the results reference, and the
    server rejects the next request — or worse, answers the wrong call."""
    provider, client = _openai_provider(
        [
            _oai_reply(text="Looking…", calls=[_oai_call("c1", "find_entity", name="amount")]),
            _oai_reply(text="done"),
        ]
    )
    ask(_model(), [Message(role="user", content="q")], provider=provider)

    echoed = next(m for m in client.requests[1]["messages"] if m["role"] == "assistant")
    assert echoed["tool_calls"][0]["id"] == "c1"
    assert echoed["tool_calls"][0]["function"]["name"] == "find_entity"


def test_opaque_provider_state_on_a_tool_call_survives_the_round_trip():
    """Found against live Gemini 3.6, which attaches a `thought_signature` to
    every tool call and REJECTS the next request if it does not come back:
    "Function call is missing a thought_signature in functionCall parts".

    An assistant turn rebuilt from id, name and arguments drops it silently. The
    specific field matters less than the rule — providers hang state on a tool
    call that is opaque to us and load-bearing to them, so the only safe move is
    to hand back exactly what we were given.
    """
    signed = _oai_call("c1", "find_entity", name="amount")
    signed.extra_content = {"google": {"thought_signature": "OPAQUE"}}
    provider, client = _openai_provider(
        [_oai_reply(calls=[signed]), _oai_reply(text="done")]
    )
    ask(_model(), [Message(role="user", content="q")], provider=provider)

    assert "OPAQUE" in json.dumps(client.requests[1]["messages"], default=str)


def test_a_reply_with_no_raw_message_still_round_trips():
    """The rebuild is the fallback, not the norm — but it has to work."""
    from app.chat.providers import Reply, ToolCall, _assistant_turn

    turn = _assistant_turn(
        Reply(text="hi", tool_calls=[ToolCall(id="c1", name="find_entity", input={"name": "x"})])
    )
    assert turn["tool_calls"][0]["id"] == "c1"
    assert json.loads(turn["tool_calls"][0]["function"]["arguments"]) == {"name": "x"}


def test_proposals_survive_the_openai_dialect():
    provider, _ = _openai_provider(
        [
            _oai_reply(
                calls=[
                    _oai_call(
                        "c1",
                        "propose_edits",
                        edits=[
                            {
                                "kind": "add_transition",
                                "describes": "wire it up",
                                "source_id": "o_bronze",
                                "target_id": "a_g_ltv",
                            }
                        ],
                    )
                ]
            ),
            _oai_reply(text="I've proposed one change."),
        ]
    )
    answer = ask(_model(), [Message(role="user", content="fix")], provider=provider)
    assert len(answer.proposals) == 1


# --- what differs, on purpose -----------------------------------------------


def test_the_openai_dialect_never_leaks_cache_control():
    """`cache_control` is an Anthropic concept. Strict servers 400 on it, and
    the rest ignore it — either way it must not go out."""
    provider, client = _openai_provider(
        [
            _oai_reply(calls=[_oai_call("c1", "find_entity", name="amount")]),
            _oai_reply(text="done"),
        ]
    )
    ask(_model(), [Message(role="user", content="q")], provider=provider)

    assert "cache_control" not in json.dumps(client.requests[-1], default=str)


def test_the_system_blocks_are_flattened_into_one_message():
    """The split exists for Anthropic's prefix caching; elsewhere it is just
    two paragraphs — but both must still arrive."""
    provider, client = _openai_provider([_oai_reply(text="hi")])
    ask(_model(), [Message(role="user", content="q")], provider=provider)

    system = client.requests[0]["messages"][0]
    assert system["role"] == "system"
    assert "lineage assistant" in system["content"]
    assert "Medallion" in system["content"]


def test_tool_schemas_are_converted_to_the_function_shape():
    converted = _tool_to_openai(
        {"name": "find_entity", "description": "d", "input_schema": {"type": "object"}}
    )
    assert converted["type"] == "function"
    assert converted["function"]["name"] == "find_entity"
    assert converted["function"]["parameters"] == {"type": "object"}


def test_malformed_tool_arguments_become_a_reportable_error_not_a_crash():
    """Smaller models emit invalid argument JSON often enough that this has to
    be something the model can be told to correct."""
    bad = _Obj(id="c1", type="function", function=_Obj(name="find_entity", arguments="{oops"))
    provider, _ = _openai_provider([_oai_reply(calls=[bad]), _oai_reply(text="sorry")])

    answer = ask(_model(), [Message(role="user", content="q")], provider=provider)
    assert answer.stop_reason == "end_turn"
    assert answer.trace[0].name == "find_entity"


# --- rate limits ------------------------------------------------------------


class _RateLimited(Exception):
    """Shaped like the SDKs' 429, which carries its delay in the message body."""

    def __init__(self, delay: str = "2s") -> None:
        super().__init__(
            f"Error code: 429 - quota exceeded. retryDelay: '{delay}'"
        )
        self.status_code = 429


def test_a_short_rate_limit_is_waited_out_rather_than_shown_to_the_user(monkeypatch):
    """A tool loop is several requests in a few seconds — exactly the shape that
    trips a per-minute quota. A raw 429 reaching the user is a self-inflicted
    failure on a key with plenty of quota left."""
    from app.chat import providers

    slept: list[float] = []
    monkeypatch.setattr(providers.time, "sleep", slept.append)

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise _RateLimited("2s")
        return "ok"

    assert providers._call_with_retry(flaky) == "ok"
    # Waited exactly as long as the provider asked — guessing is worse in both
    # directions.
    assert slept == [2.0]


def test_a_long_rate_limit_is_reported_with_the_wait_rather_than_stalling(monkeypatch):
    """Holding a request open for a minute is indistinguishable from a hang."""
    from app.chat import providers

    monkeypatch.setattr(providers.time, "sleep", lambda _: None)

    def always():
        raise _RateLimited("49s")

    with pytest.raises(ProviderError, match="about 49s"):
        providers._call_with_retry(always)


def test_a_persistent_rate_limit_gives_up_rather_than_retrying_forever(monkeypatch):
    from app.chat import providers

    monkeypatch.setattr(providers.time, "sleep", lambda _: None)
    calls = {"n": 0}

    def always():
        calls["n"] += 1
        raise _RateLimited("1s")

    with pytest.raises(ProviderError, match="rate-limiting"):
        providers._call_with_retry(always)
    assert calls["n"] == providers.MAX_RETRIES


def test_a_non_rate_limit_error_is_not_retried():
    """Retrying a 400 wastes the user's time and changes nothing."""
    from app.chat import providers

    calls = {"n": 0}

    def broken():
        calls["n"] += 1
        raise RuntimeError("bad request")

    with pytest.raises(RuntimeError, match="bad request"):
        providers._call_with_retry(broken)
    assert calls["n"] == 1


def test_a_retry_after_header_is_preferred_when_present():
    from app.chat import providers

    class _WithHeader(Exception):
        def __init__(self) -> None:
            super().__init__("429 slow down")
            self.status_code = 429
            self.response = type("R", (), {"headers": {"retry-after": "5"}})()

    assert providers._retry_delay(_WithHeader()) == 5.0


def test_an_upstream_failure_is_a_provider_error_in_either_dialect():
    class _Boom:
        def __init__(self) -> None:
            self.chat = _Obj(completions=self)
            self.messages = self

        def create(self, **kwargs: Any):
            raise RuntimeError("connection reset")

    with pytest.raises(ProviderError, match="connection reset"):
        OpenAICompatibleProvider(_Boom(), "m").complete(system=[], convo=[], tools=[])
    with pytest.raises(ProviderError, match="connection reset"):
        AnthropicProvider(_Boom(), "m").complete(system=[], convo=[], tools=[])


# --- selection --------------------------------------------------------------


def _settings(**kw: Any):
    """Settings from the arguments alone.

    `_env_file=None` is load-bearing: without it these read the developer's real
    .env, so an assertion about an unset key passes or fails depending on whose
    machine it runs on. Every field a test asserts about is passed explicitly.
    """
    from app.config import Settings

    defaults = {"anthropic_api_key": None, "chat_api_key": None, "chat_model_name": ""}
    return Settings(_env_file=None, **{**defaults, **kw})


def test_an_unconfigured_openai_provider_says_which_variable_is_missing():
    from app.chat.providers import build

    with pytest.raises(ProviderError, match="CHAT_API_KEY"):
        build(_settings(chat_provider="openai_compatible"))


def test_the_model_name_falls_back_so_an_existing_env_keeps_working():
    assert _settings(anthropic_model="claude-opus-5").chat_model == "claude-opus-5"
    assert _settings(chat_model_name="gemini-3.6-flash").chat_model == "gemini-3.6-flash"


def test_configured_reads_the_key_belonging_to_the_selected_provider():
    gemini = _settings(chat_provider="openai_compatible", chat_api_key="k")
    assert gemini.chat_configured is True
    # An Anthropic key does not configure a Gemini deployment.
    stale = _settings(chat_provider="openai_compatible", anthropic_api_key="k")
    assert stale.chat_configured is False
