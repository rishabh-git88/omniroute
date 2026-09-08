# ADR-009: MVP Workspace Memory Uses PostgreSQL and pgvector

## Status

Accepted

## Context

OmniRoute needs relevant workspace files, preferences, and selected conversation
history to survive provider changes without introducing a separate vector store
or an agentic retrieval loop.

## Decision

The NestJS modular monolith owns a `ContextBuilder` that creates one
provider-neutral `ContextBundle` before provider execution. PostgreSQL remains
the source of truth: extracted text is chunked into `file_chunks`, embeddings
are stored in `embeddings.embedding` through pgvector, and preferences and
versioned summaries use `memories`.

The MVP accepts text uploads, extracts and chunks synchronously, and creates a
deterministic local development embedding. The embedding implementation is an
adapter boundary; replacing it with an approved embedding provider does not
change chunks, retrieval, snapshots, or provider adapters. Retrieval is
workspace-scoped and exact/partial-HNSW indexed, with no external vector DB.

## Consequences

- Provider adapters consume only the `ContextBundle` in the canonical request.
- Rejected response candidates remain excluded because the builder follows only
  the selected parent-response path.
- Text file bytes are extracted immediately; durable raw-object storage and
  asynchronous extraction are intentionally deferred.
- The local hash embedding is suitable for deterministic MVP development, not
  a production semantic-quality claim.

## Related notes

[[Context-Memory]] · [[Vector-Memory]] · [[Provider-Layer]] · [[PostgreSQL-Schema]]
