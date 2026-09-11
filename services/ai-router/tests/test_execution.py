import asyncio
import json
from collections.abc import AsyncGenerator
from contextlib import aclosing
from typing import Any

import httpx
import pytest
from test_provider_contracts import MockTransport, plan

import app.main as main
from app.config import Settings
from app.contracts import ProviderEvent, ProviderExecutionPlan
from app.execution import execute
from app.providers.registry import ProviderRegistry

TOKEN = "synthetic-internal-token-for-tests-only"


def execution_plan() -> ProviderExecutionPlan:
    value = plan("openai").model_dump(mode="json", by_alias=True, exclude_none=True)
    value["request"]["context"]["tokenEstimate"] = 53
    value["model"]["capabilities"] = {"contextWindow": 32768, "maxOutputTokens": 4096}
    return ProviderExecutionPlan.model_validate(value)


def configuration(**extra: Any) -> Settings:
    return Settings(internal_token=TOKEN, enable_openai=True, openai_api_key="synthetic", **extra)


def completed() -> dict[str, Any]:
    return {
        "type": "response.completed",
        "response": {"usage": {"input_tokens": 2, "output_tokens": 1}},
    }


def collect(transport: MockTransport, **extra: Any) -> list[ProviderEvent]:
    settings = configuration(**extra)

    async def run() -> list[ProviderEvent]:
        return [
            event
            async for event in execute(
                execution_plan(), ProviderRegistry(settings, transport), settings
            )
        ]

    return asyncio.run(run())


@pytest.mark.parametrize(
    "path",
    [
        "/providers/stream",
        "/providers/generate",
        "/providers/fallback-stream",
        "/routing/decisions",
    ],
)
def test_all_execution_endpoints_reject_missing_wrong_and_unconfigured_auth(
    path: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://router"
        ) as client:
            for token in ["", "wrong"]:
                response = await client.post(path, json={}, headers={"authorization": token})
                assert response.status_code == 401
            monkeypatch.setattr(main, "settings", Settings(internal_token=""))
            response = await client.post(
                path, json={}, headers={"authorization": f"Bearer {TOKEN}"}
            )
            assert response.status_code == 401

    monkeypatch.setattr(main, "settings", configuration())
    asyncio.run(run())


def test_authenticated_http_stream_preserves_contract_and_caps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = configuration()
    transport = MockTransport(
        [
            {"type": "response.created", "response": {"id": "resp_test"}},
            {"type": "response.output_text.delta", "delta": "hello"},
            completed(),
        ]
    )
    monkeypatch.setattr(main, "settings", settings)
    monkeypatch.setattr(main, "providers", ProviderRegistry(settings, transport))

    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://router"
        ) as client:
            response = await client.post(
                "/providers/stream",
                json=execution_plan().model_dump(mode="json", by_alias=True, exclude_none=True),
                headers={"authorization": f"Bearer {TOKEN}"},
            )
            assert response.status_code == 200
            events = [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]
            assert events[-1]["type"] == "run.completed"
            assert any(event.get("providerRequestId") == "resp_test" for event in events)
            assert "synthetic" not in response.text

    asyncio.run(run())
    body = transport.requests[0][2]
    assert body["max_output_tokens"] == 100
    assert body["store"] is False
    assert body["input"] == [{"content": "hello", "role": "user"}]
    assert "previous_response_id" not in body


@pytest.mark.parametrize(
    ("events", "code"),
    [
        ([], "STREAM_TRUNCATED"),
        ([{"type": "response.completed", "response": {}}], "USAGE_MISSING"),
        ([{"type": "error", "message": "SECRET"}], "PROVIDER_ERROR"),
        ([{"type": "response.output_text.delta", "delta": "a" * 11}], "OUTPUT_LIMIT_EXCEEDED"),
    ],
)
def test_failures_are_terminal_and_safe(events: list[dict[str, Any]], code: str) -> None:
    result = collect(MockTransport(events), max_output_bytes=10)
    assert result[-1].type == "run.failed"
    assert result[-1].code == code
    assert sum(event.type in {"run.completed", "run.failed"} for event in result) == 1
    assert "SECRET" not in repr(result)


