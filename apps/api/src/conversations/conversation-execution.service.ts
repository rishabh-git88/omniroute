import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  CanonicalChatRequest,
  CanonicalMessage,
} from '@omniroute/provider-contracts';

import {
  ConversationMode,
  ModelRunStatus,
  RequestGroupStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { MockProvider } from '../providers/mock.provider.js';
import { MetricsService } from '../observability/metrics.service.js';
import { CreditBillingService } from '../usage/credit-billing.service.js';
import { StreamEventHub } from './stream-event-hub.js';

export interface RunExecutionPlan {
  conversationId: string;
  groupId: string;
  mode: ConversationMode;
  request: CanonicalChatRequest;
  runId: string;
  selectOnComplete: boolean;
}

@Injectable()
export class ConversationExecutionService {
  public constructor(
    private readonly database: PrismaService,
    private readonly billing: CreditBillingService,
    private readonly events: StreamEventHub,
    private readonly metrics: MetricsService,
    private readonly provider: MockProvider,
  ) {}

  public start(plan: RunExecutionPlan): void {
    void this.execute(plan);
  }

  public async cancel(groupId: string, runId: string): Promise<void> {
    await this.provider.cancel(runId);
    const changed = await this.database.client.modelRun.updateMany({
      where: {
        id: runId,
        requestGroupId: groupId,
        status: {
          in: [
            ModelRunStatus.PENDING,
            ModelRunStatus.RESERVED,
            ModelRunStatus.RUNNING,
          ],
        },
      },
      data: { completedAt: new Date(), status: ModelRunStatus.CANCELLED },
    });
    if (changed.count === 0) return;
    await this.billing.releaseForRun(runId, 'cancelled');
    await this.database.client.requestGroup.updateMany({
      where: { id: groupId, status: { not: RequestGroupStatus.COMPLETED } },
      data: { status: RequestGroupStatus.CANCELLED },
    });
    this.events.publish(groupId, 'run.status', {
      runId,
      status: 'cancelled',
    });
  }

  private async execute(plan: RunExecutionPlan): Promise<void> {
    const executionStartedAt = performance.now();
    const started = await this.database.client.modelRun.updateMany({
      where: {
        id: plan.runId,
        status: {
          in: [
            ModelRunStatus.PENDING,
            ModelRunStatus.QUEUED,
            ModelRunStatus.RESERVED,
          ],
        },
      },
      data: { startedAt: new Date(), status: ModelRunStatus.RUNNING },
    });
    if (started.count === 0) return;

    this.events.publish(plan.groupId, 'run.status', {
      runId: plan.runId,
      status: 'running',
    });
    let content = '';
    let inputTokens = 0n;
    let outputTokens = 0n;
    try {
      for await (const event of this.provider.streamChat(plan.request)) {
        if (event.type === 'content.delta') {
          content += event.text;
          this.events.publish(plan.groupId, 'content.delta', {
            delta: event.text,
            runId: plan.runId,
          });
        }
        if (event.type === 'usage.updated') {
          inputTokens = BigInt(event.inputTokens ?? 0);
          outputTokens = BigInt(event.outputTokens ?? 0);
        }
      }
      await this.complete(plan, content, { inputTokens, outputTokens });
      this.metrics.recordProviderLatency(
        plan.request.provider,
        plan.request.modelKey,
        'completed',
        performance.now() - executionStartedAt,
      );
    } catch (error) {
      if (this.provider.isCancellation(error)) {
        await this.cancel(plan.groupId, plan.runId);
        this.metrics.recordProviderLatency(
          plan.request.provider,
          plan.request.modelKey,
          'cancelled',
          performance.now() - executionStartedAt,
        );
        return;
      }
      await this.fail(plan, error);
      this.metrics.recordProviderError(
        plan.request.provider,
        plan.request.modelKey,
      );
      this.metrics.recordProviderLatency(
        plan.request.provider,
        plan.request.modelKey,
        'failed',
        performance.now() - executionStartedAt,
      );
    }
  }

  private async complete(
    plan: RunExecutionPlan,
    content: string,
    usage: { inputTokens: bigint; outputTokens: bigint },
  ): Promise<void> {
    const completed = await this.database.client.$transaction(
      async (transaction) => {
        const run = await transaction.modelRun.findFirst({
          where: { id: plan.runId, requestGroupId: plan.groupId },
        });
        if (!run || run.status === ModelRunStatus.CANCELLED) return false;

        await transaction.modelRun.update({
          where: { id: plan.runId },
          data: { completedAt: new Date(), status: ModelRunStatus.COMPLETED },
        });
        const response = await transaction.modelResponse.create({
          data: {
            content,
            finishReason: 'stop',
            runId: plan.runId,
            turnId: run.turnId,
            ...(plan.selectOnComplete && plan.mode === ConversationMode.SINGLE
              ? { selectedAt: new Date() }
              : {}),
          },
        });
        if (plan.selectOnComplete && plan.mode === ConversationMode.SINGLE) {
          await transaction.conversation.update({
            where: { id: plan.conversationId },
            data: { activeHeadId: response.id },
          });
        }
        await transaction.requestGroup.update({
          where: { id: plan.groupId },
          data: { status: RequestGroupStatus.COMPLETED },
        });
        return true;
      },
    );
    if (!completed) return;
    await this.billing.settleRun({
      idempotencyKey: `run:${plan.runId}:settle`,
      modelRunId: plan.runId,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        providerUsage: {
          inputTokens: usage.inputTokens.toString(),
          outputTokens: usage.outputTokens.toString(),
        },
      },
    });
    this.events.publish(plan.groupId, 'run.status', {
      finishReason: 'stop',
      runId: plan.runId,
      status: 'completed',
    });
  }

  private async fail(plan: RunExecutionPlan, error: unknown): Promise<void> {
    await this.database.client.$transaction([
      this.database.client.modelRun.updateMany({
        where: { id: plan.runId, status: { not: ModelRunStatus.CANCELLED } },
        data: { completedAt: new Date(), status: ModelRunStatus.FAILED },
      }),
      this.database.client.requestGroup.updateMany({
        where: {
          id: plan.groupId,
          status: { not: RequestGroupStatus.CANCELLED },
        },
        data: { status: RequestGroupStatus.FAILED },
      }),
    ]);
    await this.billing.releaseForRun(plan.runId, 'provider_failure');
    this.events.publish(plan.groupId, 'run.error', {
      code: 'MOCK_PROVIDER_ERROR',
      message: error instanceof Error ? error.message : 'Mock provider failed',
      runId: plan.runId,
    });
  }

  public static contextHash(messages: CanonicalMessage[]): string {
    return createHash('sha256').update(JSON.stringify(messages)).digest('hex');
  }
}
