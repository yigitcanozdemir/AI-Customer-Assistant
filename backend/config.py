from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    frontend_url: str
    debug: bool = False
    environment: str = "production"
    port: int = 8000
    redis_url: str
    database_url: str
    redis_ttl_embedding: int = 3600
    redis_ttl_search: int = 300
    redis_ttl_session: int = 86400
    app_name: str = "ecommerce-api"
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── LLM provider selection ──────────────────────────────
    # Active chat provider: "openai" | "anthropic" | "gemini".
    llm_provider: str = "openai"

    # OpenAI (chat + embeddings). openai_api_key is optional so a
    # deployment that runs a different chat provider can still use OpenAI
    # embeddings, or omit them if unused.
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"

    # Anthropic / Claude
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-8"

    # Google Gemini
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"

    # Embeddings are dimension-locked to the DB schema (Vector(1536));
    # OpenAI text-embedding-3-small is the only supported model for now.
    embedding_model: str = "text-embedding-3-small"

    # ── Auth ────────────────────────────────────────────────
    auth_secret: str | None = None
    # Lifetime of an issued session token, in seconds (default 24h).
    session_token_ttl: int = 86400
    # When true, WS/REST reject requests lacking a valid session token. Kept
    # false by default so the backend can be deployed before the frontend that
    # sends tokens (the token path is issued/verified either way); flip to true
    # once the frontend is updated. Enforcement is always active in production
    # if AUTH_SECRET is set (see api/endpoint.py:_auth_required).
    auth_enforced: bool = False

    # ── Demo housekeeping ───────────────────────────────────
    # A leaving visitor's own orders are deleted immediately by
    # POST /events/session/{id}/end. This periodic sweep is only the backstop
    # for sessions that never sent that signal (crash, force-quit, offline), so
    # its TTL must stay comfortably longer than any plausible session.
    #
    # It was 10 minutes with a 600s interval, which meant orders vanished
    # 10-20 minutes after creation *while the visitor was still shopping* —
    # "track my order" would report no orders at all. Set <=0 to disable.
    demo_order_ttl_minutes: int = 1440  # 24h
    demo_order_cleanup_interval_seconds: int = 3600

    # ── Observability ───────────────────────────────────────
    tempo_endpoint: str = "tempo:4317"
    otel_exporter_otlp_endpoint: str | None = None
    otel_exporter_otlp_protocol: str = "grpc"
    # Standard OTLP header var, e.g. "Authorization=Basic <base64 user:token>".
    # OpenObserve requires auth on its ingest endpoint and returns 401 without
    # it — the exporter retries silently, so traces just never appear.
    otel_exporter_otlp_headers: str | None = None
    otel_service_name: str = "fastapi-service"
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str | None = None


settings = Settings()
