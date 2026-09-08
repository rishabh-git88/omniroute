import asyncio
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import pytest

from app.config import Settings
from app.contracts import ProviderExecutionPlan
from app.providers.adapters import AnthropicAdapter, GeminiAdapter, OpenAIAdapter
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
    ) -> AsyncIterator[dict[str, Any]]:
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
                {"type": "message_delta", "usage": {"input_tokens": 2, "output_tokens": 1}},
                {"type": "message_stop"},
            ],
        ),
        (
            GeminiAdapter,
            "gemini",
            [
                {"event_type": "step.delta", "delta": {"content": {"text": "hi"}}},
                {
                    "event_type": "interaction.completed",
                    "usage": {"input_tokens": 2, "output_tokens": 1},
                },
            ],
        ),
    ],
)
def test_adapters_hide_wire_formats_behind_normalized_events(
    adapter_class: type[OpenAIAdapter | AnthropicAdapter | GeminiAdapter],
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

    assert [event.type for event in result] == [
        "run.started",
        "content.delta",
        "usage.updated",
        "run.completed",
    ]
    assert result[1].text == "hi"
    assert result[2].input_tokens == 2
    assert transport.requests[0][2]["model"] == "reviewed-model-id"
    assert "test-secret" not in repr(result)


def test_registry_requires_explicit_enablement_and_never_exposes_keys() -> None:
    registry = ProviderRegistry(Settings(enable_openai=True, openai_api_key="not-for-logs"))
    states = asyncio.run(registry.health())

    assert {state.provider: state.status for state in states} == {
        "openai": "ready",
        "anthropic": "disabled",
        "gemini": "disabled",
    }
    assert "not-for-logs" not in repr(states)
