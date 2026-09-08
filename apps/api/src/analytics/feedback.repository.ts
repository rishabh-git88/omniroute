import { Injectable } from '@nestjs/common';

import { FeedbackKind, type Feedback } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface CreateFeedbackInput {
  userId: string;
  workspaceId: string;
  conversationId: string;
  turnId?: string;
  responseId?: string;
  kind: FeedbackKind;
  score?: number;
  comment?: string;
}

@Injectable()
export class FeedbackRepository {
  public constructor(private readonly database: PrismaService) {}

  public create(input: CreateFeedbackInput): Promise<Feedback> {
    return this.database.client.feedback.create({
      data: {
        userId: input.userId,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        kind: input.kind,
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
        ...(input.responseId === undefined
          ? {}
          : { responseId: input.responseId }),
        ...(input.score === undefined ? {} : { score: input.score }),
        ...(input.comment === undefined ? {} : { comment: input.comment }),
      },
    });
  }
}
