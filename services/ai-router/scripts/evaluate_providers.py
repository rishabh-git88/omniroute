"""Guarded, resumable, non-public provider calibration runner.

Run this only from a trusted AI Router runtime that already has server-only
provider credentials. It calls the same ProviderRegistry and execute() path as
the FastAPI endpoints. Reports contain metrics and structural stream evidence,
never prompts, generated text, request headers, or credentials.
"""

import argparse
import asyncio
import json
import os
import random
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any, Literal, cast
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.contracts import ProviderExecutionPlan  # noqa: E402
from app.execution import execute  # noqa: E402
from app.providers.adapters import StreamingAdapter  # noqa: E402
from app.providers.registry import ProviderRegistry  # noqa: E402

CONFIRMATION = "run-real-provider-evaluation"
Provider = Literal["gemini", "groq", "openrouter"]
Status = Literal["BLOCKED", "INVALID_EVALUATION", "INCOMPLETE", "COMPLETED"]
ROOT = Path(__file__).resolve().parents[3]
CANDIDATE_DIR = ROOT / "config" / "model-registry"
if not CANDIDATE_DIR.exists():
    CANDIDATE_DIR = Path(__file__).resolve().parents[1] / "config" / "model-registry"
CANDIDATES: dict[Provider, str] = {
    "gemini": "gemini-3.5-flash-v1.json",
    "groq": "groq-openai-gpt-oss-120b-v1.json",
    "openrouter": "openrouter-liquid-lfm-2.5-2.6b-free-v1.json",
}
PERMANENT_CONFIGURATION_FAILURES = {
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_MISSING_CREDENTIALS",
    "PROVIDER_DISABLED",
}
INVALID_EVALUATION_FAILURES = {"PROVIDER_PROTOCOL_ERROR", "PROVIDER_INVALID_REQUEST"}
RETRYABLE_FAILURES = {
    "RATE_LIMITED",
    "PROVIDER_TIMEOUT",
    "PROVIDER_TEMPORARY_ERROR",
    "NETWORK_ERROR",
    "PROVIDER_UNAVAILABLE",
    "STREAM_TRUNCATED",
}

# All acceptance checks are deterministic and prompts contain no private data.
BENCHMARKS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
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
CASES: tuple[tuple[str, str, str, tuple[str, ...]], ...] = tuple(
    (f"{index:02d}-{category}", category, prompt, expected)
    for index, (category, prompt, expected) in enumerate(BENCHMARKS, start=1)
)


@dataclass(frozen=True)
class EvaluationOptions:
    """Bounded pacing controls for a trusted operator's real calibration run."""

    delay_seconds: float = 12.0
    rate_limit_cooldown_seconds: float = 15.0
    max_retries: int = 2
    max_attempts_per_case: int = 3
    max_evaluation_seconds: float = 600.0


def candidate(provider: Provider) -> dict[str, Any]:
    source = CANDIDATE_DIR / CANDIDATES[provider]
    value = json.loads(source.read_text())
    models = value.get("models")
    if not isinstance(models, list) or len(models) != 1 or not isinstance(models[0], dict):
        raise ValueError(f"Invalid candidate file: {source}")
    return models[0]


def identity(provider: Provider, model: dict[str, Any]) -> dict[str, object]:
    return {
        "provider": provider,
        "modelKey": model["modelKey"],
        "providerModelId": model["providerModelId"],
        "registryVersion": model["registryVersion"],
    }


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
    *,
    case_id: str | None = None,
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
    stream_evidence = (
        adapter.last_stream_summary() if isinstance(adapter, StreamingAdapter) else None
    )
    final_usage = all(
        type(usage[key]) is int for key in ("inputTokens", "outputTokens", "totalTokens")
    )
    return {
        "caseId": case_id or f"manual-{category}",
        "category": category,
        "success": completed,
        "streamingCorrect": completed and first_token_ms is not None and final_usage,
        "firstTokenLatencyMs": first_token_ms,
        "totalLatencyMs": round((time.perf_counter() - started) * 1000),
        "providerRequestId": request_id,
        "usage": usage,
        "finishReason": terminal if completed else None,
        "failureCode": None if completed else terminal,
        "acceptanceChecks": {"passed": len(passed), "total": len(expected)},
        "streamEvidence": stream_evidence,
        "diagnostic": (
            {
                "httpStatus": diagnostic.http_status,
                "providerCode": diagnostic.provider_code,
                "providerType": diagnostic.provider_type,
                "providerStatus": diagnostic.provider_status,
                "message": diagnostic.message,
                "retryAfterSeconds": diagnostic.retry_after_seconds,
                "eventShape": diagnostic.event_shape,
            }
            if diagnostic
            else None
        ),
    }


