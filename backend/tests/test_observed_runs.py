"""What a notebook ACTUALLY did, read back from Fabric's Spark run history.

No network: a fake client returns the REST payloads, so what is exercised here is
the shaping — which run gets picked, how plans become refs, and above all how
each way of finding nothing is reported.

That last part is the point of the module. Fabric answers an unrunnable question
with an empty list far more often than with an error: a notebook that never ran,
a tenant without the monitoring APIs, a caller without the scope and a run that
genuinely touched no tables all produce nothing, and presenting them alike is
what `SchemaResolution` and `Coverage` already exist to stop happening elsewhere.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.fabric.client import FabricError
from app.fabric.runs import compare, latest_run, observe_run
from app.sandbox._refs import make_ref
from app.sandbox.protocol import ObservedRun

WS, LH = "Finance", "Bronze"
ORDERS = make_ref("orders", LH, WS)
CUSTOMERS = make_ref("customers", LH, WS)
ABFSS = f"abfss://{WS}@onelake.dfs.fabric.microsoft.com/{LH}.Lakehouse/Tables"

PLAN = f"""== Physical Plan ==
Execute InsertIntoHadoopFsRelationCommand (2)
+- Scan parquet (1)

(1) Scan parquet
Location: InMemoryFileIndex [{ABFSS}/orders]
ReadSchema: struct<id:bigint>

(2) Execute InsertIntoHadoopFsRelationCommand
Arguments: {ABFSS}/customers, false, Parquet, Append
"""

SESSION = {
    "livyId": "live-1",
    "sparkApplicationId": "application_1741176604085_0001",
    "state": "Success",
    "submittedDateTime": "2026-08-01T09:00:00Z",
    "submitter": {"displayName": "Ada"},
}


class FakeClient:
    """Returns REST payloads by path; `raise_on` makes a substring refuse."""

    def __init__(self, sessions=None, executions=None, raise_on=(), item=None):
        self._sessions = sessions if sessions is not None else [SESSION]
        self._executions = (
            executions
            if executions is not None
            else [{"id": 1, "status": "COMPLETED", "planDescription": PLAN}]
        )
        self._raise_on = raise_on
        # The item payload carries the notebook's edit time. Defaulting to an
        # empty one models the common tenant: the call succeeds and simply
        # names no timestamp.
        self._item = item if item is not None else {}

    def request(self, method, path, **kwargs):
        for fragment in self._raise_on:
            if fragment in path:
                raise FabricError(f"{fragment} refused")
        if path.endswith("/sql"):
            return self._executions
        if path.endswith("/livySessions"):
            return {"value": self._sessions}
        if "/items/" in path:
            return self._item
        raise AssertionError(f"unexpected path {path}")


def observe(client=None, **kw):
    return observe_run(client or FakeClient(), "ws-id", "item-id", WS, LH, **kw)


# --- the happy path ---------------------------------------------------------

def test_a_completed_run_yields_the_tables_it_touched():
    result = observe()
    assert result.available
    assert result.reads == [ORDERS]
    assert result.writes == [CUSTOMERS]
    assert result.application_id == "application_1741176604085_0001"
    assert result.submitter == "Ada"


def test_each_statement_is_reported_separately():
    """One notebook run is many SQL executions, and knowing WHICH one wrote a
    table is most of the value when a pipeline surprises you."""
    result = observe()
    assert len(result.statements) == 1
    assert result.statements[0].execution_id == 1
    assert result.statements[0].writes == [CUSTOMERS]


def test_the_tables_side_table_is_filled_for_every_ref():
    """The UI groups by workspace off this rather than parsing refs itself —
    same contract as `RunResult.tables`."""
    result = observe()
    assert set(result.tables) == {ORDERS, CUSTOMERS}
    assert result.tables[ORDERS].workspace == WS
    assert result.tables[ORDERS].resolved


def test_a_statement_that_names_no_table_is_counted_but_not_listed():
    client = FakeClient(
        executions=[
            {"id": 1, "planDescription": PLAN},
            {"id": 2, "planDescription": "== Physical Plan ==\nLocalTableScan (1)\n"},
        ]
    )
    result = observe(client)
    assert result.statements_seen == 2
    assert result.statements_resolved == 1


# --- choosing which run -----------------------------------------------------

def test_the_newest_finished_run_is_preferred_over_a_running_one():
    running = {**SESSION, "livyId": "live-2", "state": "Running",
               "submittedDateTime": "2026-08-02T09:00:00Z"}
    assert latest_run([running, SESSION])["livyId"] == "live-1"


def test_a_running_session_is_used_when_it_is_all_there_is():
    """A long-running notebook is exactly when someone wants to see what it has
    touched so far, so this must not come back empty."""
    running = {**SESSION, "state": "Running"}
    assert latest_run([running]) is running


def test_history_depth_is_reported():
    client = FakeClient(sessions=[SESSION, {**SESSION, "livyId": "old"}])
    assert any("2 run(s) in history" in note for note in observe(client).notes)


# --- every way of finding nothing, told apart -------------------------------

def test_a_notebook_that_never_ran_says_so():
    result = observe(FakeClient(sessions=[]))
    assert not result.available
    assert any("no recorded Spark runs" in note for note in result.notes)


def test_a_refused_listing_is_reported_rather_than_looking_empty():
    """The standing trap in this codebase: refused and empty are different, and
    an empty answer with no explanation is the one outcome banned here."""
    result = observe(FakeClient(raise_on=("livySessions",)))
    assert not result.available
    assert any("could not list runs" in note for note in result.notes)


def test_a_refused_sql_fetch_keeps_the_run_metadata_it_did_get():
    result = observe(FakeClient(raise_on=("/sql",)))
    assert not result.available
    assert result.application_id  # the session was readable; the plans were not
    assert any("could not read the run's SQL executions" in n for n in result.notes)


def test_a_session_with_no_application_id_says_why():
    result = observe(FakeClient(sessions=[{"livyId": "l", "state": "Error"}]))
    assert not result.available
    assert any("no Spark application id" in note for note in result.notes)


def test_a_run_with_no_sql_executions_explains_the_lazy_case():
    result = observe(FakeClient(executions=[]))
    assert result.available
    assert any("only creates one when an ACTION runs" in n for n in result.notes)


def test_unrecognised_plan_nodes_are_surfaced():
    plan = """== Physical Plan ==
