"""Async sockets close on task cancellation; no blocking urllib worker survives a run."""

import json
from collections.abc import AsyncGenerator
from typing import Any, cast

import httpx

from app.providers.base import ProviderTransportError


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
            raise ProviderTransportError(
                error.response.status_code, "Provider request failed"
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
                    response.raise_for_status()
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
                            if data and data != b"[DONE]":
                                value = json.loads(data)
                                if not isinstance(value, dict):
                                    raise ValueError("Invalid provider event")
                                yield value
        except httpx.HTTPStatusError as error:
            raise ProviderTransportError(
                error.response.status_code, "Provider request failed"
            ) from error
        except httpx.TimeoutException as error:
            raise TimeoutError("Provider timed out") from error
        except httpx.HTTPError as error:
            raise ProviderTransportError(None, "Provider connection failed") from error
