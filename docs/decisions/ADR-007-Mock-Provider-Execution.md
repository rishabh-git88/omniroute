# ADR-007: Contract-Compatible Local Mock Provider

#decision #architecture

## Status

Accepted for the MVP development environment.

## Context

Conversation commands, streaming, cancellation, branch persistence, and UI
integration need an end-to-end executable path before real provider credentials
or SDKs are introduced. The architecture requires provider-neutral canonical
requests/events and reserves real provider adapters for the AI Router's
[[Provider-Layer]].

## Decision

The Nest conversation module owns a local-development `MockProvider` that
implements the shared `AIProvider` interface exactly: it accepts a
`CanonicalChatRequest`, asynchronously emits normalized `ProviderEvent`
values, and supports `cancel(runId)`. The API translates those events into
run-tagged SSE after durable run creation. The mock has no secret, SDK, or
network dependency and only resolves registry entries whose provider key is
`fake`.

This is an execution seam, not a real-provider integration. Production
provider adapters remain behind [[Provider-Layer]] in the AI Router; replacing
the mock changes server orchestration only, not PostgreSQL conversation records,
canonical contracts, REST/SSE endpoints, or frontend code.

## Consequences

- The full conversation lifecycle has deterministic integration coverage now.
- No provider credential is stored in source or PostgreSQL.
- SSE replay is intentionally a bounded in-process development convenience;
  terminal state is read from PostgreSQL and distributed replay must move to
  Redis or the router boundary before multi-instance production deployment.
- External registry entries cannot be selected until their actual adapter is
  explicitly implemented and configured.

## Related notes

[[Provider-Layer]] · [[Backend]] · [[API-Design]] · [[ADR-004-FastAPI-Router-Service]]
