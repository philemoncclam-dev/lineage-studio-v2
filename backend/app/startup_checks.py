"""Deployment invariants, asserted at boot instead of written in a comment.

Two of this app's safety properties were, until now, enforced by prose:

  * `SANDBOX_REQUIRE_AUTH` defaults on, and the docstring in `sandbox/router.py`
    explains that turning it off is for "a laptop reachable from nowhere". An
    env var away from a public endpoint that hands arbitrary Python to `exec()`.
  * The Dockerfile says, in capitals, GIVE THIS CONTAINER NO SECRETS — because
    the Spark executor runs notebook cells as the same uid, so anything in the
    environment is readable from inside a cell. Nothing enforced it. A later
    change adding `DATABASE_URL` to that deployment would silently reopen full
    secret disclosure to anyone permitted to run a notebook.

Neither is a bug today. Both are one edit from being one, and the edit that
causes it would look entirely reasonable in review — which is exactly the kind
of rule a process should hold rather than a person.

FAIL AT BOOT, NOT PER REQUEST. A refused request gets retried, routed around, or
silently swallowed by a caller; a process that will not start gets noticed
immediately and cannot serve anything unsafe in the meantime.

Development is unaffected: every check is scoped to `app_env == "production"`,
which nothing sets locally and the Dockerfile sets explicitly.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

from .config import Settings

#: Secrets that must never be present in the process that runs notebook code.
#:
#: Not "all secrets" — the Spark deployment legitimately holds Fabric
#: credentials, because fetching the notebook needs them and that fetch happens
#: in the PARENT, before the child's environment is scrubbed
#: (`sandbox/_isolation.py`). These are the ones with no business being on that
#: box at all: they belong to the stub deployment, which runs no user code.
SANDBOX_FORBIDDEN_SECRETS = (
    "purview_client_secret",
    "anthropic_api_key",
    "chat_api_key",
)

#: Same rule, for secrets read straight from the environment rather than from
#: `Settings`. `DATABASE_URL` is the one that matters and `share/store.py` reads
#: it via `os.environ`, so a `getattr` on settings would never see it — which is
#: precisely the kind of miss that makes a check worse than none.
SANDBOX_FORBIDDEN_ENV = ("DATABASE_URL",)


def startup_failures(
    settings: Settings,
    *,
    spark_engine: bool,
    env: Mapping[str, str] | None = None,
) -> list[str]:
    """Reasons this process must not start, or `[]`.

    `spark_engine` is whether THIS deployment can execute notebook code with a
    real Spark session — passed in rather than imported so the check is pure and
    the caller decides what counts, and so a test does not need PySpark
    installed to exercise the rule.
    """
    env = os.environ if env is None else env
    if settings.app_env != "production":
        return []

    failures: list[str] = []

    if not settings.sandbox_require_auth:
        failures.append(
            "SANDBOX_REQUIRE_AUTH is false in production. /fabric/sandbox/run "
            "accepts notebook cells and executes them, so this makes arbitrary "
            "code execution available to anyone who can reach this server. "
            "Unset it, or do not run this deployment as production."
        )

    if spark_engine:
        present = [
            name.upper()
            for name in SANDBOX_FORBIDDEN_SECRETS
            if (getattr(settings, name, None) or "").strip()
        ] + [name for name in SANDBOX_FORBIDDEN_ENV if (env.get(name) or "").strip()]
        if present:
            failures.append(
                "This deployment runs the Spark executor, which runs notebook "
                "code as this process's own user — so every environment "
                "variable here is readable from inside a notebook cell. Remove "
                f"{', '.join(sorted(present))} from it; "
                "those belong on the stub deployment, which executes nothing."
            )

    return failures


def assert_safe_to_start(
    settings: Settings, *, spark_engine: bool, env: Mapping[str, str] | None = None
) -> None:
    """Raise unless every deployment invariant holds."""
    failures = startup_failures(settings, spark_engine=spark_engine, env=env)
    if failures:
        raise RuntimeError(
            "Refusing to start — unsafe configuration:\n  - " + "\n  - ".join(failures)
        )
