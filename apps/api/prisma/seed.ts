import { createDatabaseClient } from '../src/database/database-client.js';
import { developmentDatabaseUrl } from '../src/database/development-safety.js';
import { seedProviderRegistry } from '../src/database/provider-seed.js';
import {
  CreditTransactionStatus,
  CreditTransactionType,
  EntitlementValueType,
  RegistryRolloutState,
} from '../src/generated/prisma/client.js';

const connectionString = developmentDatabaseUrl(process.env);

const database = createDatabaseClient(connectionString);

const fakeModels = [
  { key: 'fake:balanced', providerId: 'fake-balanced', name: 'Fake Balanced' },
  { key: 'fake:fast', providerId: 'fake-fast', name: 'Fake Fast' },
  {
    key: 'fake:reasoning',
    providerId: 'fake-reasoning',
    name: 'Fake Reasoning',
  },
] as const;

async function seed(): Promise<void> {
  await seedProviderRegistry(database);
  const user = await database.user.upsert({
    where: { email: 'developer@omniroute.local' },
    create: {
      email: 'developer@omniroute.local',
      name: 'Local Developer',
      accounts: {
        create: {
          identityProvider: 'development',
          providerAccountId: 'local-developer',
          emailAtProvider: 'developer@omniroute.local',
        },
      },
      wallet: { create: {} },
    },
    update: {},
  });

  const workspace = await database.workspace.upsert({
    where: { id: '10000000-0000-4000-8000-000000000001' },
    create: {
      id: '10000000-0000-4000-8000-000000000001',
      ownerId: user.id,
      name: 'Local development',
    },
    update: {},
  });

  await database.entitlement.upsert({
    where: {
      workspaceId_key_startsAt: {
        workspaceId: workspace.id,
        key: 'monthly_credit_limit',
        startsAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    },
    create: {
      workspaceId: workspace.id,
      key: 'monthly_credit_limit',
      valueType: EntitlementValueType.INTEGER,
      integerValue: 100_000n,
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    update: {},
  });

  const fakeProvider = await database.provider.upsert({
    where: { key: 'fake' },
    create: {
      key: 'fake',
      displayName: 'OmniRoute Fake Provider',
      enabled: true,
    },
    update: { displayName: 'OmniRoute Fake Provider', enabled: true },
  });
  for (const modelSeed of fakeModels) {
    const model = await database.model.upsert({
      where: { modelKey: modelSeed.key },
      create: {
        providerId: fakeProvider.id,
        modelKey: modelSeed.key,
        providerModelId: modelSeed.providerId,
        displayName: modelSeed.name,
      },
      update: { displayName: modelSeed.name },
    });
    await database.providerRegistryEntry.upsert({
      where: {
        modelId_registryVersion: { modelId: model.id, registryVersion: 1 },
      },
      create: {
        providerId: fakeProvider.id,
        modelId: model.id,
        registryVersion: 1,
        capabilities: {
          modalities: { input: ['text'], output: ['text'] },
          files: false,
          images: false,
          search: false,
          tools: false,
          contextWindow: 32768,
          maxOutputTokens: 4096,
        },
        pricing: {
          currency: 'USD',
          inputPerMillionTokens: '0.00000000',
          outputPerMillionTokens: '0.00000000',
        },
        pricingVersion: 'local-v1',
        rolloutState: RegistryRolloutState.INTERNAL,
        enabled: true,
        effectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      update: {},
    });
  }

  await database.$transaction(async (transaction) => {
    const wallet = await transaction.creditWallet.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const grantKey = 'seed:initial-grant:v1';
    const existingGrant = await transaction.creditTransaction.findUnique({
      where: {
        walletId_idempotencyKey: {
          walletId: wallet.id,
          idempotencyKey: grantKey,
        },
      },
    });
    if (existingGrant) return;

    await transaction.creditWallet.update({
      where: { id: wallet.id },
      data: {
        availableCredits: { increment: 100_000n },
        version: { increment: 1 },
      },
    });
    await transaction.creditTransaction.create({
      data: {
        walletId: wallet.id,
        userId: user.id,
        idempotencyKey: grantKey,
        amount: 100_000n,
        availableDelta: 100_000n,
        reservedDelta: 0n,
        type: CreditTransactionType.GRANT,
        status: CreditTransactionStatus.COMPLETED,
        reason: 'Local development seed grant',
      },
    });
  });
}

seed()
  .then(() => database.$disconnect())
  .catch(async (error: unknown) => {
    await database.$disconnect();
    throw error;
  });
