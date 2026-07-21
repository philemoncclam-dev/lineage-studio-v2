"""The single chokepoint for every mutation of the Purview catalog.

All three write paths — lineage push, data-product cataloguing, and definition
import — go through `WriteSession`. Nothing else in the codebase may call a
mutating HTTP verb against Purview, because this is the only place where the
`PURVIEW_ALLOW_WRITE` gate and the dry-run behaviour are enforced.

The dry run is not a debug aid, it is the default. A caller builds the exact
payload it would send, hands it over, and gets back a `WriteResult` describing
what would happen. Flipping the gate changes nothing about how the payload is
built — only whether it is transmitted — so a dry run is a faithful preview
rather than a separate code path that can drift from the real one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from ..config import get_settings
from .client import PurviewClient, PurviewError

Verb = Literal["POST", "PUT", "DELETE"]


@dataclass
class WriteOp:
    """One intended mutation, fully formed and inspectable before it is sent."""

    verb: Verb
    path: str
    body: Any = None
    #: Human-readable statement of intent, surfaced in the UI preview.
    describes: str = ""


@dataclass
class WriteResult:
    """Outcome of a `WriteSession`, whether or not anything was transmitted."""

    dry_run: bool
    ops: list[WriteOp] = field(default_factory=list)
    responses: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "dry_run": self.dry_run,
            "ok": self.ok,
            "operations": [
                {"verb": o.verb, "path": o.path, "describes": o.describes, "body": o.body}
                for o in self.ops
            ],
            "responses": self.responses,
            "errors": self.errors,
        }


class WriteSession:
    """Collects intended mutations, then either previews or applies them.

    `apply=True` is honoured only when `PURVIEW_ALLOW_WRITE` is also set — an
    explicit caller intent and an explicit deployment opt-in are both required.
    Asking to apply without the setting is not an error: it downgrades to a dry
    run and says so, so the UI's preview button and its confirm button can share
    one endpoint.
    """

    def __init__(self, client: PurviewClient | None = None, apply: bool = False) -> None:
        self._client = client
        self._ops: list[WriteOp] = []
        self.apply = bool(apply) and get_settings().purview_allow_write

    @property
    def client(self) -> PurviewClient:
        # Deferred so a pure dry run needs no credentials at all.
        if self._client is None:
            self._client = PurviewClient()
        return self._client

    def add(self, verb: Verb, path: str, body: Any = None, describes: str = "") -> None:
        self._ops.append(WriteOp(verb=verb, path=path, body=body, describes=describes))

    def run(self) -> WriteResult:
        """Send the queued operations, or describe them if this is a dry run.

        Operations are attempted in order and a failure does not abort the rest:
        a partial import should report precisely which rows failed rather than
        leaving the caller unable to tell what landed.
        """
        result = WriteResult(dry_run=not self.apply, ops=list(self._ops))
        if not self.apply:
            return result

        for op in self._ops:
            try:
                payload = self.client.request(op.verb, op.path, json=op.body)
                result.responses.append(payload if isinstance(payload, dict) else {})
            except PurviewError as exc:
                result.errors.append(f"{op.describes or op.path}: {exc}")
        return result
