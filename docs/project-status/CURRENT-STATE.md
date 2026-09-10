# OmniRoute Current State

Planning reset: 2026-09-10. Overall status: **PARTIAL**. OmniRoute has substantial
foundations and passing local checks, but its required production product is not
complete. The connected conversation executor still uses a NestJS mock provider;
the live FastAPI adapters are not connected to that product path.

Read alongside [RELEASE-SCOPE](RELEASE-SCOPE.md),
[RELEASE-BLOCKERS](RELEASE-BLOCKERS.md), and
[NEXT-MILESTONE](NEXT-MILESTONE.md).

## Evidence and freshness

This is the planning translation of the complete 25-section OmniRoute audit
delivered in the preceding conversation. No standalone complete audit file was
found in the repository. Retained local audit evidence is under
`/tmp/omniroute-audit-20260909/`; that temporary directory is not a durable or
portable repository dependency. This document preserves the important results
and their limits without copying environment values or raw authentication logs.

The audit examined the working tree based on commit
`e5875e7b7b16d8dea3f6036c6c1a53c4600420c2`, including its then-uncommitted changes.
At this planning reset, branch `fix/vercel-frontend-release` points to
`8d5889be7b2b7d319c9afe9d5b859d3d5e4996e1` (`chore: checkpoint audited pre-release
state`). The working tree was clean before creating these documents. All 198
entries in the retained audit hash baseline match the current files. The earlier
report of 14 uncommitted paths is therefore historical, not current.

This task re-read project guidance, relevant documentation, source, retained
verification summaries, and Git state. It did not rerun application tests,
builds, migrations, containers, live OAuth, provider calls, or cloud checks.
Source findings carry forward because the audited files match. Database,
container, GitHub, and deployment observations remain dated audit observations;
their present external state has not been rechecked.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| COMPLETE | The precisely named capability exists and reasonable verification passed. Its stated scope matters; a passing helper test does not complete its subsystem. |
| PARTIAL | Useful implementation exists, but required integration, behavior, or evidence is missing. |
| BROKEN | A concrete defect or failed check prevents the named behavior. |
| NOT STARTED | No implementation of the named requirement was found in the repository. This does not assert that unknown external cloud resources do not exist. |
| BLOCKED | A specific prerequisite prevents verification or progress; the prerequisite is identified. This is not evidence of success or failure. |

Audit items previously described as unverified map to PARTIAL when code exists
but evidence is incomplete, or BLOCKED when a named external prerequisite
prevents a check. Absence of AWS implementation maps to NOT STARTED, independently
of whether unknown external deployments can be inspected. No completion estimate
is used as a release gate.

## Actual repository architecture

```text
apps/
  web/                         Next.js App Router frontend
    app/                       landing, login, chat, auth state, stream UI
    proxy.ts                   route protection
  api/                         NestJS/Fastify product API
    src/
      identity/                Google OAuth, sessions, authorization, CSRF
      conversations/           commands, persistence, mock execution, SSE
      context/                 branch context, summaries, local embeddings
      files/                   synchronous text upload and chunk storage
      usage/                   wallet, ledger, reservations, billing
      model-registry/          database registry reads
      providers/               NestJS MockProvider
      database/                Prisma service and integration tests
      analytics/               feedback repository
      observability/           logging, telemetry, metrics foundations
    prisma/                    schema, seed, two migrations
services/
  ai-router/app/               FastAPI, routing, fallback, provider adapters
packages/
  config/                      environment schemas
  types/                       shared types
  ui/                          shared UI foundation
  provider-contracts/          canonical contracts and JSON Schema
infrastructure/
  docker/                      web, API, router Dockerfiles
  postgres/init/               pgvector and local test database setup
.github/workflows/ci.yml        CI only; no AWS CD workflow
compose.yaml                   local PostgreSQL/Redis and application profile
```

