from app.config import Settings
from app.contracts import ProviderExecutionPlan, ProviderHealth
from app.providers.adapters import (
    AnthropicAdapter,
    GeminiAdapter,
    GroqAdapter,
    OpenAIAdapter,
    OpenRouterAdapter,
    StreamingAdapter,
)
from app.providers.base import ProviderAdapter, ProviderTransport
from app.providers.http_transport import HttpTransport


class ProviderRegistry:
    """Creates only individually enabled adapters and never returns credentials to callers."""

    def __init__(self, settings: Settings, transport: ProviderTransport | None = None) -> None:
        http = transport or HttpTransport()
        self.active_requests = 0
        self._adapters: dict[str, ProviderAdapter] = {
            "openai": OpenAIAdapter(
                enabled=settings.enable_openai, api_key=settings.openai_api_key, transport=http
            ),
            "anthropic": AnthropicAdapter(
                enabled=settings.enable_anthropic,
                api_key=settings.anthropic_api_key,
                transport=http,
                version=settings.anthropic_version,
            ),
            "gemini": GeminiAdapter(
                enabled=settings.enable_gemini, api_key=settings.gemini_api_key, transport=http
            ),
            "groq": GroqAdapter(
                enabled=settings.enable_groq, api_key=settings.groq_api_key, transport=http
            ),
            "openrouter": OpenRouterAdapter(
                enabled=settings.enable_openrouter,
                api_key=settings.openrouter_api_key,
                transport=http,
            ),
        }

        for adapter in self._adapters.values():
            if isinstance(adapter, StreamingAdapter):
                adapter.cooldown_seconds = settings.health_cooldown_seconds

    def for_plan(self, plan: ProviderExecutionPlan) -> ProviderAdapter:
        adapter = self._adapters.get(plan.model.provider)
        if not adapter:
            raise ValueError("No adapter exists for registry provider")
        return adapter

    async def health(self) -> list[ProviderHealth]:
        return [await adapter.health() for adapter in self._adapters.values()]

    def observe(self, plan: ProviderExecutionPlan, code: str | None, latency_ms: int) -> None:
        adapter = self.for_plan(plan)
        if isinstance(adapter, StreamingAdapter):
            adapter.observe(code, latency_ms)
