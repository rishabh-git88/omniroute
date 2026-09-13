import { Inject, Injectable, Optional } from '@nestjs/common';
import { MetricsService } from '../observability/metrics.service.js';

import { PrismaService } from '../database/prisma.service.js';
import {
  type EmbeddingService,
  EMBEDDING_SERVICE,
} from './embedding.service.js';

export interface RetrievedChunk {
  content: string;
  fileId: string;
  filename?: string;
  id: string;
  score: number;
}

@Injectable()
export class SemanticRetrievalService {
  public constructor(
    private readonly database: PrismaService,
    @Inject(EMBEDDING_SERVICE) private readonly embeddings: EmbeddingService,
    @Optional()
    private readonly metrics: MetricsService = {
      recordRetrieval: () => undefined,
    } as unknown as MetricsService,
  ) {}
  public get embeddingModel(): string {
    return this.embeddings.model;
  }
  public get embeddingVersion(): string {
    return this.embeddings.version;
  }

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
        ${input.fileChunkId}::uuid, ${this.embeddings.model},
        ${this.embeddings.version}, ${this.embeddings.dimensions}, ${input.contentHash},
        ${vector}::vector, NOW()
      )
      ON CONFLICT (file_chunk_id, embedding_model, model_version)
      DO UPDATE SET content_hash = EXCLUDED.content_hash,
                    dimensions = EXCLUDED.dimensions,
                    embedding = EXCLUDED.embedding,
                    created_at = EXCLUDED.created_at
    `;
  }

  public async retrieveSafely(
    workspaceId: string,
    query: string,
    take = 3,
  ): Promise<{
    chunks: RetrievedChunk[];
    status: 'semantic' | 'lexical' | 'unavailable' | 'empty';
  }> {
    const startedAt = Date.now();
    try {
      const chunks = await this.retrieve(workspaceId, query, take);
      if (chunks.length) {
        this.metrics.recordRetrieval(Date.now() - startedAt, chunks.length);
        return { chunks, status: 'semantic' };
      }
    } catch {
      /* Optional retrieval must not erase canonical history. */
    }
    try {
      const chunks = await this.database.client.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SET LOCAL statement_timeout = '750ms'`;
          return transaction.$queryRaw<RetrievedChunk[]>`
        SELECT fc.id, fc.file_id AS "fileId", fc.content, 0::float8 AS score
        FROM file_chunks fc JOIN files f ON f.id=fc.file_id
        WHERE f.workspace_id=${workspaceId}::uuid AND f.deleted_at IS NULL
          AND f.processing_status = 'READY'
          AND to_tsvector('simple',fc.content) @@ plainto_tsquery('simple',${query})
        ORDER BY ts_rank(to_tsvector('simple',fc.content),plainto_tsquery('simple',${query})) DESC, fc.id
        LIMIT ${Math.min(Math.max(take, 1), 12)}
      `;
        },
        { maxWait: 250, timeout: 1500 },
      );
      this.metrics.recordRetrieval(Date.now() - startedAt, chunks.length);
      return { chunks, status: chunks.length ? 'lexical' : 'empty' };
    } catch {
      this.metrics.recordRetrieval(Date.now() - startedAt, 0);
      return { chunks: [], status: 'unavailable' };
    }
  }

  public async retrieve(
    workspaceId: string,
    query: string,
    take = 4,
  ): Promise<RetrievedChunk[]> {
    if (!query.trim()) return [];
    if (this.embeddings.dimensions !== 64)
      throw new Error('Unsupported pgvector embedding dimension');
    const vector = this.embeddings.vectorLiteral(this.embeddings.embed(query));
    return this.database.client.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET LOCAL statement_timeout = '750ms'`;
        return transaction.$queryRaw<RetrievedChunk[]>`
      SELECT fc.id, fc.file_id AS "fileId", f.original_name AS filename, fc.content,
             (1 - (e.embedding::vector(64) <=> ${vector}::vector(64)))::float8 AS score
      FROM embeddings e
      JOIN file_chunks fc ON fc.id = e.file_chunk_id
      JOIN files f ON f.id = fc.file_id
      WHERE e.workspace_id = ${workspaceId}::uuid
        AND e.source_kind = 'FILE_CHUNK'
        AND e.embedding_model = ${this.embeddings.model}
        AND e.model_version = ${this.embeddings.version}
        AND e.dimensions = ${this.embeddings.dimensions}
        AND e.embedding IS NOT NULL
        AND f.workspace_id = ${workspaceId}::uuid
        AND f.deleted_at IS NULL
        AND f.processing_status = 'READY'
      ORDER BY e.embedding::vector(64) <=> ${vector}::vector(64), fc.id
      LIMIT ${Math.min(Math.max(take, 1), 12)}
    `;
      },
      { maxWait: 250, timeout: 1500 },
    );
  }
}
