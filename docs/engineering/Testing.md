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
