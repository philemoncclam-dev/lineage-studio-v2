"""Where shared models live.

A share is an IMMUTABLE SNAPSHOT of a model, not a window onto the live one.
The owner publishes what they are looking at now; later edits stay private until
they publish again. That is the safer default in both directions — a recipient
sees exactly what the sender saw and can cite it, and the sender cannot
accidentally broadcast tomorrow's half-finished edit to a link they sent last
month.

**The link is the credential.** Anyone holding it can read the model, which is
what "anyone with the link" means and is the thing to understand before sharing
a map of a warehouse. Tokens are 256 bits from `secrets`, so they cannot be
guessed or enumerated; they must therefore never be written to a log, which is
why nothing here logs one and the API returns them only to their creator.

Two backends, chosen by `DATABASE_URL`:

- **Postgres** when it is set. This is the one to use anywhere real.
- **SQLite** otherwise, for local development and tests.

The distinction matters more than it looks on the current deployment: Render's
free plan has an EPHEMERAL filesystem, so a SQLite file there is erased by every
redeploy and every wake from sleep. Share links would work, then silently 404
after a deploy — the worst failure available to this feature, because the person
who followed the link cannot tell it from "revoked". `configured_backend()`
reports which one is live so the API can say so out loud.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import Any, Protocol

#: 32 bytes -> 43 URL-safe characters. Guessing one is not a threat model.
TOKEN_BYTES = 32

#: A model is a JSON document held in a browser; this bounds what a caller can
#: park on our disk. Generous for a real model, small enough that the endpoint
#: is not free storage.
MAX_MODEL_BYTES = 2 * 1024 * 1024

DEFAULT_TTL_DAYS = 90
MAX_TTL_DAYS = 365


@dataclass
class Share:
    token: str
    name: str
    model: dict[str, Any]
    created_at: int
    expires_at: int | None

    @property
    def expired(self) -> bool:
        return self.expires_at is not None and self.expires_at < int(time.time())


class ShareStore(Protocol):
    def put(self, name: str, model: dict[str, Any], ttl_days: int | None) -> Share: ...
    def get(self, token: str) -> Share | None: ...
    def delete(self, token: str) -> bool: ...


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def _expiry(ttl_days: int | None) -> int | None:
    """`None` means never. Anything else is clamped rather than refused.

    A share that outlives the reason it was created is the quiet risk here, so
    the default is finite and the maximum is a year.
    """
    if ttl_days is None:
        return None
    days = max(1, min(int(ttl_days), MAX_TTL_DAYS))
    return int(time.time()) + days * 86400


class SqliteShareStore:
    """Local development and tests. See the module note about ephemeral disks."""

    def __init__(self, path: str = "shares.db") -> None:
        self._path = path
        # check_same_thread=False because uvicorn serves requests on a thread
        # pool; every call below is short and serialised by SQLite's own lock.
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS shares (
                   token TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   model TEXT NOT NULL,
                   created_at INTEGER NOT NULL,
                   expires_at INTEGER
               )"""
        )
        self._db.commit()

    def put(self, name: str, model: dict[str, Any], ttl_days: int | None) -> Share:
        share = Share(
            token=new_token(),
            name=name,
            model=model,
            created_at=int(time.time()),
            expires_at=_expiry(ttl_days),
        )
        self._db.execute(
            "INSERT INTO shares (token, name, model, created_at, expires_at) VALUES (?,?,?,?,?)",
            (share.token, share.name, json.dumps(share.model), share.created_at, share.expires_at),
        )
        self._db.commit()
        return share

    def get(self, token: str) -> Share | None:
        row = self._db.execute(
            "SELECT token, name, model, created_at, expires_at FROM shares WHERE token = ?",
            (token,),
        ).fetchone()
        if row is None:
            return None
        return Share(row[0], row[1], json.loads(row[2]), row[3], row[4])

    def delete(self, token: str) -> bool:
        cur = self._db.execute("DELETE FROM shares WHERE token = ?", (token,))
        self._db.commit()
        return cur.rowcount > 0


class PostgresShareStore:
    """Anywhere real. `DATABASE_URL` points at it — Supabase, Render, anything.

    psycopg is imported lazily so a deployment without Postgres does not need
    the dependency installed, and so the import error names the reason rather
    than failing at app startup for everyone.
    """

    def __init__(self, dsn: str) -> None:
        try:
            import psycopg
        except ImportError as exc:  # pragma: no cover - depends on the install
            raise RuntimeError(
                "DATABASE_URL is set but psycopg is not installed — "
                "add `psycopg[binary]` to requirements.txt"
            ) from exc
        self._psycopg = psycopg
        self._dsn = dsn
        with self._connect() as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS shares (
                       token TEXT PRIMARY KEY,
                       name TEXT NOT NULL,
                       model JSONB NOT NULL,
                       created_at BIGINT NOT NULL,
                       expires_at BIGINT
                   )"""
            )

    def _connect(self):
        # A connection per request rather than a pool: this endpoint is called
        # once when someone publishes and once when someone opens a link, which
        # does not justify pool lifecycle code that has to survive Render's
        # free-tier sleeps.
        return self._psycopg.connect(self._dsn, autocommit=True)

    def put(self, name: str, model: dict[str, Any], ttl_days: int | None) -> Share:
        share = Share(new_token(), name, model, int(time.time()), _expiry(ttl_days))
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO shares (token, name, model, created_at, expires_at) VALUES (%s,%s,%s,%s,%s)",
                (share.token, share.name, json.dumps(share.model), share.created_at, share.expires_at),
            )
        return share

    def get(self, token: str) -> Share | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT token, name, model, created_at, expires_at FROM shares WHERE token = %s",
                (token,),
            ).fetchone()
        if row is None:
            return None
        model = row[2] if isinstance(row[2], dict) else json.loads(row[2])
        return Share(row[0], row[1], model, row[3], row[4])

    def delete(self, token: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM shares WHERE token = %s", (token,))
            return cur.rowcount > 0


_store: ShareStore | None = None


def configured_backend() -> str:
    """`postgres` or `sqlite` — surfaced so the UI can warn about the second."""
    return "postgres" if os.environ.get("DATABASE_URL") else "sqlite"


def get_store() -> ShareStore:
    """The process-wide store, built on first use.

    Lazy because tests point `SHARE_DB_PATH` at a temp file, and because a
    Postgres DSN that is wrong should fail when someone shares rather than
    taking down every other route at import time.
    """
    global _store
    if _store is None:
        dsn = os.environ.get("DATABASE_URL")
        _store = (
            PostgresShareStore(dsn)
            if dsn
            else SqliteShareStore(os.environ.get("SHARE_DB_PATH", "shares.db"))
        )
    return _store


def reset_store() -> None:
    """Drop the cached store. Tests only."""
    global _store
    _store = None
