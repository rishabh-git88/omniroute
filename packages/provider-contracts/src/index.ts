import { z } from 'zod';

export const providerIdSchema = z.enum([
  'fake',
  'openai',
  'anthropic',
  'gemini',
]);

export const canonicalMessageSchema = z.strictObject({
  content: z.string().min(1),
  role: z.enum(['system', 'user', 'assistant']),
});

/**
 * The durable, provider-neutral handoff produced by the Context Builder.
 * Adapters only translate these canonical messages; retrieval and persistence
 * details never leak into provider SDK payloads.
 */
export const contextBundleSchema = z.strictObject({
  messages: z.array(canonicalMessageSchema).min(1),
  sourceIds: z.array(z.uuid()),
  provenance: z
    .array(
      z.strictObject({
        id: z.uuid(),
        fileId: z.uuid().optional(),
        kind: z.enum(['turn', 'response', 'memory', 'file_chunk']),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        included: z.boolean(),
        version: z.number().int().positive().optional(),
      }),
    )
    .optional(),
  retrieval: z.enum(['semantic', 'lexical', 'unavailable', 'empty']).optional(),
  summaryVersion: z.number().int().positive().optional(),
  tokenEstimate: z.number().int().nonnegative(),
});

export const canonicalChatRequestSchema = z.strictObject({
  context: contextBundleSchema,
  contextSnapshotId: z.uuid(),
  maxOutputTokens: z.number().int().positive(),
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
    usageFinal: z.boolean().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
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
export type ContextBundle = z.infer<typeof contextBundleSchema>;
export type ProviderEvent = z.infer<typeof providerEventSchema>;
export type ProviderId = z.infer<typeof providerIdSchema>;

export interface ProviderCapabilities {
  /** Model-specific values are sourced from the versioned Model Registry. */
  readonly registryVersion?: number;
  readonly values: Record<string, unknown>;
}

export interface NormalizedUsage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderHealth {
  provider: ProviderId;
  status: z.infer<typeof providerHealthStatusSchema>;
}

export interface ProviderGeneration {
  content: string;
  usage: NormalizedUsage;
}

export interface AIProvider {
  readonly id: ProviderId;
  capabilities(request: CanonicalChatRequest): Promise<ProviderCapabilities>;
  cancel(runId: string): Promise<void>;
  generate(request: CanonicalChatRequest): Promise<ProviderGeneration>;
  health(): Promise<ProviderHealth>;
  stream(request: CanonicalChatRequest): AsyncIterable<ProviderEvent>;
  streamChat(request: CanonicalChatRequest): AsyncIterable<ProviderEvent>;
  usage(request: CanonicalChatRequest): Promise<NormalizedUsage>;
}

/** Internal NestJS → router envelope; model data comes only from the registry. */
export const providerExecutionPlanSchema = z.strictObject({
  request: canonicalChatRequestSchema,
  model: z.strictObject({
    provider: z.enum(['openai', 'anthropic', 'gemini']),
    providerModelId: z.string().min(1),
    registryVersion: z.number().int().positive(),
    capabilities: z.record(z.string(), z.unknown()),
    pricingVersion: z.string().min(1),
  }),
});
export type ProviderExecutionPlan = z.infer<typeof providerExecutionPlanSchema>;

export const routingModeSchema = z.enum(['economy', 'smart', 'max']);
export type RoutingMode = z.infer<typeof routingModeSchema>;
export const providerHealthStatusSchema = z.enum([
  'disabled',
  'enabled',
  'missing_credentials',
  'temporarily_unhealthy',
  'rate_limited',
  'timed_out',
  'available',
  'ready',
  'degraded',
  'unavailable',
]);
export const providerHealthSchema = z.object({
  provider: providerIdSchema,
  status: providerHealthStatusSchema,
  latencyMs: z.number().int().nonnegative().optional(),
});
export const routingCandidateSchema = z.object({
  provider: providerIdSchema,
  modelKey: z.string().min(1),
  registryEntryId: z.uuid(),
  score: z.number(),
  reason: z.string(),
  estimatedCost: z.string().nullable().optional(),
  pricingVersion: z.string().nullable().optional(),
});
export const routingDecisionSchema = z.object({
  requestGroupId: z.uuid(),
  taskCategory: z.enum([
    'general',
    'coding',
    'debugging',
    'architecture',
    'reasoning',
    'writing',
    'summarization',
    'research',
    'long-context',
    'structured-data',
    'multimodal',
  ]),
  selectedProvider: providerIdSchema,
  selectedModel: z.string().min(1),
  selectedRegistryEntryId: z.uuid(),
  routingScore: z.number(),
  reason: z.string(),
  fallbackCandidates: z.array(routingCandidateSchema),
  estimatedCost: z.string().nullable().optional(),
  pricingVersion: z.string().nullable().optional(),
});
export type RoutingDecision = z.infer<typeof routingDecisionSchema>;

export const routingRequestSchema = z.strictObject({
  requestGroupId: z.uuid(),
  prompt: z.string().min(1).max(20000),
  mode: routingModeSchema.default('smart'),
  requestedMode: z.enum(['single', 'compare']).default('single'),
  models: z
    .array(
      z.strictObject({
        registryEntryId: z.uuid(),
        provider: providerIdSchema,
        modelKey: z.string().min(1),
        providerModelId: z.string().min(1),
        registryVersion: z.number().int().positive(),
        enabled: z.boolean(),
        capabilities: z.record(z.string(), z.unknown()),
        pricing: z.record(z.string(), z.unknown()).nullable().optional(),
        pricingVersion: z.string().nullable().optional(),
        latency: z.record(z.string(), z.unknown()).nullable().optional(),
        regionConstraints: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  providerHealth: z.array(providerHealthSchema).default([]),
  contextTokens: z.number().int().nonnegative().default(0),
  maxOutputTokens: z.number().int().positive().default(512),
  requiresTools: z.boolean().default(false),
  requiresMultimodal: z.boolean().default(false),
  region: z.string().nullable().optional(),
  userPreferredModel: z.string().nullable().optional(),
  userPreferredProvider: z.string().nullable().optional(),
});
