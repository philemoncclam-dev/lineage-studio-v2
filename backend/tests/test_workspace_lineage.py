"""Item-level workspace lineage — the graph behind the Fabric-style view.

The builder is pure, so all of this runs with no Fabric access. What it must
get right is IDENTITY: two lakehouses in one workspace both holding `dim_date`
are two tables, and a view that merges them draws a dependency between
unrelated lakehouses. That is the failure these cover.
"""

from __future__ import annotations

from app.fabric.pipelines import PipelineActivity
from app.fabric.workspace_lineage import (
    LakehouseTables,
    NotebookInput,
    PipelineInput,
    build_workspace_lineage,
    table_node_id,
)
from app.models import NodeKind, NotebookSource
from app.sandbox._refs import make_ref

WS = "ws-guid"
WS_NAME = "Analytics"


def notebook(nb_id: str, name: str, cells: list[str], default: str | None = "Bronze"):
    return NotebookInput(
        id=nb_id,
        name=name,
        source=NotebookSource(name=name, lakehouse_default=default, cells=cells),
    )


def build(**kw):
    kw.setdefault("workspace_id", WS)
    kw.setdefault("workspace_name", WS_NAME)
    kw.setdefault("lakehouses", [])
    kw.setdefault("notebooks", [])
    return build_workspace_lineage(**kw)


def nodes_by_kind(graph, kind):
    return {n.name for n in graph.nodes if n.kind == kind}


def edge_pairs(graph):
    return {(e.source, e.target, e.kind) for e in graph.edges}


# --- the shape --------------------------------------------------------------

def test_a_notebook_links_the_lakehouse_it_reads_to_the_one_it_writes():
    graph = build(
        lakehouses=[
            LakehouseTables(id="lh1", name="Bronze", tables=["raw_orders"]),
            LakehouseTables(id="lh2", name="Silver", tables=["clean_orders"]),
        ],
        notebooks=[
            notebook(
                "nb1",
                "enrich",
                ['df = spark.table("raw_orders")\ndf.write.saveAsTable("Silver.clean_orders")'],
            )
        ],
    )
    raw = table_node_id(make_ref("raw_orders", "Bronze", WS_NAME))
    clean = table_node_id(make_ref("clean_orders", "Silver", WS_NAME))
    assert (raw, "notebook.nb1", "reads") in edge_pairs(graph)
    assert ("notebook.nb1", clean, "writes") in edge_pairs(graph)


def test_tables_belong_to_their_lakehouse():
    """Containment is what lets the viewer collapse a lakehouse to one box and
    still carry the edges of the tables inside it."""
    graph = build(lakehouses=[LakehouseTables(id="lh1", name="Bronze", tables=["raw_orders"])])
    table = next(n for n in graph.nodes if n.kind == NodeKind.TABLE)
    assert table.parent_id == "lakehouse.lh1"


def test_same_table_name_in_two_lakehouses_stays_two_nodes():
    """The bare-name collision `parser.build_graph` deliberately accepts, which
    at workspace scale would fuse two unrelated lakehouses into one."""
    graph = build(
        lakehouses=[
            LakehouseTables(id="lh1", name="Bronze", tables=["dim_date"]),
            LakehouseTables(id="lh2", name="Silver", tables=["dim_date"]),
        ]
    )
    tables = [n for n in graph.nodes if n.kind == NodeKind.TABLE]
    assert len(tables) == 2
    assert {n.parent_id for n in tables} == {"lakehouse.lh1", "lakehouse.lh2"}


def test_a_read_that_is_also_written_counts_as_a_write_only():
    """Otherwise the notebook is upstream of itself and the layout has a loop
    it cannot place."""
    graph = build(
        notebooks=[
            notebook("nb1", "upsert", ['spark.table("t").write.saveAsTable("t")'])
        ]
    )
    kinds = {e.kind for e in graph.edges}
    assert kinds == {"writes"}


def test_a_table_outside_the_catalogue_is_marked_inferred():
    """A cross-workspace read is a real dependency, but its container was never
    crawled — it must not render as a catalogued table."""
    graph = build(
        notebooks=[
            notebook("nb1", "x", ['spark.table("Finance.Gold.dim_customer")'], default="Bronze")
        ]
    )
    inferred = [n for n in graph.nodes if n.meta.get("inferred")]
    assert [n.name for n in inferred] == ["dim_customer"]
    assert inferred[0].parent_id is None


# --- pipelines --------------------------------------------------------------

def test_a_pipeline_reaches_the_notebook_it_runs():
    graph = build(
        notebooks=[notebook("nb1", "enrich", ["# nothing"])],
        pipelines=[
            PipelineInput(
                id="pl1",
                name="nightly",
                activities=[PipelineActivity(name="run enrich", type="TridentNotebook", notebook_id="nb1")],
            )
        ],
    )
    assert ("pipeline.pl1", "notebook.nb1", "calls") in edge_pairs(graph)


