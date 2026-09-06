# AI Router

#architecture #ai

## Purpose

Coordinate Single AI and Compare 3 requests while keeping selection, eligibility, retries, costs, and provider APIs outside conversation business logic. In V1, users choose providers; deterministic capability-aware ranking may assist. ML-based Auto Pick is explicitly later.

## Complete routing flow

```mermaid
flowchart TD
    A[Canonical user request] --> B[Authenticate and authorize]
    B --> C[Load provider and model snapshots]
    C --> D[Check file, task, capability, availability, policy]
    D --> E{Mode}
    E -->|Single AI| F[Validate selected target]
    E -->|Compare 3| G[Validate chosen eligible targets]
    F --> H[Estimate maximum usage]
    G --> H
    H --> I{Quota and credits available?}
    I -->|No| J[Reject before provider calls]
    I -->|Yes| K[Create idempotent group, turn, and runs]
    K --> L[Reserve credits transactionally]
    L --> M[Build per-run context snapshots]
    M --> N[Start adapters concurrently]
    N --> O[Normalize and multiplex events]
    O --> P{Run outcome}
    P -->|Complete| Q[Persist response and actual usage]
    P -->|Partial or failed| R[Persist state and normalized error]
    P -->|Cancelled| S[Persist cancellation state]
    Q --> T[Settle reservation]
    R --> T
    S --> T
    T --> U[Publish terminal state]
    U --> V{User selects response?}
    V -->|Yes| W[Move active branch head]
    V -->|No| X[Keep all candidates stored]
```

## Responsibilities

- Read versioned eligibility, capabilities, pricing, and enablement from [[Model-Registry]].
- Validate selected providers rather than silently replace them.
- Create one request group and independent model runs, then fan out concurrently.
- Request provider-neutral snapshots from [[Context-Memory]].
- Invoke only [[Provider-Layer]], normalize results, and support independent cancel/retry.
- Coordinate [[Credits-Billing]] reservation and settlement.
- Emit evaluation metadata to [[Evaluation-Engine]] without treating selection as truth.

## Inputs and outputs

Inputs: canonical request, desired mode/providers, task/file metadata, user policy, quota, registry snapshots, and context. Outputs: run plans, normalized stream events, terminal states, usage, and routing/evaluation metadata.

## Failure behavior

One provider failure does not fail its peers. Honor `Retry-After`; use bounded network/5xx retries with jitter and circuit breaking; never retry invalid requests. Automatic fallback requires prior opt-in.

## Security considerations

Validate file access, provider disclosure consent, tool permissions, budget, and tenant scope before external calls. Avoid sending content to an unselected provider.

## Scalability considerations

Bound concurrency and output tokens. Use [[Redis]] for short-lived coordination and backpressure, with durable terminal state in PostgreSQL. Do not introduce an ML router before controlled evaluation evidence exists.

## Implementation notes

Routing decisions should record registry/pricing versions and reasons. The router chooses or validates targets; the provider layer translates and executes.

## Related notes

[[ADR-003-AI-Router]] · [[API-Design]] · [[Testing]] · [[Observability]]

## Open Questions

- What deterministic ranking weights apply to capability, cost, latency, and availability in V1?
- Does “provider fallback” in V1 mean only user-triggered alternatives, opt-in automatic fallback, or both?
