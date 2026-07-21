"""Static parser regressions, from real Fabric notebook source."""

from __future__ import annotations

from app.models import IngestRequest, NotebookSource
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
