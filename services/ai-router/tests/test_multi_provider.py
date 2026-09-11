import asyncio
from contextlib import aclosing
from typing import Any

import httpx
import pytest
from test_execution import SlowTransport
from test_provider_contracts import MockTransport, plan

from app.config import Settings
from app.contracts import ProviderEvent, ProviderExecutionPlan
from app.execution import execute
from app.providers.base import ProviderTransportError
from app.providers.registry import ProviderRegistry


def settings(**kwargs: Any) -> Settings:
    return Settings(
        enable_openai=True,
        enable_anthropic=True,
        enable_gemini=True,
        openai_api_key="synthetic",
        anthropic_api_key="synthetic",
        gemini_api_key="synthetic",
        **kwargs,
    )


def execution_plan(provider: str) -> ProviderExecutionPlan:
    value = plan(provider).model_dump(by_alias=True, mode="json", exclude_none=True)
    value["request"]["context"]["tokenEstimate"] = 53
    value["model"]["capabilities"] = {"contextWindow": 4096, "maxOutputTokens": 100}
    return ProviderExecutionPlan.model_validate(value)


def wire(provider: str, finish: str = "stop") -> list[dict[str, Any]]:
    if provider == "openai":
        return [
            {"type": "response.created", "response": {"id": "request-test"}},
            {"type": "response.output_text.delta", "delta": "hello"},
            {
                "type": "response.completed" if finish == "stop" else "response.incomplete",
                "response": {
                    "usage": {"input_tokens": 20, "output_tokens": 5, "total_tokens": 25},
                    "incomplete_details": {"reason": "max_output_tokens"},
                },
            },
        ]
    if provider == "anthropic":
        return [
            {
                "type": "message_start",
                "message": {
                    "id": "request-test",
                    "usage": {"input_tokens": 20, "output_tokens": 1},
                },
            },
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "hello"}},
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn" if finish == "stop" else "max_tokens"},
                "usage": {"output_tokens": 5},
            },
            {"type": "message_stop"},
        ]
    return [
        {"responseId": "request-test", "candidates": [{"content": {"parts": [{"text": "hello"}]}}]},
        {
            "candidates": [{"finishReason": "STOP" if finish == "stop" else "MAX_TOKENS"}],
            "usageMetadata": {
                "promptTokenCount": 20,
                "candidatesTokenCount": 3,
                "thoughtsTokenCount": 2,
                "totalTokenCount": 25,
            },
        },
    ]


@pytest.mark.parametrize("provider", ["openai", "anthropic", "gemini"])
@pytest.mark.parametrize("finish", ["stop", "length"])
def test_actual_wire_usage_finish_request_identity_and_output_caps(
    provider: str, finish: str
) -> None:
    transport = MockTransport(wire(provider, finish))
    config = settings()
    registry = ProviderRegistry(config, transport)

    async def run() -> list[ProviderEvent]:
        assert (await registry.for_plan(execution_plan(provider)).health()).status == "enabled"
        result = [event async for event in execute(execution_plan(provider), registry, config)]
        assert (await registry.for_plan(execution_plan(provider)).health()).status == "available"
        return result

    result = asyncio.run(run())
    usage = [e for e in result if e.type == "usage.updated"][-1]
    assert (usage.input_tokens, usage.output_tokens, usage.total_tokens) == (20, 5, 25)
    assert result[-1].finish_reason == finish
    assert sum(e.type in {"run.failed", "run.completed"} for e in result) == 1
    assert any(e.provider_request_id == "request-test" for e in result)
    assert "".join(e.text or "" for e in result) == "hello"
    body = transport.requests[0][2]
    assert (
        body["generationConfig"]["maxOutputTokens"]
        if provider == "gemini"
        else body["max_tokens"]
        if provider == "anthropic"
        else body["max_output_tokens"]
    ) == 100


