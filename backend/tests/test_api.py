"""HTTP-level tests — the endpoints themselves, not just the builders.

The Purview endpoints previously had no coverage at this level at all; the
builder was verified against the live catalog but the routes were never
exercised.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import main
from app.purview.client import PurviewError

from conftest import FakePurviewClient


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_sample_graph_is_non_empty(client):
    body = client.get("/sample").json()
    assert body["nodes"] and body["edges"]


def test_purview_status_shape(client):
    body = client.get("/purview/status").json()
    assert set(body) == {"configured", "write_enabled"}
    assert all(isinstance(v, bool) for v in body.values())


def test_purview_graph_returns_the_built_graph(client, monkeypatch):
    from app.purview import ingest

    monkeypatch.setattr(
        main,
        "build_graph_from_purview",
        lambda: ingest.build_graph_from_purview(FakePurviewClient()),
    )
    body = client.get("/purview/graph").json()
    assert {n["name"] for n in body["nodes"]} == {
        "WS_Demo",
        "LH_Sales",
        "LH_Sales (SQL endpoint)",
        "raw_orders",
        "vw_customer_ltv",
    }


def test_purview_graph_becomes_the_current_graph(client, monkeypatch):
    from app.purview import ingest

    monkeypatch.setattr(
        main,
        "build_graph_from_purview",
        lambda: ingest.build_graph_from_purview(FakePurviewClient()),
    )
    assert client.get("/purview/graph").json() == client.get("/graph").json()


def test_unconfigured_purview_is_503_not_500(client, monkeypatch):
    """A machine with no Purview access is a normal state, not a server bug."""

    def boom():
        raise PurviewError("Purview is not configured")

    monkeypatch.setattr(main, "build_graph_from_purview", boom)
    resp = client.get("/purview/graph")
    assert resp.status_code == 503
    assert "not configured" in resp.json()["detail"]
