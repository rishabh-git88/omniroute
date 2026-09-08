from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ContractModel(BaseModel):
    """Base for wire contracts shared with the TypeScript services."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
    )


class CanonicalMessage(ContractModel):
    role: Literal["system", "user", "assistant"]
    content: Annotated[str, Field(min_length=1)]


class ContextBundle(ContractModel):
    """Provider-neutral context assembled by the main application."""

    messages: Annotated[list[CanonicalMessage], Field(min_length=1)]
    source_ids: list[UUID] = []
    summary_version: Annotated[int, Field(gt=0)] | None = None
    token_estimate: Annotated[int, Field(ge=0)]


class CanonicalChatRequest(ContractModel):
    """Provider-neutral request. No provider SDK types may cross this boundary."""

    context: ContextBundle
    context_snapshot_id: UUID
    max_output_tokens: Annotated[int, Field(gt=0)]
    model_key: Annotated[str, Field(min_length=1)]
    provider: Literal["fake", "openai", "anthropic", "gemini"]
    run_id: UUID
    temperature: Annotated[float, Field(ge=0, le=2)] | None = None


class RegistryModelSnapshot(ContractModel):
    """The reviewed Model Registry entry selected by Nest before provider execution."""

    provider: Literal["openai", "anthropic", "gemini"]
    provider_model_id: Annotated[str, Field(min_length=1)]
    registry_version: Annotated[int, Field(gt=0)]
    capabilities: dict[str, object]
    pricing_version: Annotated[str, Field(min_length=1)]


class ProviderExecutionPlan(ContractModel):
    """A canonical request plus its immutable registry snapshot; no SDK types cross it."""

    request: CanonicalChatRequest
    model: RegistryModelSnapshot


class FallbackExecutionRequest(ContractModel):
    """Pre-authorized plans supplied by Nest; every plan has its own durable run/reservation."""

    primary: ProviderExecutionPlan
    fallbacks: list[ProviderExecutionPlan] = []
    allow_fallback: bool = False
    user_selected_model: bool = False
    fallback_disclosed: bool = False


class FallbackEvent(ContractModel):
    type: Literal["fallback.started", "fallback.exhausted"]
    run_id: UUID
    previous_run_id: UUID | None = None
    failure_class: str
    provider: str | None = None
    model_key: str | None = None


class NormalizedUsage(ContractModel):
    input_tokens: Annotated[int, Field(ge=0)] | None = None
    output_tokens: Annotated[int, Field(ge=0)] | None = None


class ProviderHealth(ContractModel):
    provider: Literal["openai", "anthropic", "gemini"]
    status: Literal["disabled", "ready", "unavailable"]


class ProviderEvent(ContractModel):
    """Normalized event emitted by every adapter and suitable for router SSE."""

    type: Literal[
        "run.started",
        "content.delta",
        "usage.updated",
        "run.completed",
        "run.failed",
    ]
    run_id: UUID
    provider_request_id: str | None = None
    text: str | None = None
    input_tokens: Annotated[int, Field(ge=0)] | None = None
    output_tokens: Annotated[int, Field(ge=0)] | None = None
    finish_reason: str | None = None
    code: str | None = None
    message: str | None = None
    retryable: bool | None = None


TaskCategory = Literal[
    "coding",
    "debugging",
    "architecture",
    "writing",
    "summarization",
    "research",
    "reasoning",
    "general",
    "multimodal",
    "long-context",
]
RoutingMode = Literal["economy", "smart", "max"]


class RoutingModelSnapshot(ContractModel):
    """Dynamic Model Registry data. Scores/costs are configuration, never router constants."""

    registry_entry_id: UUID
    provider: Literal["openai", "anthropic", "gemini", "fake"]
    model_key: Annotated[str, Field(min_length=1)]
    provider_model_id: Annotated[str, Field(min_length=1)]
    registry_version: Annotated[int, Field(gt=0)]
    enabled: bool
    capabilities: dict[str, object]
    pricing: dict[str, object] | None = None
    pricing_version: str | None = None
    latency: dict[str, object] | None = None


class ProviderHealthSnapshot(ContractModel):
    provider: Literal["openai", "anthropic", "gemini", "fake"]
    status: Literal["ready", "degraded", "unavailable", "disabled"]
    latency_ms: Annotated[int, Field(ge=0)] | None = None


class RoutingRequest(ContractModel):
    request_group_id: UUID
    prompt: Annotated[str, Field(min_length=1, max_length=20_000)]
    mode: RoutingMode = "smart"
    requested_mode: Literal["single", "compare"] = "single"
    models: Annotated[list[RoutingModelSnapshot], Field(min_length=1)]
    provider_health: list[ProviderHealthSnapshot] = []
    context_tokens: Annotated[int, Field(ge=0)] = 0
    max_output_tokens: Annotated[int, Field(gt=0)] = 512
    requires_tools: bool = False
    requires_multimodal: bool = False
    user_preferred_provider: str | None = None
    user_preferred_model: str | None = None


class RoutingCandidate(ContractModel):
    provider: str
    model_key: str
    registry_entry_id: UUID
    score: float
    reason: str
    estimated_cost: str | None = None
    pricing_version: str | None = None


class RoutingDecision(ContractModel):
    request_group_id: UUID
    task_category: TaskCategory
    selected_provider: str
    selected_model: str
    selected_registry_entry_id: UUID
    routing_score: float
    reason: str
    fallback_candidates: list[RoutingCandidate]
    estimated_cost: str | None = None
    pricing_version: str | None = None
