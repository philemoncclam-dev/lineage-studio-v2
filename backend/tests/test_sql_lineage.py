"""Column lineage derived from SQL text — the path PRODUCTION actually runs.

The deployed backend has no JVM, so the Spark executor's plan analysis is
unavailable there and every model created on prod came out with no attributes.
These cover the sqlglot path that fixes that, driven through the real stub
child process wherever the result shape matters.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app.sandbox._refs import make_ref
from app.sandbox.protocol import RunRequest
from app.sandbox.runner import run_sandbox

# The child modules are launched by path and import each other as siblings, so
# the sandbox directory has to lead sys.path to import them here too.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "sandbox"))
import _dflineage  # noqa: E402
import _sqllineage  # noqa: E402

CTX = {"default_workspace": "Analytics", "default_lakehouse": "Bronze", "name_map": {}}
ORDERS = make_ref("silver_orders", "Bronze", "Analytics")
CUSTOMERS = make_ref("dim_customer", "Gold", "Finance")
SCHEMAS = {
    ORDERS: [{"name": "customer_id", "type": "bigint"}, {"name": "total", "type": "double"}],
    CUSTOMERS: [{"name": "customer_id", "type": "bigint"}, {"name": "name", "type": "string"}],
}


def flows(sql, schemas=None):
    _target, _reads, out, _columns = _sqllineage.analyze(sql, schemas or SCHEMAS, CTX)
    return {(f["to_column"], f["from_table"], f["from_column"]): f for f in out}


# --- finding the SQL -------------------------------------------------------

def test_finds_a_triple_quoted_query():
    """The normal way these are written, and exactly what a regex gets wrong."""
    cell = 'df = spark.sql("""\n  SELECT a\n  FROM t\n""")'
    assert _sqllineage.sql_statements(cell) == ["\n  SELECT a\n  FROM t\n"]


def test_reads_a_sql_magic_cell():
    assert _sqllineage.sql_statements("%%sql\nSELECT a FROM t") == ["SELECT a FROM t"]


def test_skips_an_f_string_rather_than_guessing_its_value():
    """Its value isn't knowable without running the cell; inventing one would
    produce lineage for a query that was never issued."""
    assert _sqllineage.sql_statements('spark.sql(f"SELECT * FROM {table}")') == []


def test_a_cell_that_is_not_valid_python_yields_nothing():
    assert _sqllineage.sql_statements("this is prose, not code (((") == []


# --- resolving the columns -------------------------------------------------

def test_resolves_a_join_to_the_right_source_table():
    """The case the Spark path cannot do: `customer_id` is on BOTH sides, so
    matching by name alone ties and the edge gets dropped."""
    got = flows(
        """
        CREATE TABLE gold_ltv AS
        SELECT o.customer_id, c.name, SUM(o.total) AS lifetime_value
        FROM silver_orders o
        JOIN Finance.Gold.dim_customer c ON c.customer_id = o.customer_id
        GROUP BY o.customer_id, c.name
        """
    )
    assert ("customer_id", ORDERS, "customer_id") in got
    assert ("name", CUSTOMERS, "name") in got
    assert ("lifetime_value", ORDERS, "total") in got
    # ...and NOT attributed to the other side of the join.
    assert ("customer_id", CUSTOMERS, "customer_id") not in got


def test_records_the_expression_for_a_computed_column():
    got = flows("CREATE TABLE t2 AS SELECT UPPER(name) AS shouty FROM Finance.Gold.dim_customer")
    assert got[("shouty", CUSTOMERS, "name")]["transform"] == "UPPER(`dim_customer`.`name`)"


def test_a_passthrough_carries_no_transform():
    got = flows("CREATE TABLE t2 AS SELECT total FROM silver_orders")
    assert got[("total", ORDERS, "total")]["transform"] is None


def test_a_rename_is_a_passthrough_with_a_different_name():
    got = flows("CREATE TABLE t2 AS SELECT total AS revenue FROM silver_orders")
    assert got[("revenue", ORDERS, "total")]["transform"] is None


def test_star_is_expanded_from_the_schemas():
    got = flows("CREATE TABLE t2 AS SELECT * FROM silver_orders")
    assert ("customer_id", ORDERS, "customer_id") in got
    assert ("total", ORDERS, "total") in got


def test_insert_into_is_a_write_like_ctas():
    target, _reads, out, _columns = _sqllineage.analyze(
        "INSERT INTO Finance.Gold.customer_ltv SELECT customer_id FROM silver_orders",
        SCHEMAS,
        CTX,
    )
    assert target == make_ref("customer_ltv", "Gold", "Finance")
    assert out[0]["from_table"] == ORDERS


def test_a_read_only_query_reports_reads_but_no_flows():
    target, reads, out, _columns = _sqllineage.analyze("SELECT * FROM silver_orders", SCHEMAS, CTX)
    assert target == ""
    assert reads == {ORDERS}
    assert out == []


def test_a_cte_is_not_reported_as_a_table_that_was_read():
    _target, reads, _out, _columns = _sqllineage.analyze(
        "CREATE TABLE t2 AS WITH recent AS (SELECT * FROM silver_orders) SELECT * FROM recent",
        SCHEMAS,
        CTX,
    )
    assert reads == {ORDERS}


def test_unparseable_sql_degrades_instead_of_raising():
    assert _sqllineage.analyze("SELCT ?? FRM (((", SCHEMAS, CTX) == ("", set(), [], [])


def test_a_column_from_an_unknown_table_still_yields_an_edge():
    """Partial schema coverage is the normal case, not an error."""
    got = flows("CREATE TABLE t2 AS SELECT mystery FROM unknown_table", {})
    key = ("mystery", make_ref("unknown_table", "Bronze", "Analytics"), "mystery")
    assert key in got


# --- through the real child process ----------------------------------------

def test_the_stub_engine_returns_column_lineage_end_to_end():
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=[
                'spark.sql("""\n'
                "CREATE TABLE gold_ltv AS\n"
                "SELECT o.customer_id, SUM(o.total) AS lifetime_value\n"
                "FROM silver_orders o GROUP BY o.customer_id\n"
                '""")'
            ],
            schemas={ORDERS: SCHEMAS[ORDERS]},
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    assert result.ok
    assert result.engine == "stub"
    pairs = {(f.to_column, f.from_table, f.from_column) for f in result.column_lineage}
    assert ("lifetime_value", ORDERS, "total") in pairs
    assert ("customer_id", ORDERS, "customer_id") in pairs


