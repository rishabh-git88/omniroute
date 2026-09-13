import asyncio
import time
from collections.abc import AsyncGenerator
from contextlib import aclosing
from typing import Any, Literal
from urllib.parse import quote

from app.contracts import (
    HealthStatus,
    NormalizedUsage,
    ProviderEvent,
    ProviderExecutionPlan,
    ProviderHealth,
)
from app.providers.base import (
    SSE_DONE_EVENT,
    ProviderAdapter,
    ProviderErrorDiagnostic,
    ProviderTransport,
    ProviderTransportError,
)


def event_shape(raw: object) -> dict[str, object]:
    """Return safe wire-shape evidence for guarded diagnostics only.

    Values can contain provider output or user input, so this deliberately records
    field names, container types, counts, and the finish reason only.
    """

    if not isinstance(raw, dict):
        return {"eventType": type(raw).__name__}
    summary: dict[str, object] = {
        "topLevelFields": sorted(raw),
        "fieldTypes": {key: type(value).__name__ for key, value in raw.items()},
    }
    candidates = raw.get("candidates")
    if isinstance(candidates, list):
        summary["candidateCount"] = len(candidates)
        if candidates and isinstance(candidates[0], dict):
            candidate = candidates[0]
            summary["candidateFields"] = sorted(candidate)
            reason = candidate.get("finishReason")
            if isinstance(reason, str):
                summary["finishReason"] = reason
            content = candidate.get("content")
            summary["contentType"] = type(content).__name__
            if isinstance(content, dict):
                summary["contentFields"] = sorted(content)
                parts = content.get("parts")
                summary["partCount"] = len(parts) if isinstance(parts, list) else None
                if parts and isinstance(parts[0], dict):
                    summary["firstPartFields"] = sorted(parts[0])
    usage = raw.get("usageMetadata")
    if isinstance(usage, dict):
        summary["usageFields"] = sorted(usage)
        summary["usageFieldTypes"] = {key: type(value).__name__ for key, value in usage.items()}
    choices = raw.get("choices")
    if isinstance(choices, list):
        summary["choiceCount"] = len(choices)
        if choices and isinstance(choices[0], dict):
            choice = choices[0]
            summary["choiceFields"] = sorted(choice)
            summary["finishReasonPresent"] = isinstance(choice.get("finish_reason"), str)
            delta = choice.get("delta")
            summary["deltaType"] = type(delta).__name__
            if isinstance(delta, dict):
                summary["deltaFields"] = sorted(delta)
                summary["deltaFieldTypes"] = {
                    key: type(value).__name__ for key, value in delta.items()
                }
    openai_usage = raw.get("usage")
    if isinstance(openai_usage, dict):
        summary["usageFields"] = sorted(openai_usage)
        summary["usageFieldTypes"] = {
            key: type(value).__name__ for key, value in openai_usage.items()
        }
    if "id" in raw:
        summary["requestIdPresent"] = isinstance(raw.get("id"), str)
    return summary


def stream_summary(state: dict[str, Any]) -> dict[str, object]:
    """Return field-only streaming evidence for the guarded evaluator.

    This is intentionally assembled from counts and event shapes. It must never
    retain a prompt, generated text, request headers, or credentials.
    """

    return {
        "sseFrameCount": state.get("sse_frame_count", 0),
        "contentBearingFrameCount": state.get("content_frame_count", 0),
        "usageFrameCount": state.get("usage_frame_count", 0),
        "terminalFrameCount": state.get("terminal_frame_count", 0),
        "doneObserved": state.get("done_observed", False),
        "providerRequestIdObserved": state.get("request_id") is not None,
        "eventShapes": state.get("event_shapes", []),
    }


def record_stream_shape(raw: dict[str, Any], state: dict[str, Any]) -> None:
    if raw.get(SSE_DONE_EVENT) is True:
        state["done_observed"] = True
        return
    state["sse_frame_count"] = state.get("sse_frame_count", 0) + 1
    shape = event_shape(raw)
    shapes = state.setdefault("event_shapes", [])
    if isinstance(shapes, list) and shape not in shapes and len(shapes) < 8:
        shapes.append(shape)


def normalized_failure(
    plan: ProviderExecutionPlan, code: str, retryable: bool = False
) -> ProviderEvent:
    return ProviderEvent(
        type="run.failed",
        run_id=plan.request.run_id,
        code=code,
        message="Generation could not complete",
        retryable=retryable,
    )


