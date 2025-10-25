from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    frontend_url: str
    openai_api_key: str
    debug: bool = False
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


settings = Settings()
