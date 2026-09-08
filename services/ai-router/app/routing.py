"""Deterministic routing; it only scores reviewed registry snapshots and never invokes providers."""

from collections.abc import Mapping
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
        ("debugging", ("debug", "error", "stack trace", "bug", "exception")),
        ("architecture", ("architecture", "design system", "tradeoff", "scalable")),
        ("coding", ("code", "function", "typescript", "python", "implement")),
        ("summarization", ("summarize", "summary", "tl;dr")),
        ("research", ("research", "sources", "citations", "compare evidence")),
        ("reasoning", ("reason", "prove", "math", "logic", "step by step")),
        ("writing", ("write", "rewrite", "tone", "draft")),
    )

    def analyze(self, request: RoutingRequest) -> TaskCategory:
        if request.requires_multimodal or any(
            word in request.prompt.lower() for word in ("image", "pdf", "video")
        ):
            return "multimodal"
        if request.context_tokens >= 64_000 or "long context" in request.prompt.lower():
            return "long-context"
        prompt = request.prompt.lower()
        return next(
            (
                category
                for category, words in self._KEYWORDS
                if any(word in prompt for word in words)
            ),
            "general",
        )


class DynamicModelRegistry:
    """The router consumes supplied, versioned snapshots; it has no model table of its own."""

    def eligible(self, request: RoutingRequest) -> list[RoutingModelSnapshot]:
        health = {entry.provider: entry for entry in request.provider_health}
        result: list[RoutingModelSnapshot] = []
        for model in request.models:
            state = health.get(model.provider)
            if not model.enabled or state and state.status in {"unavailable", "disabled"}:
                continue
            caps = model.capabilities
            if request.requires_tools and caps.get("tools") is not True:
                continue
            if request.requires_multimodal and caps.get("images") is not True:
                continue
            context_window = int(cast(int | str, caps.get("contextWindow", 0)))
            if context_window < request.context_tokens + request.max_output_tokens:
                continue
            result.append(model)
        return result


class DeterministicRouter:
    def __init__(
        self, registry: DynamicModelRegistry | None = None, analyzer: TaskAnalyzer | None = None
    ) -> None:
        self._registry = registry or DynamicModelRegistry()
        self._analyzer = analyzer or TaskAnalyzer()

    def route(self, request: RoutingRequest) -> RoutingDecision:
        task = self._analyzer.analyze(request)
        candidates = [
            self._candidate(request, task, model) for model in self._registry.eligible(request)
        ]
        if not candidates:
            raise ValueError(
                "No enabled registry model satisfies required capabilities, context, and health"
            )
        candidates.sort(key=lambda item: (-item.score, item.model_key))
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

    def _candidate(
        self, request: RoutingRequest, task: TaskCategory, model: RoutingModelSnapshot
    ) -> RoutingCandidate:
        caps = model.capabilities
        task_scores = cast(Mapping[str, object], caps.get("taskScores", {}))
        score = Decimal(str(task_scores.get(task, task_scores.get("general", 0))))
        latency = Decimal(str((model.latency or {}).get("typicalMs", 1000)))
        cost = self._cost(model, request)
        if request.mode == "economy":
            score += Decimal("100") / (Decimal("1") + (cost or Decimal("1000")))
            score -= latency / Decimal("1000")
        elif request.mode == "smart":
            score += Decimal("30") / (Decimal("1") + (cost or Decimal("30")))
            score -= latency / Decimal("3000")
        else:
            score += Decimal(str(caps.get("contextWindow", 0))) / Decimal("100000")
            score -= latency / Decimal("10000")
        if request.user_preferred_provider == model.provider:
            score += Decimal("5")
        if request.user_preferred_model == model.model_key:
            score += Decimal("10")
        estimate = f"{cost:.8f}" if cost is not None else None
        return RoutingCandidate(
            provider=model.provider,
            model_key=model.model_key,
            registry_entry_id=model.registry_entry_id,
            score=float(score.quantize(Decimal("0.001"))),
            reason=(
                f"{request.mode} mode: {task}; reviewed registry score and eligible capabilities"
            ),
            estimated_cost=estimate,
            pricing_version=model.pricing_version,
        )

    @staticmethod
    def _cost(model: RoutingModelSnapshot, request: RoutingRequest) -> Decimal | None:
        if not model.pricing:
            return None
        try:
            incoming = Decimal(str(model.pricing["inputPerMillionTokens"]))
            outgoing = Decimal(str(model.pricing["outputPerMillionTokens"]))
            return (
                incoming * request.context_tokens + outgoing * request.max_output_tokens
            ) / Decimal(1_000_000)
        except (KeyError, InvalidOperation):
            return None
