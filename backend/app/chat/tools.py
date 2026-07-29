"""The tool surface the assistant is given, and the dispatch behind it.

Every tool here is a thin adapter over `graph.py`. That is the whole design:
the model chooses WHICH question to ask and phrases the answer, and Python
computes the answer. There is no tool that lets the model assert a fact about
the graph — only ones that make it read.

Two rules the schemas exist to enforce, because both are places a language model
will otherwise fill a gap by inventing something plausible:

**An entity is addressed by id, and ids come from `find_entity`.** The traversal
tools take `entity_id`, never a name. A model that guesses an id gets a clean
"no entity with that id" back rather than a confidently wrong answer about some
other column. This costs a round trip on the first question and is worth it: a
name is not unique in a lineage model — `id` is on a dozen tables — and a name-
addressed trace would silently pick one.

**Results are returned verbatim as JSON, not summarised.** The dispatch does no
filtering, ranking or prose. Whatever `graph.py` computed — including its
`note`, its `level` and its `truncated` flag — reaches the model intact, so the
distinctions phase 1 was careful to preserve are still there to be reported.
"""

from __future__ import annotations

from typing import Any

from . import analysis, edits, fabric_tools, graph
from .model import LineageModel

#: How much of the model's shape is inlined in the system prompt before it is
#: cut off. A large model would otherwise spend more tokens on an outline the
#: question does not need than on the answer.
OUTLINE_MAX_OBJECTS = 120


