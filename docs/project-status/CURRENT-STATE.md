# OmniRoute Current State

## Release-candidate assessment

The 2026-09-13 source candidate is
`2dd9cc6543b1b431ed907d7348f95890ef9c84f5`. Local deterministic, disposable
database, browser, Compose, and clean-build gates pass. It is **not ready for a
production release** because required external evidence and configuration remain
absent: Render Redis acceptance, real OAuth, live reviewed-provider acceptance,
private Supabase Storage, approved production embeddings, backup rehearsal, alert delivery,
and deployment/CI revision matching. Public liveness/readiness were HTTP 200 on
2026-09-13, but the candidate security headers were absent, so deployed revision
matching is explicitly blocked. See [[RELEASE-CANDIDATE-2026-09-13]].

## Phase 7 frontend update

Date: 2026-09-13. The current frontend is a server-backed product workspace,
not a mock dashboard. It renders persisted history, Single AI and registry-gated
Compare 3, selected-branch continuation, switching and Try Another AI,
per-run SSE/reconnect/cancellation state, durable credits, and file processing
status from the API. Compare 3 remains unavailable in production until three
reviewed real registry entries are activated. File retrieval remains unavailable
in production until private Supabase Storage and an approved production embedding strategy are
configured; the browser represents both states explicitly.

The earlier planning-reset matrices below preserve historical audit evidence.
Where they describe the pre-Phase 2 through Phase 6 implementation state, this
Phase 7 update and the linked architecture notes supersede them. Current local
verification includes deterministic unit/API/database suites and the built
Chromium browser boundary test; full external OAuth, S3, embedding, and live
provider acceptance remains an external release gate.

## Phase 8 operational update

Redis now has a bounded coordination role: authenticated execution/file limits,
transient provider circuit state, and short run-dispatch leases. PostgreSQL
remains durable truth for conversations, runs, responses, credits, files, and
recovery. Production requires a server-only Redis URL; a Redis outage rejects
new protected cost-bearing writes while durable reads and reconciliation remain
available. External multi-replica Render, Key Value, OAuth, S3, embedding, and
live-provider acceptance remains required before a release claim.

## Phase 0 production-baseline update

Date: 2026-09-12. The current deployment architecture is Vercel at
`https://oneroute-ai.vercel.app`, with Vercel rewriting `/v1` to the Render
NestJS API; the Render FastAPI service, Supabase PostgreSQL, and existing Render
Key Value service remain backend dependencies. CI source configuration now
supplies both synthetic build inputs: `NEXT_PUBLIC_API_URL` and
`RENDER_API_ORIGIN`, each set to `https://api.ci.invalid`.

The web Docker image now receives both build arguments as well. Local Docker
verification is blocked on this workstation because its Docker socket is not
accessible. GitHub-hosted CI could not be queried because the available GitHub
CLI token is invalid. These are not passing CI or image evidence. On 2026-09-12,
the public frontend, `/v1/health`, and `/v1/health/ready` each returned HTTP 200
through Vercel; the two API responses identified Render as their origin. OAuth
initiation redirected to Google with secure temporary cookies, and a deliberately
invalid session was rejected with HTTP 401. Interactive Google login, callback,
session persistence, logout, expiry, and authenticated CSRF behavior remain open
until tested with an authorized account.

Planning reset: 2026-09-10. Overall status: **PARTIAL**. OmniRoute has substantial
foundations and passing local checks, but its required production product is not
complete. Authenticated execution now runs through NestJS, the FastAPI AI Router,
and provider-neutral adapters. OpenAI and Anthropic remain supported but may be
disabled. Gemini, Groq, and OpenRouter adapters are available when their router
flags and server-only credentials are configured. Their reviewed registry
candidates remain disabled pending internal task/quality/latency evaluation, so
they are not production routing evidence. The registry-driven Compare 3 product
loop is implemented and covered with deterministic provider fixtures, but it is
production-blocked until three reviewed real models are enabled.

Read alongside [RELEASE-SCOPE](RELEASE-SCOPE.md),
[RELEASE-BLOCKERS](RELEASE-BLOCKERS.md), and
[NEXT-MILESTONE](NEXT-MILESTONE.md).

