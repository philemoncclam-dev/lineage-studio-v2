"""Column lineage read out of DataFrame chains — the other half of what
PRODUCTION runs.

The deployed backend has no JVM, so `spark.table(...).select(...).withColumn(...)
.write.saveAsTable(...)` — the way most notebooks are actually written — produced
no column edges at all. `_dflineage` reads those chains symbolically.

Two things are being tested, and the second matters as much as the first: that
the common shapes resolve, and that everything else **abstains**. A wrong column
edge is worse than a missing one, so a chain the reader does not positively
understand must yield nothing rather than a guess.
"""

from __future__ import annotations

import sys
from pathlib import Path

from app.sandbox._refs import make_ref
from app.sandbox.protocol import RunRequest
from app.sandbox.runner import run_sandbox

# The child modules are launched by path and import each other as siblings, so
# the sandbox directory has to lead sys.path to import them here too.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "sandbox"))
import _dflineage  # noqa: E402

WS, LH = "Analytics", "Bronze"
CTX = {"default_workspace": WS, "default_lakehouse": LH, "name_map": {}}

ORDERS = make_ref("orders", LH, WS)
CUSTOMERS = make_ref("customers", LH, WS)
OUT = make_ref("gold_out", LH, WS)

SCHEMAS = {
    ORDERS: [
        {"name": "order_id", "type": "bigint"},
        {"name": "customer_id", "type": "bigint"},
        {"name": "amount", "type": "double"},
    ],
    CUSTOMERS: [
        {"name": "customer_id", "type": "bigint"},
        {"name": "name", "type": "string"},
        {"name": "region", "type": "string"},
    ],
}


def edges(cells, schemas=None):
    flows, _writes, _log = _dflineage.analyze_cells(cells, schemas or SCHEMAS, CTX)
    return {(f["to_column"], f["from_table"], f["from_column"]) for f in flows}


def transforms(cells):
    flows, _writes, _log = _dflineage.analyze_cells(cells, SCHEMAS, CTX)
    return {f["to_column"]: f["transform"] for f in flows}


# --- the shapes that must resolve -----------------------------------------

def test_a_straight_copy_carries_every_column():
    assert edges(["spark.table('orders').write.saveAsTable('gold_out')"]) == {
        ("order_id", ORDERS, "order_id"),
        ("customer_id", ORDERS, "customer_id"),
        ("amount", ORDERS, "amount"),
    }


def test_a_select_keeps_only_what_it_projects():
    assert edges(
        [
            "from pyspark.sql.functions import col",
            "spark.table('orders').select(col('order_id'), 'amount')"
            ".write.saveAsTable('gold_out')",
        ]
    ) == {("order_id", ORDERS, "order_id"), ("amount", ORDERS, "amount")}


def test_the_chain_survives_being_split_across_cells():
    """A notebook builds a frame in one cell and writes it in another — the
    variable state has to persist exactly as it does in a session."""
    assert edges(
        [
            "df = spark.table('orders')",
            "df = df.filter(df['amount'] > 0).select('customer_id', 'amount')",
            "df.write.mode('overwrite').saveAsTable('gold_out')",
        ]
    ) == {("customer_id", ORDERS, "customer_id"), ("amount", ORDERS, "amount")}


def test_with_column_records_the_expression_and_its_inputs():
    cells = [
        "from pyspark.sql.functions import col",
        "spark.table('orders').select('order_id')"
        ".withColumn('doubled', col('amount') * 2).write.saveAsTable('gold_out')",
    ]
    # `amount` was projected away, so the new column has no resolvable source —
    # and the reader says nothing rather than inventing one.
    assert ("doubled", ORDERS, "amount") not in edges(cells)

    cells[1] = (
        "spark.table('orders').withColumn('doubled', col('amount') * 2)"
        ".write.saveAsTable('gold_out')"
    )
    assert ("doubled", ORDERS, "amount") in edges(cells)
    assert transforms(cells)["doubled"] == "col('amount') * 2"


def test_a_rename_maps_the_new_name_to_the_old_column():
    assert ("total", ORDERS, "amount") in edges(
        [
            "spark.table('orders').withColumnRenamed('amount', 'total')"
            ".write.saveAsTable('gold_out')"
        ]
    )


def test_a_drop_removes_the_column_and_its_edge():
    out = edges(["spark.table('orders').drop('amount').write.saveAsTable('gold_out')"])
    assert ("order_id", ORDERS, "order_id") in out
    assert not [e for e in out if e[0] == "amount"]


