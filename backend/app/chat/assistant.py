"""The LLM layer — phase 2 of the model assistant.

Phase 1 (`graph.py`) is the query engine: a deterministic, cycle-guarded walk of
the lineage model that cannot invent a hop. This module is the half that decides
*which* walk answers the question, and turns the walk's output into a sentence.
Those are the two jobs a language model is actually good at, and they are the
only two it is given here — every fact in an answer comes back through
`tools.run_tool`, and the trace of those calls is returned alongside the prose so
a reader can check the claim against the walk that produced it.

Three decisions worth knowing before reading the code:

**A manual tool loop, not the SDK's tool runner.** The runner wants tools that
are plain callables; ours all need the model DOCUMENT threaded through, and the
document arrives on the wire with each request rather than living anywhere the
process can reach (see `model.py`). Closing over it per request would mean
building a fresh tool set per call, and the loop is a dozen lines anyway. Doing
it by hand also means the tool calls are ours to record, which is what makes
`Answer.trace` possible.

**The request uses only the stable Messages surface** — `model`, `max_tokens`,
`system`, `tools`, `messages`. No effort, thinking or fallback configuration:
those are newer parameters, this repo pins no exact SDK version, and an unknown
keyword is a hard TypeError at call time rather than a degraded answer. On
Claude Opus 5 thinking is on by default regardless, which is why `max_tokens` is
generous — it caps thinking and reply together, so a tight budget truncates the
answer rather than the reasoning.

**Assistant turns are replayed as text only.** The browser holds the
conversation (there is no server-side store, same as the model itself), so a
prior turn comes back as the prose the user saw, not its tool blocks. Within a
single turn the loop appends `response.content` wholesale, which is what the API
requires; across turns the tool results are dropped, so a follow-up question
re-runs the walk instead of trusting a remembered one. That is the safer of the
two, and it is also the honest one: the model changes between turns.
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import BaseModel, Field

from ..config import get_settings
from .model import LineageModel
from .tools import TOOLS, outline, run_tool

#: A question needs a handful of walks, not a hundred. This bounds a model that
#: has started looping — it stops the turn and says so rather than spending.
MAX_TOOL_ROUNDS = 8

#: Caps thinking + reply together on models where thinking is on by default.
MAX_TOKENS = 8000

SYSTEM = """\
You are the lineage assistant for Lineage Studio, answering questions about ONE \
data lineage model the user is looking at right now.

The model is a graph of layers (Bronze, Silver, Gold…), objects inside them \
(tables, notebooks, pipelines) and attributes inside those (columns). Directed \
transitions connect any two entities at any level.

# How to answer

Every fact you state about this model MUST come from a tool result in this \
conversation. You cannot see the graph; the tools are your only access to it. \
If the tools do not support a claim, say you could not determine it — never fill \
the gap with what a lineage model usually looks like.

Start with find_entity to turn the name in the question into an id, then trace \
or describe from that id. If a name matches several entities, say so and use \
their paths to ask which one is meant, or answer for the most likely and name \
which you picked.

# Reporting a trace faithfully

The traversal is careful about distinctions that are easy to flatten. Preserve \
them:

- `level` is `attribute` when the path is column-to-column and `object` when it \
  is table-to-table. A table-level answer must be reported as one — it shows the \
  tables the data moves through, not which column feeds which. The `note` field \
  says when this happened; pass that on rather than implying column lineage \
  that is not recorded.
- `derived: false` on a hop means a person drew that edge by hand and nothing \
  has ever checked it against a notebook. It is real, but it is a claim, not a \
  verified fact. Say so when a path depends on one.
- `truncated: true` means the search hit its limit, NOT that there is no \
  lineage. Never report a limit as an absence.
- `transform` is the expression that produced a column. Quote it when it \
  answers the question — it usually does.

# Style

