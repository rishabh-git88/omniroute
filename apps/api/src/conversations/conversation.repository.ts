import { ConflictException, Injectable } from '@nestjs/common';

import {
  ConversationMode,
  Prisma,
  RoutingStrategy,
  type ModelResponse,
  type RequestGroup,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface CreateTurnInput {
  userId: string;
  workspaceId: string;
  conversationId: string;
  idempotencyKey: string;
  content: string;
  mode: ConversationMode;
  parentResponseId?: string | null;
  registryEntryIds: readonly string[];
}

export interface ConversationRepository {
  createTurn(input: CreateTurnInput): Promise<RequestGroup>;
  selectResponse(
    workspaceId: string,
    responseId: string,
  ): Promise<ModelResponse>;
  recordRoutingDecision(input: {
    candidateRegistryEntryIds: readonly string[];
    inputSnapshot: Record<string, unknown>;
    reason: string;
    requestGroupId: string;
    selectedRegistryEntryId: string;
    workspaceId: string;
  }): Promise<void>;
  createAlternativeRun(input: {
    registryEntryId: string;
    responseId: string;
    workspaceId: string;
  }): Promise<{
    conversationId: string;
    requestGroupId: string;
    runId: string;
    turnId: string;
  }>;
}

@Injectable()
export class PrismaConversationRepository implements ConversationRepository {
  public constructor(private readonly database: PrismaService) {}

  public async createTurn(input: CreateTurnInput): Promise<RequestGroup> {
    if (input.registryEntryIds.length === 0) {
      throw new Error('At least one registry entry is required');
    }

    return this.database.client.$transaction(async (transaction) => {
      const existing = await transaction.requestGroup.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        const previous = await transaction.turn.findUniqueOrThrow({
          where: { requestGroupId: existing.id },
          include: { modelRuns: true },
        });
        const initialModels = previous.modelRuns.filter((run) =>
          input.registryEntryIds.includes(run.registryEntryId),
        );
        if (
          existing.workspaceId !== input.workspaceId ||
          existing.conversationId !== input.conversationId ||
          existing.mode !== input.mode ||
          previous.userContent !== input.content ||
          initialModels.length !== input.registryEntryIds.length ||
          (input.parentResponseId !== undefined &&
            previous.parentResponseId !== input.parentResponseId)
        ) {
          throw new ConflictException(
            'Idempotency key already belongs to a different command',
          );
        }
        return existing;
      }

      const conversation = await transaction.conversation.findFirst({
        where: {
          deletedAt: null,
          id: input.conversationId,
          workspaceId: input.workspaceId,
        },
      });
      if (!conversation) throw new Error('Conversation not found in workspace');

      const registryEntries = await transaction.providerRegistryEntry.findMany({
        where: {
          id: { in: [...new Set(input.registryEntryIds)] },
          enabled: true,
        },
      });
      if (registryEntries.length !== new Set(input.registryEntryIds).size) {
        throw new Error(
          'Every selected model must have an enabled registry entry',
        );
      }

      const requestGroup = await transaction.requestGroup.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          idempotencyKey: input.idempotencyKey,
          mode: input.mode,
        },
      });
      const turn = await transaction.turn.create({
        data: {
          conversationId: input.conversationId,
          requestGroupId: requestGroup.id,
          ...((input.parentResponseId === undefined
            ? conversation.activeHeadId
            : input.parentResponseId) === null
            ? {}
            : {
                parentResponseId:
                  input.parentResponseId === undefined
                    ? conversation.activeHeadId
                    : input.parentResponseId,
              }),
          userContent: input.content,
        },
      });
      await transaction.routingDecision.create({
        data: {
          requestGroupId: requestGroup.id,
          strategy:
            input.mode === ConversationMode.COMPARE
              ? RoutingStrategy.COMPARE
              : RoutingStrategy.USER_SELECTED,
          candidates: {
            create: registryEntries.map((entry, position) => ({
              position,
              registryEntryId: entry.id,
              selected: true,
            })),
          },
        },
      });
      await transaction.modelRun.createMany({
        data: registryEntries.map((entry) => ({
          turnId: turn.id,
          requestGroupId: requestGroup.id,
          providerId: entry.providerId,
          modelId: entry.modelId,
          registryEntryId: entry.id,
        })),
      });

      return requestGroup;
    });
  }

  public async selectResponse(
    workspaceId: string,
    responseId: string,
  ): Promise<ModelResponse> {
    return this.database.client.$transaction(async (transaction) => {
      const response = await transaction.modelResponse.findFirst({
        where: {
          id: responseId,
          turn: { conversation: { workspaceId } },
        },
        include: { turn: true },
      });
      if (!response) throw new Error('Response not found in workspace');

      const conversation = await transaction.conversation.findUniqueOrThrow({
        where: { id: response.turn.conversationId },
        select: { activeHeadId: true },
      });
      // Repeated browser submissions are harmless and do not churn selection
      // timestamps while a concurrent client is reading the active branch.
      if (response.selectedAt && conversation.activeHeadId === response.id)
        return response;

      await transaction.modelResponse.updateMany({
        where: { turnId: response.turnId, selectedAt: { not: null } },
        data: { selectedAt: null },
      });
      const selected = await transaction.modelResponse.update({
        where: { id: response.id },
        data: { selectedAt: new Date() },
      });
      await transaction.conversation.update({
        where: { id: response.turn.conversationId },
        data: { activeHeadId: response.id },
      });

      return selected;
    });
  }

  public async recordRoutingDecision(input: {
    candidateRegistryEntryIds: readonly string[];
    inputSnapshot: Record<string, unknown>;
    reason: string;
    requestGroupId: string;
    selectedRegistryEntryId: string;
    workspaceId: string;
  }): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      const group = await transaction.requestGroup.findFirst({
        where: { id: input.requestGroupId, workspaceId: input.workspaceId },
        select: { routingDecision: { select: { id: true } } },
      });
      if (!group?.routingDecision) throw new Error('Request group not found');
      const ids = [...new Set(input.candidateRegistryEntryIds)];
      if (!ids.includes(input.selectedRegistryEntryId)) {
        throw new Error('Selected registry entry must be a routing candidate');
      }
      const entries = await transaction.providerRegistryEntry.count({
        where: { enabled: true, id: { in: ids } },
      });
      if (entries !== ids.length)
        throw new Error('Routing candidate is not enabled');
      await transaction.routingDecisionModel.deleteMany({
        where: { routingDecisionId: group.routingDecision.id },
      });
      await transaction.routingDecision.update({
        where: { id: group.routingDecision.id },
        data: {
          inputSnapshot: input.inputSnapshot as Prisma.InputJsonValue,
          reason: input.reason,
          strategy: RoutingStrategy.AUTO,
          candidates: {
            create: ids.map((registryEntryId, position) => ({
              position,
              registryEntryId,
              selected: registryEntryId === input.selectedRegistryEntryId,
            })),
          },
        },
      });
    });
  }

  public async createAlternativeRun(input: {
    registryEntryId: string;
    responseId: string;
    workspaceId: string;
  }): Promise<{
    conversationId: string;
    requestGroupId: string;
    runId: string;
    turnId: string;
  }> {
    return this.database.client.$transaction(async (transaction) => {
      const response = await transaction.modelResponse.findFirst({
        where: {
          id: input.responseId,
          turn: { conversation: { workspaceId: input.workspaceId } },
        },
        include: { turn: true },
      });
      if (!response) throw new Error('Response not found in workspace');
      const target = await transaction.providerRegistryEntry.findFirst({
        where: { id: input.registryEntryId, enabled: true },
      });
      if (!target) throw new Error('Alternative model is not enabled');
      const existing = await transaction.modelRun.findFirst({
        where: {
          requestGroupId: response.turn.requestGroupId,
          registryEntryId: target.id,
        },
      });
      if (existing) throw new Error('This model has already answered the turn');
      const run = await transaction.modelRun.create({
        data: {
          turnId: response.turnId,
          requestGroupId: response.turn.requestGroupId,
          providerId: target.providerId,
          modelId: target.modelId,
          registryEntryId: target.id,
        },
      });
      const decision = await transaction.routingDecision.findUniqueOrThrow({
        where: { requestGroupId: response.turn.requestGroupId },
        select: { id: true, candidates: { select: { position: true } } },
      });
      await transaction.routingDecisionModel.create({
        data: {
          routingDecisionId: decision.id,
          registryEntryId: target.id,
          position:
            Math.max(
              -1,
              ...decision.candidates.map((candidate) => candidate.position),
            ) + 1,
          selected: false,
          reason: 'try_another_ai',
        },
      });
      await transaction.requestGroup.update({
        where: { id: response.turn.requestGroupId },
        data: { status: 'PENDING' },
      });
      return {
        conversationId: response.turn.conversationId,
        requestGroupId: response.turn.requestGroupId,
        runId: run.id,
        turnId: response.turnId,
      };
    });
  }
}
