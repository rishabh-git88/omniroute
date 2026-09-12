import asyncio
import json
import re
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.contracts import (
    NormalizedUsage,
    ProviderEvent,
    ProviderExecutionPlan,
    ProviderHealth,
)


class ProviderTransport(Protocol):
    async def post_json(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> dict[str, Any]: ...

    def stream_sse(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> AsyncGenerator[dict[str, Any], None]: ...


class UrllibTransport:
    """Small server-only transport; values are never logged, including authorization headers."""

    async def post_json(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> dict[str, Any]:
        return await asyncio.to_thread(self._json_request, url, headers, body)

    def stream_sse(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> AsyncGenerator[dict[str, Any], None]:
        return self._stream(url, headers, body)

    @staticmethod
    def _json_request(url: str, headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
        request = Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urlopen(request, timeout=60) as response:  # noqa: S310 -- adapter URLs are constants
                return cast(dict[str, Any], json.loads(response.read()))
        except HTTPError as error:
            raise provider_transport_error(error.code, error.read(), headers, body) from error
        except URLError as error:
            raise ProviderTransportError(None, "Provider network request failed") from error

    async def _stream(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> AsyncGenerator[dict[str, Any], None]:
        request = Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            response = await asyncio.to_thread(urlopen, request, timeout=90)  # noqa: S310
        except HTTPError as error:
            raise provider_transport_error(error.code, error.read(), headers, body) from error
        except URLError as error:
            raise ProviderTransportError(None, "Provider network request failed") from error
        try:
            while line := await asyncio.to_thread(response.readline):
                if line.startswith(b"data:"):
                    payload = line.removeprefix(b"data:").strip()
                    if payload and payload != b"[DONE]":
                        yield json.loads(payload)
        finally:
            response.close()


@dataclass(frozen=True)
class ProviderErrorDiagnostic:
    """Redacted upstream details for the guarded evaluation command only."""

    http_status: int | None
    provider_code: str | int | None = None
    provider_type: str | None = None
    provider_status: str | None = None
    message: str | None = None


@dataclass(frozen=True)
class ProviderTransportError(Exception):
    status_code: int | None
    safe_message: str
    diagnostic: ProviderErrorDiagnostic | None = None


def _sensitive_values(headers: dict[str, str], body: dict[str, Any]) -> list[str]:
    """Return values which must not survive an upstream error echo."""

    values = [
        value
        for key, value in headers.items()
        if key.lower() in {"authorization", "x-goog-api-key"}
    ]

    def collect(value: object) -> None:
        if isinstance(value, str):
            values.append(value)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    collect(body)
    return sorted((value for value in values if value), key=len, reverse=True)


def _sanitize_message(value: object, sensitive: list[str]) -> str | None:
    if not isinstance(value, str):
        return None
    text = value
    for secret in sensitive:
        text = text.replace(secret, "[redacted]")
    # Defense in depth for common credential representations not present in a body.
    text = re.sub(r"(?i)(authorization|x-goog-api-key)\s*[:=]\s*[^,\s]+", r"\1: [redacted]", text)
    text = re.sub(r"(?i)bearer\s+[^,\s]+", "Bearer [redacted]", text)
    text = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "[redacted]", text)
    text = " ".join(text.split())
    return text[:500] or None


def provider_transport_error(
    status_code: int,
    response_body: bytes,
    headers: dict[str, str],
    request_body: dict[str, Any],
) -> ProviderTransportError:
    """Extract a deliberately small, redacted diagnostic from an HTTP error body."""

    sensitive = _sensitive_values(headers, request_body)
    try:
        payload = json.loads(response_body[:65536])
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {}
    detail = payload.get("error", payload) if isinstance(payload, dict) else {}
    if not isinstance(detail, dict):
        detail = {}
    diagnostic = ProviderErrorDiagnostic(
        http_status=status_code,
        provider_code=detail.get("code") if isinstance(detail.get("code"), (str, int)) else None,
        provider_type=detail.get("type") if isinstance(detail.get("type"), str) else None,
        provider_status=detail.get("status") if isinstance(detail.get("status"), str) else None,
        message=_sanitize_message(detail.get("message"), sensitive),
    )
    return ProviderTransportError(status_code, "Provider request failed", diagnostic)


class ProviderAdapter(ABC):
    """The one provider-neutral execution contract used by router orchestration."""

    provider: Literal["openai", "anthropic", "gemini", "groq", "openrouter"]

    @abstractmethod
    async def generate(self, plan: ProviderExecutionPlan) -> tuple[str, NormalizedUsage]: ...

    @abstractmethod
    def stream(self, plan: ProviderExecutionPlan) -> AsyncGenerator[ProviderEvent, None]: ...

    @abstractmethod
    async def capabilities(self, plan: ProviderExecutionPlan) -> dict[str, object]: ...

    @abstractmethod
    def usage(self, payload: dict[str, Any]) -> NormalizedUsage: ...

    @abstractmethod
    async def health(self) -> ProviderHealth: ...

    @abstractmethod
    async def cancel(self, run_id: str) -> None: ...
