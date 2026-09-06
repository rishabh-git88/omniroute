# Backend

#architecture #backend

## Purpose

Expose a NestJS/Fastify API and worker boundary that coordinates durable conversations, context, provider execution, files, policy, and economic accounting.

## Responsibilities

| Module | Owns | Must not own |
|---|---|---|
| Identity | users, OAuth identities, sessions, roles, deletion | provider keys in logs |
| Conversation | chats, turns, branches, selections, titles | provider request formats |
| Context | active path, summaries, memory, retrieval, token budget | credit deduction |
| Providers | registry, orchestration, adapters, retry, circuit breaking | canonical conversation state |
| Usage | estimates, reservations, reconciliation, ledger | untransactional balance changes |
| Files | upload intents, scanning, extraction, chunking, artifacts | large bytes in PostgreSQL |
| Policy | limits, content controls, tools, retention | analytics definitions |
| Analytics | selections, switches, latency, feedback | raw sensitive content by default |
| Streaming | SSE multiplexing, replay, terminal state | provider-specific events |

## Inputs and outputs

Inputs are authenticated [[API-Design|REST requests]], provider events, jobs, and storage callbacks. Outputs are transactional records, normalized SSE events, jobs, provider requests via [[Provider-Layer]], and telemetry.

## Dependencies

[[PostgreSQL-Schema]], [[Redis]], object storage, [[AI-Router]], [[Context-Memory]], [[Credits-Billing]], and [[Observability]].

## Data used

Each module owns repositories for its tables. Provider metadata uses versioned JSONB where appropriate; canonical relational state remains typed and constrained.

## Failure behavior

Use idempotency keys, bounded retries, per-provider timeouts, circuit breakers, terminal-state reconciliation, and replayable stream events. Invalid requests do not retry automatically.

## Security considerations

Validate schemas and content types at ingress. Authorize every workspace-scoped resource. Keep provider SDKs and secrets inside adapter/runtime boundaries. Redact content from routine logs.

## Scalability considerations

Run heavy or unreliable work through BullMQ workers. Scale API and worker processes independently; retain module boundaries so measured hotspots can later be extracted.

## Implementation notes

Repository interfaces live inside modules. Shared packages expose Zod schemas, DTOs, canonical events, config, and telemetry—not ORM entities.

## Related notes

[[System-Architecture]] · [[ADR-001-Monorepo]] · [[Testing]] · [[Docker]]

## Open Questions

- What background-completion policy applies after every client disconnect?
- Which operations require synchronous completion versus a durable job?
