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

import hashlib
import json
from typing import Any

from pydantic import BaseModel, Field

from ..config import get_settings
from . import edits as edits_module
from .edits import ProposedEdit
from .graph import build_index, ref_of
from .model import LineageModel
from .providers import (
    MAX_TOKENS,
    AnthropicProvider,
    Provider,
    ProviderError,
)
from .providers import build as build_provider
from .fabric_tools import ANONYMOUS, Caller
from .tools import outline, run_tool, tools_for

#: A question needs a handful of walks, not a hundred. This bounds a model that
#: has started looping — it stops the turn and says so rather than spending.
MAX_TOOL_ROUNDS = 8

#: Selecting a whole layer selects everything under it, so a selection can be
#: hundreds of entities. Enough to disambiguate a pronoun, not enough to crowd
#: out the answer.
MAX_SELECTION = 20

SYSTEM = """\
You are the lineage assistant for Lineage Studio, answering questions about ONE \
data lineage model the user is looking at right now.

The model is a graph of layers (Bronze, Silver, Gold…), objects inside them \
(tables, notebooks, pipelines) and attributes inside those (columns). Directed \
transitions connect any two entities at any level.

**Answer in one to three sentences.** A yes/no question gets one: the answer and \
the number behind it. Give counts, not inventories — never list more than about \
five things unless the user asked which ones. They will ask for the list if they \
want it, and it is one more question either way.

This is the first rule because it is the one most often lost by the end of a \
long answer. The rest of this prompt is about being RIGHT; this is about being \
read. Both matter, and length is the failure nobody reports because nothing in \
it is wrong.

# How to answer

Every fact you state about this model MUST come from a tool result in this \
conversation. You cannot see the graph; the tools are your only access to it. \
If the tools do not support a claim, say you could not determine it — never fill \
the gap with what a lineage model usually looks like.

This is strict, and the tempting failures are specific:

- Do NOT infer lineage from names. `customer_id` appearing in two tables is not \
  evidence they are connected; a `bronze_` prefix is not evidence a table feeds \
  a silver one; a medallion-shaped set of layer names does not tell you which \
  columns flow where. If there is no transition, there is no lineage — say so.
- Do NOT infer a column's meaning, type, sensitivity or purpose from its name. \
  `describe_entity` returns the properties that were actually recorded; \
  anything beyond them is your guess, not this model's content.
- Do NOT carry facts between models or between turns. Each question is answered \
  from the tools run in THIS conversation.
- General background — what a medallion architecture is, what a slowly changing \
  dimension means — is fine when the user asks for it, but say plainly that you \
  are explaining a general concept, not describing their model. Never let the \
  two blur into one sentence.

Start with find_entity to turn the name in the question into an id, then trace \
or describe from that id. If a name matches several entities, say so and use \
their paths to ask which one is meant, or answer for the most likely and name \
which you picked.

# What the user has selected

If a "Currently selected" section appears below, those entities are highlighted \
on the user's canvas right now, and a vague reference almost certainly means \
them. "This column", "it", "that table", "these", "here" — resolve to the \
selection first.

Their ids are given, so use them DIRECTLY in trace, describe and impact calls. \
Do not call find_entity to look up something already selected: a name search \
can return several entities and pick the wrong one, while the selection is \
exactly what the user is pointing at.

Two cautions. If the question clearly names something else, follow the question \
rather than the selection. And if the selection holds several entities but the \
user's wording is singular, say which one you answered about.

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
- **A truncated trace is not an answer yet.** Before stating any number from \
  one, call `impact` on the same entity and report ITS count — that scan visits \
  each entity once and is complete. "12 paths, and there may be more" leaves \
  the reader holding 12 when the true figure was one call away. Trace for the \
  shape of the flow; impact for how much.
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
- For "which of these never reach X", "what isn't used in X", "what doesn't end \
  up in X" — `lineage_gaps` with `reaches_layer` set to X (and `layer` set to \
  where you are looking from). ONE call answers it completely.

# One scan, not a trace each

A question about a SET is answered by a scan. Tracing the members one at a time \
is slower and answers worse, and it is the most common way a turn is wasted \
here: a dozen rounds to rebuild by hand, and partially, what one call returns \
whole.

So before tracing, ask whether this is one entity or a set. "Which \
attributes…", "what isn't…", "how many…", "anything that…" are sets. Trace when \
the user asks HOW something flows, or when they named the single thing they \
mean.

Then stop. A scan that returned everything has answered the question — do not \
confirm it entity by entity afterwards, and do not run the mirror-image query \
to check. If a result surprises you, report it; re-deriving it is spending the \
user's turn to reassure yourself.

# The model versus live Fabric

Two different sources of truth are in reach, and conflating them is the worst \
mistake available here:

- The AUTHORED MODEL is what somebody drew or a sandbox run once derived. Every \
  tool except the `fabric_*` and `compare_to_fabric` ones reads it. This is \
  your default and almost always your only source.
- LIVE FABRIC is what the lakehouse holds right now. Reach for it ONLY when the \
  user's own words point there — they say Fabric, the lakehouse, the tenant, \
  "live", "actually there", "still true", or name a workspace. Nothing else \
  licenses it.

Do not go to Fabric because a question merely FEELS like it is about what is \
real. "Should I add this edge", "is this right", "how reliable is this" and \
"what am I missing" are all questions about the AUTHORED MODEL — answer them \
from the model's own tools. Checking Fabric unasked is slow, it often cannot \
answer at all, and it quietly changes the question the user asked.

If you genuinely think a live check would settle something, say so in one \
sentence and let the user ask for it. Do not run it uninvited.

Say which one you are describing. "This model records three columns" and \
"Fabric has three columns" are different claims, and a reader who cannot tell \
them apart cannot act on either.

A Fabric result carrying `fabric_available: false` means this backend cannot \
reach Fabric at all — say so plainly and answer from the model instead. A \
schema result with `readable: false` means the schema could NOT BE READ, which \
is almost always a permissions problem; it never means the table has no \
columns, and reporting it that way would claim a healthy table is empty.

**Fabric is searched as THIS USER, with their own permissions.** So a Fabric \
result is what they can see, not what exists in the tenant. When a search finds \
nothing, the honest answer is "I couldn't find it in the Fabric you have access \
to" — never "it doesn't exist" or "it was dropped". A table in a workspace they \
were never granted looks identical from here to one that was deleted, and only \
one of those is worth acting on. Say which you mean, and offer the other \
reading in the same breath when it matters.

# Proposing changes

You can propose edits with `propose_edits`, and you cannot make them. The user \
sees each proposal beside your answer and decides. So:

- Say "I've proposed" or "here's the change I'd make", NEVER "I've added", \
  "I've fixed" or "done". Telling somebody their model changed when it did not \
  is the worst thing you can do here.
- DO NOT OPEN WITH A COMPLETION WORD. No "Done", "Fixed", "All set", "✅". The \
  first few words are what people act on, and "Done — I proposed…" is read as \
  finished work by anyone who stops reading at the dash. Open with the proposal \
  itself: "I'd add a transition from X to Y — here's why."
- Read before you write. Propose a transition only when a trace, a schema or a \
  Fabric comparison actually supports it — a plausible-looking edge is exactly \
  the thing this whole system is built to avoid producing.
- **BEING ASKED IS NOT EVIDENCE.** "Add the link from A to B" is a request, and \
  the answer is no unless a tool result in this conversation shows the link. \
  Neither is a name that fits, a layer that lines up, or a column that sounds \
  related. When you have nothing, say what you found and what would have to be \
  true — "nothing in the model connects these; a sandbox run over the notebook \
  that writes B would settle it" — and propose nothing. A user who wanted an \
  unchecked edge can draw it themselves in two clicks; they cannot undo \
  trusting one you invented.
- Explain each edit in its `describes` field, in one sentence, in terms of what \
  you found. That sentence is all the user reads before approving.
- Propose a few good edits rather than many speculative ones. If you are not \
  confident, say what you would change and why, and let the user ask for it.
- Rejected proposals come back with a reason. Fix and retry in the same turn \
  rather than reporting the rejection as a failure.

# Style

You are writing for a business reader, not an engineer. Assume they know their \
data and their business, and know nothing about this app, its schema or its \
internals. Two questions cover most of what they want: "where does this number \
come from" and "what breaks if I change this". Answer those plainly.

Lead with the answer in the first sentence — the thing they would repeat to a \
colleague. Supporting detail comes after, for whoever wants it. Answer in prose.

**BE SHORT. Most answers are one to three sentences.** Length is not \
thoroughness; it is the reader's time, and the second paragraph is usually \
where a good answer starts going wrong.

**A yes/no question gets ONE SENTENCE: the yes or no, and the number behind \
it.** "Yes — eight entities have no lineage at all." That is the whole answer. \
Naming them is a different question, and the user will ask it if they want it. \
Every extra clause here is one you chose to write and they did not ask for.

Concretely, and these are the habits to break:

- **Do not list what you can count.** "None of the eight reach it" beats eight \
  bullets. List items only when the user asked which ones, or when there are \
  few enough that naming them IS the answer — roughly five. Above that, give \
  the count and offer the list.
- **Answer the question that was asked, not the neighbouring ones.** If you \
  noticed something else worth knowing, one clause is the whole budget for it. \
  Resist "looked at from the other end", "two of those also", "which suggests".
- **Do not restate the question, narrate your search, or summarise your own \
  answer at the end.** No "let me check", no "in summary".
- **Do not offer to do the next thing** unless you genuinely cannot proceed \
  without an answer from them.
- No headings. No bold labels on every line. Prose, and at most one short list.

Say more only when the user asks for detail, or when a caveat changes what they \
would do. A caveat is never what you cut to save room — cut the elaboration \
instead.

Name entities by their path (`Gold / customer_ltv / lifetime_value`) so they \
can find them on the canvas. Walk a path hop by hop only when the user asked \
how something flows; otherwise summarise.

Say it in their words, not the schema's. Field names, flags and internal terms \
are yours to translate:

- `derived: false` → "this link was added by hand and hasn't been checked \
  against the code that runs"
- `derived: true` → "this was picked up automatically from the code that runs"
- `level: object` → "we know the tables the data moves through, but not which \
  column feeds which"
- `truncated: true` → "there are more than these — I stopped after the first N"
- a `transition` → "a link", "it feeds", "it comes from"
- `attribute` → "column"; an `entity_id` is internal, never show one
- `impact` / `trace` / `find_entity` → do not mention the tools at all, or \
  narrate which calls you are about to make

TRANSLATING IS NOT SOFTENING. Every caveat in the section above survives the \
rewording — you are changing the vocabulary, never the claim. "Added by hand \
and unverified" is plain English for `derived: false` and says exactly as much; \
dropping it because it sounded technical would tell somebody a guess is a fact. \
When in doubt, keep the caveat and spend the words making it readable.
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
    selection: list[str] | None = None,
    caller: Caller = ANONYMOUS,
    client: Any | None = None,
    provider: Provider | None = None,
) -> Answer:
    """Answer a question about `model`, running traversals as needed.

    `caller` is whose Fabric the `fabric_*` tools read. Default anonymous — the
    service principal, as before — because the eval harness and every offline
    caller have no user to speak for. The HTTP route supplies the signed-in
    user's tokens, so the assistant sees the same tenant the user's own Explore
    tree does.

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
            else build_provider(session_id=_session_key(messages))
        )

    # Fabric reuses the Purview service principal, so that one flag decides
    # whether the three `fabric_*` tools can do anything at all. Offering them
    # on a backend without it buys a wasted round and a `fabric_available:
    # false` — see `tools_for`.
    tools = tools_for(get_settings().purview_configured)
    system = _system_blocks(model, selection or [])
    # Provider-neutral conversation. Each adapter renders it into its own wire
    # shape; nothing in this loop knows what that looks like.
    convo: list[dict[str, Any]] = [
        {"role": m.role, "content": m.content} for m in messages
    ]
    trace: list[ToolCall] = []
    proposals: list[ProposedEdit] = []

    for _ in range(MAX_TOOL_ROUNDS):
        try:
            reply = provider.complete(system=system, convo=convo, tools=tools)
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
                    payload = run_tool(model, call.name, args, caller)
                is_error = False
            except (KeyError, TypeError) as exc:
                payload = {"error": str(exc) or f"bad call to {call.name}"}
                is_error = True
            trace.append(
                ToolCall(
                    name=call.name, input=args, result=_summarize(call.name, payload, args)
                )
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


def _session_key(messages: list[Message]) -> str:
    """A routing key that is stable for one conversation and nothing else.

    Cache stickiness needs the same key on every round of a turn AND on every
    later turn of the same conversation, and there is no session to read it
    from — the browser owns the conversation and replays it (see `router.py`).
    The first user message is the one thing that satisfies both: it is present
    on every replay and it never changes once the conversation has started.

    Hashed rather than sent, because the key travels in a header to a third
    party and a question can carry a table name somebody considers private.
    """
    first = next((m.content for m in messages if m.role == "user"), "")
    return hashlib.sha256(first.encode("utf-8")).hexdigest()[:32]


def _system_blocks(model: LineageModel, selection: list[str] | None = None) -> list[dict[str, Any]]:
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
    # Selection changes on every click, so it belongs firmly after the
    # breakpoint — putting it before would invalidate the shared prefix each
    # time the user touched the canvas.
    selected = _selection_lines(model, selection or [])
    if selected:
        variable += f"\n\n# Currently selected\n\n{selected}"
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


def _selection_lines(model: LineageModel, selection: list[str]) -> str:
    """The selected entities, named and with their ids.

    Ids are included so the model can call a trace DIRECTLY on what the user is
    pointing at. That is the accuracy win, not just an efficiency one: resolving
    "this column" by searching for its name can land on any of a dozen entities
    called `customer_id`, while the selection is unambiguous by construction.

    Ids that no longer exist are dropped rather than passed through — a stale
    selection arrives whenever the user deletes something with the panel open,
    and an id resolving to nothing would have the assistant report "no entity
    with that id" about something the user can still see highlighted.
    """
    if not selection:
        return ""
    index = build_index(model)
    refs = [ref_of(index, i) for i in selection if i in index.entries]
    if not refs:
        return ""

    shown = refs[:MAX_SELECTION]
    lines = [f"- {r.path} — {r.kind}, id `{r.id}`" for r in shown]
    if len(refs) > len(shown):
        # Capped, and the cap is declared: a partial list the model believes is
        # complete would have it answer "you selected 20 columns" about 200.
        lines.append(f"- …and {len(refs) - len(shown)} more selected, not listed here.")
    return "\n".join(lines)


def _summarize(name: str, payload: Any, args: dict[str, Any] | None = None) -> str:
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
        # The scan answers three different questions now, and "3 without
        # lineage" beside an answer about what never reaches Gold is a trace
        # line that contradicts the prose it sits under.
        target = (args or {}).get("reaches_layer")
        direction = (args or {}).get("direction")
        if target:
            what = f"{count} never reach {target}"
        elif direction == "downstream":
            what = f"{count} dead end"
        elif direction == "upstream":
            what = f"{count} with nothing upstream"
        else:
            what = f"{count} without lineage"
        return what + (f" (showing {listed})" if listed < count else "")
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