def test_duplicate_terminals_stop_upstream_and_incomplete_preserves_usage() -> None:
    event = completed()
    event["type"] = "response.incomplete"
    event["response"]["incomplete_details"] = {"reason": "max_output_tokens"}
    result = collect(MockTransport([event, completed()]))
    assert result[-1].finish_reason == "length"
    assert result[-2].input_tokens == 2
    assert sum(item.type == "run.completed" for item in result) == 1


class SlowTransport(MockTransport):
    def __init__(self) -> None:
        super().__init__([])
        self.closed = False

    async def stream_sse(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> AsyncGenerator[dict[str, Any], None]:
        try:
            await asyncio.sleep(60)
            yield completed()
        finally:
            self.closed = True


def test_timeout_closes_upstream_and_emits_one_failure() -> None:
    transport = SlowTransport()
    result = collect(transport, request_timeout_seconds=0.01)
    assert result[-1].code == "PROVIDER_TIMEOUT"
    assert transport.closed


def test_cancellation_closes_blocked_upstream() -> None:
    transport = SlowTransport()
    settings = configuration()

    async def run() -> None:
        async def consume() -> None:
            async with aclosing(
                execute(execution_plan(), ProviderRegistry(settings, transport), settings)
            ) as stream:
                async for _ in stream:
                    pass

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert transport.closed


def test_invalid_budget_never_contacts_provider() -> None:
    transport = MockTransport([completed()])
    result = collect(transport, max_output_tokens=50)
    assert result[-1].code == "CONTEXT_BUDGET_EXCEEDED"
    assert not transport.requests


def test_reported_over_cap_usage_is_captured_before_failure() -> None:
    event = completed()
    event["response"]["usage"]["output_tokens"] = 101
    result = collect(MockTransport([event]))
    assert result[-2].type == "usage.updated"
    assert result[-2].output_tokens == 101
    assert result[-1].code == "OUTPUT_LIMIT_EXCEEDED"


def test_other_provider_cannot_execute() -> None:
    settings = configuration()
    transport = MockTransport([completed()])
    value = execution_plan().model_dump(mode="json", by_alias=True, exclude_none=True)
    value["request"]["provider"] = "anthropic"
    value["model"]["provider"] = "anthropic"
    other = ProviderExecutionPlan.model_validate(value)

    async def run() -> list[ProviderEvent]:
        return [
            event async for event in execute(other, ProviderRegistry(settings, transport), settings)
        ]

    assert asyncio.run(run())[-1].code == "PROVIDER_DISABLED"
    assert not transport.requests


def test_generate_endpoint_does_not_return_success_on_provider_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = configuration()
    monkeypatch.setattr(main, "settings", settings)
    monkeypatch.setattr(
        main, "providers", ProviderRegistry(settings, MockTransport([{"type": "error"}]))
    )

    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://router"
        ) as client:
            response = await client.post(
                "/providers/generate",
                json=execution_plan().model_dump(mode="json", by_alias=True, exclude_none=True),
                headers={"authorization": f"Bearer {TOKEN}"},
            )
            assert response.status_code == 502
            assert response.json() == {"detail": "PROVIDER_ERROR"}

    asyncio.run(run())


def test_disabled_provider_is_classified_before_dispatch() -> None:
    settings = Settings(internal_token=TOKEN)
    transport = MockTransport([completed()])

    async def run() -> list[ProviderEvent]:
        return [
            event
            async for event in execute(
                execution_plan(), ProviderRegistry(settings, transport), settings
            )
        ]

    assert asyncio.run(run())[-1].code == "PROVIDER_DISABLED"
    assert not transport.requests
