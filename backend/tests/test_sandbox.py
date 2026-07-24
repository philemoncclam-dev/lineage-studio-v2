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
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS))
    assert result.ok
    assert result.engine == "stub"
    assert result.reads == ["raw_orders"]
    assert result.writes == ["vw_sales"]


def test_import_line_does_not_invent_a_read():
    result = run_sandbox(RunRequest(notebook_name="nb", cells=CELLS))
    assert "sql" not in result.reads


def test_child_cannot_see_a_parent_credential(monkeypatch):
    """The safety guarantee, made observable: a secret in the parent env is
    scrubbed before the child spawns, so the child reports saw_credentials=False."""
    monkeypatch.setenv("PURVIEW_CLIENT_SECRET", "super-secret-value")
    result = run_sandbox(RunRequest(notebook_name="nb", cells=["df = spark.table('t')"]))
    assert result.saw_credentials is False


def test_a_cell_that_reads_and_writes_the_same_table_is_a_write():
    cells = ["df = spark.table('t'); df.write.saveAsTable('t')"]
    result = run_sandbox(RunRequest(notebook_name="nb", cells=cells))
    assert result.writes == ["t"]
    assert result.reads == []


def test_run_endpoint_accepts_direct_cells(client):
    resp = client.post("/fabric/sandbox/run", json={"name": "nb", "cells": CELLS})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] and body["reads"] == ["raw_orders"] and body["writes"] == ["vw_sales"]


def test_run_endpoint_requires_cells_or_ids(client):
    resp = client.post("/fabric/sandbox/run", json={"name": "nb"})
    assert resp.status_code == 400
