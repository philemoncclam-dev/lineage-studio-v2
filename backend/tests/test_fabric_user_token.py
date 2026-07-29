"""Reading Fabric as the signed-in user rather than the service principal.

The point of the whole sign-in path is that Fabric evaluates the CALLER's
permissions, so these check the token actually reaches it. A header quietly
dropped somewhere in the chain is the dangerous failure: every user would be
looking at a shared robot account's workspaces while believing they were
looking at their own, and nothing on screen would say otherwise.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.fabric.client import FabricClient, FabricError
from app.fabric.router import user_token


@pytest.mark.parametrize(
    "header,expected",
    [
        ("Bearer abc123", "abc123"),
        ("bearer abc123", "abc123"),  # the scheme is case-insensitive (RFC 6750)
        ("Bearer   abc123  ", "abc123"),
        (None, None),
        ("", None),
        ("Basic abc123", None),  # not a bearer token — ignore rather than guess
        ("Bearer", None),
        ("Bearer   ", None),
    ],
)
def test_only_a_real_bearer_token_is_read(header, expected):
    assert user_token(header) == expected


def _unconfigured() -> Settings:
    """Settings with no Purview credentials, so no service principal is possible."""
    return Settings(
        purview_account_name=None,
        purview_tenant_id=None,
        purview_client_id=None,
        purview_client_secret=None,
    )


def test_a_user_token_needs_no_service_principal_and_is_sent_verbatim():
    """The whole point: a caller who brought their own identity needs no robot.

    This is also what makes sign-in useful on a deployment that has no Purview
    credentials at all — the user's token is the only thing required.
    """
    client = FabricClient(settings=_unconfigured(), user_token="user-tok")
    assert client._headers()["Authorization"] == "Bearer user-tok"


def test_without_a_token_the_service_principal_is_still_required():
    """The fallback is a real credential, never an unauthenticated call."""
    with pytest.raises(FabricError, match="Fabric is not configured"):
        FabricClient(settings=_unconfigured())
