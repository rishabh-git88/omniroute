import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';
import {
  providerIdSchema,
  routingModeSchema,
  type RoutingMode,
} from '@omniroute/provider-contracts';
import { ConversationMode } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { ContextBuilderService } from '../context/context-builder.service.js';
import { enforceBudget, modelBudget } from '../context/context-budget.js';
import {
  frozenBudget,
  readFrozen,
  snapshotData,
} from '../context/frozen-context.js';
import { PrismaModelRegistryRepository } from '../model-registry/model-registry.repository.js';
import { AiRouterClient } from '../providers/ai-router.client.js';
import {
  routingRegistry,
  routingSnapshot,
} from '../providers/routing-registry.js';
import { CreditBillingService } from '../usage/credit-billing.service.js';
import { ConversationExecutionService } from './conversation-execution.service.js';
import type { CreateMessageCommand } from './conversation.types.js';

type PreparedRun = {
  contextSnapshot: {
    id: string;
    payload: unknown;
    snapshotHash: string;
  } | null;
  id: string;
  model: { modelKey: string };
  provider: { key: string };
  registryEntryId: string;
};

const compareUnavailable = () =>
  new ServiceUnavailableException({
    code: 'COMPARE_REQUIRES_THREE_ELIGIBLE_MODELS',
    message:
      'Compare 3 is temporarily unavailable because fewer than three reviewed AI models are available.',
  });

/**
 * The only real-provider conversation entrypoint. It persists the routing
 * decision and all initial attempts before dispatching any provider request.
 * Compare is deliberately an execution fan-out of the same canonical context,
 * never three independently rebuilt conversations.
 */
@Injectable()
export class RoutedConversationService {
  public constructor(
    private readonly database: PrismaService,
    private readonly contexts: ContextBuilderService,
    private readonly registry: PrismaModelRegistryRepository,
    private readonly router: AiRouterClient,
    private readonly billing: CreditBillingService,
    private readonly execution: ConversationExecutionService,
  ) {}

