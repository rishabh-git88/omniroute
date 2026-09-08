import { Injectable } from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';

import {
  Prisma,
  type ProviderRegistryEntry,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { CreditLedgerRepository } from './credit-ledger.repository.js';
import { UsageRepository } from './usage.repository.js';

const TOKENS_PER_MILLION = new Prisma.Decimal('1000000');

export interface ProviderUsageInput {
  cachedTokens?: bigint;
  inputTokens: bigint;
  outputTokens: bigint;
  providerUsage: Prisma.InputJsonValue;
}

interface Pricing {
  currency: string;
  inputPerMillionTokens: string;
  outputPerMillionTokens: string;
}

@Injectable()
export class CreditBillingService {
  private readonly dailyFreeCredits: bigint;
  private readonly creditsPerUsd: bigint;

  public constructor(
    private readonly database: PrismaService,
    private readonly ledger: CreditLedgerRepository,
    private readonly metrics: MetricsService,
    private readonly usage: UsageRepository,
  ) {
    const environment = parseApiEnvironment(process.env);
    this.dailyFreeCredits = BigInt(environment.DAILY_FREE_CREDITS);
    this.creditsPerUsd = BigInt(environment.PLATFORM_CREDITS_PER_USD);
  }

  public async ensureDailyFreeGrant(userId: string, now = new Date()) {
    if (this.dailyFreeCredits === 0n) return null;
    const day = now.toISOString().slice(0, 10);
    return this.ledger.grant(
      userId,
      this.dailyFreeCredits,
      `daily-free:${day}`,
      `Daily free grant for ${day}`,
    );
  }

  public async reserveForRun(input: {
    estimatedInputTokens: bigint;
    maxOutputTokens: bigint;
    modelRunId: string;
    requestGroupId: string;
    userId: string;
  }) {
    await this.ensureDailyFreeGrant(input.userId);
    const run = await this.runPricing(input.modelRunId);
    const estimatedCost = this.cost(run.registryEntry.pricing, {
      inputTokens: input.estimatedInputTokens,
      outputTokens: input.maxOutputTokens,
    });
    const credits = this.creditsForCost(estimatedCost);
    if (credits === 0n) return null;
    const reservation = await this.ledger.reserve({
      credits,
      idempotencyKey: `run:${input.modelRunId}:reserve`,
      modelRunId: input.modelRunId,
      requestGroupId: input.requestGroupId,
      userId: input.userId,
    });
    this.metrics.recordCreditReservation(credits);
    return reservation;
  }

  public async settleRun(input: {
    idempotencyKey: string;
    modelRunId: string;
    usage: ProviderUsageInput;
  }) {
    const run = await this.runPricing(input.modelRunId);
    const actualCost = this.cost(run.registryEntry.pricing, input.usage);
    const billedCredits = this.creditsForCost(actualCost);
    const snapshot = this.priceSnapshot(run);
    const reservation = await this.database.client.creditReservation.findUnique(
      {
        where: { modelRunId: input.modelRunId },
      },
    );
    const usageInput = {
      actualCost,
      billedCredits,
      costCurrency: this.pricing(run.registryEntry.pricing).currency,
      eventKey: `${input.idempotencyKey}:usage`,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      priceSnapshot: snapshot,
      providerUsage: input.usage.providerUsage,
      ...(input.usage.cachedTokens === undefined
        ? {}
        : { cachedTokens: input.usage.cachedTokens }),
    };
    if (!reservation)
      return this.usage.record({
        kind: 'FINAL',
        runId: input.modelRunId,
        ...usageInput,
      });
    const wallet = await this.ledger.reconcile({
      actualCredits: billedCredits,
      idempotencyKey: input.idempotencyKey,
      reservationId: reservation.id,
      usage: usageInput,
    });
    this.metrics.recordCreditSettlement(billedCredits);
    return wallet;
  }

  public async releaseForRun(modelRunId: string, reason: string) {
    const reservation = await this.database.client.creditReservation.findUnique(
      {
        where: { modelRunId },
      },
    );
    if (!reservation) return null;
    const wallet = await this.ledger.reconcile({
      actualCredits: 0n,
      idempotencyKey: `run:${modelRunId}:release:${reason}`,
      reservationId: reservation.id,
    });
    this.metrics.recordCreditReleased(reservation.reservedCredits, reason);
    return wallet;
  }

  public creditsForCost(cost: Prisma.Decimal): bigint {
    if (cost.isNegative())
      throw new RangeError('Provider cost cannot be negative');
    return BigInt(cost.mul(this.creditsPerUsd.toString()).ceil().toFixed(0));
  }

  public cost(
    pricingValue: Prisma.JsonValue,
    usage: Pick<ProviderUsageInput, 'inputTokens' | 'outputTokens'>,
  ): Prisma.Decimal {
    const pricing = this.pricing(pricingValue);
    const input = new Prisma.Decimal(usage.inputTokens.toString())
      .mul(pricing.inputPerMillionTokens)
      .div(TOKENS_PER_MILLION);
    const output = new Prisma.Decimal(usage.outputTokens.toString())
      .mul(pricing.outputPerMillionTokens)
      .div(TOKENS_PER_MILLION);
    return input.add(output);
  }

  private async runPricing(modelRunId: string) {
    return this.database.client.modelRun.findUniqueOrThrow({
      where: { id: modelRunId },
      include: {
        model: { select: { modelKey: true } },
        provider: { select: { key: true } },
        registryEntry: true,
      },
    });
  }

  private priceSnapshot(run: {
    model: { modelKey: string };
    provider: { key: string };
    registryEntry: ProviderRegistryEntry;
  }): Prisma.InputJsonValue {
    return {
      modelKey: run.model.modelKey,
      pricing: run.registryEntry.pricing,
      pricingVersion: run.registryEntry.pricingVersion,
      provider: run.provider.key,
      registryVersion: run.registryEntry.registryVersion,
    };
  }

  private pricing(value: Prisma.JsonValue): Pricing {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Model Registry pricing is invalid');
    }
    const pricing = value as Record<string, unknown>;
    const currency = pricing.currency;
    const input = pricing.inputPerMillionTokens;
    const output = pricing.outputPerMillionTokens;
    if (
      currency !== 'USD' ||
      typeof input !== 'string' ||
      typeof output !== 'string' ||
      new Prisma.Decimal(input).isNegative() ||
      new Prisma.Decimal(output).isNegative()
    ) {
      throw new Error(
        'Model Registry pricing must be non-negative USD decimal strings',
      );
    }
    return {
      currency,
      inputPerMillionTokens: input,
      outputPerMillionTokens: output,
    };
  }
}
