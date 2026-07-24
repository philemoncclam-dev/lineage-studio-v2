"""Authenticated HTTP client for the Fabric REST API.

Same `ClientSecretCredential` pattern as `purview.client`, but a different data
plane and so a different scope: a Purview token is not accepted by Fabric.

Reusing the Purview service principal is deliberate — one app registration for
both planes — but it is not automatically sufficient. A Fabric token issues
happily for any SP in the tenant; workspace access is a *separate* grant, so an
SP that reads the catalog fine can still be refused every item in it. That
failure surfaces as a 401 on the item call, not at token acquisition, which is
why `get_notebook_definition` raises a `FabricError` naming the workspace
rather than letting a bare HTTP error escape.
"""

from __future__ import annotations

import time
from typing import Any

import requests
from azure.identity import ClientSecretCredential

from ..config import Settings, get_settings

#: Azure AD v2 scope for the Fabric data plane.
FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"

_BASE = "https://api.fabric.microsoft.com/v1"
_TIMEOUT = 120
#: `getDefinition` is asynchronous; these bound the poll for its result.
_POLL_INTERVAL = 2
_OPERATION_TIMEOUT = 60


class FabricError(RuntimeError):
    """A Fabric call failed, or the integration is not configured."""


class FabricClient:
    """Thin wrapper over the slice of the Fabric REST surface we need."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        # Credentials are shared with Purview: there is no separate Fabric
        # config, and requiring one would be a second copy of the same secret.
        if not self.settings.purview_configured:
            raise FabricError(
                "Fabric is not configured — it reuses the Purview service "
                "principal, so set PURVIEW_TENANT_ID, PURVIEW_CLIENT_ID and "
                "PURVIEW_CLIENT_SECRET in .env (see .env.example)."
            )
        self._credential = ClientSecretCredential(
            tenant_id=self.settings.purview_tenant_id,
            client_id=self.settings.purview_client_id,
            client_secret=self.settings.purview_client_secret,
        )
        self._session = requests.Session()

    def _headers(self) -> dict[str, str]:
        token = self._credential.get_token(FABRIC_SCOPE).token
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def request(self, method: str, path: str, **kwargs: Any) -> dict:
        resp = self._session.request(
            method, f"{_BASE}{path}", headers=self._headers(), timeout=_TIMEOUT, **kwargs
        )
        if not resp.ok:
            raise FabricError(
                f"{method} {path} failed [{resp.status_code}]: {resp.text[:500]}"
            )
        if resp.status_code == 202:
            return self._await_operation(resp)
        return resp.json() if resp.content else {}

    def _await_operation(self, resp: requests.Response) -> dict:
        """Follow a 202 long-running operation through to its result.

        `getDefinition` answers 202 with a `Location` to poll and a body of
        `null`; the payload only appears at `{Location}/result` once the
        operation reports Succeeded. Treating the 202 as the answer yields
        `None` and looks exactly like an empty notebook, so this is followed
        rather than returned.

        The redirect host differs from `_BASE` (it is region-specific), so the
        polling URL is used verbatim.
        """
        location = resp.headers.get("Location")
        if not location:
            raise FabricError("202 accepted but no Location header to poll")

        deadline = time.monotonic() + _OPERATION_TIMEOUT
        while time.monotonic() < deadline:
            time.sleep(_POLL_INTERVAL)
            state = self._session.get(
                location, headers=self._headers(), timeout=_TIMEOUT
            )
            if not state.ok:
                raise FabricError(f"polling failed [{state.status_code}]")
            status = (state.json() or {}).get("status")
            if status == "Failed":
                raise FabricError(f"operation failed: {state.text[:300]}")
            if status == "Succeeded":
                result = self._session.get(
                    f"{location.rstrip('/')}/result",
                    headers=self._headers(),
                    timeout=_TIMEOUT,
                )
                if not result.ok:
                    raise FabricError(f"result fetch failed [{result.status_code}]")
                return result.json() if result.content else {}

        raise FabricError(f"operation did not finish within {_OPERATION_TIMEOUT}s")

    def list_workspaces(self) -> list[dict]:
        """All workspaces the service principal can see.

        Note the standing trap: an SP with no workspace access gets `200
        {"value": []}`, not a 403 — an empty list is ambiguous between "no
        workspaces" and "no permission", and callers must not read it as
        "correctly configured, nothing there".
        """
        return self.request("GET", "/workspaces").get("value", [])

    def list_items(self, workspace_id: str) -> list[dict]:
        """Every item in a workspace (notebooks, lakehouses, …).

        Each item carries a `type` ("Notebook", "Lakehouse", …) and, when it
        lives inside a folder, a `folderId` — the two fields the explorer tree
        groups on.
        """
        return self.request("GET", f"/workspaces/{workspace_id}/items").get("value", [])

    def list_folders(self, workspace_id: str) -> list[dict]:
        """The workspace's folder tree, or `[]` if unavailable.

        The folders API is newer than the items API and 404s on tenants that
        predate it; a missing folder tree just flattens the explorer, it is not
        an error, so the refusal is swallowed rather than raised.
        """
        try:
            return self.request("GET", f"/workspaces/{workspace_id}/folders").get("value", [])
        except FabricError:
            return []

    def list_lakehouse_tables(self, workspace_id: str, lakehouse_id: str) -> list[dict]:
        """Tables in a lakehouse.

        This endpoint answers under a `data` key rather than the `value` key
        the rest of the Fabric surface uses; both are accepted here because the
        shape has drifted before (handoff: the swagger has been wrong).
        """
        payload = self.request(
            "GET", f"/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/tables"
        )
        return payload.get("data") or payload.get("value") or []

    def get_notebook_definition(self, workspace_id: str, item_id: str) -> dict:
        """The notebook's definition: a list of base64-encoded parts.

        `getDefinition` is a POST even though it reads, and answers 202 with a
        `Location` to poll rather than returning inline — `request` follows that
        for us.
        """
        try:
            payload = self.request(
                "POST",
                f"/workspaces/{workspace_id}/items/{item_id}/getDefinition",
            )
        except FabricError as exc:
            raise FabricError(
                f"could not read notebook {item_id} in workspace {workspace_id} "
                f"— the service principal may lack access to that workspace: {exc}"
            ) from exc
        return payload.get("definition") or payload
