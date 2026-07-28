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

**The prompt is split at a caching boundary.** The tool schemas and the fixed
rules below are ~3.3K tokens that never vary, and the loop re-sends them on
every round; everything model-specific sits after the breakpoint. `cache_control`
is old, stable API surface, unlike the parameters above. See `_system_blocks`.

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
from typing import Any

from pydantic import BaseModel, Field

from ..config import get_settings
from . import edits as edits_module
from .edits import ProposedEdit
from .model import LineageModel
from .providers import (
    MAX_TOKENS,
    AnthropicProvider,
    Provider,
    ProviderError,
)
from .providers import build as build_provider
from .tools import TOOLS, outline, run_tool

#: A question needs a handful of walks, not a hundred. This bounds a model that
#: has started looping — it stops the turn and says so rather than spending.
MAX_TOOL_ROUNDS = 8

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

# Choosing between a trace and a scan

A trace answers "how does the data get there" and returns paths. A scan answers \
"how much" or "which ones" and returns totals. Using the wrong one understates \
the answer:

- For blast radius — "what breaks if I drop this", "how much depends on this" — \
  use `impact`, never `trace_downstream`. A trace caps at a dozen paths, so on \
  a graph that fans out it reports a fraction of what is affected and flags it \
  as truncated. `impact` counts distinct entities and is complete.
- For "which columns have no lineage", use `lineage_gaps`, not a series of \
  traces. For "how complete is this model" or "how much of this is verified", \
  use `coverage` — its hand-drawn count is the answer to the second one.

# The model versus live Fabric

Two different sources of truth are in reach, and conflating them is the worst \
mistake available here:

- The AUTHORED MODEL is what somebody drew or a sandbox run once derived. Every \
  tool except the `fabric_*` and `compare_to_fabric` ones reads it. Default to \
  it — a question is about the model unless it is explicitly about the tenant.
- LIVE FABRIC is what the lakehouse holds right now. Reach for it when the \
  question is about what exists, or whether the model is still true.

Say which one you are describing. "This model records three columns" and \
"Fabric has three columns" are different claims, and a reader who cannot tell \
them apart cannot act on either.

A Fabric result carrying `fabric_available: false` means this backend cannot \
reach Fabric at all — say so plainly and answer from the model instead. A \
schema result with `readable: false` means the schema could NOT BE READ, which \
is almost always a permissions problem; it never means the table has no \
columns, and reporting it that way would claim a healthy table is empty.

# Proposing changes

You can propose edits with `propose_edits`, and you cannot make them. The user \
sees each proposal beside your answer and decides. So:

- Say "I've proposed" or "here's the change I'd make", NEVER "I've added", \
  "I've fixed" or "done". Telling somebody their model changed when it did not \
  is the worst thing you can do here.
- Read before you write. Propose a transition only when a trace, a schema or a \
  Fabric comparison actually supports it — a plausible-looking edge is exactly \
  the thing this whole system is built to avoid producing.
- Explain each edit in its `describes` field, in one sentence, in terms of what \
  you found. That sentence is all the user reads before approving.
- Propose a few good edits rather than many speculative ones. If you are not \
  confident, say what you would change and why, and let the user ask for it.
- Rejected proposals come back with a reason. Fix and retry in the same turn \
  rather than reporting the rejection as a failure.

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
    #: Edits the assistant wants made, ALREADY VALIDATED against the model and
    #: NOT applied. The browser owns the document, so this is the only way an
    #: edit can happen — the panel renders these with an Apply button and the
    #: change lands through the normal editor and undo history.
    proposals: list[ProposedEdit] = Field(default_factory=list)
    #: In call order. An empty trace on a substantive answer is a red flag: it
    #: means the model answered without reading the graph.
    trace: list[ToolCall] = Field(default_factory=list)
    #: `end_turn` normally; `max_rounds` when the loop bound stopped it;
    #: `refusal` when the API declined.
    stop_reason: str = "end_turn"


class AssistantError(RuntimeError):
    """Configuration or upstream failure — surfaced to the caller as 4xx/5xx."""


