import { Injectable } from '@nestjs/common';

import {
  Prisma,
  UsageEventKind,
  type UsageEvent,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface RecordUsageInput {
  runId: string;
  eventKey: string;
  kind: UsageEventKind;
  inputTokens: bigint;
  outputTokens: bigint;
  cachedTokens?: bigint;
  providerUsage: Prisma.InputJsonValue;
  priceSnapshot: Prisma.InputJsonValue;
  actualCost: Prisma.Decimal | Prisma.DecimalJsLike | number | string;
  costCurrency?: string;
  billedCredits: bigint;
}

@Injectable()
export class UsageRepository {
  public constructor(private readonly database: PrismaService) {}

  public async record(input: RecordUsageInput): Promise<UsageEvent> {
    await this.database.client.usageEvent.createMany({
      data: {
        runId: input.runId,
        eventKey: input.eventKey,
        kind: input.kind,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cachedTokens: input.cachedTokens ?? 0n,
        providerUsage: input.providerUsage,
        priceSnapshot: input.priceSnapshot,
        actualCost: input.actualCost,
        costCurrency: input.costCurrency ?? 'USD',
        billedCredits: input.billedCredits,
      },
      skipDuplicates: true,
    });

    return this.database.client.usageEvent.findUniqueOrThrow({
      where: {
        runId_eventKey: { runId: input.runId, eventKey: input.eventKey },
      },
    });
  }
}
