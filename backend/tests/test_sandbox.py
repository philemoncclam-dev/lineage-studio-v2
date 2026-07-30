"""The sandbox harness (M2a): the isolated stub executor and its router.

These spawn the real child subprocess — no Fabric, no Spark — so the isolation
boundary itself is under test, not a mock of it. The credential-scrub assertion
is the load-bearing one: a secret set in the parent must not be visible to the
child, and the child reports that back as `saw_credentials`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.sandbox._refs import make_ref
from app.sandbox.protocol import RunRequest
from app.sandbox.runner import run_sandbox

CELLS = [
    "from pyspark.sql import Row",  # import — must not invent a 'sql' read
    "df = spark.table('raw_orders')",
    "df.write.mode('overwrite').saveAsTable('vw_sales')",
]


@pytest.fixture
def client():
    return TestClient(app)


def test_stub_run_derives_reads_and_writes():
    result = run_sandbox(
        RunRequest(notebook_name="nb", cells=CELLS, workspace="Analytics", lakehouse="Bronze"),
        engine="stub",
    )
    assert result.ok
    assert result.engine == "stub"
    assert result.reads == [make_ref("raw_orders", "Bronze", "Analytics")]
    assert result.writes == [make_ref("vw_sales", "Bronze", "Analytics")]


def test_stub_run_reports_each_tables_workspace():
    result = run_sandbox(
        RunRequest(notebook_name="nb", cells=CELLS, workspace="Analytics", lakehouse="Bronze"),
        engine="stub",
    )
    raw = result.tables[make_ref("raw_orders", "Bronze", "Analytics")]
    assert (raw.workspace, raw.lakehouse, raw.table) == ("Analytics", "Bronze", "raw_orders")
    assert raw.resolved is True


def test_stub_run_keeps_cross_workspace_tables_apart():
    """The bug this replaced: both collapsed to `customers` and became one node."""
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=[
                "a = spark.table('Finance.Gold.customers')",
                "b = spark.table('Marketing.Gold.customers')",
            ],
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    assert result.reads == [
        make_ref("customers", "Gold", "Finance"),
        make_ref("customers", "Gold", "Marketing"),
    ]


def test_stub_run_leaves_an_unknown_workspace_unresolved():
    """An unqualified name with no notebook context must not claim a workspace."""
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS), engine="stub")
    assert result.tables[result.reads[0]].resolved is False


def test_import_line_does_not_invent_a_read():
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS), engine="stub")
    assert "sql" not in result.reads


def test_child_cannot_see_a_parent_credential(monkeypatch):
    """The safety guarantee, made observable: a secret in the parent env is
    scrubbed before the child spawns, so the child reports saw_credentials=False."""
    monkeypatch.setenv("PURVIEW_CLIENT_SECRET", "super-secret-value")
    result = run_sandbox(RunRequest(notebook_name="nb", cells=["df = spark.table('t')"]), engine="stub")
    assert result.saw_credentials is False


def test_a_cell_that_reads_and_writes_the_same_table_is_a_write():
    cells = ["df = spark.table('t'); df.write.saveAsTable('t')"]
    result = run_sandbox(RunRequest(notebook_name="nb", cells=cells), engine="stub")
    assert result.writes == [make_ref("t")]
    assert result.reads == []


def test_run_endpoint_accepts_direct_cells(client):
    # Schema provided so the run resolves under either engine (the Spark engine
    # needs it to register the read view; the stub ignores it).
    resp = client.post(
        "/fabric/sandbox/run",
        json={
            "name": "nb",
            "cells": CELLS,
            "schemas": {make_ref("raw_orders", "Bronze", "Analytics"): [{"name": "order_id", "type": "long"}]},
            "workspace": "Analytics",
            "lakehouse": "Bronze",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"]
    assert body["reads"] == [make_ref("raw_orders", "Bronze", "Analytics")]
    assert body["writes"] == [make_ref("vw_sales", "Bronze", "Analytics")]


# --- schemas the stub carries through --------------------------------------
# It used to drop `schemas` on the floor, so `table_schemas` came back empty and
# every table card in PRODUCTION (which runs the stub — there is no JVM there)
# rendered bare. The columns were fetched, sent, and discarded one step from
# being shown.

def test_stub_carries_the_schemas_it_was_given():
    ref = make_ref("raw_orders", "Bronze", "Analytics")
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=CELLS,
            schemas={ref: [{"name": "order_id", "type": "long"}, {"name": "total", "type": "double"}]},
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    assert [c.name for c in result.table_schemas[ref]] == ["order_id", "total"]
    assert result.table_schemas[ref][1].type == "double"


def test_a_table_known_only_by_its_schema_still_gets_its_parts():
    """Otherwise it renders as workspace-unknown despite a fully qualified ref."""
    ref = make_ref("reference_data", "Gold", "Finance")
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=["x = 1"],
            schemas={ref: [{"name": "id", "type": "long"}]},
        ),
        engine="stub",
    )
    assert result.tables[ref].workspace == "Finance"
    assert result.tables[ref].resolved is True


def test_no_schemas_means_no_table_schemas_rather_than_an_error():
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS), engine="stub")
    assert result.table_schemas == {}


def test_run_endpoint_requires_cells_or_ids(client):
    resp = client.post("/fabric/sandbox/run", json={"name": "nb"})
    assert resp.status_code == 400


# --- executor output robustness -------------------------------------------
# The child writes one JSON object to stdout but does not OWN stdout: the Spark
# JVM writes there too, and on Windows a shutdown line can land after the
# result. Parsing the whole stream then fails on trailing characters and a
# perfectly good run is reported as a crash.

def test_jvm_noise_after_the_result_does_not_fail_the_run():
    from app.sandbox.runner import _result_json

    payload = '{"ok": true, "engine": "spark", "reads": []}'
    polluted = payload + "\nThe process ... has been terminated.\n"
    assert json.loads(_result_json(polluted))["engine"] == "spark"


def test_jvm_noise_before_the_result_does_not_fail_the_run():
    from app.sandbox.runner import _result_json

    polluted = 'WARN: something from the JVM\n{"ok": true, "engine": "spark"}'
    assert json.loads(_result_json(polluted))["ok"] is True


def test_a_path_write_is_captured_not_discarded():
    """`df.write.save("abfss://…")` is how Fabric writes to a FOREIGN lakehouse.

    It used to be a no-op sink, so the most common cross-workspace write
    produced no lineage at all.
    """
    from app.sandbox._refs import make_ref

    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=[
                "df = spark.table('raw_orders')",
                "df.write.mode('overwrite').save("
                "'abfss://ws-guid@onelake.dfs.fabric.microsoft.com/lh-guid/Tables/out_table')",
            ],
            workspace="Analytics",
            lakehouse="Bronze",
            name_map={"ws-guid": "Finance", "lh-guid": "Gold"},
        ),
        engine="stub",
    )
    assert make_ref("out_table", "Gold", "Finance") in result.writes


# --- coverage: the gap reports itself --------------------------------------
# The same lesson as SchemaResolution, applied to code. An empty column_lineage
# used to mean any of four things — nothing to find, the DataFrame API on an
# engine that reads only SQL, a dynamically built query, an unparsable cell — and
# the result could not tell them apart.

def test_a_dataframe_write_is_reported_as_an_engine_limit_not_an_empty_result():
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=["df = spark.table('src')", "df.write.mode('overwrite').saveAsTable('dst')"],
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    cov = result.coverage
    assert cov is not None
    assert cov.dataframe_write_cells == 1
    # The write happened and has no column lineage — the fact that matters.
    assert cov.writes == 1
    assert cov.writes_with_column_lineage == 0
    assert cov.writes_without_column_lineage == [make_ref("dst", "Bronze", "Analytics")]
    assert any("DataFrame API" in line for line in result.log)


def test_a_sql_write_reports_its_columns_as_covered():
    ref = make_ref("src", "Bronze", "Analytics")
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=["spark.sql('CREATE TABLE dst AS SELECT order_id FROM src')"],
            schemas={ref: [{"name": "order_id", "type": "long"}]},
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )
    cov = result.coverage
    assert cov.sql_statements == 1
    assert cov.writes == 1
    assert cov.writes_with_column_lineage == 1
    assert cov.writes_without_column_lineage == []


def test_a_dynamically_built_query_is_counted_not_silently_dropped():
    """An f-string table name is skipped on purpose — but silently, until now."""
    result = run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=["t = 'orders'\nspark.sql(f'SELECT * FROM {t}')"],
        ),
        engine="stub",
    )
    assert result.coverage.dynamic_sql_cells == 1
    assert any("dynamically" in line for line in result.log)


def test_an_unparsable_cell_is_counted():
    result = run_sandbox(
        RunRequest(notebook_name="nb", cells=["def broken(:\n  pass"]), engine="stub"
    )
    assert result.coverage.unparsable_cells == 1


def test_a_magic_cell_is_not_an_unparsable_python_cell():
    result = run_sandbox(
        RunRequest(notebook_name="nb", cells=["%%sql\nSELECT 1 FROM t"]), engine="stub"
    )
    assert result.coverage.unparsable_cells == 0
    assert result.coverage.sql_cells == 1


def test_a_read_only_notebook_reports_no_missing_coverage():
    """The one case where an empty column_lineage really is 'nothing to see'."""
    result = run_sandbox(
        RunRequest(notebook_name="nb", cells=["df = spark.table('t')", "df.count()"]),
        engine="stub",
    )
    cov = result.coverage
    assert (cov.writes, cov.dataframe_write_cells, cov.dynamic_sql_cells) == (0, 0, 0)
    assert cov.writes_without_column_lineage == []


# --- the run leaves nothing behind ----------------------------------------
# `os.rmdir` removed only an EMPTY working directory, so every Spark run — which
# leaves a spark-warehouse and a metastore_db in there — leaked its whole tree
# into temp, permanently. The stub leaks nothing by itself, but it goes through
# the same cleanup, so it can hold the guarantee under test.

def _sandbox_workdirs() -> set[str]:
    import tempfile

    return {p.name for p in Path(tempfile.gettempdir()).glob("lsbx_*")}


def test_a_run_removes_its_working_directory():
    before = _sandbox_workdirs()
    run_sandbox(RunRequest(notebook_name="nb", cells=CELLS), engine="stub")
    assert _sandbox_workdirs() - before == set()


def test_a_non_empty_working_directory_is_still_removed(monkeypatch):
    """What Spark actually does: leave files behind. `rmdir` refused those."""
    from app.sandbox import runner

    before = _sandbox_workdirs()
    real_cmd = runner._executor_cmd

    def litter(request_file: str, engine: str):
        # Stand in for the warehouse Spark writes into its cwd.
        (Path(request_file).parent / "spark-warehouse").mkdir(exist_ok=True)
        return real_cmd(request_file, engine)

    monkeypatch.setattr(runner, "_executor_cmd", litter)
    runner.run_sandbox(RunRequest(notebook_name="nb", cells=CELLS), engine="stub")
    assert _sandbox_workdirs() - before == set()


def test_a_timed_out_run_is_cleaned_up_and_names_its_engine():
    """The engine was hardcoded to "stub" on every failure path, so a Spark
    timeout sent whoever read the error to the wrong executor."""
    before = _sandbox_workdirs()
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS), timeout=0, engine="stub")
    assert result.ok is False
    assert "exceeded" in (result.error or "")
    assert result.engine == "stub"
    assert _sandbox_workdirs() - before == set()


def test_abfss_workspaces_are_collected_for_name_resolution():
    from app.sandbox._refs import referenced_workspace_ids

    cells = [
        "df.write.save('abfss://87b1b30f-9939-4dbc-8a50-a7a0e82df415@onelake.dfs."
        "fabric.microsoft.com/f3f56b4a-b9ee-4a31-b6bf-c1dda2e15075/Tables/t')",
        "x = 1",
    ]
    assert referenced_workspace_ids(cells) == ["87b1b30f-9939-4dbc-8a50-a7a0e82df415"]
