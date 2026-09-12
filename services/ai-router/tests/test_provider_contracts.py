import asyncio
from collections.abc import AsyncGenerator
from typing import Any
from uuid import uuid4

import pytest

from app.config import Settings
from app.contracts import ProviderExecutionPlan
from app.providers.adapters import (
    AnthropicAdapter,
    GeminiAdapter,
    GroqAdapter,
    OpenAIAdapter,
    OpenRouterAdapter,
)
from app.providers.registry import ProviderRegistry


class MockTransport:
    def __init__(self, events: list[dict[str, Any]]) -> None:
        self.events = events
        self.requests: list[tuple[str, dict[str, str], dict[str, Any]]] = []

    async def post_json(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> dict[str, Any]:
        self.requests.append((url, headers, body))
        return {}

    async def stream_sse(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> AsyncGenerator[dict[str, Any], None]:
        self.requests.append((url, headers, body))
        for event in self.events:
            yield event


def plan(provider: str) -> ProviderExecutionPlan:
    return ProviderExecutionPlan.model_validate(
        {
            "request": {
                "context": {
                    "messages": [{"content": "hello", "role": "user"}],
                    "sourceIds": [],
                    "tokenEstimate": 1,
                },
                "contextSnapshotId": str(uuid4()),
                "maxOutputTokens": 100,
                "modelKey": f"{provider}:stable",
                "provider": provider,
                "runId": str(uuid4()),
            },
            "model": {
                "provider": provider,
                "providerModelId": "reviewed-model-id",
                "registryVersion": 7,
                "capabilities": {"modalities": {"input": ["text"], "output": ["text"]}},
                "pricingVersion": "reviewed-pricing-v7",
            },
        }
    )


@pytest.mark.parametrize(
    ("adapter_class", "provider", "events"),
    [
        (
            OpenAIAdapter,
            "openai",
            [
                {"type": "response.output_text.delta", "delta": "hi"},
                {
                    "type": "response.completed",
                    "response": {"usage": {"input_tokens": 2, "output_tokens": 1}},
                },
            ],
        ),
        (
            AnthropicAdapter,
            "anthropic",
            [
                {"type": "content_block_delta", "delta": {"text": "hi"}},
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": "end_turn"},
                    "usage": {"input_tokens": 2, "output_tokens": 1},
                },
                {"type": "message_stop"},
            ],
        ),
        (
            GeminiAdapter,
            "gemini",
            [
                {"candidates": [{"content": {"parts": [{"text": "hi"}]}}]},
                {
                    "candidates": [{"finishReason": "STOP"}],
                    "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 1},
                },
            ],
        ),
        (
            GroqAdapter,
            "groq",
            [
                {"id": "groq-request", "choices": [{"delta": {"content": "hi"}}]},
                {
                    "id": "groq-request",
                    "choices": [{"delta": {}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 2, "completion_tokens": 1},
                },
            ],
        ),
        (
            OpenRouterAdapter,
            "openrouter",
            [
                {"id": "openrouter-request", "choices": [{"delta": {"content": "hi"}}]},
                {
                    "id": "openrouter-request",
                    "choices": [{"delta": {}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 2, "completion_tokens": 1},
                },
            ],
        ),
    ],
)
def test_adapters_hide_wire_formats_behind_normalized_events(
    adapter_class: type[
        OpenAIAdapter | AnthropicAdapter | GeminiAdapter | GroqAdapter | OpenRouterAdapter
    ],
    provider: str,
    events: list[dict[str, Any]],
) -> None:
    transport = MockTransport(events)
    kwargs: dict[str, Any] = {"enabled": True, "api_key": "test-secret", "transport": transport}
    if adapter_class is AnthropicAdapter:
        kwargs["version"] = "2023-06-01"
    adapter = adapter_class(**kwargs)

    async def collect() -> list[Any]:
        return [event async for event in adapter.stream(plan(provider))]

    result = asyncio.run(collect())

    assert result[0].type == "run.started"
    assert [event.type for event in result[-3:]] == [
        "content.delta",
        "usage.updated",
        "run.completed",
    ]
    assert next(event for event in result if event.type == "content.delta").text == "hi"
    assert next(event for event in result if event.type == "usage.updated").input_tokens == 2
    if provider == "gemini":
        assert "reviewed-model-id:streamGenerateContent" in transport.requests[0][0]
    else:
        assert transport.requests[0][2]["model"] == "reviewed-model-id"
    if provider in {"groq", "openrouter"}:
        assert transport.requests[0][2]["max_tokens"] == 100
        assert transport.requests[0][2]["stream_options"] == {"include_usage": True}
    assert "test-secret" not in repr(result)


def test_registry_requires_explicit_enablement_and_never_exposes_keys() -> None:
    registry = ProviderRegistry(
        Settings(
            enable_openai=True,
            enable_anthropic=False,
            enable_gemini=False,
            enable_groq=False,
            enable_openrouter=False,
            openai_api_key="not-for-logs",
            anthropic_api_key=None,
            gemini_api_key=None,
            groq_api_key=None,
            openrouter_api_key=None,
        )
    )
    states = asyncio.run(registry.health())

    assert {state.provider: state.status for state in states} == {
        "openai": "enabled",
        "anthropic": "disabled",
        "gemini": "disabled",
        "groq": "disabled",
        "openrouter": "disabled",
    }
    assert "not-for-logs" not in repr(states)


def test_enabled_adapter_without_a_credential_is_unavailable_without_startup_failure() -> None:
    registry = ProviderRegistry(
        Settings(
            enable_groq=True, enable_openrouter=True, groq_api_key=None, openrouter_api_key=None
        )
    )
    states = {state.provider: state.status for state in asyncio.run(registry.health())}

    assert states["groq"] == "missing_credentials"
    assert states["openrouter"] == "missing_credentials"


def test_gemini_groq_and_openrouter_requests_follow_their_provider_contracts() -> None:
    transport = MockTransport([])
    gemini = GeminiAdapter(enabled=True, api_key="gemini-test-key", transport=transport)
    groq = GroqAdapter(enabled=True, api_key="groq-test-key", transport=transport)
    openrouter = OpenRouterAdapter(enabled=True, api_key="openrouter-test-key", transport=transport)

    gemini_plan = plan("gemini")
    gemini_plan = gemini_plan.model_copy(
        update={
            "model": gemini_plan.model.model_copy(update={"provider_model_id": "gemini-2.5-flash"})
        }
    )
    gemini_url = gemini._url(gemini_plan)
    gemini_body = gemini._payload(gemini_plan)
    assert gemini_url == (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.5-flash:streamGenerateContent?alt=sse"
    )
    assert gemini._headers() == {
        "x-goog-api-key": "gemini-test-key",
        "Content-Type": "application/json",
    }
    assert gemini_body == {
        "contents": [{"role": "user", "parts": [{"text": "hello"}]}],
        "generationConfig": {"maxOutputTokens": 100, "candidateCount": 1},
    }

    for adapter, provider, endpoint, key in (
        (groq, "groq", "https://api.groq.com/openai/v1/chat/completions", "groq-test-key"),
        (
            openrouter,
            "openrouter",
            "https://openrouter.ai/api/v1/chat/completions",
            "openrouter-test-key",
        ),
    ):
        request = plan(provider)
        assert adapter._url(request) == endpoint
        assert adapter._headers() == {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        assert adapter._payload(request) == {
            "model": "reviewed-model-id",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 100,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
