"""Publishing a model to a link anyone can open.

The shape of this feature is one decision: the LINK IS THE CREDENTIAL. Read is
public because sending a map to somebody who does not use the app is the entire
point; everything else follows from making that safe — unguessable tokens, one
indistinguishable 404, a finite default life, and a snapshot rather than a
window onto the live model.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.share import store as share_store

MODEL = {"id": "m1", "name": "Estate", "layers": [{"id": "L", "name": "Bronze", "objects": []}]}
SIGNED_IN = {"Authorization": "Bearer a-token"}


@pytest.fixture(autouse=True)
def temp_store(tmp_path, monkeypatch):
    monkeypatch.setenv("SHARE_DB_PATH", str(tmp_path / "shares.db"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    share_store.reset_store()
    yield
    share_store.reset_store()


@pytest.fixture
def client():
    return TestClient(app)


def _share(client, **body):
    payload = {"model": MODEL, "name": "Estate", **body}
    return client.post("/shares", json=payload, headers=SIGNED_IN)


def test_a_link_holder_needs_no_account(client):
    """The whole feature. A recipient who has never signed in can read it."""
    token = _share(client).json()["token"]
    resp = client.get(f"/shares/{token}")  # no Authorization header at all
    assert resp.status_code == 200
    assert resp.json()["model"] == MODEL


def test_publishing_requires_being_signed_in(client):
    """Not because the model is secret — the caller sent it — but because an
    open POST storing 2MB a time is free hosting for whoever finds the URL."""
    assert client.post("/shares", json={"model": MODEL}).status_code == 401


def test_the_snapshot_does_not_follow_later_edits(client):
    """A share is what the sender was looking at, not a window on their model.

    The failure this prevents is silent and bad in both directions: a recipient
    citing something that has since changed, and a sender broadcasting
    tomorrow's half-finished edit to a link they sent last month.
    """
    token = _share(client).json()["token"]
    _share(client, model={**MODEL, "name": "Edited later"})
    assert client.get(f"/shares/{token}").json()["model"]["name"] == "Estate"


def test_tokens_are_unguessable_and_unique(client):
    tokens = {_share(client).json()["token"] for _ in range(5)}
    assert len(tokens) == 5
    # 32 bytes of `secrets` -> 43 URL-safe chars. Enumeration is not a threat
    # model at this length; a short id would make every share public.
    assert all(len(t) >= 40 for t in tokens)


def test_revoking_kills_the_link(client):
    token = _share(client).json()["token"]
    assert client.delete(f"/shares/{token}", headers=SIGNED_IN).json() == {"revoked": True}
    assert client.get(f"/shares/{token}").status_code == 404


def test_missing_expired_and_revoked_are_indistinguishable(client):
    """Telling them apart confirms a token once existed — a fact about someone
    else's link, disclosed to whoever is guessing at it."""
    revoked = _share(client).json()["token"]
    client.delete(f"/shares/{revoked}", headers=SIGNED_IN)

    never = client.get("/shares/nonexistent-token-that-was-never-issued")
    gone = client.get(f"/shares/{revoked}")
    assert never.status_code == gone.status_code == 404
    assert never.json()["detail"] == gone.json()["detail"]


def test_an_expired_share_stops_reading(client, monkeypatch):
    token = _share(client, ttl_days=1).json()["token"]
    # A day and a second later. `now` is captured BEFORE patching — a lambda
    # that calls `time.time()` calls the patched one and recurses forever.
    now = share_store.time.time()
    monkeypatch.setattr(share_store.time, "time", lambda: now + 86401)
    assert client.get(f"/shares/{token}").status_code == 404


def test_a_share_expires_by_default(client):
    """Left forever, a link outlives the reason it was created."""
    assert _share(client).json()["expires_at"] is not None


def test_never_expiring_is_possible_but_deliberate(client):
    assert _share(client, ttl_days=None).json()["expires_at"] is None


def test_an_oversized_model_is_refused_with_the_alternative(client):
    """413 rather than a slow accept — and it names the escape hatch, because
    the honest answer for a huge model is the file export that already works."""
    huge = {"blob": "x" * (share_store.MAX_MODEL_BYTES + 1)}
    resp = client.post("/shares", json={"model": huge}, headers=SIGNED_IN)
    assert resp.status_code == 413
    assert "export" in resp.json()["detail"].lower()


def test_unknown_fields_survive_the_round_trip(client):
    """The snapshot is handed back byte-for-byte.

    Parsing it into `LineageModel` here would silently drop whatever a newer
    frontend added, and the recipient would open a model quietly missing parts
    of itself.
    """
    exotic = {**MODEL, "somethingTheBackendHasNeverHeardOf": {"deep": [1, 2, 3]}}
    token = client.post("/shares", json={"model": exotic}, headers=SIGNED_IN).json()["token"]
    assert client.get(f"/shares/{token}").json()["model"] == exotic


def test_status_admits_when_links_will_not_survive_a_deploy(client):
    """SQLite on a host with an ephemeral disk loses every share at the next
    deploy, and a dead link is indistinguishable from a revoked one. The UI can
    only warn if the API says so."""
    body = client.get("/shares/status").json()
    assert body["storage"] == "sqlite"
    assert body["durable"] is False


def test_status_reports_a_broken_database_url_rather_than_claiming_durable(
    client, monkeypatch
):
    """"durable" must mean "will still work next week", not "a DSN is set".

    A typo in an environment variable otherwise reports healthy until the first
    publish 500s — after the user has believed the feature works, and possibly
    after they have sent links.
    """
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/nope")
    share_store.reset_store()

    body = client.get("/shares/status").json()
    assert body["storage"] == "postgres"
    assert body["durable"] is False
    # The two fixes are completely different, so the message has to distinguish
    # "unreachable" from "unset".
    assert "not reachable" in body["error"]
