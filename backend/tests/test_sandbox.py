"""The sandbox harness (M2a): the isolated stub executor and its router.

These spawn the real child subprocess — no Fabric, no Spark — so the isolation
boundary itself is under test, not a mock of it. The credential-scrub assertion
is the load-bearing one: a secret set in the parent must not be visible to the
child, and the child reports that back as `saw_credentials`.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.sandbox import runner as _runner
from app.sandbox._refs import make_ref
from app.sandbox.protocol import RunRequest
from app.sandbox.runner import run_sandbox

# The child modules are launched by path and import each other as siblings, so
# the sandbox directory has to lead sys.path to import them here too.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "sandbox"))
import _isolation  # noqa: E402

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


def test_the_child_gets_a_throwaway_home_not_the_real_one():
    """The hole the env scrub never covered.

    `DefaultAzureCredential` needs no environment variable at all — it reads
    `~/.azure/msal_token_cache.json`. So passing the real `USERPROFILE` through
    handed the child a working Azure token while the credential probe, which
    only looked at `os.environ`, truthfully reported having seen none. Every
    variable that resolves to a home must therefore land inside the run's own
    temp tree.
    """
    workdir = tempfile.mkdtemp(prefix="lsbx_test_")
    try:
        env = _runner._scrubbed_env(workdir)
        real_home = str(Path.home()).lower()
        for var in ("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP"):
            value = env[var].lower()
            assert value != real_home, f"{var} still points at the real profile"
            assert value.startswith(workdir.lower()), f"{var} escaped the workdir"
        # Spark writes `.ivy2`/`derby.log` into it, so it has to actually exist.
        assert Path(env["HOME"]).is_dir()
        # The Windows fallback pair resolves to the same fake home, not the real
        # one — leaving it behind would reopen the door the rest of this closes.
        assert (env["HOMEDRIVE"] + env["HOMEPATH"]).lower().startswith(workdir.lower())
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def test_no_secret_env_var_survives_the_scrub():
    """The half that always worked, kept honest alongside the new half."""
    os.environ["PURVIEW_CLIENT_SECRET"] = "super-secret-value"
    try:
        workdir = tempfile.mkdtemp(prefix="lsbx_test_")
        env = _runner._scrubbed_env(workdir)
        shutil.rmtree(workdir, ignore_errors=True)
    finally:
        os.environ.pop("PURVIEW_CLIENT_SECRET", None)
    assert not [k for k in env if "SECRET" in k.upper() or k.upper().startswith("PURVIEW_")]


def test_the_credential_probe_notices_a_reachable_token_cache(tmp_path, monkeypatch):
    """The probe's own regression test.

    It reported False in exactly the case that mattered, because it only read
    `os.environ`. Given a home with an `.azure` cache in it, it must now say so
    — otherwise the redirection above could regress silently and the assertion
    would keep claiming everything was fine.
    """
    (tmp_path / ".azure").mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    assert _isolation.saw_credentials() is True
    assert any("azure" in item.lower() for item in _isolation.reachable_credentials())

    # A clean home is clean — the probe must not cry wolf on every run.
    #
    # The environment has to be scrubbed for this half, because the probe reads
    # BOTH halves and this half is only about the home directory. Without it the
    # assertion passed or failed on whatever the machine running the tests
    # happened to export: a developer box or a CI runner with `GH_TOKEN` or
    # `AWS_SECRET_ACCESS_KEY` set failed it, for the entirely correct reason that
    # the probe saw those and said so.
    for key in list(os.environ):
        up = key.upper()
        if up.startswith(_isolation._ENV_PREFIXES) or any(
            s in up for s in _isolation._ENV_SUBSTRINGS
        ):
            monkeypatch.delenv(key, raising=False)
    clean = tmp_path / "clean"
    clean.mkdir()
    monkeypatch.setenv("HOME", str(clean))
    monkeypatch.setenv("USERPROFILE", str(clean))
    monkeypatch.setenv("HOMEDRIVE", "")
    monkeypatch.setenv("HOMEPATH", "")
    assert _isolation.saw_credentials() is False


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


# --- schemas carried between steps of a sequence ---------------------------
# A sequence is a chain — bronze creates a table, silver reads it — but each step
# is its own process, so a downstream notebook arrived knowing nothing about the
# table its predecessor had just written. Its columns came back empty (that table
# need not exist in OneLake yet) and the downstream half of every medallion
# sequence produced no column lineage.

def test_a_carried_schema_gives_a_downstream_notebook_its_column_lineage(client):
    upstream = make_ref("bronze_orders", "Bronze", "Analytics")
    resp = client.post(
        "/fabric/sandbox/run",
        json={
            "name": "silver",
            "cells": ["spark.sql('CREATE TABLE silver_orders AS SELECT order_id FROM bronze_orders')"],
            "carried_schemas": {upstream: [{"name": "order_id", "type": "long"}]},
            "workspace": "Analytics",
            "lakehouse": "Bronze",
        },
    )
    body = resp.json()
    # The upstream table's columns reached the run, and the write it fed came out
    # with column lineage instead of bare. Asserted without `from_table`, which
    # only the stub engine fills — the Spark engine resolves attributes by name
    # (see ColumnFlow.from_table), and this endpoint runs whichever is available.
    assert [c["name"] for c in body["table_schemas"][upstream]] == ["order_id"]
    assert body["coverage"]["writes_with_column_lineage"] == 1
    assert {(f["to_column"], f["from_column"]) for f in body["column_lineage"]} == {
        ("order_id", "order_id")
    }


# Columns deliberately UNQUALIFIED. A join whose source text qualifies them
# (`o.order_id`) is already attributable from the text alone; when it does not,
# only the schemas can say which side of the join owns each column — which is
# what makes the upstream carry worth doing.
JOIN_CELL = [
    "spark.sql('''CREATE TABLE gold_orders AS\n"
    "SELECT order_id, name FROM bronze_orders JOIN bronze_customers ON cid = id''')"
]


def _join_run(schemas=None):
    return run_sandbox(
        RunRequest(
            notebook_name="gold",
            cells=JOIN_CELL,
            schemas=schemas or {},
            workspace="Analytics",
            lakehouse="Bronze",
        ),
        engine="stub",
    )


def test_without_upstream_schemas_a_joined_column_has_no_owner():
    """The gap the carry closes. An edge with no `from_table` is one the frontend
    drops whenever two source tables tie on a column name — which is exactly what
    a join is — so unowned edges are lineage that never reaches the graph."""
    result = _join_run()
    assert all(f.from_table is None for f in result.column_lineage)


def test_carried_schemas_attribute_each_joined_column_to_its_own_upstream_table():
    orders = make_ref("bronze_orders", "Bronze", "Analytics")
    customers = make_ref("bronze_customers", "Bronze", "Analytics")
    result = _join_run(
        schemas={
            orders: [{"name": "order_id", "type": "long"}, {"name": "cid", "type": "long"}],
            customers: [{"name": "id", "type": "long"}, {"name": "name", "type": "string"}],
        }
    )
    owners = {(f.to_column, f.from_table) for f in result.column_lineage}
    assert ("order_id", orders) in owners
    assert ("name", customers) in owners


def test_a_carried_schema_never_overrides_one_onelake_answered_for(client):
    """OneLake is ground truth for a table that already exists; an upstream run
    is only the better authority for one it just created."""
    ref = make_ref("t", "Bronze", "Analytics")
    resp = client.post(
        "/fabric/sandbox/run",
        json={
            "name": "nb",
            "cells": ["x = 1"],
            "schemas": {ref: [{"name": "real_column", "type": "long"}]},
            "carried_schemas": {ref: [{"name": "stale_column", "type": "string"}]},
            "workspace": "Analytics",
            "lakehouse": "Bronze",
        },
    )
    assert [c["name"] for c in resp.json()["table_schemas"][ref]] == ["real_column"]


def test_carrying_nothing_leaves_the_run_unchanged(client):
    resp = client.post(
        "/fabric/sandbox/run",
        json={"name": "nb", "cells": CELLS, "carried_schemas": {}, "workspace": "Analytics"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"]


# --- MERGE INTO: the Delta upsert ------------------------------------------
# Matched by nothing on either engine, so a gold notebook built on MERGE — which
# is most of them — produced no write edge, no table, no columns. Nothing.

MERGE_CELL = [
    "spark.sql('''\n"
    "MERGE INTO customers AS t USING staging_updates AS s ON t.id = s.id\n"
    "WHEN MATCHED THEN UPDATE SET t.name = s.name, t.total = s.amount * 2\n"
    "WHEN NOT MATCHED THEN INSERT (id, name) VALUES (s.id, s.name)\n"
    "''')"
]


def _merge_run(cells=None, schemas=None):
    return run_sandbox(
        RunRequest(
            notebook_name="nb",
            cells=cells or MERGE_CELL,
            schemas=schemas or {},
            workspace="Analytics",
            lakehouse="Gold",
        ),
        engine="stub",
    )


def test_a_merge_is_a_write_to_its_target():
    result = _merge_run()
    assert result.writes == [make_ref("customers", "Gold", "Analytics")]


def test_a_merge_reads_its_using_source():
    result = _merge_run()
    assert make_ref("staging_updates", "Gold", "Analytics") in result.reads


def test_a_merge_resolves_column_lineage_on_both_clauses():
    result = _merge_run()
    target = make_ref("customers", "Gold", "Analytics")
    source = make_ref("staging_updates", "Gold", "Analytics")
    flows = {(f.to_column, f.from_column, f.from_table) for f in result.column_lineage}
    # UPDATE SET — a passthrough and a computed column.
    assert ("name", "name", source) in flows
    assert ("total", "amount", source) in flows
    # NOT MATCHED INSERT — the column list paired with its values.
    assert ("id", "id", source) in flows
    assert all(f.to_table == target for f in result.column_lineage)


def test_a_computed_merge_column_carries_its_transform():
    result = _merge_run()
    total = [f for f in result.column_lineage if f.to_column == "total"]
    assert total and total[0].transform == "s.amount * 2"
    name = [f for f in result.column_lineage if f.to_column == "name"]
    assert name and name[0].transform is None  # A passthrough has none.


def test_a_star_merge_maps_every_source_column_to_its_namesake():
    """`INSERT *` / `UPDATE SET *` carry no column list; the schemas supply it."""
    source = make_ref("staging_updates", "Gold", "Analytics")
    target = make_ref("customers", "Gold", "Analytics")
    result = _merge_run(
        cells=[
            "spark.sql('''\n"
            "MERGE INTO customers AS t USING staging_updates AS s ON t.id = s.id\n"
            "WHEN MATCHED THEN UPDATE SET *\n"
            "WHEN NOT MATCHED THEN INSERT *\n"
            "''')"
        ],
        schemas={
            source: [{"name": "id"}, {"name": "name"}, {"name": "scratch"}],
            target: [{"name": "id"}, {"name": "name"}],
        },
    )
    flows = {(f.to_column, f.from_column) for f in result.column_lineage}
    assert ("id", "id") in flows
    assert ("name", "name") in flows
    # A source column the target doesn't have is not invented into it.
    assert not any(f.to_column == "scratch" for f in result.column_lineage)


def test_a_merge_from_a_subquery_reads_the_underlying_table():
    result = _merge_run(
        cells=[
            "spark.sql('''\n"
            "MERGE INTO customers AS t "
            "USING (SELECT id, amount FROM staging_updates) AS s ON t.id = s.id\n"
            "WHEN MATCHED THEN UPDATE SET t.total = s.amount\n"
            "''')"
        ]
    )
    assert make_ref("staging_updates", "Gold", "Analytics") in result.reads


def test_a_merge_delete_clause_moves_no_columns():
    result = _merge_run(
        cells=[
            "spark.sql('MERGE INTO customers AS t USING staging_updates AS s "
            "ON t.id = s.id WHEN MATCHED THEN DELETE')"
        ]
    )
    assert result.writes == [make_ref("customers", "Gold", "Analytics")]
    assert result.column_lineage == []


def test_an_update_statement_is_a_write_with_no_invented_columns():
    result = _merge_run(cells=["spark.sql('UPDATE customers SET total = 0')"])
    assert result.writes == [make_ref("customers", "Gold", "Analytics")]
    assert result.column_lineage == []


def test_a_delete_statement_is_a_write_not_a_read():
    result = _merge_run(cells=["spark.sql('DELETE FROM customers WHERE total = 0')"])
    assert result.writes == [make_ref("customers", "Gold", "Analytics")]
    assert result.reads == []


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


# --- downstream BI impact ----------------------------------------------------

def test_a_run_that_writes_nothing_says_so_rather_than_scanning(client):
    """"Nothing downstream" and "nothing written" are different answers, and
    the second one costs no admin API call to give."""
    resp = client.post(
        "/fabric/sandbox/run",
        json={
            "notebook_name": "nb",
            "cells": ["x = 1"],
            "workspace_id": "ws1",
            "include_downstream": True,
        },
    )
    assert resp.status_code == 200
    downstream = resp.json().get("downstream")
    assert downstream is not None
    assert downstream["available"] is False
    assert any("wrote no table" in n for n in downstream["notes"])


def test_downstream_is_absent_unless_asked_for(client):
    resp = client.post(
        "/fabric/sandbox/run",
        json={"notebook_name": "nb", "cells": ["x = 1"]},
    )
    assert resp.json().get("downstream") is None
