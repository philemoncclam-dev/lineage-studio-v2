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

#: OneLake is an ADLS-Gen2 data plane and takes a *storage* token, not a Fabric
#: one — a different scope entirely.
ONELAKE_SCOPE = "https://storage.azure.com/.default"
ONELAKE_BASE = "https://onelake.dfs.fabric.microsoft.com"

_BASE = "https://api.fabric.microsoft.com/v1"
_TIMEOUT = 120


def parse_onelake_tables(paths: list[dict]) -> list[dict]:
    """Turn a OneLake filesystem listing of `.../Tables` into table rows.

    A Delta table is any directory containing a `_delta_log` folder, so the
    presence of a `.../Tables/<...>/_delta_log` directory entry marks its parent
    as a table. This works for both layouts:
      - classic:         Tables/<table>/_delta_log        -> "table"
      - schema-enabled:  Tables/<schema>/<table>/_delta_log -> "schema.table"
    The schema is kept in the name so the two never collide.
    """
    marker = "/Tables/"
    suffix = "/_delta_log"
    tables: dict[str, dict] = {}
    for p in paths:
        name = p.get("name") or ""
        idx = name.find(marker)
        if idx < 0 or not name.endswith(suffix):
            continue
        rel = name[idx + len(marker) : -len(suffix)]
        segs = [s for s in rel.split("/") if s]
        if not segs:
            continue
        display = ".".join(segs) if len(segs) > 1 else segs[0]
        tables[display] = {"name": display, "type": "Managed", "format": "delta"}
    return sorted(tables.values(), key=lambda t: t["name"])
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

        The Fabric REST endpoint answers under a `data` key rather than the
        `value` key the rest of the surface uses; both are accepted because the
        shape has drifted before (handoff: the swagger has been wrong).

        Schema-enabled lakehouses are refused by that endpoint entirely
        (`UnsupportedOperationForSchemasEnabledLakehouse`), so on that specific
        400 the tables are enumerated from the OneLake filesystem instead, which
        handles both classic and schema-enabled layouts.
        """
        try:
            payload = self.request(
                "GET", f"/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/tables"
            )
            return payload.get("data") or payload.get("value") or []
        except FabricError as exc:
            if "schemasenabled" in str(exc).lower() or "schemas enabled" in str(exc).lower():
                return self.list_lakehouse_tables_onelake(workspace_id, lakehouse_id)
            raise

    def _onelake_headers(self) -> dict[str, str]:
        token = self._credential.get_token(ONELAKE_SCOPE).token
        return {"Authorization": f"Bearer {token}"}

    def onelake_list(
        self, workspace_id: str, directory: str, recursive: bool = False
    ) -> list[dict]:
        """List a OneLake directory (ADLS-Gen2 filesystem listing).

        GUIDs are valid path segments, so the ids we already hold are used
        verbatim — no display-name lookup needed.
        """
        resp = self._session.get(
            f"{ONELAKE_BASE}/{workspace_id}",
            headers=self._onelake_headers(),
            params={
                "resource": "filesystem",
                "recursive": "true" if recursive else "false",
                "directory": directory,
            },
            timeout=_TIMEOUT,
        )
        if not resp.ok:
            raise FabricError(
                f"OneLake list failed [{resp.status_code}]: {resp.text[:300]}"
            )
        return (resp.json() or {}).get("paths") or []

    def onelake_read_text(self, workspace_id: str, path: str) -> str:
        """Read a single OneLake file as text (e.g. a Delta `_delta_log` commit)."""
        resp = self._session.get(
            f"{ONELAKE_BASE}/{workspace_id}/{path}",
            headers=self._onelake_headers(),
            timeout=_TIMEOUT,
        )
        if not resp.ok:
            raise FabricError(
                f"OneLake read failed [{resp.status_code}]: {resp.text[:200]}"
            )
        return resp.text

    def list_lakehouse_tables_onelake(
        self, workspace_id: str, lakehouse_id: str
    ) -> list[dict]:
        """Enumerate a lakehouse's Delta tables via the OneLake filesystem.

        The fallback for schema-enabled lakehouses (and a layout-agnostic path in
        general): a recursive listing of `.../Tables`, parsed for `_delta_log`
        markers.
        """
        paths = self.onelake_list(workspace_id, f"{lakehouse_id}/Tables", recursive=True)
        return parse_onelake_tables(paths)

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

    def get_item_definition(self, workspace_id: str, item_id: str) -> dict:
        """The definition (base64 `parts`) of any item — pipelines, etc.

        Same `getDefinition` call as `get_notebook_definition`, without the
        notebook-flavoured error wrapping, for callers that read other item
        types (the pipeline explorer).
        """
        payload = self.request(
            "POST",
            f"/workspaces/{workspace_id}/items/{item_id}/getDefinition",
        )
        return payload.get("definition") or payload
