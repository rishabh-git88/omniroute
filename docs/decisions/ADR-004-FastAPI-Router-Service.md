# ADR-004: Separate FastAPI AI Router Service

#decision #architecture #ai

- Status: Accepted
- Date: 2026-09-07
- Supersedes: the in-process AI Router placement in [[ADR-001-Monorepo]] and [[ADR-003-AI-Router]]

## Context

The implementation direction places product APIs and durable business state in NestJS while giving AI orchestration an independently deployable Python boundary. This is a material departure from the original in-process TypeScript router, but it keeps provider churn and future AI-specific dependencies outside the main API.

## Decision

Create `services/ai-router` as a FastAPI/Pydantic service. NestJS remains the only client-facing API and owns identity, conversations, context construction, durable run state, and credit accounting. The AI Router accepts authorized provider-neutral run plans and context snapshots, applies routing/orchestration policy, invokes only provider adapters, and emits normalized events back to NestJS.

The AI Router does not directly mutate canonical conversation, branch, response, usage, or credit records. PostgreSQL remains the source of truth. Redis may hold rate limits, versioned caches, short-lived orchestration state, provider health, SSE replay data, and queue coordination, but never the sole durable result.

Cross-language wire contracts originate as versioned JSON Schema/OpenAPI definitions under `packages/provider-contracts`; TypeScript and Pydantic representations must pass compatibility tests.

## Consequences

- The repository becomes a TypeScript/Python polyglot monorepo.
- The router can scale and deploy independently, but introduces a network boundary, contract versioning, service authentication, timeouts, and distributed tracing requirements.
- Browser traffic and public SSE remain terminated by NestJS; clients never call provider adapters directly.
- A router outage must not invalidate durable state or credit reservations; NestJS records recoverable terminal state and reconciliation work.

## Alternatives considered

- Keep the AI Router inside NestJS: operationally simpler, but rejected by the revised implementation direction.
- Let FastAPI own run persistence and credits: rejected because it would split transactional business invariants across services.
- Share TypeScript/Python source models manually without a neutral schema: rejected because contract drift would be difficult to detect.

## Revisit when

Measured latency or operational complexity shows that the network boundary costs more than the Python isolation provides. A merge or further extraction requires a superseding ADR.

## Related notes

[[System-Architecture]] · [[Backend]] · [[AI-Router]] · [[Provider-Layer]] · [[Redis]]

## Open Questions

- Which service-authentication mechanism protects NestJS-to-router requests in deployed environments?
- Does NestJS consume router streams directly over HTTP/SSE, or through bounded Redis Streams after durable run creation?
