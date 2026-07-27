"""The sandbox harness (M2a): the isolated stub executor and its router.

These spawn the real child subprocess — no Fabric, no Spark — so the isolation
boundary itself is under test, not a mock of it. The credential-scrub assertion
is the load-bearing one: a secret set in the parent must not be visible to the
child, and the child reports that back as `saw_credentials`.
"""

from __future__ import annotations

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


def test_run_endpoint_requires_cells_or_ids(client):
    resp = client.post("/fabric/sandbox/run", json={"name": "nb"})
    assert resp.status_code == 400
