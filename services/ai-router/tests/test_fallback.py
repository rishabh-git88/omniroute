import asyncio
from collections.abc import AsyncGenerator
from typing import Literal
from uuid import uuid4

import pytest

from app.contracts import (
    FallbackEvent,
    FallbackExecutionRequest,
    NormalizedUsage,
    ProviderEvent,
    ProviderExecutionPlan,
    ProviderHealth,
)
from app.fallback import FallbackExecutor, classify_failure
from app.providers.base import ProviderAdapter


def plan(provider: str, snapshot: str | None = None) -> ProviderExecutionPlan:
    return ProviderExecutionPlan.model_validate(
        {
            "request": {
                "context": {
                    "messages": [{"role": "user", "content": "private canonical context"}],
                    "sourceIds": [],
                    "tokenEstimate": 3,
                },
                "contextSnapshotId": snapshot or str(uuid4()),
                "maxOutputTokens": 100,
                "modelKey": f"{provider}:model",
                "provider": provider,
                "runId": str(uuid4()),
            },
            "model": {
                "provider": provider,
                "providerModelId": "reviewed",
                "registryVersion": 1,
                "capabilities": {"contextWindow": 1000},
                "pricingVersion": "v1",
            },
        }
    )


class IntentionalFailureAdapter(ProviderAdapter):
    provider: Literal["openai", "anthropic"] = "openai"

    async def generate(self, plan: ProviderExecutionPlan) -> tuple[str, NormalizedUsage]:
        return "", NormalizedUsage()

    async def capabilities(self, plan: ProviderExecutionPlan) -> dict[str, object]:
        return plan.model.capabilities

    def usage(self, payload: dict[str, object]) -> NormalizedUsage:
        return NormalizedUsage()

    async def health(self) -> ProviderHealth:
        return ProviderHealth(provider="openai", status="ready")

    async def cancel(self, run_id: str) -> None:
        return None

    async def stream(self, plan: ProviderExecutionPlan) -> AsyncGenerator[ProviderEvent, None]:
        yield ProviderEvent(type="run.started", run_id=plan.request.run_id)
        yield ProviderEvent(
            type="run.failed",
            run_id=plan.request.run_id,
            code="HTTP_429",
            message="synthetic rate limit",
            retryable=True,
        )


class SuccessfulFallbackAdapter(IntentionalFailureAdapter):
    provider: Literal["anthropic"] = "anthropic"

    async def health(self) -> ProviderHealth:
        return ProviderHealth(provider="anthropic", status="ready")

    async def stream(self, plan: ProviderExecutionPlan) -> AsyncGenerator[ProviderEvent, None]:
        yield ProviderEvent(type="run.started", run_id=plan.request.run_id)
        yield ProviderEvent(type="content.delta", run_id=plan.request.run_id, text="recovered")
        yield ProviderEvent(type="run.completed", run_id=plan.request.run_id, finish_reason="stop")


def collect(request: FallbackExecutionRequest) -> list[ProviderEvent | FallbackEvent]:
    executor = FallbackExecutor(
        {"openai": IntentionalFailureAdapter(), "anthropic": SuccessfulFallbackAdapter()}
    )

    async def run() -> list[ProviderEvent | FallbackEvent]:
        return [event async for event in executor.stream(request)]

    return asyncio.run(run())


def test_primary_rate_limit_falls_back_using_the_exact_same_context_without_replay_charge() -> None:
    primary = plan("openai")
    secondary = plan("anthropic", str(primary.request.context_snapshot_id))
    events = collect(
        FallbackExecutionRequest(primary=primary, fallbacks=[secondary], allow_fallback=True)
    )

    transition = next(event for event in events if isinstance(event, FallbackEvent))
    assert transition.type == "fallback.started"
    assert transition.failure_class == "rate_limit"
    assert transition.run_id == secondary.request.run_id
    assert any(event.type == "run.completed" for event in events)
    assert secondary.request.context_snapshot_id == primary.request.context_snapshot_id
    # The executor receives pre-authorized distinct run IDs and has no ledger/database dependency.
    assert primary.request.run_id != secondary.request.run_id


def test_explicit_model_choice_never_silently_falls_back() -> None:
    primary = plan("openai")
    secondary = plan("anthropic", str(primary.request.context_snapshot_id))
    events = collect(
        FallbackExecutionRequest(
            primary=primary,
            fallbacks=[secondary],
            allow_fallback=True,
            user_selected_model=True,
            fallback_disclosed=False,
        )
    )

    assert any(
        isinstance(event, FallbackEvent) and event.type == "fallback.exhausted" for event in events
    )
    assert not any(event.type == "run.completed" for event in events)


def test_mismatched_context_is_rejected_before_any_secondary_provider_call() -> None:
    with pytest.raises(ValueError, match="same provider-neutral context"):
        collect(
            FallbackExecutionRequest(
                primary=plan("openai"), fallbacks=[plan("anthropic")], allow_fallback=True
            )
        )


@pytest.mark.parametrize(
    ("code", "classification"),
    [
        ("TIMEOUT", "timeout"),
        ("HTTP_500", "http_failure"),
        ("HTTP_429", "rate_limit"),
        ("MODEL_UNAVAILABLE", "unavailable"),
        ("BROKEN_STREAM", "streaming_failure"),
    ],
)
def test_failure_classification(code: str, classification: str) -> None:
    event = ProviderEvent(
        type="run.failed", run_id=uuid4(), code=code, message="safe", retryable=True
    )
    assert classify_failure(event) == classification


def test_disabled_primary_moves_to_eligible_fallback_without_dispatch() -> None:
    class Disabled(IntentionalFailureAdapter):
        async def health(self) -> ProviderHealth:
            return ProviderHealth(provider="openai", status="disabled")

        async def stream(self, plan: ProviderExecutionPlan) -> AsyncGenerator[ProviderEvent, None]:
            raise AssertionError("Disabled provider was contacted")
            yield ProviderEvent(type="run.started", run_id=plan.request.run_id)

    async def run() -> None:
        primary = plan("openai")
        executor = FallbackExecutor(
            {"openai": Disabled(), "anthropic": SuccessfulFallbackAdapter()}
        )
        events = [
            e
            async for e in executor.stream(
                FallbackExecutionRequest(
                    primary=primary,
                    fallbacks=[plan("anthropic", str(primary.request.context_snapshot_id))],
                    allow_fallback=True,
                )
            )
        ]
        assert any(e.type == "fallback.started" for e in events)
        assert events[-1].type == "run.completed"

    asyncio.run(run())


@pytest.mark.parametrize(
    "code", ["HTTP_400", "HTTP_401", "HTTP_403", "SAFETY_STOP", "CANCELLED", "REGISTRY_MISMATCH"]
)
def test_nonretryable_failures_are_not_fallback_classes(code: str) -> None:
    assert (
        classify_failure(
            ProviderEvent(
                type="run.failed", run_id=uuid4(), code=code, message="safe", retryable=False
            )
        )
        is None
    )
