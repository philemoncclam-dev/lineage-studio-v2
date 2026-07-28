"""Whole-model scans — the questions `graph.py` cannot express.

`graph.py` answers questions that start somewhere: given this column, where does
it go. A different and equally common class of question starts nowhere and asks
about the model as a whole — which columns have no lineage at all, how much of
Gold is actually traced, what breaks if this table goes away. Those are scans,
not walks, and they live here rather than in `graph.py` so each module stays one
idea: walks from a point, versus sweeps over everything.

**Impact is reachability, not paths, and that is the whole reason it exists.**
`trace_downstream` enumerates simple paths and caps at twelve, because a fanning
graph has exponentially many of them. Ask it "what breaks if I drop this" and
you get twelve paths and a truncation flag — from which nobody can tell how many
distinct things are actually affected, and the honest answer is understated in a
direction that matters. A reachable SET has no such blow-up: each entity is
visited once, so the count is complete and cheap. The two coexist because they
answer different questions — one is "how does it get there", the other is "what
is downstream of this, all of it".

**"No lineage" means no edges at either end.** A column with an inbound edge and
no outbound one is not unlineaged, it is a leaf, and reporting it as a gap would
bury the real gaps under every terminal column in Gold. `unconnected` is
therefore strict: nothing in, nothing out.

**Coverage counts hand-drawn edges separately.** An edge the sandbox derived
carries `Source`; one a person drew carries nothing. A single "247 transitions"
figure lets a model that is 90% unverified assertion read as a well-traced one,
which is exactly the reassurance nobody should be given.
"""

from __future__ import annotations

from collections import deque
from typing import Literal

from pydantic import BaseModel, Field, computed_field

from .graph import SOURCE_KEY, EntityKind, EntityRef, build_index, ref_of
from .model import LineageModel

#: Scans return entity lists, and a model can be large. These bound the payload
#: the assistant is handed; `truncated` says when one bit, so a capped list is
#: never mistaken for the complete set.
MAX_LISTED = 40

#: Reachability visits each entity once, so this is generous — it exists to
#: bound the response size, not to stop a blow-up (there isn't one).
MAX_REACHED = 500

Direction = Literal["downstream", "upstream"]


class EntityCount(BaseModel):
    total: int = 0
    #: Has at least one transition at either end.
    with_lineage: int = 0

    # computed_field, not a bare property: this has to survive `model_dump()`.
    # It is the number the question actually asks for ("how many columns have
    # no lineage"), and a plain property is silently dropped on serialisation —
    # the assistant would receive a coverage report with the answer missing and
    # would have to subtract two figures itself.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def without_lineage(self) -> int:
        return self.total - self.with_lineage


class LayerCoverage(BaseModel):
    layer: str
    objects: EntityCount = Field(default_factory=EntityCount)
    attributes: EntityCount = Field(default_factory=EntityCount)


class Coverage(BaseModel):
    """How much of this model is actually traced, and how much is asserted."""

    layers: list[LayerCoverage] = Field(default_factory=list)
    objects: EntityCount = Field(default_factory=EntityCount)
    attributes: EntityCount = Field(default_factory=EntityCount)
    transitions: int = 0
    #: Carry a `Source` — something derived them from a notebook or pipeline.
    derived_transitions: int = 0
    #: Carry nothing. Real edges, but never checked against any code.
    hand_drawn_transitions: int = 0
    #: Edges whose endpoints no longer exist. They are dropped from every walk,
    #: so a model can look fine while a chunk of its lineage silently does
    #: nothing — this is the only place that shows up.
    dangling_transitions: int = 0


class UnconnectedResult(BaseModel):
    entities: list[EntityRef] = Field(default_factory=list)
    #: The true total, even when `entities` was capped.
    count: int = 0
    truncated: bool = False
    note: str | None = None


class ImpactResult(BaseModel):
    start: EntityRef
    direction: Direction
    #: Everything reachable, capped for payload size — see `count` for the total.
    reached: list[EntityRef] = Field(default_factory=list)
    #: Complete tally by layer name, never capped. This is the headline number.
    by_layer: dict[str, int] = Field(default_factory=dict)
    count: int = 0
    truncated: bool = False
    note: str | None = None


def coverage(model: LineageModel) -> Coverage:
    """Per-layer and whole-model lineage coverage, plus edge provenance."""
    index = build_index(model)
    result = Coverage()

    touched = set(index.out_edges) | set(index.in_edges)

    for layer in model.layers:
        row = LayerCoverage(layer=layer.name)
        for obj in layer.objects:
            row.objects.total += 1
            if obj.id in touched:
                row.objects.with_lineage += 1
            for attr_id in _descendant_attribute_ids(index, obj.id):
                row.attributes.total += 1
                if attr_id in touched:
                    row.attributes.with_lineage += 1
        result.layers.append(row)
        result.objects.total += row.objects.total
        result.objects.with_lineage += row.objects.with_lineage
        result.attributes.total += row.attributes.total
        result.attributes.with_lineage += row.attributes.with_lineage

    for transition in model.transitions:
        # Count against the model's own list, not the index: the index has
        # already dropped dangling edges, and those are worth surfacing.
        if transition.id not in index.edges:
            result.dangling_transitions += 1
            continue
        result.transitions += 1
        if (model.properties.get(transition.id, {}).get(SOURCE_KEY) or None) is not None:
            result.derived_transitions += 1
        else:
            result.hand_drawn_transitions += 1

    return result


