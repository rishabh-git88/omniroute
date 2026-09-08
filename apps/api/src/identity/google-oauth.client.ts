import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthEnvironment } from '@omniroute/config/api';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { AUTH_ENVIRONMENT } from './auth.constants.js';
import type { GoogleTokenClaims } from './auth.types.js';

interface GoogleTokenResponse {
  id_token?: string;
}

@Injectable()
export class GoogleOAuthClient {
  private readonly keys = createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs'),
  );

  public constructor(
    @Inject(AUTH_ENVIRONMENT)
    private readonly environment: AuthEnvironment,
  ) {}

  public createAuthorizationUrl(input: {
    codeChallenge: string;
    nonce: string;
    state: string;
  }): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.environment.GOOGLE_CLIENT_ID,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      nonce: input.nonce,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
    }).toString();
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  public async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<GoogleTokenClaims> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      body: new URLSearchParams({
        client_id: this.environment.GOOGLE_CLIENT_ID,
        client_secret: this.environment.GOOGLE_CLIENT_SECRET,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new UnauthorizedException('Google sign-in failed');

    const tokens = (await response.json()) as GoogleTokenResponse;
    if (!tokens.id_token)
      throw new UnauthorizedException('Google sign-in failed');

    const { payload } = await jwtVerify(tokens.id_token, this.keys, {
      audience: this.environment.GOOGLE_CLIENT_ID,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });
    if (
      payload.nonce !== input.nonce ||
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      payload.email_verified !== true
    ) {
      throw new UnauthorizedException('Google sign-in failed');
    }

    return {
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : null,
      subject: payload.sub,
    };
  }

  private get redirectUri(): string {
    return new URL(
      '/v1/auth/google/callback',
      this.environment.API_PUBLIC_URL,
    ).toString();
  }
}
