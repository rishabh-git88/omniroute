import { describe, expect, it, vi } from 'vitest';
import { SemanticRetrievalService } from './semantic-retrieval.service.js';
import { DeterministicEmbeddingService } from './deterministic-embedding.service.js';
import type { PrismaService } from '../database/prisma.service.js';

function database(query: ReturnType<typeof vi.fn>) {
  return {
    client: {
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>,
      ) =>
        callback({
          $queryRaw: query,
          $executeRaw: vi.fn().mockResolvedValue(0),
        }),
    },
  } as unknown as PrismaService;
}
describe('retrieval degradation', () => {
  it('uses authorized lexical retrieval after a vector failure', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('vector unavailable'))
      .mockResolvedValueOnce([
        { id: 'chunk', fileId: 'file', content: 'reference', score: 0 },
      ]);
    const service = new SemanticRetrievalService(
      database(query),
      new DeterministicEmbeddingService(),
    );
    expect((await service.retrieveSafely('workspace', 'query')).status).toBe(
      'lexical',
    );
    expect(query.mock.calls[1]?.[0].join(' ')).toContain('f.workspace_id=');
    expect(query.mock.calls[1]).toContain('workspace');
  });
  it('reports unavailable optional retrieval without throwing or replacing history', async () => {
    const service = new SemanticRetrievalService(
      database(vi.fn().mockRejectedValue(new Error('offline'))),
      new DeterministicEmbeddingService(),
    );
    expect(await service.retrieveSafely('workspace', 'query')).toEqual({
      chunks: [],
      status: 'unavailable',
    });
  });
});
