"""Socket integration fixture only. Never packaged or imported by the router application."""

import os
import socket
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402

import app.main as main  # noqa: E402
from app.config import Settings  # noqa: E402
from app.providers.adapters import AnthropicAdapter, GeminiAdapter, OpenAIAdapter  # noqa: E402
from app.providers.registry import ProviderRegistry  # noqa: E402

assert os.environ.get("NODE_ENV") == "test"
upstream = os.environ["TEST_OPENAI_URL"]
assert urlsplit(upstream).hostname == "127.0.0.1"
OpenAIAdapter.api_url = upstream
AnthropicAdapter.api_url = upstream + "/anthropic"
GeminiAdapter.api_url = upstream + "/gemini"
main.settings = Settings(
    internal_token=os.environ["AI_ROUTER_INTERNAL_TOKEN"],
    enable_openai=True,
    enable_anthropic=True,
    enable_gemini=True,
    anthropic_api_key="synthetic-provider-key",
    gemini_api_key="synthetic-provider-key",
    health_cooldown_seconds=0,
    openai_api_key="synthetic-provider-key",
    request_timeout_seconds=0.5,
)
main.providers = ProviderRegistry(main.settings)
listener = socket.socket()
listener.bind(("127.0.0.1", 0))
listener.listen(128)
print(f"PORT={listener.getsockname()[1]}", flush=True)
uvicorn.Server(uvicorn.Config(main.app, log_level="critical", access_log=False)).run(
    sockets=[listener]
)