def unconnected(
    model: LineageModel,
    kind: EntityKind | None = None,
    layer: str | None = None,
    limit: int = MAX_LISTED,
) -> UnconnectedResult:
    """Entities with no transition at either end — the actual lineage gaps."""
    index = build_index(model)
    wanted_layer = layer.strip().lower() if layer else None

    found: list[EntityRef] = []
    for entry in index.entries.values():
        if kind and entry.kind != kind:
            continue
        # Two kinds of entity are containers rather than data, and neither is a
        # lineage gap when it has no edges of its own. Including them drowns the
        # columns that are the real answer:
        #   - a LAYER, because layer-to-layer transitions are legal but rare, so
        #     every layer in the model would be reported;
        #   - a GROUP (an attribute with children), because it is a folder over
        #     columns and the columns inside it are what "has lineage" means.
        # An explicit `kind` overrides the layer exclusion — if you asked for
        # layers, you want them — but a group is never data, so it stays out.
        if not kind and entry.kind == "layer":
            continue
        if entry.kind == "attribute" and entry.child_ids:
            continue
        if wanted_layer and entry.layer_name.strip().lower() != wanted_layer:
            continue
        if index.out_edges.get(entry.id) or index.in_edges.get(entry.id):
            continue
        found.append(ref_of(index, entry.id))

    found.sort(key=lambda r: r.path)
    truncated = len(found) > limit
    return UnconnectedResult(
        entities=found[:limit],
        count=len(found),
        truncated=truncated,
        note=(
            f"Showing {limit} of {len(found)}."
            if truncated
            else ("Every entity of that kind has at least one transition." if not found else None)
        ),
    )


def impact(
    model: LineageModel,
    entity_id: str,
    direction: Direction = "downstream",
    limit: int = MAX_LISTED,
    max_reached: int = MAX_REACHED,
) -> ImpactResult:
    """Everything reachable from an entity — the complete set, not paths.

    `by_layer` is a full tally even when the listed entities are capped, because
    the number is the answer and the list is only illustration.
    """
    index = build_index(model)
    if entity_id not in index.entries:
        return ImpactResult(
            start=EntityRef(id=entity_id, name="", kind="object"),
            direction=direction,
            note=f"No entity with id {entity_id!r} in this model.",
        )

    adj = index.out_edges if direction == "downstream" else index.in_edges
    seen: set[str] = {entity_id}
    order: list[str] = []
    queue: deque[str] = deque([entity_id])
    truncated = False

    while queue:
        node = queue.popleft()
        for transition_id in adj.get(node, []):
            src, tgt = index.edges[transition_id]
            nxt = tgt if direction == "downstream" else src
            if nxt in seen:
                continue
            if len(order) >= max_reached:
                truncated = True
                continue
            seen.add(nxt)
            order.append(nxt)
            queue.append(nxt)

    by_layer: dict[str, int] = {}
    for reached_id in order:
        name = index.entries[reached_id].layer_name or "(no layer)"
        by_layer[name] = by_layer.get(name, 0) + 1

    refs = [ref_of(index, i) for i in order]
    refs.sort(key=lambda r: r.path)

    word = "depends on" if direction == "downstream" else "feeds"
    return ImpactResult(
        start=ref_of(index, entity_id),
        direction=direction,
        reached=refs[:limit],
        by_layer=by_layer,
        count=len(order),
        truncated=truncated,
        note=(
            f"Nothing {word} {index.entries[entity_id].name!r} in this model."
            if not order
            else (f"Listing {limit} of {len(order)}; the counts are complete." if len(order) > limit else None)
        ),
    )


def _descendant_attribute_ids(index, object_id: str) -> list[str]:
    """Every LEAF attribute under an object, at any depth.

    Two rules, and both change the number:

    Descends recursively, because a group is an attribute with children — a
    one-level read would exclude every grouped column, and coverage that
    quietly omits half the columns reports a better number than the model
    deserves.

    Counts leaves only, because a group is a folder rather than data. Counting
    it as a column with no lineage penalises the model for its own structure,
    and it is the same rule `unconnected` applies — the two must agree, or the
    gap list and the coverage figure describe different models.
    """
    out: list[str] = []
    stack = list(index.entries[object_id].child_ids)
    while stack:
        attr_id = stack.pop()
        entry = index.entries[attr_id]
        if entry.kind != "attribute":
            continue
        if entry.child_ids:
            stack.extend(entry.child_ids)
            continue
        out.append(attr_id)
    return out
