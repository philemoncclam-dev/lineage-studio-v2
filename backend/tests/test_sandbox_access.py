"""The sandbox runs as the service principal — against only what YOU can see.

The run needs the SP: once the child starts there is no user in the loop, and
the SP is what holds a credential. But the workspace and notebook are named by
the request, so the authorisation question is separate from the execution one.
Ungated, `/fabric/sandbox/run` reads any notebook the SP can reach for anyone
who can reach the endpoint — which is the whole tenant, from a public bundle.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.fabric import access
from app.main import app

MINE = "11111111-1111-1111-1111-111111111111"
NOT_MINE = "99999999-9999-9999-9999-999999999999"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def only_mine(monkeypatch):
    """A signed-in caller who can see exactly one workspace."""

    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs.get("user_token") == "user-tok", "must ask as the CALLER"

        def list_workspaces(self):
            return [{"id": MINE, "displayName": "Mine"}]

    monkeypatch.setattr(access, "FabricClient", FakeClient)


def _run(client, workspace_id: str, token: str | None = "user-tok"):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(
        "/fabric/sandbox/run",
        json={"name": "nb", "workspace_id": workspace_id, "item_id": "item-1"},
        headers=headers,
    )


def test_a_workspace_you_cannot_see_is_not_fetched(client, only_mine, monkeypatch):
    """And nothing is fetched — the refusal lands before the SP is touched."""
    from app.sandbox import router as sandbox_router

    def explode(*_args, **_kwargs):  # pragma: no cover - must never run
        raise AssertionError("fetched a notebook for an unauthorised caller")

    monkeypatch.setattr(sandbox_router, "fetch_notebook_source", explode)
    assert _run(client, NOT_MINE).status_code == 404


def test_the_refusal_does_not_confirm_the_workspace_exists(client, only_mine):
    """404, not 403.

    A 403 says "this is real, you just can't have it" — a fact about a tenant
    the caller was told in the same breath they cannot read. An id they have no
    access to must look like one that was never there.
    """
    resp = _run(client, NOT_MINE)
    assert resp.status_code == 404
    assert NOT_MINE not in resp.text


def test_your_own_workspace_gets_past_the_gate(client, only_mine, monkeypatch):
    """The gate must not be a wall: the SP fetch still happens for your own."""
    from app.sandbox import router as sandbox_router

    reached = {}

    def fake_fetch(_client, workspace_id, item_id, name):
        reached["workspace_id"] = workspace_id
        raise sandbox_router.FabricError("stop here — the gate is what is under test")

    monkeypatch.setattr(sandbox_router, "fetch_notebook_source", fake_fetch)
    resp = _run(client, MINE)
    assert reached["workspace_id"] == MINE
    assert resp.status_code == 502  # got through the gate, failed at the fetch


def test_an_unsigned_caller_still_runs_as_before(client, monkeypatch):
    """No token means no user whose access could be checked, not "denied".

    This is the development path — a curl, or the DEV-only "continue without
    signing in" — and it keeps the service principal's reach it always had. On
    a deployed build the gate offers no way to get here without signing in.
    """
    from app.sandbox import router as sandbox_router

    def boom(*_args, **_kwargs):
        raise AssertionError("asked Fabric about a caller who sent no token")

    monkeypatch.setattr(access, "FabricClient", boom)
    reached = {}

    def fake_fetch(_client, workspace_id, item_id, name):
        reached["workspace_id"] = workspace_id
        raise sandbox_router.FabricError("stop here")

    monkeypatch.setattr(sandbox_router, "fetch_notebook_source", fake_fetch)
    resp = _run(client, NOT_MINE, token=None)
    assert reached["workspace_id"] == NOT_MINE
    assert resp.status_code == 502


def test_reaching_into_an_invisible_workspace_is_dropped_not_refused(only_mine):
    """An `abfss://` path into a workspace you cannot see resolves to nothing.

    Filtered rather than refused: a notebook that crosses a boundary should
    still run, with that corner left unresolved. Refusing the whole run would
    make one unreadable reference indistinguishable from a broken notebook.
    """
    visible = access.visible_workspace_ids("user-tok")
    assert access.limit_to_visible(visible, [MINE, NOT_MINE]) == [MINE]


def test_a_token_fabric_rejects_sees_nothing(client, monkeypatch):
    """A refused token must not fall through to the service principal.

    That failure mode hands a rejected caller MORE than a valid one gets, and
    it is the shape the fallback naturally has if the error is swallowed.
    """
    from app.fabric.client import FabricError

    class Rejecting:
        def __init__(self, **kwargs):
            pass

        def list_workspaces(self):
            raise FabricError("401 unauthorized")

    monkeypatch.setattr(access, "FabricClient", Rejecting)
    assert _run(client, MINE).status_code == 403
