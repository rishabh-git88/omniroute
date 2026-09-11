import { isDeepStrictEqual } from 'node:util';
import type { RegistrySeedModel } from '@omniroute/config/registry-seed';
import type { PrismaClient } from '../generated/prisma/client.js';

/** Metadata only. Never enables real execution or supplies invented prices. */
export async function seedProviderRegistry(
  database: PrismaClient,
  models: RegistrySeedModel[] = [],
): Promise<void> {
  await database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(73492402)`;
      const providers = await transaction.provider.findMany({
        where: { key: { in: ['google', 'gemini'] } },
        include: {
          _count: {
            select: { models: true, registryEntries: true, modelRuns: true },
          },
        },
      });
      const legacy = providers.find((provider) => provider.key === 'google');
      const canonical = providers.find((provider) => provider.key === 'gemini');
      const empty = (provider: (typeof providers)[number]) =>
        Object.values(provider._count).every((count) => count === 0);
      if (legacy) {
        if (canonical && !empty(legacy) && !empty(canonical)) {
          throw new Error(
            'Both google and gemini have references; an explicit reconciliation is required. No records changed.',
          );
        }
        if (canonical && empty(legacy)) {
          await transaction.provider.delete({ where: { id: legacy.id } });
        } else {
          if (canonical)
            await transaction.provider.delete({ where: { id: canonical.id } });
          await transaction.provider.update({
            where: { id: legacy.id },
            data: { key: 'gemini', displayName: 'Google Gemini' },
          });
        }
      }
      for (const provider of [
        { key: 'openai', displayName: 'OpenAI' },
        { key: 'anthropic', displayName: 'Anthropic' },
        { key: 'gemini', displayName: 'Google Gemini' },
      ]) {
        await transaction.provider.upsert({
          where: { key: provider.key },
          create: { ...provider, enabled: false },
          update: { displayName: provider.displayName },
        });
      }
      for (const entry of models) {
        const provider = await transaction.provider.findUniqueOrThrow({
          where: { key: entry.provider },
        });
        const existing = await transaction.model.findUnique({
          where: { modelKey: entry.modelKey },
        });
        if (
          existing &&
          (existing.providerId !== provider.id ||
            existing.providerModelId !== entry.providerModelId)
        ) {
          throw new Error(
            'Model identity changed; use a new stable model key.',
          );
        }
        const model =
          existing ??
          (await transaction.model.create({
            data: {
              providerId: provider.id,
              providerModelId: entry.providerModelId,
              modelKey: entry.modelKey,
              displayName: entry.displayName,
            },
          }));
        const previous = await transaction.providerRegistryEntry.findUnique({
          where: {
            modelId_registryVersion: {
              modelId: model.id,
              registryVersion: entry.registryVersion,
            },
          },
        });
        const snapshot = {
          capabilities: entry.capabilities,
          pricing: entry.pricing,
          pricingVersion: entry.pricingVersion,
          regionConstraints: entry.regionConstraints,
          effectiveAt: new Date(entry.effectiveAt),
        };
        if (previous) {
          const prior = {
            capabilities: previous.capabilities,
            pricing: previous.pricing,
            pricingVersion: previous.pricingVersion,
            regionConstraints: previous.regionConstraints,
            effectiveAt: previous.effectiveAt,
          };
          if (!isDeepStrictEqual(prior, snapshot))
            throw new Error(
              'Registry snapshot is immutable; increment registryVersion for a change.',
            );
        } else {
          await transaction.providerRegistryEntry.create({
            data: {
              ...snapshot,
              modelId: model.id,
              providerId: provider.id,
              registryVersion: entry.registryVersion,
              enabled: false,
              rolloutState: 'DISABLED',
            },
          });
        }
      }
    },
    { timeout: 15000 },
  );
}
