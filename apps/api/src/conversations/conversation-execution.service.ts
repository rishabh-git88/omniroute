import { permitsFallback } from '../providers/fallback-policy.js';
import { routingRegistry } from '../providers/routing-registry.js';
import { snapshotData } from '../context/frozen-context.js';
import {
  providerIdSchema,
  type RoutingMode,
} from '@omniroute/provider-contracts';
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  canonicalChatRequestSchema,
  type CanonicalChatRequest,
} from '@omniroute/provider-contracts';
import { readFrozen, frozenBudget } from '../context/frozen-context.js';
import { enforceBudget } from '../context/context-budget.js';
import { modelBudget } from '../context/context-budget.js';
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
  turnId: string;
  selectOnComplete: boolean;
  routing?: {
    mode: RoutingMode;
    userId: string;
    originalModel: string;
    originalProvider: string;
    fallbackCount: number;
    fallbackRegistryEntryIds: string[];
    failures: Array<{ provider: string; model: string; code: string }>;
  };
}

@Injectable()
export class ConversationExecutionService
  implements OnModuleDestroy, OnModuleInit
{
  private static readonly PARTIAL_PERSIST_BYTES = 1024;
  private static readonly PARTIAL_PERSIST_MS = 500;
  private static readonly STALE_RUN_MS = 5 * 60 * 1000;
  private readonly aliases = new Map<string, string>();
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

  public async onModuleInit(): Promise<void> {
    // A health/degraded startup must not be converted into a crash merely
    // because PostgreSQL is temporarily unavailable. Recovery is retried on
    // the next healthy process start; no run is reported recovered without a
    // durable write.
    try {
      await this.recoverStaleRuns();
    } catch {
      return;
    }
  }

  /**
   * Nest cannot safely resume an in-flight upstream socket after a process
   * restart. Mark only old, nonterminal work as interrupted; dispatched runs
   * retain their reservation for Phase 5 reconciliation rather than inventing
   * a refund.
   */
  public async recoverStaleRuns(now = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - ConversationExecutionService.STALE_RUN_MS,
    );
    const stale = await this.database.client.modelRun.findMany({
      where: {
        status: { in: ['PENDING', 'QUEUED', 'RESERVED', 'RUNNING'] },
        OR: [
          { startedAt: { lt: cutoff } },
          { startedAt: null, createdAt: { lt: cutoff } },
        ],
      },
      select: {
        id: true,
        requestGroupId: true,
        startedAt: true,
        executionResult: true,
      },
    });
    for (const run of stale) {
      const prior = (run.executionResult ?? {}) as Record<
        string,
        Prisma.JsonValue
      >;
      const changed = await this.database.client.modelRun.updateMany({
        where: {
          id: run.id,
          status: { in: ['PENDING', 'QUEUED', 'RESERVED', 'RUNNING'] },
        },
        data: {
          completedAt: now,
          executionResult: {
            ...prior,
            dispatched: Boolean(run.startedAt),
            failureCode: 'EXECUTION_INTERRUPTED',
            recoveryRequired: Boolean(run.startedAt),
          },
          status: ModelRunStatus.FAILED,
        },
      });
      if (changed.count && !run.startedAt)
        await this.billing.releaseForRun(run.id, 'interrupted_before_dispatch');
      if (changed.count) await this.updateGroupStatus(run.requestGroupId);
    }
    return stale.length;
  }

  public start(plan: RunExecutionPlan): void {
    if (this.active.has(plan.runId)) return;
    const controller = new AbortController();
    const done = this.execute(plan, controller.signal).finally(() => {
      this.active.delete(plan.runId);
      for (const [id, root] of this.aliases)
        if (root === plan.runId) this.aliases.delete(id);
    });
    this.active.set(plan.runId, { controller, done });
  }

  public async cancel(groupId: string, runId: string): Promise<void> {
    const running = this.active.get(this.aliases.get(runId) ?? runId);
    if (running) {
      running.controller.abort(); // Aborts Nest fetch; FastAPI disconnect cancels upstream HTTP.
      await running.done;
      return;
    }
    const identity = await this.database.client.modelRun.findFirst({
      where: { id: runId, requestGroupId: groupId },
      include: {
        model: { select: { modelKey: true } },
        provider: { select: { key: true } },
        turn: { select: { conversationId: true, id: true } },
      },
    });
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
    const siblings = await this.database.client.modelRun.findMany({
      where: { requestGroupId: groupId },
      select: { status: true },
    });
    const groupStatus = siblings.some((sibling) =>
      ['PENDING', 'QUEUED', 'RESERVED', 'RUNNING'].includes(sibling.status),
    )
      ? RequestGroupStatus.RUNNING
      : siblings.some((sibling) => sibling.status === ModelRunStatus.COMPLETED)
        ? siblings.some((sibling) =>
            (
              [ModelRunStatus.FAILED, ModelRunStatus.CANCELLED] as string[]
            ).includes(sibling.status),
          )
          ? RequestGroupStatus.PARTIAL
          : RequestGroupStatus.COMPLETED
        : siblings.some((sibling) => sibling.status === ModelRunStatus.FAILED)
          ? RequestGroupStatus.FAILED
          : RequestGroupStatus.CANCELLED;
    await this.database.client.requestGroup.update({
      where: { id: groupId },
      data: { status: groupStatus },
    });
    this.events.publish(groupId, 'run.status', {
      runId,
      status: 'cancelled',
      ...(identity
        ? {
            conversationId: identity.turn.conversationId,
            turnId: identity.turn.id,
            requestGroupId: groupId,
            provider: identity.provider.key,
            model: identity.model.modelKey,
            modelKey: identity.model.modelKey,
          }
        : {}),
    });
  }

  private async updateGroupStatus(groupId: string): Promise<void> {
    const [group, runs] = await Promise.all([
      this.database.client.requestGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: { mode: true },
      }),
      this.database.client.modelRun.findMany({
        where: { requestGroupId: groupId },
        select: { status: true },
      }),
    ]);
    const status = runs.some((run) =>
      ['PENDING', 'QUEUED', 'RESERVED', 'RUNNING'].includes(run.status),
    )
      ? RequestGroupStatus.RUNNING
      : runs.some((run) => run.status === ModelRunStatus.COMPLETED)
        ? group.mode === ConversationMode.SINGLE ||
          !runs.some(
            (run) =>
              run.status === ModelRunStatus.FAILED ||
              run.status === ModelRunStatus.CANCELLED,
          )
          ? RequestGroupStatus.COMPLETED
          : RequestGroupStatus.PARTIAL
        : runs.some((run) => run.status === ModelRunStatus.FAILED)
          ? RequestGroupStatus.FAILED
          : RequestGroupStatus.CANCELLED;
    await this.database.client.requestGroup.update({
      where: { id: groupId },
      data: { status },
    });
  }

  private async execute(
    plan: RunExecutionPlan,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = performance.now();
    let content = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let usageFinal = false;
    let providerRequestId: string | undefined;
    let finishReason: string | undefined;
    let failureCode: string | undefined;
    let dispatched = false;
    let claimed = false;
    let billingState = 'not_started';
    let billingFailure: string | undefined;
    let persistedContentLength = 0;
    let lastPartialPersistedAt = 0;
    const persistPartial = async (force = false): Promise<void> => {
      const now = Date.now();
      if (
        content.length === persistedContentLength ||
        (!force &&
          content.length - persistedContentLength <
            ConversationExecutionService.PARTIAL_PERSIST_BYTES &&
          now - lastPartialPersistedAt <
            ConversationExecutionService.PARTIAL_PERSIST_MS)
      )
        return;
      await this.database.client.modelRun.updateMany({
        where: { id: plan.runId, status: ModelRunStatus.RUNNING },
        data: {
          executionResult: {
            model: plan.request.modelKey,
            partialOutput: content,
            provider: plan.request.provider,
            streaming: true,
          },
        },
      });
      persistedContentLength = content.length;
      lastPartialPersistedAt = now;
    };
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
        conversationId: plan.conversationId,
        turnId: plan.turnId,
        requestGroupId: plan.groupId,
        runId: plan.runId,
        status: 'running',
        provider: plan.request.provider,
        model: plan.request.modelKey,
        modelKey: plan.request.modelKey,
        routingMode: plan.routing?.mode ?? 'manual',
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
              await persistPartial();
              this.events.publish(plan.groupId, 'content.delta', {
                conversationId: plan.conversationId,
                turnId: plan.turnId,
                delta: event.text,
                model: plan.request.modelKey,
                modelKey: plan.request.modelKey,
                provider: plan.request.provider,
                requestGroupId: plan.groupId,
                runId: plan.runId,
              });
              break;
            case 'usage.updated':
              usageFinal = event.usageFinal ?? true;
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
          (!usageFinal ||
            inputTokens === undefined ||
            outputTokens === undefined)
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
          (usageFinal &&
            inputTokens !== undefined &&
            outputTokens !== undefined) ||
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
                totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
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
            'PROVIDER_MISSING_CREDENTIALS',
            'PROVIDER_AUTH_FAILED',
            'PROVIDER_INVALID_REQUEST',
          ].includes(failureCode ?? '')
        ) {
          await this.billing.releaseForRun(plan.runId, 'no_provider_execution');
          billingState = 'released';
        } else billingState = 'reconciliation_required';
      } catch (error) {
        billingState = 'reconciliation_required';
        billingFailure =
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                typeof (error as { code?: unknown }).code === 'string'
              ? (error as { code: string }).code
              : 'BILLING_OPERATION_FAILED';
        failureCode = failureCode ?? 'BILLING_RECONCILIATION_REQUIRED';
      }
      const status =
        failureCode === 'CANCELLED'
          ? ModelRunStatus.CANCELLED
          : failureCode
            ? ModelRunStatus.FAILED
            : ModelRunStatus.COMPLETED;
      const latencyMs = Math.round(performance.now() - startedAt);
      await persistPartial(true);
      let nextPlan: RunExecutionPlan | undefined;
      const executionResult: Record<string, Prisma.InputJsonValue> = {
        provider: plan.request.provider,
        model: plan.request.modelKey,
        modelKey: plan.request.modelKey,
        ...(plan.routing
          ? {
              selectedMode: plan.routing.mode,
              originalProvider: plan.routing.originalProvider,
              originalModel: plan.routing.originalModel,
              finalProvider: plan.request.provider,
              finalModel: plan.request.modelKey,
              fallbackCount: plan.routing.fallbackCount,
              failures: plan.routing.failures,
            }
          : {}),
        ...(inputTokens !== undefined && outputTokens !== undefined
          ? { totalTokens: inputTokens + outputTokens }
          : {}),
        latencyMs,
        dispatched,
        billingState,
        ...(billingFailure ? { billingFailure } : {}),
        usageComplete:
          usageFinal && inputTokens !== undefined && outputTokens !== undefined,
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
        const registryEntry =
          await transaction.providerRegistryEntry.findUniqueOrThrow({
            where: { id: run.registryEntryId },
          });
        executionResult.estimatedCost = this.billing
          .cost(registryEntry.pricing, {
            inputTokens: BigInt(plan.request.context.tokenEstimate),
            outputTokens: BigInt(plan.request.maxOutputTokens),
          })
          .toFixed(8);
        if (
          usageFinal &&
          inputTokens !== undefined &&
          outputTokens !== undefined
        )
          executionResult.providerCost = this.billing
            .cost(registryEntry.pricing, {
              inputTokens: BigInt(inputTokens),
              outputTokens: BigInt(outputTokens),
            })
            .toFixed(8);
        if (
          !signal.aborted &&
          plan.routing &&
          permitsFallback(failureCode, content, plan.routing.fallbackCount)
        ) {
          const options = await transaction.providerRegistryEntry.findMany({
            where: {
              id: { in: plan.routing.fallbackRegistryEntryIds },
              enabled: true,
              provider: { enabled: true },
            },
            include: { model: true, provider: true },
          });
          const valid = routingRegistry(options).filter((entry) => {
            const budget = modelBudget(entry.capabilities);
            return (
              budget.maxInputTokens >= plan.request.context.tokenEstimate &&
              budget.maxOutputTokens === plan.request.maxOutputTokens
            );
          });
          const entry = plan.routing.fallbackRegistryEntryIds
            .map((id) => valid.find((e) => e.id === id))
            .find((e) => e !== undefined);
          if (entry) {
            const next = await transaction.modelRun.create({
              data: {
                turnId: run.turnId,
                requestGroupId: plan.groupId,
                registryEntryId: entry.id,
                modelId: entry.modelId,
                providerId: entry.providerId,
                attempt: plan.routing.fallbackCount + 2,
              },
            });
            const snapshot = await transaction.contextSnapshot.create({
              data: snapshotData(
                next.id,
                plan.request.context,
                entry.capabilities,
              ),
            });
            nextPlan = {
              ...plan,
              runId: next.id,
              request: {
                ...plan.request,
                runId: next.id,
                contextSnapshotId: snapshot.id,
                modelKey: entry.model.modelKey,
                provider: providerIdSchema.parse(entry.provider.key),
                maxOutputTokens: frozenBudget(snapshot).maxOutputTokens,
              },
              routing: {
                ...plan.routing,
                fallbackCount: plan.routing.fallbackCount + 1,
                fallbackRegistryEntryIds:
                  plan.routing.fallbackRegistryEntryIds.filter(
                    (id) => id !== entry.id,
                  ),
                failures: [
                  ...plan.routing.failures,
                  {
                    provider: plan.request.provider,
                    model: plan.request.modelKey,
                    code: failureCode!,
                  },
                ],
              },
            };
            executionResult.fallbackRunId = next.id;
            executionResult.fallbackProvider = entry.provider.key;
            executionResult.fallbackModel = entry.model.modelKey;
          }
        }
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
          : runs.some((run) => run.status === ModelRunStatus.COMPLETED)
            ? plan.mode === ConversationMode.SINGLE
              ? RequestGroupStatus.COMPLETED
              : runs.some((run) =>
                    (
                      [
                        ModelRunStatus.FAILED,
                        ModelRunStatus.CANCELLED,
                      ] as string[]
                    ).includes(run.status),
                  )
                ? RequestGroupStatus.PARTIAL
                : RequestGroupStatus.COMPLETED
            : runs.some((run) => run.status === ModelRunStatus.FAILED)
              ? RequestGroupStatus.FAILED
              : RequestGroupStatus.CANCELLED;
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
      if (nextPlan) {
        const next = nextPlan;
        this.aliases.set(
          next.runId,
          this.aliases.get(plan.runId) ?? plan.runId,
        );
        this.events.publish(plan.groupId, 'fallback.started', {
          conversationId: plan.conversationId,
          turnId: plan.turnId,
          requestGroupId: plan.groupId,
          previousRunId: plan.runId,
          runId: next.runId,
          provider: next.request.provider,
          model: next.request.modelKey,
          modelKey: next.request.modelKey,
          reason: failureCode,
          routingMode: next.routing!.mode,
        });
        try {
          signal.throwIfAborted();
          await this.billing.reserveForRun({
            userId: next.routing!.userId,
            modelRunId: next.runId,
            requestGroupId: plan.groupId,
            estimatedInputTokens: BigInt(next.request.context.tokenEstimate),
            maxOutputTokens: BigInt(next.request.maxOutputTokens),
          });
          await this.execute(next, signal);
        } catch {
          await this.database.client.modelRun.update({
            where: { id: next.runId },
            data: {
              status: signal.aborted ? 'CANCELLED' : 'FAILED',
              completedAt: new Date(),
              executionResult: {
                failureCode: signal.aborted
                  ? 'CANCELLED'
                  : 'RESERVATION_FAILED',
                dispatched: false,
                fallbackCount: next.routing!.fallbackCount,
              },
            },
          });
          await this.billing.releaseForRun(
            next.runId,
            'fallback_not_dispatched',
          );
          await this.database.client.requestGroup.update({
            where: { id: plan.groupId },
            data: { status: signal.aborted ? 'CANCELLED' : 'FAILED' },
          });
          this.events.publish(plan.groupId, 'run.error', {
            conversationId: plan.conversationId,
            turnId: plan.turnId,
            runId: next.runId,
            requestGroupId: plan.groupId,
            provider: next.request.provider,
            model: next.request.modelKey,
            modelKey: next.request.modelKey,
            code: signal.aborted ? 'CANCELLED' : 'RESERVATION_FAILED',
            message: 'Fallback could not start',
          });
        }
        return;
      }
      if (status === ModelRunStatus.FAILED) {
        this.metrics.recordProviderError(
          plan.request.provider,
          plan.request.modelKey,
        );
        this.events.publish(plan.groupId, 'run.error', {
          conversationId: plan.conversationId,
          turnId: plan.turnId,
          code: failureCode!,
          message: 'Generation could not complete',
          model: plan.request.modelKey,
          modelKey: plan.request.modelKey,
          provider: plan.request.provider,
          requestGroupId: plan.groupId,
          runId: plan.runId,
        });
      } else
        this.events.publish(plan.groupId, 'run.status', {
          conversationId: plan.conversationId,
          turnId: plan.turnId,
          model: plan.request.modelKey,
          modelKey: plan.request.modelKey,
          provider: plan.request.provider,
          requestGroupId: plan.groupId,
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
        conversationId: plan.conversationId,
        turnId: plan.turnId,
        code: 'PERSISTENCE_FAILED',
        message: 'Run state could not be saved',
        model: plan.request.modelKey,
        modelKey: plan.request.modelKey,
        provider: plan.request.provider,
        requestGroupId: plan.groupId,
        runId: plan.runId,
      });
    }
  }
}
