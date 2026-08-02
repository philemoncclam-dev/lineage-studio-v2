"""Temp views — the seam between a notebook's SQL half and its DataFrame half.

Two defects motivate every test here, and they share a cause: the two halves used
to be analysed in separate passes that could not see each other's work.

  * A name registered with `createOrReplaceTempView` was resolved as a TABLE, so
    `_refs.qualify` put it in the notebook's own lakehouse and the frontend drew
    a lakehouse table that does not exist. The real chain was severed either side
    of the fabrication.
  * `spark.sql(...)` was not a source a DataFrame chain could carry on from, so
    `spark.sql(…).write.saveAsTable(…)` produced no column lineage at all, even
    though the query was perfectly analysable.

Both engines are covered. They derive lineage by completely different means —
sqlglot over the text, Catalyst over the analyzed plan — so agreeing on the same
notebook is the strongest evidence either is right.
"""

from __future__ import annotations

import pytest

from app.sandbox._refs import make_ref
from app.sandbox.protocol import ColumnSchema, RunRequest
from app.sandbox.runner import run_sandbox, spark_available

WS, LH = "Finance", "Bronze"

ORDERS = make_ref("orders", LH, WS)
CUSTOMERS = make_ref("customers", LH, WS)
SILVER = make_ref("silver_orders", LH, WS)
GOLD = make_ref("gold_totals", LH, WS)
#: What a temp view called `staged` WOULD become if it were mistaken for a table.
PHANTOM = make_ref("staged", LH, WS)

SCHEMAS = {
    ORDERS: [
        ColumnSchema(name="id", type="bigint"),
        ColumnSchema(name="amount", type="double"),
        ColumnSchema(name="cust_id", type="bigint"),
    ],
    CUSTOMERS: [
        ColumnSchema(name="cust_id", type="bigint"),
        ColumnSchema(name="region", type="string"),
    ],
}


def run(cells, engine="stub", schemas=None):
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=cells,
            schemas=SCHEMAS if schemas is None else schemas,
            workspace=WS,
            lakehouse=LH,
        ),
        engine=engine,
    )
    assert result.ok, result.error
    return result


def edges(result, target):
    return {
        (f.to_column, f.from_table, f.from_column)
        for f in result.column_lineage
        if f.to_table == target
    }


# --- the view must not become a table --------------------------------------


def test_a_temp_view_is_not_reported_as_a_table():
    """The fabrication, directly.

    `staged` is a name for a projection. Reporting it as a table put a node in
    the user's model for something that has no rows, no schema and no existence
    outside the session.
    """
    result = run(
        [
            "df = spark.table('orders')\ndf.createOrReplaceTempView('staged')",
            "spark.sql('CREATE TABLE silver_orders AS SELECT id FROM staged')",
        ]
    )
    assert PHANTOM not in result.reads
    assert PHANTOM not in result.writes
    assert PHANTOM not in result.tables


def test_lineage_flows_through_a_view_to_the_real_table():
    """The severed chain, rejoined.

    The edge the model needs is `silver_orders.id ← orders.id`. Through a view
    treated as a table it was `silver_orders.id ← staged.id`, which named a table
    that does not exist and left `orders` connected to nothing.
    """
    result = run(
        [
            "df = spark.table('orders').filter('amount > 0')\ndf.createOrReplaceTempView('staged')",
            "spark.sql('CREATE TABLE silver_orders AS SELECT s.id, s.amount, c.region "
            "FROM staged s JOIN customers c ON s.cust_id = c.cust_id')",
        ]
    )
    assert edges(result, SILVER) == {
        ("id", ORDERS, "id"),
        ("amount", ORDERS, "amount"),
        ("region", CUSTOMERS, "region"),
    }
    assert ORDERS in result.reads
    assert CUSTOMERS in result.reads


def test_a_view_defined_in_sql_is_visible_to_the_dataframe_half():
    """The other direction, and the one that needs the passes interleaved.

    A `CREATE TEMPORARY VIEW` is a SQL statement; the chain that reads it is not.
    Neither pass could see the other until they walked the notebook together.
    """
    result = run(
        [
            "spark.sql('CREATE OR REPLACE TEMP VIEW staged AS SELECT id, amount FROM orders')",
            "spark.table('staged').write.saveAsTable('silver_orders')",
        ]
    )
    assert PHANTOM not in result.reads
    assert edges(result, SILVER) == {("id", ORDERS, "id"), ("amount", ORDERS, "amount")}


def test_a_view_built_on_a_view_still_resolves_to_base_tables():
    """Views are flattened as they are registered, so no consumer chases a chain."""
    result = run(
        [
            "spark.sql('CREATE TEMP VIEW a AS SELECT id, amount FROM orders')",
            "spark.sql('CREATE TEMP VIEW b AS SELECT id FROM a')",
            "spark.sql('CREATE TABLE silver_orders AS SELECT id FROM b')",
        ]
    )
    assert edges(result, SILVER) == {("id", ORDERS, "id")}
    assert make_ref("a", LH, WS) not in result.tables
    assert make_ref("b", LH, WS) not in result.tables


