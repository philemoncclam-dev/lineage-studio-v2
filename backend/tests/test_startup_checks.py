"""Deployment invariants that used to be comments.

The point of every test here is the same: a configuration that would be a
serious incident must stop the process, and a developer's laptop must be
completely unaffected. A check that fires locally gets disabled, and a disabled
check protects nothing.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.startup_checks import assert_safe_to_start, startup_failures


def settings(**over) -> Settings:
    base = {
        "app_env": "production",
        "sandbox_require_auth": True,
        # `Settings` reads a .env at import; passing every field this cares
        # about explicitly keeps the test independent of the developer's file.
        "purview_client_secret": None,
        "anthropic_api_key": None,
        "chat_api_key": None,
    }
    base.update(over)
    return Settings(**base)


# --- development is never affected ------------------------------------------

def test_development_ignores_everything():
    """The whole design rests on this: a laptop with an unauthenticated sandbox
    and a pile of API keys is the documented dev setup, not an incident."""
    failures = startup_failures(
        settings(app_env="development", sandbox_require_auth=False, anthropic_api_key="sk-x"),
        spark_engine=True,
        env={"DATABASE_URL": "postgres://x"},
    )
    assert failures == []


# --- the sandbox auth gate ---------------------------------------------------

def test_unauthenticated_sandbox_in_production_refuses_to_start():
    failures = startup_failures(
        settings(sandbox_require_auth=False), spark_engine=False, env={}
    )
    assert len(failures) == 1
    assert "SANDBOX_REQUIRE_AUTH" in failures[0]


def test_the_gate_being_on_is_the_normal_case():
    assert startup_failures(settings(), spark_engine=True, env={}) == []


# --- secrets on the executor -------------------------------------------------

def test_a_secret_on_the_spark_deployment_refuses_to_start():
    """The Dockerfile's "GIVE THIS CONTAINER NO SECRETS", enforced."""
    failures = startup_failures(
        settings(anthropic_api_key="sk-x"), spark_engine=True, env={}
    )
    assert len(failures) == 1
    assert "ANTHROPIC_API_KEY" in failures[0]


def test_database_url_is_caught_even_though_it_is_not_a_settings_field():
    """`share/store.py` reads it from os.environ, so a getattr on Settings
    would never see it — the exact miss that makes a check worse than none."""
    failures = startup_failures(
        settings(), spark_engine=True, env={"DATABASE_URL": "postgres://x"}
    )
    assert len(failures) == 1
    assert "DATABASE_URL" in failures[0]


def test_the_same_secrets_are_fine_on_a_deployment_that_executes_nothing():
    """The stub deployment holds these legitimately — it runs no user code."""
    failures = startup_failures(
        settings(anthropic_api_key="sk-x", purview_client_secret="shh"),
        spark_engine=False,
        env={"DATABASE_URL": "postgres://x"},
    )
    assert failures == []


def test_fabric_credentials_are_not_forbidden_on_the_executor():
    """Fetching the notebook needs them, and that fetch happens in the parent
    before the child's environment is scrubbed."""
    failures = startup_failures(
        settings(purview_tenant_id="t", purview_client_id="c"), spark_engine=True, env={}
    )
    assert failures == []


def test_every_offending_secret_is_named_at_once():
    """One boot, one complete list — not a game of fix-one-find-another."""
    failures = startup_failures(
        settings(anthropic_api_key="sk-x", purview_client_secret="shh"),
        spark_engine=True,
        env={"DATABASE_URL": "postgres://x"},
    )
    assert "ANTHROPIC_API_KEY" in failures[0]
    assert "PURVIEW_CLIENT_SECRET" in failures[0]
    assert "DATABASE_URL" in failures[0]


def test_an_empty_secret_does_not_count():
    """An unset variable often arrives as "" rather than absent."""
    assert startup_failures(settings(anthropic_api_key="  "), spark_engine=True, env={}) == []


# --- the raising wrapper -----------------------------------------------------

def test_assert_raises_with_every_reason_in_the_message():
    with pytest.raises(RuntimeError) as exc:
        assert_safe_to_start(
            settings(sandbox_require_auth=False, anthropic_api_key="sk-x"),
            spark_engine=True,
            env={},
        )
    message = str(exc.value)
    assert "SANDBOX_REQUIRE_AUTH" in message
    assert "ANTHROPIC_API_KEY" in message


def test_assert_is_silent_when_the_configuration_is_sound():
    assert_safe_to_start(settings(), spark_engine=True, env={})
