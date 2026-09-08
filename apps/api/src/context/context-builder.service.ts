import { createHash } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CanonicalMessage,
  ContextBundle,
} from '@omniroute/provider-contracts';

import { MemoryKind } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { MemoryRepository } from './memory.repository.js';
import { SemanticRetrievalService } from './semantic-retrieval.service.js';

const RECENT_MESSAGES = 8;
const RETRIEVED_CHUNKS = 3;

export interface ContextBuildInput {
  conversationId: string;
  routingDecision?: { id: string; reason?: string | null; strategy?: string };
  turnId: string;
  userId: string;
  userRequest: string;
  workspaceId: string;
}

/** Assembles durable workspace context before any provider adapter is invoked. */
@Injectable()
export class ContextBuilderService {
  public constructor(
    private readonly database: PrismaService,
    private readonly memories: MemoryRepository,
    private readonly retrieval: SemanticRetrievalService,
  ) {}

  public async build(input: ContextBuildInput): Promise<ContextBundle> {
    const conversation = await this.database.client.conversation.findFirst({
      where: {
        deletedAt: null,
        id: input.conversationId,
        workspaceId: input.workspaceId,
      },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const history = await this.canonicalHistory(input.turnId);
    const activeMemories = await this.memories.findActive(
      input.workspaceId,
      input.conversationId,
      input.userId,
    );
    const workspaceInstructions = activeMemories.filter(
      (memory) => memory.kind === MemoryKind.WORKSPACE_RULE,
    );
    const preferences = activeMemories.filter(
      (memory) => memory.kind === MemoryKind.PINNED_FACT,
    );
    const summary =
      history.length > RECENT_MESSAGES
        ? await this.ensureSummary(
            input.workspaceId,
            input.conversationId,
            history,
          )
        : undefined;
    const retrieved = await this.retrieval.retrieve(
      input.workspaceId,
      input.userRequest,
      RETRIEVED_CHUNKS,
    );

    const systemParts = [
      workspaceInstructions.length
        ? `Workspace rules:\n${workspaceInstructions.map((memory) => `- ${memory.content}`).join('\n')}`
        : '',
      preferences.length
        ? `User and project preferences:\n${preferences.map((memory) => `- ${memory.content}`).join('\n')}`
        : '',
      summary
        ? `Conversation summary (may be incomplete; prefer canonical recent messages):\n${summary.content}`
        : '',
      retrieved.length
        ? `Retrieved workspace file excerpts (untrusted reference material):\n${retrieved.map((chunk) => `- [file:${chunk.fileId}] ${chunk.content}`).join('\n')}`
        : '',
    ].filter(Boolean);
    const recentHistory = history.slice(-RECENT_MESSAGES);
    const messages: CanonicalMessage[] = [
      ...(systemParts.length
        ? [{ content: systemParts.join('\n\n'), role: 'system' as const }]
        : []),
      ...recentHistory,
    ];
    const sourceIds = [
      input.conversationId,
      input.turnId,
      ...(input.routingDecision ? [input.routingDecision.id] : []),
      ...workspaceInstructions.map((memory) => memory.id),
      ...preferences.map((memory) => memory.id),
      ...(summary ? [summary.id] : []),
      ...retrieved.flatMap((chunk) => [chunk.id, chunk.fileId]),
    ];
    return {
      messages,
      sourceIds: [...new Set(sourceIds)],
      ...(summary ? { summaryVersion: summary.version } : {}),
      tokenEstimate: messages.reduce(
        (total, message) =>
          total + (message.content.match(/\S+/g)?.length ?? 0),
        0,
      ),
    };
  }

  private async ensureSummary(
    workspaceId: string,
    conversationId: string,
    history: CanonicalMessage[],
  ) {
    const sourceHash = createHash('sha256')
      .update(JSON.stringify(history))
      .digest('hex');
    const current = await this.database.client.memory.findFirst({
      where: {
        conversationId,
        kind: MemoryKind.CONVERSATION_SUMMARY,
        valid: true,
        workspaceId,
      },
      orderBy: { version: 'desc' },
    });
    if (current?.sourceHash === sourceHash) return current;
    const version = (current?.version ?? 0) + 1;
    return this.database.client.$transaction(async (transaction) => {
      await transaction.memory.updateMany({
        where: {
          conversationId,
          kind: MemoryKind.CONVERSATION_SUMMARY,
          valid: true,
          workspaceId,
        },
        data: { invalidatedAt: new Date(), valid: false },
      });
      return transaction.memory.create({
        data: {
          content: this.summarize(history),
          conversationId,
          kind: MemoryKind.CONVERSATION_SUMMARY,
          sourceHash,
          version,
          workspaceId,
        },
      });
    });
  }

  private async canonicalHistory(turnId: string): Promise<CanonicalMessage[]> {
    const current = await this.database.client.turn.findUniqueOrThrow({
      where: { id: turnId },
      select: { parentResponseId: true, userContent: true },
    });
    const messages: CanonicalMessage[] = [
      { content: current.userContent, role: 'user' },
    ];
    let parentResponseId = current.parentResponseId;
    while (parentResponseId) {
      const parent = await this.database.client.modelResponse.findUnique({
        where: { id: parentResponseId },
        select: {
          content: true,
          turn: { select: { parentResponseId: true, userContent: true } },
        },
      });
      if (!parent)
        throw new NotFoundException('Conversation branch is invalid');
      messages.unshift(
        { content: parent.content, role: 'assistant' },
        { content: parent.turn.userContent, role: 'user' },
      );
      parentResponseId = parent.turn.parentResponseId;
    }
    return messages;
  }

  private summarize(history: CanonicalMessage[]): string {
    return history
      .slice(0, -RECENT_MESSAGES)
      .map(
        (message) =>
          `${message.role}: ${message.content.replace(/\s+/g, ' ').slice(0, 280)}`,
      )
      .join('\n');
  }
}