def test_the_written_table_gets_a_schema_from_its_projection():
    """Without this the target card is bare even when the lineage into it is
    known — the Spark path gets these from the analyzer, with types."""
    written = make_ref("gold_ltv", "Bronze", "Analytics")
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=[
                'spark.sql("CREATE TABLE gold_ltv AS SELECT customer_id, total FROM silver_orders")'
            ],
            schemas={ORDERS: SCHEMAS[ORDERS]},
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    assert [c.name for c in result.table_schemas[written]] == ["customer_id", "total"]


def test_a_schema_the_backend_sent_is_never_overwritten_by_a_projection():
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=['spark.sql("CREATE TABLE silver_orders AS SELECT 1 AS only_col FROM t")'],
            schemas={ORDERS: SCHEMAS[ORDERS]},
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    assert [c.name for c in result.table_schemas[ORDERS]] == ["customer_id", "total"]


def test_a_dataframe_only_notebook_now_yields_column_lineage():
    """This used to assert `column_lineage == []`.

    The DataFrame API needed a plan and a plan needed Spark, so on production —
    which has no JVM — a notebook written this way produced no column edges at
    all. `_dflineage` reads the chain symbolically instead, and a straight copy
    is the simplest thing it must get right.
    """
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=["df = spark.table('silver_orders')", "df.write.saveAsTable('out')"],
            schemas={ORDERS: SCHEMAS[ORDERS]},
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    out = make_ref("out", "Bronze", "Analytics")
    assert out in result.writes
    # Every column carried through, each attributed to the table it came from.
    assert {(f.to_column, f.from_column, f.from_table) for f in result.column_lineage} == {
        ("customer_id", "customer_id", ORDERS),
        ("total", "total", ORDERS),
    }


@pytest.mark.parametrize("missing", [True, False])
def test_the_run_survives_sqlglot_being_unavailable(monkeypatch, missing):
    """A missing optional dependency must degrade to 'no column lineage',
    never fail the run."""
    monkeypatch.setattr(_sqllineage, "AVAILABLE", not missing)
    reader = _dflineage.analyze_notebook(
        ['spark.sql("CREATE TABLE t2 AS SELECT total FROM silver_orders")'], SCHEMAS, CTX
    )
    if missing:
        assert (reader.reads, reader.writes, reader.flows) == (set(), set(), [])
        assert any("unavailable" in line for line in reader.log)
    else:
        assert reader.flows


# --- Fabric Runtime 2.0 (Spark 4.x) syntax ---------------------------------
# Runtime 2.0 brings VARIANT, and with it the `:` path operator. sqlglot's
# `spark` dialect rejects it, and `analyze` never raises — so a cell using it
# went silently missing from the graph rather than failing loudly. Hence
# DIALECT = "databricks".

RAW = make_ref("bronze_events", "Bronze", "Analytics")
RAW_SCHEMA = {RAW: [{"name": "payload", "type": "variant"}, {"name": "id", "type": "bigint"}]}


def test_traces_a_column_read_out_of_a_variant_path():
    got = flows(
        "CREATE TABLE gold_users AS SELECT payload:user.id::string AS uid FROM bronze_events",
        RAW_SCHEMA,
    )
    assert ("uid", RAW, "payload") in got


def test_pipe_syntax_still_resolves_its_source():
    """Spark 4.0's `|>`. Table-level reach is the bar here, not columns."""
    target, reads, _flows, _cols = _sqllineage.analyze(
        "CREATE TABLE gold_big AS FROM silver_orders |> WHERE total > 0 |> SELECT customer_id",
        SCHEMAS,
        CTX,
    )
    assert target and ORDERS in reads
