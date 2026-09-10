# OmniRoute Next Milestone

Planning reset: 2026-09-10.

Implementation update, 2026-09-10: the user's subsequent **Frontend/API/Auth
Foundation** task authorized the thirteen browser-boundary fixes within R02.
Those fixes, their regression tests, and a configured production/browser smoke
check are implemented; see [CURRENT-STATE](CURRENT-STATE.md#release-milestone-1-implementation-update)
and [[ADR-010-Browser-API-Auth-Boundary]]. The broader baseline milestone below
remains PARTIAL: clean-checkout CI, disposable database/migration verification,
container builds, and live Google/deployed-domain acceptance are still separate
open gates. No provider integration was performed.

**Milestone: establish a reproducible, authenticated browser-to-database baseline.**

Current status: **PARTIAL**. Existing foundations reduce the work, but broken CI,
browser/API configuration and transport, incomplete authentication evidence, and
unsafe integration-test targeting prevent a trustworthy execution baseline.

This milestone is a bounded plan for the next implementation task. Creating this
document does not start implementation, apply migrations, provision cloud
resources, call paid providers, or commit changes.

## Why this milestone is first

The [audit baseline](CURRENT-STATE.md) contains passing local unit checks and a
configured build, but CI test jobs fail from a clean checkout. Browser commands
and SSE have reproduced environment/CORS failures. The development database was
missing a migration, while existing integration tests would truncate a populated
test database. These problems would obscure results from live provider or
multi-model implementation.

The release target remains [RELEASE-SCOPE](RELEASE-SCOPE.md), including all three
providers, Compare 3, frozen alternatives, workspace memory, and TXT/Markdown/PDF
files. Completing this milestone does not satisfy that release target.

## Scope and ordered work

This milestone covers R00's decisions needed immediately, R01, R02, and R03 in
[RELEASE-BLOCKERS](RELEASE-BLOCKERS.md). Later R00 policy decisions must be closed
before their dependent milestones, rather than holding up unrelated repairs.

| Order | Work | Required result |
| --- | --- | --- |
| 1 | Reconcile relevant planning decisions | Record the release architecture and select the browser/API domain-cookie arrangement. Identify owners for later model, credit, file, and operational policies. Update affected notes/ADRs as implementation changes architecture. |
| 2 | Fix clean-checkout dependency/build ordering | CI test jobs build the workspace exports they consume; frozen installation, lint, typecheck, and existing tests pass without local build artifacts. |
| 3 | Make production API configuration explicit | Build and server runtime requirements agree; configured browser requests use the configured API origin. Missing/invalid production configuration produces controlled behavior with no localhost fallback. |
| 4 | Repair browser transport and authentication | Public landing, command preflight, SSE headers, Google login/session/logout, CSRF, redirect validation, and log redaction work on the selected domain topology. |
| 5 | Establish a disposable integration database | Apply/verify migrations on a fresh target, rehearse upgrade with synthetic data, run actual integration suites, and identify any remaining failures honestly. |
| 6 | Validate artifacts and publish evidence | All three container builds and configured health/startup checks pass; GitHub gates pass for the reviewed revision; record browser and database evidence. |

Steps 3–4 and disposable database preparation can overlap after the dependency
build baseline is reliable. Do not use existing developer data as test fixtures
or reset a local database to make the check pass.

## Acceptance checklist

Keep each item unchecked until evidence exists for the implementation revision.
Historical audit results are a baseline, not a substitute for regression checks.

- [ ] Clean-checkout frozen JS/Python dependency installation succeeds.
- [x] Lint, formatting, TypeScript/Python type checks, and existing unit/contract
      tests pass through the root dependency graph. Repairing isolated CI job
      dependency ordering remains under the separate CI checkbox below.
- [x] A configured production Next.js build succeeds; the browser demonstrably
      uses its configured HTTPS API origin for API and sign-in requests.
- [x] Missing/invalid production API configuration is tested; no accidental
      browser localhost fallback occurs.
- [x] Anonymous `/` is public; the landing experience does not get stuck on
      session loading; protected chat routes require authentication.
- [x] Browser command preflight permits the headers actually used by commands.
      SSE preserves required CORS/session/request headers.
- [ ] Google callback, authenticated session, logout, expiry/rotation, and CSRF
      rejection pass using representative frontend/API domains.
- [x] Redirect escape fixtures are rejected and synthetic OAuth code/state
      markers do not appear in request logs.
- [ ] A documented disposable database is used; fresh and upgrade migration
      paths pass with pgvector and expected schema fields.
- [ ] Database/auth/conversation integration suites actually execute and pass;
      no existing populated database is truncated or reset.
- [ ] All three Dockerfiles build and configured startup/health checks pass.
- [ ] The CI run for the reviewed revision passes every mandatory gate, including
      the build job; there are no skipped gates accepted as success.
- [x] CURRENT-STATE and RELEASE-BLOCKERS are updated from observed results, with
      remaining provider/context/credit/file/deployment work still open.

This milestone validates authentication and transport using bounded test/mock
execution where appropriate. It does not certify full conversation correctness,
frozen context, multi-run streaming, or live-provider accounting; those have
separate acceptance gates in R04–R10.

## Verification approach and safeguards

Inspect scripts before running them. Use the repository's pinned toolchain and
frozen lockfiles. Run root lint/typecheck/test commands through the corrected
dependency graph, and run database suites only against an explicitly disposable
target. Use a non-secret test API origin for compilation and representative
domains for browser/auth testing. Validate Compose without printing interpolated
secrets, then validate images and configured startup.

Separate deterministic auth tests from the real Google smoke test. Live Google
verification needs an appropriately configured OAuth client and access to the
test domains. If these inputs are unavailable, that acceptance item remains
BLOCKED with the missing prerequisite recorded; do not infer success from mock
tokens. The same rule applies if container execution or a disposable database
cannot be made available.

When the work is authorized, fixes should remain focused on R01–R03 and required
security regressions in R02. Do not introduce provider fan-out, purchases,
subscription UI, PDFs, or AWS provisioning into this milestone. Do not expose
secret values in commands, logs, reports, or screenshots. Do not commit
automatically.

## Likely files requiring attention

| Area | Paths |
| --- | --- |
| CI and task graph | `.github/workflows/ci.yml`, `turbo.json`, root/workspace `package.json` files |
| Frontend API/auth configuration | `apps/web/app/api-url.ts`, `apps/web/app/auth-provider.tsx`, `apps/web/app/login/page.tsx`, `apps/web/proxy.ts`, `packages/config/src/web.ts` |
| API transport and auth | `apps/api/src/main.ts`, `apps/api/src/identity/`, `apps/api/src/conversations/conversation.controller.ts` |
| Database verification | `apps/api/prisma/`, Prisma configuration, `apps/api/src/database/` and auth/conversation integration suites |
| Build/runtime parity | `infrastructure/docker/`, `compose.yaml`, documented environment examples |
| Architecture/verification records | `docs/decisions/`, relevant architecture/devops notes, and these project-status documents |

## Completion record required

Record the implementation commit, CI run, toolchain, exact checks and outcomes,
test database isolation, tested browser/domain arrangement, image identifiers,
and remaining blocked checks. Include no credentials or user data. A green
milestone needs evidence for every acceptance checkbox; otherwise keep it PARTIAL
or BLOCKED as appropriate.

## What follows

After the baseline passes, execute R04 persistence invariants and R05 frozen
context, then R06 accounting recovery. R07 contract/adapter repair can proceed
independently once R01 is stable. R08 connects paid-capable execution only after
authorization, context, credit, and provider-contract prerequisites pass. Continue
through the remaining dependency graph to R16; do not relabel this first
milestone as a production release.

## Open Questions

The domain-cookie arrangement is resolved: configured app/API sibling hosts and
shared session cookies, with API-host-only OAuth cookies. Immediate inputs are
the actual owned domain, a safe Google test configuration, and a disposable
database environment. Later policy
decisions remain in [RELEASE-SCOPE — Open Questions](RELEASE-SCOPE.md#open-questions).
