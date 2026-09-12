FROM python:3.14.4-slim AS build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_NO_CACHE_DIR=1
WORKDIR /build

COPY services/ai-router/pyproject.toml ./
COPY services/ai-router/app ./app

RUN python -m pip install --prefix=/install .

FROM python:3.14.4-slim AS runtime

ENV AI_ROUTER_HOST=0.0.0.0
ENV AI_ROUTER_PORT=8001
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN groupadd --system --gid 1001 omniroute \
  && useradd --system --uid 1001 --gid omniroute omniroute

COPY --from=build /install /usr/local
COPY --chown=omniroute:omniroute services/ai-router/app ./app
# Guarded evaluation is a manual administrative command, never an HTTP route.
COPY --chown=omniroute:omniroute services/ai-router/scripts ./scripts
COPY --chown=omniroute:omniroute config/model-registry ./config/model-registry

USER omniroute
EXPOSE 8001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health/ready', timeout=2)"
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host \"$AI_ROUTER_HOST\" --port \"$AI_ROUTER_PORT\""]
