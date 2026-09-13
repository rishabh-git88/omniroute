import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database/prisma.service.js';
import type { MetricsService } from '../observability/metrics.service.js';
import type { CreditBillingService } from './credit-billing.service.js';
import { CreditReconciliationService } from './credit-reconciliation.service.js';

function subject(reservations: Array<Record<string, unknown>>) {
  const billing = {
    releaseForRun: vi.fn().mockResolvedValue({}),
    settleRun: vi.fn().mockResolvedValue({}),
  } as unknown as CreditBillingService;
  const database = {
    client: {
      creditReservation: { findMany: vi.fn().mockResolvedValue(reservations) },
      modelRun: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ executionResult: {} }),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  } as unknown as PrismaService;
  const metrics = {
    recordCreditReconciliation: vi.fn(),
  } as unknown as MetricsService;
  return {
    billing,
    database,
    metrics,
    service: new CreditReconciliationService(billing, database, metrics),
  };
}

describe('CreditReconciliationService', () => {
  it('releases a stale reservation only when dispatch was never durable', async () => {
    const fixture = subject([
      {
        modelRunId: 'undispatched',
        modelRun: { executionResult: { dispatched: false } },
      },
    ]);
    await expect(fixture.service.reconcileBatch()).resolves.toMatchObject({
      released: 1,
    });
    expect(fixture.billing.releaseForRun).toHaveBeenCalledWith(
      'undispatched',
      'stale_undispatched_reservation',
    );
    expect(fixture.billing.settleRun).not.toHaveBeenCalled();
  });

  it('settles durable normalized usage with the stable run idempotency key', async () => {
    const fixture = subject([
      {
        modelRunId: 'used',
        modelRun: {
          executionResult: {
            dispatched: true,
            inputTokens: 12,
            outputTokens: 18,
            usageComplete: true,
          },
        },
      },
    ]);
    await expect(fixture.service.reconcileBatch()).resolves.toMatchObject({
      settled: 1,
    });
    expect(fixture.billing.settleRun).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'run:used:settle',
        modelRunId: 'used',
      }),
    );
  });

  it('keeps dispatched unknown-usage reservations pending rather than guessing free usage', async () => {
    const fixture = subject([
      {
        modelRunId: 'unknown',
        modelRun: { executionResult: { dispatched: true } },
      },
    ]);
    await expect(fixture.service.reconcileBatch()).resolves.toMatchObject({
      pending: 1,
    });
    expect(fixture.billing.releaseForRun).not.toHaveBeenCalled();
    expect(fixture.billing.settleRun).not.toHaveBeenCalled();
  });

  it('caps each invocation at a bounded batch size', async () => {
    const fixture = subject([]);
    await fixture.service.reconcileBatch({ batchSize: 1000 });
    expect(
      fixture.database.client.creditReservation.findMany,
    ).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
  });
});
