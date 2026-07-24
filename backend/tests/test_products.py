"""Data Products section: store round-trip, request workflow, gated grant.

The store writes to real files, so each test points it at a tmp dir — otherwise
the seed would land in the developer's `backend/data/` and tests would share
state. Purview/Fabric are never contacted here: the grant path is exercised
through its gate, which returns a preview without any network call.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.products import store


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_PRODUCTS_FILE", tmp_path / "products.json")
    monkeypatch.setattr(store, "_REQUESTS_FILE", tmp_path / "requests.json")
    yield


@pytest.fixture
def client():
    return TestClient(app)


def test_seed_product_is_served(client):
    products = client.get("/products").json()
    assert any(p["name"] == "Customer Analytics" for p in products)


def test_domains_expose_parent_for_subdomains(client):
    domains = client.get("/products/domains").json()
    by_id = {d["id"]: d for d in domains}
    # Seed tree has Orders nested under Sales (only asserted when Purview is not
    # backing the response — a live account has its own domain ids).
    if "dom_sales_orders" in by_id:
        assert by_id["dom_sales_orders"]["parent_id"] == "dom_sales"


def test_create_and_fetch_product(client):
    body = {
        "name": "Pipeline Health",
        "domain_id": "dom_sales_pipeline",
        "description": "Opportunity aging.",
        "use_cases": ["Forecast accuracy"],
        "owners": [{"name": "Sam", "email": "sam@example.com"}],
    }
    created = client.post("/products", json=body)
    assert created.status_code == 201
    pid = created.json()["id"]
    got = client.get(f"/products/{pid}").json()
    assert got["name"] == "Pipeline Health"
    assert got["use_cases"] == ["Forecast accuracy"]


def test_create_rejects_unknown_domain(client):
    r = client.post("/products", json={"name": "X", "domain_id": "nope"})
    assert r.status_code == 422


def test_request_then_approve_records_gated_grant(client):
    pid = client.get("/products").json()[0]["id"]
    req = client.post(
        f"/products/{pid}/requests",
        json={"requester_name": "Bo", "requester_email": "bo@example.com",
              "justification": "analysis"},
    ).json()
    assert req["status"] == "pending"

    decided = client.post(
        f"/products/requests/{req['id']}/decide",
        json={"approve": True, "decided_by": "owner", "apply": True},
    ).json()
    assert decided["status"] == "approved"
    # Writes default off, so the grant is a preview, not applied.
    assert decided["grant"]["applied"] is False
    assert decided["grant"]["role"] == "Viewer"


def test_deny_leaves_no_grant(client):
    pid = client.get("/products").json()[0]["id"]
    req = client.post(
        f"/products/{pid}/requests",
        json={"requester_name": "Bo", "requester_email": "bo@example.com"},
    ).json()
    decided = client.post(
        f"/products/requests/{req['id']}/decide", json={"approve": False}
    ).json()
    assert decided["status"] == "denied"
    assert decided["grant"] is None


def test_decide_twice_conflicts(client):
    pid = client.get("/products").json()[0]["id"]
    req = client.post(
        f"/products/{pid}/requests",
        json={"requester_name": "Bo", "requester_email": "bo@example.com"},
    ).json()
    client.post(f"/products/requests/{req['id']}/decide", json={"approve": True})
    again = client.post(f"/products/requests/{req['id']}/decide", json={"approve": True})
    assert again.status_code == 409


def test_inbox_lists_requests(client):
    pid = client.get("/products").json()[0]["id"]
    client.post(
        f"/products/{pid}/requests",
        json={"requester_name": "Bo", "requester_email": "bo@example.com"},
    )
    inbox = client.get("/products/requests/all").json()
    assert len(inbox) == 1
    pending = client.get("/products/requests/all?status=pending").json()
    assert len(pending) == 1
