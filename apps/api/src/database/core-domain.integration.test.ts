import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabaseClient } from './database-client.js';
import { verifiedIntegrationUrl } from './integration-safety.js';
import type { PrismaService } from './prisma.service.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { CreditLedgerRepository } from '../usage/credit-ledger.repository.js';
import { DeterministicEmbeddingService } from '../context/deterministic-embedding.service.js';
import { SemanticRetrievalService } from '../context/semantic-retrieval.service.js';

const connectionString = await verifiedIntegrationUrl();

let database: PrismaClient;
let ledger: CreditLedgerRepository;

async function createRunFixture(modelCount = 2) {
  const user = await database.user.create({
    data: {
      email: `test-${crypto.randomUUID()}@omniroute.local`,
      wallet: { create: {} },
    },
    include: { wallet: true },
  });
  const workspace = await database.workspace.create({
    data: { ownerId: user.id, name: 'Constraint tests' },
  });
  const conversation = await database.conversation.create({
    data: { workspaceId: workspace.id, title: 'Constraint test conversation' },
  });
  const requestGroup = await database.requestGroup.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      conversationId: conversation.id,
      idempotencyKey: crypto.randomUUID(),
      mode: 'COMPARE',
    },
  });
  const turn = await database.turn.create({
    data: {
      conversationId: conversation.id,
      requestGroupId: requestGroup.id,
      userContent: 'Which answer is best?',
    },
  });
  const provider = await database.provider.create({
    data: {
      key: `fake-${crypto.randomUUID()}`,
      displayName: 'Test provider',
      enabled: true,
    },
  });
  const runs = [];
  for (let index = 0; index < modelCount; index += 1) {
    const model = await database.model.create({
      data: {
        providerId: provider.id,
        modelKey: `fake:test-${crypto.randomUUID()}`,
        providerModelId: `test-${index}-${crypto.randomUUID()}`,
        displayName: `Test ${index}`,
      },
    });
    const registry = await database.providerRegistryEntry.create({
      data: {
        providerId: provider.id,
        modelId: model.id,
        registryVersion: 1,
        capabilities: { modalities: { input: ['text'], output: ['text'] } },
        pricing: {
          currency: 'USD',
          inputPerMillionTokens: '0',
          outputPerMillionTokens: '0',
        },
        pricingVersion: 'test-v1',
        rolloutState: 'INTERNAL',
        enabled: true,
        effectiveAt: new Date(),
      },
    });
    runs.push(
      await database.modelRun.create({
        data: {
          turnId: turn.id,
          requestGroupId: requestGroup.id,
          providerId: provider.id,
          modelId: model.id,
          registryEntryId: registry.id,
          status: 'COMPLETED',
        },
      }),
    );
  }
  return { conversation, requestGroup, runs, turn, user, workspace };
}

