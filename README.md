# OmniRoute

OmniRoute is a provider-neutral multi-LLM conversation workspace. This repository is a polyglot monorepo containing a Next.js web app, a NestJS product API, and a FastAPI AI orchestration boundary.

## Prerequisites

- Node.js 24 LTS (the workspace remains compatible with Node.js 22.12+)
- pnpm 12
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Docker with Docker Compose

## Local setup

```bash
cp .env.example .env
pnpm install
uv sync --project services/ai-router --all-groups
pnpm infra:up
pnpm dev
```

The example configuration contains local-only placeholders, never production credentials. Keep `.env` untracked.

## Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm typecheck
pnpm infra:up
pnpm infra:down
```

The web app listens on port 3000, the NestJS API on port 4000, and the FastAPI router on port 8001 by default.
