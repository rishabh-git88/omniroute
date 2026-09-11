import asyncio
import json
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
            raise ProviderTransportError(error.code, "Provider request failed") from error
        except URLError as error:
            raise ProviderTransportError(None, "Provider network request failed") from error

    async def _stream(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> AsyncGenerator[dict[str, Any], None]:
        request = Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            response = await asyncio.to_thread(urlopen, request, timeout=90)  # noqa: S310
        except HTTPError as error:
            raise ProviderTransportError(error.code, "Provider request failed") from error
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
class ProviderTransportError(Exception):
    status_code: int | None
    safe_message: str


class ProviderAdapter(ABC):
    """The one provider-neutral execution contract used by router orchestration."""

    provider: Literal["openai", "anthropic", "gemini"]

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
