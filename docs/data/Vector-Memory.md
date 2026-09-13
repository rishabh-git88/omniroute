# Vector Memory

#database #ai

## Purpose

Support semantic retrieval of older conversation turns and extracted file chunks only when lexical search and recency are insufficient. V1 uses optional pgvector inside PostgreSQL—not a separate vector database.

## Responsibilities

- Create embeddings for eligible, permitted canonical text/chunks.
- Store embedding model/version and source provenance.
- Retrieve candidates within workspace, conversation/project, retention, and content-type filters.
- Combine with lexical results for [[Context-Memory]] under a strict token budget.
- Re-embed or invalidate content when source text, permissions, branch relevance, or model version changes.

## Inputs and outputs

Inputs are authorized canonical messages, file chunks, artifact text, and retrieval queries. Outputs are ranked source IDs and scores; the context assembler decides final inclusion.

## Dependencies and data used

[[PostgreSQL-Schema]] with pgvector, asynchronous jobs through [[Redis]], file extraction, retention policy, and an embedding provider accessed through an approved abstraction.

## Failure behavior

Fall back to lexical search, recent turns, and valid summaries. A vector outage or missing embedding must not prevent ordinary recent-history continuation.

## Security considerations

Filter authorization before similarity search, avoid cross-tenant indexes/results, treat retrieved content as untrusted, honor deletion, and document whether embeddings are sent to an external processor.

## Scalability considerations

Start with exact search at low volume; add pgvector approximate indexes only after measuring corpus size and latency. Bound chunk count and schedule re-embedding.

## Implementation notes

The MVP enables bounded workspace-file retrieval through pgvector. TXT,
Markdown, and text-layer PDF sources are normalized, deterministically chunked
at roughly 1,200 characters with overlap, and retain offsets plus extraction,
chunking, and embedding provenance. Queries enforce workspace, soft-delete,
READY processing status, embedding model/version, dimension, and bounded top-K
before cosine ranking. A partial HNSW index applies only to fixed
64-dimensional development vectors; lexical GIN supports safe degradation.
Retrieved text is untrusted data and never replaces trusted system instructions.
Snapshots retain exact content/provenance, so later source changes cannot alter
a frozen execution.

## Related notes

[[Context-Memory]] · [[Evaluation-Engine]] · [[Security]] · [[MVP-Scope]]

## Open Questions

- Is semantic retrieval required for the seven-day MVP or only the six-week extension?
- Which embedding model/provider, chunking policy, and similarity threshold are approved?
- Is retrieval scoped to a conversation, project, workspace, or a user-controlled combination?
