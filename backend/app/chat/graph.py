"""Lineage traversal — the query engine the assistant asks, not the answer itself.

The whole point of this module is that **the graph walk is deterministic**. An
LLM turning "how does this column reach gold" into a call, and a returned path
into a sentence, is a job a language model does well; walking a directed graph
without inventing a plausible-looking hop is not. So every path here is computed,
capped and cycle-guarded in Python, and the model only ever sees results it
cannot fabricate.

Nothing in this module imports an LLM client or reads a credential. It is a pure
function of the model document, which also makes it the query engine for
anything else that wants to ask the graph a question.

Three behaviours are worth knowing before reading the code, because each one is
a place the obvious implementation is quietly wrong:

**Falling back from column level to table level.** A transition can connect any
two entities, so a column may have no attribute-to-attribute edge while its
TABLES are connected object-to-object. That is not a hypothetical: it is exactly
what a DataFrame-authored notebook produces, where table lineage is recovered
but column lineage is not. Returning "no path" there would be wrong — the answer
exists, it is just coarser. `trace_*` retries from the owning object and says so
via `level` and `note`, so the assistant reports a table-level answer as a
table-level answer instead of silently implying column lineage it does not have.

**Provenance per hop.** An edge the sandbox derived carries `Source`; an edge a
user drew by hand carries nothing. Both are equally real to the graph, and a
consumer that cannot tell them apart will report a stale hand-drawn claim with
the same confidence as a machine-derived one. `Hop.derived` is that distinction,
carried out to every caller.

**Simple paths only, with caps.** A lineage graph fans out; enumerating every
walk is exponential. Paths never revisit an entity, depth and count are bounded,
and `truncated` says when a bound was hit rather than pretending the answer was
complete.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Callable, Literal

from pydantic import BaseModel, Field

from .model import Attribute, LineageModel

#: Property keys the traversal reads off a TRANSITION. See `model.py`.
TRANSFORM_KEY = "Transform"
SOURCE_KEY = "Source"
VIA_KEY = "Via"

#: A path may not revisit an entity, but a lineage graph still fans out fast.
#: These bound the search; `truncated` reports when one bit.
MAX_PATHS = 12
MAX_DEPTH = 16

EntityKind = Literal["layer", "object", "attribute"]
Level = Literal["attribute", "object", "mixed"]


# --- the shapes a caller gets back -----------------------------------------


class EntityRef(BaseModel):
    """An entity, resolved enough to name in an answer and select on a canvas.

    `id` is what a consumer highlights with; `path` is what it says out loud.
    """

    id: str
    name: str
    kind: EntityKind
    #: Owning layer name — `""` when the entity IS a layer.
    layer: str = ""
    #: Owning object name — `""` for a layer or an object.
    object: str = ""
    #: `Bronze / bronze_orders / amount`, including any groups it nests under.
    path: str = ""


class Hop(BaseModel):
    """One edge of a traced path, with everything known about why it exists."""

    transition_id: str
    source: EntityRef
    target: EntityRef
    #: The producing expression, when the deriving engine knew it —
    #: `amount * 1.1`. Absent on a hand-drawn edge unless someone typed it.
    transform: str | None = None
    #: Who authored the edge (`Fabric sandbox`), or None when nothing claims it.
    source_of_claim: str | None = None
    #: The step the edge came from, when one was recorded.
    via: str | None = None
    #: False means HAND-AUTHORED — real, but never checked against a notebook.
    #: A consumer that ignores this reports stale hand-drawn lineage as fact.
    derived: bool = False


class Path(BaseModel):
    hops: list[Hop] = Field(default_factory=list)
    #: `attribute` when every entity on the path is a column — the answer the
    #: question usually wants. `object` is the table-level fallback.
    level: Level = "attribute"


class TraceResult(BaseModel):
    start: EntityRef
    paths: list[Path] = Field(default_factory=list)
    #: The coarsest level any returned path is at, so a caller can lead with it.
    level: Level | None = None
    #: Set when the search was answered at a coarser level than asked, or when
    #: nothing was found. Written for a reader, not for a parser.
    note: str | None = None
    #: A depth or count bound was hit — the paths are real but not exhaustive.
    truncated: bool = False


class EntityDetail(BaseModel):
    entity: EntityRef
    properties: dict[str, str] = Field(default_factory=dict)
    #: Direct edge counts, so a caller can tell "no lineage" from "not traced".
    upstream_count: int = 0
    downstream_count: int = 0
    #: An object's columns, or a group's children.
    children: list[EntityRef] = Field(default_factory=list)
    #: The expression that produces this entity, off its inbound edges.
    #:
    #: It lives on the TRANSITION, not on the column, so "what transform makes
    #: this?" used to be answerable only by a trace. Ask `describe_entity` and
    #: the properties came back without it — and a model that had just been told
    #: "one upstream source, no transform in the properties" reported the
    #: expression as NOT RECORDED. That is a false absence about data the model
    #: holds, which is worse than a missing answer: it tells someone their
    #: lineage is undocumented when it is documented one hop away.
    transforms: list[str] = Field(default_factory=list)


# --- the index -------------------------------------------------------------


@dataclass
class _Entry:
    id: str
    name: str
    kind: EntityKind
    layer_id: str = ""
    layer_name: str = ""
    object_id: str = ""
    object_name: str = ""
    #: Full display path, outermost first.
    trail: list[str] = field(default_factory=list)
    child_ids: list[str] = field(default_factory=list)


@dataclass
class _Index:
    """Flattened entity lookup plus adjacency, built once per model."""

    entries: dict[str, _Entry] = field(default_factory=dict)
    out_edges: dict[str, list[str]] = field(default_factory=dict)
    in_edges: dict[str, list[str]] = field(default_factory=dict)
    #: transition id -> (source, target)
    edges: dict[str, tuple[str, str]] = field(default_factory=dict)


def build_index(model: LineageModel) -> _Index:
    """Flatten the hierarchy and the edge list into lookups.

    Attributes are walked RECURSIVELY — a group is an attribute with children,
    so a one-level read would miss every column nested under one.

    **Built once per document.** Every entry point here calls this, so answering
    one question used to flatten the same model a dozen times over — once per
    tool call, on a document that arrived whole in the request body and cannot
    change while the turn runs. The result is cached on the document itself
    (`LineageModel._index`), which is why a model must not be mutated in place
    while anything holds an index of it; nothing in this package does.
    """
    cached = getattr(model, "_index", None)
    if isinstance(cached, _Index):
        return cached

    index = _Index()

    def add_attributes(
        attrs: list[Attribute],
        layer_id: str,
        layer_name: str,
        object_id: str,
        object_name: str,
        trail: list[str],
    ) -> list[str]:
        ids: list[str] = []
        for attr in attrs:
            here = [*trail, attr.name]
            entry = _Entry(
                id=attr.id,
                name=attr.name,
                kind="attribute",
                layer_id=layer_id,
                layer_name=layer_name,
                object_id=object_id,
                object_name=object_name,
                trail=here,
            )
            index.entries[attr.id] = entry
            entry.child_ids = add_attributes(
                attr.children, layer_id, layer_name, object_id, object_name, here
            )
            ids.append(attr.id)
        return ids

    for layer in model.layers:
        index.entries[layer.id] = _Entry(
            id=layer.id,
            name=layer.name,
            kind="layer",
            layer_id=layer.id,
            layer_name=layer.name,
            trail=[layer.name],
            child_ids=[o.id for o in layer.objects],
        )
        for obj in layer.objects:
            trail = [layer.name, obj.name]
            entry = _Entry(
                id=obj.id,
                name=obj.name,
                kind="object",
                layer_id=layer.id,
                layer_name=layer.name,
                object_id=obj.id,
                object_name=obj.name,
                trail=trail,
            )
            index.entries[obj.id] = entry
            entry.child_ids = add_attributes(
                obj.children, layer.id, layer.name, obj.id, obj.name, trail
            )

    for t in model.transitions:
        # An edge to or from an entity that no longer exists is dropped rather
        # than followed: properties outlive their entity by design, and a
        # dangling endpoint would otherwise walk into a node with no name.
        if t.source not in index.entries or t.target not in index.entries:
            continue
        index.edges[t.id] = (t.source, t.target)
        index.out_edges.setdefault(t.source, []).append(t.id)
        index.in_edges.setdefault(t.target, []).append(t.id)

    try:
        model._index = index
    except (AttributeError, ValueError):  # pragma: no cover - a stand-in model
        # A caller may pass something LineageModel-shaped that has no slot for
        # this. Losing the cache is a slower answer, never a wrong one.
        pass
    return index


def _ref(index: _Index, entity_id: str) -> EntityRef:
    e = index.entries[entity_id]
    return EntityRef(
        id=e.id,
        name=e.name,
        kind=e.kind,
        layer=e.layer_name if e.kind != "layer" else "",
        object=e.object_name if e.kind == "attribute" else "",
        path=" / ".join(e.trail),
    )


def ref_of(index: _Index, entity_id: str) -> EntityRef:
    """Public seam over `_ref`, for `analysis.py`.

    The scans in that module walk the same index and must name entities the
    same way — a coverage report that spelled a path differently from a trace
    would read as two different entities.
    """
    return _ref(index, entity_id)


def _hop(model: LineageModel, index: _Index, transition_id: str, reverse: bool) -> Hop:
    src, tgt = index.edges[transition_id]
    props = model.properties.get(transition_id, {})
    claim = props.get(SOURCE_KEY) or None
    # Direction is the EDGE's direction, always — an upstream trace walks
    # against the arrows but must not report them backwards, or the transform
    # would read as applying in the wrong direction.
    return Hop(
        transition_id=transition_id,
        source=_ref(index, src),
        target=_ref(index, tgt),
        transform=props.get(TRANSFORM_KEY) or None,
        source_of_claim=claim,
        via=props.get(VIA_KEY) or None,
        derived=claim is not None,
    )


def _level_of(index: _Index, ids: list[str]) -> Level:
    kinds = {index.entries[i].kind for i in ids if i in index.entries}
    if kinds == {"attribute"}:
        return "attribute"
    if kinds == {"object"}:
        return "object"
    return "mixed"


# --- search ----------------------------------------------------------------


def _search(
    model: LineageModel,
    index: _Index,
    start: str,
    downstream: bool,
    is_goal: Callable[[str], bool],
    max_paths: int,
    max_depth: int,
) -> tuple[list[Path], bool]:
    """Every simple path from `start` to a goal, bounded.

    Simple = no entity twice, which is what makes a cyclic model terminate
    instead of looping. Returns `(paths, truncated)`.
    """
    adj = index.out_edges if downstream else index.in_edges
    found: list[Path] = []
    truncated = False

    def walk(node: str, hops: list[str], seen: set[str]) -> None:
        nonlocal truncated
        if len(found) >= max_paths:
            truncated = True
            return
        # The start is never its own goal — a path has to go somewhere.
        if hops and is_goal(node):
            ids = [start, *[_other(index, h, downstream) for h in hops]]
            found.append(
                Path(
                    hops=[_hop(model, index, h, not downstream) for h in hops],
                    level=_level_of(index, ids),
                )
            )
            return
        if len(hops) >= max_depth:
            truncated = True
            return
        for transition_id in adj.get(node, []):
            src, tgt = index.edges[transition_id]
            nxt = tgt if downstream else src
            if nxt in seen:
                continue  # cycle guard
            walk(nxt, [*hops, transition_id], seen | {nxt})

    walk(start, [], {start})
    return found, truncated


def _other(index: _Index, transition_id: str, downstream: bool) -> str:
    src, tgt = index.edges[transition_id]
    return tgt if downstream else src


def _goal_for(index: _Index, to_layer: str | None, downstream: bool) -> Callable[[str], bool]:
    """What counts as the end of a path.

    With a target layer, the first entity in it — you asked how far it gets, not
    what happens after. Without one, a sink: an entity nothing flows on from.
    """
    if to_layer:
        wanted = to_layer.strip().lower()
        return lambda n: index.entries[n].layer_name.strip().lower() == wanted
    adj = index.out_edges if downstream else index.in_edges
    return lambda n: not adj.get(n)


def _trace(
    model: LineageModel,
    index: _Index,
    entity_id: str,
    downstream: bool,
    to_layer: str | None,
    max_paths: int,
    max_depth: int,
) -> TraceResult:
    if entity_id not in index.entries:
        return TraceResult(
            start=EntityRef(id=entity_id, name="", kind="object"),
            note=f"No entity with id {entity_id!r} in this model.",
        )

    paths, truncated = _search(
        model, index, entity_id, downstream, _goal_for(index, to_layer, downstream),
        max_paths, max_depth,
    )
    direction = "downstream" if downstream else "upstream"

    if paths:
        levels = {p.level for p in paths}
        level: Level = (
            "attribute" if levels == {"attribute"} else "object" if levels == {"object"} else "mixed"
        )
        return TraceResult(
            start=_ref(index, entity_id),
            paths=paths,
            level=level,
            truncated=truncated,
            note=(
                "Some paths were cut short by the search limit; the ones returned are "
                "real but not the complete set." if truncated else None
            ),
        )

    # Nothing at this entity's own level. If it is a column, its TABLE may still
    # be connected — that is the DataFrame case, where table lineage was
    # recovered and column lineage was not. Answer coarser, and say so.
    entry = index.entries[entity_id]
    if entry.kind == "attribute" and entry.object_id and entry.object_id != entity_id:
        obj_paths, obj_truncated = _search(
            model, index, entry.object_id, downstream,
            _goal_for(index, to_layer, downstream), max_paths, max_depth,
        )
        if obj_paths:
            return TraceResult(
                start=_ref(index, entity_id),
                paths=obj_paths,
                level="object",
                truncated=obj_truncated,
                note=(
                    f"No column-level {direction} lineage is recorded for "
                    f"{entry.name!r}. This is the TABLE-level path for "
                    f"{entry.object_name!r}, which is coarser: it shows the tables the "
                    f"data moves through, not which column feeds which."
                ),
            )

    where = f" reaching layer {to_layer!r}" if to_layer else ""
    if truncated:
        # "Nothing found" and "stopped looking" are different answers, and only
        # one of them is a fact about the model. Collapsing them would have a
        # consumer report a search limit as an absence of lineage.
        return TraceResult(
            start=_ref(index, entity_id),
            truncated=True,
            note=(
                f"The search hit its limit before finding {direction} lineage"
                f"{where} for {entry.name!r}. This does NOT mean none exists — "
                f"the path may simply be longer than the search went."
            ),
        )
    return TraceResult(
        start=_ref(index, entity_id),
        note=f"No {direction} lineage{where} is recorded for {entry.name!r} in this model.",
    )


# --- the four operations ---------------------------------------------------


def squash(text: str) -> str:
    """A name reduced to what a person actually said out loud.

    `Customer_ID`, `customer id` and `CustomerID` are one name typed three ways,
    and a user asking about one of them means all three. Punctuation, spacing and
    case are dropped; nothing else is, because two names that differ in a letter
    are two names.
    """
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _singular(squashed: str) -> str:
    """`orders` → `order`. Enough plural handling to matter, no more.

    A stemmer would be worse here: this runs on entity names, where an
    over-eager rule ("address" → "addres") invents matches instead of finding
    them. One trailing `s` on a word long enough to survive it is the whole
    rule.
    """
    if len(squashed) > 3 and squashed.endswith("s") and not squashed.endswith("ss"):
        return squashed[:-1]
    return squashed


#: How alike two names must be before a fuzzy match is offered at all. Tuned so
#: a typo or a word order swap lands and an unrelated name does not: at 0.72,
#: `custmer_id`/`customer_id` matches and `orders`/`order_items` does not.
FUZZY_CUTOFF = 0.72


class Resolution(BaseModel):
    """What a name search found, and HOW it found it.

    The `how` is the part that matters, and it exists because of a specific
    failure: a caller that gets `[]` back reports "there is nothing called
    Bronze", when what happened is that it searched for a LAYER by that name and
    the model has an OBJECT. An empty result is not evidence of absence unless
    the search was unrestricted, so this carries enough to tell the two apart —
    and `suggestions` gives a caller something to say instead of "nothing".
    """

    matches: list[EntityRef] = Field(default_factory=list)
    count: int = 0
    #: `exact` · `normalized` (case/punctuation differ) · `partial` (substring) ·
    #: `fuzzy` (nearest names, may be wrong) · `none`.
    how: str = "none"
    #: Near-misses when nothing matched, so the caller can ask "did you mean".
    suggestions: list[EntityRef] = Field(default_factory=list)
    #: Set when the FILTERS emptied the result — the name exists, elsewhere.
    note: str = ""


def resolve(
    model: LineageModel,
    name: str,
    kind: EntityKind | None = None,
    layer: str | None = None,
    limit: int = 20,
) -> Resolution:
    """Turn a name a person typed into entities, forgivingly.

    Matches are RANKED, not filtered: exact first, then the same name punctuated
    or pluralised differently, then substring. All three come back together —
    somebody asking about `amount` wants to be told `amount_usd` exists — and
    `how` reports the best tier reached, so a caller can tell an exact hit from
    a loose one.

    Nearest-by-edit-distance is the exception. It runs only when the first three
    found nothing, and its results come back as `suggestions` rather than
    matches, because a fuzzy hit is a guess and a caller that cannot see the
    difference will answer about the wrong entity with full confidence.

    The tiers exist because of how people refer to things. They say "bronze" for
    `Bronze`, "customer id" for `customer_id`, "amount" for `amount_usd`, and
    "orders" for `order`. Every one of those returned nothing before, and
    nothing reads as "it isn't there".
    """
    index = build_index(model)
    needle_raw = name.strip().lower()
    if not needle_raw:
        return Resolution(how="none")
    needle = squash(needle_raw)
    if not needle:
        return Resolution(how="none")
    wanted_layer = squash(layer) if layer else None

    tiers: dict[str, list[EntityRef]] = {t: [] for t in ("exact", "normalized", "partial", "fuzzy")}
    #: Entities the name matched that the FILTERS then removed. Kept so an empty
    #: answer can say "there is one, but not of that kind / not in that layer"
    #: instead of reporting an absence that is really a mismatched filter.
    filtered_out: list[str] = []
    singular = _singular(needle)

    for entry in index.entries.values():
        lowered = entry.name.strip().lower()
        squashed = squash(entry.name)
        if lowered == needle_raw:
            tier = "exact"
        elif squashed == needle or squashed == singular or _singular(squashed) == needle:
            tier = "normalized"
        elif needle in squashed or (
            # The reverse direction — the entity's name inside the QUERY — earns
            # its keep on "the bronze_orders table", but it has to be most of
            # the query to count. Without the length floor, every short name is
            # a substring of every longer question: searching for
            # `bronze_orders` matched the layer `Bronze`, which is the same
            # wrong-level answer this whole function exists to stop.
            squashed
            and squashed in needle
            and len(squashed) >= 0.7 * len(needle)
        ):
            tier = "partial"
        elif SequenceMatcher(None, needle, squashed).ratio() >= FUZZY_CUTOFF:
            tier = "fuzzy"
        else:
            continue

        if (kind and entry.kind != kind) or (
            wanted_layer and squash(entry.layer_name) != wanted_layer
        ):
            if tier in ("exact", "normalized"):
                filtered_out.append(f"{_ref(index, entry.id).path} ({entry.kind})")
            continue
        tiers[tier].append(_ref(index, entry.id))

    ranked: list[EntityRef] = []
    best = ""
    for how in ("exact", "normalized", "partial"):
        if tiers[how]:
            best = best or how
            ranked.extend(sorted(tiers[how], key=lambda r: r.path))
    if ranked:
        return Resolution(matches=ranked[:limit], count=len(ranked), how=best)

    fuzzy = sorted(tiers["fuzzy"], key=lambda r: r.path)[:limit]
    note = ""
    if filtered_out:
        note = (
            f"Nothing matched under those filters, but the name does exist in "
            f"this model: {', '.join(filtered_out[:5])}. Search again without "
            f"`kind`/`layer` before reporting an absence."
        )
    if fuzzy:
        # Returned as SUGGESTIONS, never as matches: a fuzzy hit is a guess, and
        # a caller that cannot see the difference will answer about the wrong
        # entity with full confidence.
        return Resolution(how="none", suggestions=fuzzy, note=note)
    return Resolution(how="none", note=note)


def find_entity(
    model: LineageModel,
    name: str,
    kind: EntityKind | None = None,
    layer: str | None = None,
    limit: int = 20,
) -> list[EntityRef]:
    """Entities matching `name`, best tier first. See `resolve`."""
    return resolve(model, name, kind=kind, layer=layer, limit=limit).matches


def layer_names(model: LineageModel) -> list[str]:
    """Every layer name, in model order — what a bad `layer` argument is told."""
    return [layer.name for layer in model.layers]


def resolve_layer(model: LineageModel, layer: str) -> str | None:
    """A layer argument matched to a real layer name, or None.

    Case and punctuation are forgiven for the same reason they are in `resolve`.
    Returns the model's OWN spelling, so everything downstream compares against
    one canonical string rather than whatever the caller typed.
    """
    wanted = squash(layer)
    if not wanted:
        return None
    for name in layer_names(model):
        if squash(name) == wanted:
            return name
    return None


def trace_downstream(
    model: LineageModel,
    entity_id: str,
    to_layer: str | None = None,
    max_paths: int = MAX_PATHS,
    max_depth: int = MAX_DEPTH,
) -> TraceResult:
    """Where this entity's data goes — the "how does it reach gold" direction."""
    return _trace(model, build_index(model), entity_id, True, to_layer, max_paths, max_depth)


