import fastifyCookie from '@fastify/cookie';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../app.module.js';
import { createDatabaseClient } from '../database/database-client.js';
import { verifiedIntegrationUrl } from '../database/integration-safety.js';
import { GoogleOAuthClient } from './google-oauth.client.js';

const databaseUrl = await verifiedIntegrationUrl();
const testEmail = 'auth-flow@omniroute.local';

function cookieHeader(cookies: { name: string; value: string }[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

describe('authentication', () => {
  let app: INestApplication;
  let fastify: FastifyInstance;
  const database = createDatabaseClient(databaseUrl);
  const google = {
    createAuthorizationUrl: vi.fn(
      (input: { codeChallenge: string; nonce: string; state: string }) => {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.searchParams.set('code_challenge', input.codeChallenge);
        url.searchParams.set('nonce', input.nonce);
        url.searchParams.set('state', input.state);
        return url.toString();
      },
    ),
    exchangeCode: vi.fn().mockResolvedValue({
      email: testEmail,
      name: 'Auth Test',
      subject: 'google-subject-auth-test',
    }),
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      API_PUBLIC_URL: 'http://localhost:4000',
      AUTH_SESSION_ROTATION_MINUTES: '15',
      AUTH_SESSION_SECRET: 'integration-test-session-secret-32-characters',
      AUTH_SESSION_TTL_HOURS: '24',
      DATABASE_URL: databaseUrl,
      GOOGLE_CLIENT_ID: 'integration-google-client',
      GOOGLE_CLIENT_SECRET: 'integration-google-secret',
      NODE_ENV: 'test',
      WEB_APP_URL: 'http://localhost:3000',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GoogleOAuthClient)
      .useValue(google)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
    await fastify.register(fastifyCookie);
    app.setGlobalPrefix('v1');
    await app.init();
    await fastify.ready();
  });

  afterAll(async () => {
    const user = await database.user.findUnique({
      where: { email: testEmail },
    });
    if (user) {
      const workspaces = await database.workspace.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });
      const workspaceIds = workspaces.map((workspace) => workspace.id);
      await database.$transaction([
        database.auditEvent.deleteMany({
          where: {
            OR: [
              { actorUserId: user.id },
              { workspaceId: { in: workspaceIds } },
            ],
          },
        }),
        database.session.deleteMany({ where: { userId: user.id } }),
        database.account.deleteMany({ where: { userId: user.id } }),
        database.workspace.deleteMany({ where: { ownerId: user.id } }),
        database.creditWallet.deleteMany({ where: { userId: user.id } }),
      ]);
      await database.user.delete({ where: { id: user.id } });
    }
    await app.close();
    await database.$disconnect();
  });

  it('keeps health public and denies a current-user request without a session', async () => {
    const health = await fastify.inject({
      method: 'GET',
      url: '/v1/health/live',
    });
    const currentUser = await fastify.inject({
      method: 'GET',
      url: '/v1/auth/me',
    });

    expect(health.statusCode).toBe(200);
    expect(currentUser.statusCode).toBe(401);
  });

  it('rejects an OAuth callback whose state does not match', async () => {
    const start = await fastify.inject({
      method: 'GET',
      url: '/v1/auth/google',
    });
    const callback = await fastify.inject({
      headers: { cookie: cookieHeader(start.cookies) },
      method: 'GET',
      url: '/v1/auth/google/callback?code=test-code&state=wrong-state',
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(
      'http://localhost:3000/login?error=oauth',
    );
    expect(google.exchangeCode).not.toHaveBeenCalled();
  });

  it('completes OAuth, stores only a session hash, enforces CSRF, and revokes logout', async () => {
    const start = await fastify.inject({
      method: 'GET',
      url: '/v1/auth/google?returnTo=%2F',
    });
    expect(start.statusCode).toBe(302);
    const authorizationUrl = new URL(start.headers.location ?? '');
    const state = authorizationUrl.searchParams.get('state');
    expect(authorizationUrl.hostname).toBe('accounts.google.com');
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(state).toBeTruthy();

    const callback = await fastify.inject({
      headers: { cookie: cookieHeader(start.cookies) },
      method: 'GET',
      url: `/v1/auth/google/callback?code=test-code&state=${encodeURIComponent(state ?? '')}`,
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:3000/');
    const sessionCookie = callback.cookies.find(
      (cookie) => cookie.name === AUTH_SESSION_COOKIE && cookie.value,
    );
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Lax');

    const account = await database.account.findUniqueOrThrow({
      where: {
        identityProvider_providerAccountId: {
          identityProvider: 'google',
          providerAccountId: 'google-subject-auth-test',
        },
      },
      include: { user: { include: { sessions: true } } },
    });
    expect(account.user.sessions).toHaveLength(1);
    const storedSession = account.user.sessions[0];
    if (!storedSession) throw new Error('Expected an authenticated session');
    expect(storedSession.sessionTokenHash).not.toBe(sessionCookie?.value);

    let sessionHeader = cookieHeader(sessionCookie ? [sessionCookie] : []);
    const currentUser = await fastify.inject({
      headers: { cookie: sessionHeader },
      method: 'GET',
      url: '/v1/auth/me',
    });
    expect(currentUser.statusCode).toBe(200);
    expect(currentUser.json()).toMatchObject({
      user: { email: testEmail, name: 'Auth Test' },
      workspace: { name: 'Auth Test workspace' },
    });
    expect(currentUser.json()).not.toHaveProperty('sessionToken');
    const csrfToken = currentUser.json<{ csrfToken: string }>().csrfToken;

    await database.session.update({
      where: { id: storedSession.id },
      data: { lastSeenAt: new Date(Date.now() - 16 * 60 * 1000) },
    });
    const rotation = await fastify.inject({
      headers: { cookie: sessionHeader },
      method: 'GET',
      url: '/v1/auth/me',
    });
    const rotatedCookie = rotation.cookies.find(
      (cookie) => cookie.name === AUTH_SESSION_COOKIE && cookie.value,
    );
    expect(rotation.statusCode).toBe(200);
    expect(rotatedCookie?.value).not.toBe(sessionCookie?.value);

    const rejectedOldToken = await fastify.inject({
      headers: { cookie: sessionHeader },
      method: 'GET',
      url: '/v1/auth/me',
    });
    expect(rejectedOldToken.statusCode).toBe(401);
    sessionHeader = cookieHeader(rotatedCookie ? [rotatedCookie] : []);

    const rejectedLogout = await fastify.inject({
      headers: { cookie: sessionHeader },
      method: 'POST',
      url: '/v1/auth/logout',
    });
    expect(rejectedLogout.statusCode).toBe(403);

    const logout = await fastify.inject({
      headers: {
        cookie: sessionHeader,
        origin: 'http://localhost:3000',
        'x-csrf-token': csrfToken,
      },
      method: 'POST',
      url: '/v1/auth/logout',
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await fastify.inject({
      headers: { cookie: sessionHeader },
      method: 'GET',
      url: '/v1/auth/me',
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