  public async submit(
    userId: string,
    workspaceId: string,
    conversationId: string,
    command: CreateMessageCommand,
    parentResponseId?: string | null,
  ) {
    const routingMode = routingModeSchema.parse(command.routingMode ?? 'smart');
    const signature = {
      content: command.content,
      routingMode,
      modelKey: command.modelKey ?? null,
      parentResponseId:
        parentResponseId === undefined ? 'active' : parentResponseId,
    };
    const prepared = await this.database.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${command.idempotencyKey}`}, 6))`;
        const existing = await tx.requestGroup.findUnique({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: command.idempotencyKey,
            },
          },
          include: { routingDecision: true, turn: true },
        });
        if (existing) {
          const saved = existing.routingDecision?.inputSnapshot as {
            command?: Record<string, unknown>;
          } | null;
          if (
            existing.workspaceId !== workspaceId ||
            existing.conversationId !== conversationId ||
            Object.entries(signature).some(
              ([key, value]) => saved?.command?.[key] !== value,
            )
          )
            throw new ConflictException(
              'Idempotency key already belongs to a different command',
            );
          return {
            groupId: existing.id,
            turnId: existing.turn!.id,
            fresh: false,
          };
        }

        const conversation = await tx.conversation.findFirstOrThrow({
          where: { id: conversationId, workspaceId, deletedAt: null },
        });
        const entries = routingRegistry(await this.registry.findEnabled());
        if (!entries.length)
          throw new ServiceUnavailableException(
            'No enabled model has valid reviewed routing metadata',
          );
        if (
          command.modelKey &&
          !entries.some((entry) => entry.model.modelKey === command.modelKey)
        )
          throw new BadRequestException('Selected model is unavailable');

        const parent =
          parentResponseId === undefined
            ? conversation.activeHeadId
            : parentResponseId;
        if (
          parent &&
          !(await tx.modelResponse.findFirst({
            where: { id: parent, turn: { conversationId } },
          }))
        )
          throw new BadRequestException('Invalid conversation branch');

        const group = await tx.requestGroup.create({
          data: {
            userId,
            workspaceId,
            conversationId,
            idempotencyKey: command.idempotencyKey,
            mode: conversation.mode,
          },
        });
        const turn = await tx.turn.create({
          data: {
            conversationId,
            requestGroupId: group.id,
            userContent: command.content,
            parentResponseId: parent ?? null,
          },
        });

        // One context is assembled before model selection is persisted. A
        // selected candidate which cannot hold it rolls this transaction back.
        const context = await this.contexts.build(
          {
            userId,
            workspaceId,
            conversationId,
            turnId: turn.id,
            userRequest: command.content,
            maxInputTokens: Math.max(
              ...entries.map(
                (entry) => modelBudget(entry.capabilities).maxInputTokens,
              ),
            ),
          },
          tx,
        );
        const request = {
          requestGroupId: group.id,
          prompt: command.content,
          mode: routingMode,
          requestedMode:
            conversation.mode === ConversationMode.COMPARE
              ? 'compare'
              : 'single',
          contextTokens: context.tokenEstimate,
          maxOutputTokens: 512,
          models: entries.map(routingSnapshot),
          ...(command.modelKey ? { userPreferredModel: command.modelKey } : {}),
          ...(parseApiEnvironment(process.env).AI_ROUTING_REGION
            ? { region: parseApiEnvironment(process.env).AI_ROUTING_REGION }
            : {}),
        } as const;
        let decision;
        try {
          decision = await this.router.route(request);
        } catch {
          if (conversation.mode === ConversationMode.COMPARE)
            throw compareUnavailable();
          throw new ServiceUnavailableException(
            'No compatible model is currently available for this request',
          );
        }
        if (decision.requestGroupId !== group.id)
          throw new ServiceUnavailableException('Invalid routing decision');
        const orderedIds = [
          decision.selectedRegistryEntryId,
          ...decision.fallbackCandidates.map(
            (candidate) => candidate.registryEntryId,
          ),
        ];
        if (
          new Set(orderedIds).size !== orderedIds.length ||
          orderedIds.some((id) => !entries.some((entry) => entry.id === id))
        )
          throw new ServiceUnavailableException('Invalid routing candidates');
        const selectedIds =
          conversation.mode === ConversationMode.COMPARE
            ? orderedIds.slice(0, 3)
            : orderedIds.slice(0, 1);
        if (
          conversation.mode === ConversationMode.COMPARE &&
          selectedIds.length !== 3
        )
          throw compareUnavailable();
        const selected = selectedIds.map((id) => {
          const entry = entries.find((candidate) => candidate.id === id);
          if (!entry)
            throw new ServiceUnavailableException('Invalid routing decision');
          enforceBudget(context, modelBudget(entry.capabilities));
          return entry;
        });
        if (
          selected[0]?.id !== decision.selectedRegistryEntryId ||
          selected[0]?.model.modelKey !== decision.selectedModel ||
          selected[0]?.provider.key !== decision.selectedProvider
        )
          throw new ServiceUnavailableException('Invalid routing decision');

        await tx.routingDecision.create({
          data: {
            requestGroupId: group.id,
            strategy:
              conversation.mode === ConversationMode.COMPARE
                ? 'COMPARE'
                : command.modelKey
                  ? 'USER_SELECTED'
                  : 'AUTO',
            reason: decision.reason,
            inputSnapshot: JSON.parse(
              JSON.stringify({
                command: signature,
                mode: routingMode,
                request,
                decision,
              }),
            ),
            candidates: {
              create: orderedIds.map((registryEntryId, position) => ({
                registryEntryId,
                position,
                // This means selected for initial execution. Response selection
                // remains a separate, explicit user action.
                selected: selectedIds.includes(registryEntryId),
              })),
            },
          },
        });
        const createdRuns = [];
        for (const entry of selected) {
          const run = await tx.modelRun.create({
            data: {
              turnId: turn.id,
              requestGroupId: group.id,
              modelId: entry.modelId,
              providerId: entry.providerId,
              registryEntryId: entry.id,
            },
          });
          await tx.contextSnapshot.create({
            data: snapshotData(run.id, context, entry.capabilities),
          });
          createdRuns.push(run);
        }
        if (conversation.title === 'New conversation')
          await tx.conversation.update({
            where: { id: conversationId },
            data: { title: command.content.slice(0, 80) },
          });
        return {
          groupId: group.id,
          turnId: turn.id,
          fresh: true,
          runIds: createdRuns.map((run) => run.id),
        };
      },
      { timeout: 30000 },
    );

    const runs = (await this.database.client.modelRun.findMany({
      where: { requestGroupId: prepared.groupId },
      include: { model: true, provider: true, contextSnapshot: true },
      orderBy: { createdAt: 'asc' },
    })) as PreparedRun[];
    if (!prepared.fresh)
      return {
        requestGroupId: prepared.groupId,
        runIds: runs.map((run) => run.id),
        turnId: prepared.turnId,
      };

    const route = await this.database.client.routingDecision.findUniqueOrThrow({
      where: { requestGroupId: prepared.groupId },
    });
    const saved = route.inputSnapshot as {
      decision: {
        fallbackCandidates: Array<{ registryEntryId: string }>;
        selectedModel: string;
        selectedProvider: string;
      };
      mode: RoutingMode;
    };
    const initialIds = new Set(runs.map((run) => run.registryEntryId));
    try {
      // Independent reservations are intentionally established before any
      // provider dispatch. A failed setup is durable and no sibling is run.
      for (const run of runs) {
        const snapshot = run.contextSnapshot;
        if (!snapshot) throw new Error('Model run has no frozen context');
        const context = readFrozen(snapshot);
        const budget = frozenBudget(snapshot);
        await this.billing.reserveForRun({
          userId,
          modelRunId: run.id,
          requestGroupId: prepared.groupId,
          estimatedInputTokens: BigInt(context.tokenEstimate),
          maxOutputTokens: BigInt(budget.maxOutputTokens),
        });
      }
    } catch (error) {
      await Promise.all(
        runs.map((run) =>
          this.billing.releaseForRun(run.id, 'comparison_setup_failed'),
        ),
      );
      await this.database.client.$transaction(async (tx) => {
        await tx.modelRun.updateMany({
          where: {
            id: { in: runs.map((run) => run.id) },
            status: { in: ['PENDING', 'QUEUED', 'RESERVED'] },
          },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            executionResult: {
              failureCode: 'RESERVATION_FAILED',
              dispatched: false,
            },
          },
        });
        await tx.requestGroup.update({
          where: { id: prepared.groupId },
          data: { status: 'FAILED' },
        });
      });
      throw error;
    }

    for (const run of runs) {
      const snapshot = run.contextSnapshot;
      if (!snapshot) continue;
      const context = readFrozen(snapshot);
      const budget = frozenBudget(snapshot);
      this.execution.start({
        conversationId,
        groupId: prepared.groupId,
        mode:
          runs.length === 3
            ? ConversationMode.COMPARE
            : ConversationMode.SINGLE,
        runId: run.id,
        turnId: prepared.turnId,
        selectOnComplete: runs.length === 1,
        request: {
          context,
          contextSnapshotId: snapshot.id,
          modelKey: run.model.modelKey,
          provider: providerIdSchema.parse(run.provider.key),
          runId: run.id,
          maxOutputTokens: budget.maxOutputTokens,
        },
        routing: {
          mode: saved.mode,
          userId,
          originalModel: saved.decision.selectedModel,
          originalProvider: saved.decision.selectedProvider,
          fallbackCount: 0,
          // Initial compare runs are distinct. Only models outside the initial
          // fan-out may become a fallback attempt for a failed child run.
          fallbackRegistryEntryIds: command.modelKey
            ? []
            : saved.decision.fallbackCandidates
                .map((candidate) => candidate.registryEntryId)
                .filter((id) => !initialIds.has(id))
                .slice(0, 2),
          failures: [],
        },
      });
    }
    return {
      requestGroupId: prepared.groupId,
      runIds: runs.map((run) => run.id),
      turnId: prepared.turnId,
    };
  }
}
