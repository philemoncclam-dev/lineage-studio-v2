"""Granting Fabric workspace reader access when an access request is approved.

This is the one place the Data Products section touches a real, irreversible
external system, so it respects the same rules as every other mutation here:

  * **Gated.** Nothing is sent unless `PURVIEW_ALLOW_WRITE` is set. The gate
    defaults off, exactly as `purview.writer` does, so a reachable deployment
    never grants access by accident.
  * **Dry-run by default.** `apply=False` builds the identical intent and
    returns it without sending, so a preview can never drift from the real call.

Reader access on a Fabric workspace is the **Viewer** role assignment. It needs
the requester's Entra *object id*, not their email — an email cannot be assigned
a role. When the object id is missing the grant is still previewable (the intent
is real), but applying it is refused rather than guessed at.
"""

from __future__ import annotations

from ..config import get_settings
from ..fabric.client import FabricClient, FabricError
from .store import AccessRequest, GrantRecord

#: Fabric workspace role that confers read-only access.
READER_ROLE = "Viewer"


def _describe(req: AccessRequest, workspace_id: str | None) -> str:
    who = req.requester_email or req.requester_name
    where = workspace_id or "the product's workspace"
    return f"grant {READER_ROLE} on workspace {where} to {who}"


def grant_reader_access(
    req: AccessRequest, workspace_id: str | None, *, apply: bool
) -> GrantRecord:
    """Assign the requester the Viewer role on `workspace_id`.

    Returns a `GrantRecord` in every branch — the approval succeeds even when
    the grant can only be previewed, so the record is how the caller learns
    whether access actually changed hands or is still pending a real send.
    """
    settings = get_settings()
    write_enabled = settings.purview_allow_write
    describes = _describe(req, workspace_id)

    # Preview: build the intent, send nothing. True whenever writes are gated
    # off or the caller only asked to preview.
    if not apply or not write_enabled:
        return GrantRecord(
            applied=False, dry_run=True, describes=describes, role=READER_ROLE,
            error=None if write_enabled else "writes are disabled (PURVIEW_ALLOW_WRITE)",
        )

    if not workspace_id:
        return GrantRecord(
            applied=False, dry_run=False, describes=describes, role=READER_ROLE,
            error="the data product has no workspace_id to grant against",
        )
    if not req.requester_object_id:
        return GrantRecord(
            applied=False, dry_run=False, describes=describes, role=READER_ROLE,
            error=(
                "the requester's Entra object id is unknown — an email cannot be "
                "assigned a workspace role; capture requester_object_id first"
            ),
        )

    try:
        FabricClient().request(
            "POST",
            f"/workspaces/{workspace_id}/roleAssignments",
            json={
                "principal": {"id": req.requester_object_id, "type": "User"},
                "role": READER_ROLE,
            },
        )
    except FabricError as exc:
        return GrantRecord(
            applied=False, dry_run=False, describes=describes, role=READER_ROLE,
            error=str(exc),
        )
    return GrantRecord(applied=True, dry_run=False, describes=describes, role=READER_ROLE)
