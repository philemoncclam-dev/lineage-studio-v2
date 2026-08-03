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


def test_a_join_attributes_each_column_to_its_own_source_table():
    """The gap this engine existed to close, and used to reopen.

    `_column_flows` compared attribute *names*, so every Spark-derived edge came
    back with `from_table=None`. The frontend then matched on the column name
    and dropped the edge whenever two source tables tied — which is exactly what
    a join is. Catalyst knew the answer the whole time: each reference carries an
    exprId identifying the relation that produced it.

    Both tables here have an `id`, so name matching cannot tell them apart and
    ownership is the only thing that can.
    """
    customers = make_ref("customers", LH, WS)
    orders = make_ref("orders", LH, WS)
    joined = make_ref("joined", LH, WS)
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=[
                "c = spark.table('customers')",
                "o = spark.table('orders')",
                "c.join(o, c['id'] == o['id']).select(c['id'], c['name'], o['amount'])"
                ".write.saveAsTable('joined')",
            ],
            schemas={
                customers: [ColumnSchema(name="id", type="long"), ColumnSchema(name="name", type="string")],
                orders: [ColumnSchema(name="id", type="long"), ColumnSchema(name="amount", type="long")],
            },
            workspace=WS,
            lakehouse=LH,
        ),
        engine="spark",
    )
    assert result.ok, result.error
    owned = {(f.to_column, f.from_column, f.from_table) for f in result.column_lineage}
    assert ("id", "id", customers) in owned  # ...and NOT from orders
    assert ("name", "name", customers) in owned
    assert ("amount", "amount", orders) in owned
    assert all(f.from_table for f in result.column_lineage), "every edge must name its source"


def test_no_edge_is_invented_for_a_column_with_no_source():
    """The identity fallback claimed a same-named source for any output column
    it failed to map — including a literal, which has no source at all."""
    result = _run(
        [
            "from pyspark.sql.functions import lit",
            "spark.table('raw_orders').select(lit(1).alias('constant'))"
            ".write.saveAsTable('gold_const')",
        ]
    )
    assert result.ok, result.error
    assert [f for f in result.column_lineage if f.to_column == "constant"] == []


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


# --- path reads ------------------------------------------------------------
#
# A notebook that writes ACROSS workspaces has to name tables by `abfss://`
# path, because a bare name resolves against the notebook's own workspace. That
# makes the path read the normal shape of a medallion architecture, not an edge
# case — and it used to fail outright on this engine.

PLATFORM = "Retail_Platform"
SRC_PATH = f"abfss://{PLATFORM}@onelake.dfs.fabric.microsoft.com/lh_bronze.Lakehouse/Tables/orders"
DST_PATH = f"abfss://{PLATFORM}@onelake.dfs.fabric.microsoft.com/lh_silver.Lakehouse/Tables/orders_priced"

PATH_SCHEMAS = {
    make_ref("orders", "lh_bronze", PLATFORM): [
        ColumnSchema(name="order_id", type="string"),
        ColumnSchema(name="quantity", type="int"),
        ColumnSchema(name="unit_price", type="double"),
    ],
}


def test_a_delta_path_read_no_longer_needs_a_delta_reader():
    """The regression: `SparkClassNotFoundException: delta.DefaultSource`.

    `.format("delta").load(path)` went past the interception straight to Spark,
    which has no Delta jar and no storage credential — so the cell died and the
    notebook produced nothing. A path names a table, so it resolves to the same
    empty view a named read does and no Delta reader is involved at all.
    """
    cells = [
        "from pyspark.sql.functions import col",
        f"orders = spark.read.format('delta').load('{SRC_PATH}')",
        "priced = orders.withColumn('line_total', col('quantity') * col('unit_price'))",
        f"priced.write.format('delta').mode('overwrite').save('{DST_PATH}')",
    ]
    result = run_sandbox(
        RunRequest(notebook_name="nb", cells=cells, schemas=PATH_SCHEMAS,
                   workspace=PLATFORM, lakehouse="lh_bronze"),
        engine="spark",
    )
    assert result.ok, result.error
    assert all(c.error is None for c in result.cells), [c.error for c in result.cells]

    src = make_ref("orders", "lh_bronze", PLATFORM)
    dst = make_ref("orders_priced", "lh_silver", PLATFORM)
    assert src in result.reads
    assert dst in result.writes

    # Catalyst resolved the arithmetic against the real column types.
    out = {c.name: c.type for c in result.table_schemas[dst]}
    assert out["line_total"] == "double"

    edges = {(e.from_column, e.to_column) for e in result.column_lineage if e.to_table == dst}
    assert ("quantity", "line_total") in edges
    assert ("unit_price", "line_total") in edges
    assert ("order_id", "order_id") in edges


def test_an_unknown_path_degrades_instead_of_killing_the_notebook():
    """One table we cannot describe must not cost the lineage of every later cell."""
    unknown = f"abfss://{PLATFORM}@onelake.dfs.fabric.microsoft.com/lh_landing.Lakehouse/Tables/never_seen"
    cells = [
        f"mystery = spark.read.format('delta').load('{unknown}')",
        f"orders = spark.read.format('delta').load('{SRC_PATH}')",
        f"orders.write.format('delta').mode('overwrite').save('{DST_PATH}')",
    ]
    result = run_sandbox(
        RunRequest(notebook_name="nb", cells=cells, schemas=PATH_SCHEMAS,
                   workspace=PLATFORM, lakehouse="lh_bronze"),
        engine="spark",
    )
    assert result.ok, result.error
    # The unreadable table is still recorded as a read — the intent is lineage.
    assert make_ref("never_seen", "lh_landing", PLATFORM) in result.reads
    # And the later write still produced its schema.
    assert make_ref("orders_priced", "lh_silver", PLATFORM) in result.writes


def test_each_cell_reports_what_it_touched():
    """Per-cell reads/writes, not just the run-level totals.

    The engine that knows the MOST reported `[]` for every cell while the stub
    filled them in, so the report's per-cell view said "this cell touched
    nothing" precisely where the analysis was strongest. Attribution comes from
    snapshotting the accumulators either side of each cell.
    """
    result = _run()
    assert result.ok, result.error
    by_index = {c.index: c for c in result.cells}

    # Cell 0 is a bare import — it touches nothing, and must not inherit the
    # run's totals.
    assert by_index[0].reads == []
    assert by_index[0].writes == []
    # Cell 1 builds the DataFrame: the read happens here.
    assert by_index[1].reads == [RAW]
    assert by_index[1].writes == []
    # Cell 2 is the write, and it is not also reported as a read.
    assert by_index[2].writes == [GOLD]
    assert RAW not in by_index[2].reads


def test_a_failing_cell_reports_its_error_and_lets_the_run_continue():
    """The case the report now opens on. Cell 1 raises; cell 2 still writes."""
    result = _run(cells=[
        CELLS[0],
        "raise ValueError('boom')",
        "spark.table('raw_orders').write.mode('overwrite').saveAsTable('gold_region_totals')",
    ])
    assert result.ok, result.error
    by_index = {c.index: c for c in result.cells}
    assert by_index[1].status == "error"
    assert "ValueError: boom" in (by_index[1].error or "")
    # The run kept going, which is why "the step is ok" and "every cell is ok"
    # are different claims.
    assert by_index[2].status == "ok"
    assert result.writes == [GOLD]