Execute SaveIntoDataSourceCommand (1)

(1) Execute SaveIntoDataSourceCommand
Arguments: com.example.Sink, Map(), Append
"""
    result = observe(FakeClient(executions=[{"id": 1, "planDescription": plan}]))
    assert result.unrecognised == ["Execute SaveIntoDataSourceCommand"]
    assert any("not recognised" in note for note in result.notes)


@pytest.mark.parametrize(
    "session",
    [
        {"livySessionId": "l", "applicationId": "app_1", "status": "Success"},
        {"id": "l", "appId": "app_1", "state": "success"},
    ],
)
def test_the_field_spellings_this_surface_has_shipped_all_work(session):
    """The Fabric swagger has been wrong before (see `list_lakehouse_tables`), and
    a rename must not silently turn this feature off."""
    result = observe(FakeClient(sessions=[session]))
    assert result.available
    assert result.application_id == "app_1"


# --- the comparison ---------------------------------------------------------

def test_agreement_and_disagreement_are_both_reported():
    observed = ObservedRun(available=True, reads=[ORDERS], writes=[CUSTOMERS])
    result = compare([ORDERS, "Finance/Bronze/only_predicted"], [CUSTOMERS], observed)
    assert result.agreed_reads == [ORDERS]
    assert result.agreed_writes == [CUSTOMERS]
    assert result.predicted_only_reads == ["Finance/Bronze/only_predicted"]
    assert not result.agrees


def test_a_table_only_the_real_run_touched_is_the_interesting_half():
    """Usually a cell the static reader deliberately abstained on — a query built
    from an f-string, or a write inside a loop."""
    observed = ObservedRun(available=True, reads=[], writes=[CUSTOMERS, ORDERS])
    result = compare([], [CUSTOMERS], observed)
    assert result.observed_only_writes == [ORDERS]


def test_full_agreement_says_so():
    observed = ObservedRun(available=True, reads=[ORDERS], writes=[CUSTOMERS])
    assert compare([ORDERS], [CUSTOMERS], observed).agrees


# --- through the router -----------------------------------------------------

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.get_settings(), "sandbox_require_auth", False, raising=False)
    return TestClient(main.app)


def test_the_sandbox_run_attaches_nothing_unless_asked(client, monkeypatch):
    """Two extra Fabric round trips is not something to spend by default."""
    res = client.post("/fabric/sandbox/run", json={"name": "nb", "cells": ["x = 1"]})
    assert res.status_code == 200
    assert res.json()["observed"] is None
    assert res.json()["comparison"] is None


def test_the_run_carries_the_comparison_end_to_end(client, monkeypatch):
    """The whole point, through the real endpoint.

    The notebook writes `customers` from `orders`, and so did the last real run,
    so the two agree. A sandbox result that can say "and this is what actually
    happened" is the context this feature exists to add.
    """
    import app.sandbox.router as sandbox_router

    monkeypatch.setattr(sandbox_router, "FabricClient", lambda **k: FakeClient())
    res = client.post(
        "/fabric/sandbox/run",
        json={
            "name": "nb",
            "cells": ["spark.table('orders').write.saveAsTable('customers')"],
            "workspace_id": "ws-id",
            "item_id": "item-id",
            "workspace": WS,
            "lakehouse": LH,
            "include_observed": True,
            "schemas": {ORDERS: [{"name": "id", "type": "bigint"}]},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["observed"]["available"] is True
    assert body["observed"]["writes"] == [CUSTOMERS]
    assert body["comparison"]["agreed_writes"] == [CUSTOMERS]
    assert body["comparison"]["agreed_reads"] == [ORDERS]
    assert body["comparison"]["observed_only_writes"] == []


def test_a_broken_history_lookup_never_fails_the_sandbox_run(client, monkeypatch):
    """Enrichment must not be able to take a good run down with it."""
    import app.sandbox.router as sandbox_router

    def boom(*a, **k):
        raise RuntimeError("fabric exploded")

    monkeypatch.setattr(sandbox_router, "FabricClient", boom)
    res = client.post(
        "/fabric/sandbox/run",
        json={
            "name": "nb",
            "cells": ["spark.table('orders').write.saveAsTable('customers')"],
            "workspace_id": "ws-id",
            "item_id": "item-id",
            "include_observed": True,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["observed"]["available"] is False
    assert any("unavailable" in note for note in body["observed"]["notes"])


# --- the notebook edited since the run --------------------------------------
#
# The single most common false alarm the comparison can raise: a table is
# predicted because a line writes it, and the run predates that line.


def test_a_notebook_edited_after_the_run_says_so():
    result = observe(FakeClient(item={"lastUpdatedDate": "2026-08-01T18:00:00Z"}))
    assert result.code_changed_at == "2026-08-01T18:00:00Z"
    assert any("edited after that run" in note for note in result.notes)


def test_a_notebook_older_than_the_run_makes_no_such_claim():
    result = observe(FakeClient(item={"lastUpdatedDate": "2026-07-01T09:00:00Z"}))
    assert result.code_changed_at == "2026-07-01T09:00:00Z"
    assert not any("edited after" in note for note in result.notes)


def test_a_tenant_that_names_no_edit_time_claims_nothing():
    """Absent must mean unknown, never unchanged — the panel only speaks when
    there is a timestamp to speak from."""
    result = observe(FakeClient(item={}))
    assert result.code_changed_at == ""
    assert not any("edited after" in note for note in result.notes)


def test_an_item_lookup_that_refuses_does_not_fail_the_run():
    """Enrichment on enrichment. A tenant that will not serve the item payload
    still gets its observed run."""
    result = observe(FakeClient(raise_on=("/items/",)))
    assert result.available is True
    assert result.code_changed_at == ""
