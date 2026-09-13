# Release Candidate Assessment — 2026-09-13

## Candidate

- Revision: `2dd9cc6543b1b431ed907d7348f95890ef9c84f5`
- Working tree at assessment: clean.
- Verdict: **NOT READY — BLOCKED BY external production acceptance and required
  configured dependencies.** This is not a source-code failure claim.

## Evidence matrix

| Capability | Status | Evidence / release condition |
| --- | --- | --- |
| Landing, history, selection, continuation, switching, Try Another AI | COMPLETE | Deterministic web/API tests and Chromium acceptance. |
| Google auth, persistence, logout | BLOCKED | Real Google OAuth browser acceptance has not been performed. |
| Single AI / Groq | BLOCKED | Reviewed Groq v2 exists; product-path live acceptance and controlled activation evidence are absent. |
| Gemini / OpenRouter | BLOCKED | Strict calibration remains incomplete; neither has reviewed v2 evidence. |
| Economy, Smart, Max, fallback | COMPLETE | Deterministic routing and provider tests. Live acceptance remains blocked on activated providers. |
| Compare 3 | BLOCKED | Correctly rejects fewer than three reviewed, enabled, healthy models. |
| Streaming, replay, cancellation | COMPLETE | Deterministic API/browser coverage. Deployed interruption acceptance remains external. |
| Credits and reconciliation | COMPLETE | Deterministic unit and disposable-DB coverage. Production-account evidence is absent. |
| TXT, Markdown, PDF, RAG, memory | BLOCKED | Code/deterministic coverage exists; private Supabase Storage and approved production embeddings are unconfigured. |
| Redis coordination/rate limits | BLOCKED | Local deterministic coordination coverage exists; Render Key Value configuration and multi-replica/outage acceptance are absent. |
| Security controls | COMPLETE | Deterministic CSRF, authorization, internal-router, redaction and upload tests. Deployment header/cookie acceptance remains external. |
| Observability and alerts | DEFERRED | Structured telemetry and alert guidance exist; alert delivery is unconfigured. |
| Database migration/recovery | COMPLETE | Guarded disposable pgvector validation, migration history and drift checks. Production backup/restore rehearsal is blocked. |
| CI and deployment revision | BLOCKED | No authenticated CI, Vercel, or Render evidence ties this revision to deployed services. |

## Local release gates

At this revision: `pnpm lint`, `pnpm typecheck`, `pnpm test`, isolated
`pnpm db:test` with the marked disposable database, Python `pytest` (162
passed), `ruff`, `mypy`, Chromium acceptance, both Compose configuration checks,
and a clean production build completed successfully. `git diff --check` passed.

The initial database command without its explicit disposable URL was refused by
the repository safety guard. It was rerun only with the documented
`omniroute_integration` loopback target.

## Production inventory and external evidence

Blueprint configuration declares the expected service-scoped variables without
their values. This assessment cannot inspect Render or Vercel secrets. Required
operator confirmation: Render API `DATABASE_URL`, `REDIS_URL`, Google OAuth
values, API/router internal token linkage, and S3 configuration; AI Router
provider flags and corresponding keys; Vercel public API origin and server-only
Render origin. Production embeddings intentionally remain disabled.

Read-only HTTPS probes on 2026-09-13 returned HTTP 200 for the public landing
page and `/v1/health` plus `/v1/health/ready`; the API responses identified
Render as their origin and CORS allowed only the configured Vercel origin. HTTPS
HSTS was observed. The candidate's `X-Content-Type-Options`, frame, referrer,
and permissions headers were not observed on the public landing response, so
the deployed frontend cannot be treated as this candidate revision. Cookie,
OAuth, and authenticated endpoint behavior remain unverified.

## Dependency review

`pnpm audit --prod --audit-level=high` reports three transitive findings: high
`deepmerge-ts < 8` through Prisma config and high `mysql2 < 3.22` through Prisma,
plus one moderate finding. No compatible, independently verified Prisma update
was applied during release assessment. These need a documented reachability and
upstream-update decision before a release approval.

## Required operator acceptance

1. Deploy and confirm CI, Vercel, Render API, and AI Router use this exact SHA;
   then recheck the expected security headers.
2. Verify Render Redis TLS/private connectivity, rate limits, circuit TTLs,
   leases, shutdown, two-replica behavior, and Redis-outage fail-closed writes.
3. Run real Google OAuth callback/session/logout acceptance without recording
   credentials or codes.
4. Complete Gemini and OpenRouter guarded calibrations; import disabled,
   review, activate only valid v2 entries; then perform Single-AI acceptance.
5. Do not run Compare 3 until three reviewed models are enabled and healthy.
6. Configure private Supabase Storage and approve/configure an embedding provider before
   file/RAG production acceptance, then test upload/retrieval/deletion privately.
7. Configure alert delivery and rehearse PostgreSQL/S3 backup restoration using
   non-production data.

## Release blockers

P0: unverified Redis production dependency; real OAuth acceptance; live provider
acceptance; S3 and embedding production configuration; backup/restore rehearsal;
deployment revision/CI evidence; unresolved high dependency advisories requiring
an explicit release decision. Compare 3 is a P0 product-scope blocker until three
reviewed models are healthy. No P0 source-code defect was discovered by local
release gates.
