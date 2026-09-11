from collections.abc import AsyncIterator
from contextlib import aclosing
from secrets import compare_digest

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.contracts import (
    FallbackEvent,
    FallbackExecutionRequest,
    ProviderEvent,
    ProviderExecutionPlan,
    ProviderHealth,
    RoutingDecision,
    RoutingRequest,
)
from app.execution import execute
from app.models import HealthResponse
from app.providers.registry import ProviderRegistry
from app.routing import DeterministicRouter

settings = get_settings()
providers = ProviderRegistry(settings)
router = DeterministicRouter()

app = FastAPI(
    description=(
        "Provider-neutral orchestration boundary. Provider SDK and HTTP details remain "
        "inside adapter modules."
    ),
    docs_url="/docs" if settings.log_level == "debug" else None,
    redoc_url=None,
    title="OmniRoute AI Router",
    version="0.1.0",
)


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    return HealthResponse.current()


@app.get("/health/live", response_model=HealthResponse, tags=["health"])
def liveness() -> HealthResponse:
    return HealthResponse.current()


@app.get("/health/ready", response_model=HealthResponse, tags=["health"])
def readiness() -> HealthResponse:
    return HealthResponse.current()


async def internal_auth(request: Request) -> None:
    token = settings.internal_token
    supplied = request.headers.get("authorization", "")
    if len(token) < 32 or not compare_digest(supplied.encode(), f"Bearer {token}".encode()):
        raise HTTPException(status_code=401, detail="Internal service authentication required")


@app.get(
    "/providers/health",
    response_model=list[ProviderHealth],
    tags=["providers"],
    dependencies=[Depends(internal_auth)],
)
async def provider_health() -> list[ProviderHealth]:
    """Reports only enabled/readiness state; credentials are neither returned nor logged."""
    return await providers.health()


@app.post("/providers/generate", tags=["providers"], dependencies=[Depends(internal_auth)])
async def generate(plan: ProviderExecutionPlan) -> dict[str, object]:
    content = ""
    usage: dict[str, object] = {}
    async for event in execute(plan, providers, settings):
        if event.type == "content.delta":
            content += event.text or ""
        elif event.type == "usage.updated":
            usage = {"inputTokens": event.input_tokens, "outputTokens": event.output_tokens}
        elif event.type == "run.failed":
            raise HTTPException(status_code=502, detail=event.code)
    return {"content": content, "usage": usage}


@app.post("/providers/stream", tags=["providers"], dependencies=[Depends(internal_auth)])
async def stream(plan: ProviderExecutionPlan) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        async with aclosing(execute(plan, providers, settings)) as execution:
            async for event in execution:
                yield encode_event(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache, no-transform", "x-accel-buffering": "no"},
    )


def encode_event(event: ProviderEvent) -> str:
    return (
        f"event: {event.type}\ndata: {event.model_dump_json(by_alias=True, exclude_none=True)}\n\n"
    )


def encode_fallback_event(event: ProviderEvent | FallbackEvent) -> str:
    return (
        f"event: {event.type}\ndata: {event.model_dump_json(by_alias=True, exclude_none=True)}\n\n"
    )


@app.post("/providers/fallback-stream", tags=["providers"], dependencies=[Depends(internal_auth)])
async def fallback_stream(request: FallbackExecutionRequest) -> StreamingResponse:
    raise HTTPException(status_code=501, detail="Fallback execution is not enabled")


@app.post(
    "/routing/decisions",
    response_model=RoutingDecision,
    tags=["routing"],
    dependencies=[Depends(internal_auth)],
)
def decide(request: RoutingRequest) -> RoutingDecision:
    """Pure deterministic selection over main-app registry/health snapshots; no provider call."""
    try:
        return router.route(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
