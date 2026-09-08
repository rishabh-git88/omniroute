import { createHmac } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import { createDatabaseClient } from '../database/database-client.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
const sessionSecret = 'conversation-test-session-secret-32-characters';

function sessionHash(token: string): string {
  return createHmac('sha256', sessionSecret)
    .update(`session:${token}`)
    .digest('hex');
}

function csrfToken(sessionId: string): string {
  return createHmac('sha256', sessionSecret)
    .update(`csrf:${sessionId}`)
    .digest('base64url');
}

describe.skipIf(!databaseUrl)('conversation flow', () => {
  if (!databaseUrl) return;

  let app: INestApplication;
  let fastify: FastifyInstance;
  const database = createDatabaseClient(databaseUrl);
  let cookie: string;
  let csrf: string;
  let modelKey: string;
  let alternativeModelKey: string;

  beforeAll(async () => {
    Object.assign(process.env, {
      API_PUBLIC_URL: 'http://localhost:4000',
      AUTH_SESSION_ROTATION_MINUTES: '15',
      AUTH_SESSION_SECRET: sessionSecret,
      AUTH_SESSION_TTL_HOURS: '24',
      DATABASE_URL: databaseUrl,
      GOOGLE_CLIENT_ID: 'conversation-test-google-client',
      GOOGLE_CLIENT_SECRET: 'conversation-test-google-secret',
      NODE_ENV: 'test',
      WEB_APP_URL: 'http://localhost:3000',
    });
    await database.$connect();
    const user = await database.user.create({
      data: {
        email: `conversation-${crypto.randomUUID()}@omniroute.local`,
        name: 'Conversation Test',
        wallet: { create: {} },
      },
    });
    await database.workspace.create({
      data: { name: 'Conversation workspace', ownerId: user.id },
    });
    const token = crypto.randomUUID();
    const session = await database.session.create({
      data: {
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        lastSeenAt: new Date(),
        sessionTokenHash: sessionHash(token),
        userId: user.id,
      },
    });
    const provider = await database.provider.upsert({
      where: { key: 'fake' },
      create: { displayName: 'Mock provider', enabled: true, key: 'fake' },
      update: { enabled: true },
    });
    modelKey = `fake:stream-${crypto.randomUUID()}`;
    const model = await database.model.create({
      data: {
        displayName: 'Mock Stream',
        modelKey,
        providerId: provider.id,
        providerModelId: `stream-${crypto.randomUUID()}`,
      },
    });
    await database.providerRegistryEntry.create({
      data: {
        capabilities: { modalities: { input: ['text'], output: ['text'] } },
        effectiveAt: new Date(),
        enabled: true,
        modelId: model.id,
        pricing: {
          currency: 'USD',
          inputPerMillionTokens: '0',
          outputPerMillionTokens: '0',
        },
        pricingVersion: 'test-v1',
        providerId: provider.id,
        registryVersion: 1,
        rolloutState: 'INTERNAL',
      },
    });
    alternativeModelKey = `fake:alternative-${crypto.randomUUID()}`;
    const alternativeModel = await database.model.create({
      data: {
        displayName: 'Mock Alternative',
        modelKey: alternativeModelKey,
        providerId: provider.id,
        providerModelId: `alternative-${crypto.randomUUID()}`,
      },
    });
    await database.providerRegistryEntry.create({
      data: {
        capabilities: { modalities: { input: ['text'], output: ['text'] } },
        effectiveAt: new Date(),
        enabled: true,
        modelId: alternativeModel.id,
        pricing: {
          currency: 'USD',
          inputPerMillionTokens: '0',
          outputPerMillionTokens: '0',
        },
        pricingVersion: 'test-v1',
        providerId: provider.id,
        registryVersion: 1,
        rolloutState: 'INTERNAL',
      },
    });
    cookie = `${AUTH_SESSION_COOKIE}=${token}`;
    csrf = csrfToken(session.id);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    await app.close();
    await database.$disconnect();
  });

  function authenticatedHeaders(mutate = false): Record<string, string> {
    return {
      cookie,
      ...(mutate
        ? { origin: 'http://localhost:3000', 'x-csrf-token': csrf }
        : {}),
    };
  }

  it('protects conversation routes', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/v1/conversations',
    });
    expect(response.statusCode).toBe(401);
  });

  it('streams a provider-neutral mock response and persists its routing context', async () => {
    const created = await fastify.inject({
      headers: authenticatedHeaders(true),
      method: 'POST',
      payload: { title: 'Streaming test' },
      url: '/v1/conversations',
    });
    expect(created.statusCode).toBe(201);
    const conversationId = created.json<{ id: string }>().id;

    const message = await fastify.inject({
      headers: {
        ...authenticatedHeaders(true),
        'idempotency-key': crypto.randomUUID(),
      },
      method: 'POST',
      payload: { content: 'Explain the mock stream.', modelKey },
      url: `/v1/conversations/${conversationId}/turns`,
    });
    expect(message.statusCode).toBe(201);
    const operation = message.json<{
      requestGroupId: string;
      runIds: string[];
      turnId: string;
    }>();
    expect(operation.runIds).toHaveLength(1);
    const runId = operation.runIds[0];
    if (!runId) throw new Error('Expected a model run');

    const events = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: `/v1/request-groups/${operation.requestGroupId}/events`,
    });
    expect(events.statusCode).toBe(200);
    expect(events.headers['content-type']).toContain('text/event-stream');
    expect(events.payload).toContain('event: content.delta');
    expect(events.payload).toContain('event: run.status');
    expect(events.payload).toContain('"status":"completed"');

    const detail = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: `/v1/conversations/${conversationId}`,
    });
    expect(detail.statusCode).toBe(200);
    const conversation = detail.json<{
      activeHeadId: string | null;
      title: string;
      turns: Array<{
        requestGroup: {
          routingDecision: {
            candidates: Array<{ model: { modelKey: string } }>;
          };
          runs: Array<{ id: string; status: string }>;
        };
        responses: Array<{
          content: string;
          id: string;
          model: { modelKey: string };
          selectedAt: string | null;
        }>;
      }>;
    }>();
    expect(
      conversation.turns[0]?.requestGroup.routingDecision.candidates[0]?.model
        .modelKey,
    ).toBe(modelKey);
    expect(conversation.turns[0]?.requestGroup.runs[0]?.status).toBe(
      'COMPLETED',
    );
    expect(conversation.turns[0]?.responses[0]?.content).toContain('Mock');
    const snapshot = await database.contextSnapshot.findFirst({
      where: { runId },
    });
    expect(snapshot?.sourceIds).toEqual(
      expect.arrayContaining([conversationId, operation.turnId]),
    );

    const firstResponse = conversation.turns[0]?.responses[0];
    if (!firstResponse) throw new Error('Expected the first model response');
    expect(firstResponse.selectedAt).not.toBeNull();
    const alternative = await fastify.inject({
      headers: authenticatedHeaders(true),
      method: 'POST',
      payload: { modelKey: alternativeModelKey },
      url: `/v1/model-responses/${firstResponse.id}/try-another`,
    });
    expect(alternative.statusCode).toBe(201);
    const alternativeOperation = alternative.json<{
      requestGroupId: string;
      runIds: string[];
    }>();
    expect(alternativeOperation.requestGroupId).toBe(operation.requestGroupId);
    const alternativeEvents = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: `/v1/request-groups/${alternativeOperation.requestGroupId}/events`,
    });
    expect(alternativeEvents.statusCode).toBe(200);
    expect(alternativeEvents.payload).toContain('event: content.delta');
    const alternativeRunId = alternativeOperation.runIds[0];
    if (!alternativeRunId) throw new Error('Expected alternative model run');
    const alternativeSnapshot = await database.contextSnapshot.findFirst({
      where: { runId: alternativeRunId },
    });
    expect(alternativeSnapshot?.sourceIds).toEqual(
      expect.arrayContaining([conversationId, operation.turnId]),
    );
    expect(alternativeSnapshot?.snapshotHash).toBe(snapshot?.snapshotHash);

    const afterAlternative = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: `/v1/conversations/${conversationId}`,
    });
    const alternatives = afterAlternative.json<typeof conversation>();
    const responses = alternatives.turns[0]?.responses ?? [];
    expect(responses).toHaveLength(2);
    const alternativeResponse = responses.find(
      (response) => response.model.modelKey === alternativeModelKey,
    );
    expect(alternativeResponse?.selectedAt).toBeNull();
    if (!alternativeResponse) throw new Error('Expected alternative response');

    const selected = await fastify.inject({
      headers: authenticatedHeaders(true),
      method: 'POST',
      payload: { responseId: alternativeResponse.id },
      url: `/v1/turns/${operation.turnId}/select`,
    });
    expect(selected.statusCode).toBe(201);
    const selectedConversation = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: `/v1/conversations/${conversationId}`,
    });
    expect(selectedConversation.json<typeof conversation>().activeHeadId).toBe(
      alternativeResponse.id,
    );
    expect(
      await database.feedback.findFirst({
        where: { responseId: alternativeResponse.id },
      }),
    ).toEqual(
      expect.objectContaining({
        kind: 'SWITCH_COHERENCE',
        score: 1,
      }),
    );

    const renamed = await fastify.inject({
      headers: authenticatedHeaders(true),
      method: 'PATCH',
      payload: { title: 'Renamed stream' },
      url: `/v1/conversations/${conversationId}`,
    });
    expect(renamed.statusCode).toBe(200);
    const list = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: '/v1/conversations',
    });
    expect(list.json<Array<{ title: string }>>()).toContainEqual(
      expect.objectContaining({ title: 'Renamed stream' }),
    );

    const regenerated = await fastify.inject({
      headers: {
        ...authenticatedHeaders(true),
        'idempotency-key': crypto.randomUUID(),
      },
      method: 'POST',
      payload: { modelKey },
      url: `/v1/conversations/${conversationId}/turns/${operation.turnId}/regenerate`,
    });
    expect(regenerated.statusCode).toBe(201);

    const archive = await fastify.inject({
      headers: authenticatedHeaders(true),
      method: 'DELETE',
      url: `/v1/conversations/${conversationId}`,
    });
    expect(archive.statusCode).toBe(204);
    const afterArchive = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: '/v1/conversations',
    });
    expect(afterArchive.json<Array<{ id: string }>>()).not.toContainEqual(
      expect.objectContaining({ id: conversationId }),
    );
  });

  it('cancels an in-flight model run through the same stream and durable state', async () => {
    const created = await fastify.inject({
      headers: authenticatedHeaders(true),
      method: 'POST',
      payload: { title: 'Cancellation test' },
      url: '/v1/conversations',
    });
    const conversationId = created.json<{ id: string }>().id;
    const message = await fastify.inject({
      headers: {
        ...authenticatedHeaders(true),
        'idempotency-key': crypto.randomUUID(),
      },
      method: 'POST',
      payload: {
        content: 'Please stream a response that I will stop immediately.',
        modelKey,
      },
      url: `/v1/conversations/${conversationId}/turns`,
    });
    const operation = message.json<{
      requestGroupId: string;
      runIds: string[];
    }>();
    const runId = operation.runIds[0];
    if (!runId) throw new Error('Expected a model run');

    const cancelled = await fastify.inject({
      headers: authenticatedHeaders(true),
      method: 'POST',
      payload: {},
      url: `/v1/model-runs/${runId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(204);
    const events = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: `/v1/request-groups/${operation.requestGroupId}/events`,
    });
    expect(events.payload).toContain('"status":"cancelled"');

    const detail = await fastify.inject({
      headers: authenticatedHeaders(),
      method: 'GET',
      url: `/v1/conversations/${conversationId}`,
    });
    expect(
      detail.json<{
        turns: Array<{ requestGroup: { runs: Array<{ status: string }> } }>;
      }>().turns[0]?.requestGroup.runs[0]?.status,
    ).toBe('CANCELLED');
  });
});