The active product path is browser → NestJS → context/database/credits → NestJS
`MockProvider` → in-process SSE. FastAPI has standalone routing and provider
endpoints, but no connected NestJS execution client was found. `AI_ROUTER_URL`
and `REDIS_URL` configuration do not establish runtime integration. No S3 client,
AWS IaC, ECS deployment, Secrets Manager integration, or OIDC CD implementation
was found.

## Verified foundations

These narrow capabilities are COMPLETE at the audited source state, with the
limits below. They do not certify full product flows.

| Capability | Status | Audit evidence and limit |
| --- | --- | --- |
| Locked dependency installation | COMPLETE | Frozen pnpm installation and frozen Python dependency synchronization passed in an isolated copy after initial network failures. |
| Local lint and formatting | COMPLETE | Final retry passed all 11 Turbo tasks, Prettier checks, and Ruff checks. The earlier failed download log is not the final lint result. |
| Local type checks | COMPLETE | All 11 Turbo tasks passed; mypy checked 16 source files. |
| Existing unit/contract suites | COMPLETE | 20 TS/JS tests and 22 Python tests passed. Some packages contain no tests. Database integration and full browser flows are not included. |
| Configured production source build | COMPLETE | All seven root build tasks passed with an explicit public API URL. This did not prove the browser used that URL correctly. |
| Prisma schema tooling | COMPLETE | Schema validation and client generation passed. This does not establish migration alignment or relational invariants at runtime. |
| Compose syntax validation | COMPLETE | `docker compose --profile application config --quiet` passed. Production images were not built during the audit. |
| Local public landing route | COMPLETE | Current-source production server returned HTTP 200 for `/`; browser hydration rendered the landing page. Server HTML initially showed the auth loading state. Production deployment remains a separate gate. |
| Basic API health/auth rejection | COMPLETE | Local liveness/readiness returned 200 and unauthenticated `auth/me` returned 401. Readiness did not detect the pending migration. |

Retained summaries: `lint-install-retry.log`, `typecheck.log`, `test.log`,
`build-root-configured.log`, and `build-no-env.log` in the audit evidence directory.

## Required product feature matrix

Each row has exactly one current status. The final column identifies the
dependency-ordered backlog item that owns completion.

| Required capability | Status | What exists / what prevents release | Backlog |
| --- | --- | --- | --- |
| Production public landing experience | PARTIAL | Local public route and landing UI work; public pages still fetch `auth/me`, initially render loading, and lack favicon/icon assets. Deployed behavior is not established. | R02, R12, R16 |
| Google authentication | PARTIAL | OAuth/PKCE/state/nonce and session/CSRF code exist. Live callback/session flow and production cookie domains are not validated; redirect and logging defects remain. | R02 |
| Conversations | PARTIAL | Create/list/detail/selection repositories and endpoints exist; a complete authenticated persistence flow was not verified. | R03, R04, R12 |
| Persisted messages | PARTIAL | Turns, runs, responses, and selected heads exist in Prisma. Partial output is lost on execution failure, and terminal accounting/state can diverge. | R03, R04, R06 |
| Streaming | BROKEN | CORS omits required headers; raw SSE handling drops headers; replay ignores event position; the UI is not isolated per run. | R02, R09 |
| OpenAI product execution | PARTIAL | Python adapter and synthetic tests exist; NestJS calls only the mock. No live smoke result. | R07, R08 |
| Anthropic product execution | PARTIAL | Adapter exists but initial input usage is lost; no connected product execution or live smoke result. | R07, R08 |
| Gemini product execution | PARTIAL | Adapter exists but output-cap configuration is omitted; no connected product execution or live smoke result. | R07, R08 |
| Economy mode | PARTIAL | Router cost ordering exists; zero cost is treated as missing. UI selection is not submitted to the router. | R07, R10 |
| Smart mode | PARTIAL | Scoring exists in isolation; registry/health integration and UI-to-router behavior are incomplete. | R07, R10 |
| Max mode | PARTIAL | Quality-first branch exists; end-to-end mode execution and sufficient targeted evidence are missing. | R07, R10 |
| Compare 3 | PARTIAL | Domain schema and comparison-related structures exist; the UI creates SINGLE conversations and has no complete three-run loop. | R09, R10 |
| Try Another AI | PARTIAL | Alternate-run/selection code exists; model choice, replay, per-run UI state, and frozen context guarantees are incomplete. | R05, R09, R10 |
| Automatic provider fallback | PARTIAL | Standalone synthetic fallback tests pass; disabled-provider exceptions and premature stream endings are mishandled; NestJS is disconnected. | R07, R08, R10 |
| Provider-neutral context | BROKEN | Canonical bundle/branch traversal exist, but prior assistant text precedes its user prompt; token budgets and retrieval degradation are incomplete. | R05 |
| Frozen context snapshots | PARTIAL | Snapshot metadata/hashes exist; immutable recoverable input is not fully stored, and alternatives rebuild context from mutable workspace state. | R05 |
| Usage credits | PARTIAL | Exact arithmetic, wallet locks, append-only ledger, grants/reserve/settle/release primitives exist. Normal mock runs are free and emit no meaningful usage; concurrency/recovery is not verified. | R04, R06, R08 |
| Workspace memory | PARTIAL | Text chunking, deterministic local vectors, pgvector retrieval, memories and summaries exist. Quality, readiness filters, budgets, object lifecycle, and isolation evidence are incomplete. | R05, R11 |
| TXT uploads | BROKEN | Text upload code exists; raw Prisma BigInt response serialization fails and body-size limits disagree. No durable S3 object path. | R11 |
| Markdown uploads | BROKEN | Text ingestion is the foundation, with the same serialization/storage/limit defects; a complete Markdown acceptance flow is missing. | R11 |
| PDF uploads | NOT STARTED | No PDF extraction pipeline was found. | R11 |

