import { RoutedConversationService } from './routed-conversation.service.js';
import { AiRouterClient } from '../providers/ai-router.client.js';
import { routingRegistry } from '../providers/routing-registry.js';
import {
  executionProvider,
  executionEnabled,
} from '../providers/execution-gateway.js';
import { providerIdSchema } from '@omniroute/provider-contracts';
import { enforceBudget, modelBudget } from '../context/context-budget.js';
import {
  readFrozen,
  snapshotData,
  frozenBudget,
} from '../context/frozen-context.js';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeedbackKind, ConversationMode } from '../generated/prisma/client.js';
import { FeedbackRepository } from '../analytics/feedback.repository.js';
import { ContextBuilderService } from '../context/context-builder.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaModelRegistryRepository } from '../model-registry/model-registry.repository.js';
import { CreditBillingService } from '../usage/credit-billing.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { PrismaConversationRepository } from './conversation.repository.js';
import { ConversationExecutionService } from './conversation-execution.service.js';
import type {
  CreateConversationCommand,
  CreateMessageCommand,
} from './conversation.types.js';

const MAX_CONTENT_LENGTH = 20_000;
const DEFAULT_TITLE = 'New conversation';

@Injectable()
export class ConversationService {
  public constructor(
    private readonly database: PrismaService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly billing: CreditBillingService,
    private readonly execution: ConversationExecutionService,
    private readonly registry: PrismaModelRegistryRepository,
    private readonly repository: PrismaConversationRepository,
    private readonly feedback: FeedbackRepository,
    private readonly metrics: MetricsService,
    private readonly routed: RoutedConversationService,
    private readonly router: AiRouterClient,
  ) {}

  public async createConversation(
    workspaceId: string,
    command: CreateConversationCommand,
  ) {
    const title = this.title(command.title ?? DEFAULT_TITLE);
    return this.database.client.conversation.create({
      data: {
        mode: command.mode ?? ConversationMode.SINGLE,
        title,
        workspaceId,
      },
    });
  }