@pytest.mark.parametrize("provider", ["openai", "anthropic", "gemini"])
def test_timeout_and_cancellation_close_each_provider(provider: str) -> None:
    async def run() -> None:
        config = settings(request_timeout_seconds=0.01)
        transport = SlowTransport()
        registry = ProviderRegistry(config, transport)
        result = [e async for e in execute(execution_plan(provider), registry, config)]
        assert result[-1].code == "PROVIDER_TIMEOUT"
        assert transport.closed
        assert (await registry.for_plan(execution_plan(provider)).health()).status == "timed_out"
        transport = SlowTransport()
        registry = ProviderRegistry(settings(), transport)

        async def consume() -> None:
            async with aclosing(execute(execution_plan(provider), registry, settings())) as stream:
                async for _ in stream:
                    pass

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert transport.closed
        assert registry.active_requests == 0

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["openai", "anthropic", "gemini"])
@pytest.mark.parametrize(
    ("status", "code", "health"),
    [
        (429, "RATE_LIMITED", "rate_limited"),
        (401, "PROVIDER_AUTH_FAILED", "missing_credentials"),
        (503, "PROVIDER_TEMPORARY_ERROR", "temporarily_unhealthy"),
        (400, "PROVIDER_INVALID_REQUEST", "enabled"),
    ],
)
def test_normalized_errors_and_observed_health(
    provider: str, status: int, code: str, health: str
) -> None:
    class ErrorTransport(MockTransport):
        async def stream_sse(self, *args: Any, **kwargs: Any):  # type: ignore[no-untyped-def]
            raise ProviderTransportError(status, "sensitive upstream body")
            yield {}

    async def run() -> None:
        config = settings()
        registry = ProviderRegistry(config, ErrorTransport([]))
        result = [e async for e in execute(execution_plan(provider), registry, config)]
        assert result[-1].code == code
        assert "sensitive" not in repr(result)
        assert (await registry.for_plan(execution_plan(provider)).health()).status == health

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["openai", "anthropic", "gemini"])
def test_eof_cannot_be_success_and_generate_shares_normalization(provider: str) -> None:
    async def run() -> None:
        registry = ProviderRegistry(settings(), MockTransport([]))
        adapter = registry.for_plan(execution_plan(provider))
        with pytest.raises(RuntimeError):
            await adapter.generate(execution_plan(provider))
        registry = ProviderRegistry(settings(), MockTransport(wire(provider)))
        content, usage = await registry.for_plan(execution_plan(provider)).generate(
            execution_plan(provider)
        )
        assert content == "hello" and usage.total_tokens == 25

    asyncio.run(run())


def test_admission_limit_never_dispatches() -> None:
    async def run() -> None:
        config = settings(max_concurrent_requests=1)
        transport = MockTransport([])
        registry = ProviderRegistry(config, transport)
        registry.active_requests = 1
        result = [e async for e in execute(execution_plan("openai"), registry, config)]
        assert result[-1].code == "REQUEST_LIMIT_EXCEEDED"
        assert not transport.requests

    asyncio.run(run())


def test_anthropic_interim_usage_cannot_complete_a_malformed_final_stream() -> None:
    events = wire("anthropic")
    events[-2]["usage"] = {}

    async def run() -> None:
        config = settings()
        result = [
            e
            async for e in execute(
                execution_plan("anthropic"), ProviderRegistry(config, MockTransport(events)), config
            )
        ]
        assert result[-1].code == "USAGE_MISSING"
        assert not any(e.type == "run.completed" for e in result)
        assert [e for e in result if e.type == "usage.updated"][-1].usage_final is False

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["openai", "anthropic", "gemini"])
def test_closing_before_dispatch_removes_cancellation_ownership(provider: str) -> None:
    async def run() -> None:
        request = execution_plan(provider)
        transport = MockTransport(wire(provider))
        adapter = ProviderRegistry(settings(), transport).for_plan(request)
        stream = adapter.stream(request)
        assert (await anext(stream)).type == "run.started"
        await stream.aclose()
        await adapter.cancel(str(request.request.run_id))
        # A stale ownership entry would cancel this task after the stream closed.
        await asyncio.sleep(0)
        assert not transport.requests

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["openai", "anthropic", "gemini"])
def test_generate_endpoint_returns_the_same_canonical_usage_and_completion(
    provider: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.main as main

    token = "synthetic-generate-contract-test-token"
    config = settings(internal_token=token)
    monkeypatch.setattr(main, "settings", config)
    monkeypatch.setattr(main, "providers", ProviderRegistry(config, MockTransport(wire(provider))))

    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://router"
        ) as client:
            response = await client.post(
                "/providers/generate",
                headers={"authorization": f"Bearer {token}"},
                json=execution_plan(provider).model_dump(
                    by_alias=True, mode="json", exclude_none=True
                ),
            )
            assert response.status_code == 200
            assert response.json() == {
                "content": "hello",
                "finishReason": "stop",
                "providerRequestId": "request-test",
                "usage": {"inputTokens": 20, "outputTokens": 5, "totalTokens": 25},
            }

    asyncio.run(run())