def valid_evidence(result: dict[str, object]) -> bool:
    usage = result.get("usage")
    return (
        result.get("success") is True
        and result.get("streamingCorrect") is True
        and isinstance(usage, dict)
        and all(
            type(usage.get(key)) is int for key in ("inputTokens", "outputTokens", "totalTokens")
        )
        and result.get("finishReason") in {"stop", "length", "completed"}
    )


def retryable(result: dict[str, object]) -> bool:
    if valid_evidence(result):
        return False
    failure = result.get("failureCode")
    # A normalized terminal without a content delta is incomplete evidence. It
    # is retried only within the small per-case budget so the next report can
    # retain structural diagnostics without being mistaken for task quality.
    return failure is None or failure in RETRYABLE_FAILURES


def failure_code(result: dict[str, object]) -> str | None:
    value = result.get("failureCode")
    return value if isinstance(value, str) else None


def retry_after_seconds(result: dict[str, object]) -> float | None:
    diagnostic = result.get("diagnostic")
    if not isinstance(diagnostic, dict):
        return None
    value = diagnostic.get("retryAfterSeconds")
    return value if isinstance(value, (int, float)) and value >= 0 else None


def normalize_checkpoint(
    checkpoint: dict[str, object], provider: Provider, model: dict[str, Any]
) -> tuple[dict[str, list[dict[str, object]]], str | None]:
    """Validate and load a checkpoint without accepting a different model/version."""

    expected = identity(provider, model)
    for key in ("provider", "modelKey", "providerModelId"):
        if checkpoint.get(key) != expected[key]:
            raise ValueError(f"Resume checkpoint {key} does not match the selected candidate")
    checkpoint_version = checkpoint.get("registryVersion")
    if checkpoint_version is None:
        # Reports produced before checkpoint schema v2 can be migrated only for
        # the immutable v1 candidate and only when their ordered categories
        # exactly match the deterministic suite. This preserves the six valid
        # Gemini observations while preventing a cross-version merge.
        if expected["registryVersion"] != 1:
            raise ValueError("Legacy checkpoint lacks a registry version")
    elif checkpoint_version != expected["registryVersion"]:
        raise ValueError("Resume checkpoint registryVersion does not match the selected candidate")

    history: dict[str, list[dict[str, object]]] = {case_id: [] for case_id, *_ in CASES}
    raw_history = checkpoint.get("attemptHistory")
    if isinstance(raw_history, list):
        for item in raw_history:
            if not isinstance(item, dict):
                raise ValueError("Resume checkpoint contains an invalid attempt")
            case_id = item.get("caseId")
            result = item.get("result")
            if case_id not in history or not isinstance(result, dict):
                raise ValueError("Resume checkpoint attempt does not match the benchmark suite")
            history[case_id].append(dict(result))
    else:
        legacy_results = checkpoint.get("results")
        if not isinstance(legacy_results, list) or len(legacy_results) > len(CASES):
            raise ValueError("Resume checkpoint contains invalid benchmark results")
        for index, result in enumerate(legacy_results):
            case_id, category, *_ = CASES[index]
            if not isinstance(result, dict) or result.get("category") != category:
                raise ValueError(
                    "Legacy checkpoint category order does not match the benchmark suite"
                )
            migrated = dict(result)
            migrated["caseId"] = case_id
            history[case_id].append(migrated)

    probe = checkpoint.get("timeoutProbe")
    return history, probe if isinstance(probe, str) else None


def selected_result(attempts: list[dict[str, object]]) -> dict[str, object] | None:
    return next(
        (attempt for attempt in attempts if valid_evidence(attempt)),
        attempts[-1] if attempts else None,
    )


def cooldown_for(
    result: dict[str, object], attempt_count: int, options: EvaluationOptions
) -> float:
    retry_after = retry_after_seconds(result)
    exponential = min(30.0, options.delay_seconds * (2 ** max(attempt_count - 1, 0)))
    jitter = random.uniform(0.0, min(1.0, exponential * 0.1))
    if failure_code(result) == "RATE_LIMITED":
        return cast(
            float,
            max(options.rate_limit_cooldown_seconds, retry_after or 0.0, exponential + jitter),
        )
    return cast(float, exponential + jitter)