def test_a_copy_activity_moves_between_tables():
    src = make_ref("raw", "Bronze", WS_NAME)
    dst = make_ref("staged", "Silver", WS_NAME)
    graph = build(
        pipelines=[
            PipelineInput(
                id="pl1",
                name="copy",
                activities=[PipelineActivity(name="c", type="Copy", reads=[src], writes=[dst])],
            )
        ]
    )
    assert (table_node_id(src), "pipeline.pl1", "reads") in edge_pairs(graph)
    assert ("pipeline.pl1", table_node_id(dst), "writes") in edge_pairs(graph)


def test_an_activity_naming_a_notebook_outside_the_workspace_draws_no_edge():
    """A dangling edge to a node that was never emitted is worse than no edge."""
    graph = build(
        pipelines=[
            PipelineInput(
                id="pl1",
                name="p",
                activities=[PipelineActivity(name="a", type="TridentNotebook", notebook_id="elsewhere")],
            )
        ]
    )
    assert not graph.edges


# --- items with no reader ---------------------------------------------------

def test_an_unreadable_item_is_drawn_but_marked_opaque():
    graph = build(other_items=[("r1", "Exec Summary", "Report")])
    node = next(n for n in graph.nodes if n.kind == NodeKind.ITEM)
    assert node.name == "Exec Summary"
    assert node.meta["opaque"] is True
    assert not graph.edges


def test_every_edge_lands_on_a_node_that_exists():
    """The invariant the renderer depends on — one dangling endpoint is an
    arrow pointing at empty space."""
    graph = build(
        lakehouses=[LakehouseTables(id="lh1", name="Bronze", tables=["raw_orders"])],
        notebooks=[
            notebook("nb1", "a", ['spark.table("raw_orders").write.saveAsTable("Silver.out")'])
        ],
        pipelines=[
            PipelineInput(
                id="pl1",
                name="p",
                activities=[PipelineActivity(name="a", type="TridentNotebook", notebook_id="nb1")],
            )
        ],
        other_items=[("r1", "Report", "Report")],
    )
    ids = {n.id for n in graph.nodes}
    assert ids >= {e.source for e in graph.edges} | {e.target for e in graph.edges}


# --- the BI half (Power BI metadata scanner) ---------------------------------

from app.fabric.scanner import BiDashboard, BiDataset, BiDatasource, BiReport, ScanResult


def scan(**over) -> ScanResult:
    base = ScanResult(
        datasets=[BiDataset(id="ds1", name="Finance Model", workspace_id=WS, datasource_ids=["src1"])],
        reports=[BiReport(id="rep1", name="Exec Summary", workspace_id=WS, dataset_id="ds1")],
        dashboards=[BiDashboard(id="dash1", name="Board", workspace_id=WS, report_ids=["rep1"])],
        datasources={"src1": BiDatasource(id="src1", kind="Sql", details={"database": "Silver"})},
    )
    for k, v in over.items():
        setattr(base, k, v)
    return base


def test_the_chain_runs_from_lakehouse_through_the_model_to_the_report():
    """The half a business reader recognises: "who sees this number"."""
    graph = build(
        lakehouses=[LakehouseTables(id="lh2", name="Silver", tables=["clean"])],
        scan=scan(),
    )
    edges = edge_pairs(graph)
    assert ("lakehouse.lh2", "semanticmodel.ds1", "reads") in edges
    assert ("semanticmodel.ds1", "report.rep1", "reads") in edges
    assert ("report.rep1", "dashboard.dash1", "reads") in edges


def test_a_model_reading_something_we_never_crawled_is_left_unconnected():
    """A fabricated upstream edge is worse than an honest orphan."""
    graph = build(
        lakehouses=[LakehouseTables(id="lh2", name="Silver", tables=[])],
        scan=scan(
            datasources={
                "src1": BiDatasource(
                    id="src1", kind="Sql", details={"server": "sql.contoso.com", "database": "Sales"}
                )
            }
        ),
    )
    assert not any(t == "semanticmodel.ds1" for _s, t, _k in edge_pairs(graph))
    # ...but the model is still on the canvas.
    assert any(n.id == "semanticmodel.ds1" for n in graph.nodes)


def test_a_scanned_item_is_not_also_drawn_as_an_opaque_box():
    """It would appear twice — once explained, once as a mystery."""
    graph = build(
        other_items=[("rep1", "Exec Summary", "Report")],
        scan=scan(),
    )
    assert not any(n.id == "item.rep1" for n in graph.nodes)
    assert any(n.id == "report.rep1" for n in graph.nodes)


def test_without_a_scan_the_graph_is_exactly_what_it_was():
    graph = build(other_items=[("rep1", "Exec Summary", "Report")])
    assert any(n.id == "item.rep1" and n.meta.get("opaque") for n in graph.nodes)
    assert not any(n.kind == NodeKind.REPORT for n in graph.nodes)


def test_a_report_whose_model_was_not_scanned_gets_no_dangling_edge():
    graph = build(scan=scan(datasets=[]))
    assert not any(s == "semanticmodel.ds1" for s, _t, _k in edge_pairs(graph))


def test_every_bi_edge_lands_on_a_node_that_exists():
    graph = build(
        lakehouses=[LakehouseTables(id="lh2", name="Silver", tables=["clean"])],
        scan=scan(),
    )
    ids = {n.id for n in graph.nodes}
    assert ids >= {e.source for e in graph.edges} | {e.target for e in graph.edges}
