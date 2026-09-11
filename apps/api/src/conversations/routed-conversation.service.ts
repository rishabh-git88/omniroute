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
import { modelBudget } from '../context/context-budget.js';
import {
  snapshotData,
  readFrozen,
  frozenBudget,
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
    const mode = routingModeSchema.parse(command.routingMode ?? 'smart');
    const signature = {
      content: command.content,
      routingMode: mode,
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
            command?: unknown;
          } | null;
          if (
            existing.workspaceId !== workspaceId ||
            existing.conversationId !== conversationId ||
            Object.entries(signature).some(
              ([key, value]) =>
                (saved?.command as Record<string, unknown> | undefined)?.[
                  key
                ] !== value,
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
        if (conversation.mode !== 'SINGLE')
          throw new BadRequestException(
            'Real-provider comparisons are not enabled',
          );
        const entries = routingRegistry(await this.registry.findEnabled());
        if (!entries.length)
          throw new ServiceUnavailableException(
            'No enabled model has valid reviewed routing metadata',
          );
        if (
          command.modelKey &&
          !entries.some((e) => e.model.modelKey === command.modelKey)
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
            mode: 'SINGLE',
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
        const context = await this.contexts.build(
          {
            userId,
            workspaceId,
            conversationId,
            turnId: turn.id,
            userRequest: command.content,
            maxInputTokens: Math.max(
              ...entries.map((e) => modelBudget(e.capabilities).maxInputTokens),
            ),
          },
          tx,
        );
        const request = {
          requestGroupId: group.id,
          prompt: command.content,
          mode,
          contextTokens: context.tokenEstimate,
          maxOutputTokens: 512,
          models: entries.map(routingSnapshot),
          ...(command.modelKey ? { userPreferredModel: command.modelKey } : {}),
          ...(parseApiEnvironment(process.env).AI_ROUTING_REGION
            ? { region: parseApiEnvironment(process.env).AI_ROUTING_REGION }
            : {}),
        };
        let decision;
        try {
          decision = await this.router.route(request);
        } catch {
          throw new ServiceUnavailableException(
            'No compatible model is currently available for this request',
          );
        }
        const selected = entries.find(
          (e) =>
            e.id === decision.selectedRegistryEntryId &&
            e.model.modelKey === decision.selectedModel &&
            e.provider.key === decision.selectedProvider,
        );
        if (!selected || decision.requestGroupId !== group.id)
          throw new ServiceUnavailableException('Invalid routing decision');
        const ids = [
          selected.id,
          ...decision.fallbackCandidates.map((c) => c.registryEntryId),
        ];
        if (
          new Set(ids).size !== ids.length ||
          ids.some((id) => !entries.some((e) => e.id === id))
        )
          throw new ServiceUnavailableException('Invalid routing candidates');
        await tx.routingDecision.create({
          data: {
            requestGroupId: group.id,
            strategy: command.modelKey ? 'USER_SELECTED' : 'AUTO',
            reason: decision.reason,
            inputSnapshot: JSON.parse(
              JSON.stringify({ command: signature, mode, request, decision }),
            ),
            candidates: {
              create: ids.map((id, position) => ({
                registryEntryId: id,
                position,
                selected: position === 0,
              })),
            },
          },
        });
        const run = await tx.modelRun.create({
          data: {
            turnId: turn.id,
            requestGroupId: group.id,
            modelId: selected.modelId,
            providerId: selected.providerId,
            registryEntryId: selected.id,
          },
        });
        await tx.contextSnapshot.create({
          data: snapshotData(run.id, context, selected.capabilities),
        });
        if (conversation.title === 'New conversation')
          await tx.conversation.update({
            where: { id: conversationId },
            data: { title: command.content.slice(0, 80) },
          });
        return { groupId: group.id, turnId: turn.id, fresh: true };
      },
      { timeout: 30000 },
    );
    const runs = await this.database.client.modelRun.findMany({
      where: { requestGroupId: prepared.groupId },
      include: { model: true, provider: true, contextSnapshot: true },
      orderBy: { createdAt: 'asc' },
    });
    const route = await this.database.client.routingDecision.findUniqueOrThrow({
      where: { requestGroupId: prepared.groupId },
    });
    const saved = route.inputSnapshot as {
      mode: RoutingMode;
      decision: {
        selectedModel: string;
        selectedProvider: string;
        fallbackCandidates: Array<{ registryEntryId: string }>;
      };
    };
    const run = runs[0]!;
    if (prepared.fresh) {
      const snapshot = run.contextSnapshot!;
      const context = readFrozen(snapshot);
      const budget = frozenBudget(snapshot);
      try {
        await this.billing.reserveForRun({
          userId,
          modelRunId: run.id,
          requestGroupId: prepared.groupId,
          estimatedInputTokens: BigInt(context.tokenEstimate),
          maxOutputTokens: BigInt(budget.maxOutputTokens),
        });
      } catch (error) {
        await this.database.client.modelRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            executionResult: {
              failureCode: 'RESERVATION_FAILED',
              dispatched: false,
            },
          },
        });
        await this.database.client.requestGroup.update({
          where: { id: prepared.groupId },
          data: { status: 'FAILED' },
        });
        throw error;
      }
      this.execution.start({
        conversationId,
        groupId: prepared.groupId,
        mode: ConversationMode.SINGLE,
        runId: run.id,
        selectOnComplete: true,
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
          fallbackRegistryEntryIds: command.modelKey
            ? []
            : saved.decision.fallbackCandidates
                .slice(0, 2)
                .map((c) => c.registryEntryId),
          failures: [],
        },
      });
    }
    return {
      requestGroupId: prepared.groupId,
      runIds: runs.map((r) => r.id),
      turnId: prepared.turnId,
    };
  }
}
