"""The real Spark executor (M2b): plan-capture, output schemas, isolation.

Skipped where the pinned Spark venv isn't present (Vercel/CI, or a machine that
hasn't run the M2b setup), so the suite stays green everywhere while still
exercising real Spark where it exists.
"""

from __future__ import annotations

import pytest

from app.sandbox.protocol import ColumnSchema, RunRequest
from app.sandbox.runner import run_sandbox, spark_available

pytestmark = pytest.mark.skipif(not spark_available(), reason="pinned Spark venv not installed")

# Two input tables with real schemas; the notebook joins/aggregates them.
SCHEMAS = {
    "raw_orders": [
        ColumnSchema(name="order_id", type="long"),
        ColumnSchema(name="region", type="string"),
        ColumnSchema(name="amount", type="long"),
    ],
}

CELLS = [
    "from pyspark.sql.functions import col, upper, sum as ssum",
    "df = spark.table('raw_orders').groupBy(upper(col('region')).alias('region_up')).agg(ssum('amount').alias('total_amount'))",
    "df.write.mode('overwrite').saveAsTable('gold_region_totals')",
]


def test_spark_engine_derives_reads_writes_and_output_schema():
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS, schemas=SCHEMAS), engine="spark")
    assert result.ok, result.error
    assert result.engine == "spark"
    assert result.reads == ["raw_orders"]
    assert result.writes == ["gold_region_totals"]

    # The payoff: Spark's analyzer computed the real output column types.
    schema = {c.name: c.type for c in result.table_schemas["gold_region_totals"]}
    assert schema == {"region_up": "string", "total_amount": "bigint"}


def test_spark_engine_derives_column_level_lineage():
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS, schemas=SCHEMAS), engine="spark")
    assert result.ok, result.error
    flows = {(f.to_column, f.from_column) for f in result.column_lineage if f.to_table == "gold_region_totals"}
    # region_up derives from region; total_amount derives from amount.
    assert ("region_up", "region") in flows
    assert ("total_amount", "amount") in flows
    # a computed column carries the producing expression as its transform
    total = next(f for f in result.column_lineage if f.to_column == "total_amount")
    assert total.transform and "amount" in total.transform


def test_spark_engine_returns_read_table_schemas_too():
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS, schemas=SCHEMAS), engine="spark")
    # the read table's columns come back so the frontend can draw source-side edges
    assert "raw_orders" in result.table_schemas
    assert {c.name for c in result.table_schemas["raw_orders"]} == {"order_id", "region", "amount"}


def test_spark_engine_reports_no_credentials(monkeypatch):
    monkeypatch.setenv("AZURE_CLIENT_SECRET", "leak-me")
    result = run_sandbox(RunRequest(notebook_name="nb", cells=["x = 1"]), engine="spark")
    assert result.saw_credentials is False


def test_spark_engine_captures_a_sql_ctas_write():
    cells = [
        "spark.sql('CREATE TABLE gold AS SELECT region, amount FROM raw_orders')",
    ]
    result = run_sandbox(RunRequest(notebook_name="nb", cells=cells, schemas=SCHEMAS), engine="spark")
    assert result.ok, result.error
    assert "gold" in result.writes
    assert "raw_orders" in result.reads
