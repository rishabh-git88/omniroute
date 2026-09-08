from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
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
from app.fallback import FallbackExecutor
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


@app.get("/providers/health", response_model=list[ProviderHealth], tags=["providers"])
async def provider_health() -> list[ProviderHealth]:
    """Reports only enabled/readiness state; credentials are neither returned nor logged."""
    return await providers.health()


@app.post("/providers/generate", tags=["providers"])
async def generate(plan: ProviderExecutionPlan) -> dict[str, object]:
    try:
        content, usage = await providers.for_plan(plan).generate(plan)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {"content": content, "usage": usage.model_dump(by_alias=True, exclude_none=True)}


@app.post("/providers/stream", tags=["providers"])
async def stream(plan: ProviderExecutionPlan) -> StreamingResponse:
    adapter = providers.for_plan(plan)

    async def events() -> AsyncIterator[str]:
        try:
            async for event in adapter.stream(plan):
                yield encode_event(event)
        except (RuntimeError, ValueError) as error:
            yield encode_event(
                ProviderEvent(
                    type="run.failed",
                    run_id=plan.request.run_id,
                    code="PROVIDER_UNAVAILABLE",
                    message=str(error),
                    retryable=False,
                )
            )

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


@app.post("/providers/fallback-stream", tags=["providers"])
async def fallback_stream(request: FallbackExecutionRequest) -> StreamingResponse:
    """Streams an explicit fallback transition only after a pre-output classified failure."""
    plans = [request.primary, *request.fallbacks]
    executor = FallbackExecutor({plan.model.provider: providers.for_plan(plan) for plan in plans})

    async def events() -> AsyncIterator[str]:
        try:
            async for event in executor.stream(request):
                yield encode_fallback_event(event)
        except ValueError as error:
            yield encode_fallback_event(
                FallbackEvent(
                    type="fallback.exhausted",
                    run_id=request.primary.request.run_id,
                    failure_class=str(error),
                )
            )

    return StreamingResponse(events(), media_type="text/event-stream")


@app.post("/routing/decisions", response_model=RoutingDecision, tags=["routing"])
def decide(request: RoutingRequest) -> RoutingDecision:
    """Pure deterministic selection over main-app registry/health snapshots; no provider call."""
    try:
        return router.route(request)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
