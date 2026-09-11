"""Deterministic selection over server-supplied, reviewed registry snapshots."""

import math
from decimal import Decimal, InvalidOperation
from typing import cast

from app.contracts import (
    RoutingCandidate,
    RoutingDecision,
    RoutingModelSnapshot,
    RoutingRequest,
    TaskCategory,
)


class TaskAnalyzer:
    _KEYWORDS: tuple[tuple[TaskCategory, tuple[str, ...]], ...] = (
        ("structured-data", ("json", "csv", "schema", "structured data", "structured-data")),
        ("debugging", ("debug", "error", "stack trace", "bug", "exception")),
        ("architecture", ("architecture", "design system", "tradeoff", "scalable")),
        ("coding", ("code", "function", "typescript", "python", "implement")),
        ("summarization", ("summarize", "summary", "tl;dr")),
        ("research", ("research", "sources", "citations", "compare evidence")),
        ("reasoning", ("reason", "prove", "math", "logic", "step by step")),
        ("writing", ("write", "rewrite", "tone", "draft")),
    )

    def analyze(self, request: RoutingRequest) -> TaskCategory:
        if request.requires_multimodal:
            return "multimodal"
        if request.context_tokens >= 64_000 or "long context" in request.prompt.lower():
            return "long-context"
        return next(
            (
                category
                for category, words in self._KEYWORDS
                if any(word in request.prompt.lower() for word in words)
            ),
            "general",
        )


def bounded_number(value: object, minimum: float, maximum: float) -> bool:
    return (
        type(value) in {int, float}
        and math.isfinite(cast(float, value))
        and minimum <= cast(float, value) <= maximum
    )


def estimated_cost(model: RoutingModelSnapshot, request: RoutingRequest) -> Decimal | None:
    if not model.pricing:
        return None
    try:
        prices = [
            Decimal(str(model.pricing[key]))
            for key in ("inputPerMillionTokens", "outputPerMillionTokens")
        ]
        if any(not p.is_finite() or p < 0 for p in prices):
            return None
        return (
            prices[0] * request.context_tokens + prices[1] * request.max_output_tokens
        ) / Decimal(1_000_000)
    except (KeyError, InvalidOperation):
        return None


class DynamicModelRegistry:
    def eligible(self, request: RoutingRequest) -> list[RoutingModelSnapshot]:
        health = {entry.provider: entry for entry in request.provider_health}
        result = []
        for model in request.models:
            state = health.get(model.provider)
            if (
                not model.enabled
                or state is None
                or state.status not in {"available", "enabled", "ready", "degraded"}
            ):
                continue
            caps = model.capabilities
            window, output = caps.get("contextWindow"), caps.get("maxOutputTokens")
            scores = caps.get("taskScores")
            if (
                type(window) is not int
                or type(output) is not int
                or window < request.context_tokens + request.max_output_tokens + 128
                or output < request.max_output_tokens
                or not isinstance(scores, dict)
                or "general" not in scores
                or any(not bounded_number(v, 0, 100) for v in scores.values())
                or not bounded_number(caps.get("qualityScore"), 0, 100)
                or not bounded_number(caps.get("typicalLatencyMs"), 1, 300_000)
                or estimated_cost(model, request) is None
                or not model.pricing_version
            ):
                continue
            if model.region_constraints and request.region not in model.region_constraints:
                continue
            if request.requires_tools and caps.get("tools") is not True:
                continue
            if request.requires_multimodal and caps.get("images") is not True:
                continue
            result.append(model)
        # One immutable version per model.
        latest: dict[str, RoutingModelSnapshot] = {}
        for model in result:
            if (
                model.model_key not in latest
                or latest[model.model_key].registry_version < model.registry_version
            ):
                latest[model.model_key] = model
        return list(latest.values())


class DeterministicRouter:
    def __init__(
        self, registry: DynamicModelRegistry | None = None, analyzer: TaskAnalyzer | None = None
    ) -> None:
        self._registry = registry or DynamicModelRegistry()
        self._analyzer = analyzer or TaskAnalyzer()

    def route(self, request: RoutingRequest) -> RoutingDecision:
        task = self._analyzer.analyze(request)
        models = self._registry.eligible(request)
        if not models:
            raise ValueError(
                "No enabled registry model satisfies required capabilities, context, and health"
            )
        costs = {m.model_key: cast(Decimal, estimated_cost(m, request)) for m in models}
        highest = max(costs.values())
        health = {item.provider: item for item in request.provider_health}
        candidates = []
        for model in models:
            caps = model.capabilities
            scores = cast(dict[str, float], caps["taskScores"])
            suitability = Decimal(str(scores.get(task, scores["general"]))) / 100
            quality = Decimal(str(caps["qualityScore"])) / 100
            state = health[model.provider]
            latency = Decimal(
                str(state.latency_ms if state.latency_ms is not None else caps["typicalLatencyMs"])
            )
            speed = 1 / (1 + latency / 1000)
            reliability = (
                Decimal("1")
                if state.status in {"available", "ready"}
                else Decimal("0.5")
                if state.status == "enabled"
                else Decimal("0.25")
            )
            affordability = 1 - costs[model.model_key] / highest if highest else Decimal(1)
            headroom = min(
                Decimal(1),
                Decimal(str(caps["contextWindow"]))
                / max(1, (request.context_tokens + request.max_output_tokens + 128) * 2),
            )
            score = (
                Decimal("0.4") * suitability
                + Decimal("0.25") * quality
                + Decimal("0.1") * speed
                + Decimal("0.1") * reliability
                + Decimal("0.1") * affordability
                + Decimal("0.05") * headroom
            )
            if request.mode == "max":
                score = Decimal("0.6") * quality + Decimal("0.4") * suitability
            if request.mode == "economy":
                score = -costs[model.model_key]
            candidates.append(
                RoutingCandidate(
                    provider=model.provider,
                    model_key=model.model_key,
                    registry_entry_id=model.registry_entry_id,
                    score=float(score),
                    reason=(
                        f"{request.mode} mode: {task}; eligible registry model; "
                        f"estimated USD {costs[model.model_key]:.8f}; health {state.status}"
                    ),
                    estimated_cost=f"{costs[model.model_key]:.8f}",
                    pricing_version=model.pricing_version,
                )
            )
        # Decimal sorting preserves tiny differences and real zero prices.
        candidates.sort(
            key=lambda c: (
                (costs[c.model_key] if request.mode == "economy" else -Decimal(str(c.score))),
                c.model_key,
            )
        )
        if request.user_preferred_model:
            preferred = next(
                (c for c in candidates if c.model_key == request.user_preferred_model), None
            )
            if preferred is None:
                raise ValueError("Selected model is unavailable or incompatible")
            candidates.remove(preferred)
            candidates.insert(0, preferred)
        selected = candidates[0]
        return RoutingDecision(
            request_group_id=request.request_group_id,
            task_category=task,
            selected_provider=selected.provider,
            selected_model=selected.model_key,
            selected_registry_entry_id=selected.registry_entry_id,
            routing_score=selected.score,
            reason=selected.reason,
            fallback_candidates=candidates[1:],
            estimated_cost=selected.estimated_cost,
            pricing_version=selected.pricing_version,
        )
