import { BadRequestException } from '@nestjs/common';
import type {
  CanonicalMessage,
  ContextBundle,
} from '@omniroute/provider-contracts';

/** Conservative UTF-8 byte bound plus framing; never a whitespace word count.
 * Provider tokenizer-specific measurement may replace this versioned policy later.
 */
export function estimateTokens(messages: readonly CanonicalMessage[]): number {
  return (
    32 +
    messages.reduce(
      (sum, message) => sum + 16 + Buffer.byteLength(message.content, 'utf8'),
      0,
    )
  );
}

export function modelBudget(capabilities: unknown) {
  const values = capabilities as Record<string, unknown> | null;
  const contextWindow = values?.contextWindow;
  const limit = values?.maxOutputTokens;
  if (
    typeof contextWindow !== 'number' ||
    !Number.isSafeInteger(contextWindow) ||
    contextWindow <= 0 ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > contextWindow
  ) {
    throw new BadRequestException('Model has no valid context/output budget');
  }
  const maxOutputTokens = Math.min(512, limit);
  const maxInputTokens = contextWindow - maxOutputTokens - 128;
  if (maxInputTokens <= 0)
    throw new BadRequestException('Model context budget is too small');
  return {
    contextWindow,
    maxOutputTokens,
    maxInputTokens,
    safetyTokens: 128,
    estimator: 'utf8-bound-v1' as const,
  };
}

export function enforceBudget(
  context: ContextBundle,
  budget: ReturnType<typeof modelBudget>,
): void {
  if (
    estimateTokens(context.messages) !== context.tokenEstimate ||
    context.tokenEstimate > budget.maxInputTokens
  ) {
    throw new BadRequestException(
      'Frozen context does not fit the selected model; choose a larger model',
    );
  }
}
