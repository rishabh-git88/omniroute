# Current Sprint: Phase 1 Foundation

#roadmap

## Sprint goal

Establish a production-oriented polyglot monorepo foundation without implementing provider calls, billing, authentication, persistence repositories, or complex routing. Preserve the state ownership rules in [[ADR-002-PostgreSQL]] and [[ADR-003-AI-Router]] while applying the separate router boundary accepted in [[ADR-004-FastAPI-Router-Service]].

## Implemented scope

- pnpm workspace and Turborepo orchestration for root development commands.
- Shared strict TypeScript configuration, ESLint, Prettier, Vitest, pytest, Ruff, and mypy conventions.
- Next.js 16 App Router and Tailwind CSS workspace shell under `apps/web`.
- NestJS 12/Fastify API under `apps/api`.
- FastAPI/Pydantic AI Router foundation under `services/ai-router`.
- Shared `config`, `types`, `ui`, and provider-neutral contract packages.
- Validated server-side environment configuration and a secret-free `.env.example`.
- Liveness/readiness endpoints for the web, API, and AI Router.
- Multi-stage, non-root Dockerfiles for all three deployables.
- Docker Compose configuration for PostgreSQL 18 with pgvector and intentionally ephemeral Redis 8.
- An opt-in Compose `application` profile for the complete local stack.

## Verification status

- Dependency installation and JavaScript/Python lockfiles: complete.
- Type checking: complete across all workspaces.
- Linting and formatting checks: complete across all workspaces.
- Unit, contract, and API health tests: complete.
- Production builds: complete for web, API, shared packages, and AI Router wheel.
- Real HTTP health checks: complete for web, API, and AI Router.
- Compose schema validation: complete.
- PostgreSQL/pgvector and Redis runtime checks: pending because the current execution environment cannot connect to its Docker daemon.

## Architectural boundaries established

- Browser traffic terminates at Next.js/NestJS; the FastAPI router is an internal service.
- NestJS owns product state, authorization, context snapshots, durable run state, and future credit transactions.
- FastAPI owns future provider-neutral orchestration and provider adapters, but cannot mutate canonical conversation or credit records directly.
- PostgreSQL remains the durable system of record. Enabling pgvector does not enable semantic retrieval by default.
- Redis is limited to rate limits, versioned caches, ephemeral orchestration/provider-health state, and streaming coordination.
- No provider SDK is installed and no provider call is implemented in this phase.

## Next sprint

- Choose and integrate Prisma or an approved alternative without weakening explicit SQL/transaction requirements.
- Implement the identity, workspace, and conversation skeleton schema and initial migration.
- Decide Google OAuth/session ownership and create the authentication ADR.
- Add service authentication and a version handshake between NestJS and the AI Router.
- Generate TypeScript and Pydantic models from one canonical contract source and add drift checks.
- Add Redis-backed rate-limit/provider-health primitives only when their consuming features begin.

## Open Questions

- Which internal service-authentication mechanism protects NestJS-to-router requests?
- Is the initial ORM implementation Prisma 7, Prisma 8, or another explicitly approved version?
- When are the background worker and object-storage emulator introduced?
- What initial schema precisely represents branches, registry versions, and credit wallets?
