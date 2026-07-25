"""The read-only /fabric/* explorer endpoints.

No network and no credentials: a fake client stands in for FabricClient so the
router's shaping — item type split, folder parent mapping, the tables `data`
vs `value` key, and the configured-vs-refused error split — is exercised
directly. The handoff's "empty means no permission" trap is why a refused call
must surface as an error, not an empty 200; that boundary is asserted here.
"""

from __future__ import annotations

import base64
import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.fabric import router as fabric_router
from app.fabric.client import FabricError, parse_onelake_tables


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


def _onelake_paths(*names):
    return [{"name": n, "isDirectory": "true"} for n in names]


def test_onelake_parser_handles_schema_enabled_layout():
    lh = "lh1"
    paths = _onelake_paths(
        f"{lh}/Tables/dbo/orders/_delta_log",
        f"{lh}/Tables/dbo/orders/_delta_log/00000.json",  # file inside — ignored
        f"{lh}/Tables/dbo/orders/part-0001.parquet",  # data file — ignored
        f"{lh}/Tables/sales/customers/_delta_log",
    )
    assert parse_onelake_tables(paths) == [
        {"name": "dbo.orders", "type": "Managed", "format": "delta"},
        {"name": "sales.customers", "type": "Managed", "format": "delta"},
    ]


def test_notebook_source_returns_decoded_cells(client, monkeypatch):
    """The detail panel's notebook code path: definition → decoded cells."""

    class NotebookClient:
        def get_notebook_definition(self, ws, item):
            ipynb = json.dumps(
                {"cells": [{"cell_type": "code", "source": ["df = spark.table('raw_orders')"]}]}
            ).encode()
            payload = base64.b64encode(ipynb).decode()
            return {"parts": [{"path": "notebook-content.ipynb", "payload": payload}]}

    _use(monkeypatch, NotebookClient())
    body = client.get("/fabric/workspaces/ws1/notebooks/n1/source?name=load").json()
    assert body["name"] == "load"
    assert any("raw_orders" in c for c in body["cells"])


def test_notebook_source_refusal_is_an_error(client, monkeypatch):
    class NotebookClient:
        def get_notebook_definition(self, ws, item):
            raise FabricError("definition refused")

    _use(monkeypatch, NotebookClient())
    assert client.get("/fabric/workspaces/ws1/notebooks/n1/source").status_code == 502


def test_table_schema_reads_columns_from_delta_log(client, monkeypatch):
    """The detail panel's table columns path: OneLake Delta log → columns."""
    schema_string = json.dumps(
        {"type": "struct", "fields": [
            {"name": "id", "type": "long"},
            {"name": "amount", "type": "double"},
        ]}
    )
    commit = json.dumps({"metaData": {"schemaString": schema_string}})

    class SchemaClient:
        def onelake_list(self, ws, path, recursive=False):
            if path.endswith("/Tables"):
                return [{"name": "lh1/Tables/orders/_delta_log"}]
            return [{"name": "lh1/Tables/orders/_delta_log/00000000000000000000.json"}]

        def onelake_read_text(self, ws, path):
            return commit

    _use(monkeypatch, SchemaClient())
    body = client.get("/fabric/workspaces/ws1/lakehouses/lh1/tables/orders/schema").json()
    assert body == [{"name": "id", "type": "bigint"}, {"name": "amount", "type": "double"}]


def test_table_schema_resolves_schema_qualified_name(client, monkeypatch):
    """Schema-enabled lakehouses show 'dbo.raw_orders' but the dir index keys
    on the last segment 'raw_orders' — the endpoint must match either."""
    schema_string = json.dumps(
        {"type": "struct", "fields": [{"name": "id", "type": "long"}]}
    )
    commit = json.dumps({"metaData": {"schemaString": schema_string}})

    class SchemaClient:
        def onelake_list(self, ws, path, recursive=False):
            if path.endswith("/Tables"):
                return [{"name": "lh1/Tables/dbo/raw_orders/_delta_log"}]
            return [{"name": "lh1/Tables/dbo/raw_orders/_delta_log/00000000000000000000.json"}]

        def onelake_read_text(self, ws, path):
            return commit

    _use(monkeypatch, SchemaClient())
    resp = client.get("/fabric/workspaces/ws1/lakehouses/lh1/tables/dbo.raw_orders/schema")
    assert resp.status_code == 200
    assert resp.json() == [{"name": "id", "type": "bigint"}]


def test_table_schema_unknown_table_is_404(client, monkeypatch):
    class SchemaClient:
        def onelake_list(self, ws, path, recursive=False):
            return [{"name": "lh1/Tables/orders/_delta_log"}]

    _use(monkeypatch, SchemaClient())
    resp = client.get("/fabric/workspaces/ws1/lakehouses/lh1/tables/missing/schema")
    assert resp.status_code == 404


def test_onelake_parser_handles_classic_layout():
    paths = _onelake_paths("lh1/Tables/raw_orders/_delta_log")
    assert parse_onelake_tables(paths) == [
        {"name": "raw_orders", "type": "Managed", "format": "delta"},
    ]


def test_schema_enabled_400_falls_back_to_onelake(client, monkeypatch):
    """The reported UnsupportedOperationForSchemasEnabledLakehouse 400."""
    real_error = FabricError(
        "GET .../tables failed [400]: "
        '{"errorCode":"UnsupportedOperationForSchemasEnabledLakehouse"}'
    )

    class SchemaLakehouseClient:
        def list_lakehouse_tables(self, ws, lh):
            # Exercise the real fallback branch on the real client method.
            from app.fabric.client import FabricClient

            return FabricClient.list_lakehouse_tables(self, ws, lh)

        def request(self, *a, **k):
            raise real_error

        def list_lakehouse_tables_onelake(self, ws, lh):
            return [{"name": "dbo.orders", "type": "Managed", "format": "delta"}]

    _use(monkeypatch, SchemaLakehouseClient())
    body = client.get("/fabric/workspaces/ws1/lakehouses/lh1/tables").json()
    assert body == [{"name": "dbo.orders", "type": "Managed", "format": "delta"}]
