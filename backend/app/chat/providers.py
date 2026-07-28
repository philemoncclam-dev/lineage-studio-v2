"""Which LLM answers, and in whose wire format.

The tool loop in `assistant.py` is provider-neutral: it decides what to ask, runs
the traversals, records the trace and collects proposals. What differs between
Anthropic and everyone else is only the SHAPE of a request and a reply — where
tool definitions live, how a tool call comes back, how a result goes in. That
shape is the whole job of this module.

One adapter covers most of the field, because Gemini, Groq, OpenRouter, Ollama
and several others all expose an OpenAI-compatible chat-completions API with
tool calling. So `openai_compatible` is not "the OpenAI provider" — it is the
common dialect, selected by pointing `CHAT_BASE_URL` somewhere.

Two things the conversion has to get right, and both are silent when wrong:

**A tool call must round-trip with its id.** Every provider pairs a call with
its result by an id it issued, and a reply that quotes the wrong one — or drops
it — is rejected, or worse, silently answered against the wrong tool. The
canonical `Reply` below carries whatever the provider sent verbatim in `raw`,
and each adapter echoes THAT back rather than reconstructing an assistant turn
from its text. On Anthropic this is also what preserves thinking blocks.

**Caching is Anthropic-only.** `cache_control` markers are meaningless
elsewhere, and passing them through to an OpenAI-shaped endpoint is a 400 on
strict servers. The OpenAI adapter strips them. That costs money rather than
correctness: Gemini does its own implicit caching, and the others simply pay
full price for the prefix.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from ..config import Settings, get_settings


class ProviderError(RuntimeError):
    """Configuration or upstream failure, reported as 503 by the router."""


#: A short 429 is waited out in place; a long one is reported so the user can
#: decide. The boundary is roughly how long somebody will sit watching a spinner
#: before assuming the app has hung.
MAX_WAIT_SECONDS = 12

#: Per turn, across all rounds. Bounded so a rate-limited backend cannot hold a
#: request open indefinitely.
MAX_RETRIES = 3


def _retry_delay(error: Exception) -> float | None:
    """Seconds the provider asked us to wait, if it said.

    Both dialects report this, in different places and formats: a `retry-after`
    header, or — as Gemini does — a `retryDelay: '49s'` buried in the error body.
    Reading it matters because guessing is worse in both directions: too short
    and the retry is refused again, too long and a one-second blip becomes a
    ten-second stall.
    """
    response = getattr(error, "response", None)
    header = getattr(response, "headers", None)
    if header is not None:
        raw = header.get("retry-after")
        if raw:
            try:
                return float(raw)
            except ValueError:
                pass
    match = re.search(r"retry in (\d+(?:\.\d+)?)s|retryDelay['\"]?[:=]\s*['\"]?(\d+(?:\.\d+)?)s", str(error))
    if match:
        return float(match.group(1) or match.group(2))
    return None


def _is_rate_limit(error: Exception) -> bool:
    status = getattr(error, "status_code", None) or getattr(
        getattr(error, "response", None), "status_code", None
    )
    return status == 429 or "429" in str(error)[:200]


def _call_with_retry(send: Callable[[], Any]) -> Any:
    """Run `send`, waiting out short rate limits.

    A tool loop is several requests in a few seconds, which is precisely the
    shape that trips a per-minute quota — so a raw 429 reaching the user is a
    self-inflicted failure on an account that has plenty of quota left. A long
    wait is NOT swallowed: it is reported with the delay, because silently
    holding a request open for a minute looks identical to a hang.
    """
    for attempt in range(MAX_RETRIES):
        try:
            return send()
        except Exception as exc:  # noqa: BLE001 - both SDKs' error trees are broad
            if not _is_rate_limit(exc):
                raise
            delay = _retry_delay(exc)
            if attempt == MAX_RETRIES - 1 or (delay is not None and delay > MAX_WAIT_SECONDS):
                raise ProviderError(
                    "The model provider is rate-limiting this key"
                    + (f" — it asked to wait about {round(delay)}s." if delay else ".")
                    + " On a free tier this usually means the per-minute quota;"
                    " wait a moment and ask again."
                ) from exc
            # No stated delay means a short backoff is the safe guess.
            time.sleep(delay if delay is not None else 2.0 * (attempt + 1))
    raise ProviderError("The model provider is rate-limiting this key.")


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class Reply:
    """One model turn, in the loop's own terms."""

    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    #: `end_turn`, `tool_use`, `refusal`, or whatever the provider called it.
    stop_reason: str = "end_turn"
    #: The provider's own representation of this turn, echoed back verbatim on
    #: the next request. Never rebuilt from `text` — see the module docstring.
    raw: Any = None


