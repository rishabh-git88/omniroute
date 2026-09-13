import asyncio
import importlib.util
import json
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any, cast

import pytest
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


def test_rate_limit_diagnostic_retains_only_numeric_retry_after() -> None:
    error = provider_transport_error(
        429,
        b'{"error":{"type":"rate_limit_error"}}',
        {},
        {},
        {"Retry-After": "3.5", "X-Unsafe": "ignored"},
    )

    assert error.diagnostic is not None
    assert error.diagnostic.retry_after_seconds == 3.5


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


def test_evaluator_stops_after_a_protocol_incompatibility_with_safe_shape(
    monkeypatch: Any,
) -> None:
    evaluator = load_evaluator()
    calls = 0

    class ReadyRegistry:
        def __init__(self, _: object) -> None:
            pass

        async def health(self) -> list[ProviderHealth]:
            return [ProviderHealth(provider="gemini", status="enabled")]

    async def incompatible(*_: object, **__: object) -> dict[str, object]:
        nonlocal calls
        calls += 1
        return {
            "category": "general",
            "success": False,
            "failureCode": "PROVIDER_PROTOCOL_ERROR",
            "totalLatencyMs": 12,
            "diagnostic": {
                "eventShape": {
                    "topLevelFields": ["candidates", "usageMetadata"],
                    "candidateCount": 1,
                }
            },
        }

    monkeypatch.setattr(evaluator, "ProviderRegistry", ReadyRegistry)
    monkeypatch.setattr(evaluator, "run_case", incompatible)
    result = asyncio.run(evaluator.evaluate("gemini", timeout_probe=True))

    assert calls == 1
    assert result["status"] == "INVALID_EVALUATION"
    assert result["blockedBy"] == "PROVIDER_PROTOCOL_ERROR"
    assert result["requests"] == 1
    assert result["taskScores"] is None
    assert result["qualityScore"] is None
    assert result["timeoutProbe"] is None


def test_evaluator_selects_current_immutable_candidates() -> None:
    evaluator = load_evaluator()

    gemini = evaluator.candidate("gemini")
    assert (
        gemini["provider"],
        gemini["modelKey"],
        gemini["providerModelId"],
        gemini["registryVersion"],
    ) == ("gemini", "gemini:gemini-3.5-flash", "gemini-3.5-flash", 1)

    openrouter = evaluator.candidate("openrouter")
    assert (
        openrouter["provider"],
        openrouter["modelKey"],
        openrouter["providerModelId"],
        openrouter["registryVersion"],
    ) == (
        "openrouter",
        "openrouter:liquid-lfm-2.5-2.6b:free",
        "liquid/lfm-2.5-2.6b:free",
        1,
    )


def test_evaluator_refuses_routing_metadata_without_complete_streaming_evidence() -> None:
    evaluator = load_evaluator()
    model = evaluator.candidate("openrouter")
    result = {
        "category": "general",
        "success": True,
        "streamingCorrect": False,
        "totalLatencyMs": 10,
        "usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
        "acceptanceChecks": {"passed": 1, "total": 1},
    }

    report = evaluator.report(
        "openrouter",
        model,
        [result] * len(evaluator.CASES),
        "PROVIDER_TIMEOUT",
        "COMPLETED",
        None,
        [result] * len(evaluator.CASES),
    )

    assert report["status"] == "INCOMPLETE"
    assert report["taskScores"] is None
    assert report["qualityScore"] is None


def valid_case(evaluator: Any, case_id: str, category: str, latency: int = 10) -> dict[str, object]:
    return {
        "caseId": case_id,
        "category": category,
        "success": True,
        "streamingCorrect": True,
        "totalLatencyMs": latency,
        "firstTokenLatencyMs": 1,
        "usage": {"inputTokens": 1, "outputTokens": 2, "totalTokens": 3},
        "finishReason": "stop",
        "failureCode": None,
        "acceptanceChecks": {"passed": 1, "total": 1},
    }


