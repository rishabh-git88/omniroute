import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';
import type { FastifyReply } from 'fastify';

import {
  CoordinationUnavailableError,
  CoordinationService,
} from '../coordination/coordination.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { PUBLIC_ROUTE } from './auth.constants.js';
import { Reflector } from '@nestjs/core';

const WINDOW_MS = 60_000;

@Injectable()
export class RateLimitGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly coordination: CoordinationService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
      return true;
    const action = this.action(request.url);
    if (!action || !request.authentication) return true;
    const environment = parseApiEnvironment(process.env);
    const limit =
      action === 'file'
        ? environment.RATE_LIMIT_FILE_MUTATIONS_PER_MINUTE
        : environment.RATE_LIMIT_EXECUTIONS_PER_MINUTE;
    try {
      const result = await this.coordination.limit({
        key: `omniroute:v1:rate:${action}:${request.authentication.workspace.id}:${request.authentication.user.id}`,
        limit,
        windowMs: WINDOW_MS,
      });
      if (result.allowed) return true;
      context
        .switchToHttp()
        .getResponse<FastifyReply>()
        .header('retry-after', String(result.retryAfterSeconds));
      throw new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    } catch (error) {
      if (error instanceof CoordinationUnavailableError)
        throw new ServiceUnavailableException('RATE_LIMIT_UNAVAILABLE');
      throw error;
    }
  }

  private action(url: string): 'execution' | 'file' | undefined {
    const path = url.split('?')[0] ?? '';
    if (path.startsWith('/v1/files')) return 'file';
    return /\/turns(?:\/|$)|\/try-another$/.test(path)
      ? 'execution'
      : undefined;
  }
}