class Provider(Protocol):
    name: str

    def complete(
        self,
        *,
        system: list[dict[str, Any]],
        convo: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> Reply: ...


# --- Anthropic --------------------------------------------------------------


class AnthropicProvider:
    """The first-party path. Keeps prompt caching and thinking blocks intact."""

    name = "anthropic"

    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    def complete(self, *, system, convo, tools) -> Reply:
        messages = _to_anthropic(convo)
        _mark_cache_point(messages)
        try:
            response = _call_with_retry(
                lambda: self._client.messages.create(
                    model=self._model,
                    max_tokens=MAX_TOKENS,
                    system=system,
                    tools=tools,
                    messages=messages,
                )
            )
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001 - the SDK's error tree is broad
            raise ProviderError(f"The assistant call failed: {exc}") from exc

        if getattr(response, "stop_reason", None) == "refusal":
            return Reply(stop_reason="refusal")

        blocks = list(response.content)
        return Reply(
            text="\n\n".join(
                b.text for b in blocks if getattr(b, "type", None) == "text" and getattr(b, "text", "")
            ).strip(),
            tool_calls=[
                ToolCall(id=b.id, name=b.name, input=dict(b.input or {}))
                for b in blocks
                if getattr(b, "type", None) == "tool_use"
            ],
            stop_reason=getattr(response, "stop_reason", "end_turn") or "end_turn",
            raw=blocks,
        )


def _to_anthropic(convo: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for entry in convo:
        if entry["role"] == "user":
            out.append({"role": "user", "content": entry["content"]})
        elif entry["role"] == "assistant":
            # The provider's own blocks, verbatim: rebuilding from text would
            # drop the tool_use ids the results below have to match, and the
            # API rejects the next request.
            out.append({"role": "assistant", "content": entry["reply"].raw})
        else:
            out.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": r["id"],
                            "content": r["content"],
                            "is_error": r["is_error"],
                        }
                        for r in entry["results"]
                    ],
                }
            )
    return out


def _mark_cache_point(messages: list[dict[str, Any]]) -> None:
    """Keep exactly one rolling breakpoint on the newest tool results.

    Within a turn the loop re-sends the whole growing conversation each round,
    and tool results are the bulk of it. The breakpoint has to ROLL rather than
    accumulate: a request may carry at most four, so marking every round would
    exceed the limit on a long turn and be rejected outright.
    """
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    block.pop("cache_control", None)

    if not messages:
        return
    last = messages[-1]["content"]
    if isinstance(last, list) and last and isinstance(last[-1], dict):
        last[-1]["cache_control"] = {"type": "ephemeral"}


# --- OpenAI-compatible (Gemini, Groq, OpenRouter, Ollama, …) ----------------


class OpenAICompatibleProvider:
    """The common dialect, pointed anywhere by base_url.

    `session_id` is what makes caching work on this path. These providers cache
    implicitly — no `cache_control` to send — but only when a request reaches
    the endpoint that already holds the warm prefix, and a gateway is free to
    route each round of a tool loop somewhere else. OpenRouter pins routing to
    whatever `x-session-id` says, so passing a stable one per conversation is
    the difference between paying for the ~3.8K fixed prefix on every round and
    paying for it once.

    It rides in a HEADER rather than the request body deliberately: an unknown
    body field is a 400 on a strict server, while an unknown header is ignored
    everywhere. This has to stay safe against a plain OpenAI endpoint.
    """

    name = "openai_compatible"

    def __init__(self, client: Any, model: str, session_id: str | None = None) -> None:
        self._client = client
        self._model = model
        self._session_id = session_id

    def complete(self, *, system, convo, tools) -> Reply:
        messages = [{"role": "system", "content": _flatten_system(system)}]
        messages.extend(_to_openai(convo))
        headers = {"x-session-id": self._session_id} if self._session_id else None
        try:
            response = _call_with_retry(
                lambda: self._client.chat.completions.create(
                    model=self._model,
                    max_tokens=MAX_TOKENS,
                    messages=messages,
                    tools=[_tool_to_openai(t) for t in tools],
                    extra_headers=headers,
                )
            )
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"The assistant call failed: {exc}") from exc

        choice = response.choices[0]
        message = choice.message
        calls: list[ToolCall] = []
        for call in getattr(message, "tool_calls", None) or []:
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                # Smaller models emit malformed argument JSON often enough that
                # this must be a reportable tool error rather than a crash — the
                # loop hands the model back a message it can correct from.
                arguments = {"__malformed__": call.function.arguments}
            calls.append(ToolCall(id=call.id, name=call.function.name, input=arguments))

        return Reply(
            text=(message.content or "").strip(),
            tool_calls=calls,
            stop_reason="tool_use" if calls else (choice.finish_reason or "end_turn"),
            raw=message,
        )