## Release Milestone 2 implementation update

Database Alignment and CI Repair is implemented with local database evidence;
the broader milestone remains **PARTIAL** until artifact/startup and remote CI
gates pass. See [[MILESTONE-2-VERIFICATION]] for commands, results, file groups,
and remaining failures, and [[ADR-011-Isolated-Database-Verification]] for the
database safety/seed decision.

Both unchanged migrations passed fresh installation and a retained-data upgrade
rehearsal on separate marked integration databases. All 20 database integration
tests passed. Tests fail before writes for development/production/unknown URLs,
unsafe inherited configuration, or an unrecognized server identity. The local
development database was backed up and aligned; Prisma reports no drift. The
legacy provider key is now `gemini`, preserving IDs and enablement. Fingerprints
verify unchanged content in all 29 other domain tables.

Real model seed configuration requires explicit reviewed prices/capabilities and
immutable versions; defaults create no real models or invented prices. The seed
does not enable providers or connect the router to registry-backed execution.
CI now builds dependencies before tests and supplies a synthetic HTTPS web
origin. A fresh-source frontend/API test run passed without cached build tasks.
The current unit suites contain 132 TS/JS tests and 22 Python tests.

No AWS or live-provider work, real environment edit, migration rewrite, or commit
was performed. The following Milestone 1 and audit records are historical;
Milestone 2 supersedes their local database and CI-source observations only.

## Release Milestone 1 implementation update

The 2026-09-10 Frontend/API/Auth Foundation task implements the browser boundary
in [[ADR-010-Browser-API-Auth-Boundary]]. API origins are statically bound and
validated; the public landing renders during bounded session checks; outages
have a separate retryable state; login uses the configured origin; CORS permits
command/reconnect headers; SSE preserves Fastify's CORS and cookie lifecycle;
return-path escapes and OAuth query logging are fixed. Session cookies use the
configured shared domain, OAuth cookies remain API-host-only, and the existing O
mark supplies the application icon/favicon route.

Verification: `pnpm lint`, `pnpm typecheck`, and `pnpm test`; the regression suite
now contains 83 TS/JS tests and 22 Python tests. A production web build configured
with a synthetic HTTPS API origin passed. The production smoke test verified
public SSR/hydration, login URL, protected chat, icon responses, the actual browser
request origin, and simulated outage UI. It supplied a conflicting runtime API
URL to prove that the build's public origin is retained. No paid provider calls
or live OAuth exchange were made.

R02 remains PARTIAL until real Google login/session persistence and the deployed
shared-domain topology pass. CI repair, disposable database/migration checks,
container builds, full streaming semantics, and provider work retain their
separate backlog status. No deployment or commit was performed. The evidence
below distinguishes historical audit results from this implementation update.

## Milestone 1 file inventory

Changed or added files for this task are listed below. `next-env.d.ts` was
regenerated by the production build. An unrelated `.obsidian/graph.json` change
appeared during execution and was left untouched; it is excluded from this list.
No provider implementation, real environment file, database migration, or lockfile
was changed.

```text
.env.example
apps/api/src/conversations/conversation.controller.ts
apps/api/src/http-boundary.test.ts
apps/api/src/http-boundary.ts
apps/api/src/identity/auth-cookie.service.ts
apps/api/src/identity/auth-redirect.test.ts
apps/api/src/identity/auth.service.ts
apps/api/src/main.ts
apps/web/app/api-url.ts
apps/web/app/auth-pages.test.tsx
apps/web/app/auth-provider.tsx
apps/web/app/auth-state.test.ts
apps/web/app/auth-state.ts
apps/web/app/auth-unavailable.tsx
apps/web/app/branding.test.ts
apps/web/app/conversation-workspace.tsx
apps/web/app/globals.css
apps/web/app/icon.svg
apps/web/app/landing-page.tsx
apps/web/app/login/page.tsx
apps/web/next-env.d.ts
apps/web/next.config.ts
apps/web/package.json
apps/web/proxy.test.ts
apps/web/scripts/verify-production.mjs
apps/web/vitest.config.ts
docs/architecture/Authentication.md
docs/architecture/Frontend.md
docs/decisions/ADR-006-MVP-Authentication.md
docs/decisions/ADR-010-Browser-API-Auth-Boundary.md
docs/devops/Deployment.md
docs/project-status/CURRENT-STATE.md
docs/project-status/NEXT-MILESTONE.md
docs/project-status/RELEASE-BLOCKERS.md
docs/project-status/RELEASE-SCOPE.md
packages/config/src/api.test.ts
packages/config/src/api.ts
packages/config/src/http-origin.ts
packages/config/src/web.test.ts
packages/config/src/web.ts
```

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

