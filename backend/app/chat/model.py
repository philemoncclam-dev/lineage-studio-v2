"""The authored lineage model, mirrored from the frontend's `model/types.ts`.

The model is the frontend's document: it lives in the browser's localStorage and
has no backend store, so it arrives on the wire with each request rather than
being fetched. This module is the read side of that contract — it never writes
one back.

Only the parts the traversal needs are declared. Everything else a model
carries — saved views, browser metadata, the version history — is ignored on
purpose: pydantic drops unknown fields, so a model written by a newer frontend
still parses here instead of failing on a field this module has no use for.

Three shape rules from the TypeScript are load-bearing for the traversal, and
each one is a place a naive implementation goes wrong:

  * **An Attribute nests other Attributes without limit.** There is no separate
    Group type — a group IS an attribute with children. So attributes must be
    walked recursively, not read one level deep.
  * **A Transition connects ANY two entities.** Layer-to-layer, object-to-object
    and attribute-to-attribute are all legal and all common. Endpoints are plain
    ids, so the graph is not typed by level and a walk cannot assume it stays at
    one.
  * **Properties live in a side table keyed by entity id** — and a Transition
    has an id, so an EDGE carries properties too. `Transform` and `Source` hang
    off the transition, which is the whole reason a trace can say how a column
    changed and where the claim came from.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Attribute(BaseModel):
    """A column, or a group of them — `children` is what makes it a group."""

    id: str
    name: str = ""
    children: list["Attribute"] = Field(default_factory=list)


class ModelObject(BaseModel):
    """A table, notebook, pipeline or file — whatever the layer holds."""

    id: str
    name: str = ""
    children: list[Attribute] = Field(default_factory=list)


class Layer(BaseModel):
    id: str
    name: str = ""
    objects: list[ModelObject] = Field(default_factory=list)


class Transition(BaseModel):
    """A directed edge between any two entities, at any level."""

    id: str
    source: str
    target: str


class LineageModel(BaseModel):
    """One authored model. Everything below `properties` is deliberately absent.

    `properties` is keyed by entity id and includes TRANSITION ids — see the
    module docstring. The keys the traversal reads are `Transform` (the
    producing expression), `Source` (who authored the edge) and `Via` (the step
    that produced it); a model may carry any others and they pass through
    untouched.
    """

    id: str = ""
    name: str = ""
    layers: list[Layer] = Field(default_factory=list)
    transitions: list[Transition] = Field(default_factory=list)
    properties: dict[str, dict[str, str]] = Field(default_factory=dict)
