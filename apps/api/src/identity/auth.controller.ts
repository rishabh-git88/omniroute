import { timingSafeEqual } from 'node:crypto';

import {
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { CurrentUserResponse } from '@omniroute/types';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { OAUTH_COOKIE_NAMES } from './auth.constants.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { Public } from './public.decorator.js';

function equalSecrets(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (!left || !right) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function redirect(reply: FastifyReply, location: string): void {
  void reply.code(302).header('location', location).send();
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  public constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
  ) {}

  @Public()
  @Get('google')
  public startGoogleSignIn(
    @Query('returnTo') returnTo: string | undefined,
    @Res() reply: FastifyReply,
  ): void {
    const start = this.auth.startGoogleSignIn(returnTo);
    this.cookies.setOAuthCookies(reply, start);
    reply.header('cache-control', 'no-store');
    redirect(reply, start.authorizationUrl);
  }

  @Public()
  @Get('google/callback')
  public async completeGoogleSignIn(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const storedState = request.cookies[OAUTH_COOKIE_NAMES.state];
    const codeVerifier = request.cookies[OAUTH_COOKIE_NAMES.codeVerifier];
    const nonce = request.cookies[OAUTH_COOKIE_NAMES.nonce];
    const returnTo = request.cookies[OAUTH_COOKIE_NAMES.returnTo];
    this.cookies.clearOAuthCookies(reply);
    reply.header('cache-control', 'no-store');

    if (!code || !codeVerifier || !nonce || !equalSecrets(state, storedState)) {
      redirect(reply, this.auth.loginErrorRedirect());
      return;
    }

    try {
      const result = await this.auth.completeGoogleSignIn({
        code,
        codeVerifier,
        nonce,
      });
      this.cookies.setSession(reply, result.sessionToken);
      redirect(reply, this.auth.callbackRedirect(returnTo));
    } catch {
      this.logger.warn('Google OAuth callback failed');
      redirect(reply, this.auth.loginErrorRedirect());
    }
  }

  @Get('me')
  @Header('cache-control', 'no-store')
  public currentUser(
    @Req() request: AuthenticatedRequest,
  ): CurrentUserResponse {
    const authentication = request.authentication;
    if (!authentication) throw new Error('Authentication guard did not run');

    return {
      csrfToken: authentication.csrfToken,
      user: authentication.user,
      workspace: authentication.workspace,
    };
  }

  @Post('logout')
  @HttpCode(204)
  public async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const authentication = request.authentication;
    if (!authentication) throw new Error('Authentication guard did not run');

    await this.auth.revoke(authentication);
    this.cookies.clearSession(reply);
  }
}
