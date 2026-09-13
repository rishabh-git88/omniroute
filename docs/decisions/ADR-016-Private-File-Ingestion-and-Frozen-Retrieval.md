# ADR-016: Private File Ingestion and Frozen Retrieval

## Status

Accepted

## Decision

OmniRoute stores supported workspace source objects in private native Supabase
Storage under generated workspace/file identifiers. PostgreSQL remains the
authority for metadata, processing state, chunks, embeddings, provenance,
deletion, and frozen context snapshots. The API accepts only TXT, Markdown, and
text-layer PDF sources; no OCR, remote fetch, or embedded content execution
occurs.

Extraction, deterministic chunking, and embedding are provider-neutral
services. Retrieval is workspace scoped, READY-only, bounded, and contributes
untrusted reference material to the canonical context before it is frozen.
Historical snapshots retain their payload after source deletion.

## Consequences

- Production requires private Supabase Storage configuration and an approved embedding
  provider. Deterministic local embeddings are test/development only and
  production processing fails closed until that provider is approved.
- PDF ingestion uses PDF.js text-layer extraction only; encrypted, malformed,
  and image-only/no-text sources are rejected with normalized errors.
- Queue-backed worker scaling and distributed stale-processing recovery remain
  future operational work; the current processing boundary is retryable.

## Related notes

[[Context-Memory]] · [[Vector-Memory]] · [[ADR-012-Frozen-Canonical-Context]]