def error_code(value: str) -> tuple[str, bool]:
    if value in {"rate_limit_error", "rate_limit_exceeded", "RESOURCE_EXHAUSTED"}:
        return "RATE_LIMITED", True
    if value in {"overloaded_error", "server_error", "api_error", "UNAVAILABLE", "INTERNAL"}:
        return "PROVIDER_TEMPORARY_ERROR", True
    if value in {"authentication_error", "invalid_api_key", "UNAUTHENTICATED", "PERMISSION_DENIED"}:
        return "PROVIDER_AUTH_FAILED", False
    return "PROVIDER_ERROR", False


class StreamingAdapter(ProviderAdapter):
    """One state object per stream; cumulative usage must never leak between concurrent runs."""

    api_url: str

    def __init__(self, enabled: bool, api_key: str | None, transport: ProviderTransport) -> None:
        self._enabled = enabled
        self._api_key = api_key
        self._transport = transport
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self.cooldown_seconds = 30.0
        self._observed: HealthStatus = "enabled"
        self._observed_at = 0.0
        self._latency: int | None = None
        self._last_diagnostic: ProviderErrorDiagnostic | None = None
        self._last_stream_summary: dict[str, object] | None = None

    def observe(self, code: str | None, latency_ms: int) -> None:
        states: dict[str, HealthStatus] = {
            "RATE_LIMITED": "rate_limited",
            "PROVIDER_TIMEOUT": "timed_out",
            # A configured key that upstream rejects is categorically different
            # from an omitted key.  Keeping this state prevents later requests
            # from being misreported as locally missing credentials.
            "PROVIDER_AUTH_FAILED": "invalid_credentials",
            "PROVIDER_TEMPORARY_ERROR": "temporarily_unhealthy",
            "NETWORK_ERROR": "temporarily_unhealthy",
            "STREAM_TRUNCATED": "temporarily_unhealthy",
            "PROVIDER_PROTOCOL_ERROR": "temporarily_unhealthy",
        }
        if code is None or code in states:
            self._observed = states.get(code or "", "available")
            self._observed_at = time.monotonic()
            self._latency = latency_ms

    async def generate(self, plan: ProviderExecutionPlan) -> tuple[str, NormalizedUsage]:
        content = ""
        usage = NormalizedUsage()
        async for event in self.stream(plan):
            if event.type == "content.delta":
                content += event.text or ""
            if event.type == "run.failed":
                raise RuntimeError("Provider generation failed")
            if event.type == "usage.updated":
                usage = NormalizedUsage(
                    input_tokens=event.input_tokens,
                    output_tokens=event.output_tokens,
                    total_tokens=event.total_tokens,
                )
        return content, usage

    async def capabilities(self, plan: ProviderExecutionPlan) -> dict[str, object]:
        return plan.model.capabilities

    async def health(self) -> ProviderHealth:
        status: HealthStatus = self._observed
        if not self._enabled:
            status = "disabled"
        elif not self._api_key:
            status = "missing_credentials"
        elif time.monotonic() - self._observed_at > (
            300 if status == "available" else self.cooldown_seconds
        ):
            status = "enabled"  # configured, but unobserved; an actual request may probe it
        return ProviderHealth(provider=self.provider, status=status, latency_ms=self._latency)

    def last_diagnostic(self) -> ProviderErrorDiagnostic | None:
        """For the guarded local evaluator; never emitted on the public API."""

        return self._last_diagnostic

    def last_stream_summary(self) -> dict[str, object] | None:
        """Field-only stream evidence for the guarded evaluator."""

        return self._last_stream_summary

    async def cancel(self, run_id: str) -> None:
        task = self._tasks.get(run_id)
        if task:
            task.cancel()

    def _url(self, plan: ProviderExecutionPlan) -> str:
        return self.api_url

    async def stream(self, plan: ProviderExecutionPlan) -> AsyncGenerator[ProviderEvent, None]:
        self._last_diagnostic = None
        self._last_stream_summary = None
        if not self._enabled or not self._api_key:
            yield normalized_failure(
                plan, "PROVIDER_DISABLED" if not self._enabled else "PROVIDER_MISSING_CREDENTIALS"
            )
            return
        if plan.model.provider != self.provider or plan.request.provider != self.provider:
            yield normalized_failure(plan, "REGISTRY_MISMATCH")
            return
        task = asyncio.current_task()
        if task:
            self._tasks[str(plan.request.run_id)] = task
        state: dict[str, Any] = {}
        try:
            yield ProviderEvent(type="run.started", run_id=plan.request.run_id)
            async with asyncio.timeout(90):
                async with aclosing(
                    self._transport.stream_sse(
                        self._url(plan), self._headers(), self._payload(plan)
                    )
                ) as upstream:
                    async for raw in upstream:
                        record_stream_shape(raw, state)
                        state["last_event_shape"] = event_shape(raw)
                        for event in self._normalize(raw, plan, state):
                            if event.type == "content.delta" and event.text:
                                state["content_frame_count"] = (
                                    state.get("content_frame_count", 0) + 1
                                )
                            if event.type == "usage.updated":
                                state["usage_frame_count"] = state.get("usage_frame_count", 0) + 1
                                state["usage_final"] = event.usage_final is not False
                                for key in ("input_tokens", "output_tokens"):
                                    value = getattr(event, key)
                                    if value is not None:
                                        if value < state.get(key, 0):
                                            raise ValueError("Usage decreased")
                                        state[key] = value
                                    setattr(event, key, state.get(key))
                                if (
                                    event.input_tokens is not None
                                    and event.output_tokens is not None
                                ):
                                    event.total_tokens = event.input_tokens + event.output_tokens
                            if event.type == "run.completed":
                                state["terminal_frame_count"] = (
                                    state.get("terminal_frame_count", 0) + 1
                                )
                                event.finish_reason = state.get(
                                    "finish_reason", event.finish_reason
                                )
                                if (
                                    "input_tokens" not in state
                                    or "output_tokens" not in state
                                    or not state.get("usage_final")
                                ):
                                    yield normalized_failure(plan, "USAGE_MISSING", True)
                                    return
                            yield event
                            if event.type in {"run.completed", "run.failed"}:
                                return
            yield normalized_failure(plan, "STREAM_TRUNCATED", True)
        except TimeoutError:
            yield normalized_failure(plan, "PROVIDER_TIMEOUT", True)
        except ProviderTransportError as error:
            self._last_diagnostic = error.diagnostic
            status = error.status_code
            code = (
                "PROVIDER_TIMEOUT"
                if status == 408
                else "RATE_LIMITED"
                if status == 429
                else "PROVIDER_AUTH_FAILED"
                if status in {401, 403}
                else "PROVIDER_UNAVAILABLE"
                if status == 404
                else "PROVIDER_TEMPORARY_ERROR"
                if status and status >= 500
                else "NETWORK_ERROR"
                if status is None
                else "PROVIDER_INVALID_REQUEST"
            )
            yield normalized_failure(
                plan,
                code,
                code
                in {
                    "PROVIDER_TIMEOUT",
                    "RATE_LIMITED",
                    "PROVIDER_TEMPORARY_ERROR",
                    "NETWORK_ERROR",
                    "PROVIDER_UNAVAILABLE",
                },
            )
        except (ValueError, TypeError, KeyError, AttributeError):
            self._last_diagnostic = ProviderErrorDiagnostic(
                http_status=None,
                provider_type="protocol",
                event_shape=state.get("last_event_shape"),
            )
            yield normalized_failure(plan, "PROVIDER_PROTOCOL_ERROR", True)
        finally:
            self._last_stream_summary = stream_summary(state)
            self._tasks.pop(str(plan.request.run_id), None)

    def _headers(self) -> dict[str, str]:
        raise NotImplementedError

    def _payload(self, plan: ProviderExecutionPlan) -> dict[str, Any]:
        raise NotImplementedError

    def _normalize(
        self, raw: dict[str, Any], plan: ProviderExecutionPlan, state: dict[str, Any]
    ) -> list[ProviderEvent]:
        raise NotImplementedError


