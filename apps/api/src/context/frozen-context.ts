import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  contextBundleSchema,
  type ContextBundle,
} from '@omniroute/provider-contracts';
import { enforceBudget, modelBudget } from './context-budget.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function contextHash(context: ContextBundle): string {
  return createHash('sha256').update(stable(context)).digest('hex');
}
export function readFrozen(snapshot: {
  payload: unknown;
  snapshotHash: string;
}): ContextBundle {
  const payload = snapshot.payload as {
    version?: number;
    context?: unknown;
  } | null;
  if (payload?.version !== 1)
    throw new BadRequestException(
      'This legacy response has no recoverable frozen context; submit a new turn',
    );
  const result = contextBundleSchema.safeParse(payload.context);
  if (!result.success || contextHash(result.data) !== snapshot.snapshotHash)
    throw new BadRequestException(
      'Frozen context integrity verification failed',
    );
  return result.data;
}
export function snapshotData(
  runId: string,
  context: ContextBundle,
  capabilities: unknown,
) {
  const budget = modelBudget(capabilities);
  enforceBudget(context, budget);
  return {
    runId,
    snapshotHash: contextHash(context),
    sourceIds: context.sourceIds,
    tokenEstimate: context.tokenEstimate,
    payload: {
      version: 1,
      context: JSON.parse(JSON.stringify(context)),
      budget,
    },
  };
}

export function frozenBudget(snapshot: { payload: unknown }) {
  const payload = snapshot.payload as {
    budget?: ReturnType<typeof modelBudget>;
  } | null;
  const stored = payload?.budget;
  if (!stored || stored.estimator !== 'utf8-bound-v1')
    throw new BadRequestException('Unsupported frozen budget policy');
  const checked = modelBudget({
    contextWindow: stored.contextWindow,
    maxOutputTokens: stored.maxOutputTokens,
  });
  if (
    checked.maxInputTokens !== stored.maxInputTokens ||
    checked.safetyTokens !== stored.safetyTokens
  )
    throw new BadRequestException('Invalid frozen budget');
  return checked;
}
