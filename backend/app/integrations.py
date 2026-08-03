"""Every external service this app talks to, and what breaks without each.

There was no single place that answered "what does this thing actually call?".
The knowledge was spread across five clients, two token audiences, three
optional credentials and a pile of docstrings — so the honest answer to a new
operator's first question was "read the source".

DELIBERATELY NOT CALLED "CONNECTORS". In Fabric that word already means a
data-source connector (the thing that connects a pipeline to Snowflake), and
this app's audience lives in Fabric. These are the services WE call — an
integration is a dependency of this application, a connector is a feature of
theirs.

CONFIGURATION, NOT LIVENESS. Nothing here makes a network call. A page that
probed six services would take as long as the slowest one, hang when a tenant
firewall blackholes a host, and cost a token acquisition per view. What it
reports is what has been configured and what that unlocks; `/fabric/status` and
`/purview/status` already answer "is it reachable right now" for the two where
that question is worth a round trip.

NO SECRETS LEAVE HERE. Every field is a boolean, a service name, or a value that
is already public (an account name, a model id). Not one credential, not
truncated, not masked — absent.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

from .config import Settings


@dataclass
class Integration:
    """One external service, and this app's relationship with it."""

    key: str
    name: str
    #: Who runs it — groups the list into Microsoft, model providers, storage.
    vendor: str
    #: The host, so "what is it actually calling" has a literal answer.
    host: str
    configured: bool
    #: What it is used FOR, in the product's own terms.
    purpose: str
    #: What stops working when it is not configured. Never "the app breaks" —
    #: every one of these is optional, and saying which feature goes dark is
    #: the difference between a status page and a checklist.
    degrades: str
    #: The credential or permission it needs, named exactly.
    needs: str
    #: Non-secret specifics worth seeing — an account name, a model id.
    detail: str = ""
    #: Set when configured but known to be limited in some way.
    caveats: list[str] = field(default_factory=list)


def describe_integrations(
    settings: Settings, env: Mapping[str, str] | None = None
) -> list[Integration]:
    """The full inventory, in the order an operator sets them up."""
    env = os.environ if env is None else env
    # `purview_configured` is what `FabricClient` itself gates the service
    # principal on, so it is the honest answer to "does the SP path work" —
    # even though it demands PURVIEW_ACCOUNT_NAME for things that have nothing
    # to do with Purview. That is a real trap for anyone configuring Fabric
    # alone, so the page names it rather than quietly reporting `false`.
    sp = settings.purview_configured
    sp_partial = bool(
        settings.purview_tenant_id and settings.purview_client_id and settings.purview_client_secret
    )
    sp_trap = (
        [
            "The service principal is set but PURVIEW_ACCOUNT_NAME is not — the "
            "client refuses to build one without it, even for Fabric-only use."
        ]
        if sp_partial and not sp
        else []
    )

    out: list[Integration] = [
        Integration(
            key="fabric",
            name="Microsoft Fabric REST API",
            vendor="Microsoft",
            host="api.fabric.microsoft.com",
            configured=True,
            purpose=(
                "Workspaces, items, notebook and pipeline definitions — the crawl "
                "behind Explore, the workspace lineage view and the sandbox."
            ),
            degrades="Nothing: a signed-in user's own token works without any server config.",
            needs=(
                "A signed-in user, or the service principal as a fallback. Reading a "
                "notebook's source needs Notebook.ReadWrite.All — Fabric has no "
                "read-only scope for a definition."
            ),
            detail="service principal available" if sp else "user sign-in only",
        ),
        Integration(
            key="onelake",
            name="OneLake (ADLS Gen2)",
            vendor="Microsoft",
            host="onelake.dfs.fabric.microsoft.com",
            configured=True,
            purpose=(
                "Delta transaction logs, for the column schemas the sandbox resolves "
                "its reads against."
            ),
            degrades=(
                "Column-level lineage. Tables still resolve, but without input schemas "
                "the run reports tables only."
            ),
            needs=(
                "A separate STORAGE token (storage.azure.com), not the Fabric one — "
                "the browser acquires both."
            ),
        ),
        Integration(
            key="powerbi-scanner",
            name="Power BI metadata scanner",
            vendor="Microsoft",
            host="api.powerbi.com",
            configured=sp,
            purpose=(
                "Semantic models, reports and dashboards — the BI half of the lineage, "
                "and the downstream impact of a sandbox run."
            ),
            degrades=(
                "Reports and semantic models are still drawn, but with no edges and "
                "marked as not crawled."
            ),
            needs=(
                "The service principal, AND either a Fabric administrator or that "
                "principal enabled under the tenant's metadata-scanning settings. "
                "Ordinary workspace access is never sufficient."
            ),
            caveats=[
                *sp_trap,
                "A different token audience from the Fabric API — a Fabric token is refused.",
                "Rate limited: 500 scans/hour, 100 workspaces per scan.",
            ],
        ),
        Integration(
            key="purview",
            name="Microsoft Purview",
            vendor="Microsoft",
            host="purview.azure.net",
            configured=bool(settings.purview_account_name and sp),
            purpose="Reading the governance catalog, and pushing lineage back into it.",
            degrades="The Purview ingest path and lineage push. Everything else is unaffected.",
            needs="PURVIEW_ACCOUNT_NAME plus the service principal.",
            detail=settings.purview_account_name or "",
            caveats=(
                []
                if settings.purview_allow_write
                else ["Writes are off (PURVIEW_ALLOW_WRITE); dry-run only."]
            ),
        ),
        Integration(
            key="graph",
            name="Microsoft Graph",
            vendor="Microsoft",
            host="graph.microsoft.com",
            configured=sp,
            purpose="Resolving the service principal's own identity, for diagnostics.",
            degrades="A less specific message when a Purview call is refused.",
            needs="The service principal.",
            caveats=sp_trap,
        ),
        Integration(
            key="assistant",
            name=f"Model provider ({settings.chat_provider})",
            vendor="Anthropic" if settings.chat_provider == "anthropic" else "OpenAI-compatible",
            host="api.anthropic.com" if settings.chat_provider == "anthropic" else "provider-defined",
            configured=settings.chat_configured,
            purpose="The modeling assistant — proposing edits to a lineage model in words.",
            degrades="The assistant panel. The app starts and every other path works.",
            needs="ANTHROPIC_API_KEY, or CHAT_API_KEY for an OpenAI-compatible provider.",
            detail=settings.chat_model if settings.chat_configured else "",
        ),
        Integration(
            key="share-store",
            name="Share link storage",
            vendor="Postgres" if env.get("DATABASE_URL") else "SQLite (local file)",
            host=env.get("DATABASE_URL", "").split("@")[-1].split("/")[0] or "on disk",
            configured=True,
            purpose="Published share links and the model snapshot behind each one.",
            degrades="Nothing — it falls back to a local SQLite file.",
            needs="DATABASE_URL for anything durable.",
            caveats=(
                []
                if env.get("DATABASE_URL")
                else [
                    "SQLite on a container filesystem: every share link is lost on "
                    "the next deploy."
                ]
            ),
        ),
    ]
    return out
