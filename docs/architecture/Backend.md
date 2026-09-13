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

## Streaming lifecycle and recovery

Client-visible events are normalized at NestJS and carry `conversationId`,
`turnId`, `requestGroupId`, `runId`, provider, model key, event type, a global
SSE cursor, and a per-run sequence. The cursor is sent as the SSE `id`; clients
reconnect with `Last-Event-ID` (or the `after` cursor). The process-local hub
retains at most 500 events per request group for short reconnects. It is not a
source of record: an expired cursor or API restart emits a reset signal and the
browser reconstructs runs, responses, usage, selection, and terminal state from
PostgreSQL before accepting subsequent events.

Generation persists bounded, normalized partial text while it is streaming.
Partial text remains visible after a timeout, cancellation, protocol failure,
or provider disconnect, but no partial run is selectable and it never receives
a successful terminal state. A normal completion, max-output completion, timeout,
cancellation, and truncated/protocol stream remain distinct normalized results.
The first terminal transition wins; later content or terminal signals are ignored
by the execution loop and duplicate replay frames are suppressed by cursor.

Closing an SSE connection never cancels provider work. The frontend makes at
most four bounded-backoff reconnect attempts, preserving each run card and its
cursor independently from other request groups. Compare children are isolated:
one child terminal state never closes or cancels its siblings. Per-run cancellation
only aborts that run; group cancellation requests all nonterminal children and is
idempotent.

On a process restart, completed runs are rendered from PostgreSQL and are never
restarted. Runs older than five minutes which were left pending/running are marked
`EXECUTION_INTERRUPTED`; undispatched reservations are released, while dispatched
reservations retain explicit reconciliation evidence for [[Credits-Billing]]
Phase 5. Redis/distributed stream ownership and cross-replica fanout remain
deferred to Phase 8.

## Related notes

[[System-Architecture]] · [[ADR-001-Monorepo]] · [[Testing]] · [[Docker]]

## Open Questions

- What background-completion policy applies after every client disconnect?
- Which operations require synchronous completion versus a durable job?
