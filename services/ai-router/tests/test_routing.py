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
    decision = DeterministicRouter().route(request(prompt))

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
