"""`/shares` — publish a model to a link anyone can open.

Read is PUBLIC and unauthenticated: that is what "anyone with the link" means,
and adding a sign-in to the read side would defeat the only reason this exists
(sending a map to somebody who does not use the app). The token is the
credential.

Write is gated on being signed in. Not because the model is secret to us — the
caller sent it — but because an open POST that stores 2MB per call is free
hosting for anyone who finds the URL.

**The gate is a bearer token being PRESENT, not verified.** This backend does
not validate Entra tokens today (see `fabric/router.user_token`); it forwards
them to Fabric, which is sound while every answer comes from Fabric's own
permission check. Storing models makes this service an authorization boundary
for the first time, and the honest statement of where that stands is: revoking
and publishing are protected by possession of the link and a plausible header,
not by proof of identity. Signature validation is the next piece of work, and
until it lands nothing here should hold anything a leaked link would ruin.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..fabric.router import user_token
from .store import (
    DEFAULT_TTL_DAYS,
    MAX_MODEL_BYTES,
    configured_backend,
    get_store,
)

router = APIRouter(prefix="/shares", tags=["shares"])


class CreateShare(BaseModel):
    #: The model document, exactly as the browser holds it. Not parsed into
    #: `LineageModel` here: a share is a snapshot to hand back byte-for-byte,
    #: and validating it would silently drop fields a newer frontend added.
    model: dict[str, Any]
    name: str = Field(default="Shared model", max_length=200)
    #: Null means never expires. Clamped to a year in the store.
    ttl_days: int | None = DEFAULT_TTL_DAYS


class ShareCreated(BaseModel):
    token: str
    expires_at: int | None
    #: `sqlite` on a host with an ephemeral disk means these links die at the
    #: next deploy. The UI says so rather than letting somebody send twenty of
    #: them the day before a release.
    storage: str


class SharedModel(BaseModel):
    name: str
    model: dict[str, Any]
    created_at: int
    expires_at: int | None


def _require_signed_in(token: str | None) -> None:
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Sign in to share a model.",
        )


@router.get("/status")
def status() -> dict[str, str | bool]:
    """Whether sharing will outlive a deploy, so the UI can warn before it bites.

    `durable` is the answer to "will these links still work next week", and it
    requires BOTH a Postgres DSN and that Postgres actually answering. A DSN
    with a typo in it otherwise reports durable until the first publish 500s —
    by which time the user believes the feature works.
    """
    backend = configured_backend()
    if backend != "postgres":
        # SQLite is fine locally and a trap on a host with no persistent disk,
        # and only the operator knows which they have.
        return {"storage": backend, "durable": False}
    try:
        store = get_store()
        check = getattr(store, "check", None)
        if check:
            check()
        return {"storage": backend, "durable": True}
    except Exception as exc:  # noqa: BLE001 - any failure means "not durable"
        return {
            "storage": backend,
            "durable": False,
            # Named, because "DATABASE_URL is set but unreachable" and "not set"
            # need completely different fixes.
            "error": f"DATABASE_URL is set but not reachable: {exc}"[:300],
        }


@router.post("", response_model=ShareCreated)
def create_share(
    body: CreateShare,
    token: Annotated[str | None, Depends(user_token)] = None,
) -> ShareCreated:
    _require_signed_in(token)

    # Measured on the serialised form, which is what actually lands on disk.
    size = len(json.dumps(body.model))
    if size > MAX_MODEL_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"That model is {size // 1024}KB and the limit is "
                f"{MAX_MODEL_BYTES // 1024}KB. Export it to a file instead."
            ),
        )

    share = get_store().put(body.name, body.model, body.ttl_days)
    return ShareCreated(
        token=share.token,
        expires_at=share.expires_at,
        storage=configured_backend(),
    )


@router.get("/{token}", response_model=SharedModel)
def read_share(token: str) -> SharedModel:
    """Open a shared model. No authentication — the link is the credential."""
    share = get_store().get(token)
    # An expired share is deleted on read rather than swept: there is no
    # scheduler here, and the read is the only moment anyone cares.
    if share and share.expired:
        get_store().delete(token)
        share = None
    if share is None:
        # One message for missing, expired and revoked. Telling them apart
        # would confirm a token once existed, which is a fact about someone
        # else's link.
        raise HTTPException(status_code=404, detail="That link is not valid.")
    return SharedModel(
        name=share.name,
        model=share.model,
        created_at=share.created_at,
        expires_at=share.expires_at,
    )


@router.delete("/{token}")
def revoke_share(
    token: str,
    auth: Annotated[str | None, Depends(user_token)] = None,
    x_share_token: Annotated[str | None, Header()] = None,
) -> dict[str, bool]:
    """Revoke a link. Immediate and irreversible.

    Holding the link is what proves this is yours to revoke, since nothing here
    records an owner — there is no verified identity to record one FROM. The
    trade is deliberate and narrow: the worst a link-holder can do is destroy a
    share they could already read.
    """
    _require_signed_in(auth)
    del x_share_token  # accepted for symmetry with future owner checks
    return {"revoked": get_store().delete(token)}
