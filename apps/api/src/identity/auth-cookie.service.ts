import { Inject, Injectable } from '@nestjs/common';
import type { AuthEnvironment } from '@omniroute/config/api';
import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import type { FastifyReply } from 'fastify';

import { AUTH_ENVIRONMENT, OAUTH_COOKIE_NAMES } from './auth.constants.js';

const OAUTH_COOKIE_PATH = '/v1/auth/google/callback';

@Injectable()
export class AuthCookieService {
  public constructor(
    @Inject(AUTH_ENVIRONMENT)
    private readonly environment: AuthEnvironment,
  ) {}

  public setOAuthCookies(
    reply: FastifyReply,
    values: {
      codeVerifier: string;
      nonce: string;
      returnTo: string;
      state: string;
    },
  ): void {
    for (const [key, name] of Object.entries(OAUTH_COOKIE_NAMES)) {
      reply.setCookie(name, values[key as keyof typeof values], {
        ...this.oauthOptions,
        maxAge: 600,
        path: OAUTH_COOKIE_PATH,
      });
    }
  }

  public clearOAuthCookies(reply: FastifyReply): void {
    for (const name of Object.values(OAUTH_COOKIE_NAMES)) {
      reply.clearCookie(name, {
        ...this.oauthOptions,
        path: OAUTH_COOKIE_PATH,
      });
    }
  }

  public setSession(reply: FastifyReply, token: string): void {
    reply.setCookie(AUTH_SESSION_COOKIE, token, {
      ...this.sessionOptions,
      ...this.sessionDomain,
      maxAge: this.environment.AUTH_SESSION_TTL_HOURS * 60 * 60,
      path: '/',
      priority: 'high',
    });
  }

  public clearSession(reply: FastifyReply): void {
    reply.clearCookie(AUTH_SESSION_COOKIE, {
      ...this.sessionOptions,
      ...this.sessionDomain,
      path: '/',
    });
  }

  private get oauthOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.environment.NODE_ENV === 'production',
    };
  }

  private get sessionOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.environment.NODE_ENV === 'production',
    };
  }

  private get sessionDomain() {
    return this.environment.AUTH_COOKIE_DOMAIN
      ? { domain: this.environment.AUTH_COOKIE_DOMAIN }
      : {};
  }
}