describe('core PostgreSQL domain constraints', () => {
  beforeEach(async () => {
    database = createDatabaseClient(connectionString);
    ledger = new CreditLedgerRepository({ client: database } as PrismaService);
    await database.$connect();
    await database.$executeRawUnsafe(
      'TRUNCATE TABLE users, providers RESTART IDENTITY CASCADE',
    );
  });

  afterEach(async () => {
    await database.$disconnect().catch(() => undefined);
  });

  it('has pgvector enabled', async () => {
    const result = await database.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    expect(result).toEqual([{ extname: 'vector' }]);
  });

  it('retrieves only semantically relevant chunks inside the workspace', async () => {
    const user = await database.user.create({
      data: { email: `retrieval-${crypto.randomUUID()}@omniroute.local` },
    });
    const workspace = await database.workspace.create({
      data: { name: 'Retrieval workspace', ownerId: user.id },
    });
    const file = await database.workspaceFile.create({
      data: {
        mime: 'text/plain',
        objectKey: `test/${crypto.randomUUID()}`,
        originalName: 'notes.txt',
        size: BigInt(100),
        workspaceId: workspace.id,
      },
    });
    const chunks = await database.fileChunk.createManyAndReturn({
      data: [
        {
          chunkIndex: 0,
          content: 'PostgreSQL migrations use transactional DDL.',
          fileId: file.id,
        },
        {
          chunkIndex: 1,
          content: 'A garden needs water and sunlight.',
          fileId: file.id,
        },
      ],
    });
    const embeddings = new DeterministicEmbeddingService();
    const retrieval = new SemanticRetrievalService(
      { client: database } as PrismaService,
      embeddings,
    );
    for (const chunk of chunks) {
      await retrieval.indexFileChunk({
        content: chunk.content,
        contentHash: createHash('sha256').update(chunk.content).digest('hex'),
        fileChunkId: chunk.id,
        workspaceId: workspace.id,
      });
    }

    const result = await retrieval.retrieve(
      workspace.id,
      'database migrations',
      1,
    );
    expect(result[0]?.content).toContain('PostgreSQL migrations');
  });

  it('enforces normalized identities', async () => {
    await expect(
      database.user.create({
        data: { email: 'Not-Normalized@OmniRoute.local' },
      }),
    ).rejects.toThrow();
  });

  it('enforces request idempotency', async () => {
    const fixture = await createRunFixture(1);
    await expect(
      database.requestGroup.create({
        data: {
          userId: fixture.user.id,
          workspaceId: fixture.workspace.id,
          conversationId: fixture.conversation.id,
          idempotencyKey: fixture.requestGroup.idempotencyKey,
          mode: 'SINGLE',
        },
      }),
    ).rejects.toThrow();
  });

  it('allows at most one selected response per turn', async () => {
    const fixture = await createRunFixture(2);
    await database.modelResponse.create({
      data: {
        runId: fixture.runs[0]!.id,
        turnId: fixture.turn.id,
        content: 'First',
        selectedAt: new Date(),
      },
    });
    await expect(
      database.modelResponse.create({
        data: {
          runId: fixture.runs[1]!.id,
          turnId: fixture.turn.id,
          content: 'Second',
          selectedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it('scopes the active head to its conversation', async () => {
    const fixture = await createRunFixture(1);
    const first = await database.modelResponse.create({
      data: {
        runId: fixture.runs[0]!.id,
        turnId: fixture.turn.id,
        content: 'First',
        selectedAt: new Date(),
      },
    });
    const otherConversation = await database.conversation.create({
      data: {
        workspaceId: fixture.workspace.id,
        title: 'Another conversation',
      },
    });
    await expect(
      database.conversation.update({
        where: { id: otherConversation.id },
        data: { activeHeadId: first.id },
      }),
    ).rejects.toThrow();
  });

  it('prevents parallel reservations from overspending a wallet', async () => {
    const fixture = await createRunFixture(2);
    await ledger.grant(fixture.user.id, 100n, 'test-grant');

    const results = await Promise.allSettled(
      fixture.runs.map((run, index) =>
        ledger.reserve({
          userId: fixture.user.id,
          requestGroupId: fixture.requestGroup.id,
          modelRunId: run.id,
          credits: 80n,
          idempotencyKey: `reservation-${index}`,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);

    const wallet = await database.creditWallet.findUniqueOrThrow({
      where: { userId: fixture.user.id },
    });
    expect(wallet.availableCredits).toBe(20n);
    expect(wallet.reservedCredits).toBe(80n);

    const reservation = await database.creditReservation.findFirstOrThrow();
    const reconciled = await ledger.reconcile({
      reservationId: reservation.id,
      actualCredits: 50n,
      idempotencyKey: 'settlement-1',
    });
    expect(reconciled.availableCredits).toBe(50n);
    expect(reconciled.reservedCredits).toBe(0n);
  });

  it('releases a failed reservation exactly once across retries', async () => {
    const fixture = await createRunFixture(1);
    await ledger.grant(fixture.user.id, 100n, 'failure-grant');
    const reservation = await ledger.reserve({
      credits: 40n,
      idempotencyKey: 'failure-reservation',
      modelRunId: fixture.runs[0]!.id,
      requestGroupId: fixture.requestGroup.id,
      userId: fixture.user.id,
    });
    await ledger.reconcile({
      actualCredits: 0n,
      idempotencyKey: 'failure-release',
      reservationId: reservation.id,
    });
    await ledger.reconcile({
      actualCredits: 0n,
      idempotencyKey: 'failure-release-retry',
      reservationId: reservation.id,
    });

    const wallet = await database.creditWallet.findUniqueOrThrow({
      where: { userId: fixture.user.id },
    });
    expect(wallet).toMatchObject({
      availableCredits: 100n,
      reservedCredits: 0n,
    });
    expect(
      await database.creditTransaction.count({ where: { type: 'RELEASE' } }),
    ).toBe(1);
  });

  it('records immutable provider usage while settling and releasing the remainder', async () => {
    const fixture = await createRunFixture(1);
    await ledger.grant(fixture.user.id, 100n, 'usage-grant');
    const reservation = await ledger.reserve({
      credits: 50n,
      idempotencyKey: 'usage-reservation',
      modelRunId: fixture.runs[0]!.id,
      requestGroupId: fixture.requestGroup.id,
      userId: fixture.user.id,
    });
    await ledger.reconcile({
      actualCredits: 30n,
      idempotencyKey: 'usage-settle',
      reservationId: reservation.id,
      usage: {
        actualCost: '0.00003000',
        billedCredits: 30n,
        costCurrency: 'USD',
        eventKey: 'provider-final',
        inputTokens: 12n,
        outputTokens: 18n,
        priceSnapshot: {
          modelKey: 'fake:test',
          pricingVersion: 'v1',
          provider: 'fake',
        },
        providerUsage: { input_tokens: '12', output_tokens: '18' },
      },
    });
    expect(await database.usageEvent.findFirstOrThrow()).toMatchObject({
      billedCredits: 30n,
      inputTokens: 12n,
      outputTokens: 18n,
    });
    expect(
      await database.creditTransaction.findMany({
        orderBy: { createdAt: 'asc' },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 30n, type: 'CHARGE' }),
        expect.objectContaining({ amount: 20n, type: 'RELEASE' }),
      ]),
    );
  });

  it('keeps ledger entries immutable', async () => {
    const fixture = await createRunFixture(1);
    await ledger.grant(fixture.user.id, 100n, 'immutable-grant');
    const transaction = await database.creditTransaction.findFirstOrThrow();

    await expect(
      database.creditTransaction.update({
        where: { id: transaction.id },
        data: { reason: 'tampered' },
      }),
    ).rejects.toThrow(/append-only/);
  });
});
