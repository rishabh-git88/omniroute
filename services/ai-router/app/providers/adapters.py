from collections.abc import AsyncIterator
from typing import Any, Literal

from app.contracts import NormalizedUsage, ProviderEvent, ProviderExecutionPlan, ProviderHealth
from app.providers.base import ProviderAdapter, ProviderTransport, ProviderTransportError


class StreamingAdapter(ProviderAdapter):
    """Common lifecycle and local cancellation; subclasses only translate provider wire shapes."""

    api_url: str

    def __init__(self, enabled: bool, api_key: str | None, transport: ProviderTransport) -> None:
        self._enabled = enabled
        self._api_key = api_key
        self._transport = transport
        self._cancelled: set[str] = set()

    async def generate(self, plan: ProviderExecutionPlan) -> tuple[str, NormalizedUsage]:
        content = ""
        usage = NormalizedUsage()
        async for event in self.stream(plan):
            if event.type == "content.delta":
                content += event.text or ""
            if event.type == "usage.updated":
                usage = NormalizedUsage(
                    input_tokens=event.input_tokens, output_tokens=event.output_tokens
                )
        return content, usage

    async def capabilities(self, plan: ProviderExecutionPlan) -> dict[str, object]:
        self._validate(plan)
        return plan.model.capabilities

    async def health(self) -> ProviderHealth:
        return ProviderHealth(
            provider=self.provider,
            status="ready" if self._enabled and self._api_key else "disabled",
        )

    async def cancel(self, run_id: str) -> None:
        self._cancelled.add(run_id)

    async def stream(self, plan: ProviderExecutionPlan) -> AsyncIterator[ProviderEvent]:
        self._validate(plan)
        yield ProviderEvent(type="run.started", run_id=plan.request.run_id)
        try:
            async for raw in self._transport.stream_sse(
                self.api_url, self._headers(), self._payload(plan)
            ):
                if str(plan.request.run_id) in self._cancelled:
                    self._cancelled.discard(str(plan.request.run_id))
                    yield ProviderEvent(
                        type="run.failed",
                        run_id=plan.request.run_id,
                        code="CANCELLED",
                        message="Generation cancelled",
                        retryable=False,
                    )
                    return
                for event in self._normalize(raw, plan):
                    yield event
        except ProviderTransportError as error:
            yield ProviderEvent(
                type="run.failed",
                run_id=plan.request.run_id,
                code=f"HTTP_{error.status_code}" if error.status_code else "NETWORK_ERROR",
                message=error.safe_message,
                retryable=error.status_code is None or error.status_code >= 500,
            )

    def _validate(self, plan: ProviderExecutionPlan) -> None:
        if not self._enabled or not self._api_key:
            raise RuntimeError(f"{self.provider} is disabled or has no server-side credential")
        if plan.model.provider != self.provider or plan.request.provider != self.provider:
            raise ValueError("Registry provider does not match the requested adapter")

    def _headers(self) -> dict[str, str]:
        raise NotImplementedError

    def _payload(self, plan: ProviderExecutionPlan) -> dict[str, Any]:
        raise NotImplementedError

    def _normalize(self, raw: dict[str, Any], plan: ProviderExecutionPlan) -> list[ProviderEvent]:
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
        }
        if plan.request.temperature is not None:
            body["temperature"] = plan.request.temperature
        return body

    def usage(self, payload: dict[str, Any]) -> NormalizedUsage:
        return NormalizedUsage(
            input_tokens=payload.get("input_tokens"), output_tokens=payload.get("output_tokens")
        )

    def _normalize(self, raw: dict[str, Any], plan: ProviderExecutionPlan) -> list[ProviderEvent]:
        kind = raw.get("type", "")
        response = raw.get("response", {})
        if kind == "response.output_text.delta":
            return [
                ProviderEvent(
                    type="content.delta", run_id=plan.request.run_id, text=raw.get("delta", "")
                )
            ]
        if kind == "response.completed":
            usage = self.usage(response.get("usage", {}))
            return [
                ProviderEvent(
                    type="usage.updated",
                    run_id=plan.request.run_id,
                    **usage.model_dump(exclude_none=True),
                ),
                ProviderEvent(
                    type="run.completed", run_id=plan.request.run_id, finish_reason="stop"
                ),
            ]
        if kind == "response.failed":
            return [
                ProviderEvent(
                    type="run.failed",
                    run_id=plan.request.run_id,
                    code="OPENAI_ERROR",
                    message="OpenAI generation failed",
                    retryable=False,
                )
            ]
        return []


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

    def _normalize(self, raw: dict[str, Any], plan: ProviderExecutionPlan) -> list[ProviderEvent]:
        kind = raw.get("type", "")
        if kind == "content_block_delta":
            return [
                ProviderEvent(
                    type="content.delta",
                    run_id=plan.request.run_id,
                    text=raw.get("delta", {}).get("text", ""),
                )
            ]
        if kind == "message_delta":
            usage = self.usage(raw.get("usage", {}))
            return [
                ProviderEvent(
                    type="usage.updated",
                    run_id=plan.request.run_id,
                    **usage.model_dump(exclude_none=True),
                )
            ]
        if kind == "message_stop":
            return [
                ProviderEvent(
                    type="run.completed", run_id=plan.request.run_id, finish_reason="stop"
                )
            ]
        if kind == "error":
            return [
                ProviderEvent(
                    type="run.failed",
                    run_id=plan.request.run_id,
                    code="ANTHROPIC_ERROR",
                    message="Anthropic generation failed",
                    retryable=False,
                )
            ]
        return []


class GeminiAdapter(StreamingAdapter):
    provider: Literal["gemini"] = "gemini"
    api_url = "https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse"

    def _headers(self) -> dict[str, str]:
        return {"x-goog-api-key": str(self._api_key), "Content-Type": "application/json"}

    def _payload(self, plan: ProviderExecutionPlan) -> dict[str, Any]:
        return {
            "model": plan.model.provider_model_id,
            "input": [
                {"role": item.role, "content": item.content}
                for item in plan.request.context.messages
            ],
            "stream": True,
        }

    def usage(self, payload: dict[str, Any]) -> NormalizedUsage:
        return NormalizedUsage(
            input_tokens=payload.get("input_tokens"), output_tokens=payload.get("output_tokens")
        )

    def _normalize(self, raw: dict[str, Any], plan: ProviderExecutionPlan) -> list[ProviderEvent]:
        kind = raw.get("event_type", "")
        if kind == "step.delta":
            text = raw.get("delta", {}).get("content", {}).get("text", "")
            return (
                [ProviderEvent(type="content.delta", run_id=plan.request.run_id, text=text)]
                if text
                else []
            )
        if kind == "interaction.completed":
            usage = self.usage(raw.get("usage", {}))
            return [
                ProviderEvent(
                    type="usage.updated",
                    run_id=plan.request.run_id,
                    **usage.model_dump(exclude_none=True),
                ),
                ProviderEvent(
                    type="run.completed", run_id=plan.request.run_id, finish_reason="stop"
                ),
            ]
        if kind == "interaction.failed":
            return [
                ProviderEvent(
                    type="run.failed",
                    run_id=plan.request.run_id,
                    code="GEMINI_ERROR",
                    message="Gemini generation failed",
                    retryable=False,
                )
            ]
        return []
