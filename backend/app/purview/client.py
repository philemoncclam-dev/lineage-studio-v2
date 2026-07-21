"""Authenticated HTTP client for the Purview data map.

Adapted from the search/pagination approach in MarcoOesterlin's
Microsoft-Purview-Unified-Catalog (MIT). Differences from the original:

  * tokens come from `azure-identity` (v2 scope, cached and auto-refreshed)
    rather than hand-rolled calls to the legacy v1 `oauth2/token` endpoint,
    so the manual token-renewal loops in the upstream scripts are unnecessary;
  * one `requests.Session` is reused across calls;
  * failures raise `PurviewError` instead of printing and returning None.
"""

from __future__ import annotations

from typing import Any, Iterator

import requests
from azure.identity import ClientSecretCredential

from ..config import PURVIEW_SCOPE, Settings, get_settings

# The data map caps a single search page at 1000; this is a compromise between
# round-trips and per-response size.
_PAGE_SIZE = 500
_TIMEOUT = 60


class PurviewError(RuntimeError):
    """A Purview call failed, or the integration is not configured."""


class PurviewClient:
    """Thin wrapper over the data-map REST surface."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        if not self.settings.purview_configured:
            raise PurviewError(
                "Purview is not configured — set PURVIEW_ACCOUNT_NAME, "
                "PURVIEW_TENANT_ID, PURVIEW_CLIENT_ID and PURVIEW_CLIENT_SECRET "
                "in .env (see .env.example)."
            )
        self._credential = ClientSecretCredential(
            tenant_id=self.settings.purview_tenant_id,
            client_id=self.settings.purview_client_id,
            client_secret=self.settings.purview_client_secret,
        )
        self._session = requests.Session()
        #: Cached by `principal_object_id`; "" records a failed lookup.
        self._principal_object_id: str | None = None

    @property
    def _base(self) -> str:
        return f"{self.settings.purview_endpoint}/datamap/api"

    def _headers(self) -> dict[str, str]:
        # ClientSecretCredential caches and refreshes internally, so asking for
        # a token per request is cheap and always yields a live one.
        token = self._credential.get_token(PURVIEW_SCOPE).token
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def request(self, method: str, path: str, **kwargs: Any) -> dict:
        url = f"{self._base}{path}"
        resp = self._session.request(
            method, url, headers=self._headers(), timeout=_TIMEOUT, **kwargs
        )
        if not resp.ok:
            raise PurviewError(
                f"{method} {path} failed [{resp.status_code}]: {resp.text[:500]}"
            )
        return resp.json() if resp.content else {}

    # --- reads ---------------------------------------------------------

    def search(self, keywords: str | None = None, filter: dict | None = None) -> Iterator[dict]:
        """Yield every matching entity, following continuation tokens.

        Callers get a flat stream and never see paging; the data map signals
        the end by omitting `continuationToken`.
        """
        continuation: str | None = None
        while True:
            body: dict[str, Any] = {"keywords": keywords, "limit": _PAGE_SIZE}
            if filter:
                body["filter"] = filter
            if continuation:
                body["continuationToken"] = continuation

            payload = self.request(
                "POST", "/search/query?api-version=2023-09-01", json=body
            )
            yield from payload.get("value", [])

            continuation = payload.get("continuationToken")
            if not continuation:
                return

    def principal_object_id(self) -> str | None:
        """Our own service principal's Entra object id, or None.

        Needed because a data product must name an owner contact, and the only
        identity this process can always speak for is itself. The object id is
        not the client id — they are different GUIDs for the same app — so it
        has to be looked up rather than read from config.

        Directory reads are a separate grant from the Purview ones, so this
        returns None rather than raising: a caller can then ask the user for an
        owner instead of failing outright.
        """
        if self._principal_object_id is not None:
            return self._principal_object_id or None
        try:
            token = self._credential.get_token(
                "https://graph.microsoft.com/.default"
            ).token
            resp = self._session.get(
                "https://graph.microsoft.com/v1.0/servicePrincipals",
                params={
                    "$filter": f"appId eq '{self.settings.purview_client_id}'",
                    "$select": "id",
                },
                headers={"Authorization": f"Bearer {token}"},
                timeout=_TIMEOUT,
            )
            values = resp.json().get("value", []) if resp.ok else []
            self._principal_object_id = values[0]["id"] if values else ""
        except Exception:  # noqa: BLE001 — an optional lookup must never break a write
            self._principal_object_id = ""
        return self._principal_object_id or None

    def get_entity(self, guid: str) -> dict:
        """Full entity including its `columns` relationship attribute."""
        return self.request("GET", f"/atlas/v2/entity/guid/{guid}")

    def get_lineage(self, guid: str, depth: int = 3, direction: str = "BOTH") -> dict:
        """Lineage as the *scan-populated index* knows it.

        Kept for scan-derived lineage only. It does not see lineage pushed
        through the API — see `get_next_lineage`.
        """
        return self.request(
            "GET",
            f"/atlas/v2/lineage/{guid}",
            params={"depth": depth, "direction": direction},
        )

    def get_next_lineage(self, guid: str, direction: str) -> dict:
        """Lineage from the `/next` endpoint, which serves API-pushed edges.

        The classic `/lineage/{guid}` above reads an index that only a scan
        populates, so edges we push ourselves never appear there no matter how
        long we wait, even while the relationships are ACTIVE on the entity.
        `/next` returns them immediately, at the cost of three quirks found by
        trial against the live catalog:

          * `direction` must be INPUT or OUTPUT; BOTH is a 400.
          * `getDerivedLineage=true` 404s for tables and is required for
            notebooks, so we query tables only and omit it.
          * an entity with no lineage at all 404s rather than returning an
            empty set, which is why callers must tolerate `PurviewError`.
        """
        return self.request(
            "GET", f"/atlas/v2/lineage/{guid}/next", params={"direction": direction}
        )
