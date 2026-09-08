import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { AuthEnvironment } from '@omniroute/config/api';

import {
  AUTH_ENVIRONMENT,
  GOOGLE_IDENTITY_PROVIDER,
} from './auth.constants.js';
import { AuthRepository } from './auth.repository.js';
import { GoogleOAuthClient } from './google-oauth.client.js';
import type { RequestAuthentication } from './auth.types.js';

interface OAuthStart {
  authorizationUrl: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  state: string;
}

interface AuthenticatedSession {
  authentication: RequestAuthentication;
  rotatedToken: string | null;
}

@Injectable()
export class AuthService {
  public constructor(
    @Inject(AUTH_ENVIRONMENT)
    private readonly environment: AuthEnvironment,
    private readonly repository: AuthRepository,
    private readonly google: GoogleOAuthClient,
  ) {}

  public startGoogleSignIn(returnTo: string | undefined): OAuthStart {
    const codeVerifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const state = randomBytes(24).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return {
      authorizationUrl: this.google.createAuthorizationUrl({
        codeChallenge,
        nonce,
        state,
      }),
      codeVerifier,
      nonce,
      returnTo: this.safeReturnTo(returnTo),
      state,
    };
  }

  public async completeGoogleSignIn(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<{ sessionToken: string }> {
    const claims = await this.google.exchangeCode(input);
    const user = await this.repository.findOrCreateIdentity({
      email: claims.email,
      name: claims.name,
      provider: GOOGLE_IDENTITY_PROVIDER,
      providerAccountId: claims.subject,
    });
    if (user.status !== 'ACTIVE')
      throw new ForbiddenException('This account is not active');

    const sessionToken = this.newSessionToken();
    await this.repository.createSession({
      expiresAt: new Date(
        Date.now() + this.environment.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000,
      ),
      tokenHash: this.hashSessionToken(sessionToken),
      user,
    });

    return { sessionToken };
  }

  public async authenticate(
    token: string,
  ): Promise<AuthenticatedSession | null> {
    const tokenHash = this.hashSessionToken(token);
    const session = await this.repository.findActiveSession(tokenHash);
    if (!session || session.status !== 'ACTIVE') return null;

    let rotatedToken: string | null = null;
    const rotationAge =
      this.environment.AUTH_SESSION_ROTATION_MINUTES * 60 * 1000;
    if (
      !session.lastSeenAt ||
      session.lastSeenAt.getTime() <= Date.now() - rotationAge
    ) {
      const candidate = this.newSessionToken();
      const rotated = await this.repository.rotateSession({
        currentHash: tokenHash,
        nextHash: this.hashSessionToken(candidate),
        sessionId: session.sessionId,
      });
      if (rotated) rotatedToken = candidate;
    }

    return {
      authentication: {
        csrfToken: this.csrfToken(session.sessionId),
        sessionId: session.sessionId,
        user: { email: session.email, id: session.id, name: session.name },
        workspace: session.workspace,
      },
      rotatedToken,
    };
  }

  public isValidCsrfToken(sessionId: string, provided: string): boolean {
    const expected = this.csrfToken(sessionId);
    const expectedBytes = Buffer.from(expected);
    const providedBytes = Buffer.from(provided);
    return (
      expectedBytes.length === providedBytes.length &&
      timingSafeEqual(expectedBytes, providedBytes)
    );
  }

  public revoke(authentication: RequestAuthentication): Promise<void> {
    return this.repository.revokeSession({
      sessionId: authentication.sessionId,
      userId: authentication.user.id,
      workspaceId: authentication.workspace.id,
    });
  }

  public callbackRedirect(returnTo: string | undefined): string {
    return new URL(
      this.safeReturnTo(returnTo),
      this.environment.WEB_APP_URL,
    ).toString();
  }

  public loginErrorRedirect(): string {
    return new URL(
      '/login?error=oauth',
      this.environment.WEB_APP_URL,
    ).toString();
  }

  private csrfToken(sessionId: string): string {
    return createHmac('sha256', this.environment.AUTH_SESSION_SECRET)
      .update(`csrf:${sessionId}`)
      .digest('base64url');
  }

  private hashSessionToken(token: string): string {
    return createHmac('sha256', this.environment.AUTH_SESSION_SECRET)
      .update(`session:${token}`)
      .digest('hex');
  }

  private newSessionToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private safeReturnTo(value: string | undefined): string {
    return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
  }
}
