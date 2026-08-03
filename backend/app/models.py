"""Core lineage domain model.

The graph is deliberately generic so the same shapes serve both the
manual-JSON ingestion path (Phase 1) and, later, the sandbox-execution and
live-Fabric paths (Phase 2). A node is any lineage-bearing object; an edge is a
directed data-flow relationship, optionally annotated with column-level maps.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class NodeKind(str, Enum):
    WORKSPACE = "workspace"
    NOTEBOOK = "notebook"
    LAKEHOUSE = "lakehouse"
    TABLE = "table"
    COLUMN = "column"
    # Added for workspace-level lineage (fabric/workspace_lineage.py), which is
    # item-shaped rather than table-shaped. Additive only — every existing
    # producer and consumer of the older kinds is untouched, which is the
    # promise `LineageGraph` makes.
    PIPELINE = "pipeline"
    #: An item this app has no reader for — a report, a semantic model, an
    #: Eventhouse. Drawn, but never with edges: see the note in
    #: `workspace_lineage` about why an isolated box must not imply "nothing
    #: depends on this".
    ITEM = "item"


class Column(BaseModel):
    name: str
    data_type: str | None = None


class Node(BaseModel):
    id: str = Field(..., description="Stable unique id, e.g. 'lakehouse.silver/table.orders'")
    kind: NodeKind
    name: str
    parent_id: str | None = Field(None, description="Containment parent (table -> lakehouse, etc.)")
    columns: list[Column] = Field(default_factory=list, description="For table nodes")
    meta: dict = Field(default_factory=dict)


class ColumnMapEvidence(BaseModel):
    """Verbatim provenance for a ColumnMap: the cell + SELECT match it came from."""

    notebook: str
    cell_index: int
    line: int
    snippet: str


class ColumnMap(BaseModel):
    """A single source-column -> target-column derivation."""

    from_column: str
    to_column: str
    transform: str | None = Field(None, description="Human-readable transform, e.g. 'upper(x)'")
    evidence: ColumnMapEvidence | None = Field(
        None, description="Verbatim cell/line/snippet provenance, when derived from a static parse (D-12)"
    )


EdgeKind = Literal["reads", "writes", "calls", "derives"]


class Edge(BaseModel):
    source: str = Field(..., description="Source node id")
    target: str = Field(..., description="Target node id")
    kind: EdgeKind = "derives"
    columns: list[ColumnMap] = Field(default_factory=list)
    via: str | None = Field(None, description="Node id of the transform that produced this edge, e.g. a notebook")


class LineageGraph(BaseModel):
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)


class NotebookSource(BaseModel):
    """Raw notebook input for the manual-ingest / static-parse path."""

    name: str
    lakehouse_default: str | None = None
    cells: list[str] = Field(default_factory=list, description="Source of each code cell")


class IngestRequest(BaseModel):
    """Manual upload payload: known metadata plus notebook code to parse."""

    workspace: str = "Workspace"
    lakehouses: list[Node] = Field(default_factory=list, description="Lakehouse + table + column nodes")
    notebooks: list[NotebookSource] = Field(default_factory=list)