## Platform and operational matrix

| Subsystem or gate | Status | Evidence / missing prerequisite | Backlog |
| --- | --- | --- | --- |
| Next.js frontend overall | PARTIAL | Landing, login, shell, composer, sidebar, settings, and credits presentation exist; release interaction and environment defects remain. | R02, R09, R10, R12 |
| Production browser API configuration | BROKEN | Dynamic `parseWebEnvironment(process.env)` does not inline the public URL into the browser bundle; the audited configured bundle retained the localhost fallback. | R02 |
| Unconfigured build/runtime handling | BROKEN | Root build without `NEXT_PUBLIC_API_URL` failed on `/login`; configured standalone build returned login 500 when runtime configuration was omitted. CI root build and Docker runtime provisioning are incomplete. | R01, R02 |
| NestJS API overall | PARTIAL | Bootstrap, validation, CORS, identity, repositories, health, logging, and shutdown hooks exist; orchestration, limits, execution recovery, and browser flows remain incomplete. | R02–R09 |
| FastAPI AI Router overall | PARTIAL | Analyzer, registry/scoring, adapters and fallback exist; service auth, actual health, production event handling, and integration are incomplete. | R07, R08 |
| Prisma/PostgreSQL domain model | PARTIAL | 30 domain models and SQL constraints cover identity, branches, runs, usage, credits, files, memory, feedback, and future entitlements. Integration evidence remains missing. | R03, R04 |
| Audited development schema alignment | BROKEN | Core migration was applied; workspace-memory migration was pending and `memories.source_hash` absent. This is the last observed DB state, not a fresh check. | R03 |
| Safe database integration verification | BLOCKED | Existing suites truncate data; the available test database contained a user. A disposable database is required. Prior CI failed importing packages before integration tests executed. | R01, R03 |
| Local PostgreSQL/pgvector service | COMPLETE | Audit verified connection, PostgreSQL 18.6, pgvector 0.8.6, and applied core migration checksum. No RDS claim. | R03 for remaining database work |
| Local Redis container health | COMPLETE | Existing local container was healthy at audit time. No application integration claim. | R13 for consuming functionality |
| Application Redis/Valkey functionality | NOT STARTED | No runtime cache, rate-limit, distributed stream, health, or locking client was found; current event storage is process-local. | R13 |
| S3 file storage | NOT STARTED | No S3-backed upload/object access/lifecycle implementation was found. | R11, R14 |
| CI release gate | BROKEN | Last inspected GitHub run failed frontend, backend, and integration jobs on missing built workspace exports; build job was skipped. | R01 |
| Docker image verification | BLOCKED | Build checks were stopped at the user's request; existing image presence does not verify the current three Dockerfiles. | R01 |
| Observability | PARTIAL | Structured logging, request IDs, optional Node OpenTelemetry and metrics foundations exist. Secret-safe OAuth URL logging, CloudWatch delivery, alerts, and cross-service correlation are incomplete. | R02, R15 |
| Vercel deployment readiness | PARTIAL | A historical successful deployment status exists, but its inspected URL redirected to Vercel SSO; public runtime behavior and current release revision were not verified. | R02, R14, R16 |
| Production browser acceptance | BLOCKED | An accessible representative deployment and completed environment/auth integration are required. | R14, R16 |
| AWS deployment implementation | NOT STARTED | No IaC or AWS CD implementation for ECS/Fargate, RDS, ElastiCache, S3, Secrets Manager, ALB, CloudWatch, or OIDC was found. | R14, R15 |
| AWS deployed-state verification | BLOCKED | No authenticated AWS inventory or accessible deployment evidence was available. Repository absence alone cannot prove account resources are absent. | R14, R16 |

