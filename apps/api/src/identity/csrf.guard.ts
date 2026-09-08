import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthEnvironment } from '@omniroute/config/api';

import { AUTH_ENVIRONMENT, PUBLIC_ROUTE } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly expectedOrigin: string;

  public constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(AUTH_ENVIRONMENT) environment: AuthEnvironment,
  ) {
    this.expectedOrigin = new URL(environment.WEB_APP_URL).origin;
  }

  public canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = request.headers.origin;
    const csrfToken = request.headers['x-csrf-token'];
    const authentication = request.authentication;
    if (
      !authentication ||
      origin !== this.expectedOrigin ||
      typeof csrfToken !== 'string' ||
      !this.auth.isValidCsrfToken(authentication.sessionId, csrfToken)
    ) {
      throw new ForbiddenException('CSRF validation failed');
    }
    return true;
  }
}
