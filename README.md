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

Google sign-in additionally requires a Web OAuth client. Add its client ID and
secret to `.env`, generate `AUTH_SESSION_SECRET` with
`openssl rand -base64 48`, and register this redirect URI in Google Cloud:

```text
http://localhost:4000/v1/auth/google/callback
```

Then open `http://localhost:3000/login`. OAuth credentials and the session secret
are consumed only by NestJS and are never included in the browser bundle.

## Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm typecheck
pnpm infra:up
pnpm infra:down
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:test
```

The web app listens on port 3000, the NestJS API on port 4000, and the FastAPI router on port 8001 by default.
git commit -m "feat: establish OmniRoute monorepo foundation"

## Database workflow

PostgreSQL is the durable source of truth. The initial migration enables
pgvector, creates the core domain schema, and installs database-level branch,
tenant, registry, and credit-ledger invariants. After `pnpm infra:up`, run:

```bash
pnpm db:migrate
pnpm db:seed
```

Database integration tests use the separate tmpfs instance in
`compose.integration.yaml`, with a restricted role and marked disposable
databases. `pnpm db:test` checks both environment URLs and the actual server
identity before migrations or destructive fixtures. A development, production,
unknown, or missing test target fails closed; an inherited development
`DATABASE_URL` is rejected even when `DATABASE_TEST_URL` is safe. The legacy
`omniroute_test` database is not used.

Follow [Database Verification](docs/engineering/Database-Verification.md) for
isolated setup, fresh/upgrade migration checks, reviewed registry seeds, and the
complete release commands. Production web builds need an explicit valid API
origin, for example `NEXT_PUBLIC_API_URL=https://api.ci.invalid pnpm build` for
synthetic verification. The execution configuration, verification approach, and
remaining limitations are documented in
[Authenticated Single-Provider Execution](docs/decisions/ADR-013-Authenticated-Single-Provider-Execution.md).