class OpenAIAdapter(StreamingAdapter):
    provider: Literal["openai"] = "openai"
    api_url = "https://api.openai.com/v1/responses"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    def _payload(self, plan: ProviderExecutionPlan) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": plan.model.provider_model_id,
            "input": [
                {"role": item.role, "content": item.content}
                for item in plan.request.context.messages
            ],
            "max_output_tokens": plan.request.max_output_tokens,
            "stream": True,
            "store": False,
        }
        if plan.request.temperature is not None:
            body["temperature"] = plan.request.temperature
        return body

    def usage(self, payload: dict[str, Any]) -> NormalizedUsage:
        return NormalizedUsage(
            input_tokens=payload.get("input_tokens"), output_tokens=payload.get("output_tokens")
        )

    def _normalize(
        self, raw: dict[str, Any], plan: ProviderExecutionPlan, state: dict[str, Any]
    ) -> list[ProviderEvent]:
        kind = raw.get("type", "")
        response = raw.get("response", {})
        if kind == "response.output_text.delta":
            return [
                ProviderEvent(
                    type="content.delta", run_id=plan.request.run_id, text=raw.get("delta", "")
                )
            ]
        if kind == "response.created":
            return [
                ProviderEvent(
                    type="run.started",
                    run_id=plan.request.run_id,
                    provider_request_id=response.get("id"),
                )
            ]
        if kind in {"response.completed", "response.incomplete"}:
            if (
                kind == "response.incomplete"
                and (response.get("incomplete_details") or {}).get("reason") != "max_output_tokens"
            ):
                return [
                    ProviderEvent(
                        type="usage.updated",
                        run_id=plan.request.run_id,
                        usage_final=True,
                        **self.usage(response.get("usage") or {}).model_dump(exclude_none=True),
                    ),
                    normalized_failure(plan, "SAFETY_STOP"),
                ]
            usage = self.usage(response.get("usage") or {})
            return [
                ProviderEvent(
                    type="usage.updated",
                    usage_final=True,
                    run_id=plan.request.run_id,
                    **usage.model_dump(exclude_none=True),
                ),
                ProviderEvent(
                    type="run.completed",
                    run_id=plan.request.run_id,
                    finish_reason=(
                        "stop"
                        if kind == "response.completed"
                        else "length"
                        if (response.get("incomplete_details") or {}).get("reason")
                        == "max_output_tokens"
                        else "incomplete"
                    ),
                ),
            ]
        if kind in {"response.failed", "error"}:
            error = response.get("error") or raw.get("error") or raw
            code, retryable = error_code(error.get("code") or error.get("type", ""))
            return [
                ProviderEvent(
                    type="usage.updated",
                    usage_final=True,
                    run_id=plan.request.run_id,
                    **self.usage(response.get("usage") or {}).model_dump(exclude_none=True),
                ),
                normalized_failure(plan, code, retryable),
            ]
        return []


