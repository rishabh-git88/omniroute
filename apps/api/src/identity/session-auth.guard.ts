import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import type { FastifyReply } from 'fastify';

import { PUBLIC_ROUTE } from './auth.constants.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.method === 'OPTIONS') return true;

    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const token = request.cookies[AUTH_SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('Authentication required');

    const session = await this.auth.authenticate(token);
    if (!session) {
      this.cookies.clearSession(reply);
      throw new UnauthorizedException('Authentication required');
    }

    request.authentication = session.authentication;
    if (session.rotatedToken) {
      this.cookies.setSession(reply, session.rotatedToken);
    }
    return true;
  }
}
