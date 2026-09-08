from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
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
    enable_openai: bool = False
    enable_anthropic: bool = False
    enable_gemini: bool = False
    openai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENAI_API_KEY", "AI_ROUTER_OPENAI_API_KEY"),
        repr=False,
    )
    anthropic_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("ANTHROPIC_API_KEY", "AI_ROUTER_ANTHROPIC_API_KEY"),
        repr=False,
    )
    gemini_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GEMINI_API_KEY", "AI_ROUTER_GEMINI_API_KEY"),
        repr=False,
    )
    anthropic_version: str = "2023-06-01"


@lru_cache
def get_settings() -> Settings:
    return Settings()
