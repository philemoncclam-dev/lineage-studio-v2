"""Runtime configuration.

Settings come from the environment (a local `.env` in development). Purview
credentials are optional: the app must still start and serve the sample and
manual-ingest paths on a machine with no Purview access at all, so absence of
config is a normal state, not an error.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Azure AD v2 scope for the Purview data plane. The upstream scripts use the
# legacy v1 `oauth2/token` endpoint with `resource=https://purview.azure.net`;
# this is the current equivalent, and azure-identity handles refresh for us.
PURVIEW_SCOPE = "https://purview.azure.net/.default"

# The .env lives at the repo root, but the backend is normally launched from
# `backend/` — so resolve it absolutely rather than relative to the cwd.
_REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    purview_account_name: str | None = None
    purview_tenant_id: str | None = None
    purview_client_id: str | None = None
    purview_client_secret: str | None = None

    # Writes to Purview are opt-in. See `purview.writer` — this gates the
    # entire push path, and dry-run remains available regardless.
    purview_allow_write: bool = Field(
        False, description="Permit lineage pushes into Purview"
    )

    #: Extra browser origins allowed to call this API, comma-separated. The Vite
    #: dev server is always allowed; a deployed frontend is not, because the
    #: backend holds Purview credentials and any origin permitted here can spend
    #: them on a visitor's behalf.
    cors_origins: str = ""

    @property
    def allowed_origins(self) -> list[str]:
        configured = [o.strip().rstrip("/") for o in self.cors_origins.split(",")]
        return ["http://localhost:5173", *[o for o in configured if o]]

    @property
    def purview_configured(self) -> bool:
        """True when every credential needed for a read call is present."""
        return all(
            (
                self.purview_account_name,
                self.purview_tenant_id,
                self.purview_client_id,
                self.purview_client_secret,
            )
        )

    @property
    def purview_endpoint(self) -> str | None:
        """Data-plane base URL, derived so callers only configure the name."""
        if not self.purview_account_name:
            return None
        return f"https://{self.purview_account_name}.purview.azure.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
