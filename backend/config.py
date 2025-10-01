from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    openai_api_key: str
    debug: bool = False
    port: int = 8000
    database_url: str
    model_config = {"env_file": BASE_DIR / ".env", "env_file_encoding": "utf-8"}
    redis_url: str = "redis://localhost:6379"
    redis_ttl_embedding: int = 3600
    redis_ttl_search: int = 300
    redis_ttl_session: int = 86400


settings = Settings()
