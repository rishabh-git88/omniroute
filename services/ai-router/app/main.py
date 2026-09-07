from fastapi import FastAPI

from app.config import get_settings
from app.models import HealthResponse

settings = get_settings()

app = FastAPI(
    description=(
        "Provider-neutral orchestration boundary. Provider execution is intentionally "
        "not implemented in Phase 1."
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