class OpenAICompatibleChatAdapter(StreamingAdapter):
    """Canonical adapter for providers that implement Chat Completions SSE.

    The transport shape is shared deliberately; provider identity, endpoint, health,
    registry entry, and persisted ModelRun remain provider-specific.
    """

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    def _payload(self, plan: ProviderExecutionPlan) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": plan.model.provider_model_id,
            "messages": [
                {"role": item.role, "content": item.content}
                for item in plan.request.context.messages
            ],
            "max_tokens": plan.request.max_output_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if plan.request.temperature is not None:
            body["temperature"] = plan.request.temperature
        return body

    def usage(self, payload: dict[str, Any]) -> NormalizedUsage:
        return NormalizedUsage(
            input_tokens=payload.get("prompt_tokens"),
            output_tokens=payload.get("completion_tokens"),
        )

    def _normalize(
        self, raw: dict[str, Any], plan: ProviderExecutionPlan, state: dict[str, Any]
    ) -> list[ProviderEvent]:
        if raw.get(SSE_DONE_EVENT) is True:
            if state.get("terminal_ready"):
                return [
                    ProviderEvent(
                        type="run.completed",
                        run_id=plan.request.run_id,
                        finish_reason=state["finish_reason"],
                    )
                ]
            return []
        if raw.get("error"):
            error = raw["error"]
            code, retryable = error_code(error.get("code") or error.get("type", ""))
            return [normalized_failure(plan, code, retryable)]
        events: list[ProviderEvent] = []
        request_id = raw.get("id")
        if request_id and not state.get("request_id"):
            state["request_id"] = request_id
            events.append(
                ProviderEvent(
                    type="run.started", run_id=plan.request.run_id, provider_request_id=request_id
                )
            )
        choices = raw.get("choices", [])
        if not isinstance(choices, list) or len(choices) > 1:
            raise ValueError("Unexpected chat completion choices")
        if choices:
            choice = choices[0]
            if not isinstance(choice, dict):
                raise ValueError("Invalid chat completion choice")
            delta = choice.get("delta", {})
            if not isinstance(delta, dict):
                raise ValueError("Invalid chat completion delta")
            text = delta.get("content")
            if text is not None and not isinstance(text, str):
                raise ValueError("Invalid chat completion content")
            if text:
                events.append(
                    ProviderEvent(type="content.delta", run_id=plan.request.run_id, text=text)
                )
            reason = choice.get("finish_reason")
            if reason is not None and not isinstance(reason, str):
                raise ValueError("Invalid chat completion finish reason")
            if reason:
                state["finish_reason"] = "length" if reason == "length" else reason
        if raw.get("usage") is not None:
            if not isinstance(raw["usage"], dict):
                raise ValueError("Invalid chat completion usage")
            usage = self.usage(raw["usage"])
            state["usage"] = usage
            events.append(
                ProviderEvent(
                    type="usage.updated",
                    usage_final=bool(state.get("finish_reason")),
                    run_id=plan.request.run_id,
                    **usage.model_dump(exclude_none=True),
                )
            )
        if state.get("finish_reason"):
            if state["finish_reason"] in {"content_filter", "safety"}:
                events.append(normalized_failure(plan, "SAFETY_STOP"))
            elif state.get("usage"):
                # OpenAI-compatible providers may send finish_reason, the final
                # usage-only chunk, then [DONE] as three separate SSE frames.
                # Keep the canonical terminal event pending until the explicit
                # stream terminator is parsed instead of completing prematurely.
                if raw.get("usage") is None:
                    usage = state["usage"]
                    if isinstance(usage, NormalizedUsage):
                        events.append(
                            ProviderEvent(
                                type="usage.updated",
                                usage_final=True,
                                run_id=plan.request.run_id,
                                **usage.model_dump(exclude_none=True),
                            )
                        )
                state["terminal_ready"] = True
        return events


