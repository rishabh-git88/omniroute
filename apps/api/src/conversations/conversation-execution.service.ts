import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  canonicalChatRequestSchema,
  type CanonicalChatRequest,
} from '@omniroute/provider-contracts';
import { readFrozen, frozenBudget } from '../context/frozen-context.js';
import { enforceBudget } from '../context/context-budget.js';
import {
  ConversationMode,
  ModelRunStatus,
  RequestGroupStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { ExecutionGateway } from '../providers/execution-gateway.js';
import { ProviderExecutionError } from '../providers/ai-router.client.js';
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
export class ConversationExecutionService implements OnModuleDestroy {
  private readonly active = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();

  public constructor(
    private readonly database: PrismaService,
    private readonly billing: CreditBillingService,
    private readonly events: StreamEventHub,
    private readonly metrics: MetricsService,
    private readonly provider: ExecutionGateway,
  ) {}

  public async onModuleDestroy(): Promise<void> {
    const active = [...this.active.values()];
    for (const run of active) run.controller.abort();
    await Promise.all(active.map((run) => run.done));
  }

  public start(plan: RunExecutionPlan): void {
    if (this.active.has(plan.runId)) return;
    const controller = new AbortController();
    const done = this.execute(plan, controller.signal).finally(() =>
      this.active.delete(plan.runId),
    );
    this.active.set(plan.runId, { controller, done });
  }

  public async cancel(groupId: string, runId: string): Promise<void> {
    const running = this.active.get(runId);
    if (running) {
      running.controller.abort(); // Aborts Nest fetch; FastAPI disconnect cancels upstream HTTP.
      await running.done;
      return;
    }
    const changed = await this.database.client.modelRun.updateMany({
      where: {
        id: runId,
        requestGroupId: groupId,
        status: { in: ['PENDING', 'QUEUED', 'RESERVED'] },
      },
      data: {
        completedAt: new Date(),
        status: ModelRunStatus.CANCELLED,
        executionResult: {
          failureCode: 'CANCELLED',
          latencyMs: 0,
          dispatched: false,
        },
      },
    });
    if (!changed.count) return;
    await this.billing.releaseForRun(runId, 'cancelled_before_execution');
    await this.database.client.requestGroup.update({
      where: { id: groupId },
      data: { status: RequestGroupStatus.CANCELLED },
    });
    this.events.publish(groupId, 'run.status', { runId, status: 'cancelled' });
  }

  private async execute(
    plan: RunExecutionPlan,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = performance.now();
    let content = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let providerRequestId: string | undefined;
    let finishReason: string | undefined;
    let failureCode: string | undefined;
    let dispatched = false;
    let claimed = false;
    let billingState = 'not_started';
    try {
      const started = await this.database.client.modelRun.updateMany({
        where: {
          id: plan.runId,
          status: { in: ['PENDING', 'QUEUED', 'RESERVED'] },
        },
        data: { startedAt: new Date(), status: ModelRunStatus.RUNNING },
      });
      if (!started.count) return;
      claimed = true;
      this.events.publish(plan.groupId, 'run.status', {
        runId: plan.runId,
        status: 'running',
      });
      try {
        signal.throwIfAborted();
        const snapshot =
          await this.database.client.contextSnapshot.findFirstOrThrow({
            where: { id: plan.request.contextSnapshotId, runId: plan.runId },
          });
        const context = readFrozen(snapshot);
        const budget = frozenBudget(snapshot);
        enforceBudget(context, budget);
        const request = canonicalChatRequestSchema.parse({
          ...plan.request,
          context,
          maxOutputTokens: budget.maxOutputTokens,
        });
        dispatched = true;
        for await (const event of this.provider.streamChat(request, signal)) {
          signal.throwIfAborted();
          if (event.runId !== plan.runId)
            throw new ProviderExecutionError('ROUTER_PROTOCOL_ERROR');
          switch (event.type) {
            case 'run.started':
              if (event.providerRequestId) {
                providerRequestId = event.providerRequestId;
                await this.database.client.modelRun.update({
                  where: { id: plan.runId },
                  data: { providerRequestId },
                });
              }
              break;
            case 'content.delta':
              if (
                Buffer.byteLength(content) + Buffer.byteLength(event.text) >
                262144
              )
                throw new ProviderExecutionError('OUTPUT_LIMIT_EXCEEDED');
              content += event.text;
              this.events.publish(plan.groupId, 'content.delta', {
                delta: event.text,
                runId: plan.runId,
              });
              break;
            case 'usage.updated':
              inputTokens = event.inputTokens ?? inputTokens;
              outputTokens = event.outputTokens ?? outputTokens;
              break;
            case 'run.failed':
              throw new ProviderExecutionError(event.code);
            case 'run.completed':
              finishReason = event.finishReason;
              break;
          }
          if (finishReason) break;
        }
        signal.throwIfAborted();
        if (!finishReason) throw new ProviderExecutionError('STREAM_TRUNCATED');
        if (
          plan.request.provider !== 'fake' &&
          (inputTokens === undefined || outputTokens === undefined)
        )
          throw new ProviderExecutionError('USAGE_MISSING');
        if (
          outputTokens !== undefined &&
          outputTokens > request.maxOutputTokens
        )
          throw new ProviderExecutionError('OUTPUT_LIMIT_EXCEEDED');
      } catch (error) {
        failureCode = signal.aborted
          ? 'CANCELLED'
          : error instanceof ProviderExecutionError
            ? error.code
            : 'EXECUTION_FAILED';
      }

      // Never invent zero usage after a billable attempt. Unknown usage retains its
      // reservation and explicit reconciliation evidence; known usage settles even on failure.
      try {
        if (
          (inputTokens !== undefined && outputTokens !== undefined) ||
          (plan.request.provider === 'fake' && !failureCode)
        ) {
          await this.billing.settleRun({
            idempotencyKey: `run:${plan.runId}:settle`,
            modelRunId: plan.runId,
            usage: {
              inputTokens: BigInt(inputTokens ?? 0),
              outputTokens: BigInt(outputTokens ?? 0),
              providerUsage: {
                inputTokens: inputTokens ?? 0,
                outputTokens: outputTokens ?? 0,
              },
            },
          });
          billingState = 'settled';
        } else if (
          !dispatched ||
          plan.request.provider === 'fake' ||
          [
            'PROVIDER_DISABLED',
            'ROUTER_AUTH_FAILED',
            'CONTEXT_BUDGET_EXCEEDED',
            'REGISTRY_MISMATCH',
          ].includes(failureCode ?? '')
        ) {
          await this.billing.releaseForRun(plan.runId, 'no_provider_execution');
          billingState = 'released';
        } else billingState = 'reconciliation_required';
      } catch {
        billingState = 'reconciliation_required';
        failureCode = failureCode ?? 'BILLING_RECONCILIATION_REQUIRED';
      }
      const status =
        failureCode === 'CANCELLED'
          ? ModelRunStatus.CANCELLED
          : failureCode
            ? ModelRunStatus.FAILED
            : ModelRunStatus.COMPLETED;
      const latencyMs = Math.round(performance.now() - startedAt);
      const executionResult: Prisma.InputJsonObject = {
        latencyMs,
        dispatched,
        billingState,
        usageComplete: inputTokens !== undefined && outputTokens !== undefined,
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
        ...(failureCode
          ? { failureCode, partialOutput: content }
          : { finishReason: finishReason! }),
      };
      await this.database.client.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${plan.groupId}, 1))`;
        const run = await transaction.modelRun.findUniqueOrThrow({
          where: { id: plan.runId },
        });
        if (run.status !== ModelRunStatus.RUNNING) return;
        await transaction.modelRun.update({
          where: { id: plan.runId },
          data: {
            completedAt: new Date(),
            status,
            executionResult,
            ...(providerRequestId ? { providerRequestId } : {}),
          },
        });
        if (status === ModelRunStatus.COMPLETED) {
          const selected =
            plan.selectOnComplete && plan.mode === ConversationMode.SINGLE;
          const response = await transaction.modelResponse.create({
            data: {
              content,
              finishReason: finishReason!,
              runId: plan.runId,
              turnId: run.turnId,
              ...(selected ? { selectedAt: new Date() } : {}),
            },
          });
          if (selected)
            await transaction.conversation.update({
              where: { id: plan.conversationId },
              data: { activeHeadId: response.id },
            });
        }
        const runs = await transaction.modelRun.findMany({
          where: { requestGroupId: plan.groupId },
          select: { status: true },
        });
        const groupStatus = runs.some((run) =>
          ['PENDING', 'QUEUED', 'RESERVED', 'RUNNING'].includes(run.status),
        )
          ? RequestGroupStatus.RUNNING
          : runs.some((run) => run.status === ModelRunStatus.FAILED)
            ? RequestGroupStatus.FAILED
            : runs.some((run) => run.status === ModelRunStatus.CANCELLED)
              ? RequestGroupStatus.CANCELLED
              : RequestGroupStatus.COMPLETED;
        await transaction.requestGroup.update({
          where: { id: plan.groupId },
          data: { status: groupStatus },
        });
      });
      this.metrics.recordProviderLatency(
        plan.request.provider,
        plan.request.modelKey,
        status === ModelRunStatus.COMPLETED
          ? 'completed'
          : status === ModelRunStatus.CANCELLED
            ? 'cancelled'
            : 'failed',
        latencyMs,
      );
      if (status === ModelRunStatus.FAILED) {
        this.metrics.recordProviderError(
          plan.request.provider,
          plan.request.modelKey,
        );
        this.events.publish(plan.groupId, 'run.error', {
          code: failureCode!,
          message: 'Generation could not complete',
          runId: plan.runId,
        });
      } else
        this.events.publish(plan.groupId, 'run.status', {
          runId: plan.runId,
          status: status.toLowerCase(),
          ...(finishReason && !failureCode ? { finishReason } : {}),
        });
    } catch {
      // An unavailable database cannot guarantee durability; close the browser stream
      // honestly and leave the reservation for reconciliation instead of reporting success.
      if (claimed)
        this.metrics.recordProviderError(
          plan.request.provider,
          plan.request.modelKey,
        );
      this.events.publish(plan.groupId, 'run.error', {
        code: 'PERSISTENCE_FAILED',
        message: 'Run state could not be saved',
        runId: plan.runId,
      });
    }
  }
}
