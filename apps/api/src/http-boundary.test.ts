import 'reflect-metadata';
import { Writable } from 'node:stream';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { parseAuthEnvironment } from '@omniroute/config/api';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureHttpBoundary, httpServerOptions } from './http-boundary.js';
import { ConversationStreamController } from './conversations/conversation.controller.js';
import { ConversationService } from './conversations/conversation.service.js';
import { StreamEventHub } from './conversations/stream-event-hub.js';
import { AuthCookieService } from './identity/auth-cookie.service.js';
import type { AuthenticatedRequest } from './identity/auth.types.js';

const origin = 'https://oneroute-ai.vercel.app';
const environment = parseAuthEnvironment({
  NODE_ENV: 'production',
  WEB_APP_URL: origin,
  API_PUBLIC_URL: origin,
  AUTH_SESSION_SECRET: 'test-only-secret-at-least-32-characters',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
});

describe('real Fastify browser boundary', () => {
  let app: NestFastifyApplication;
  let logs = '';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ConversationStreamController],
      providers: [
        StreamEventHub,
        {
          provide: ConversationService,
          useValue: {
            cancelRequestGroup: vi.fn().mockResolvedValue(undefined),
            requestGroupForWorkspace: vi.fn().mockResolvedValue({
              conversationId: 'conversation',
              id: 'group',
              status: 'COMPLETED',
              modelRuns: [],
            }),
          },
        },
      ],
    }).compile();
    const options = httpServerOptions({ LOG_LEVEL: 'info' });
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        ...options,
        logger: {
          ...options.logger,
          stream: new Writable({
            write(chunk, _encoding, done) {
              logs += String(chunk);
              done();
            },
          }),
        },
      }),
    );
    await configureHttpBoundary(app, { CORS_ORIGIN: origin }, environment);
    app.setGlobalPrefix('v1');
    const server = app.getHttpAdapter().getInstance();
    const cookies = new AuthCookieService(environment);
    server.addHook('onRequest', (request, reply, done) => {
      (request as AuthenticatedRequest).authentication = {
        csrfToken: 'test-csrf',
        sessionId: 'session',
        user: { id: 'user', email: 'user@example.com', name: 'User' },
        workspace: { id: 'workspace', name: 'Personal' },
      };
      if (request.url.includes('/events'))
        cookies.setSession(reply, 'rotated-test-token');
      done();
    });
    server.get('/cookie-test', (_request, reply) => {
      cookies.setSession(reply, 'test-session');
      cookies.setOAuthCookies(reply, {
        state: 'state-test',
        nonce: 'nonce-test',
        codeVerifier: 'verifier-test',
        returnTo: '/',
      });
      return reply.send({ ok: true });
    });
    server.get('/clear-cookie-test', (_request, reply) => {
      cookies.clearSession(reply);
      cookies.clearOAuthCookies(reply);
      return reply.send({ ok: true });
    });
    server.get('/v1/auth/google/callback', (_request, reply) =>
      reply.code(302).header('location', origin).send(),
    );
    app.get(StreamEventHub).publish('group', 'content.delta', {
      runId: 'run',
      delta: 'test answer',
    });
    await app.init();
    await server.ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('permits credentialed command and reconnect preflights', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/conversations/thread/turns',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers':
          'Content-Type,X-CSRF-Token,Idempotency-Key,Last-Event-ID',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(
      String(response.headers['access-control-allow-headers'])
        .toLowerCase()
        .split(',')
        .map((header) => header.trim()),
    ).toEqual(
      expect.arrayContaining([
        'content-type',
        'x-csrf-token',
        'idempotency-key',
        'last-event-id',
      ]),
    );
  });
  it('never grants an unconfigured origin access', async () => {
    const response = await app.inject({
      url: '/cookie-test',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.headers['access-control-allow-origin']).not.toBe(
      'https://evil.example',
    );
  });
  it('preserves CORS, rotated cookies, and request IDs through raw SSE', async () => {
    const response = await app.inject({
      url: '/v1/request-groups/group/events',
      headers: { origin, 'x-request-id': 'boundary-test-123' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['x-request-id']).toBe('boundary-test-123');
    expect(String(response.headers['set-cookie'])).toContain(
      'rotated-test-token',
    );
    expect(response.body).toContain('test answer');
  });
  it('uses Last-Event-ID and asks the browser to reload durable state after hub loss', async () => {
    const response = await app.inject({
      url: '/v1/request-groups/group/events',
      headers: { 'last-event-id': '999' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: stream.reset');
    expect(response.body).toContain('"conversationId":"conversation"');
  });
  it('authorizes the idempotent request-group cancellation command', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/request-groups/group/cancel',
      headers: { 'x-csrf-token': 'test-csrf' },
    });
    expect(response.statusCode).toBe(204);
    const service = app.get(ConversationService) as unknown as {
      cancelRequestGroup: ReturnType<typeof vi.fn>;
    };
    expect(service.cancelRequestGroup).toHaveBeenCalledWith(
      'workspace',
      'group',
    );
  });
  it.each(['/cookie-test', '/clear-cookie-test'])(
    'sets/clears host-only same-origin session cookies and callback-scoped OAuth cookies: %s',
    async (url) => {
      const response = await app.inject({ url });
      const headers = response.headers['set-cookie'] as string[];
      expect(headers).toHaveLength(5);
      const session = headers.find((value) =>
        value.startsWith('omniroute_session='),
      )!;
      expect(session).not.toContain('Domain=');
      expect(session).toContain('Path=/;');
      expect(session).toContain('HttpOnly');
      expect(session).toContain('Secure');
      expect(session).toContain('SameSite=Lax');
      for (const value of headers.filter(
        (value) => !value.startsWith('omniroute_session='),
      )) {
        expect(value).toContain('HttpOnly');
        expect(value).toContain('Secure');
        expect(value).toContain('SameSite=Lax');
        expect(value).not.toContain('Domain=');
        expect(value).toContain('Path=/v1/auth/google/callback');
      }
    },
  );
  it('does not log OAuth query values or credential headers in normal request logs', async () => {
    logs = '';
    await app.inject({
      url: '/v1/auth/google/callback?code=secret-code-marker&state=secret-state-marker',
      headers: {
        cookie: 'omniroute_session=secret-cookie-marker',
        authorization: 'Bearer secret-header-marker',
      },
    });
    expect(logs).toContain('incoming request');
    expect(logs).toContain('/v1/auth/google/callback');
    for (const value of [
      'secret-code-marker',
      'secret-state-marker',
      'secret-cookie-marker',
      'secret-header-marker',
    ])
      expect(logs).not.toContain(value);
  });
  it('rejects mismatched frontend/CORS configuration before startup', async () => {
    await expect(
      configureHttpBoundary(
        app,
        { CORS_ORIGIN: 'https://other.example.com' },
        environment,
      ),
    ).rejects.toThrow('same origin');
  });
});
