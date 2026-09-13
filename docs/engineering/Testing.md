# Testing

#architecture #backend

## Purpose

Keep deterministic contracts and invariants around nondeterministic provider APIs.

## Test layers

| Layer | Coverage |
|---|---|
| Unit | context budgets, branch resolution, credit arithmetic, capability checks, error normalization, retries |
| Adapter contract | fake/recorded streams, usage mapping, cancellation, tool normalization, malformed events |
| Database integration | transactions, row locks, idempotency, selection constraints, reconciliation |
| API integration | authz, POST idempotency, SSE order/reconnect, cancellation, partial failure |
| End-to-end | login, Compare 3, select, continue, switch, upload, low credits, failure, mobile |
| Load | concurrent comparisons, long streams, Redis outage, slow provider, pool saturation, backpressure |
| Security | tenant isolation, injection fixtures, sanitization, file bombs, secret leakage, limits |
| Evaluation | switch coherence, fact retention, task success, tab-position bias |

Use Vitest/Jest, Supertest, Playwright, and Testcontainers as appropriate. Live provider smoke tests are bounded and separate from deterministic CI.

## Browser acceptance

`pnpm --filter @omniroute/web test:browser` runs the built Next.js application
in headless Chromium via the Chrome DevTools Protocol. It verifies public SSR,
login-link construction, protected-route handling, favicon metadata, browser
hydration, the compiled `NEXT_PUBLIC_API_URL`, and the retryable authentication
outage state. It intercepts only synthetic API traffic and never uses Google or
provider credentials. CI installs Chrome and runs this command in the dedicated
`browser-e2e` job after a production web build.

Conversation, Compare 3, streaming/replay, credit, file/RAG, and tenant
authorization acceptance use deterministic API and disposable-database suites;
they do not require live provider, cloud-storage, or OAuth credentials. A full
staging browser journey remains an external release prerequisite because it
requires the production services and deliberate test-user setup.

Database and API integration suites now require the guarded disposable target
described in [[Database-Verification]]. Both environment URLs are validated
before any override, actual server identity is checked before writes, and
missing configuration fails rather than skipping suites. Fresh migration and
retained-data upgrade checks are CI gates; see
[[ADR-011-Isolated-Database-Verification]]. These executed tests cover their
specific assertions, not every intended acceptance criterion below.

## MVP acceptance criteria

- One prompt creates exactly one turn and three unique runs.
- Each run streams, completes, fails, retries, or cancels independently.
- One selected response moves the active head exactly once and survives refresh.
- Switching sends only the active selected path plus relevant context.
- Parallel requests cannot make credits negative; every terminal run reconciles.
- Files cannot cross users/workspaces or use permanent public URLs.
- Mobile and keyboard navigation work with clear loading/error states.
- Traces correlate turn, group, run, provider request, and ledger without secrets.

## Inputs and outputs

Inputs are fixtures, fake adapters, recorded events, disposable dependencies, security cases, and reviewed evaluation sets. Outputs are release gates, regression evidence, coverage, and performance/security findings.

## Failure behavior

Flaky live-provider tests do not weaken deterministic contract gates; they report provider health separately. Failing invariant, migration, isolation, or reconciliation tests block release.

## Security and scalability

Use synthetic data and low-spend test keys. Test tenant isolation and resource exhaustion explicitly. Load-test queue and database backpressure before increasing concurrency.

## Related notes

[[Provider-Layer]] · [[PostgreSQL-Schema]] · [[API-Design]] · [[CI-CD]] · [[Evaluation-Engine]]

## Open Questions

- Which provider event recordings may be committed without exposing content or proprietary data?
- What concrete load targets and browser/device matrix define MVP readiness?

## Multi-provider routing verification

Phase 6 tests use actual NestJS and FastAPI servers with loopback OpenAI,
Anthropic, and Gemini protocol fixtures. Mode propagation, persisted identity,
usage, credit reconciliation, and fallback context hashes are verified through
browser-style authenticated HTTP commands. Shared routing requests and emitted
provider events are validated against Zod-generated JSON Schema and Pydantic.
Unit matrices cover zero-price Economy, Smart/Max, metadata and context
eligibility, health, terminal failures, timeout, cancellation, and output caps.
No normal CI test needs paid provider credentials. See
[[ADR-014-Multi-Provider-Routing]] and [[Database-Verification]].