async def evaluate(
    provider: Provider,
    timeout_probe: bool,
    *,
    resume: dict[str, object] | None = None,
    options: EvaluationOptions | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, object]:
    options = options or EvaluationOptions()
    settings = Settings()
    model = candidate(provider)
    registry = ProviderRegistry(settings)
    health = next(item for item in await registry.health() if item.provider == provider)
    if health.status not in {"enabled", "available", "ready"}:
        health_code = {
            "disabled": "PROVIDER_DISABLED",
            "missing_credentials": "PROVIDER_MISSING_CREDENTIALS",
            "invalid_credentials": "PROVIDER_AUTH_FAILED",
        }.get(health.status, "PROVIDER_UNAVAILABLE")
        return report(provider, model, [], None, "BLOCKED", health_code, None)

    history, prior_probe = (
        normalize_checkpoint(resume, provider, model)
        if resume
        else (
            {case_id: [] for case_id, *_ in CASES},
            None,
        )
    )
    started = clock()
    blocked_by: str | None = None
    invalid_by: str | None = None
    calls_made = 0
    for case_id, category, prompt, expected in CASES:
        attempts = history[case_id]
        if selected_result(attempts) and valid_evidence(selected_result(attempts) or {}):
            continue
        retries_for_case = 0
        while len(attempts) < options.max_attempts_per_case:
            if clock() - started >= options.max_evaluation_seconds:
                break
            if calls_made:
                await sleep(options.delay_seconds)
            result = await run_case(
                registry,
                settings,
                provider,
                model,
                category,
                prompt,
                expected,
                case_id=case_id,
            )
            attempts.append(result)
            calls_made += 1
            result_code = failure_code(result)
            if result_code in PERMANENT_CONFIGURATION_FAILURES:
                blocked_by = result_code
                break
            if result_code in INVALID_EVALUATION_FAILURES:
                invalid_by = result_code
                break
            if valid_evidence(result) or not retryable(result):
                break
            if retries_for_case >= options.max_retries:
                break
            retries_for_case += 1
            if len(attempts) < options.max_attempts_per_case:
                await sleep(cooldown_for(result, len(attempts), options))
        if blocked_by or invalid_by or clock() - started >= options.max_evaluation_seconds:
            break

    results = [selected_result(history[case_id]) for case_id, *_ in CASES]
    selected = [item for item in results if item is not None]
    timeout_result = prior_probe
    all_complete = len(selected) == len(CASES) and all(valid_evidence(item) for item in selected)
    if timeout_probe and timeout_result is None and all_complete:
        short_timeout = settings.model_copy(update={"request_timeout_seconds": 0.001})
        probe = await run_case(
            ProviderRegistry(short_timeout),
            short_timeout,
            provider,
            model,
            "timeout",
            "Reply with timeout-probe.",
            ("timeout-probe",),
            case_id="timeout-probe",
        )
        timeout_result = str(probe["failureCode"] or probe["finishReason"])
    status: Status = (
        "BLOCKED"
        if blocked_by
        else "INVALID_EVALUATION"
        if invalid_by
        else "COMPLETED"
        if all_complete
        else "INCOMPLETE"
    )
    attempts_flat = [
        {"caseId": case_id, "attempt": index + 1, "result": result}
        for case_id, *_ in CASES
        for index, result in enumerate(history[case_id])
    ]
    return report(
        provider,
        model,
        selected,
        timeout_result,
        status,
        blocked_by or invalid_by,
        [item for item in selected if item.get("success") is True],
        attempt_history=attempts_flat,
    )


