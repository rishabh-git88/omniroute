import { Injectable } from '@nestjs/common';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_MODEL_VERSION,
  DeterministicEmbeddingService,
} from './deterministic-embedding.service.js';
export interface EmbeddingService {
  readonly dimensions: number;
  readonly model: string;
  readonly version: string;
  embed(content: string): number[];
  vectorLiteral(vector: readonly number[]): string;
}
export const EMBEDDING_SERVICE = Symbol('EMBEDDING_SERVICE');
@Injectable()
export class DisabledEmbeddingService implements EmbeddingService {
  public readonly dimensions = EMBEDDING_DIMENSIONS;
  public readonly model = EMBEDDING_MODEL;
  public readonly version = EMBEDDING_MODEL_VERSION;
  public embed(): number[] {
    throw new Error('EMBEDDING_PROVIDER_NOT_CONFIGURED');
  }
  public vectorLiteral(vector: readonly number[]): string {
    return '[' + vector.map((value) => value.toFixed(8)).join(',') + ']';
  }
}
export { DeterministicEmbeddingService };
