from uuid import uuid4

import pytest

from app.contracts import RoutingRequest
from app.routing import DeterministicRouter, TaskAnalyzer


def model(
    key: str, provider: str, scores: dict[str, int], **capabilities: object
) -> dict[str, object]:
    return {
        "registryEntryId": str(uuid4()),
        "provider": provider,
        "modelKey": key,
        "providerModelId": key,
        "registryVersion": 1,
        "enabled": True,
        "capabilities": {
            "contextWindow": 128_000,
            "maxOutputTokens": 4096,
            "qualityScore": 70,
            "typicalLatencyMs": 500,
            "images": False,
            "tools": False,
            "taskScores": scores,
            **capabilities,
        },
        "pricing": {"inputPerMillionTokens": "1", "outputPerMillionTokens": "2"},
        "pricingVersion": "reviewed-v1",
        "latency": {"typicalMs": 500},
    }


def request(prompt: str, mode: str = "smart", **extra: object) -> RoutingRequest:
    return RoutingRequest.model_validate(
        {
            "requestGroupId": str(uuid4()),
            "prompt": prompt,
            "mode": mode,
            "contextTokens": 1000,
            "maxOutputTokens": 500,
            "models": [
                model("openai:code", "openai", {"coding": 90, "general": 50}),
                model("anthropic:write", "anthropic", {"writing": 95, "general": 60}),
                model("gemini:vision", "gemini", {"multimodal": 90, "general": 40}, images=True),
            ],
            "providerHealth": [
                {"provider": "openai", "status": "ready"},
                {"provider": "anthropic", "status": "ready"},
                {"provider": "gemini", "status": "ready"},
            ],
            **extra,
        }
    )


@pytest.mark.parametrize(
    ("prompt", "expected_category", "expected_model"),
    [
        ("Implement a Python function", "coding", "openai:code"),
        ("Rewrite this draft in a friendlier tone", "writing", "anthropic:write"),
        ("What is in this image?", "multimodal", "gemini:vision"),
        ("Summarize the following", "summarization", "anthropic:write"),
    ],
)
def test_prompt_matrix_is_explainable_and_deterministic(
    prompt: str, expected_category: str, expected_model: str
) -> None:
    decision = DeterministicRouter().route(
        request(prompt, requiresMultimodal=expected_category == "multimodal")
    )

    assert decision.task_category == expected_category
    assert decision.selected_model == expected_model
    assert decision.reason.startswith("smart mode")
    assert decision.estimated_cost is not None


def test_economy_prefers_lower_registry_cost_and_degraded_provider_is_excluded() -> None:
    payload = request("a general question", "economy").model_dump(by_alias=True)
    models = payload["models"]
    assert isinstance(models, list)
    models[0]["pricing"] = {"inputPerMillionTokens": "10", "outputPerMillionTokens": "10"}
    models[1]["pricing"] = {"inputPerMillionTokens": "0.1", "outputPerMillionTokens": "0.1"}
    payload["providerHealth"] = [
        {"provider": "openai", "status": "ready"},
        {"provider": "anthropic", "status": "ready"},
        {"provider": "gemini", "status": "unavailable"},
    ]
    decision = DeterministicRouter().route(RoutingRequest.model_validate(payload))

    assert decision.selected_model == "anthropic:write"
    assert all(item.provider != "gemini" for item in decision.fallback_candidates)


def test_capability_and_preference_constraints_are_honored() -> None:
    # No registry model advertises tools: routing fails closed rather than guessing.
    with pytest.raises(ValueError, match="No enabled registry model"):
        DeterministicRouter().route(
            request("please use tools", requires_tools=True, userPreferredProvider="anthropic")
        )


def test_task_analyzer_marks_large_context_without_a_provider_call() -> None:
    assert TaskAnalyzer().analyze(request("Review this", contextTokens=70_000)) == "long-context"


@pytest.mark.parametrize("mode", ["economy", "smart", "max"])
def test_modes_have_distinct_deterministic_choices(mode: str) -> None:
    cheap = model("openai:free", "openai", {"general": 30}, qualityScore=30)
    cheap["pricing"] = {"inputPerMillionTokens": "0", "outputPerMillionTokens": "0"}
    balanced = model(
        "anthropic:balanced", "anthropic", {"general": 95}, qualityScore=80, typicalLatencyMs=100
    )
    strongest = model(
        "gemini:strongest", "gemini", {"general": 75}, qualityScore=100, typicalLatencyMs=5000
    )
    strongest["pricing"] = {"inputPerMillionTokens": "20", "outputPerMillionTokens": "100"}
    value = request("Hello", mode, models=[cheap, balanced, strongest])
    decision = DeterministicRouter().route(value)
    assert (
        decision.selected_model
        == {"economy": "openai:free", "smart": "anthropic:balanced", "max": "gemini:strongest"}[
            mode
        ]
    )
    if mode == "economy":
        assert decision.estimated_cost == "0.00000000"


@pytest.mark.parametrize(
    "override",
    [
        {"enabled": False},
        {"capabilities": {"contextWindow": 1}},
        {"pricing": None},
        {"pricing": {"inputPerMillionTokens": "NaN", "outputPerMillionTokens": "1"}},
        {"regionConstraints": ["restricted-region"]},
    ],
)
def test_ineligible_registry_entries_never_win_even_in_max(override: dict[str, object]) -> None:
    strongest = model("openai:invalid", "openai", {"general": 100}, qualityScore=100)
    strongest.update(override)
    valid = model("anthropic:valid", "anthropic", {"general": 20})
    assert (
        DeterministicRouter().route(request("Hi", "max", models=[strongest, valid])).selected_model
        == "anthropic:valid"
    )


@pytest.mark.parametrize(
    "status",
    [
        "disabled",
        "unavailable",
        "missing_credentials",
        "temporarily_unhealthy",
        "rate_limited",
        "timed_out",
    ],
)
def test_health_filters_every_mode(status: str) -> None:
    value = request(
        "Hi",
        "max",
        providerHealth=[
            {"provider": "openai", "status": status},
            {"provider": "anthropic", "status": "available"},
        ],
    )
    decision = DeterministicRouter().route(value)
    assert decision.selected_provider == "anthropic"
    assert not decision.fallback_candidates


def test_missing_health_is_not_available() -> None:
    with pytest.raises(ValueError):
        DeterministicRouter().route(request("Hi", providerHealth=[]))


@pytest.mark.parametrize(
    ("prompt", "category"),
    [
        ("hello", "general"),
        ("debug exception", "debugging"),
        ("system architecture", "architecture"),
        ("Python function", "coding"),
        ("prove this", "reasoning"),
        ("rewrite draft", "writing"),
        ("summary", "summarization"),
        ("research sources", "research"),
        ("long context", "long-context"),
        ("produce JSON schema", "structured-data"),
    ],
)
def test_all_task_categories(prompt: str, category: str) -> None:
    assert TaskAnalyzer().analyze(request(prompt)) == category


def test_exact_context_and_output_boundaries() -> None:
    entry = model(
        "openai:boundary", "openai", {"general": 100}, contextWindow=1628, maxOutputTokens=500
    )
    assert (
        DeterministicRouter().route(request("Hi", models=[entry])).selected_model
        == "openai:boundary"
    )
    with pytest.raises(ValueError):
        DeterministicRouter().route(request("Hi", models=[entry], contextTokens=1001))
    with pytest.raises(ValueError):
        DeterministicRouter().route(request("Hi", models=[entry], maxOutputTokens=501))
