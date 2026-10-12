from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Secrets come from the environment / secrets manager, never from code."""

    model_config = SettingsConfigDict(env_prefix="UPM_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://upm:upm@localhost:5432/upm"
    environment: str = "development"

    # Authentication: "dev" issues local tokens for seeded users; "oidc" validates Entra ID / OIDC bearer tokens.
    auth_mode: str = "dev"
    jwt_secret: str = "dev-only-secret-change-me-dev-only-secret"
    jwt_ttl_minutes: int = 480
    oidc_issuer: str | None = None
    oidc_audience: str | None = None
    oidc_jwks_url: str | None = None
    oidc_subject_claim: str = "oid"

    # Background processing
    run_worker_in_process: bool = True
    worker_poll_seconds: float = 2.0
    outbox_max_attempts: int = 5

    # AI meeting intelligence: "heuristic" runs fully locally; "ollama" calls a local LLM runtime.
    ai_provider: str = "heuristic"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"
    ai_timeout_seconds: float = 120.0

    # Microsoft Teams / Graph (optional; disabled unless configured)
    graph_tenant_id: str | None = None
    graph_client_id: str | None = None
    graph_client_secret: str | None = None
    teams_webhook_url: str | None = None

    # Integration webhook signing secret (HMAC-SHA256)
    webhook_secret: str = "dev-webhook-secret"

    cors_origins: str = "http://localhost:5173"
    static_dir: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
