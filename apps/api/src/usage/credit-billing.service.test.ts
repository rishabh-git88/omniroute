import { describe, expect, it } from 'vitest';

import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { MetricsService } from '../observability/metrics.service.js';
import { CreditLedgerRepository } from './credit-ledger.repository.js';
import { CreditBillingService } from './credit-billing.service.js';
import { UsageRepository } from './usage.repository.js';

describe('CreditBillingService', () => {
  const billing = new CreditBillingService(
    {} as PrismaService,
    {} as CreditLedgerRepository,
    {} as MetricsService,
    {} as UsageRepository,
  );

  it('converts exact decimal provider cost to integer platform credits without floats', () => {
    const cost = billing.cost(
      {
        currency: 'USD',
        inputPerMillionTokens: '0.12345678',
        outputPerMillionTokens: '0.87654321',
      } as Prisma.JsonValue,
      { inputTokens: 1_000_000n, outputTokens: 1_000_000n },
    );
    expect(cost.toFixed(8)).toBe('0.99999999');
    expect(billing.creditsForCost(cost)).toBe(1_000_000n);
  });

  it('rounds a non-zero fractional credit up rather than losing it', () => {
    expect(billing.creditsForCost(new Prisma.Decimal('0.000000001'))).toBe(1n);
  });
});
