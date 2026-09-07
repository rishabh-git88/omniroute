import { z } from 'zod';

export const providerIdSchema = z.enum([
  'fake',
  'openai',
  'anthropic',
  'gemini',
]);

export const canonicalMessageSchema = z.object({
  content: z.string().min(1),
  role: z.enum(['system', 'user', 'assistant']),
});

export const canonicalChatRequestSchema = z.object({
  contextSnapshotId: z.uuid(),
  maxOutputTokens: z.number().int().positive(),
  messages: z.array(canonicalMessageSchema).min(1),
  modelKey: z.string().min(1),
  provider: providerIdSchema,
  runId: z.uuid(),
  temperature: z.number().min(0).max(2).optional(),
});

export const providerEventSchema = z.discriminatedUnion('type', [
  z.object({
    providerRequestId: z.string().optional(),
    runId: z.uuid(),
    type: z.literal('run.started'),
  }),
  z.object({
    runId: z.uuid(),
    text: z.string(),
    type: z.literal('content.delta'),
  }),
  z.object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    runId: z.uuid(),
    type: z.literal('usage.updated'),
  }),
  z.object({
    finishReason: z.string(),
    runId: z.uuid(),
    type: z.literal('run.completed'),
  }),
  z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    runId: z.uuid(),
    type: z.literal('run.failed'),
  }),
]);

export type CanonicalChatRequest = z.infer<typeof canonicalChatRequestSchema>;
export type CanonicalMessage = z.infer<typeof canonicalMessageSchema>;
export type ProviderEvent = z.infer<typeof providerEventSchema>;
export type ProviderId = z.infer<typeof providerIdSchema>;

export interface AIProvider {
  readonly id: ProviderId;
  cancel(runId: string): Promise<void>;
  streamChat(request: CanonicalChatRequest): AsyncIterable<ProviderEvent>;
}
