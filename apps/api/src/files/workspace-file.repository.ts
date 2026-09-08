import { Injectable } from '@nestjs/common';

import type { WorkspaceFile } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface CreateWorkspaceFileInput {
  workspaceId: string;
  objectKey: string;
  originalName: string;
  mime: string;
  size: bigint;
  checksumSha256?: string;
}

@Injectable()
export class WorkspaceFileRepository {
  public constructor(private readonly database: PrismaService) {}

  public create(input: CreateWorkspaceFileInput): Promise<WorkspaceFile> {
    return this.database.client.workspaceFile.create({
      data: {
        workspaceId: input.workspaceId,
        objectKey: input.objectKey,
        originalName: input.originalName,
        mime: input.mime,
        size: input.size,
        ...(input.checksumSha256 === undefined
          ? {}
          : { checksumSha256: input.checksumSha256 }),
      },
    });
  }

  public findById(
    workspaceId: string,
    fileId: string,
  ): Promise<WorkspaceFile | null> {
    return this.database.client.workspaceFile.findFirst({
      where: { id: fileId, workspaceId, deletedAt: null },
    });
  }
}
