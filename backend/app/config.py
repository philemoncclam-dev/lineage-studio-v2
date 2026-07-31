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

    #: The model assistant. Absent is a normal state, exactly like Purview and
    #: Fabric: the app serves every other path without it, and `/chat/status`
    #: lets the UI hide the assistant rather than offer a failing button.
    anthropic_api_key: str | None = None
    #: Haiku by default — an assistant that costs little enough to leave on is
    #: worth more than a sharper one nobody can afford to ask. The tool layer is
    #: where the accuracy lives (every fact comes back through a deterministic
    #: graph walk), so the model's job is choosing the walk and saying the
    #: result, and a small model does both. Set ANTHROPIC_MODEL=claude-opus-5
    #: for the harder judgment calls; `evals/run.py --model` grades either.
    anthropic_model: str = "claude-haiku-4-5-20251001"

    #: `anthropic` or `openai_compatible`. The second is the common dialect
    #: spoken by Gemini, Groq, OpenRouter and Ollama alike — which one you get
    #: is decided by `chat_base_url`, not by a separate provider each time.
    chat_provider: str = "anthropic"
    chat_api_key: str | None = None
    chat_base_url: str | None = None
    #: Empty means "use the Anthropic default", so an existing .env that only
    #: sets ANTHROPIC_MODEL keeps working untouched.
    chat_model_name: str = ""

    #: Refuse `/chat/ask` from a caller who sent no bearer token.
    #:
    #: On by DEFAULT, unlike every other option here, because this is the one
    #: route that spends money: an unauthenticated assistant on a public URL is
    #: a billing account anybody who learns the address can draw on, and the
    #: quiet version of that failure is a large invoice rather than an error.
    #: Fabric's own routes need no such flag — a request without a token gets
    #: the service principal and reads what it is allowed to read, at no cost.
    #:
    #: Set `CHAT_REQUIRE_AUTH=false` on a local backend where sign-in is not
    #: configured. That is a laptop reachable from nowhere; a deployment is not.
    chat_require_auth: bool = True

    #: Refuse `/fabric/sandbox/run` from a caller who sent no bearer token.
    #:
    #: On by DEFAULT, and for a sharper reason than the assistant's. `/chat/ask`
    #: spends money; this route runs CODE. On the Spark engine the cells go to
    #: `exec()` (`child_spark.py`), so an unauthenticated sandbox on a public URL
    #: is arbitrary remote execution for anyone who reads the address out of the
    #: frontend bundle — where it is published in plain text.
    #:
    #: Note this gate is about the CELLS path. The fetch path was always gated
    #: (`assert_visible`), but that check only runs when a notebook is fetched;
    #: cells supplied directly skipped every check and went straight to the
    #: child. The stub engine hid the consequence for as long as it was all that
    #: production ran — it pattern-matches text and executes nothing.
    #:
    #: Set `SANDBOX_REQUIRE_AUTH=false` on a local backend where sign-in is not
    #: configured. That is a laptop reachable from nowhere; a deployment is not.
    sandbox_require_auth: bool = True

    @property
    def chat_model(self) -> str:
        return self.chat_model_name or self.anthropic_model

    @property
    def chat_configured(self) -> bool:
        if self.chat_provider == "openai_compatible":
            return bool(self.chat_api_key)
        return bool(self.anthropic_api_key)

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
