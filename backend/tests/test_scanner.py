"""The Power BI metadata scanner: parsing, and the three-leg async scan.

The payload shapes here are taken from the documented `scanResult` sample, not
invented — the live shapes in this codebase have historically been where the
surprises are, and a fixture that agrees only with itself proves nothing.

No network, no admin account, no tenant: everything is either pure parsing or
runs against a stub transport.
"""

from __future__ import annotations

import pytest

from app.fabric.scanner import (
    BiDatasource,
    ScannerClient,
    ScannerError,
    lakehouse_for_datasource,
    parse_scan_result,
)

SCAN = {
    "workspaces": [
        {
            "id": "ws-1",
            "name": "Finance",
            "state": "Active",
            "reports": [
                {"id": "rep-1", "name": "Exec Summary", "datasetId": "ds-1"},
                # A paginated report bound straight to a source, no model.
                {"id": "rep-2", "name": "Ledger", "datasetId": ""},
            ],
            "dashboards": [
                {
                    "id": "dash-1",
                    "displayName": "Board",
                    "tiles": [
                        {"id": "t1", "reportId": "rep-1", "datasetId": "ds-1"},
                        {"id": "t2", "reportId": "rep-1", "datasetId": "ds-1"},
                    ],
                }
            ],
            "datasets": [
                {
                    "id": "ds-1",
                    "name": "Finance Model",
                    "datasourceUsages": [{"datasourceInstanceId": "src-1"}],
                    "upstreamDataflows": [{"targetDataflowId": "flow-1"}],
                }
            ],
        }
    ],
    "datasourceInstances": [
        {
            "datasourceType": "Sql",
            "connectionDetails": {
                "server": "abc.datawarehouse.fabric.microsoft.com",
                "database": "Silver",
            },
            "datasourceId": "src-1",
        }
    ],
}


# --- parsing -----------------------------------------------------------------

def test_reads_models_reports_and_dashboards():
    result = parse_scan_result(SCAN)
    assert [d.name for d in result.datasets] == ["Finance Model"]
    assert [r.name for r in result.reports] == ["Exec Summary", "Ledger"]
    assert [b.name for b in result.dashboards] == ["Board"]
    assert not result.empty


def test_a_report_names_its_semantic_model():
    """The one BI edge that is a stated fact rather than an inference."""
    result = parse_scan_result(SCAN)
    by_id = {r.id: r for r in result.reports}
    assert by_id["rep-1"].dataset_id == "ds-1"
    # A paginated report without a model must not invent one.
    assert by_id["rep-2"].dataset_id == ""


def test_a_dashboard_lists_each_report_once():
    """Two tiles from one report is one dependency, not two."""
    result = parse_scan_result(SCAN)
    assert result.dashboards[0].report_ids == ["rep-1"]


def test_datasource_instances_are_indexed_by_id():
    result = parse_scan_result(SCAN)
    assert result.datasources["src-1"].kind == "Sql"
    assert result.datasources["src-1"].details["database"] == "Silver"


def test_a_workspace_that_could_not_be_scanned_says_so():
    """An empty workspace and an unreadable one must not look the same."""
    result = parse_scan_result(
        {"workspaces": [{"id": "ws-9", "name": "Locked", "state": "Deleted"}]}
    )
    assert result.empty
    assert any("was not scanned" in n for n in result.notes)


def test_an_empty_or_junk_payload_does_not_raise():
    for payload in ({}, {"workspaces": []}, {"workspaces": [{}]}):
        assert parse_scan_result(payload).empty


def test_entries_without_an_id_are_dropped():
    result = parse_scan_result(
        {"workspaces": [{"id": "w", "state": "Active", "reports": [{"name": "no id"}]}]}
    )
    assert result.reports == []


# --- resolving a datasource to a lakehouse -----------------------------------

def test_a_connection_naming_a_known_lakehouse_resolves():
    source = BiDatasource(id="s", kind="Sql", details={"database": "Silver"})
    assert lakehouse_for_datasource(source, {"silver": "lh-2"}) == "lh-2"


def test_a_lakehouse_named_in_a_path_segment_resolves():
    source = BiDatasource(
        id="s", kind="Lakehouse", details={"path": "https://onelake/ws/Bronze/Tables"}
    )
    assert lakehouse_for_datasource(source, {"bronze": "lh-1"}) == "lh-1"


def test_a_real_sql_server_resolves_to_nothing():
    """The fabricated-edge case: a model reading an actual SQL Server is
    upstream of nothing this crawl knows, and must not be linked to a
    same-named lakehouse."""
    source = BiDatasource(
        id="s", kind="Sql", details={"server": "sqlserver.database.windows.net", "database": "Sales"}
    )
    assert lakehouse_for_datasource(source, {"bronze": "lh-1"}) == ""


# --- the async scan ----------------------------------------------------------

class Transport:
    """Scripted (status, body) replies, in call order."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def __call__(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.replies.pop(0)


def client(transport, **kw):
    return ScannerClient(transport, poll_interval=0, sleep=lambda _s: None, **kw)


def test_a_scan_polls_until_it_succeeds_then_reads_the_result():
    transport = Transport(
        (202, {"id": "scan-1", "status": "NotStarted"}),
        (200, {"status": "Running"}),
        (200, {"status": "Succeeded"}),
        (200, SCAN),
    )
    result = client(transport).scan(["ws-1"])
    assert [r.name for r in result.reports] == ["Exec Summary", "Ledger"]
    # getInfo must ask for lineage, or the dependency fields come back empty.
    assert transport.calls[0][2]["params"]["lineage"] == "true"
    assert transport.calls[0][2]["json"] == {"workspaces": ["ws-1"]}


def test_a_refusal_explains_that_workspace_access_is_not_enough():
    """The failure everyone hits first, and the one where the obvious remedy —
    grant the app the workspace — never works."""
    with pytest.raises(ScannerError, match="administrator"):
        client(Transport((403, {}))).scan(["ws-1"])


def test_a_failed_scan_raises_rather_than_returning_nothing():
    transport = Transport((202, {"id": "s"}), (200, {"status": "Failed"}))
    with pytest.raises(ScannerError, match="failed"):
        client(transport).scan(["ws-1"])


def test_a_scan_that_never_finishes_gives_up():
    transport = Transport((202, {"id": "s"}), *[(200, {"status": "Running"})] * 10)
    with pytest.raises(ScannerError, match="in time"):
        client(transport, timeout=0).scan(["ws-1"])


def test_no_workspaces_is_not_a_call():
    transport = Transport()
    result = ScannerClient(transport).scan([])
    assert result.empty
    assert transport.calls == []


def test_the_documented_hundred_workspace_ceiling_is_respected():
    transport = Transport(
        (202, {"id": "s"}), (200, {"status": "Succeeded"}), (200, {"workspaces": []})
    )
    client(transport).scan([f"ws-{i}" for i in range(150)])
    assert len(transport.calls[0][2]["json"]["workspaces"]) == 100