## Concrete defects retained from the audit

- Browser networking: missing `idempotency-key` in allowed CORS headers, missing
  SSE CORS headers after reply hijacking, and client API-origin substitution.
- Context: reversed user/assistant history; snapshots cannot reproduce exact
  input; alternatives can incorporate subsequent workspace changes.
- Streaming: old events replay for alternate runs, event position is ignored,
  terminal handling is not group-safe, and process-local state cannot support
  replica changes or restart recovery.
- Uploads: successful service results contain BigInt and fail JSON serialization;
  advertised text size exceeds the default Fastify request-body limit; file
  readiness is not required before retrieval.
- Providers: normalized failure can become an empty successful `generate()`
  result; EOF may omit terminal failure; disabled primary validation escapes
  fallback; Anthropic input usage and Gemini output limits are incomplete.
- Accounting: response/run completion precedes settlement in a separate
  transaction; later settlement failure can mark the run failed and release its
  reservation. Partial provider output is discarded and fully released.
- Auth/security: return-path validation accepts a slash/backslash redirect form;
  default request logging retained synthetic OAuth callback code/state values.
  Router execution endpoints lack service authentication and cost-incurring
  requests lack rate limiting.
- Contracts: the JSON Schema still requires top-level `messages` while active
  TypeScript/Pydantic contracts use `context`; event constraints differ.

## Historical deployment and security evidence

The audit inspected [GitHub CI run 34235358249](https://github.com/rishabh-git88/omniroute/actions/runs/34235358249)
for `e5875e7…`: lint, type checks and Python tests passed; frontend, backend and
integration jobs failed; the build job was skipped. These are historical results,
not a claim about checks on the newer checkpoint commit.

A Vercel success record for that older revision was found, but application access
redirected to Vercel SSO. The older committed proxy protected `/`; the audited
working-tree change, now checkpointed, makes `/` public. Deployment success alone
does not establish which public landing behavior users currently receive.

At audit time, `.env` and nested `.env.local` patterns were ignored, nothing was
staged, and scoped scans found no actual hardcoded provider/AWS credentials or
staged secrets. This is scoped evidence, not an exhaustive security guarantee.
Local Compose database/cache ports were published; public exposure depends on
the host network. The production target requires private data services.

## Open Questions

Remaining product and architecture decisions are centralized in
[RELEASE-SCOPE — Open Questions](RELEASE-SCOPE.md#open-questions). The fixed AWS
stack, inclusion of workspace memory/PDFs, and frozen alternatives are not open
questions. Historical notes such as `Current-Sprint.md` must not be used to mark
features complete or to reduce the agreed release scope.
