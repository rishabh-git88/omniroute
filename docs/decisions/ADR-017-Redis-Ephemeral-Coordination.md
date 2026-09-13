# ADR-017: Redis Ephemeral Coordination

**Status:** Accepted  
**Date:** 2026-09-13

## Context

Render deployments may run more than one NestJS instance. Process-local limits,
provider health, and execution ownership then permit duplicate dispatches or allow an
unhealthy provider to be retried by every replica. PostgreSQL remains the required
durable source of truth for conversations, streams, credits, files, and recovery.

## Decision

Use the existing Render Key Value service only for versioned, bounded, expiring keys:
authenticated action limits, provider/model circuit state, and `ModelRun` ownership
leases. The API uses Redis-backed coordination in production and deterministic bounded
memory coordination in tests and non-production development.

A missing Redis dependency fails closed for protected cost-bearing writes. Durable
reads, completed-response reconstruction, and PostgreSQL reconciliation remain
available. Leases have an ownership token and TTL; durable `ModelRun` state remains the
final dispatch and completion authority. Circuit state opens only for transient
normalized failures and expires, so a stale health value cannot permanently exclude a
model.

## Consequences

No business records, prompt text, provider responses, credit balances, or permanent
stream logs are stored in Redis. Cross-replica reconnect reconstructs durable state
from PostgreSQL; bounded live pub/sub fanout is deferred until operational evidence
requires it.

## Related notes

[[Redis]] · [[Backend]] · [[Security]] · [[Observability]] · [[Credits-Billing]]