The planning-reset task re-read project guidance, relevant documentation, source, retained
verification summaries, and Git state. It did not rerun application tests,
builds, migrations, containers, live OAuth, provider calls, or cloud checks.
At that reset, source findings carried forward because audited files matched.
Milestone 1 now changes the boundary files described above. Database,
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
| Production public landing experience | PARTIAL | Local production SSR/hydration, bounded background session checks, and branded icon/favicon pass. Public deployed acceptance remains. | R02, R12, R16 |
| Google authentication | PARTIAL | OAuth/PKCE/state/nonce and session/CSRF code exist. Redirect/logging defects are fixed and sibling-domain cookie configuration is tested; live callback/session persistence and deployed topology remain unverified. | R02 |
| Conversations | PARTIAL | Create/list/detail/selection repositories and endpoints exist; a complete authenticated persistence flow was not verified. | R03, R04, R12 |
| Persisted messages | PARTIAL | Turns, runs, responses, and selected heads exist in Prisma. Normalized partial output is persisted for refresh after terminal failure/cancellation; Phase 5 still owns full financial recovery. | R03, R04, R06 |
| Streaming | PARTIAL | SSE events have run identity, a bounded Last-Event-ID replay cursor, duplicate suppression, refresh reconstruction, and stale-run interruption recovery. Cross-replica coordination remains deferred to Phase 8. | R09 |
| OpenAI product execution | PARTIAL | Python adapter and synthetic tests exist; NestJS calls only the mock. No live smoke result. | R07, R08 |
| Anthropic product execution | PARTIAL | Adapter exists but initial input usage is lost; no connected product execution or live smoke result. | R07, R08 |
| Gemini product execution | PARTIAL | Adapter exists but output-cap configuration is omitted; no connected product execution or live smoke result. | R07, R08 |
| Economy mode | PARTIAL | The frontend sends the selected mode; deterministic router ordering uses exact costs including zero. Live model availability remains gated by reviewed registry entries. | R07, R10 |
| Smart mode | PARTIAL | The frontend sends the selected mode and the router persists its scored decision; live evidence remains dependent on reviewed entries. | R07, R10 |
| Max mode | PARTIAL | The frontend sends the selected mode and quality-first routing enforces the same eligibility checks. | R07, R10 |
| Compare 3 | PARTIAL | One frozen context fans out to three distinct eligible runs with independent UI/SSE state, reservations, and explicit selection. Production returns a safe unavailable state until three reviewed real models exist. | R09, R10 |
| Try Another AI | PARTIAL | A new run uses the original immutable snapshot and excludes attempted models; production remains gated by reviewed registry/health eligibility. | R05, R09, R10 |
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
| Production browser API configuration | COMPLETE | Direct Next.js environment access and validated production origins; real-browser smoke observed only the configured API origin. No silent production fallback. | R02 |
| Web build/runtime API-origin behavior | COMPLETE | Configured production build and login rendering pass; runtime changes cannot override the compiled public origin. Missing/invalid production configuration fails closed. CI now supplies a synthetic build origin. | R01, R02 |
| NestJS API overall | PARTIAL | Bootstrap, validation, CORS, identity, repositories, health, logging, and shutdown hooks exist; orchestration, limits, execution recovery, and browser flows remain incomplete. | R02–R09 |
| FastAPI AI Router overall | PARTIAL | Analyzer, registry/scoring, adapters and fallback exist; service auth, actual health, production event handling, and integration are incomplete. | R07, R08 |
| Prisma/PostgreSQL domain model | PARTIAL | 30 domain models and SQL constraints cover identity, branches, runs, usage, credits, files, memory, feedback, and future entitlements. Milestone 2 integration tests pass; full product/concurrency/failure invariants remain under R04. | R04 |
| Audited development schema alignment | COMPLETE | Milestone 2 backed up and applied the pending memory migration; zero Prisma drift, unchanged non-provider content, and canonical Gemini identity verified. | R03 |
| Safe database integration verification | COMPLETE | Separate marked/restricted tmpfs databases passed fresh and retained-data upgrade checks and 20 integration tests; unsafe targeting fails closed. | R03 |
| Local PostgreSQL/pgvector service | COMPLETE | Audit verified connection, PostgreSQL 18.6, pgvector 0.8.6, and applied core migration checksum. No RDS claim. | R03 for remaining database work |
| Local Redis container health | COMPLETE | Existing local container was healthy at audit time. No application integration claim. | R13 for consuming functionality |
| Application Redis/Valkey functionality | NOT STARTED | No runtime cache, rate-limit, distributed stream, health, or locking client was found; current event storage is process-local. | R13 |
| S3 file storage | NOT STARTED | No S3-backed upload/object access/lifecycle implementation was found. | R11, R14 |
| CI release gate | PARTIAL | Source ordering/configuration repaired; fresh-source frontend/API tests pass. No GitHub-hosted run exists for these uncommitted changes. | R01 |
| Docker image verification | BLOCKED | Milestone 2 attempted actual builds; storage exhaustion interrupted verification. See MILESTONE-2-VERIFICATION for the final per-image results. | R01 |
| Observability | PARTIAL | Structured logging, request IDs, optional Node OpenTelemetry and metrics foundations exist. Normal API request logs now omit OAuth queries and credential headers; CloudWatch, ingress log policy, alerts, and cross-service correlation remain. | R15 |
| Vercel deployment readiness | PARTIAL | On 2026-09-12, the public frontend and both Vercel-proxied API health endpoints returned HTTP 200, with Render identified as the API origin. Current deployed commit identity, live OAuth completion, and the remaining release gates are unverified. | R02, R14, R16 |
| Production browser acceptance | BLOCKED | An accessible representative deployment and completed environment/auth integration are required. | R14, R16 |
| AWS deployment implementation | NOT STARTED | No IaC or AWS CD implementation for ECS/Fargate, RDS, ElastiCache, S3, Secrets Manager, ALB, CloudWatch, or OIDC was found. | R14, R15 |
| AWS deployed-state verification | BLOCKED | No authenticated AWS inventory or accessible deployment evidence was available. Repository absence alone cannot prove account resources are absent. | R14, R16 |

## Audit defects and current disposition

- Browser networking: the audited idempotency/CORS, SSE header/cookie, and client
  API-origin defects are fixed with regression and production-browser evidence.
- Context: reversed user/assistant history; snapshots cannot reproduce exact
  input; alternatives can incorporate subsequent workspace changes.
- Streaming: bounded replay now uses event positions and an expired cursor reloads durable state; per-run terminal handling and partial persistence are implemented. Cross-replica stream ownership/fanout remains deferred to Phase 8.
- Uploads: successful service results contain BigInt and fail JSON serialization;
  advertised text size exceeds the default Fastify request-body limit; file
  readiness is not required before retrieval.
- Providers: normalized failure can become an empty successful `generate()`
  result; EOF may omit terminal failure; disabled primary validation escapes
  fallback; Anthropic input usage and Gemini output limits are incomplete.
- Accounting: response/run completion precedes settlement in a separate
  transaction; later settlement failure can mark the run failed and release its
  reservation. Partial provider output is discarded and fully released.
- Auth/security: slash/backslash return-path escapes and normal API request-log
  query leakage are fixed with regression tests. Router execution endpoints still
  lack service authentication and cost-incurring requests lack rate limiting;
  neither was part of this boundary implementation.
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
