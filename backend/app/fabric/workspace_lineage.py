"""Item-level lineage for a whole workspace — Fabric's own lineage view, built.

Fabric's lineage tab answers one question the rest of this app does not: "what
depends on what, across this workspace, at the level of ITEMS" — a lakehouse
box, a notebook box, an arrow between them. The Modeling canvas answers it for
tables and columns, and the sandbox answers it for one run. Neither of them
opens on a tenant and shows you the shape of it.

WHERE THE EDGES COME FROM. Fabric has no public API that hands out item
dependencies, so they are derived from what each item declares:

  * notebooks — the static parse (`app/parser.py`'s patterns), which is what
    Phase 1 already does to notebook source;
  * pipelines — the activity graph (`pipelines.py`), which names the notebook
    an activity runs and the tables a Copy moves between;
  * lakehouses — their table list, so a table has a container to belong to.

Semantic models and reports come from the Power BI metadata scanner
(`scanner.py`) when the tenant permits one — a different credential and a
different authority, so it is optional everywhere. Without it those items are
still drawn, but marked as not-crawled rather than left looking like leaves.

WHY REFS ARE QUALIFIED. `parser.build_graph` shortens every table to a bare
name, which is right for a single-notebook Phase-1 graph and wrong here: three
lakehouses in a workspace each holding `dim_date` would collapse into one node,
and the view would draw dependencies between lakehouses that have nothing to do
with each other. So this path uses `_find_raw` + `_refs.qualify`, the same
canonical vocabulary the sandbox uses — the identity of a table is its
workspace and lakehouse, not its leaf name.

Everything here is pure given already-fetched inputs. The router does the
network; this does the graph, so it is testable with no Fabric access at all.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..models import Edge, LineageGraph, Node, NodeKind, NotebookSource
from ..parser import _READ_PATTERNS, _WRITE_PATTERNS, _find_raw, _without_python_imports
from ..sandbox import _refs
from .pipelines import PipelineActivity
from .scanner import ScanResult, lakehouse_for_datasource


@dataclass
class LakehouseTables:
    """One lakehouse and the tables it holds, as the catalog crawl found them."""

    id: str
    name: str
    tables: list[str] = field(default_factory=list)


@dataclass
class NotebookInput:
    """One notebook's identity plus its decoded source."""

    id: str
    name: str
    source: NotebookSource


@dataclass
class PipelineInput:
    """One pipeline's identity plus its already-expanded activity list."""

    id: str
    name: str
    activities: list[PipelineActivity] = field(default_factory=list)


def workspace_node_id(workspace_id: str) -> str:
    return f"workspace.{workspace_id}"


def item_node_id(kind: str, item_id: str) -> str:
    return f"{kind}.{item_id}"


def table_node_id(ref: str) -> str:
    """A canonical `_refs` ref → a graph node id.

    The ref itself is the identity — it already encodes workspace, lakehouse and
    table — so this only prefixes it into the node namespace.
    """
    return f"table.{ref}"


def _read_write_refs(
    source: NotebookSource, workspace_name: str, name_map: dict[str, str]
) -> tuple[set[str], set[str]]:
    """The canonical refs one notebook reads and writes.

    A table both read and written is treated as a WRITE, matching
    `parser.parse_notebook`: a notebook that reads its own output to update it
    is not upstream of itself, and drawing both directions makes a self-loop the
    layout cannot lay out.
    """
    reads: set[str] = set()
    writes: set[str] = set()
    for cell in source.cells:
        scannable = _without_python_imports(cell)
        for raw in _find_raw(_READ_PATTERNS, scannable):
            reads.add(
                _refs.qualify(
                    raw,
                    default_workspace=workspace_name,
                    default_lakehouse=source.lakehouse_default or "",
                    name_map=name_map,
                )
            )
        for raw in _find_raw(_WRITE_PATTERNS, scannable):
            writes.add(
                _refs.qualify(
                    raw,
                    default_workspace=workspace_name,
                    default_lakehouse=source.lakehouse_default or "",
                    name_map=name_map,
                )
            )
    reads -= writes
    # A ref that qualified to nothing (an f-string, a variable) is not a table.
    return {r for r in reads if _refs.table_of(r)}, {w for w in writes if _refs.table_of(w)}


