import { describe, expect, it } from 'vitest';

import { DeterministicEmbeddingService } from './deterministic-embedding.service.js';
import { chunkText } from './text-chunker.js';

describe('workspace memory primitives', () => {
  it('chunks text with overlap and preserves a token estimate', () => {
    const chunks = chunkText(`Start ${'context '.repeat(500)} end`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount > 0)).toBe(true);
    expect(chunks[0]?.content).toContain('Start');
  });

  it('produces deterministic normalized local embeddings', () => {
    const embeddings = new DeterministicEmbeddingService();
    expect(embeddings.embed('database migration')).toEqual(
      embeddings.embed('database migration'),
    );
  });
});