def trace_upstream(
    model: LineageModel,
    entity_id: str,
    to_layer: str | None = None,
    max_paths: int = MAX_PATHS,
    max_depth: int = MAX_DEPTH,
) -> TraceResult:
    """Where this entity's data came from — the "what feeds it" direction."""
    return _trace(model, build_index(model), entity_id, False, to_layer, max_paths, max_depth)


def describe_entity(model: LineageModel, entity_id: str) -> EntityDetail | None:
    """One entity's context: its place, its properties, and whether it has edges.

    The two counts are what separate "this column has no lineage" from "nobody
    traced it" — a caller can answer the question without running a search.
    """
    index = build_index(model)
    if entity_id not in index.entries:
        return None
    entry = index.entries[entity_id]
    transforms: list[str] = []
    for transition_id in index.in_edges.get(entity_id, []):
        expression = (model.properties.get(transition_id) or {}).get(TRANSFORM_KEY)
        if expression and expression not in transforms:
            transforms.append(expression)
    return EntityDetail(
        entity=_ref(index, entity_id),
        properties=dict(model.properties.get(entity_id, {})),
        upstream_count=len(index.in_edges.get(entity_id, [])),
        downstream_count=len(index.out_edges.get(entity_id, [])),
        children=[_ref(index, c) for c in entry.child_ids],
        transforms=transforms,
    )
