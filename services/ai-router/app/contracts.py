import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class ContractModel(BaseModel):
    """Base for wire contracts shared with the TypeScript services."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
    )


def canonical_uuid(value: object) -> object:
    pattern = (
        r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
        r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|"
        r"00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)"
    )
    if not isinstance(value, str) or re.fullmatch(pattern, value) is None:
        raise ValueError("Invalid canonical UUID")
    return value


CanonicalUUID = Annotated[UUID, BeforeValidator(canonical_uuid)]


class CanonicalWireModel(ContractModel):
    model_config = ConfigDict(
        alias_generator=to_camel, extra="forbid", populate_by_name=False, validate_by_name=False
    )

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if isinstance(value, dict) and any(item is None for item in value.values()):
            raise ValueError("Canonical fields may be omitted, but not null")
        if isinstance(value, dict):
            value = dict(value)
            for key in ("version", "summaryVersion", "tokenEstimate", "maxOutputTokens"):
                item = value.get(key)
                if isinstance(item, float) and item.is_integer():
                    value[key] = int(item)
        return value


class CanonicalMessage(CanonicalWireModel):
    role: Literal["system", "user", "assistant"]
    content: Annotated[str, Field(min_length=1)]


class ContextSource(CanonicalWireModel):
    id: CanonicalUUID
    file_id: CanonicalUUID | None = None
    kind: Literal["turn", "response", "memory", "file_chunk"]
    content_hash: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    included: Annotated[bool, Field(strict=True)]
    version: Annotated[int, Field(gt=0, le=9007199254740991, strict=True)] | None = None


class ContextBundle(CanonicalWireModel):
    """Provider-neutral context assembled by the main application."""

    messages: Annotated[list[CanonicalMessage], Field(min_length=1)]
    source_ids: list[CanonicalUUID]
    provenance: list[ContextSource] | None = None
    retrieval: Literal["semantic", "lexical", "unavailable", "empty"] | None = None
    summary_version: Annotated[int, Field(gt=0, le=9007199254740991, strict=True)] | None = None
    token_estimate: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)]


class CanonicalChatRequest(CanonicalWireModel):
    """Provider-neutral request. No provider SDK types may cross this boundary."""

    context: ContextBundle
    context_snapshot_id: CanonicalUUID
    max_output_tokens: Annotated[int, Field(gt=0, le=9007199254740991, strict=True)]
    model_key: Annotated[str, Field(min_length=1)]
    provider: Literal["fake", "openai", "anthropic", "gemini", "groq", "openrouter"]
    run_id: CanonicalUUID
    temperature: Annotated[float, Field(ge=0, le=2, strict=True)] | None = None


class RegistryModelSnapshot(CanonicalWireModel):
    """The reviewed Model Registry entry selected by Nest before provider execution."""

    provider: Literal["openai", "anthropic", "gemini", "groq", "openrouter"]
    provider_model_id: Annotated[str, Field(min_length=1)]
    registry_version: Annotated[int, Field(gt=0, le=9007199254740991, strict=True)]
    capabilities: dict[str, object]
    pricing_version: Annotated[str, Field(min_length=1)]


class ProviderExecutionPlan(CanonicalWireModel):
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
    total_tokens: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)] | None = None
    input_tokens: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)] | None = None
    output_tokens: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)] | None = None


HealthStatus = Literal[
    "disabled",
    "enabled",
    "missing_credentials",
    "temporarily_unhealthy",
    "rate_limited",
    "timed_out",
    "available",
    "ready",
    "degraded",
    "unavailable",
]


class ProviderHealth(ContractModel):
    provider: Literal["openai", "anthropic", "gemini", "groq", "openrouter"]
    status: HealthStatus
    latency_ms: int | None = None


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
    input_tokens: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)] | None = None
    output_tokens: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)] | None = None
    total_tokens: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)] | None = None
    usage_final: bool | None = None
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
    "structured-data",
]
RoutingMode = Literal["economy", "smart", "max"]


class RoutingModelSnapshot(ContractModel):
    """Dynamic Model Registry data. Scores/costs are configuration, never router constants."""

    registry_entry_id: UUID
    provider: Literal["openai", "anthropic", "gemini", "groq", "openrouter", "fake"]
    model_key: Annotated[str, Field(min_length=1)]
    provider_model_id: Annotated[str, Field(min_length=1)]
    registry_version: Annotated[int, Field(gt=0, le=9007199254740991, strict=True)]
    enabled: bool
    capabilities: dict[str, object]
    pricing: dict[str, object] | None = None
    pricing_version: str | None = None
    latency: dict[str, object] | None = None
    region_constraints: list[str] = []


class ProviderHealthSnapshot(ContractModel):
    provider: Literal["openai", "anthropic", "gemini", "groq", "openrouter", "fake"]
    status: HealthStatus
    latency_ms: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)] | None = None


class RoutingRequest(ContractModel):
    request_group_id: UUID
    prompt: Annotated[str, Field(min_length=1, max_length=20_000)]
    mode: RoutingMode = "smart"
    requested_mode: Literal["single", "compare"] = "single"
    models: Annotated[list[RoutingModelSnapshot], Field(min_length=1)]
    provider_health: list[ProviderHealthSnapshot] = []
    context_tokens: Annotated[int, Field(ge=0, le=9007199254740991, strict=True)] = 0
    max_output_tokens: Annotated[int, Field(gt=0, le=9007199254740991, strict=True)] = 512
    requires_tools: bool = False
    region: str | None = None
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
