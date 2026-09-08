import { Body, Controller, Post, Req } from '@nestjs/common';

import type { AuthenticatedRequest } from '../identity/auth.types.js';
import { WorkspaceFileService } from './workspace-file.service.js';

interface UploadTextFileBody {
  content: string;
  mime?: string;
  originalName: string;
}

@Controller('files')
export class WorkspaceFileController {
  public constructor(private readonly files: WorkspaceFileService) {}

  @Post()
  public uploadText(
    @Req() request: AuthenticatedRequest,
    @Body() body: UploadTextFileBody,
  ) {
    if (!request.authentication)
      throw new Error('Authentication guard did not run');
    return this.files.uploadText(request.authentication.workspace.id, body);
  }
}
