"""The read-only /fabric/* explorer endpoints.

No network and no credentials: a fake client stands in for FabricClient so the
router's shaping — item type split, folder parent mapping, the tables `data`
vs `value` key, and the configured-vs-refused error split — is exercised
directly. The handoff's "empty means no permission" trap is why a refused call
must surface as an error, not an empty 200; that boundary is asserted here.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.fabric import router as fabric_router
from app.fabric.client import FabricError


class FakeClient:
    """Stands in for FabricClient; each attribute is the raw REST payload."""

    def __init__(
        self,
        workspaces=None,
        items=None,
        folders=None,
        tables=None,
        raise_on=None,
    ):
        self._workspaces = workspaces or []
        self._items = items or []
        self._folders = folders or []
        self._tables = tables or []
        self._raise_on = raise_on or set()

    def _guard(self, name):
        if name in self._raise_on:
            raise FabricError(f"{name} refused")

    def list_workspaces(self):
        self._guard("list_workspaces")
        return self._workspaces

    def list_items(self, workspace_id):
        self._guard("list_items")
        return self._items

    def list_folders(self, workspace_id):
        self._guard("list_folders")
        return self._folders

    def list_lakehouse_tables(self, workspace_id, lakehouse_id):
        self._guard("list_lakehouse_tables")
        return self._tables


@pytest.fixture
def client():
    return TestClient(main.app)


def _use(monkeypatch, fake):
    monkeypatch.setattr(fabric_router, "FabricClient", lambda *a, **k: fake)


def test_workspaces_are_named_from_display_name(client, monkeypatch):
    _use(monkeypatch, FakeClient(workspaces=[{"id": "ws1", "displayName": "Sales"}]))
    body = client.get("/fabric/workspaces").json()
    assert body == [{"id": "ws1", "name": "Sales"}]


def test_workspaces_without_an_id_are_dropped(client, monkeypatch):
    _use(monkeypatch, FakeClient(workspaces=[{"displayName": "orphan"}, {"id": "ws2", "displayName": "Ok"}]))
    body = client.get("/fabric/workspaces").json()
    assert body == [{"id": "ws2", "name": "Ok"}]


def test_items_are_split_by_type_and_carry_folder(client, monkeypatch):
    fake = FakeClient(
        items=[
            {"id": "n1", "displayName": "load", "type": "Notebook", "folderId": "f1"},
            {"id": "l1", "displayName": "LH", "type": "Lakehouse"},
            {"id": "r1", "displayName": "rep", "type": "Report"},
        ],
        folders=[{"id": "f1", "displayName": "ETL", "parentFolderId": None}],
    )
    _use(monkeypatch, fake)
    body = client.get("/fabric/workspaces/ws1/items").json()
    assert body["notebooks"] == [{"id": "n1", "name": "load", "type": "Notebook", "folder_id": "f1"}]
    assert body["lakehouses"][0]["id"] == "l1"
    assert body["others"][0]["type"] == "Report"
    assert body["folders"] == [{"id": "f1", "name": "ETL", "parent_id": None}]


def test_lakehouse_tables_accept_the_data_key(client, monkeypatch):
    fake = FakeClient(tables=[{"name": "orders", "type": "Managed", "format": "delta"}])
    _use(monkeypatch, fake)
    body = client.get("/fabric/workspaces/ws1/lakehouses/lh1/tables").json()
    assert body == [{"name": "orders", "type": "Managed", "format": "delta"}]


def test_a_refused_call_is_an_error_not_an_empty_list(client, monkeypatch):
    """Empty-means-no-permission trap: a refusal must not look like success."""
    _use(monkeypatch, FakeClient(raise_on={"list_workspaces"}))
    resp = client.get("/fabric/workspaces")
    assert resp.status_code == 502


def test_unconfigured_integration_is_a_503(client, monkeypatch):
    def boom(*a, **k):
        raise FabricError("Fabric is not configured")

    monkeypatch.setattr(fabric_router, "FabricClient", boom)
    resp = client.get("/fabric/workspaces")
    assert resp.status_code == 503
