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

USER omniroute
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
