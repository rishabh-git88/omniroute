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


class CanonicalChatRequest(ContractModel):
    """Provider-neutral request. No provider SDK types may cross this boundary."""

    context_snapshot_id: UUID
    max_output_tokens: Annotated[int, Field(gt=0)]
    messages: Annotated[list[CanonicalMessage], Field(min_length=1)]
    model_key: Annotated[str, Field(min_length=1)]
    provider: Literal["fake", "openai", "anthropic", "gemini"]
    run_id: UUID
    temperature: Annotated[float, Field(ge=0, le=2)] | None = None
