"""Who the assistant answers as, and who is allowed to ask.

Two failures live here, and they are different in kind.

The first is a WRONG ANSWER. The assistant's Fabric tools used to read as the
shared service principal no matter who was asking, so it could describe
workspaces the user cannot open in their own Explore tree — in a product whose
claim is "the workspaces you have access to". An assistant contradicting the
screen beside it is worse than one that says it cannot see something.

The second is a BILL. `/chat/ask` is the only route that spends money, and a
public URL with no check on it is a billing account anyone who learns the
address can draw on.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.chat import fabric_tools
from app.chat.fabric_tools import ANONYMOUS, Caller
from app.config import Settings, get_settings
from app.main import app


@pytest.fixture(autouse=True)
def clear_catalog():
    fabric_tools.reset_catalog_cache()
    yield
    fabric_tools.reset_catalog_cache()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def settings(monkeypatch):
    """Override settings for the app, leaving the process env alone."""

    def use(**kw):
        overridden = Settings(_env_file=None, **kw)
        monkeypatch.setattr("app.chat.router.get_settings", lambda: overridden)
        return overridden

    get_settings.cache_clear()
    yield use
    get_settings.cache_clear()


def _ask(client, token: str | None = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(
        "/chat/ask",
        json={"model": {"name": "m", "layers": []}, "messages": [{"role": "user", "content": "hi"}]},
        headers=headers,
    )


# --- who may ask ---------------------------------------------------------


def test_an_anonymous_caller_cannot_spend_the_api_key(client, settings):
    settings(chat_require_auth=True, anthropic_api_key="sk-test")
    resp = _ask(client)
    assert resp.status_code == 401
    assert "sign in" in resp.text.lower()


def test_a_local_backend_can_still_allow_anonymous_questions(client, settings, monkeypatch):
    """The escape hatch is opt-in and explicit — a laptop, not a deployment."""
    settings(chat_require_auth=False)
    seen = {}

    def fake_ask(model, messages, **kwargs):
        seen.update(kwargs)
        raise RuntimeError("reached the assistant")

    monkeypatch.setattr("app.chat.router.ask", fake_ask)
    with pytest.raises(RuntimeError, match="reached the assistant"):
        _ask(client)
    assert seen["caller"] == ANONYMOUS


def test_the_status_route_says_whether_a_sign_in_is_needed(client):
    """So the UI can say so up front instead of collecting a 401 for the user."""
    assert "requires_auth" in client.get("/chat/status").json()


# --- whose Fabric it reads ------------------------------------------------


def test_the_callers_own_tokens_reach_the_assistant(client, settings, monkeypatch):
    settings(chat_require_auth=True)
    seen = {}

    def fake_ask(model, messages, **kwargs):
        seen.update(kwargs)
        raise RuntimeError("stop")

    monkeypatch.setattr("app.chat.router.ask", fake_ask)
    with pytest.raises(RuntimeError):
        client.post(
            "/chat/ask",
            json={
                "model": {"name": "m", "layers": []},
                "messages": [{"role": "user", "content": "hi"}],
            },
            headers={
                "Authorization": "Bearer fab-tok",
                "X-OneLake-Authorization": "Bearer lake-tok",
            },
        )
    # Two tokens, not one: OneLake is a different audience and rejects the
    # Fabric token. A caller with only the first can browse and cannot read a
    # schema, which is a real state the tools report as unreadable.
    assert seen["caller"] == Caller(fabric="fab-tok", onelake="lake-tok")


def test_the_catalog_walk_asks_fabric_as_the_caller(monkeypatch):
    asked = {}

    class FakeClient:
        def __init__(self, user_token=None, onelake_token=None):
            asked["user_token"] = user_token
            asked["onelake_token"] = onelake_token

        def list_workspaces(self):
            return []

    monkeypatch.setattr(fabric_tools, "FabricClient", FakeClient)
    fabric_tools.catalog(Caller(fabric="fab-tok", onelake="lake-tok"))
    assert asked == {"user_token": "fab-tok", "onelake_token": "lake-tok"}


def test_two_users_do_not_share_one_cached_catalog(monkeypatch):
    """The cache is keyed by caller, or the second asker sees the first's tenant.

    This is the whole scoping fix undone by an optimisation: one process-wide
    cache would hand whoever asked second the workspaces whoever asked first
    could see, and it would look like a correct, fast answer.
    """
    tenants = {
        "ada-tok": [{"id": "ws-ada", "displayName": "Ada's"}],
        "bob-tok": [{"id": "ws-bob", "displayName": "Bob's"}],
    }

    class FakeClient:
        def __init__(self, user_token=None, onelake_token=None):
            self.token = user_token

        def list_workspaces(self):
            return tenants[self.token]

        def list_items(self, _wid):
            return []

    monkeypatch.setattr(fabric_tools, "FabricClient", FakeClient)
    ada = fabric_tools.catalog(Caller(fabric="ada-tok"))
    bob = fabric_tools.catalog(Caller(fabric="bob-tok"))
    assert [e["name"] for e in ada] == ["Ada's"]
    assert [e["name"] for e in bob] == ["Bob's"]
    # And each still caches for itself.
    assert fabric_tools.catalog(Caller(fabric="ada-tok"))[0]["name"] == "Ada's"


def test_a_cache_key_never_carries_the_token_itself():
    """Keys end up in reprs and logs; tokens must not ride along."""
    key = Caller(fabric="super-secret-token").cache_key
    assert "super-secret-token" not in key
    assert ANONYMOUS.cache_key == "anonymous"