  public async listConversations(workspaceId: string) {
    const conversations = await this.database.client.conversation.findMany({
      where: { deletedAt: null, workspaceId },
      include: { _count: { select: { turns: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return conversations.map((conversation) => ({
      createdAt: conversation.createdAt,
      id: conversation.id,
      mode: conversation.mode,
      title: conversation.title,
      turnCount: conversation._count.turns,
      updatedAt: conversation.updatedAt,
    }));
  }

  public async getConversation(workspaceId: string, conversationId: string) {
    const conversation = await this.database.client.conversation.findFirst({
      where: { deletedAt: null, id: conversationId, workspaceId },
      include: {
        turns: {
          include: {
            childResponses: {
              include: {
                run: {
                  include: {
                    model: { select: { displayName: true, modelKey: true } },
                    provider: { select: { displayName: true, key: true } },
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
            requestGroup: {
              include: {
                routingDecision: {
                  include: {
                    candidates: {
                      include: {
                        registryEntry: {
                          include: {
                            model: {
                              select: { displayName: true, modelKey: true },
                            },
                            provider: {
                              select: { displayName: true, key: true },
                            },
                          },
                        },
                      },
                      orderBy: { position: 'asc' },
                    },
                  },
                },
                modelRuns: {
                  include: {
                    model: { select: { displayName: true, modelKey: true } },
                    provider: { select: { displayName: true, key: true } },
                  },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    return {
      activeHeadId: conversation.activeHeadId,
      createdAt: conversation.createdAt,
      id: conversation.id,
      mode: conversation.mode,
      title: conversation.title,
      turns: conversation.turns.map((turn) => ({
        createdAt: turn.createdAt,
        id: turn.id,
        parentResponseId: turn.parentResponseId,
        requestGroup: {
          id: turn.requestGroup.id,
          routingDecision: turn.requestGroup.routingDecision && {
            candidates: turn.requestGroup.routingDecision.candidates.map(
              (candidate) => ({
                model: candidate.registryEntry.model,
                position: candidate.position,
                provider: candidate.registryEntry.provider,
                selected: candidate.selected,
              }),
            ),
            reason: turn.requestGroup.routingDecision.reason,
            strategy: turn.requestGroup.routingDecision.strategy,
            mode:
              (
                turn.requestGroup.routingDecision.inputSnapshot as {
                  mode?: string;
                } | null
              )?.mode ?? null,
          },
          runs: turn.requestGroup.modelRuns.map((run) => ({
            id: run.id,
            model: run.model,
            provider: run.provider,
            status: run.status,
            executionResult: run.executionResult,
          })),
          status: turn.requestGroup.status,
        },
        responses: turn.childResponses.map((response) => ({
          content: response.content,
          createdAt: response.createdAt,
          finishReason: response.finishReason,
          id: response.id,
          model: response.run.model,
          provider: response.run.provider,
          selectedAt: response.selectedAt,
        })),
        userContent: turn.userContent,
      })),
      updatedAt: conversation.updatedAt,
    };
  }

  public async renameConversation(
    workspaceId: string,
    conversationId: string,
    title: string,
  ) {
    await this.ensureConversation(workspaceId, conversationId);
    return this.database.client.conversation.update({
      where: { id: conversationId },
      data: { title: this.title(title) },
    });
  }

  public async archiveConversation(
    workspaceId: string,
    conversationId: string,
  ) {
    await this.ensureConversation(workspaceId, conversationId);
    await this.database.client.conversation.update({
      where: { id: conversationId },
      data: { deletedAt: new Date() },
    });
  }

  public async createMessage(
    userId: string,
    workspaceId: string,
    conversationId: string,
    command: CreateMessageCommand,
    parentResponseId?: string | null,
  ) {
    const content = this.content(command.content);
    await this.ensureConversation(workspaceId, conversationId);
    if (executionProvider() !== 'fake')
      return this.routed.submit(
        userId,
        workspaceId,
        conversationId,
        { ...command, content },
        parentResponseId,
      );
    const model = await this.resolveModel(command.modelKey);
    const conversation = await this.ensureConversation(
      workspaceId,
      conversationId,
    );
    if (
      conversation.mode === ConversationMode.COMPARE &&
      model.provider.key !== 'fake'
    )
      throw new BadRequestException(
        'Real-provider comparisons are not enabled',
      );
    const candidates =
      conversation.mode === ConversationMode.COMPARE
        ? [
            model,
            ...(await this.registry.findEnabled())
              .filter(
                (entry) =>
                  entry.provider.key === 'fake' &&
                  entry.modelId !== model.modelId,
              )
              .filter(
                (entry, index, all) =>
                  all.findIndex((other) => other.modelId === entry.modelId) ===
                  index,
              ),
          ].slice(0, 3)
        : [model];
    if (
      conversation.mode === ConversationMode.COMPARE &&
      candidates.length !== 3
    )
      throw new BadRequestException(
        'Compare 3 requires three enabled mock models',
      );
    candidates.forEach((entry) => modelBudget(entry.capabilities));
    const requestGroup = await this.repository.createTurn({
      content,
      conversationId,
      idempotencyKey: command.idempotencyKey,
      mode: conversation.mode,
      ...(parentResponseId === undefined ? {} : { parentResponseId }),
      registryEntryIds: candidates.map((entry) => entry.id),
      userId,
      workspaceId,
    });
    const turn = await this.database.client.turn.findUniqueOrThrow({
      where: { requestGroupId: requestGroup.id },
      include: {
        modelRuns: {
          include: {
            model: { select: { modelKey: true } },
            provider: { select: { key: true } },
            registryEntry: true,
          },
        },
        requestGroup: {
          include: { routingDecision: { select: { id: true } } },
        },
      },
    });
    this.metrics.recordRoutingDecision(
      conversation.mode === ConversationMode.COMPARE
        ? 'compare'
        : 'user_selected',
      turn.modelRuns.length,
    );
    const snapshots = await this.database.client.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${turn.id}, 0))`;
        const prior = await transaction.contextSnapshot.findFirst({
          where: { run: { turnId: turn.id } },
          orderBy: { createdAt: 'asc' },
        });
        const context = prior
          ? readFrozen(prior)
          : await this.contextBuilder.build({
              conversationId,
              turnId: turn.id,
              userId,
              userRequest: content,
              workspaceId,
              maxInputTokens: Math.min(
                ...turn.modelRuns.map(
                  (run) =>
                    modelBudget(run.registryEntry.capabilities).maxInputTokens,
                ),
              ),
            });
        const result = [];
        for (const run of turn.modelRuns) {
          const existing = await transaction.contextSnapshot.findUnique({
            where: { runId: run.id },
          });
          result.push(
            existing ??
              (await transaction.contextSnapshot.create({
                data: snapshotData(
                  run.id,
                  context,
                  run.registryEntry.capabilities,
                ),
              })),
          );
        }
        return result;
      },
      { timeout: 15000 },
    );
    for (const run of turn.modelRuns) {
      if (!['PENDING', 'QUEUED', 'RESERVED'].includes(run.status)) continue;
      const snapshot = snapshots.find((item) => item.runId === run.id)!;
      const context = readFrozen(snapshot);
      const budget = frozenBudget(snapshot);
      enforceBudget(context, budget);
      await this.billing.reserveForRun({
        estimatedInputTokens: BigInt(context.tokenEstimate),
        maxOutputTokens: BigInt(budget.maxOutputTokens),
        modelRunId: run.id,
        requestGroupId: requestGroup.id,
        userId,
      });
      this.execution.start({
        conversationId,
        groupId: requestGroup.id,
        mode: conversation.mode,
        request: {
          contextSnapshotId: snapshot.id,
          context,
          maxOutputTokens: budget.maxOutputTokens,
          modelKey: run.model.modelKey,
          provider: providerIdSchema.parse(run.provider.key),
          runId: run.id,
        },
        runId: run.id,
        selectOnComplete: true,
      });
    }

    if (conversation.title === DEFAULT_TITLE) {
      await this.database.client.conversation.update({
        where: { id: conversationId },
        data: { title: this.titleFromContent(content) },
      });
    }
    return {
      requestGroupId: requestGroup.id,
      runIds: turn.modelRuns.map((run) => run.id),
      turnId: turn.id,
    };
  }

  public async regenerate(
    userId: string,
    workspaceId: string,
    conversationId: string,
    turnId: string,
    command: Omit<CreateMessageCommand, 'content'>,
  ) {
    const source = await this.database.client.turn.findFirst({
      where: { conversationId, id: turnId, conversation: { workspaceId } },
    });
    if (!source) throw new NotFoundException('Turn not found');
    return this.createMessage(
      userId,
      workspaceId,
      conversationId,
      {
        ...command,
        content: source.userContent,
      },
      source.parentResponseId,
    );
  }

  public async cancelRun(workspaceId: string, runId: string) {
    const run = await this.database.client.modelRun.findFirst({
      where: { id: runId, turn: { conversation: { workspaceId } } },
    });
    if (!run) throw new NotFoundException('Model run not found');
    await this.execution.cancel(run.requestGroupId, run.id);
  }

  /**
   * Starts another provider-neutral run for the same turn. The turn and its
   * parent response are deliberately reused so both candidates receive the
   * identical canonical context; neither candidate becomes active until the
   * user explicitly selects it.
   */
  public async tryAnother(
    workspaceId: string,
    responseId: string,
    requestedModelKey?: string,
  ) {
    const source = await this.database.client.modelResponse.findFirst({
      where: {
        id: responseId,
        turn: {
          conversation: { deletedAt: null, workspaceId },
        },
      },
      include: {
        run: { include: { model: { select: { modelKey: true } } } },
        turn: {
          include: {
            conversation: { select: { mode: true } },
            modelRuns: { include: { model: { select: { modelKey: true } } } },
            requestGroup: {
              include: { routingDecision: { select: { id: true } } },
            },
          },
        },
      },
    });
    if (!source) throw new NotFoundException('Response not found');

    const target = await this.resolveAlternativeModel(
      source.run.model.modelKey,
      new Set(source.turn.modelRuns.map((run) => run.model.modelKey)),
      requestedModelKey,
    );
    const original = await this.database.client.contextSnapshot.findUnique({
      where: { runId: source.runId },
    });
    if (!original)
      throw new BadRequestException('Response has no frozen context');
    const context = readFrozen(original);
    const budget = modelBudget(target.capabilities);
    enforceBudget(context, budget);
    const alternative = await this.repository.createAlternativeRun({
      registryEntryId: target.id,
      responseId,
      workspaceId,
    });
    const run = await this.database.client.modelRun.findUniqueOrThrow({
      where: { id: alternative.runId },
      include: {
        model: { select: { modelKey: true } },
        provider: { select: { key: true } },
      },
    });
    const snapshot = await this.database.client.contextSnapshot.create({
      data: snapshotData(run.id, context, target.capabilities),
    });
    await this.billing.reserveForRun({
      estimatedInputTokens: BigInt(context.tokenEstimate),
      maxOutputTokens: BigInt(budget.maxOutputTokens),
      modelRunId: run.id,
      requestGroupId: alternative.requestGroupId,
      userId: source.turn.requestGroup.userId,
    });
    this.execution.start({
      conversationId: alternative.conversationId,
      groupId: alternative.requestGroupId,
      mode: source.turn.conversation.mode,
      request: {
        contextSnapshotId: snapshot.id,
        context,
        maxOutputTokens: budget.maxOutputTokens,
        modelKey: run.model.modelKey,
        provider: providerIdSchema.parse(run.provider.key),
        runId: run.id,
      },
      runId: run.id,
      selectOnComplete: false,
    });
    return {
      requestGroupId: alternative.requestGroupId,
      runIds: [run.id],
      turnId: alternative.turnId,
    };
  }

  public async selectResponse(
    userId: string,
    workspaceId: string,
    turnId: string,
    responseId: string,
  ) {
    const response = await this.database.client.modelResponse.findFirst({
      where: {
        id: responseId,
        turnId,
        turn: { conversation: { deletedAt: null, workspaceId } },
      },
      select: { id: true, turn: { select: { conversationId: true } } },
    });
    if (!response) throw new NotFoundException('Response not found');

    const selected = await this.repository.selectResponse(
      workspaceId,
      responseId,
    );
    await this.feedback.create({
      comment: 'preferred_response_selected',
      conversationId: response.turn.conversationId,
      kind: FeedbackKind.SWITCH_COHERENCE,
      responseId: selected.id,
      score: 1,
      turnId,
      userId,
      workspaceId,
    });
    return selected;
  }

  public async requestGroupForWorkspace(workspaceId: string, groupId: string) {
    const group = await this.database.client.requestGroup.findFirst({
      where: { id: groupId, workspaceId, conversation: { deletedAt: null } },
      select: {
        id: true,
        status: true,
        modelRuns: { select: { id: true, status: true } },
      },
    });
    if (!group) throw new NotFoundException('Request group not found');
    return group;
  }

  public async models() {
    const entries = await this.registry.findEnabled();
    const models =
      executionProvider() === 'fake'
        ? entries.filter((e) => executionEnabled(e.provider.key))
        : routingRegistry(entries);
    const health =
      executionProvider() === 'fake'
        ? []
        : await this.router.health().catch(() => []);
    return models.map((entry) => ({
      capabilities: entry.capabilities,
      displayName: entry.model.displayName,
      modelKey: entry.model.modelKey,
      provider: entry.provider,
      registryVersion: entry.registryVersion,
      health:
        entry.provider.key === 'fake'
          ? 'ready'
          : (health.find((h) => h.provider === entry.provider.key)?.status ??
            'unavailable'),
    }));
  }

  public async recordRoutingDecision(
    workspaceId: string,
    requestGroupId: string,
    body: {
      candidates: Array<{ registryEntryId: string }>;
      inputSnapshot: Record<string, unknown>;
      reason: string;
      selectedRegistryEntryId: string;
    },
  ): Promise<void> {
    if (!body.reason.trim())
      throw new BadRequestException('Routing reason is required');
    await this.repository.recordRoutingDecision({
      candidateRegistryEntryIds: body.candidates.map(
        (candidate) => candidate.registryEntryId,
      ),
      inputSnapshot: body.inputSnapshot,
      reason: body.reason.trim(),
      requestGroupId,
      selectedRegistryEntryId: body.selectedRegistryEntryId,
      workspaceId,
    });
  }

  private async ensureConversation(
    workspaceId: string,
    conversationId: string,
  ) {
    const conversation = await this.database.client.conversation.findFirst({
      where: { deletedAt: null, id: conversationId, workspaceId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  private async resolveModel(modelKey: string | undefined) {
    const models = await this.registry.findEnabled();
    const model = modelKey
      ? models.find(
          (entry) =>
            entry.model.modelKey === modelKey &&
            entry.provider.key === executionProvider(),
        )
      : models.find((entry) => entry.provider.key === executionProvider());
    if (!model) {
      throw new BadRequestException(
        'Select an enabled model for the configured execution provider',
      );
    }
    return model;
  }

  private async resolveAlternativeModel(
    sourceModelKey: string,
    attemptedModelKeys: ReadonlySet<string>,
    requestedModelKey?: string,
  ) {
    const models = await this.registry.findEnabled();
    if (executionProvider() !== 'fake')
      throw new BadRequestException(
        'Real-provider alternatives are not enabled',
      );
    const candidates = models.filter(
      (entry) =>
        entry.provider.key === 'fake' &&
        entry.model.modelKey !== sourceModelKey &&
        !attemptedModelKeys.has(entry.model.modelKey),
    );
    if (requestedModelKey) {
      const requested = candidates.find(
        (entry) => entry.model.modelKey === requestedModelKey,
      );
      if (!requested) {
        throw new BadRequestException(
          'Select an enabled model that has not already answered this turn',
        );
      }
      return requested;
    }
    const model = candidates[0];
    if (!model) {
      throw new BadRequestException(
        'No enabled alternative model is available for this turn',
      );
    }
    return model;
  }

  private content(value: string): string {
    const content = value.trim();
    if (!content || content.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException('Message content is invalid');
    }
    return content;
  }

  private title(value: string): string {
    const title = value.trim();
    if (!title || title.length > 160)
      throw new BadRequestException('Conversation title is invalid');
    return title;
  }

  private titleFromContent(content: string): string {
    return content.replace(/\s+/g, ' ').slice(0, 72) || DEFAULT_TITLE;
  }
}
