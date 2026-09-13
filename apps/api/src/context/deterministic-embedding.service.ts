import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

export const EMBEDDING_DIMENSIONS = 64;
export const EMBEDDING_MODEL = 'omniroute-local-hash';
export const EMBEDDING_MODEL_VERSION = 'v1';

/**
 * A deterministic, local development embedding. It keeps the retrieval
 * pipeline testable with no provider credentials; production can replace this
 * service without changing chunks, retrieval, or context assembly.
 */
@Injectable()
export class DeterministicEmbeddingService {
  public readonly dimensions = EMBEDDING_DIMENSIONS;
  public readonly model = EMBEDDING_MODEL;
  public readonly version = EMBEDDING_MODEL_VERSION;
  public embed(content: string): number[] {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
    for (const token of content
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_-]+/gu) ?? []) {
      const digest = createHash('sha256').update(token).digest();
      const first = digest[0] ?? 0;
      const second = digest[1] ?? 0;
      const index = first % EMBEDDING_DIMENSIONS;
      vector[index] = (vector[index] ?? 0) + (second % 2 === 0 ? 1 : -1);
    }
    const magnitude = Math.sqrt(
      vector.reduce((total, value) => total + value * value, 0),
    );
    return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
  }

  public vectorLiteral(vector: readonly number[]): string {
    return `[${vector.map((value) => value.toFixed(8)).join(',')}]`;
  }
}
