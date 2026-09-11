"""One bounded OpenAI attempt. Disconnect cancellation closes the upstream socket."""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import aclosing

from app.config import Settings
from app.contracts import ProviderEvent, ProviderExecutionPlan
from app.providers.registry import ProviderRegistry


def failure(plan: ProviderExecutionPlan, code: str, retryable: bool = False) -> ProviderEvent:
    return ProviderEvent(
        type="run.failed",
        run_id=plan.request.run_id,
        code=code,
        message="Generation could not complete",
        retryable=retryable,
    )


async def execute(
    plan: ProviderExecutionPlan, providers: ProviderRegistry, settings: Settings
) -> AsyncGenerator[ProviderEvent, None]:
    output_bytes = 0
    input_tokens = output_tokens = None
    try:
        if plan.model.provider != "openai" or plan.request.provider != "openai":
            yield failure(plan, "PROVIDER_DISABLED")
            return
        adapter = providers.for_plan(plan)
        if (await adapter.health()).status != "ready":
            yield failure(plan, "PROVIDER_DISABLED")
            return
        capabilities = plan.model.capabilities
        window = capabilities.get("contextWindow")
        maximum = capabilities.get("maxOutputTokens")
        estimate = 32 + sum(16 + len(m.content.encode()) for m in plan.request.context.messages)
        if (
            type(window) is not int
            or type(maximum) is not int
            or plan.request.max_output_tokens > min(maximum, settings.max_output_tokens)
            or estimate != plan.request.context.token_estimate
            or estimate + plan.request.max_output_tokens + 128 > window
        ):
            yield failure(plan, "CONTEXT_BUDGET_EXCEEDED")
            return
        async with asyncio.timeout(settings.request_timeout_seconds):
            async with aclosing(adapter.stream(plan)) as upstream:
                async for event in upstream:
                    if event.run_id != plan.request.run_id:
                        raise ValueError("Run mismatch")
                    if event.type == "content.delta":
                        output_bytes += len((event.text or "").encode())
                        if output_bytes > settings.max_output_bytes:
                            yield failure(plan, "OUTPUT_LIMIT_EXCEEDED")
                            return
                    if event.type == "usage.updated":
                        input_tokens = (
                            event.input_tokens if event.input_tokens is not None else input_tokens
                        )
                        output_tokens = (
                            event.output_tokens
                            if event.output_tokens is not None
                            else output_tokens
                        )
                        if (
                            output_tokens is not None
                            and output_tokens > plan.request.max_output_tokens
                        ):
                            # Capture usage even when the provider violated its cap.
                            yield event
                            yield failure(plan, "OUTPUT_LIMIT_EXCEEDED")
                            return
                    if event.type == "run.completed" and (
                        input_tokens is None or output_tokens is None
                    ):
                        yield failure(plan, "USAGE_MISSING")
                        return
                    yield event
                    if event.type in {"run.completed", "run.failed"}:
                        return
        yield failure(plan, "STREAM_TRUNCATED", True)
    except TimeoutError:
        yield failure(plan, "PROVIDER_TIMEOUT", True)
    except (RuntimeError, ValueError, TypeError, KeyError):
        yield failure(plan, "PROVIDER_PROTOCOL_ERROR")