def test_evaluator_resumes_only_unfinished_cases_and_excludes_operator_sleep(
    monkeypatch: Any,
) -> None:
    evaluator = load_evaluator()
    model = evaluator.candidate("gemini")
    first_case = evaluator.CASES[0]
    calls: list[str] = []
    sleeps: list[float] = []

    class ReadyRegistry:
        def __init__(self, _: object) -> None:
            pass

        async def health(self) -> list[ProviderHealth]:
            return [ProviderHealth(provider="gemini", status="enabled")]

    async def fake_run_case(*args: object, **kwargs: object) -> dict[str, object]:
        case_id = kwargs["case_id"]
        category = args[4]
        assert isinstance(case_id, str) and isinstance(category, str)
        calls.append(case_id)
        return valid_case(evaluator, case_id, category, latency=23)

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    checkpoint = {
        "evaluationSchemaVersion": 2,
        "provider": "gemini",
        "modelKey": model["modelKey"],
        "providerModelId": model["providerModelId"],
        "registryVersion": model["registryVersion"],
        "attemptHistory": [
            {
                "caseId": first_case[0],
                "attempt": 1,
                "result": valid_case(evaluator, first_case[0], first_case[1], latency=11),
            }
        ],
    }
    monkeypatch.setattr(evaluator, "ProviderRegistry", ReadyRegistry)
    monkeypatch.setattr(evaluator, "run_case", fake_run_case)

    result = asyncio.run(
        evaluator.evaluate(
            "gemini",
            timeout_probe=False,
            resume=checkpoint,
            options=evaluator.EvaluationOptions(delay_seconds=7, max_evaluation_seconds=60),
            sleep=fake_sleep,
        )
    )

    assert first_case[0] not in calls
    assert len(calls) == len(evaluator.CASES) - 1
    assert result["status"] == "COMPLETED"
    assert result["typicalLatencyMs"] == 23
    assert sleeps and all(value == 7 for value in sleeps)


def test_evaluator_rejects_resume_for_a_different_model_or_registry_version() -> None:
    evaluator = load_evaluator()
    model = evaluator.candidate("openrouter")
    checkpoint = {
        "evaluationSchemaVersion": 2,
        "provider": "openrouter",
        "modelKey": model["modelKey"],
        "providerModelId": "different-model",
        "registryVersion": model["registryVersion"],
        "attemptHistory": [],
    }

    with pytest.raises(ValueError, match="providerModelId"):
        evaluator.normalize_checkpoint(checkpoint, "openrouter", model)

    checkpoint["providerModelId"] = model["providerModelId"]
    checkpoint["registryVersion"] = 2
    with pytest.raises(ValueError, match="registryVersion"):
        evaluator.normalize_checkpoint(checkpoint, "openrouter", model)


def test_evaluator_rate_limit_retries_are_bounded_and_honor_retry_after(monkeypatch: Any) -> None:
    evaluator = load_evaluator()
    calls = 0
    waits: list[float] = []

    class ReadyRegistry:
        def __init__(self, _: object) -> None:
            pass

        async def health(self) -> list[ProviderHealth]:
            return [ProviderHealth(provider="gemini", status="enabled")]

    async def limited(*args: object, **kwargs: object) -> dict[str, object]:
        nonlocal calls
        calls += 1
        return {
            "caseId": kwargs["case_id"],
            "category": args[4],
            "success": False,
            "streamingCorrect": False,
            "totalLatencyMs": 5,
            "usage": {"inputTokens": None, "outputTokens": None, "totalTokens": None},
            "finishReason": None,
            "failureCode": "RATE_LIMITED",
            "diagnostic": {"retryAfterSeconds": 4.0},
            "acceptanceChecks": {"passed": 0, "total": 1},
        }

    async def fake_sleep(seconds: float) -> None:
        waits.append(seconds)

    monkeypatch.setattr(evaluator, "ProviderRegistry", ReadyRegistry)
    monkeypatch.setattr(evaluator, "run_case", limited)
    result = asyncio.run(
        evaluator.evaluate(
            "gemini",
            timeout_probe=False,
            options=evaluator.EvaluationOptions(
                delay_seconds=0,
                rate_limit_cooldown_seconds=2,
                max_retries=1,
                max_attempts_per_case=2,
                max_evaluation_seconds=60,
            ),
            sleep=fake_sleep,
        )
    )

    assert calls == len(evaluator.CASES) * 2
    assert result["status"] == "INCOMPLETE"
    assert result["rateLimitAttempts"] == calls
    assert result["retryableFailedAttempts"] == calls
    assert 4.0 in waits


def test_openrouter_streaming_evidence_has_no_content_or_credentials() -> None:
    evaluator = load_evaluator()
    stream: list[dict[str, Any]] = [
        {"id": "request-1", "choices": [{"delta": {"role": "assistant"}}]},
        {"id": "request-1", "choices": [{"delta": {}, "finish_reason": "length"}]},
        {
            "id": "request-1",
            "choices": [],
            "usage": {"prompt_tokens": 10, "completion_tokens": 128},
        },
    ]
    settings = Settings(enable_openrouter=True, openrouter_api_key="openrouter-secret")

    result = asyncio.run(
        evaluator.run_case(
            ProviderRegistry(settings, MockTransport(stream)),
            settings,
            "openrouter",
            evaluator.candidate("openrouter"),
            "coding",
            "private prompt",
            ("not-present",),
            case_id="04-coding",
        )
    )

    serialized = json.dumps(result)
    assert result["success"] is True
    assert result["streamingCorrect"] is False
    assert "private prompt" not in serialized
    assert "openrouter-secret" not in serialized
    evidence = result["streamEvidence"]
    assert isinstance(evidence, dict)
    assert evidence["contentBearingFrameCount"] == 0
    assert evidence["doneObserved"] is True
