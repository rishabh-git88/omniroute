from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    service: Literal["ai-router"] = "ai-router"
    status: Literal["ok"] = "ok"
    timestamp: datetime
    version: str = "0.1.0"

    @classmethod
    def current(cls) -> "HealthResponse":
        return cls(timestamp=datetime.now(UTC))
