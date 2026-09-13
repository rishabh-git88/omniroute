import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../identity/auth.types.js';
import { WorkspaceFileService } from './workspace-file.service.js';

interface UploadFileBody {
  dataBase64: string;
  mime?: string;
  originalName: string;
}
@Controller('files')
export class WorkspaceFileController {
  public constructor(private readonly files: WorkspaceFileService) {}
  @Post()
  public upload(
    @Req() request: AuthenticatedRequest,
    @Body() body: UploadFileBody,
  ) {
    return this.files.upload(this.workspace(request), body);
  }
  @Get()
  public list(@Req() request: AuthenticatedRequest) {
    return this.files.list(this.workspace(request));
  }
  @Post(':fileId/retry')
  public retry(
    @Req() request: AuthenticatedRequest,
    @Param('fileId') fileId: string,
  ) {
    return this.files.retry(this.workspace(request), fileId);
  }
  @Delete(':fileId')
  @HttpCode(204)
  public remove(
    @Req() request: AuthenticatedRequest,
    @Param('fileId') fileId: string,
  ) {
    return this.files.delete(this.workspace(request), fileId);
  }
  private workspace(request: AuthenticatedRequest): string {
    if (!request.authentication)
      throw new Error('Authentication guard did not run');
    return request.authentication.workspace.id;
  }
}
