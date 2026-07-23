"""Static parser regressions, from real Fabric notebook source."""

from __future__ import annotations

from app.models import IngestRequest, LineageGraph, NotebookSource
from app.parser import build_graph


def _tables(cells: list[str]) -> set[str]:
    graph = build_graph(
        IngestRequest(notebooks=[NotebookSource(name="nb", cells=cells)])
    )
    return {n.name for n in graph.nodes if n.id.startswith("table.")}


def test_python_imports_are_not_sql_reads():
    """`from pyspark.sql import Row` is not a read of a table named `sql`.

    Found against the live `00_seed_sources` notebook, where it invented a
    phantom upstream table from an ordinary import.
    """
    assert _tables(["from pyspark.sql import Row", "import pandas"]) == set()


def test_a_real_from_clause_still_reads():
    """The import fix must not blind the parser to actual SQL."""
    assert "raw_orders" in _tables(["df = spark.sql('SELECT * FROM raw_orders')"])


def test_import_and_query_in_one_cell():
    """The common shape: imports at the top, a query below."""
    cell = "from pyspark.sql import Row\ndf = spark.sql('SELECT a FROM raw_orders')"
    assert _tables([cell]) == {"raw_orders"}


def test_write_targets_are_not_also_reads():
    """A table this notebook creates is its output, not its input."""
    cells = ["spark.sql('SELECT * FROM raw_orders').write.saveAsTable('gold_ltv')"]
    graph = build_graph(
        IngestRequest(notebooks=[NotebookSource(name="nb", cells=cells)])
    )
    kinds = {(e.kind, e.target.removeprefix("table.")) for e in graph.edges}
    assert ("writes", "gold_ltv") in kinds


def test_column_map_carries_evidence():
    """A SELECT-bearing cell's ColumnMaps carry verbatim cell/line/snippet evidence (D-12).

    Also asserts per-cell/per-SELECT granularity: two columns split from the
    same SELECT list share one identical ColumnMapEvidence (RESEARCH Pitfall 4).
    """
    cells = [
        "df = spark.sql('SELECT UPPER(customer_name) AS customer_name, id AS id FROM bronze.raw')"
        ".write.saveAsTable('silver.customers')"
    ]
    graph = build_graph(
        IngestRequest(notebooks=[NotebookSource(name="nb", cells=cells)])
    )
    writes_edges = [e for e in graph.edges if e.kind == "writes"]
    assert writes_edges, "expected a writes edge to carry the column maps"
    col_maps = writes_edges[0].columns
    assert len(col_maps) >= 2, "expected multiple columns from the SELECT list"
    for cm in col_maps:
        assert cm.evidence is not None
        assert cm.evidence.notebook == "nb"
        assert cm.evidence.cell_index == 0
        assert cm.evidence.line >= 1
        assert "SELECT" in cm.evidence.snippet
        assert "FROM" in cm.evidence.snippet
    snippets = {cm.evidence.snippet for cm in col_maps if cm.evidence}
    assert len(snippets) == 1, "all columns from one SELECT must share identical evidence"


def test_evidence_is_optional_for_backward_compat():
    """No-SELECT notebooks produce evidence=None, and old evidence-less payloads still validate."""
    # (a) a notebook with no SELECT still produces a valid graph; any ColumnMap has evidence=None.
    cells = ["spark.table('bronze.raw').write.saveAsTable('silver.copy')"]
    graph = build_graph(
        IngestRequest(notebooks=[NotebookSource(name="nb", cells=cells)])
    )
    for edge in graph.edges:
        for cm in edge.columns:
            assert cm.evidence is None

    # (b) a hand-built payload whose ColumnMap omits `evidence` still round-trips.
    payload = {
        "nodes": [],
        "edges": [
            {
                "source": "table.a",
                "target": "table.b",
                "kind": "derives",
                "columns": [{"from_column": "x", "to_column": "y"}],
            }
        ],
    }
    parsed = LineageGraph.model_validate(payload)
    assert parsed.edges[0].columns[0].evidence is None
