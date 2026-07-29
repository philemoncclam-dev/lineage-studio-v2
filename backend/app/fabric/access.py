"""What the SIGNED-IN CALLER may see, when the work itself runs as somebody else.

Most Fabric reads carry the user's own token, so Fabric enforces access for us
and there is nothing to decide here (see `FabricClient.__init__`). The sandbox
is the exception: it executes as the shared service principal — it has to, the
run has no user in the loop and the SP is what holds the credential — but the
caller still names the workspace and notebook it should fetch. Left ungated,
that is a read of any notebook in any workspace the SP can reach, requested by
someone with no access to it at all: the run is legitimate, the target is not.

So the two questions are separated. **Who may ask** is answered here, against
the caller's own token. **What runs** stays with the service principal.

Answered by asking Fabric, never by reading claims out of the token. This
backend does not validate tokens and could not: it holds no key, and a local
decision would be a second, weaker authority disagreeing with the real one. A
token Fabric refuses lists no workspaces, which denies exactly as it should.
"""

from __future__ import annotations

from fastapi import HTTPException

from .client import FabricClient, FabricError


def visible_workspace_ids(token: str | None) -> set[str] | None:
    """Workspace ids (lowercased) this caller can see — or `None` for nobody.

    `None` means UNAUTHENTICATED, not "sees nothing": no token was sent, so
    there is no user whose access could be checked, and the caller gets the
    service principal's reach exactly as it did before sign-in existed. That is
    the development path (a curl, or the gate's "continue without signing in",
    which is DEV-only and absent from a deployed build). An empty set is the
    opposite: a real user who can see no workspace, and every check fails.
    """
    if not token:
        return None
    try:
        raw = FabricClient(user_token=token).list_workspaces()
    except FabricError as exc:
        # Fabric refused the caller's own token. Denying is the only safe
        # reading — falling through to the service principal here would hand a
        # rejected caller more than a valid one gets.
        raise HTTPException(
            status_code=403, detail=f"could not read your workspaces: {exc}"
        ) from exc
    return {w["id"].lower() for w in raw if w.get("id")}


def assert_visible(visible: set[str] | None, workspace_id: str) -> None:
    """404 unless this caller can see that workspace.

    404, not 403: a 403 confirms the workspace exists, which is itself a fact
    about a tenant the caller was just told they cannot read. An id they have
    no access to should look the same as one that was never real.
    """
    if visible is None:
        return
    if workspace_id.lower() not in visible:
        raise HTTPException(status_code=404, detail="no such workspace")


def limit_to_visible(visible: set[str] | None, workspace_ids: list[str]) -> list[str]:
    """Drop the ids this caller cannot see, keeping order and duplicates out.

    For the workspaces a notebook REACHES INTO rather than the one it lives in:
    an `abfss://` path names other workspaces by GUID, and resolving those names
    or reading their table schemas is the same disclosure by a longer route.
    Filtered rather than refused — a notebook that crosses into a workspace you
    cannot see should still run, with that corner left unresolved.
    """
    seen: set[str] = set()
    out: list[str] = []
    for wid in workspace_ids:
        low = (wid or "").lower()
        if not low or low in seen:
            continue
        if visible is not None and low not in visible:
            continue
        seen.add(low)
        out.append(wid)
    return out
