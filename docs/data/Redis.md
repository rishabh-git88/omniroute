# Redis

#database #backend

## Purpose

Redis provides low-latency ephemeral coordination. It is never the sole store for selected branches, terminal model runs, usage, or credit transactions.

## Phase 8 coordination contract

The API uses the namespaced `omniroute:v1:` keyspace only for bounded,
expiring coordination:

| Key family | TTL | Purpose | Durable fallback |
| --- | --- | --- | --- |
| `rate:<action>:<workspace>:<user>` | 60 seconds | authenticated execution and file-mutation limits | reject the protected write if Redis is unavailable |
| `provider-circuit:<provider>:<model>` | 30–60 seconds | transient provider failure cooldown shared by replicas | health becomes unknown after expiry; registry/runtime checks still apply |
| `run-lease:<runId>` | 120 seconds | prevent duplicate provider dispatch | PostgreSQL `ModelRun` state and reconciliation remain authoritative |

Values contain only counters, UUID ownership tokens, or bounded failure codes.
They never contain prompts, responses, credentials, credits, file metadata, or
ledger state. Redis connection loss does not erase a conversation or a charge.
Cost-bearing writes fail safely while it is unavailable; reads, durable replay
reconstruction, and reconciliation continue through PostgreSQL.

## Responsibilities

- Rate limits and concurrency caps.
- Short-lived SSE replay/event retention and stream coordination.
- Short-lived service and streaming-session coordination; durable authentication sessions remain in PostgreSQL.
- Ephemeral provider health and circuit-breaker state; historical signals belong in telemetry.
- Distributed locks only where database locking is not the correct invariant boundary.
- Safe caches for registry snapshots, token estimates, or context snapshots.
- BullMQ queues for summaries, file processing, analytics, and reconciliation.
- Queue depth and backpressure signals.

## Inputs and outputs

Inputs are ephemeral jobs, stream events, counters, and cacheable immutable/versioned values. Outputs are dequeued work, replay windows, rate-limit decisions, and cache hits.

## Dependencies and data used

[[Backend]], [[AI-Router]], [[Context-Memory]], [[Model-Registry]], [[Credits-Billing]], and managed Redis in [[Deployment]]. Durable recovery state lives in [[PostgreSQL-Schema]].

## Failure behavior

On outage, reject or degrade operations that cannot safely coordinate, recover terminal state from PostgreSQL, rebuild caches, and resume idempotent jobs. Never infer a financial result from a missing cache key.

## Security considerations

Use TLS, authentication, network isolation, least privilege, bounded TTLs, and no raw sensitive prompt/response caching unless explicitly required and protected by retention policy.

## Scalability considerations

Define eviction separately from queue durability, bound SSE retention, monitor memory/queue depth, and separate workloads when contention is measured.

## Implementation notes

Local development uses Docker Compose with persistence disabled because Redis is intentionally disposable. Preview/staging/production use managed Redis. Cache keys include tenant scope and data version.

## Related notes

[[PostgreSQL-Schema]] · [[API-Design]] · [[Observability]] · [[Docker]]

## Open Questions

- How long is the initial SSE replay window, and what maximum event volume is retained per request group?
- Which BullMQ persistence and retry settings meet recovery needs without turning Redis into a system of record?
