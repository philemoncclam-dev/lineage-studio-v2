"""HTTP tests for the lineage-push and data-product endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.fabric.client import FabricError
from app.models import LineageGraph, Node, NodeKind, NotebookSource
from app.purview import actions
from app.purview.client import PurviewError
from app.purview.writer import WriteResult


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def _graph() -> LineageGraph:
    return LineageGraph(
        nodes=[Node(id="g-nb", kind=NodeKind.NOTEBOOK, name="nb", meta={})]
    )


def test_push_reports_which_notebooks_were_read(client, monkeypatch):
    monkeypatch.setattr(actions, "build_graph_from_purview", _graph)
    monkeypatch.setattr(
        actions,
        "_fabric_notebook_sources",
        lambda g: {"nb": NotebookSource(name="nb", cells=[])},
    )
    monkeypatch.setattr(
        actions,
        "push_notebook_lineage",
        lambda *a, **k: WriteResult(dry_run=True),
    )
    body = client.post("/purview/lineage/push", json={"apply": False}).json()
    assert body["notebooks_read"] == ["nb"]
    assert body["dry_run"] is True


def test_push_without_fabric_access_is_503_not_an_empty_success(client, monkeypatch):
    """No readable notebooks means no lineage — reporting ok would be a lie.

    An empty Fabric workspace list is how a permissions failure presents, so a
    silent empty success here would look identical to a catalog with nothing
    in it.
    """
    monkeypatch.setattr(actions, "build_graph_from_purview", _graph)
    monkeypatch.setattr(actions, "_fabric_notebook_sources", lambda g: {})
    resp = client.post("/purview/lineage/push", json={"apply": False})
    assert resp.status_code == 503
    assert "workspace access" in resp.json()["detail"]


def test_push_surfaces_fabric_failures_as_503(client, monkeypatch):
    monkeypatch.setattr(actions, "build_graph_from_purview", _graph)

    def boom(_):
        raise FabricError("fabric is down")

    monkeypatch.setattr(actions, "_fabric_notebook_sources", boom)
    assert client.post("/purview/lineage/push", json={"apply": False}).status_code == 503


def test_domains_are_flattened_for_the_ui(client, monkeypatch):
    class D:
        id, name, status = "d1", "HR", "Published"

    monkeypatch.setattr(actions, "PurviewClient", lambda: object())
    monkeypatch.setattr(actions, "list_governance_domains", lambda c: [D()])
    assert client.get("/purview/domains").json() == [
        {"id": "d1", "name": "HR", "status": "Published"}
    ]


def test_unauthorised_catalog_read_is_503(client, monkeypatch):
    """The service principal being locked out of Unified Catalog is a normal
    deployment state, not a server error."""

    def boom():
        raise PurviewError("403 Not authorized to access account")

    monkeypatch.setattr(actions, "PurviewClient", boom)
    assert client.get("/purview/dataproducts").status_code == 503
