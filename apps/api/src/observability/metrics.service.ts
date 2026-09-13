import { metrics } from '@opentelemetry/api';
import { Injectable } from '@nestjs/common';

const meter = metrics.getMeter('omniroute.api');

@Injectable()
export class MetricsService {
  private readonly creditReleased = meter.createCounter(
    'omniroute.credit.released',
    {
      description: 'Platform credits released after a cancelled or failed run',
    },
  );
  private readonly creditReserved = meter.createCounter(
    'omniroute.credit.reserved',
    {
      description: 'Platform credits reserved before model execution',
    },
  );
  private readonly creditSettled = meter.createCounter(
    'omniroute.credit.settled',
    {
      description: 'Platform credits settled from normalized provider usage',
    },
  );
  private readonly creditReconciled = meter.createCounter(
    'omniroute.credit.reconciliation',
    {
      description: 'Bounded durable credit reconciliation outcomes',
    },
  );
  private readonly providerErrors = meter.createCounter(
    'omniroute.provider.errors',
    {
      description:
        'Terminal provider failures by stable provider and model key',
    },
  );
  private readonly providerLatency = meter.createHistogram(
    'omniroute.provider.latency',
    {
      description: 'Provider execution latency in seconds',
      unit: 's',
    },
  );
  private readonly routingDecisions = meter.createCounter(
    'omniroute.routing.decisions',
    {
      description: 'Routing decisions grouped by durable strategy',
    },
  );

  public recordCreditReleased(credits: bigint, reason: string): void {
    this.creditReleased.add(this.metricValue(credits), { reason });
  }

  public recordCreditReservation(credits: bigint): void {
    this.creditReserved.add(this.metricValue(credits));
  }

  public recordCreditSettlement(credits: bigint): void {
    this.creditSettled.add(this.metricValue(credits));
  }

  public recordCreditReconciliation(
    outcome: 'failed' | 'pending' | 'released' | 'settled',
  ): void {
    this.creditReconciled.add(1, { outcome });
  }

  public recordProviderError(provider: string, modelKey: string): void {
    this.providerErrors.add(1, { model_key: modelKey, provider });
  }

  public recordProviderLatency(
    provider: string,
    modelKey: string,
    outcome: 'cancelled' | 'completed' | 'failed',
    milliseconds: number,
  ): void {
    this.providerLatency.record(milliseconds / 1_000, {
      model_key: modelKey,
      outcome,
      provider,
    });
  }

  public recordRoutingDecision(strategy: string, candidates: number): void {
    this.routingDecisions.add(1, {
      candidate_count: String(candidates),
      strategy,
    });
  }

  private metricValue(value: bigint): number {
    return Number(
      value > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : value,
    );
  }
}
