import { createHmac } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { configureHttpBoundary } from '../http-boundary.js';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { createDatabaseClient } from '../database/database-client.js';
import { verifiedIntegrationUrl } from '../database/integration-safety.js';
import { MockProvider } from './mock.provider.js';

const databaseUrl = await verifiedIntegrationUrl();
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const database = createDatabaseClient(databaseUrl);
const internalToken = 'synthetic-router-integration-secret-only';
const sessionSecret = 'synthetic-session-integration-secret-only';
let app: NestFastifyApplication | undefined;
let upstream: Server;
let router: ChildProcess | undefined;
let origin: string;
let cookie: string;
let csrf: string;
let modelKey: string;
const requests: Array<{
  body: {
    model: string;
    max_output_tokens: number;
    input: Array<{ role: string; content: string }>;
  };
  authorization: string | undefined;
}> = [];
const disconnected = new Set<string>();
let mockCalls: ReturnType<typeof vi.spyOn>;

function port(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected a test socket');
  return address.port;
}
function headers(mutate = false) {
  return {
    cookie,
    origin: 'http://localhost:3000',
    ...(mutate
      ? {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          'x-csrf-token': csrf,
        }
      : {}),
  };
}
async function command(path: string, body: object) {
  return fetch(`${origin}/v1/${path}`, {
    method: 'POST',
    headers: { ...headers(true), 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}
async function start(content: string) {
  const conversation = await command('conversations', {
    title: 'Real execution protocol test',
  });
  expect(conversation.status).toBe(201);
  const { id } = (await conversation.json()) as { id: string };
  const response = await command(`conversations/${id}/turns`, {
    content,
    modelKey,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    runIds: string[];
    requestGroupId: string;
  };
}
async function events(groupId: string) {
  const response = await fetch(
    `${origin}/v1/request-groups/${groupId}/events`,
    { headers: headers(), signal: AbortSignal.timeout(10000) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('access-control-allow-origin')).toBe(
    'http://localhost:3000',
  );
  expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  return response;
}
async function saved(runId: string) {
  return database.modelRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      response: true,
      usageEvents: true,
      provider: true,
      model: true,
      creditReservation: true,
      requestGroup: { include: { routingDecision: true } },
    },
  });
}

describe('browser HTTP → NestJS → authenticated FastAPI → OpenAI HTTP adapter', () => {
  beforeAll(async () => {
    upstream = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        const parsed = JSON.parse(body) as (typeof requests)[number]['body'];
        requests.push({
          body: parsed,
          authorization: request.headers.authorization,
        });
        const scenario = parsed.input.at(-1)?.content ?? '';
        response.on('close', () => disconnected.add(scenario));
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (value: object) =>
          response.write(`data: ${JSON.stringify(value)}\n\n`);
        send({
          type: 'response.created',
          response: { id: `resp_${scenario}` },
        });
        send({
          type: 'response.output_text.delta',
          delta: 'Hello from the OpenAI HTTP fixture.',
        });
        if (['cancel', 'timeout', 'nest-timeout'].includes(scenario)) return;
        if (scenario !== 'truncated')
          send({
            type:
              scenario === 'failure' ? 'response.failed' : 'response.completed',
            response: { usage: { input_tokens: 12, output_tokens: 8 } },
          });
        response.end();
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    router = spawn(
      'uv',
      [
        '--cache-dir',
        '.uv-cache',
        'run',
        '--frozen',
        '--project',
        'services/ai-router',
        'python',
        'services/ai-router/tests/execution_server.py',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          AI_ROUTER_INTERNAL_TOKEN: internalToken,
          TEST_OPENAI_URL: `http://127.0.0.1:${port(upstream)}/v1/responses`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const routerPort = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Test router did not start')),
        10000,
      );
      router!.once('error', reject);
      router!.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Test router exited before readiness'));
      });
      router!.stdout!.on('data', (chunk: Buffer) => {
        const match = /PORT=(\d+)/.exec(chunk.toString());
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    for (const [key, value] of Object.entries({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      AI_EXECUTION_PROVIDER: 'openai',
      AI_ROUTER_URL: `http://127.0.0.1:${routerPort}`,
      AI_ROUTER_INTERNAL_TOKEN: internalToken,
      AI_ROUTER_TIMEOUT_MS: '2000',
      DAILY_FREE_CREDITS: '100000',
      API_PUBLIC_URL: 'http://localhost:4000',
      WEB_APP_URL: 'http://localhost:3000',
      AUTH_SESSION_SECRET: sessionSecret,
      GOOGLE_CLIENT_ID: 'synthetic-client',
      GOOGLE_CLIENT_SECRET: 'synthetic-secret',
    }))
      vi.stubEnv(key, value);
    const user = await database.user.create({
      data: {
        email: `execution-${crypto.randomUUID()}@test.invalid`,
        wallet: { create: {} },
      },
    });
    await database.workspace.create({
      data: { name: 'Execution test', ownerId: user.id },
    });
    const token = crypto.randomUUID();
    const session = await database.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600000),
        lastSeenAt: new Date(),
        sessionTokenHash: createHmac('sha256', sessionSecret)
          .update(`session:${token}`)
          .digest('hex'),
      },
    });
    cookie = `${AUTH_SESSION_COOKIE}=${token}`;
    csrf = createHmac('sha256', sessionSecret)
      .update(`csrf:${session.id}`)
      .digest('base64url');
    const provider = await database.provider.upsert({
      where: { key: 'openai' },
      create: {
        key: 'openai',
        displayName: 'OpenAI test transport',
        enabled: true,
      },
      update: { enabled: true },
    });
    modelKey = `openai:integration-${crypto.randomUUID()}`;
    const model = await database.model.create({
      data: {
        modelKey,
        providerId: provider.id,
        providerModelId: 'synthetic-http-model',
        displayName: 'HTTP test model',
      },
    });
    await database.providerRegistryEntry.create({
      data: {
        providerId: provider.id,
        modelId: model.id,
        registryVersion: 1,
        enabled: true,
        rolloutState: 'INTERNAL',
        effectiveAt: new Date(),
        capabilities: { contextWindow: 32768, maxOutputTokens: 4096 },
        pricingVersion: 'synthetic-test-only',
        pricing: {
          currency: 'USD',
          inputPerMillionTokens: '1',
          outputPerMillionTokens: '2',
        },
      },
    });
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    mockCalls = vi.spyOn(module.get(MockProvider), 'streamChat');
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureHttpBoundary(
      app,
      { CORS_ORIGIN: 'http://localhost:3000' },
      { WEB_APP_URL: 'http://localhost:3000' },
    );
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  }, 20000);

  afterAll(async () => {
    await app?.close();
    if (router && router.exitCode === null) {
      const exited = once(router, 'exit');
      router.kill('SIGTERM');
      await exited;
    }
    if (upstream) {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
    await database.$disconnect();
    vi.unstubAllEnvs();
  });

  it('persists response, selected routing, target, usage, latency and settlement through both real services', async () => {
    const operation = await start('success');
    const stream = await (await events(operation.requestGroupId)).text();
    expect(stream).toContain('Hello from the OpenAI HTTP fixture.');
    expect(stream).toContain('"status":"completed"');
    const run = await saved(operation.runIds[0]!);
    expect(run.status).toBe('COMPLETED');
    expect(run.provider.key).toBe('openai');
    expect(run.model.modelKey).toBe(modelKey);
    expect(run.providerRequestId).toBe('resp_success');
    expect(run.requestGroup.routingDecision?.strategy).toBe('USER_SELECTED');
    expect(run.response?.content).toBe('Hello from the OpenAI HTTP fixture.');
    expect(run.usageEvents[0]).toMatchObject({
      inputTokens: 12n,
      outputTokens: 8n,
    });
    expect(run.executionResult).toMatchObject({
      billingState: 'settled',
      latencyMs: expect.any(Number),
    });
    expect(requests[0]).toMatchObject({
      authorization: 'Bearer synthetic-provider-key',
      body: { model: 'synthetic-http-model', max_output_tokens: 512 },
    });
    expect(mockCalls).not.toHaveBeenCalled();
  });

  it.each([
    ['failure', 'OPENAI_ERROR', 'settled'],
    ['truncated', 'STREAM_TRUNCATED', 'reconciliation_required'],
    ['timeout', 'PROVIDER_TIMEOUT', 'reconciliation_required'],
  ])(
    'persists %s with one error terminal and correct billing disposition',
    async (scenario, code, billingState) => {
      const operation = await start(scenario);
      const stream = await (await events(operation.requestGroupId)).text();
      expect(stream.match(/event: run.error/g)).toHaveLength(1);
      expect(stream).not.toContain('"status":"completed"');
      const run = await saved(operation.runIds[0]!);
      expect(run.status).toBe('FAILED');
      expect(run.executionResult).toMatchObject({
        failureCode: code,
        billingState,
        partialOutput: 'Hello from the OpenAI HTTP fixture.',
      });
      expect(run.response).toBeNull();
      if (scenario === 'failure')
        expect(run.usageEvents[0]?.outputTokens).toBe(8n);
    },
  );

  it('propagates browser stop through Nest and FastAPI to the blocked provider socket', async () => {
    const operation = await start('cancel');
    const reader = (await events(operation.requestGroupId)).body!.getReader();
    const decoder = new TextDecoder();
    let stream = '';
    while (!stream.includes('Hello from')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Premature terminal');
      stream += decoder.decode(chunk.value);
    }
    const cancelled = await command(
      `model-runs/${operation.runIds[0]}/cancel`,
      {},
    );
    expect(cancelled.ok).toBe(true);
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      stream += decoder.decode(chunk.value);
    }
    expect(stream).toContain('"status":"cancelled"');
    await vi.waitFor(() => expect(disconnected.has('cancel')).toBe(true));
    const run = await saved(operation.runIds[0]!);
    expect(run.status).toBe('CANCELLED');
    expect(run.executionResult).toMatchObject({
      failureCode: 'CANCELLED',
      billingState: 'reconciliation_required',
    });
  });

  it('enforces the Nest deadline after headers and closes the upstream attempt', async () => {
    vi.stubEnv('AI_ROUTER_TIMEOUT_MS', '350');
    try {
      const operation = await start('nest-timeout');
      const stream = await (await events(operation.requestGroupId)).text();
      expect(stream.match(/event: run.error/g)).toHaveLength(1);
      const run = await saved(operation.runIds[0]!);
      expect(run.executionResult).toMatchObject({
        failureCode: 'ROUTER_TIMEOUT',
        billingState: 'reconciliation_required',
      });
      await vi.waitFor(() =>
        expect(disconnected.has('nest-timeout')).toBe(true),
      );
    } finally {
      vi.stubEnv('AI_ROUTER_TIMEOUT_MS', '2000');
    }
  });

  it('refuses real Compare 3 before dispatch or credit reservation', async () => {
    const created = await command('conversations', { mode: 'COMPARE' });
    const { id } = (await created.json()) as { id: string };
    const before = requests.length;
    const response = await command(`conversations/${id}/turns`, {
      content: 'compare',
      modelKey,
    });
    expect(response.status).toBe(400);
    expect(requests).toHaveLength(before);
  });
});