TOOLS: list[dict[str, Any]] = [
    {
        "name": "find_entity",
        "description": (
            "Find layers, objects (tables, notebooks, pipelines) or attributes "
            "(columns) by name. Forgiving: case, spaces, underscores and simple "
            "plurals are ignored ('customer id' finds 'Customer_ID', 'orders' "
            "finds 'order'), substrings match ('amount' finds 'amount_usd'), "
            "and a near-miss comes back under `did_you_mean`. START HERE — the "
            "other tools take an entity id, and this is the only place ids come "
            "from. Every result carries its full path, so two columns with the "
            "same name in different tables are told apart rather than merged. "
            "LEAVE `kind` AND `layer` UNSET unless the user was explicit: a "
            "name in a question can be a layer, a table or a column, and "
            "guessing wrong returns nothing, which is not the same as there "
            "being nothing. `matched` says how it matched — `none` with "
            "suggestions means ask, not report an absence."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name or partial name to search for.",
                },
                "kind": {
                    "type": "string",
                    "enum": ["layer", "object", "attribute"],
                    "description": (
                        "Restrict to one level. 'object' is a table, notebook or "
                        "pipeline; 'attribute' is a column. Omit to search all."
                    ),
                },
                "layer": {
                    "type": "string",
                    "description": "Restrict to one layer, e.g. 'Gold'.",
                },
            },
            "required": ["name"],
        },
    },
    {
        "name": "trace_downstream",
        "description": (
            "Where an entity's data GOES — the 'how does this reach gold' "
            "direction. Returns every path from it, each hop carrying the "
            "transform that produced it where one is recorded, and whether the "
            "edge was derived by the sandbox or drawn by hand."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "An id from find_entity. Never guess one.",
                },
                "to_layer": {
                    "type": "string",
                    "description": (
                        "Stop at the first entity in this layer, e.g. 'Gold'. "
                        "Omit to walk all the way to the end."
                    ),
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "trace_upstream",
        "description": (
            "Where an entity's data CAME FROM — the 'what feeds this' direction. "
            "Same shape as trace_downstream, walking against the arrows."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "An id from find_entity. Never guess one.",
                },
                "to_layer": {
                    "type": "string",
                    "description": "Stop at the first entity in this layer.",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "describe_entity",
        "description": (
            "One entity's context: where it sits, its properties (source, step, "
            "data type, tags…), its children, and how many edges enter and leave "
            "it. This is the answer to 'what's in X' for any X — a layer's "
            "objects, a table's columns, a group's members are all `children`. "
            "The edge counts answer 'does this have lineage at all' without "
            "running a trace — a column with zero of both has none recorded, "
            "which is different from a trace that found no complete path."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "An id from find_entity. Never guess one.",
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "lineage_gaps",
        "description": (
            "The gaps in this model's lineage, as ONE scan — never a trace per "
            "entity. By default: entities with no transition at either end "
            "(layers and groups are containers, and are excluded). Narrow it "
            "with `direction` for dead ends or roots, and with `reaches_layer` "
            "for 'which of these never end up in X'. Any question of the form "
            "'which ones don't reach / aren't used in / don't feed <layer>' is "
            "this tool with `reaches_layer` set — one call, complete answer."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["layer", "object", "attribute"],
                    "description": "Restrict to one level. 'attribute' means columns.",
                },
                "layer": {"type": "string", "description": "Restrict to one layer."},
                "direction": {
                    "type": "string",
                    "enum": ["either", "downstream", "upstream"],
                    "description": (
                        "What counts as a gap. 'either' (default) is nothing in "
                        "AND nothing out; 'downstream' is dead ends — the data "
                        "arrives and stops; 'upstream' is entities nothing feeds."
                    ),
                },
                "reaches_layer": {
                    "type": "string",
                    "description": (
                        "Return only entities with NO path into this layer, at "
                        "any number of hops. Overrides `direction`: an entity "
                        "with plenty of edges that still never arrives is "
                        "exactly what this asks for. Entities already IN that "
                        "layer count as arrived — set `layer` to where you are "
                        "asking FROM."
                    ),
                },
            },
        },
    },
    {
        "name": "impact",
        "description": (
            "EVERYTHING reachable from an entity, as a complete set — use this "
            "for 'what breaks if I drop this' or 'how much depends on this'. "
            "Prefer it over trace_downstream whenever the question is about "
            "how MUCH is affected rather than how the data gets there: a trace "
            "enumerates paths and caps at a dozen, so it understates the blast "
            "radius on any graph that fans out. The per-layer counts here are "
            "complete even when the listed entities are capped."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "An id from find_entity. Never guess one.",
                },
                "direction": {
                    "type": "string",
                    "enum": ["downstream", "upstream"],
                    "description": (
                        "'downstream' is what depends on it (the default); "
                        "'upstream' is everything that feeds it."
                    ),
                },
            },
            "required": ["entity_id"],
        },
    },
    {
        "name": "coverage",
        "description": (
            "How much of this model is traced, per layer and overall, plus how "
            "many transitions were DERIVED by the sandbox versus drawn by hand. "
            "Answers 'how complete is this model' and 'how much of this is "
            "verified'. Also reports dangling transitions — edges whose "
            "endpoints no longer exist, which every trace silently skips."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
]

# Fabric tools are appended rather than interleaved so the model-reading tools
# stay first in the list and first in the prompt. They are also the ones it
# should reach for by default: a question is about the authored model unless it
# is explicitly about the live tenant.
TOOLS += fabric_tools.TOOLS

# The one tool that changes anything — and it does not change anything either.
# Last in the list, because proposing an edit is what happens after reading, and
# an assistant that reaches for it first has skipped the reading.
TOOLS += edits.TOOLS

TOOL_NAMES = {t["name"] for t in TOOLS}


def run_tool(
    model: LineageModel,
    name: str,
    args: dict[str, Any],
    caller: fabric_tools.Caller = fabric_tools.ANONYMOUS,
) -> Any:
    """Execute one tool call against `model`, returning JSON-ready data.

    Raises `KeyError` for an unknown tool and `TypeError` for a malformed
    argument; the caller turns both into an error tool result rather than an
    exception, so a model that sends a bad call gets a chance to correct it.

    `caller` reaches only the Fabric tools. Everything else reads the model
    document in the request body, which the browser already holds — there is no
    access question to ask about data the asker sent us.
    """
    if name not in TOOL_NAMES:
        raise KeyError(name)

    if name in fabric_tools.TOOL_NAMES:
        return fabric_tools.run_tool(model, name, args, caller)

    if name in edits.TOOL_NAMES:
        return edits.run_tool(model, name, args)

    if name == "find_entity":
        found = graph.resolve(
            model,
            name=_str(args, "name", required=True),
            kind=_str(args, "kind"),  # type: ignore[arg-type]
            layer=_str(args, "layer"),
        )
        payload = {
            "matches": [r.model_dump() for r in found.matches],
            "count": found.count,
            # HOW it matched, not just that it did. `fuzzy` suggestions are
            # guesses and are labelled as such; `none` with suggestions is "did
            # you mean", which is a different answer from "there is no such
            # thing" and must not be reported as one.
            "matched": found.how,
        }
        if found.suggestions:
            payload["did_you_mean"] = [r.model_dump() for r in found.suggestions]
        if found.note:
            payload["note"] = found.note
        if not found.matches and not found.suggestions:
            # The only genuine absence: an unfiltered search of every layer,
            # object and column found nothing close. Said in words, because an
            # empty list is what a caller misreads as a failed call.
            payload["note"] = found.note or (
                "Nothing in this model has a name like that, at any level. "
                f"Its layers are: {', '.join(graph.layer_names(model)) or '(none)'}."
            )
        return payload

    if name in ("trace_downstream", "trace_upstream"):
        fn = graph.trace_downstream if name == "trace_downstream" else graph.trace_upstream
        return fn(
            model,
            entity_id=_str(args, "entity_id", required=True),
            to_layer=_layer(model, args, "to_layer"),
        ).model_dump()

    if name == "lineage_gaps":
        return analysis.unconnected(
            model,
            kind=_str(args, "kind"),  # type: ignore[arg-type]
            layer=_layer(model, args, "layer"),
            direction=_str(args, "direction"),
            reaches_layer=_layer(model, args, "reaches_layer"),
        ).model_dump()

    if name == "impact":
        return analysis.impact(
            model,
            entity_id=_str(args, "entity_id", required=True),
            direction=_str(args, "direction") or "downstream",  # type: ignore[arg-type]
        ).model_dump()

    if name == "coverage":
        return analysis.coverage(model).model_dump()

    detail = graph.describe_entity(model, _str(args, "entity_id", required=True))
    if detail is None:
        return {"error": "No entity with that id exists in this model."}
    return detail.model_dump()


def _layer(model: LineageModel, args: dict[str, Any], key: str) -> str | None:
    """A layer argument, matched to a real layer — or a correction, not silence.

    This is the fix for the worst failure this tool surface had. A user asks
    "what's in Bronze"; `Bronze` is a TABLE, not a layer; the assistant filters
    a scan by `layer="Bronze"`, matches no layer, and gets an empty result back
    — which it reports as "there is nothing in Bronze". The model was right
    there, one unfiltered search away, and the answer said it did not exist.

    A filter that matches no layer is a MISTAKE IN THE CALL, so it comes back as
    a tool error naming the layers that do exist and, when the name belongs to
    something else, saying what that something is. The model gets a round to fix
    it; the user never sees an absence that was really a typo.

    Case and punctuation are forgiven — `gold`, `Gold` and `GOLD` are one layer.
    """
    wanted = _str(args, key)
    if wanted is None:
        return None
    canonical = graph.resolve_layer(model, wanted)
    if canonical:
        return canonical

    names = graph.layer_names(model)
    elsewhere = [r for r in graph.resolve(model, wanted).matches if r.kind != "layer"]
    hint = ""
    if elsewhere:
        first = elsewhere[0]
        hint = (
            f" But {first.path} is {'an' if first.kind == 'object' else 'a'} "
            f"{first.kind} of that name — call find_entity({wanted!r}) and use "
            f"its id with describe_entity or impact instead of filtering by layer."
        )
    raise TypeError(
        f"There is no layer called {wanted!r} in this model. Its layers are: "
        f"{', '.join(names) or '(none)'}.{hint}"
    )


def _str(args: dict[str, Any], key: str, *, required: bool = False) -> str | None:
    value = args.get(key)
    if value is None or value == "":
        if required:
            raise TypeError(f"{key!r} is required")
        return None
    if not isinstance(value, str):
        raise TypeError(f"{key!r} must be a string, got {type(value).__name__}")
    return value


def outline(model: LineageModel, max_objects: int = OUTLINE_MAX_OBJECTS) -> str:
    """A compact map of the model, for the system prompt.

    Orientation the assistant would otherwise have to spend a tool call on:
    which layers exist and roughly what is in them. Columns are deliberately
    NOT listed — they are the bulk of a model and the thing `find_entity`
    exists to look up — and the listing is capped, with the cap declared, so a
    truncated outline is never mistaken for a complete inventory.

    Tags ARE listed, and they are the one thing here that earns its tokens
    twice. A sandbox import tags every object `Table`, `Notebook` or
    `Pipeline`, so the tag is how this model records what an object IS — the
    backend `ModelObject` has no kind field. Without them "which notebooks
    write to Gold" costs a search that the map could have answered. They also
    carry the classifications a business reader actually asks about (PII,
    Certified), and those are stable orientation rather than facts to trace.

    The line between what belongs here and what does not is worth stating,
    because it is the line the whole design rests on: this is a MAP, not a
    source of facts. Anything listed here is something the model can answer
    from WITHOUT calling a tool, which puts it beyond the reach of `trace` and
    outside `Answer.trace` where nobody can check it. Names and tags are safe
    because they are labels. Lineage never is.
    """
    if not model.layers:
        return "This model is empty — it has no layers."

    lines: list[str] = []
    shown = 0
    hidden = 0
    for layer in model.layers:
        names: list[str] = []
        for obj in layer.objects:
            if shown < max_objects:
                tags = (model.properties.get(obj.id) or {}).get("Tags", "").strip()
                names.append(f"{obj.name} [{tags}]" if tags else obj.name)
                shown += 1
            else:
                hidden += 1
        summary = ", ".join(names) if names else "(nothing listed)"
        lines.append(f"- {layer.name} ({len(layer.objects)}): {summary}")

    if hidden:
        lines.append(
            f"({hidden} more objects are not listed here — use find_entity to reach them.)"
        )
    return "\n".join(lines)


#: The tools that read LIVE FABRIC rather than the authored model. Grouped
#: because they share a fate: they all need the Purview service principal, and
#: without it every one of them can only answer `fabric_available: false`.
FABRIC_TOOLS = frozenset({"fabric_search", "fabric_table_schema", "compare_to_fabric"})


def tools_for(fabric_configured: bool) -> list[dict[str, Any]]:
    """The tool surface this deployment can actually serve.

    Offering a tool that cannot work is not neutral. The model reaches for
    Fabric on questions that merely *sound* like they are about what is live —
    "should I add this edge" reads as "is the model still true" — and on a
    backend with no credentials that costs a full extra round to be told
    nothing, twice over if it retries. Measured on the eval: the two questions
    where it reached for Fabric unprompted took 34s and 30s against a ~10s
    median.

    Removing the tools removes the temptation structurally, which is worth more
    than asking the model nicely in a prompt it reads once per round. It also
    drops ~700 tokens from a prefix that is re-sent 3-8 times per question.

    Safe for prompt caching: the answer depends only on deployment config, so
    the tool list is byte-identical across every request this process serves.
    A per-REQUEST tool set would invalidate the cached prefix every time and
    cost far more than it saved.
    """
    if fabric_configured:
        return TOOLS
    return [t for t in TOOLS if t["name"] not in FABRIC_TOOLS]
