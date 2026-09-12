import asyncio
import importlib.util
import json
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any, cast

from test_provider_contracts import MockTransport

from app.config import Settings
from app.contracts import ProviderHealth
from app.providers.base import provider_transport_error
from app.providers.registry import ProviderRegistry


def load_evaluator() -> Any:
    path = Path(__file__).resolve().parents[1] / "scripts" / "evaluate_providers.py"
    spec = importlib.util.spec_from_file_location("evaluate_providers_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_upstream_diagnostic_redacts_request_contents_and_credentials() -> None:
    key = "AIzaThisIsASyntheticGoogleKey123456789"
    prompt = "private prompt that must never be reported"
    error = provider_transport_error(
        400,
        json.dumps(
            {
                "error": {
                    "code": 400,
                    "status": "INVALID_ARGUMENT",
                    "message": f"Bad request: {prompt}; Authorization: Bearer {key}",
                }
            }
        ).encode(),
        {"x-goog-api-key": key, "Authorization": f"Bearer {key}"},
        {"contents": [{"parts": [{"text": prompt}]}]},
    )

    diagnostic = error.diagnostic
    assert diagnostic is not None
    assert diagnostic.http_status == 400
    assert diagnostic.provider_status == "INVALID_ARGUMENT"
    assert diagnostic.message is not None and "[redacted]" in diagnostic.message
    assert key not in repr(error)
    assert prompt not in repr(error)


def test_guarded_evaluation_report_never_contains_the_key_or_prompt() -> None:
    evaluator = load_evaluator()
    key = "AIzaSyntheticReportKey123456789012345"
    prompt = "private evaluation prompt"

    class ErrorTransport(MockTransport):
        async def stream_sse(
            self, url: str, headers: dict[str, str], body: dict[str, Any]
        ) -> AsyncGenerator[dict[str, Any], None]:
            raise provider_transport_error(
                401,
                json.dumps(
                    {"error": {"message": f"rejected {key}; echoed {prompt}", "type": "auth"}}
                ).encode(),
                headers,
                body,
            )
            yield {}

    async def run() -> dict[str, object]:
        settings = Settings(
            enable_gemini=True,
            gemini_api_key=key,
            enable_openai=False,
            enable_anthropic=False,
            enable_groq=False,
            enable_openrouter=False,
        )
        return cast(
            dict[str, object],
            await evaluator.run_case(
                ProviderRegistry(settings, ErrorTransport([])),
                settings,
                "gemini",
                evaluator.candidate("gemini"),
                "general",
                prompt,
                ("never",),
            ),
        )

    report = json.dumps(asyncio.run(run()))
    assert key not in report
    assert prompt not in report
    assert "[redacted]" in report


def test_evaluator_blocks_on_the_first_permanent_configuration_failure(
    monkeypatch: Any,
) -> None:
    evaluator = load_evaluator()
    calls = 0

    class ReadyRegistry:
        def __init__(self, _: object) -> None:
            pass

        async def health(self) -> list[ProviderHealth]:
            return [ProviderHealth(provider="gemini", status="enabled")]

    async def rejected(*_: object, **__: object) -> dict[str, object]:
        nonlocal calls
        calls += 1
        return {
            "category": "general",
            "success": False,
            "failureCode": "PROVIDER_AUTH_FAILED",
            "totalLatencyMs": 12,
            "diagnostic": {"httpStatus": 401, "message": "invalid key"},
        }

    monkeypatch.setattr(evaluator, "ProviderRegistry", ReadyRegistry)
    monkeypatch.setattr(evaluator, "run_case", rejected)
    result = asyncio.run(evaluator.evaluate("gemini", timeout_probe=True))

    assert calls == 1
    assert result["status"] == "BLOCKED"
    assert result["blockedBy"] == "PROVIDER_AUTH_FAILED"
    assert result["requests"] == 1
    assert result["taskScores"] is None
    assert result["qualityScore"] is None
    assert result["timeoutProbe"] is None
