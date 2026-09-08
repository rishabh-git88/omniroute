-- Promote the Phase 2 memory placeholders into an MVP pgvector retrieval path.
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "source_hash" TEXT;

CREATE INDEX IF NOT EXISTS "memories_conversation_id_valid_version_idx"
  ON "memories"("conversation_id", "valid", "version");

-- Content hashes are not globally unique: the same text may safely occur in
-- multiple workspaces/files. File chunk identity is the durable embedding key.
DROP INDEX IF EXISTS "embeddings_source_kind_content_hash_embedding_model_model_v_key";
CREATE UNIQUE INDEX IF NOT EXISTS "embeddings_file_chunk_id_embedding_model_model_version_key"
  ON "embeddings"("file_chunk_id", "embedding_model", "model_version");

CREATE INDEX IF NOT EXISTS "file_chunks_content_fts_idx"
  ON "file_chunks" USING GIN (to_tsvector('simple', "content"));

-- Exact search remains appropriate for the small MVP corpus. This partial HNSW
-- index is constrained to the local 64-dimensional embedding contract.
CREATE INDEX IF NOT EXISTS "embeddings_workspace_vector_cosine_idx"
  ON "embeddings" USING hnsw (("embedding"::vector(64)) vector_cosine_ops)
  WHERE "embedding" IS NOT NULL AND "dimensions" = 64;
