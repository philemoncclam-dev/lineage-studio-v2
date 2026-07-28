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

from . import analysis, fabric_tools, graph
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
            "(columns) by name. Matches substrings, so 'amount' also finds "
            "'amount_usd'; exact matches are listed first. START HERE — the "
            "other tools take an entity id, and this is the only place ids come "
            "from. Every result carries its full path, so two columns with the "
            "same name in different tables are told apart rather than merged."
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
            "it. The edge counts answer 'does this have lineage at all' without "
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
            "List entities with NO transition at either end — the actual gaps "
            "in this model's lineage. A column with an inbound edge and none "
            "outbound is a leaf, not a gap, and is excluded; so are layers and "
            "groups, which are containers rather than data. Use this for "
            "'which columns have no lineage', not a trace."
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

TOOL_NAMES = {t["name"] for t in TOOLS}


def run_tool(model: LineageModel, name: str, args: dict[str, Any]) -> Any:
    """Execute one tool call against `model`, returning JSON-ready data.

    Raises `KeyError` for an unknown tool and `TypeError` for a malformed
    argument; the caller turns both into an error tool result rather than an
    exception, so a model that sends a bad call gets a chance to correct it.
    """
    if name not in TOOL_NAMES:
        raise KeyError(name)

    if name in fabric_tools.TOOL_NAMES:
        return fabric_tools.run_tool(model, name, args)

    if name == "find_entity":
        results = graph.find_entity(
            model,
            name=_str(args, "name", required=True),
            kind=_str(args, "kind"),  # type: ignore[arg-type]
            layer=_str(args, "layer"),
        )
        # An empty list is a real answer ("nothing by that name"), but a bare
        # `[]` reads as a failed call. Say which it is.
        return {
            "matches": [r.model_dump() for r in results],
            "count": len(results),
        }

    if name in ("trace_downstream", "trace_upstream"):
        fn = graph.trace_downstream if name == "trace_downstream" else graph.trace_upstream
        return fn(
            model,
            entity_id=_str(args, "entity_id", required=True),
            to_layer=_str(args, "to_layer"),
        ).model_dump()

    if name == "lineage_gaps":
        return analysis.unconnected(
            model,
            kind=_str(args, "kind"),  # type: ignore[arg-type]
            layer=_str(args, "layer"),
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
                names.append(obj.name)
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
