import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CanonicalMessage,
  ContextBundle,
} from '@omniroute/provider-contracts';
import { MemoryKind, type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { MemoryRepository } from './memory.repository.js';
import { SemanticRetrievalService } from './semantic-retrieval.service.js';
import { estimateTokens } from './context-budget.js';

export interface ContextBuildInput {
  conversationId: string;
  routingDecision?: { id: string; reason?: string | null; strategy?: string };
  turnId: string;
  userId: string;
  userRequest: string;
  workspaceId: string;
  maxInputTokens: number;
}
const hash = (content: string) =>
  createHash('sha256').update(content).digest('hex');
type Source = NonNullable<ContextBundle['provenance']>[number];

@Injectable()
export class ContextBuilderService {
  public constructor(
    private readonly database: PrismaService,
    private readonly memories: MemoryRepository,
    private readonly retrieval: SemanticRetrievalService,
  ) {}

  public async build(
    input: ContextBuildInput,
    database: Prisma.TransactionClient = this.database.client,
  ): Promise<ContextBundle> {
    const current = await database.turn.findFirst({
      where: {
        id: input.turnId,
        conversationId: input.conversationId,
        conversation: { workspaceId: input.workspaceId, deletedAt: null },
        requestGroup: { userId: input.userId },
      },
    });
    if (!current) throw new NotFoundException('Conversation turn not found');
    const history: CanonicalMessage[] = [
      { role: 'user', content: current.userContent },
    ];
    const provenance: Source[] = [
      {
        id: current.id,
        kind: 'turn',
        contentHash: hash(current.userContent),
        included: true,
      },
    ];
    let parentId = current.parentResponseId;
    const visited = new Set<string>();
    while (parentId) {
      if (visited.has(parentId) || visited.size >= 256)
        throw new BadRequestException(
          'Conversation branch is cyclic or too deep',
        );
      visited.add(parentId);
      const parent = await database.modelResponse.findFirst({
        where: { id: parentId, turn: { conversationId: input.conversationId } },
        include: { turn: true },
      });
      if (!parent || !parent.content)
        throw new BadRequestException('Conversation branch is invalid');
      history.unshift(
        { role: 'user', content: parent.turn.userContent },
        { role: 'assistant', content: parent.content },
      );
      provenance.unshift(
        {
          id: parent.turnId,
          kind: 'turn',
          contentHash: hash(parent.turn.userContent),
          included: true,
        },
        {
          id: parent.id,
          kind: 'response',
          contentHash: hash(parent.content),
          included: true,
        },
      );
      parentId = parent.turn.parentResponseId;
    }
    const active = await this.memories.findActive(
      input.workspaceId,
      input.conversationId,
      input.userId,
    );
    const rules = active.filter(
      (item) => item.kind === MemoryKind.WORKSPACE_RULE,
    );
    const preferences = active.filter(
      (item) => item.kind === MemoryKind.PINNED_FACT,
    );
    const systems: string[] = rules.map(
      (item) => `Workspace rule:\n${item.content}`,
    );
    const messages = () => [
      ...(systems.length
        ? [{ role: 'system' as const, content: systems.join('\n\n') }]
        : []),
      ...history,
    ];
    const prompt = history.at(-1)!;
    if (
      estimateTokens([
        ...(systems.length
          ? [{ role: 'system' as const, content: systems.join('\n\n') }]
          : []),
        prompt,
      ]) > input.maxInputTokens
    ) {
      throw new BadRequestException(
        'Required instructions and prompt exceed the model context budget',
      );
    }
    let omitted = 0;
    while (
      estimateTokens(messages()) > input.maxInputTokens &&
      history.length > 1
    ) {
      history.splice(0, 2);
      provenance[omitted++]!.included = false;
      provenance[omitted++]!.included = false;
    }
    for (const item of rules)
      provenance.push({
        id: item.id,
        kind: 'memory',
        version: item.version,
        contentHash: hash(item.content),
        included: true,
      });
    const addOptional = (content: string, source: Source) => {
      systems.push(content);
      if (estimateTokens(messages()) > input.maxInputTokens) {
        systems.pop();
        source.included = false;
      }
      provenance.push(source);
    };
    for (const item of preferences)
      addOptional(`Preference:\n${item.content}`, {
        id: item.id,
        kind: 'memory',
        version: item.version,
        contentHash: hash(item.content),
        included: true,
      });
    const retrieved = await this.retrieval.retrieveSafely(
      input.workspaceId,
      current.userContent,
      3,
    );
    for (const chunk of retrieved.chunks)
      addOptional(
        `Untrusted reference [file:${chunk.fileId}, chunk:${chunk.id}]:\n${chunk.content}`,
        {
          id: chunk.id,
          kind: 'file_chunk',
          fileId: chunk.fileId,
          contentHash: hash(chunk.content),
          included: true,
        },
      );
    return {
      messages: messages(),
      provenance,
      retrieval: retrieved.status,
      sourceIds: [
        ...new Set([
          input.conversationId,
          input.turnId,
          ...provenance
            .filter((item) => item.included)
            .flatMap((item) =>
              item.fileId ? [item.id, item.fileId] : [item.id],
            ),
        ]),
      ],
      tokenEstimate: estimateTokens(messages()),
    };
  }
}