def test_the_global_temp_prefix_names_the_same_view():
    result = run(
        [
            "df = spark.table('orders')\ndf.createGlobalTempView('staged')",
            "spark.sql('CREATE TABLE silver_orders AS SELECT id FROM global_temp.staged')",
        ]
    )
    assert edges(result, SILVER) == {("id", ORDERS, "id")}


def test_a_view_whose_frame_is_unknown_is_still_not_a_table():
    """The abstain case, and the reason the registry stores `None`.

    `mystery()` is not something the reader will guess at, so there is no lineage
    to carry through the view. Knowing the name is not a table is a separate fact
    and survives on its own — losing an edge is the cost of honesty, drawing a
    table that does not exist is not.
    """
    result = run(
        [
            "df = mystery()\ndf.createOrReplaceTempView('staged')",
            "spark.sql('CREATE TABLE silver_orders AS SELECT id FROM staged')",
        ]
    )
    assert PHANTOM not in result.reads
    assert PHANTOM not in result.tables
    assert edges(result, SILVER) == set()
    # The write is still real, and the column it produces is still known.
    assert SILVER in result.writes
    assert [c.name for c in result.table_schemas[SILVER]] == ["id"]


def test_a_cte_shadows_a_view_of_the_same_name():
    """Spark resolves a CTE ahead of a temp view, so this must too.

    A column off a CTE has always come back unowned — the module does not resolve
    through one, and that predates views entirely. What matters here is that it
    stays unowned: attributing it to `orders` would mean the view had answered
    for a name the CTE owns.
    """
    result = run(
        [
            "spark.sql('CREATE TEMP VIEW staged AS SELECT id FROM orders')",
            "spark.sql('CREATE TABLE silver_orders AS WITH staged AS "
            "(SELECT cust_id AS id FROM customers) SELECT id FROM staged')",
        ]
    )
    assert edges(result, SILVER) == {("id", None, "id")}


def test_a_persisted_view_is_still_an_object_that_was_written():
    """Only TEMPORARY views are session-local. `CREATE VIEW` makes a lakehouse
    object, and the graph should keep showing it."""
    result = run(["spark.sql('CREATE VIEW reporting AS SELECT id FROM orders')"])
    assert make_ref("reporting", LH, WS) in result.writes


# --- spark.sql as a value ---------------------------------------------------


def test_a_write_off_a_sql_query_gets_column_lineage():
    """`spark.sql(…).write.saveAsTable(…)` — analysable, and previously silent.

    The SQL pass saw a read-only SELECT and threw the projection away; the chain
    reader had no source for `spark.sql(...)` at all. The write landed with no
    column edges despite every column being knowable.
    """
    result = run(
        [
            "agg = spark.sql('SELECT cust_id, sum(amount) AS total FROM orders GROUP BY cust_id')",
            "agg.write.saveAsTable('gold_totals')",
        ]
    )
    assert edges(result, GOLD) == {
        ("cust_id", ORDERS, "cust_id"),
        ("total", ORDERS, "amount"),
    }


def test_a_chain_can_carry_on_from_a_sql_query():
    result = run(
        [
            "from pyspark.sql.functions import col",
            "spark.sql('SELECT id, amount FROM orders')"
            ".withColumn('doubled', col('amount') * 2)"
            ".write.saveAsTable('gold_totals')",
        ]
    )
    assert ("doubled", ORDERS, "amount") in edges(result, GOLD)


def test_a_dynamic_query_is_still_skipped_rather_than_guessed_at():
    """An f-string's value is not knowable without running the cell. Making
    `spark.sql` a source must not change that."""
    result = run(["t = 'orders'\nspark.sql(f'SELECT id FROM {t}').write.saveAsTable('gold_totals')"])
    assert edges(result, GOLD) == set()
    assert result.coverage is not None
    assert result.coverage.dynamic_sql_cells == 1


# --- both engines must agree ------------------------------------------------

VIEW_NOTEBOOK = [
    "df = spark.table('orders').filter('amount > 0')\ndf.createOrReplaceTempView('staged')",
    "spark.sql('CREATE TABLE silver_orders AS SELECT s.id, s.amount, c.region "
    "FROM staged s JOIN customers c ON s.cust_id = c.cust_id')",
]


@pytest.mark.skipif(not spark_available(), reason="pinned Spark venv not installed")
def test_the_spark_engine_agrees_with_the_stub_on_a_view_notebook():
    """Catalyst inlines the view body, so the real sources are there to be found.

    All the Spark path needed was to stop resolving the view's own name as a
    table — but it needed that just as much as the stub did, and for exactly the
    same reason.
    """
    spark = run(VIEW_NOTEBOOK, engine="spark")
    assert spark.engine == "spark"
    assert PHANTOM not in spark.reads
    assert PHANTOM not in spark.tables
    assert edges(spark, SILVER) == edges(run(VIEW_NOTEBOOK), SILVER)


@pytest.mark.skipif(not spark_available(), reason="pinned Spark venv not installed")
def test_the_spark_engine_tracks_a_view_declared_in_sql():
    result = run(
        [
            "spark.sql('CREATE OR REPLACE TEMP VIEW staged AS SELECT id FROM orders')",
            "spark.sql('CREATE TABLE silver_orders AS SELECT id FROM staged')",
        ],
        engine="spark",
    )
    assert PHANTOM not in result.reads
    assert ORDERS in result.reads
