import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';

import { MemoryKind } from '../generated/prisma/client.js';
import type { AuthenticatedRequest } from '../identity/auth.types.js';
import { MemoryRepository } from './memory.repository.js';

interface PreferenceBody {
  content: string;
  scope: 'project' | 'user';
}

@Controller('memories')
export class ContextController {
  public constructor(private readonly memories: MemoryRepository) {}

  @Post('preferences')
  public createPreference(
    @Req() request: AuthenticatedRequest,
    @Body() body: PreferenceBody,
  ) {
    if (!request.authentication)
      throw new Error('Authentication guard did not run');
    const content = body.content?.trim();
    if (!content || content.length > 2_000) {
      throw new BadRequestException('Preference content is invalid');
    }
    return this.memories.create({
      content,
      isPinned: true,
      kind:
        body.scope === 'project'
          ? MemoryKind.WORKSPACE_RULE
          : MemoryKind.PINNED_FACT,
      ...(body.scope === 'user'
        ? { ownerUserId: request.authentication.user.id }
        : {}),
      workspaceId: request.authentication.workspace.id,
    });
  }
}
