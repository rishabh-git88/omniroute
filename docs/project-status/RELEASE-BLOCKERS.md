# OmniRoute Release Blockers and Backlog

Planning reset: 2026-09-10. Release decision: **BLOCKED** until the required
product flows and deployment gates pass. This is an execution backlog, not
authorization to implement or deploy.

Baseline: [CURRENT-STATE](CURRENT-STATE.md). Target:
[RELEASE-SCOPE](RELEASE-SCOPE.md). First execution boundary:
[NEXT-MILESTONE](NEXT-MILESTONE.md).

## Status, priority, and evidence rules

Use only COMPLETE, PARTIAL, BROKEN, NOT STARTED, and BLOCKED as status values,
with the definitions in [CURRENT-STATE](CURRENT-STATE.md#status-vocabulary).
Each backlog row has one current status. Dependencies describe execution order;
a missing dependency does not erase existing partial implementation.

- **P0:** cannot release while this item is open. All required release features
  and their safety/operational prerequisites belong here.
- **P1:** important follow-up that may remain open only if every required
  acceptance criterion is already satisfied and the residual limitation is
  explicitly documented. Required features cannot be moved here to shrink scope.
- **P2:** desirable improvement outside the release gate.

Completion requires evidence tied to a commit/environment and the acceptance
criteria below. Failed or blocked tests cannot be converted into passing evidence
by source inspection. No backlog item below is currently COMPLETE.

## Dependency-ordered release backlog

The order is topological: every listed prerequisite appears earlier. Work may
overlap after its prerequisites pass; order does not imply a calendar estimate.

| ID | Priority | Current status | Work item | Depends on |
| --- | --- | --- | --- | --- |
| R00 | P0 | PARTIAL | Reconcile architecture records and remaining release policies | None |
| R01 | P0 | BROKEN | Restore reproducible clean-checkout CI and artifact validation | R00 |
| R02 | P0 | BROKEN | Repair production web/API configuration, CORS, and authentication | R01 |
| R03 | P0 | BLOCKED | Establish disposable database verification and migration alignment | R01 |
| R04 | P0 | PARTIAL | Prove conversation, run, tenant, and ledger persistence invariants | R02, R03 |
| R05 | P0 | BROKEN | Correct canonical context and persist frozen execution snapshots | R04 |
| R06 | P0 | PARTIAL | Complete reservation, settlement, failure, and recovery accounting | R04, R05 |
| R07 | P0 | PARTIAL | Stabilize provider contracts, adapter events, registry and router behavior | R01 |
| R08 | P0 | PARTIAL | Connect authenticated NestJS execution to FastAPI and all three providers | R02, R05, R06, R07 |
| R09 | P0 | BROKEN | Complete per-run multiplexed streaming, reconnect, and cancellation | R04, R06, R08 |
| R10 | P0 | PARTIAL | Complete routing modes, Compare 3, alternatives, and fallback UX | R05, R06, R07, R08, R09 |
| R11 | P0 | PARTIAL | Complete S3 TXT/Markdown/PDF ingestion and workspace memory | R03, R05 |
| R12 | P0 | PARTIAL | Prove the complete frontend product flows and essential UX | R02, R04, R10, R11 |
| R13 | P0 | NOT STARTED | Implement Redis/Valkey limits, health, and replica coordination | R06, R07, R09 |
| R14 | P0 | NOT STARTED | Provision the fixed cloud architecture and OIDC delivery | R00, R01, R02 |
| R15 | P0 | PARTIAL | Complete CloudWatch monitoring, recovery, and operational controls | R06, R08, R11, R13, R14 |
| R16 | P0 | BLOCKED | Validate the release candidate on the production-shaped staging stack | R10, R11, R12, R13, R14, R15 |

R07 adapter work and R14 cloud preparation can proceed before the entire product
is complete. R14's deployment checks establish the environment, not approval to
release it publicly. R16 explicitly depends on the integrated product and
operational evidence. Real provider calls must wait for service authorization,
credit enforcement, and bounded test configuration.

## R00 — Architecture records and unresolved policy

The release scope is fixed, but older notes still defer required memory/storage
and leave hosting vendors open. Record ADRs for the fixed release deployment and
frozen snapshot/file lifecycle changes when implementation begins, and reconcile
the affected historical notes. Resolve each remaining policy before its
dependent behavior is implemented; do not invent billing or model-selection
rules silently.

Acceptance: the fixed scope remains intact; remaining decisions have explicit
owners/resolutions in documentation. Domains/cookies inform R02; credit policies
inform R06; model and routing policy inform R07/R10; file/embedding policies inform
R11; cloud region, access, IaC, and recovery targets inform R14/R15.

Affected notes: `docs/product/MVP-Scope.md`, `docs/architecture/Context-Memory.md`,
`docs/architecture/Credits-Billing.md`, `docs/devops/Deployment.md`,
`docs/devops/CI-CD.md`, `docs/roadmap/Current-Sprint.md`,
`docs/roadmap/Roadmap.md`, and new records under `docs/decisions/`.

## R01 — CI and reproducible artifacts

The inspected GitHub test jobs did not build exported workspace dependencies
before importing them. The root build also lacks its required public API URL.
Dockerfiles exist, but current image builds were not verified.

Acceptance:

- From a fresh checkout with frozen lockfiles, lint, type checks, and
  unit/contract tests actually execute and pass. Prepare integration-job
  dependency ordering here; R03 owns database execution and its passing result.
- Shared package build ordering works without artifacts from another CI job or
  a previous developer run.
- An explicit non-secret API origin is supplied for configured web builds;
  missing production configuration is handled according to the validated policy.
- Compose validation and all three production image builds pass. Container
  startup/health checks use documented runtime configuration.
- Record passing evidence for the repaired jobs and artifact checks. Full green
  CI, including integration tests and the formerly skipped build job, is the
  combined R01–R03 milestone exit gate. R03 can start once R01's dependency/build
  baseline passes; it does not wait for its own database result to exist.

Files: `.github/workflows/ci.yml`, `package.json`, `turbo.json`, workspace package
scripts, and `infrastructure/docker/*.Dockerfile`.

## R02 — Browser/API/authentication boundary

The audited configured browser bundle retained localhost; `/login` failed without
runtime configuration; CORS rejected required request headers; raw SSE replies
dropped CORS headers. Public pages fetch session state unnecessarily. OAuth code
exists but its deployed cookie topology is not established. Redirect validation
and OAuth callback query logging have reproduced defects.

Acceptance:

- An anonymous production build serves `/` publicly and renders the landing
  experience. Only intended routes require a session.
- A browser built for an explicit HTTPS API origin sends API, OAuth, and SSE
  traffic to that origin; no production browser request uses localhost fallback.
- Build-time and server-runtime environment requirements are documented and
  tested. Google sign-in derives its URL from validated configuration.
- Real browser preflights permit the actual command/reconnect headers; SSE keeps
  CORS, session-cookie, and request-ID handling intact.
- Google login/logout, expiry, session rotation, CSRF rejection, and protected
  routes work using the selected domains. Redirect targets cannot escape the
  approved origin, including slash/backslash variants.
- Authentication codes, state, cookies, authorization values, and secrets do not
  appear in application/request logs.

Files: `apps/web/app/api-url.ts`, `apps/web/app/auth-provider.tsx`,
`apps/web/app/login/page.tsx`, `apps/web/proxy.ts`, `packages/config/src/web.ts`,
`apps/api/src/main.ts`, `apps/api/src/identity/`, and
`apps/api/src/conversations/conversation.controller.ts`.

## R03 — Safe database and migration verification

The last observed development database lacked the workspace-memory migration.
The existing integration suites truncate rows, so they were not run against the
populated local test database. This is a verification prerequisite, not permission
to reset that database.

Acceptance: create a clearly disposable test target; apply both migrations from
empty state; verify migration status and pgvector; run the actual integration
suite. Rehearse upgrade from the core schema with synthetic retained records and
document any seed/registry naming drift. Validate the eventual RDS-supported
PostgreSQL/pgvector combination rather than assuming local versions are available
on RDS. Treat changes to any existing database as a separate controlled action.

Files: `apps/api/prisma/`, Prisma config files, database integration tests,
`infrastructure/postgres/init/`, and `.github/workflows/ci.yml`.

## R04 — Durable product invariants

Schema/repositories exist, but complete authorized persistence and failure-state
behavior need evidence. Request/run records can remain pending after setup
failure; partial output is lost, and selection/state transitions need concurrency
coverage.

Acceptance: create/list/reopen conversations; persist prompts and candidate
responses; select exactly one active response; continue only its branch; reject
cross-user/workspace access; make command idempotency validate equivalent
requests; preserve coherent run/group states during errors and cancellation.
Prove applicable SQL constraints, uniqueness, ledger immutability, and isolation
with database tests. Include refresh/restart recovery and concurrent selection.

Files: `apps/api/src/conversations/`, `apps/api/src/database/`,
`apps/api/src/identity/`, `apps/api/src/usage/`, and Prisma migrations.

## R05 — Correct, frozen provider-neutral context

Fix reversed history order. Persist the recoverable canonical bundle, source
provenance, version/hash, and applicable budgets before execution. Alternatives
and comparisons must reuse that frozen input rather than reconstructing it from
current workspace state. Provider-specific conversion cannot silently replace
canonical content. Resolve unsupported model budgets before starting a run.

Acceptance: multi-turn fixtures preserve user/assistant order and exclude
rejected branches; the same prompt snapshot survives process restart; later
memory/file changes do not alter alternatives; summaries and retrieval remain
authorized, bounded, and attributable. Test retrieval failure/degradation and
models with different context limits. After R11, repeat snapshot tests with real
processed workspace files.

Files: `apps/api/src/context/`, conversation service/repository, Prisma context
snapshot models/migrations, and `packages/provider-contracts/`.

## R06 — Credits and execution recovery

Retain exact arithmetic and transactional ledger primitives. Complete the
reserve-before-call lifecycle, actual usage handling, cancellation/partial-output
policy, settlement/run-state coordination, and recovery for abandoned work.
Zero-cost mocks are insufficient accounting evidence.

Acceptance: nonzero synthetic pricing and concurrent requests cannot overspend;
repeated grant/reserve/settle/release/refund calls do not duplicate ledger effects;
every terminal attempt reconciles, including provider failure, cancellation,
fallback, and multi-run comparisons. Simulate process loss and DB errors between
response persistence and settlement. Recover stale reservations without charging
twice or declaring successful paid work free. Verify user-visible balances and
usage against ledger records. No subscriptions or payment integration.

Files: `apps/api/src/usage/`,
`apps/api/src/conversations/conversation-execution.service.ts`, request setup,
and ledger/run schema. A recovery mechanism must preserve PostgreSQL authority.

## R07 — Provider contracts and routing primitives

Reconcile canonical JSON Schema, Zod, and Pydantic representations and enforce
drift checks. Correct empty-success handling on provider failure, missing
terminal events at EOF, disabled-primary fallback, Anthropic input usage, Gemini
output limits, and zero-cost scoring. Keep model capabilities/pricing versioned.

Acceptance: deterministic fixtures cover valid/error/malformed/truncated streams,
usage, cancellation, limits, and normalized terminal outcomes for all adapters.
Eligibility and Economy/Smart/Max tests cover zero price, missing/stale health,
capability mismatch, and exhausted candidates. Health must distinguish configured
credentials from observed provider availability. Basic explanations record the
actual decision. Live protocol checks belong to R08.

Files: `packages/provider-contracts/`, `services/ai-router/app/contracts.py`,
`routing.py`, `fallback.py`, `models.py`, `providers/`, and registry data.

## R08 — Real provider execution

Replace the product path's exclusive dependency on NestJS `MockProvider` with
authenticated, versioned NestJS-to-FastAPI orchestration. Keep deterministic mocks
for tests. Enforce server-approved model/run plans; direct unauthenticated router
execution must not be available. Propagate run IDs, cancellation, events, usage,
errors, and correlation without exposing secrets.

Acceptance: bounded live staging smoke tests independently prove OpenAI,
Anthropic, and Gemini from authenticated browser command through persistence and
credit reconciliation. Provider credentials stay server-side; registry limits and
reservations apply before calls. Unauthorized service requests are rejected.
No release claim based solely on calling FastAPI directly.

Files: conversation execution/module/service, `packages/config/`,
`services/ai-router/app/main.py`, provider adapters, and service contracts.

## R09 — Streaming and independent run lifecycle

Repair replay position handling and UI grouping by run, not only request group.
Preserve independent errors, completion, cancellation, and partial content. A
single run's terminal event cannot terminate unrelated comparison streams.

Acceptance: interleaved three-run fixtures render correctly; reconnect resumes
without old-answer duplication; one failed/cancelled run does not stop peers;
partial responses and final state agree with persistence. Test slow consumers,
disconnects, supported timeouts, and deploy draining. R13 supplies shared
coordination; repeat restart/replica tests through ALB in R16.

Files: `apps/api/src/conversations/stream-event-hub.ts`, conversation controller
and executor, `apps/web/app/conversation-stream.ts`, and
`apps/web/app/conversation-workspace.tsx`.

## R10 — Routing modes and multi-model product loop

Wire selected Economy/Smart/Max preferences into actual routing. Implement the
one-turn/three-run Compare 3 flow, persisted selection, and distinct-model Try
Another AI. Qualifying provider failures must execute approved bounded fallback
with the same frozen prompt context and correct per-attempt accounting.

Acceptance: browser tests demonstrate each mode changes the server decision;
Compare 3 streams three unique eligible runs; selecting one and continuing uses
only its branch; alternatives preserve the snapshot after memory changes; a
controlled provider failure produces a visible fallback outcome. Define and test
the user experience when fewer than three eligible models or insufficient
credits are available. Do not silently rename fewer responses as Compare 3.

Files: frontend conversation UI, conversation services, registry/routing
contracts, FastAPI routing/fallback, and usage integration.

## R11 — S3 files and workspace memory

Repair BigInt responses, request limits, and MIME/extension handling. Add private
S3 objects, TXT/Markdown/PDF extraction, bounded processing, clear processing
states, retry behavior, and deletion/retention. Do not mark content clean/ready
without the corresponding checks. Restrict retrieval to authorized eligible
files and use a validated production embedding approach.

Acceptance: all three required formats reach useful retrieval and canonical
context; malformed/oversized/unsupported PDFs fail clearly without OCR; users
cannot access another workspace's object or chunks; failed/deleted files are
excluded; retries do not duplicate objects/chunks. Demonstrate relevance and
context budgeting with fixtures. Exercise actual private S3 access in R16.

Files: `apps/api/src/files/`, `apps/api/src/context/`, workspace upload UI,
Prisma file/chunk/embedding models, and new storage/processing adapters within
the existing module boundaries.

## R12 — Complete frontend acceptance

Finish the browser experience around persisted conversations, actual model
identity, balances, uploads, processing/error states, comparison selection, and
retry/cancel. Include landing metadata/icons, responsive layouts, keyboard
navigation, settings/dialog focus behavior, and accessible loading/error states.

Acceptance: automated browser journeys cover login, history refresh, all modes,
Compare 3/select/continue, alternatives, failure/fallback, low credits, and all
required file formats. Manual checks cover the agreed device/browser and
keyboard matrix. UI must reflect actual server/provider state.

Files: `apps/web/app/`, `apps/web/proxy.ts`, and shared UI components.

## R13 — Redis/Valkey and multi-replica safety

Implement consuming features, not just a configured URL: authenticated
cost-incurring request limits, shared ephemeral provider-health/circuit state,
bounded stream coordination, and any required execution coordination. Define
TTLs, reconnection, and outage behavior. Durable run outcomes and ledger recovery
remain in PostgreSQL.

Acceptance: rate limits hold across replicas; health/fallback decisions reflect
shared state; reconnect works after routing to a different task; memory/state is
bounded; cache outage cannot erase history or bypass accounting. Fail closed
where limits/accounting cannot safely be enforced. Validate the chosen
Redis/Valkey engine/client combination on ElastiCache in R16.

Files: API/router consuming modules, environment schemas, stream hub, and future
cache/coordination infrastructure.

## R14 — Fixed deployment and OIDC delivery

Create reviewable IaC and CI/CD for Vercel, ECS/Fargate API/router, RDS/pgvector,
ElastiCache, S3, Secrets Manager, ALB/private networking, and CloudWatch resources.
Include image publication, TLS/DNS, least-privilege task roles, controlled provider
egress, backups, migration execution, and environment separation. Configure
GitHub OIDC trust by repository/environment; do not add static AWS credentials.

Acceptance: deploy immutable revisions to staging; verify health routing and
private data/router access; verify Secrets Manager delivery without leaking
values; connect Vercel to the correct API; perform controlled migrations and an
application rollback. Verify ALB SSE/draining configuration. Record deployment
revision and run evidence. Infrastructure existence does not complete R16.

Paths: `infrastructure/`, `.github/workflows/`, environment examples,
`infrastructure/docker/`, and deployment/CI documentation. These implementations
were absent at the audit baseline.

## R15 — Monitoring, recovery, and operational readiness

Send structured, redacted logs and useful metrics to CloudWatch. Correlate
requests, turns, groups, provider attempts, and credit reconciliation. Add alerts
for dependency failure, provider error/latency, pending/failed ingestion, aged
reservations, and task health. Define owners, retention, and response runbooks.

Acceptance: trigger representative failures and observe actionable alerts;
demonstrate restore of database and required file metadata/object access;
exercise failed deploy rollback, provider outage, Redis loss, and interrupted
execution recovery. Validate costs/limits and operating load against agreed
targets. Advanced evaluation dashboards remain excluded.

Paths: `apps/api/src/observability/`, router instrumentation, AWS infrastructure,
and operational documentation.

## R16 — Release candidate gate

Run the complete fixed-scope product on Vercel → ALB → private ECS API/router →
RDS/ElastiCache/S3 → real providers. The previous Vercel SSO redirect and missing
AWS inventory cannot substitute for this evidence.

Acceptance: all required features in RELEASE-SCOPE pass on a single identified
release candidate; CI/artifacts match deployed revisions; data isolation,
credits, restart/reconnect, uploads, frozen comparisons, fallback, monitoring,
backup/restore and rollback evidence is recorded. Re-test source fixes previously
blocked by environment access. List any permitted residual P1/P2 limitations
without mislabeling incomplete required features COMPLETE. Public release is a
separate approval/action after these gates.

## Follow-up priorities outside the release gate

| ID | Priority | Status | Follow-up | Depends on |
| --- | --- | --- | --- | --- |
| F01 | P1 | PARTIAL | Extend failure/load regression coverage and tune cost/latency after the agreed release load and correctness gates already pass | R16 |
| F02 | P2 | NOT STARTED | Advanced evaluation dashboards, if later prioritized | R16 |

Teams, enterprise SSO, Kubernetes, subscriptions, credit purchases, OCR, and image
understanding have no initial-release backlog requirement. They are not hidden
dependencies of the work above.

## Open Questions

Use [RELEASE-SCOPE — Open Questions](RELEASE-SCOPE.md#open-questions) as the single
decision list. Decisions must close before their dependent implementation;
unresolved questions are not grounds to mark absent features complete.