class GroqAdapter(OpenAICompatibleChatAdapter):
    provider: Literal["groq"] = "groq"
    api_url = "https://api.groq.com/openai/v1/chat/completions"


class OpenRouterAdapter(OpenAICompatibleChatAdapter):
    provider: Literal["openrouter"] = "openrouter"
    api_url = "https://openrouter.ai/api/v1/chat/completions"


class AnthropicAdapter(StreamingAdapter):
    provider: Literal["anthropic"] = "anthropic"
    api_url = "https://api.anthropic.com/v1/messages"

    def __init__(self, version: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._version = version

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": str(self._api_key),
            "anthropic-version": self._version,
            "Content-Type": "application/json",
        }

    def _payload(self, plan: ProviderExecutionPlan) -> dict[str, Any]:
        system = "\n\n".join(
            item.content for item in plan.request.context.messages if item.role == "system"
        )
        body: dict[str, Any] = {
            "model": plan.model.provider_model_id,
            "messages": [
                {"role": item.role, "content": item.content}
                for item in plan.request.context.messages
                if item.role != "system"
            ],
            "max_tokens": plan.request.max_output_tokens,
            "stream": True,
        }
        if system:
            body["system"] = system
        if plan.request.temperature is not None:
            body["temperature"] = plan.request.temperature
        return body

    def usage(self, payload: dict[str, Any]) -> NormalizedUsage:
        return NormalizedUsage(
            input_tokens=payload.get("input_tokens"), output_tokens=payload.get("output_tokens")
        )

    def _normalize(
        self, raw: dict[str, Any], plan: ProviderExecutionPlan, state: dict[str, Any]
    ) -> list[ProviderEvent]:
        kind = raw.get("type", "")
        if kind == "message_start":
            message = raw.get("message", {})
            return [
                ProviderEvent(
                    type="run.started",
                    run_id=plan.request.run_id,
                    provider_request_id=message.get("id"),
                ),
                ProviderEvent(
                    type="usage.updated",
                    usage_final=False,
                    run_id=plan.request.run_id,
                    **self.usage(message.get("usage") or {}).model_dump(exclude_none=True),
                ),
            ]
        if kind == "content_block_delta":
            return [
                ProviderEvent(
                    type="content.delta",
                    run_id=plan.request.run_id,
                    text=raw.get("delta", {}).get("text", ""),
                )
            ]
        if kind == "message_delta":
            reason = raw.get("delta", {}).get("stop_reason")
            if reason:
                state["finish_reason"] = (
                    "length"
                    if reason == "max_tokens"
                    else "stop"
                    if reason in {"end_turn", "stop_sequence"}
                    else reason
                )
            usage = self.usage(raw.get("usage", {}))
            return [
                ProviderEvent(
                    type="usage.updated",
                    usage_final=bool(reason) and "output_tokens" in raw.get("usage", {}),
                    run_id=plan.request.run_id,
                    **usage.model_dump(exclude_none=True),
                )
            ]
        if kind == "message_stop":
            if state.get("finish_reason") not in {"stop", "length"}:
                return [
                    normalized_failure(
                        plan,
                        "SAFETY_STOP"
                        if state.get("finish_reason") == "refusal"
                        else "PROVIDER_PROTOCOL_ERROR",
                    )
                ]
            return [
                ProviderEvent(
                    type="run.completed", run_id=plan.request.run_id, finish_reason="stop"
                )
            ]
        if kind == "error":
            code, retryable = error_code(raw.get("error", {}).get("type", ""))
            return [normalized_failure(plan, code, retryable)]
        return []


