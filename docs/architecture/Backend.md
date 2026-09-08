# Backend

#architecture #backend

## Purpose

Expose a NestJS/Fastify API that owns durable conversations, context, identity, files, policy, and economic accounting. Provider execution crosses the internal [[ADR-004-FastAPI-Router-Service|FastAPI AI Router]] boundary using provider-neutral contracts.

## Responsibilities

| Module        | Owns                                                       | Must not own                                      |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| Identity      | users, OAuth identities, sessions, roles, deletion         | provider keys in logs                             |
| Conversation  | chats, turns, branches, selections, titles                 | provider request formats                          |
| Context       | active path, summaries, memory, retrieval, token budget    | credit deduction                                  |
| Router client | authorized run plans, contract versioning, router timeouts | provider SDKs or canonical conversation ownership |
| Usage         | estimates, reservations, reconciliation, ledger            | untransactional balance changes                   |
| Files         | upload intents, scanning, extraction, chunking, artifacts  | large bytes in PostgreSQL                         |
| Policy        | limits, content controls, tools, retention                 | analytics definitions                             |
| Analytics     | selections, switches, latency, feedback                    | raw sensitive content by default                  |
| Streaming     | SSE multiplexing, replay, terminal state                   | provider-specific events                          |

## Inputs and outputs

Inputs are authenticated [[API-Design|REST requests]], provider events, jobs, and storage callbacks. Outputs are transactional records, normalized SSE events, jobs, provider requests via [[Provider-Layer]], and telemetry.

## Dependencies

[[PostgreSQL-Schema]], [[Redis]], object storage, [[AI-Router]], [[Context-Memory]], [[Credits-Billing]], [[ADR-004-FastAPI-Router-Service]], and [[Observability]].

## Data used

Each module owns repositories for its tables. Provider metadata uses versioned JSONB where appropriate; canonical relational state remains typed and constrained.

## Failure behavior

Use idempotency keys, bounded retries, router timeouts, terminal-state reconciliation, and replayable stream events. Provider retries and circuit breakers remain inside the AI Router/provider boundary. Invalid requests do not retry automatically.

## Security considerations

Validate schemas and content types at ingress. Authorize every workspace-scoped resource. Keep provider SDKs and secrets inside adapter/runtime boundaries. Redact content from routine logs.

## Scalability considerations

Add BullMQ workers when a Phase 1 follow-up introduces durable background jobs. Scale the API and AI Router independently; retain module boundaries so measured hotspots can later be extracted.

## Implementation notes

Repository interfaces live inside modules. Shared packages expose Zod schemas, DTOs, canonical events, config, and telemetry—not ORM entities.

The MVP conversation module persists a request group, turn, routing decision,
model run, and context snapshot before it begins execution. Its local
`MockProvider` is an `AIProvider` contract adapter that emits normalized
streaming events and supports cancellation; it has no provider credential or
SDK dependency. This deliberately exercises the same provider-neutral API/SSE
boundary that the Router client will use when real adapters are enabled.

## Related notes

[[System-Architecture]] · [[ADR-001-Monorepo]] · [[Testing]] · [[Docker]]

## Open Questions

- What background-completion policy applies after every client disconnect?
- Which operations require synchronous completion versus a durable job?
