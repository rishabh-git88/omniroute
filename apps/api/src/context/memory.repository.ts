import { Injectable } from '@nestjs/common';

import { MemoryKind, type Memory } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface CreateMemoryInput {
  workspaceId: string;
  ownerUserId?: string;
  conversationId?: string;
  kind: MemoryKind;
  content: string;
  isPinned?: boolean;
}

@Injectable()
export class MemoryRepository {
  public constructor(private readonly database: PrismaService) {}

  public create(input: CreateMemoryInput): Promise<Memory> {
    return this.database.client.memory.create({
      data: {
        workspaceId: input.workspaceId,
        kind: input.kind,
        content: input.content,
        isPinned: input.isPinned ?? false,
        ...(input.ownerUserId === undefined
          ? {}
          : { ownerUserId: input.ownerUserId }),
        ...(input.conversationId === undefined
          ? {}
          : { conversationId: input.conversationId }),
      },
    });
  }

  public findActive(
    workspaceId: string,
    conversationId?: string,
    ownerUserId?: string,
  ): Promise<Memory[]> {
    return this.database.client.memory.findMany({
      where: {
        workspaceId,
        valid: true,
        AND: [
          {
            OR: [
              { conversationId: null },
              ...(conversationId ? [{ conversationId }] : []),
            ],
          },
          {
            OR: [
              { ownerUserId: null },
              ...(ownerUserId ? [{ ownerUserId }] : []),
            ],
          },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });
  }
}
