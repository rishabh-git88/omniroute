import { z } from 'zod';

const price = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,8})?$/);
const capabilities = z
  .strictObject({
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
    provider: z.enum(['openai', 'anthropic', 'gemini']),
    modelKey: z.string().regex(/^[a-z0-9][a-z0-9:._-]*$/),
    providerModelId: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    registryVersion: z.number().int().positive(),
    capabilities,
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
