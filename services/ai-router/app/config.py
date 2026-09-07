from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated, server-side configuration for the AI router."""

    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_prefix="AI_ROUTER_",
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = Field(default=8001, ge=1, le=65_535)
    log_level: Literal["critical", "error", "warning", "info", "debug"] = "info"


@lru_cache
def get_settings() -> Settings:
    return Settings()
