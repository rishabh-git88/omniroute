import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseRegistrySeed } from '@omniroute/config/registry-seed';
import { createDatabaseClient } from './database-client.js';
import { verifiedIntegrationUrl } from './integration-safety.js';
import { seedProviderRegistry } from './provider-seed.js';

const database = createDatabaseClient(await verifiedIntegrationUrl());
const model = parseRegistrySeed({
  models: [
    {
      provider: 'openai',
      modelKey: 'openai:synthetic-test',
      providerModelId: 'synthetic-test',
      displayName: 'Synthetic test only',
      registryVersion: 1,
      capabilities: {
        modalities: { input: ['text'], output: ['text'] },
        files: false,
        images: false,
        tools: false,
        search: false,
        contextWindow: 4096,
        maxOutputTokens: 512,
      },
      pricing: {
        currency: 'USD',
        inputPerMillionTokens: '1.25000000',
        outputPerMillionTokens: '4.75000000',
        sourceUrl: 'https://pricing.example.invalid',
        reviewedAt: '2026-09-10T00:00:00Z',
      },
      pricingVersion: 'synthetic-test-only',
      effectiveAt: '2026-09-10T00:00:00Z',
      regionConstraints: [],
    },
  ],
})[0]!;

beforeEach(async () => {
  await database.$executeRawUnsafe(
    'TRUNCATE users, providers RESTART IDENTITY CASCADE',
  );
});
afterAll(async () => {
  await database.$disconnect();
});

describe('provider registry seed alignment', () => {
  it('renames google in place and preserves model references', async () => {
    const legacy = await database.provider.create({
      data: { key: 'google', displayName: 'Google' },
    });
    const existingModel = await database.model.create({
      data: {
        providerId: legacy.id,
        modelKey: 'google:retained',
        providerModelId: 'retained',
        displayName: 'Retained model',
      },
    });
    await seedProviderRegistry(database);
    expect(
      (await database.provider.findUniqueOrThrow({ where: { key: 'gemini' } }))
        .id,
    ).toBe(legacy.id);
    expect(
      (
        await database.model.findUniqueOrThrow({
          where: { id: existingModel.id },
        })
      ).providerId,
    ).toBe(legacy.id);
    expect(
      await database.provider.findUnique({ where: { key: 'google' } }),
    ).toBeNull();
  });
  it('is idempotent and creates no invented real-model pricing', async () => {
    await seedProviderRegistry(database);
    await seedProviderRegistry(database);
    expect(await database.provider.count()).toBe(5);
    expect(await database.provider.count({ where: { enabled: true } })).toBe(0);
    expect(await database.providerRegistryEntry.count()).toBe(0);
  });
  it('stores reviewed exact pricing disabled and preserves prior registry versions', async () => {
    await seedProviderRegistry(database, [model]);
    await seedProviderRegistry(database, [model]);
    expect(await database.providerRegistryEntry.count()).toBe(1);
    expect(
      await database.providerRegistryEntry.findFirstOrThrow(),
    ).toMatchObject({
      enabled: false,
      rolloutState: 'DISABLED',
      pricing: model.pricing,
    });
    await expect(
      seedProviderRegistry(database, [{ ...model, pricingVersion: 'changed' }]),
    ).rejects.toThrow('immutable');
    await seedProviderRegistry(database, [
      { ...model, registryVersion: 2, pricingVersion: 'second-version' },
    ]);
    expect(await database.providerRegistryEntry.count()).toBe(2);
  });
  it('refuses to guess a merge when both provider records have references', async () => {
    for (const key of ['google', 'gemini']) {
      await database.provider.create({
        data: {
          key,
          displayName: key,
          models: {
            create: {
              modelKey: `${key}:retained`,
              providerModelId: 'retained',
              displayName: 'Retained',
            },
          },
        },
      });
    }
    await expect(seedProviderRegistry(database)).rejects.toThrow(
      'explicit reconciliation',
    );
    expect(await database.provider.count()).toBe(2);
    expect(await database.model.count()).toBe(2);
  });
});
