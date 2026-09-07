from fastapi.routing import APIRoute

from app.main import app, liveness


def test_liveness() -> None:
    response = liveness()

    assert response.service == "ai-router"
    assert response.status == "ok"
    assert any(isinstance(route, APIRoute) and route.path == "/health/live" for route in app.routes)