def ask(
    model: LineageModel,
    messages: list[Message],
    *,
    client: Any | None = None,
    provider: Provider | None = None,
) -> Answer:
    """Answer a question about `model`, running traversals as needed.

    `client` is the Anthropic-shaped seam the tests substitute; `provider` takes
    an already-built adapter. Neither is required in production — the configured
    provider is built from settings.
    """
    if not messages:
        raise AssistantError("No question was asked.")

    if provider is None:
        provider = (
            AnthropicProvider(client, get_settings().chat_model)
            if client is not None
            else build_provider()
        )

    system = _system_blocks(model)
    # Provider-neutral conversation. Each adapter renders it into its own wire
    # shape; nothing in this loop knows what that looks like.
    convo: list[dict[str, Any]] = [
        {"role": m.role, "content": m.content} for m in messages
    ]
    trace: list[ToolCall] = []
    proposals: list[ProposedEdit] = []

    for _ in range(MAX_TOOL_ROUNDS):
        try:
            reply = provider.complete(system=system, convo=convo, tools=TOOLS)
        except ProviderError as exc:
            raise AssistantError(str(exc)) from exc

        if reply.stop_reason == "refusal":
            return Answer(
                text=(
                    "I wasn't able to answer that one. Try rephrasing the "
                    "question about the model."
                ),
                trace=trace,
                proposals=proposals,
                stop_reason="refusal",
            )

        if not reply.tool_calls:
            return Answer(
                text=reply.text or "(no answer)",
                trace=trace,
                proposals=proposals,
                stop_reason="end_turn",
            )

        # The assistant turn is carried as the provider gave it, so each adapter
        # can echo it verbatim — reconstructing it from text loses the tool-call
        # ids the results below have to match.
        convo.append({"role": "assistant", "reply": reply})

        results: list[dict[str, Any]] = []
        for call in reply.tool_calls:
            args = dict(call.input or {})
            try:
                if call.name in edits_module.TOOL_NAMES:
                    # Intercepted rather than dispatched generically: the loop
                    # needs the ACCEPTED edits to carry back to the browser,
                    # while the model gets only the count and the rejections.
                    proposal = edits_module.validate(model, edits_module.edits_of(args))
                    proposals.extend(proposal.accepted)
                    payload = edits_module.describe(proposal)
                else:
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
                    "id": call.id,
                    "content": json.dumps(payload, default=str),
                    "is_error": is_error,
                }
            )
        # All results for one assistant turn go back together. Splitting them
        # teaches the model to stop calling tools in parallel.
        convo.append({"role": "tool_results", "results": results})

    return Answer(
        text=(
            "I ran out of steps before finishing that one — it needed more "
            "lookups than I'm allowed in a single answer. Try asking about one "
            "entity at a time."
        ),
        trace=trace,
        # Anything validated before the bound was hit is still a real, reviewable
        # proposal. Dropping it would throw away work the user can act on.
        proposals=proposals,
        stop_reason="max_rounds",
    )


def _system_blocks(model: LineageModel) -> list[dict[str, Any]]:
    """The system prompt, split at the caching boundary.

    Prompt caching is a PREFIX match, and the render order is tools → system →
    messages. So the first block here sits directly behind eleven tool schemas
    that never change, and together they are ~3.3K tokens re-sent on every round
    of the tool loop — by far the largest fixed cost in a turn. Marking the end
    of that block makes every round after the first read it at a tenth of the
    price.

    Everything that varies per model goes AFTER the breakpoint: the outline, and
    the user's own instructions. Putting either before it would change the
    cached prefix for every different model and every instruction edit, which is
    the silent-invalidator failure — no error, just a cache that never hits.

    Custom instructions are placed last on purpose. They can shape voice, length
    and format, and they sit downstream of the fidelity rules in the stable
    block, which restates that they cannot loosen them. A house style that
    asked for confident one-liners must not be able to turn a table-level path
    into a column-level claim.
    """
    variable = f"# The model on screen\n\nName: {model.name or '(unnamed)'}\n\n{outline(model)}"
    if model.instructions:
        variable += (
            "\n\n# House rules from the user\n\n"
            "These set the STYLE of your answers — voice, length, formatting, "
            "what to lead with. They do not change what counts as a fact, and "
            "they never license reporting a result as more certain, more "
            "complete or more column-level than the tool said it was. If a rule "
            "here conflicts with reporting a trace faithfully, follow the trace "
            "and say why.\n\n"
            f"{model.instructions}"
        )
    return [
        {"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": variable},
    ]


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
    if name == "fabric_search":
        count = payload.get("count", 0)
        return f"{count} in Fabric"
    if name == "fabric_table_schema":
        if not payload.get("readable"):
            # Never "0 columns" — see the note in fabric_tools.table_schema.
            return "schema unreadable"
        return f"{len(payload.get('columns') or [])} live columns"
    if name == "compare_to_fabric":
        if not payload.get("found_in_fabric"):
            return "not in Fabric"
        if payload.get("ambiguous"):
            return f"{len(payload.get('candidates') or [])} tables share that name"
        if not payload.get("comparable"):
            return "schema unreadable — not compared"
        if payload.get("in_sync"):
            return "in sync with Fabric"
        return (
            f"{len(payload.get('only_in_model') or [])} only in model · "
            f"{len(payload.get('only_in_fabric') or [])} only in Fabric"
        )
    if name == "propose_edits":
        count = payload.get("proposed", 0)
        rejected = len(payload.get("rejected") or [])
        # "proposed", never "applied" — the trace is read next to the prose, and
        # it must not be the thing that implies the model changed.
        return f"proposed {count}" + (f" · {rejected} rejected" if rejected else "")
    if name == "find_entity":
        count = payload.get("count", 0)
        return f"{count} match{'' if count == 1 else 'es'}"
    if name == "lineage_gaps":
        count = payload.get("count", 0)
        listed = len(payload.get("entities") or [])
        return f"{count} without lineage" + (f" (showing {listed})" if listed < count else "")
    if name == "impact":
        count = payload.get("count", 0)
        layers = len(payload.get("by_layer") or {})
        return f"{count} affected across {layers} layer{'' if layers == 1 else 's'}"
    if name == "coverage":
        attrs = payload.get("attributes") or {}
        # Leads with the hand-drawn share, because that is the figure a single
        # "247 transitions" total hides.
        drawn = payload.get("hand_drawn_transitions", 0)
        return (
            f"{attrs.get('with_lineage', 0)}/{attrs.get('total', 0)} columns traced · "
            f"{drawn} hand-drawn edge{'' if drawn == 1 else 's'}"
        )
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
