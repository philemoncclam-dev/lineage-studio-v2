"""The real Spark executor (M2b): plan-capture, output schemas, isolation.

Skipped where the pinned Spark venv isn't present (Vercel/CI, or a machine that
hasn't run the M2b setup), so the suite stays green everywhere while still
exercising real Spark where it exists.
"""

from __future__ import annotations

import pytest

from app.sandbox._refs import make_ref
from app.sandbox.protocol import ColumnSchema, RunRequest
from app.sandbox.runner import run_sandbox, spark_available

pytestmark = pytest.mark.skipif(not spark_available(), reason="pinned Spark venv not installed")

# The notebook's own workspace/lakehouse — what an unqualified name means.
WS, LH = "Analytics", "Bronze"

RAW = make_ref("raw_orders", LH, WS)
GOLD = make_ref("gold_region_totals", LH, WS)

SCHEMAS = {
    RAW: [
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


def _run(cells=CELLS, schemas=None):
    return run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=cells,
            schemas=SCHEMAS if schemas is None else schemas,
            workspace=WS,
            lakehouse=LH,
        ),
        engine="spark",
    )


def test_spark_engine_derives_reads_writes_and_output_schema():
    result = _run()
    assert result.ok, result.error
    assert result.engine == "spark"
    assert result.reads == [RAW]
    assert result.writes == [GOLD]

    # The payoff: Spark's analyzer computed the real output column types.
    schema = {c.name: c.type for c in result.table_schemas[GOLD]}
    assert schema == {"region_up": "string", "total_amount": "bigint"}


def test_spark_engine_derives_column_level_lineage():
    result = _run()
    assert result.ok, result.error
    flows = {(f.to_column, f.from_column) for f in result.column_lineage if f.to_table == GOLD}
    # region_up derives from region; total_amount derives from amount.
    assert ("region_up", "region") in flows
    assert ("total_amount", "amount") in flows
    # a computed column carries the producing expression as its transform
    total = next(f for f in result.column_lineage if f.to_column == "total_amount")
    assert total.transform and "amount" in total.transform


def test_spark_engine_returns_read_table_schemas_too():
    result = _run()
    # the read table's columns come back so the frontend can draw source-side edges
    assert RAW in result.table_schemas
    assert {c.name for c in result.table_schemas[RAW]} == {"order_id", "region", "amount"}


def test_spark_engine_reports_no_credentials(monkeypatch):
    monkeypatch.setenv("AZURE_CLIENT_SECRET", "leak-me")
    result = run_sandbox(RunRequest(notebook_name="nb", cells=["x = 1"]), engine="spark")
    assert result.saw_credentials is False


def test_spark_engine_captures_a_sql_ctas_write():
    result = _run(["spark.sql('CREATE TABLE gold AS SELECT region, amount FROM raw_orders')"])
    assert result.ok, result.error
    assert make_ref("gold", LH, WS) in result.writes
    assert RAW in result.reads


def test_every_table_carries_its_workspace():
    result = _run()
    assert result.tables[RAW].workspace == WS
    assert result.tables[RAW].lakehouse == LH
    assert result.tables[GOLD].resolved is True


def test_a_write_is_readable_by_a_later_cell():
    """The `_capture` fix: a table this notebook wrote resolves downstream.

    Without publishing the written table back into the session as an empty
    view, the second write's `FROM gold_region_totals` falls through to the
    session catalog, the silver→gold read edge is lost, and the final table
    gets no columns.
    """
    result = _run(
        CELLS
        + [
            "spark.sql('CREATE TABLE gold_final AS SELECT region_up FROM gold_region_totals')",
        ]
    )
    assert result.ok, result.error
    final = make_ref("gold_final", LH, WS)
    # the chain resolved: the intermediate table is a read of the final one
    assert GOLD in result.reads or GOLD in result.writes
    assert final in result.table_schemas
    assert {c.name for c in result.table_schemas[final]} == {"region_up"}


def test_cross_workspace_tables_stay_distinct():
    """Two same-named tables in different workspaces must not collapse into one."""
    finance = make_ref("customers", "Gold", "Finance")
    marketing = make_ref("customers", "Gold", "Marketing")
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=[
                "a = spark.table('Finance.Gold.customers')",
                "b = spark.table('Marketing.Gold.customers')",
                "a.union(b).write.saveAsTable('Analytics.Bronze.all_customers')",
            ],
            schemas={
                finance: [ColumnSchema(name="id", type="long")],
                marketing: [ColumnSchema(name="id", type="long")],
            },
            workspace=WS,
            lakehouse=LH,
        ),
        engine="spark",
    )
    assert result.ok, result.error
    assert finance in result.reads and marketing in result.reads
    assert result.tables[finance].workspace == "Finance"
    assert result.tables[marketing].workspace == "Marketing"