Answer in prose, briefly, leading with the answer. Name entities by their path \
(`Gold / customer_ltv / lifetime_value`) so the user can find them. Walk a path \
hop by hop only when the user asked how something flows; otherwise summarise. \
Do not describe the tools, and do not narrate which calls you are about to make.
"""


class Message(BaseModel):
    """One turn of the conversation, as the browser holds it."""

    role: str  # "user" | "assistant"
    content: str


class ToolCall(BaseModel):
    """One traversal the assistant ran, recorded so the answer can be checked."""

    name: str
    input: dict[str, Any] = Field(default_factory=dict)
    #: A one-line human summary of what came back — not the payload, which is
    #: large and which the UI has no use for.
    result: str


class Answer(BaseModel):
    text: str
    #: In call order. An empty trace on a substantive answer is a red flag: it
    #: means the model answered without reading the graph.
    trace: list[ToolCall] = Field(default_factory=list)
    #: `end_turn` normally; `max_rounds` when the loop bound stopped it;
    #: `refusal` when the API declined.
    stop_reason: str = "end_turn"


class AssistantError(RuntimeError):
    """Configuration or upstream failure — surfaced to the caller as 4xx/5xx."""


class _Client(Protocol):
    """The slice of the Anthropic client this module uses.

    Narrow on purpose: it is the whole seam the tests substitute, and keeping it
    to one method means a test double cannot accidentally diverge from the parts
    of the SDK we actually depend on.
    """

    @property
    def messages(self) -> Any: ...


def build_client() -> _Client:
    """The configured Anthropic client, or a clear error saying why not."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise AssistantError(
            "The assistant is not configured — set ANTHROPIC_API_KEY in the "
            "environment to enable it."
        )
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover - depends on the install
        raise AssistantError(
            "The `anthropic` package is not installed; run "
            "`pip install -r requirements.txt`."
        ) from exc
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def ask(
    model: LineageModel,
    messages: list[Message],
    *,
    client: _Client | None = None,
) -> Answer:
    """Answer a question about `model`, running traversals as needed."""
    if not messages:
        raise AssistantError("No question was asked.")

    client = client or build_client()
    llm_model = get_settings().anthropic_model

    system = f"{SYSTEM}\n# The model on screen\n\nName: {model.name or '(unnamed)'}\n\n{outline(model)}"
    convo: list[dict[str, Any]] = [
        {"role": m.role, "content": m.content} for m in messages
    ]
    trace: list[ToolCall] = []

    for _ in range(MAX_TOOL_ROUNDS):
        response = _create(client, llm_model, system, convo)

        if getattr(response, "stop_reason", None) == "refusal":
            return Answer(
                text=(
                    "I wasn't able to answer that one. Try rephrasing the "
                    "question about the model."
                ),
                trace=trace,
                stop_reason="refusal",
            )

        blocks = list(response.content)
        calls = [b for b in blocks if getattr(b, "type", None) == "tool_use"]
        if not calls:
            return Answer(text=_text_of(blocks), trace=trace, stop_reason="end_turn")

        # The assistant turn goes back verbatim — thinking and tool_use blocks
        # included. Reconstructing it from the text alone loses the tool_use ids
        # the results below have to match, and the API rejects the next request.
        convo.append({"role": "assistant", "content": blocks})

        results: list[dict[str, Any]] = []
        for call in calls:
            args = dict(call.input or {})
            try:
                payload = run_tool(model, call.name, args)
                is_error = False
            except (KeyError, TypeError) as exc:
                payload = {"error": str(exc) or f"bad call to {call.name}"}
                is_error = True
            trace.append(
                ToolCall(name=call.name, input=args, result=_summarize(call.name, payload))
            )
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": json.dumps(payload, default=str),
                    "is_error": is_error,
                }
            )
        # All results for one assistant turn go back in a SINGLE user message.
        # Splitting them teaches the model to stop calling tools in parallel.
        convo.append({"role": "user", "content": results})

    return Answer(
        text=(
            "I ran out of steps before finishing that one — it needed more "
            "lookups than I'm allowed in a single answer. Try asking about one "
            "entity at a time."
        ),
        trace=trace,
        stop_reason="max_rounds",
    )


def _create(client: _Client, llm_model: str, system: str, convo: list[dict[str, Any]]) -> Any:
    try:
        return client.messages.create(
            model=llm_model,
            max_tokens=MAX_TOKENS,
            system=system,
            tools=TOOLS,
            messages=convo,
        )
    except AssistantError:
        raise
    except Exception as exc:  # noqa: BLE001 - the SDK's error tree is broad
        raise AssistantError(f"The assistant call failed: {exc}") from exc


def _text_of(blocks: list[Any]) -> str:
    parts = [
        b.text for b in blocks if getattr(b, "type", None) == "text" and getattr(b, "text", "")
    ]
    return "\n\n".join(parts).strip() or "(no answer)"


def _summarize(name: str, payload: Any) -> str:
    """One line describing a tool result, for the UI's trace.

    Deliberately reports the traversal's own qualifiers — level, truncation —
    rather than just a count, so the trace shows the same caveats the prose is
    supposed to carry. A trace that says "3 paths (table level)" next to an
    answer implying column lineage is a visible contradiction.
    """
    if not isinstance(payload, dict):
        return "ok"
    if "error" in payload:
        return str(payload["error"])
    if name == "find_entity":
        count = payload.get("count", 0)
        return f"{count} match{'' if count == 1 else 'es'}"
    if name == "describe_entity":
        entity = payload.get("entity") or {}
        return (
            f"{entity.get('path', '?')} — "
            f"{payload.get('upstream_count', 0)} in, {payload.get('downstream_count', 0)} out"
        )
    paths = payload.get("paths") or []
    if not paths:
        return "no paths found"
    bits = [f"{len(paths)} path{'' if len(paths) == 1 else 's'}"]
    if payload.get("level"):
        bits.append(f"{payload['level']} level")
    if payload.get("truncated"):
        bits.append("truncated")
    return " · ".join(bits)
