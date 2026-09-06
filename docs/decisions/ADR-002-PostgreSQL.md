# ADR-002: PostgreSQL as Primary System of Record

#decision #database

- Status: Accepted
- Date: 2026-09-06
- Source: `references/architecture-source.txt`, sections 4, 7, and 9.1

## Context

Users own workspaces, conversations contain branched turns and responses, one response becomes active, and concurrent provider usage must reconcile against money-like credit transactions. These relationships require transactions, constraints, locks, and auditable history.

## Decision

Use managed PostgreSQL 18 as the primary system of record, Prisma for type-safe access and explicit SQL migrations for complex indexes, locks, JSONB, and critical queries. Use JSONB selectively for provider metadata/versioned snapshots and pgvector only when semantic retrieval is justified. Re-verify the production version before implementation.

Redis remains ephemeral coordination/cache/queue state; object storage contains large bytes.

## Consequences

Branch and credit invariants share one transactional boundary. Relational joins, full-text search, JSONB, and optional vectors avoid a second primary database. Schema design and migrations require care, and high-volume workloads may later need replicas or partitioning.

## Alternatives considered

- MongoDB: rejected because the core domain is relational and transaction-heavy.
- Separate vector database: deferred until pgvector is demonstrably insufficient.
- Redis as durable business state: rejected because cache/queue loss must not lose selected branches or financial records.

## Revisit when

Measured scale or a concrete retrieval workload exceeds PostgreSQL's appropriate operating envelope. Any additional source of truth requires an ADR.

## Related notes

[[PostgreSQL-Schema]] · [[Redis]] · [[Vector-Memory]] · [[Credits-Billing]]

## Open Questions

- The managed PostgreSQL vendor, migration tooling details, backup objectives, and pgvector timing remain undecided.
