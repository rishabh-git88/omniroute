import { Injectable } from '@nestjs/common';
import { CreditReservationStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { CreditBillingService } from './credit-billing.service.js';

export interface CreditReconciliationOptions {
  batchSize?: number;
  olderThan?: Date;
}

export interface CreditReconciliationSummary {
  examined: number;
  failed: number;
  pending: number;
  released: number;
  settled: number;
}

/**
 * Bounded, idempotent recovery for reservations whose provider execution no
 * longer owns a live request. PostgreSQL is the sole source of evidence.
 */
@Injectable()
export class CreditReconciliationService {
  public constructor(
    private readonly billing: CreditBillingService,
    private readonly database: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  public async reconcileBatch(
    options: CreditReconciliationOptions = {},
  ): Promise<CreditReconciliationSummary> {
    const take = Math.min(Math.max(options.batchSize ?? 50, 1), 200);
    const olderThan = options.olderThan ?? new Date(Date.now() - 5 * 60_000);
    const reservations = await this.database.client.creditReservation.findMany({
      where: {
        createdAt: { lt: olderThan },
        status: CreditReservationStatus.PENDING,
      },
      include: {
        modelRun: { select: { executionResult: true, id: true } },
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
    const summary: CreditReconciliationSummary = {
      examined: reservations.length,
      failed: 0,
      pending: 0,
      released: 0,
      settled: 0,
    };
    for (const reservation of reservations) {
      const result = (reservation.modelRun.executionResult ?? {}) as Record<
        string,
        unknown
      >;
      const dispatched = result.dispatched === true;
      try {
        if (!dispatched) {
          await this.billing.releaseForRun(
            reservation.modelRunId,
            'stale_undispatched_reservation',
          );
          summary.released += 1;
          this.metrics.recordCreditReconciliation('released');
          continue;
        }
        const inputTokens = this.nonNegativeInteger(result.inputTokens);
        const outputTokens = this.nonNegativeInteger(result.outputTokens);
        if (
          result.usageComplete === true &&
          inputTokens !== undefined &&
          outputTokens !== undefined
        ) {
          await this.billing.settleRun({
            idempotencyKey: `run:${reservation.modelRunId}:settle`,
            modelRunId: reservation.modelRunId,
            usage: {
              inputTokens: BigInt(inputTokens),
              outputTokens: BigInt(outputTokens),
              providerUsage: {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
            },
          });
          await this.setBillingState(reservation.modelRunId, 'settled');
          summary.settled += 1;
          this.metrics.recordCreditReconciliation('settled');
          continue;
        }
        await this.setBillingState(
          reservation.modelRunId,
          'reconciliation_required',
        );
        summary.pending += 1;
        this.metrics.recordCreditReconciliation('pending');
      } catch {
        await this.setBillingState(
          reservation.modelRunId,
          'reconciliation_required',
        );
        summary.failed += 1;
        this.metrics.recordCreditReconciliation('failed');
      }
    }
    return summary;
  }

  private async setBillingState(runId: string, billingState: string) {
    const run = await this.database.client.modelRun.findUniqueOrThrow({
      where: { id: runId },
      select: { executionResult: true },
    });
    await this.database.client.modelRun.update({
      where: { id: runId },
      data: {
        executionResult: {
          ...((run.executionResult ?? {}) as Record<string, Prisma.JsonValue>),
          billingState,
        },
      },
    });
  }

  private nonNegativeInteger(value: unknown): number | undefined {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
      ? value
      : undefined;
  }
}
