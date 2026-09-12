"""Guarded, non-public provider calibration runner.

Run this only from a trusted AI Router runtime that already has server-only
provider credentials. It calls the same ProviderRegistry and execute() path as
the FastAPI endpoints and writes metrics only; prompts and credentials are never
placed in the report.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from statistics import median
from typing import Any, Literal
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.contracts import ProviderExecutionPlan  # noqa: E402
from app.execution import execute  # noqa: E402
from app.providers.adapters import StreamingAdapter  # noqa: E402
from app.providers.registry import ProviderRegistry  # noqa: E402

CONFIRMATION = "run-real-provider-evaluation"
Provider = Literal["gemini", "groq", "openrouter"]
ROOT = Path(__file__).resolve().parents[3]
CANDIDATE_DIR = ROOT / "config" / "model-registry"
if not CANDIDATE_DIR.exists():
    CANDIDATE_DIR = Path(__file__).resolve().parents[1] / "config" / "model-registry"
CANDIDATES: dict[Provider, str] = {
    "gemini": "gemini-2.5-flash-v1.json",
    "groq": "groq-openai-gpt-oss-120b-v1.json",
    "openrouter": "openrouter-nemotron-3-ultra-free-v1.json",
}
PERMANENT_CONFIGURATION_FAILURES = {
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_MISSING_CREDENTIALS",
    "PROVIDER_DISABLED",
}

# All acceptance checks are deterministic and prompts contain no private data.
CASES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("general", "Reply with exactly ORBIT-17.", ("orbit-17",)),
    ("general", "Answer only yes or no: is 2 an even number?", ("yes",)),
    ("general", "Return these three words: red, blue, green.", ("red", "blue", "green")),
    (
        "coding",
        "Write Python def double(n) that returns n times 2.",
        ("def double", "return", "* 2"),
    ),
    ("coding", "Write Python def is_even(n) using modulo.", ("def is_even", "% 2")),
    ("coding", "Write Python def reverse_text(s) that reverses s.", ("def reverse_text", "return")),
    ("reasoning", "What is 17 times 6? Answer only the number.", ("102",)),
    ("reasoning", "What is the next prime number after 29? Answer only the number.", ("31",)),
    (
        "reasoning",
        "A box has 3 red and 5 blue balls. How many balls total? Answer only the number.",
        ("8",),
    ),
    (
        "summarization",
        "Summarize in one sentence: Alice submitted the report on Tuesday. "
        "Bob reviewed it Wednesday. The deadline was Friday.",
        ("alice", "tuesday", "bob", "wednesday", "friday"),
    ),
    (
        "summarization",
        "Summarize in one sentence: The service failed at 09:00, recovered at "
        "09:12, and affected checkout only.",
        ("09:00", "09:12", "checkout"),
    ),
    (
        "summarization",
        "Summarize in one sentence: Maya chose plan B because it cost $10 less "
        "and shipped two days earlier.",
        ("maya", "plan b", "$10", "two days"),
    ),
)


def candidate(provider: Provider) -> dict[str, Any]:
    source = CANDIDATE_DIR / CANDIDATES[provider]
    value = json.loads(source.read_text())
    models = value.get("models")
    if not isinstance(models, list) or len(models) != 1 or not isinstance(models[0], dict):
        raise ValueError(f"Invalid candidate file: {source}")
    return models[0]


def plan_for(provider: Provider, model: dict[str, Any], prompt: str) -> ProviderExecutionPlan:
    token_estimate = 32 + 16 + len(prompt.encode())
    return ProviderExecutionPlan.model_validate(
        {
            "request": {
                "context": {
                    "messages": [{"role": "user", "content": prompt}],
                    "sourceIds": [],
                    "tokenEstimate": token_estimate,
                },
                "contextSnapshotId": str(uuid4()),
                "maxOutputTokens": 128,
                "modelKey": model["modelKey"],
                "provider": provider,
                "runId": str(uuid4()),
            },
            "model": {
                "provider": provider,
                "providerModelId": model["providerModelId"],
                "registryVersion": model["registryVersion"],
                "capabilities": model["capabilities"],
                "pricingVersion": model["pricingVersion"],
            },
        }
    )


async def run_case(
    registry: ProviderRegistry,
    settings: Settings,
    provider: Provider,
    model: dict[str, Any],
    category: str,
    prompt: str,
    expected: tuple[str, ...],
) -> dict[str, object]:
    started = time.perf_counter()
    first_token_ms: int | None = None
    text = ""
    request_id: str | None = None
    usage: dict[str, int | None] = {"inputTokens": None, "outputTokens": None, "totalTokens": None}
    terminal = "STREAM_TRUNCATED"
    plan = plan_for(provider, model, prompt)
    async for event in execute(plan, registry, settings):
        elapsed = round((time.perf_counter() - started) * 1000)
        if event.type == "run.started" and event.provider_request_id:
            request_id = event.provider_request_id
        elif event.type == "content.delta":
            if first_token_ms is None:
                first_token_ms = elapsed
            text += event.text or ""
        elif event.type == "usage.updated":
            usage = {
                "inputTokens": event.input_tokens,
                "outputTokens": event.output_tokens,
                "totalTokens": event.total_tokens,
            }
        elif event.type == "run.completed":
            terminal = event.finish_reason or "completed"
        elif event.type == "run.failed":
            terminal = event.code or "PROVIDER_ERROR"
    passed = [value for value in expected if value.lower() in text.lower()]
    completed = terminal in {"stop", "length", "completed"}
    adapter = registry.for_plan(plan)
    diagnostic = adapter.last_diagnostic() if isinstance(adapter, StreamingAdapter) else None
    return {
        "category": category,
        "success": completed,
        "streamingCorrect": completed
        and first_token_ms is not None
        and usage["inputTokens"] is not None,
        "firstTokenLatencyMs": first_token_ms,
        "totalLatencyMs": round((time.perf_counter() - started) * 1000),
        "providerRequestId": request_id,
        "usage": usage,
        "finishReason": terminal if completed else None,
        "failureCode": None if completed else terminal,
        "acceptanceChecks": {"passed": len(passed), "total": len(expected)},
        "diagnostic": (
            {
                "httpStatus": diagnostic.http_status,
                "providerCode": diagnostic.provider_code,
                "providerType": diagnostic.provider_type,
                "providerStatus": diagnostic.provider_status,
                "message": diagnostic.message,
            }
            if diagnostic
            else None
        ),
    }


async def evaluate(provider: Provider, timeout_probe: bool) -> dict[str, object]:
    settings = Settings()
    model = candidate(provider)
    registry = ProviderRegistry(settings)
    health = next(item for item in await registry.health() if item.provider == provider)
    if health.status not in {"enabled", "available", "ready"}:
        code = {
            "disabled": "PROVIDER_DISABLED",
            "missing_credentials": "PROVIDER_MISSING_CREDENTIALS",
            "invalid_credentials": "PROVIDER_AUTH_FAILED",
        }.get(health.status, "PROVIDER_UNAVAILABLE")
        return report(provider, model, [], None, "BLOCKED", code, None)
    results: list[dict[str, object]] = []
    blocked_by: str | None = None
    for category, prompt, expected in CASES:
        result = await run_case(registry, settings, provider, model, category, prompt, expected)
        results.append(result)
        failure = result["failureCode"]
        if isinstance(failure, str) and failure in PERMANENT_CONFIGURATION_FAILURES:
            blocked_by = str(failure)
            break
    successful = [item for item in results if item["success"]]
    timeout_result: str | None = None
    if timeout_probe and blocked_by is None:
        short_timeout = settings.model_copy(update={"request_timeout_seconds": 0.001})
        probe = await run_case(
            ProviderRegistry(short_timeout),
            short_timeout,
            provider,
            model,
            "timeout",
            "Reply with timeout-probe.",
            ("timeout-probe",),
        )
        timeout_result = str(probe["failureCode"] or probe["finishReason"])
    status: Literal["BLOCKED", "INCOMPLETE", "COMPLETED"] = (
        "BLOCKED"
        if blocked_by
        else "INCOMPLETE"
        if len(successful) != len(results)
        else "COMPLETED"
    )
    return report(provider, model, results, timeout_result, status, blocked_by, successful)


def report(
    provider: Provider,
    model: dict[str, Any],
    results: list[dict[str, object]],
    timeout_result: str | None,
    status: Literal["BLOCKED", "INCOMPLETE", "COMPLETED"],
    blocked_by: str | None,
    successful: list[dict[str, object]] | None,
) -> dict[str, object]:
    """Only completed benchmark runs may yield registry routing evidence."""

    def integer(value: object) -> int:
        if type(value) is not int:
            raise ValueError("Evaluation result contains an invalid integer metric")
        return value

    def acceptance(result: dict[str, object], key: str) -> int:
        checks = result.get("acceptanceChecks")
        if not isinstance(checks, dict):
            raise ValueError("Evaluation result is missing acceptance checks")
        return integer(checks.get(key))

    task_scores: dict[str, float] | None = None
    if status == "COMPLETED":
        task_scores = {}
        for category in ("general", "coding", "reasoning", "summarization"):
            category_results = [item for item in results if item["category"] == category]
            passed = sum(acceptance(item, "passed") for item in category_results)
            total = sum(acceptance(item, "total") for item in category_results)
            task_scores[category] = round(100 * passed / total, 2)
    successful = successful or []
    return {
        "status": status,
        "blockedBy": blocked_by,
        "provider": provider,
        "modelKey": model["modelKey"],
        "providerModelId": model["providerModelId"],
        "requests": len(results) + int(timeout_result is not None),
        "plannedRequests": len(CASES) + 1,
        "methodology": {
            "taskScore": "passed deterministic acceptance checks / total checks * 100",
            "qualityScore": "unweighted arithmetic mean of the four task scores",
            "typicalLatencyMs": "median total latency across successful requests only",
            "rawOutputsPersisted": False,
        },
        "results": results,
        "taskScores": task_scores,
        "qualityScore": round(sum(task_scores.values()) / len(task_scores), 2)
        if task_scores
        else None,
        "typicalLatencyMs": round(median([integer(item["totalLatencyMs"]) for item in successful]))
        if successful
        else None,
        "timeoutProbe": timeout_result,
        "normalizedErrorCoverage": (
            "covered by mocked adapter regression tests; live error injection is not performed"
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one guarded real-provider calibration.")
    parser.add_argument("--provider", choices=tuple(CANDIDATES), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout-probe", action="store_true")
    args = parser.parse_args()
    if os.environ.get("PROVIDER_EVAL_CONFIRM") != CONFIRMATION:
        raise SystemExit("Refusing external calls without PROVIDER_EVAL_CONFIRM.")
    try:
        report = asyncio.run(evaluate(args.provider, args.timeout_probe))
    except RuntimeError as error:
        raise SystemExit(str(error)) from error
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    args.output.chmod(0o600)
    print(f"Wrote {args.provider} evaluation metrics to {args.output}")
    if report["status"] == "BLOCKED":
        first = report["results"][0] if report["results"] else None  # type: ignore[index]
        diagnostic = first.get("diagnostic") if isinstance(first, dict) else None
        print(
            "Evaluation blocked by "
            f"{report['blockedBy']}; sanitized upstream diagnostic: {json.dumps(diagnostic)}"
        )


if __name__ == "__main__":
    main()
