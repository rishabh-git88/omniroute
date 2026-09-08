import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_MODEL_VERSION,
  DeterministicEmbeddingService,
} from './deterministic-embedding.service.js';

export interface RetrievedChunk {
  content: string;
  fileId: string;
  id: string;
  score: number;
}

@Injectable()
export class SemanticRetrievalService {
  public constructor(
    private readonly database: PrismaService,
    private readonly embeddings: DeterministicEmbeddingService,
  ) {}

  public async indexFileChunk(input: {
    content: string;
    contentHash: string;
    fileChunkId: string;
    workspaceId: string;
  }): Promise<void> {
    const vector = this.embeddings.vectorLiteral(
      this.embeddings.embed(input.content),
    );
    await this.database.client.$executeRaw`
      INSERT INTO embeddings (
        id, workspace_id, source_kind, file_chunk_id, embedding_model,
        model_version, dimensions, content_hash, embedding, created_at
      ) VALUES (
        gen_random_uuid(), ${input.workspaceId}::uuid, 'FILE_CHUNK',
        ${input.fileChunkId}::uuid, ${EMBEDDING_MODEL},
        ${EMBEDDING_MODEL_VERSION}, ${EMBEDDING_DIMENSIONS}, ${input.contentHash},
        ${vector}::vector, NOW()
      )
      ON CONFLICT (file_chunk_id, embedding_model, model_version)
      DO UPDATE SET content_hash = EXCLUDED.content_hash,
                    dimensions = EXCLUDED.dimensions,
                    embedding = EXCLUDED.embedding,
                    created_at = EXCLUDED.created_at
    `;
  }

  public async retrieve(
    workspaceId: string,
    query: string,
    take = 4,
  ): Promise<RetrievedChunk[]> {
    if (!query.trim()) return [];
    const vector = this.embeddings.vectorLiteral(this.embeddings.embed(query));
    return this.database.client.$queryRaw<RetrievedChunk[]>`
      SELECT fc.id, fc.file_id AS "fileId", fc.content,
             (1 - (e.embedding::vector(64) <=> ${vector}::vector(64)))::float8 AS score
      FROM embeddings e
      JOIN file_chunks fc ON fc.id = e.file_chunk_id
      JOIN files f ON f.id = fc.file_id
      WHERE e.workspace_id = ${workspaceId}::uuid
        AND e.source_kind = 'FILE_CHUNK'
        AND e.embedding_model = ${EMBEDDING_MODEL}
        AND e.model_version = ${EMBEDDING_MODEL_VERSION}
        AND e.dimensions = ${EMBEDDING_DIMENSIONS}
        AND e.embedding IS NOT NULL
        AND f.workspace_id = ${workspaceId}::uuid
        AND f.deleted_at IS NULL
      ORDER BY e.embedding::vector(64) <=> ${vector}::vector(64)
      LIMIT ${Math.min(Math.max(take, 1), 12)}
    `;
  }
}
