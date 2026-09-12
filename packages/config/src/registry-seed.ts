import { z } from 'zod';

const price = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,8})?$/);
export const registryCapabilitiesSchema = z
  .strictObject({
    taskScores: z
      .partialRecord(
        z.enum([
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
        z.number().min(0).max(100),
      )
      .optional(),
    qualityScore: z.number().min(0).max(100).optional(),
    typicalLatencyMs: z.number().int().positive().max(300000).optional(),
    modalities: z.strictObject({
      input: z.array(z.string().min(1)).min(1),
      output: z.array(z.string().min(1)).min(1),
    }),
    files: z.boolean(),
    images: z.boolean(),
    search: z.boolean(),
    tools: z.boolean(),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
  })
  .refine((value) => value.maxOutputTokens <= value.contextWindow);
const model = z
  .strictObject({
    provider: z.enum(['openai', 'anthropic', 'gemini', 'groq', 'openrouter']),
    modelKey: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    // Some reviewed upstream IDs are namespaced (for example `openai/gpt-oss-120b`).
    providerModelId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
    displayName: z.string().trim().min(1),
    registryVersion: z.number().int().positive(),
    capabilities: registryCapabilitiesSchema,
    pricing: z.strictObject({
      currency: z.literal('USD'),
      inputPerMillionTokens: price,
      outputPerMillionTokens: price,
      sourceUrl: z.url().refine((value) => value.startsWith('https://')),
      reviewedAt: z.iso.datetime(),
    }),
    pricingVersion: z.string().trim().min(1),
    effectiveAt: z.iso.datetime(),
    regionConstraints: z.array(z.string().min(1)),
  })
  .refine((value) => value.modelKey.startsWith(`${value.provider}:`));
const schema = z.strictObject({ models: z.array(model) }).refine((value) => {
  const keys = value.models.map(
    (item) => `${item.modelKey}:${item.registryVersion}`,
  );
  return new Set(keys).size === keys.length;
});

export type RegistrySeedModel = z.infer<typeof model>;
export function parseRegistrySeed(value: unknown): RegistrySeedModel[] {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(
      'Invalid model registry seed: explicit reviewed pricing, capabilities, identities and versions are required.',
    );
  return result.data.models;
}

/** Production routing requires reviewed quality and latency as well as valid billing data. */
export function validateRoutingRegistry(value: unknown): RegistrySeedModel {
  const entry = model.parse(value);
  if (
    entry.capabilities.taskScores?.general === undefined ||
    entry.capabilities.qualityScore === undefined ||
    entry.capabilities.typicalLatencyMs === undefined
  )
    throw new Error('Reviewed routing metadata is required');
  if (
    !entry.capabilities.modalities.input.includes('text') ||
    !entry.capabilities.modalities.output.includes('text')
  )
    throw new Error('Text execution capabilities are required');
  return entry;
}