def test_a_join_attributes_each_column_to_its_own_table():
    """The case column ownership exists for: both tables have `customer_id`, so
    a name-matched edge could not say which one an output column came from."""
    out = edges(
        [
            "o = spark.table('orders')",
            "c = spark.table('customers')",
            "o.join(c, 'customer_id').select('amount', 'region').write.saveAsTable('gold_out')",
        ]
    )
    assert out == {("amount", ORDERS, "amount"), ("region", CUSTOMERS, "region")}


def test_a_grouped_aggregate_keeps_keys_and_aggregates():
    out = edges(
        [
            "from pyspark.sql.functions import col, sum as ssum",
            "spark.table('orders').groupBy(col('customer_id'))"
            ".agg(ssum('amount').alias('total')).write.saveAsTable('gold_out')",
        ]
    )
    assert out == {
        ("customer_id", ORDERS, "customer_id"),
        ("total", ORDERS, "amount"),
    }


def test_a_union_carries_both_sides():
    out = edges(
        [
            "a = spark.table('orders').select('customer_id')",
            "b = spark.table('customers').select('customer_id')",
            "a.union(b).write.saveAsTable('gold_out')",
        ]
    )
    assert out == {
        ("customer_id", ORDERS, "customer_id"),
        ("customer_id", CUSTOMERS, "customer_id"),
    }


# --- the abstentions, which matter just as much ----------------------------

def test_an_unrecognised_method_yields_nothing_rather_than_a_guess():
    """`selectExpr` takes SQL strings; reading them here would be guessing."""
    assert edges(
        ["spark.table('orders').selectExpr('amount * 2 AS doubled').write.saveAsTable('gold_out')"]
    ) == set()


def test_a_computed_column_with_no_alias_is_dropped():
    """Spark generates a name for it (`upper(region)`); guessing that convention
    would put a column on the table card that the table does not have."""
    out = edges(
        [
            "from pyspark.sql.functions import upper, col",
            "spark.table('customers').select(upper(col('region'))).write.saveAsTable('gold_out')",
        ]
    )
    assert out == set()


def test_a_frame_built_under_control_flow_becomes_unknown():
    """Whether the branch ran is not knowable without evaluating it, so the
    variable it rebinds stops being trusted."""
    assert edges(
        [
            "df = spark.table('orders')",
            "if flag:\n    df = spark.table('customers')",
            "df.write.saveAsTable('gold_out')",
        ]
    ) == set()


def test_a_table_with_no_known_schema_yields_nothing():
    """No columns from OneLake means no honest column lineage — inventing them
    from the chain is exactly the guess this refuses to make."""
    assert edges(["spark.table('unknown_table').write.saveAsTable('gold_out')"]) == set()


def test_a_write_with_a_non_literal_target_is_skipped():
    assert edges(
        ["target = 'gold_out'", "spark.table('orders').write.saveAsTable(target)"]
    ) == set()


# --- through the real child process ----------------------------------------

def test_the_stub_child_returns_dataframe_column_lineage():
    """End to end: the engine production runs now answers a DataFrame notebook."""
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=[
                "from pyspark.sql.functions import col, sum as ssum",
                "df = spark.table('orders').groupBy(col('customer_id'))"
                ".agg(ssum('amount').alias('total'))",
                "df.write.mode('overwrite').saveAsTable('gold_out')",
            ],
            schemas={t: [{"name": c["name"], "type": c["type"]} for c in cols] for t, cols in SCHEMAS.items()},
            workspace=WS,
            lakehouse=LH,
        ),
        engine="stub",
    )
    assert result.ok, result.error
    assert result.engine == "stub"
    assert {(f.to_column, f.from_table, f.from_column) for f in result.column_lineage} == {
        ("customer_id", ORDERS, "customer_id"),
        ("total", ORDERS, "amount"),
    }
    # The write is no longer reported as uncovered — that was the visible symptom.
    assert result.coverage is not None
    assert result.coverage.writes_without_column_lineage == []
    # And the written table gets its columns, so its card is not bare.
    assert {c.name for c in result.table_schemas[OUT]} == {"customer_id", "total"}


def test_sql_still_wins_where_both_passes_see_the_same_write():
    """sqlglot resolved a real statement; the chain reader reasoned about one.
    Where they overlap the stronger evidence must not be duplicated or lost."""
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=[
                "spark.sql('CREATE TABLE gold_out AS SELECT amount FROM orders')",
                "spark.table('orders').write.saveAsTable('gold_out')",
            ],
            schemas={t: [{"name": c["name"], "type": c["type"]} for c in cols] for t, cols in SCHEMAS.items()},
            workspace=WS,
            lakehouse=LH,
        ),
        engine="stub",
    )
    assert result.ok, result.error
    into_out = [f for f in result.column_lineage if f.to_table == OUT]
    assert {f.to_column for f in into_out} == {"amount"}