class GeminiAdapter(StreamingAdapter):
    provider: Literal["gemini"] = "gemini"
    api_url = "https://generativelanguage.googleapis.com/v1beta/models"

    def _url(self, plan: ProviderExecutionPlan) -> str:
        model = quote(plan.model.provider_model_id, safe="")
        return f"{self.api_url}/{model}:streamGenerateContent?alt=sse"

    def _headers(self) -> dict[str, str]:
        return {"x-goog-api-key": str(self._api_key), "Content-Type": "application/json"}

    def _payload(self, plan: ProviderExecutionPlan) -> dict[str, Any]:
        body: dict[str, Any] = {
            "contents": [
                {
                    "role": "model" if m.role == "assistant" else "user",
                    "parts": [{"text": m.content}],
                }
                for m in plan.request.context.messages
                if m.role != "system"
            ],
            "generationConfig": {
                "maxOutputTokens": plan.request.max_output_tokens,
                "candidateCount": 1,
            },
        }
        systems = [m.content for m in plan.request.context.messages if m.role == "system"]
        if systems:
            body["systemInstruction"] = {"parts": [{"text": "\n\n".join(systems)}]}
        if plan.request.temperature is not None:
            body["generationConfig"]["temperature"] = plan.request.temperature
        return body

    def usage(self, payload: dict[str, Any]) -> NormalizedUsage:
        output = payload.get("candidatesTokenCount")
        if output is not None:
            output += payload.get("thoughtsTokenCount", 0)
        return NormalizedUsage(input_tokens=payload.get("promptTokenCount"), output_tokens=output)

    def _normalize(
        self, raw: dict[str, Any], plan: ProviderExecutionPlan, state: dict[str, Any]
    ) -> list[ProviderEvent]:
        events = []
        if raw.get("responseId") and not state.get("request_id"):
            state["request_id"] = raw["responseId"]
            events.append(
                ProviderEvent(
                    type="run.started",
                    run_id=plan.request.run_id,
                    provider_request_id=raw["responseId"],
                )
            )
        if raw.get("error"):
            code, retryable = error_code(raw["error"].get("status", ""))
            return [normalized_failure(plan, code, retryable)]
        if raw.get("promptFeedback", {}).get("blockReason"):
            return [normalized_failure(plan, "SAFETY_STOP")]
        candidates = raw.get("candidates", [])
        if len(candidates) > 1:
            raise ValueError("Unexpected candidates")
        for candidate in candidates:
            for part in candidate.get("content", {}).get("parts", []):
                if part.get("text") and not part.get("thought"):
                    events.append(
                        ProviderEvent(
                            type="content.delta", run_id=plan.request.run_id, text=part["text"]
                        )
                    )
            reason = candidate.get("finishReason")
            if reason:
                state["finish_reason"] = (
                    "stop" if reason == "STOP" else "length" if reason == "MAX_TOKENS" else "safety"
                )
        if "usageMetadata" in raw:
            events.append(
                ProviderEvent(
                    type="usage.updated",
                    usage_final=bool(state.get("finish_reason"))
                    and "candidatesTokenCount" in raw["usageMetadata"],
                    run_id=plan.request.run_id,
                    **self.usage(raw["usageMetadata"]).model_dump(exclude_none=True),
                )
            )
        if state.get("finish_reason"):
            if state["finish_reason"] == "safety":
                events.append(normalized_failure(plan, "SAFETY_STOP"))
            elif "usageMetadata" in raw:
                events.append(
                    ProviderEvent(
                        type="run.completed",
                        run_id=plan.request.run_id,
                        finish_reason=state["finish_reason"],
                    )
                )
        return events
