"""Failure-aware fallback over pre-authorized provider plans; never charges or persists itself."""

from collections.abc import AsyncIterator

from app.contracts import (
    FallbackEvent,
    FallbackExecutionRequest,
    ProviderEvent,
    ProviderExecutionPlan,
)
from app.providers.base import ProviderAdapter


def classify_failure(event: ProviderEvent) -> str | None:
    if event.type != "run.failed":
        return None
    code = event.code or "UNKNOWN"
    if code in {"NETWORK_ERROR", "TIMEOUT", "PROVIDER_TIMEOUT", "HTTP_504"}:
        return "timeout"
    if code in {"HTTP_429", "RATE_LIMITED"}:
        return "rate_limit"
    if code in {
        "PROVIDER_UNAVAILABLE",
        "PROVIDER_DISABLED",
        "PROVIDER_MISSING_CREDENTIALS",
        "MODEL_UNAVAILABLE",
        "HTTP_404",
        "HTTP_503",
    }:
        return "unavailable"
    if code in {"HTTP_500", "HTTP_502", "HTTP_529", "PROVIDER_TEMPORARY_ERROR"}:
        return "http_failure"
    if code in {"STREAM_TRUNCATED", "PROVIDER_PROTOCOL_ERROR", "USAGE_MISSING", "BROKEN_STREAM"}:
        return "streaming_failure"
    return None


class FallbackExecutor:
    def __init__(self, adapters: dict[str, ProviderAdapter]) -> None:
        self._adapters = adapters

    async def stream(
        self, request: FallbackExecutionRequest
    ) -> AsyncIterator[ProviderEvent | FallbackEvent]:
        plans = [request.primary, *request.fallbacks]
        self._validate_context(plans)
        for index, plan in enumerate(plans):
            adapter = self._adapters.get(plan.model.provider)
            if not adapter or (await adapter.health()).status not in {
                "ready",
                "enabled",
                "available",
            }:
                failure = "unavailable"
            else:
                useful_output = False
                failure = "streaming_failure"
                async for event in adapter.stream(plan):
                    if event.type == "content.delta" and event.text:
                        useful_output = True
                    yield event
                    if event.type == "run.completed":
                        return
                    if event.type == "run.failed" and classify_failure(event) is None:
                        return
                    classified = classify_failure(event)
                    if classified:
                        failure = classified
                        break
                if failure is None:
                    return
                if useful_output:
                    # Partial output is durable/billable; never replace it silently.
                    return
            next_plan = plans[index + 1] if index + 1 < len(plans) else None
            if not next_plan or not self._permitted(request):
                yield FallbackEvent(
                    type="fallback.exhausted",
                    run_id=plan.request.run_id,
                    failure_class=failure or "unavailable",
                )
                return
            yield FallbackEvent(
                type="fallback.started",
                run_id=next_plan.request.run_id,
                previous_run_id=plan.request.run_id,
                failure_class=failure or "unavailable",
                provider=next_plan.model.provider,
                model_key=next_plan.request.model_key,
            )

    @staticmethod
    def _permitted(request: FallbackExecutionRequest) -> bool:
        if not request.allow_fallback:
            return False
        # A user-selected target is only replaced after an explicit disclosed opt-in.
        return not request.user_selected_model or request.fallback_disclosed

    @staticmethod
    def _validate_context(plans: list[ProviderExecutionPlan]) -> None:
        source = plans[0].request.context_snapshot_id
        if any(
            plan.request.context_snapshot_id != source
            or plan.request.context != plans[0].request.context
            for plan in plans[1:]
        ):
            raise ValueError("Fallback plans must use the same provider-neutral context snapshot")
