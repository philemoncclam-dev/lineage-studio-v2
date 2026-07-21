"""The write gate. These tests are the guarantee that nothing writes by accident."""

from __future__ import annotations

import pytest

from app import config
from app.purview.client import PurviewError
from app.purview.writer import WriteSession


class RecordingClient:
    def __init__(self, fail_on: str | None = None) -> None:
        self.sent: list[tuple[str, str]] = []
        self.fail_on = fail_on

    def request(self, verb: str, path: str, **kwargs):
        if self.fail_on and self.fail_on in path:
            raise PurviewError("boom")
        self.sent.append((verb, path))
        return {"ok": True}


@pytest.fixture
def allow_write(monkeypatch):
    """Turn the deployment gate on without touching the real .env."""

    def _set(enabled: bool):
        settings = config.get_settings().model_copy(
            update={"purview_allow_write": enabled}
        )
        monkeypatch.setattr(config, "get_settings", lambda: settings)
        monkeypatch.setattr("app.purview.writer.get_settings", lambda: settings)

    return _set


def test_dry_run_is_the_default(allow_write):
    allow_write(True)
    client = RecordingClient()
    session = WriteSession(client)  # apply not passed
    session.add("POST", "/x", {"a": 1}, describes="create x")

    result = session.run()
    assert result.dry_run is True
    assert client.sent == []
    assert result.to_dict()["operations"][0]["describes"] == "create x"


def test_apply_without_the_setting_downgrades_to_dry_run(allow_write):
    allow_write(False)
    client = RecordingClient()
    session = WriteSession(client, apply=True)
    session.add("POST", "/x")

    assert session.run().dry_run is True
    assert client.sent == []


def test_apply_with_the_setting_transmits(allow_write):
    allow_write(True)
    client = RecordingClient()
    session = WriteSession(client, apply=True)
    session.add("POST", "/x", {"a": 1})

    result = session.run()
    assert result.dry_run is False and result.ok
    assert client.sent == [("POST", "/x")]


def test_one_failure_does_not_abort_the_rest(allow_write):
    allow_write(True)
    client = RecordingClient(fail_on="/bad")
    session = WriteSession(client, apply=True)
    session.add("POST", "/good-1", describes="row 1")
    session.add("POST", "/bad", describes="row 2")
    session.add("POST", "/good-2", describes="row 3")

    result = session.run()
    assert [p for _, p in client.sent] == ["/good-1", "/good-2"]
    assert not result.ok
    assert result.errors == ["row 2: boom"]


def test_a_dry_run_never_needs_credentials(allow_write):
    """No client passed and none constructed — the preview path is offline."""
    allow_write(False)
    session = WriteSession(apply=True)
    session.add("POST", "/x")
    assert session.run().dry_run is True