def build_workspace_lineage(
    *,
    workspace_id: str,
    workspace_name: str,
    lakehouses: list[LakehouseTables],
    notebooks: list[NotebookInput],
    pipelines: list[PipelineInput] | None = None,
    other_items: list[tuple[str, str, str]] | None = None,
    name_map: dict[str, str] | None = None,
    scan: ScanResult | None = None,
) -> LineageGraph:
    """Every item in one workspace, and the dependencies between them.

    `other_items` is `(item_id, name, type)` for items this builder has no
    reader for — they are emitted as nodes with no edges, because leaving them
    out entirely would say the workspace is smaller than it is. They carry
    `meta["opaque"]`, so the UI can say "no dependencies known" rather than
    letting an isolated box imply "nothing depends on this".

    `scan` is the Power BI metadata scan, when the tenant allows one. It turns
    the semantic models and reports from opaque boxes into real nodes with real
    edges — the BI half of the picture, which is the half a business reader
    recognises. Optional throughout: without it the graph is exactly what it was
    before, and the items it would have explained stay opaque rather than
    vanishing.
    """
    name_map = name_map or {}
    pipelines = pipelines or []
    graph = LineageGraph()

    ws_id = workspace_node_id(workspace_id)
    graph.nodes.append(Node(id=ws_id, kind=NodeKind.WORKSPACE, name=workspace_name))

    # --- lakehouses and their tables ---------------------------------------
    # Built first so the table nodes exist before any edge wants to land on
    # one; a notebook ref that matches one of these resolves to the SAME node,
    # which is the whole point of qualifying.
    known: set[str] = set()
    for lh in lakehouses:
        lh_node = item_node_id("lakehouse", lh.id)
        graph.nodes.append(
            Node(id=lh_node, kind=NodeKind.LAKEHOUSE, name=lh.name, parent_id=ws_id)
        )
        for table in lh.tables:
            ref = _refs.make_ref(table, lh.name, workspace_name)
            node_id = table_node_id(ref)
            if node_id in known:
                continue
            known.add(node_id)
            graph.nodes.append(
                Node(
                    id=node_id,
                    kind=NodeKind.TABLE,
                    name=table,
                    parent_id=lh_node,
                    meta={"ref": ref},
                )
            )

    # --- notebooks ----------------------------------------------------------
    referenced: set[str] = set()
    for nb in notebooks:
        nb_node = item_node_id("notebook", nb.id)
        graph.nodes.append(
            Node(id=nb_node, kind=NodeKind.NOTEBOOK, name=nb.name, parent_id=ws_id)
        )
        reads, writes = _read_write_refs(nb.source, workspace_name, name_map)
        for ref in sorted(reads):
            referenced.add(ref)
            graph.edges.append(
                Edge(source=table_node_id(ref), target=nb_node, kind="reads", via=nb_node)
            )
        for ref in sorted(writes):
            referenced.add(ref)
            graph.edges.append(
                Edge(source=nb_node, target=table_node_id(ref), kind="writes", via=nb_node)
            )

    # --- pipelines ----------------------------------------------------------
    # An activity that runs a notebook becomes an edge to that notebook's node,
    # so orchestration and data flow are one graph: the pipeline reaches the
    # notebook, and the notebook reaches the tables. A Copy declares its own
    # tables and gets edges of its own.
    notebook_ids = {nb.id for nb in notebooks}
    for pl in pipelines:
        pl_node = item_node_id("pipeline", pl.id)
        graph.nodes.append(
            Node(id=pl_node, kind=NodeKind.PIPELINE, name=pl.name, parent_id=ws_id)
        )
        for act in pl.activities:
            if act.notebook_id and act.notebook_id in notebook_ids:
                graph.edges.append(
                    Edge(
                        source=pl_node,
                        target=item_node_id("notebook", act.notebook_id),
                        kind="calls",
                        via=pl_node,
                    )
                )
            for ref in act.reads:
                if not _refs.table_of(ref):
                    continue
                referenced.add(ref)
                graph.edges.append(
                    Edge(source=table_node_id(ref), target=pl_node, kind="reads", via=pl_node)
                )
            for ref in act.writes:
                if not _refs.table_of(ref):
                    continue
                referenced.add(ref)
                graph.edges.append(
                    Edge(source=pl_node, target=table_node_id(ref), kind="writes", via=pl_node)
                )

    # --- semantic models, reports, dashboards -------------------------------
    # The BI half. Only the edges the scan STATES are drawn:
    #   report -> its semantic model      (report.datasetId, a fact)
    #   dashboard -> the reports it tiles (tile.reportId, a fact)
    #   lakehouse -> semantic model       (inferred, and only when the model's
    #                                      datasource resolves to a lakehouse
    #                                      this very crawl found)
    # A model reading a real SQL Server resolves to nothing and is left
    # unconnected on its upstream side, which is honest: it IS upstream of
    # nothing we know about.
    if scan:
        lakehouse_ids = {lh.name.strip().lower(): lh.id for lh in lakehouses}
        for dataset in scan.datasets:
            ds_node = item_node_id("semanticmodel", dataset.id)
            graph.nodes.append(
                Node(
                    id=ds_node,
                    kind=NodeKind.SEMANTIC_MODEL,
                    name=dataset.name,
                    parent_id=ws_id,
                    meta={"item_type": "SemanticModel"},
                )
            )
            for source_id in dataset.datasource_ids:
                source = scan.datasources.get(source_id)
                if not source:
                    continue
                lh_id = lakehouse_for_datasource(source, lakehouse_ids)
                if lh_id:
                    graph.edges.append(
                        Edge(
                            source=item_node_id("lakehouse", lh_id),
                            target=ds_node,
                            kind="reads",
                            via=ds_node,
                        )
                    )

        model_ids = {d.id for d in scan.datasets}
        for report in scan.reports:
            rep_node = item_node_id("report", report.id)
            graph.nodes.append(
                Node(
                    id=rep_node,
                    kind=NodeKind.REPORT,
                    name=report.name,
                    parent_id=ws_id,
                    meta={"item_type": "Report"},
                )
            )
            # Only when the model was scanned too — an edge to a node that was
            # never emitted is an arrow pointing at empty space.
            if report.dataset_id and report.dataset_id in model_ids:
                graph.edges.append(
                    Edge(
                        source=item_node_id("semanticmodel", report.dataset_id),
                        target=rep_node,
                        kind="reads",
                        via=rep_node,
                    )
                )

        report_ids = {r.id for r in scan.reports}
        for dashboard in scan.dashboards:
            dash_node = item_node_id("dashboard", dashboard.id)
            graph.nodes.append(
                Node(
                    id=dash_node,
                    kind=NodeKind.DASHBOARD,
                    name=dashboard.name,
                    parent_id=ws_id,
                    meta={"item_type": "Dashboard"},
                )
            )
            for rid in dashboard.report_ids:
                if rid in report_ids:
                    graph.edges.append(
                        Edge(
                            source=item_node_id("report", rid),
                            target=dash_node,
                            kind="reads",
                            via=dash_node,
                        )
                    )

    # --- items with no reader ----------------------------------------------
    # Namespaced by `item`, not by the Fabric type: the id prefix names the
    # NodeKind for every other node here, and a type-named prefix would break
    # that (and collide the day a type is called "Notebook"). The real Fabric
    # type is on `meta`, which is where the UI reads it for the icon anyway.
    # Anything the scan accounted for is emitted below with its real edges;
    # emitting it here too would draw the same report twice, once explained and
    # once as an unexplained box.
    explained = set()
    if scan:
        explained = {d.id for d in scan.datasets} | {r.id for r in scan.reports} | {
            b.id for b in scan.dashboards
        }
    for item_id, name, item_type in other_items or []:
        if item_id in explained:
            continue
        graph.nodes.append(
            Node(
                id=item_node_id("item", item_id),
                kind=NodeKind.ITEM,
                name=name,
                parent_id=ws_id,
                meta={"item_type": item_type, "opaque": True},
            )
        )

    # --- tables referenced but not catalogued -------------------------------
    # A notebook reading a table in ANOTHER workspace, or one written by code
    # and not yet created. Marked inferred: it is a real dependency, but its
    # container was never seen, so it must not look like a catalogued table.
    seen = {n.id for n in graph.nodes}
    for ref in sorted(referenced):
        node_id = table_node_id(ref)
        if node_id in seen:
            continue
        seen.add(node_id)
        workspace, lakehouse, table = _refs.parse_ref(ref)
        graph.nodes.append(
            Node(
                id=node_id,
                kind=NodeKind.TABLE,
                name=table,
                meta={
                    "ref": ref,
                    "inferred": True,
                    "lakehouse": lakehouse,
                    "workspace": workspace,
                },
            )
        )

    return graph