def report(
    provider: Provider,
    model: dict[str, Any],
    results: list[dict[str, object]],
    timeout_result: str | None,
    status: Status,
    blocked_by: str | None,
    successful: list[dict[str, object]] | None,
    *,
    attempt_history: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    """Only complete valid benchmark evidence may yield registry routing metadata."""

    def integer(value: object) -> int:
        if type(value) is not int:
            raise ValueError("Evaluation result contains an invalid integer metric")
        return value

    def acceptance(result: dict[str, object], key: str) -> int:
        checks = result.get("acceptanceChecks")
        if not isinstance(checks, dict):
            raise ValueError("Evaluation result is missing acceptance checks")
        return integer(checks.get(key))

    complete_evidence = len(results) == len(CASES) and all(valid_evidence(item) for item in results)
    task_scores: dict[str, float] | None = None
    if status == "COMPLETED" and complete_evidence:
        task_scores = {}
        for category in ("general", "coding", "reasoning", "summarization"):
            category_results = [item for item in results if item["category"] == category]
            passed = sum(acceptance(item, "passed") for item in category_results)
            total = sum(acceptance(item, "total") for item in category_results)
            task_scores[category] = round(100 * passed / total, 2)
    successful = successful or []
    attempt_history = attempt_history or []
    attempted_case_ids = {
        item.get("caseId") for item in attempt_history if isinstance(item.get("caseId"), str)
    }
    first_attempts: dict[str, dict[str, object]] = {}
    for item in attempt_history:
        case_id = item.get("caseId")
        result = item.get("result")
        if isinstance(case_id, str) and isinstance(result, dict) and case_id not in first_attempts:
            first_attempts[case_id] = result
    rate_limit_attempts = 0
    retryable_failed_attempts = 0
    for item in attempt_history:
        attempt_result = item.get("result")
        if not isinstance(attempt_result, dict):
            continue
        typed_result = cast(dict[str, object], attempt_result)
        if failure_code(typed_result) == "RATE_LIMITED":
            rate_limit_attempts += 1
        if not valid_evidence(typed_result) and retryable(typed_result):
            retryable_failed_attempts += 1
    return {
        "evaluationSchemaVersion": 2,
        "status": status if status != "COMPLETED" or complete_evidence else "INCOMPLETE",
        "blockedBy": blocked_by,
        **identity(provider, model),
        "requests": len(attempt_history) + int(timeout_result is not None),
        "plannedRequests": len(CASES) + 1,
        "successfulBenchmarkCases": sum(valid_evidence(item) for item in results),
        "retryableFailedAttempts": retryable_failed_attempts,
        "rateLimitAttempts": rate_limit_attempts,
        "totalExternalCalls": len(attempt_history) + int(timeout_result is not None),
        "firstAttemptSuccessRate": round(
            100
            * sum(valid_evidence(item) for item in first_attempts.values())
            / len(attempted_case_ids),
            2,
        )
        if attempted_case_ids
        else None,
        "methodology": {
            "taskScore": "passed deterministic acceptance checks / total checks * 100",
            "qualityScore": "unweighted arithmetic mean of the four task scores",
            "typicalLatencyMs": (
                "median provider execution latency across valid successful cases only; "
                "operator pacing is excluded"
            ),
            "streamingCorrect": (
                "at least one user-visible content delta, normalized terminal completion, final "
                "normalized input/output/total usage, and no protocol or truncation failure"
            ),
            "rawOutputsPersisted": False,
        },
        "results": results,
        "attemptHistory": attempt_history,
        "taskScores": task_scores,
        "qualityScore": round(sum(task_scores.values()) / len(task_scores), 2)
        if task_scores
        else None,
        "typicalLatencyMs": round(median([integer(item["totalLatencyMs"]) for item in results]))
        if complete_evidence
        else None,
        "timeoutProbe": timeout_result,
        "normalizedErrorCoverage": (
            "covered by mocked adapter regression tests; live error injection is not performed"
        ),
    }


def options_from_args(args: argparse.Namespace) -> EvaluationOptions:
    values = {
        "delay_seconds": args.delay_seconds,
        "rate_limit_cooldown_seconds": args.rate_limit_cooldown_seconds,
        "max_retries": args.max_retries,
        "max_attempts_per_case": args.max_attempts_per_case,
        "max_evaluation_seconds": args.max_evaluation_seconds,
    }
    if (
        values["delay_seconds"] < 0
        or values["rate_limit_cooldown_seconds"] < 0
        or values["max_retries"] < 0
        or values["max_attempts_per_case"] < 1
        or values["max_evaluation_seconds"] <= 0
    ):
        raise ValueError("Evaluation pacing limits must be non-negative and bounded")
    return EvaluationOptions(**values)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one guarded real-provider calibration.")
    parser.add_argument("--provider", choices=tuple(CANDIDATES), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--resume", type=Path, help="Load only an exact provider/model/version checkpoint."
    )
    parser.add_argument("--timeout-probe", action="store_true")
    parser.add_argument("--delay-seconds", type=float, default=12.0)
    parser.add_argument("--rate-limit-cooldown-seconds", type=float, default=15.0)
    parser.add_argument("--max-retries", type=int, default=2)
    parser.add_argument("--max-attempts-per-case", type=int, default=3)
    parser.add_argument("--max-evaluation-seconds", type=float, default=600.0)
    args = parser.parse_args()
    if os.environ.get("PROVIDER_EVAL_CONFIRM") != CONFIRMATION:
        raise SystemExit("Refusing external calls without PROVIDER_EVAL_CONFIRM.")
    try:
        resume = json.loads(args.resume.read_text()) if args.resume else None
        if resume is not None and not isinstance(resume, dict):
            raise ValueError("Resume checkpoint must be a JSON object")
        report_value = asyncio.run(
            evaluate(
                args.provider, args.timeout_probe, resume=resume, options=options_from_args(args)
            )
        )
    except (RuntimeError, ValueError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report_value, indent=2, sort_keys=True) + "\n")
    args.output.chmod(0o600)
    print(f"Wrote {args.provider} evaluation metrics to {args.output}")
    if report_value["status"] in {"BLOCKED", "INVALID_EVALUATION"}:
        print(
            f"Evaluation stopped by {report_value['blockedBy']}; "
            "report contains safe diagnostics only."
        )


if __name__ == "__main__":
    main()