def _flatten_system(system: list[dict[str, Any]]) -> str:
    """The system blocks as one string, dropping cache markers.

    The split exists for Anthropic's prefix caching; elsewhere it is just two
    paragraphs, and `cache_control` is meaningless (and a 400 on strict servers).
    """
    return "\n\n".join(block["text"] for block in system)


def _to_openai(convo: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for entry in convo:
        if entry["role"] == "user":
            out.append({"role": "user", "content": entry["content"]})
        elif entry["role"] == "assistant":
            out.append(_assistant_turn(entry["reply"]))
        else:
            # One message PER RESULT here, unlike Anthropic's single user turn
            # carrying every block. Both mean "all results for that turn"; the
            # wire shapes simply differ.
            for result in entry["results"]:
                out.append(
                    {
                        "role": "tool",
                        "tool_call_id": result["id"],
                        "content": result["content"],
                    }
                )
    return out


def _assistant_turn(reply: Reply) -> dict[str, Any]:
    """Echo the provider's own assistant message, not a rebuild of it.

    This is the same rule the Anthropic adapter follows, and skipping it here
    was a real bug: **Gemini 3.x attaches a `thought_signature` to every tool
    call and rejects the next request if it does not come back.** It rides in
    `extra_content.google`, which a message reconstructed from id, name and
    arguments silently drops — the request then fails with "Function call is
    missing a thought_signature", naming a field nothing in this codebase had
    ever heard of.

    The general principle is worth more than the specific field: providers hang
    state on a tool call that is opaque to us and load-bearing to them, and the
    only safe move is to hand back exactly what we were given. The rebuild below
    is the fallback for a reply that carries no raw message at all.
    """
    raw = reply.raw
    dump = getattr(raw, "model_dump", None)
    if callable(dump):
        message = dump(exclude_none=True)
        message["role"] = "assistant"
        return message
    if isinstance(raw, dict):
        return {**raw, "role": "assistant"}

    return {
        "role": "assistant",
        "content": reply.text or None,
        "tool_calls": [
            {
                "id": c.id,
                "type": "function",
                "function": {"name": c.name, "arguments": json.dumps(c.input)},
            }
            for c in reply.tool_calls
        ],
    }


def _tool_to_openai(tool: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool.get("input_schema") or {"type": "object", "properties": {}},
        },
    }


# --- selection --------------------------------------------------------------

#: Caps thinking + reply together on models where thinking is on by default.
MAX_TOKENS = 8000


def build(settings: Settings | None = None, *, session_id: str | None = None) -> Provider:
    """The configured provider, or a clear error saying what is missing.

    `session_id` is advisory and only reaches the OpenAI-compatible path — the
    Anthropic one caches on explicit breakpoints and needs no routing hint.
    """
    settings = settings or get_settings()

    if settings.chat_provider == "openai_compatible":
        if not settings.chat_api_key:
            raise ProviderError(
                "The assistant is not configured — set CHAT_API_KEY (and "
                "CHAT_BASE_URL) in the environment to enable it."
            )
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - depends on the install
            raise ProviderError(
                "The `openai` package is not installed; run "
                "`pip install -r requirements.txt`."
            ) from exc
        client = OpenAI(api_key=settings.chat_api_key, base_url=settings.chat_base_url or None)
        return OpenAICompatibleProvider(client, settings.chat_model, session_id)

    if not settings.anthropic_api_key:
        raise ProviderError(
            "The assistant is not configured — set ANTHROPIC_API_KEY in the "
            "environment to enable it."
        )
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover - depends on the install
        raise ProviderError(
            "The `anthropic` package is not installed; run "
            "`pip install -r requirements.txt`."
        ) from exc
    return AnthropicProvider(anthropic.Anthropic(api_key=settings.anthropic_api_key), settings.chat_model)
