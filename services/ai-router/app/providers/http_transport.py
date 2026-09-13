"""Async sockets close on task cancellation; no blocking urllib worker survives a run."""

import json
from collections.abc import AsyncGenerator
from typing import Any, cast

import httpx

from app.providers.base import SSE_DONE_EVENT, ProviderTransportError, provider_transport_error


class HttpTransport:
    async def post_json(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(
                timeout=90, follow_redirects=False, trust_env=False
            ) as client:
                response = await client.post(url, headers=headers, json=body)
                response.raise_for_status()
                return cast(dict[str, Any], response.json())
        except httpx.HTTPStatusError as error:
            raise provider_transport_error(
                error.response.status_code,
                error.response.content,
                headers,
                body,
                dict(error.response.headers),
            ) from error
        except httpx.TimeoutException as error:
            raise TimeoutError("Provider timed out") from error
        except httpx.HTTPError as error:
            raise ProviderTransportError(None, "Provider connection failed") from error

    async def stream_sse(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> AsyncGenerator[dict[str, Any], None]:
        try:
            async with httpx.AsyncClient(
                timeout=90, follow_redirects=False, trust_env=False
            ) as client:
                async with client.stream("POST", url, headers=headers, json=body) as response:
                    if response.is_error:
                        # Streaming responses have not been read when an HTTP status
                        # error occurs. Read the bounded error body before normalizing
                        # it; accessing ``response.content`` before this raises
                        # httpx.ResponseNotRead and used to become a protocol failure.
                        content = await response.aread()
                        raise provider_transport_error(
                            response.status_code, content, headers, body, dict(response.headers)
                        )
                    if "text/event-stream" not in response.headers.get("content-type", ""):
                        raise ValueError("Invalid provider stream")
                    buffer = b""
                    async for chunk in response.aiter_bytes():
                        buffer += chunk
                        if len(buffer) > 262144:
                            raise ValueError("Provider frame too large")
                        buffer = buffer.replace(b"\r\n", b"\n")
                        while b"\n\n" in buffer:
                            frame, buffer = buffer.split(b"\n\n", 1)
                            data = b"\n".join(
                                line[5:].lstrip()
                                for line in frame.split(b"\n")
                                if line.startswith(b"data:")
                            )
                            if data == b"[DONE]":
                                yield {SSE_DONE_EVENT: True}
                            elif data:
                                value = json.loads(data)
                                if not isinstance(value, dict):
                                    raise ValueError("Invalid provider event")
                                yield value
        except httpx.HTTPStatusError as error:
            raise provider_transport_error(
                error.response.status_code,
                error.response.content,
                headers,
                body,
                dict(error.response.headers),
            ) from error
        except httpx.TimeoutException as error:
            raise TimeoutError("Provider timed out") from error
        except httpx.HTTPError as error:
            raise ProviderTransportError(None, "Provider connection failed") from error
