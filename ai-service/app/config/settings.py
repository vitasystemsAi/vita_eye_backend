from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = SERVICE_DIR.parent


class Settings(BaseSettings):
    """AI service configuration (reads the repository root .env, then ai-service/.env)."""

    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", SERVICE_DIR / ".env"),
        extra="ignore",
        case_sensitive=False,
    )

    internal_service_token: str = Field(min_length=24)
    backend_internal_url: str = "http://localhost:5000"
    ai_host: str = "0.0.0.0"
    ai_port: int = 8000
    ai_models_dir: str = "./models"
    ai_max_streams: int = 8
    ai_inference_workers: int = 2
    ai_max_upload_mb: int = 8
    log_level: str = "info"

    @property
    def models_path(self) -> Path:
        p = Path(self.ai_models_dir)
        return p if p.is_absolute() else (SERVICE_DIR / p).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
