import { afterEach, describe, expect, it, vi } from 'vitest';
import { routerStream, type RouterClientOptions } from './ai-router.client.js';
import type { ProviderExecutionPlan } from '@omniroute/provider-contracts';
import { executionProvider } from './execution-gateway.js';

const plan: ProviderExecutionPlan = {
  request: {
    runId: '019cd3a5-8d1d-7000-8000-000000000001',
    contextSnapshotId: '019cd3a5-8d1d-7000-8000-000000000002',
    context: {
      messages: [{ role: 'user', content: 'hello' }],
      sourceIds: [],
      tokenEstimate: 53,
    },
    provider: 'openai',
    modelKey: 'reviewed',
    maxOutputTokens: 100,
  },
  model: {
    provider: 'openai',
    providerModelId: 'reviewed-model',
    registryVersion: 1,
    pricingVersion: 'reviewed-v1',
    capabilities: { contextWindow: 32768, maxOutputTokens: 4096 },
  },
};
const options: RouterClientOptions = {
  origin: 'http://router.internal',
  token: 'synthetic-internal-token-for-tests-only',
  timeoutMs: 100,
};
const event = (type: string, fields: object = {}) => ({
  type,
  runId: plan.request.runId,
  ...fields,
});
const wire = (value: object) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const collect = async (signal = new AbortController().signal) => {
  const events = [];
  for await (const event of routerStream(plan, options, signal))
    events.push(event);
  return events;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function streamResponse(data: string) {
  const bytes = new TextEncoder().encode(data);
  return new Response(
    new ReadableStream({
      start(controller) {
        // Deliberately split UTF-8 and CRLF sequences at every possible byte boundary.
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('authenticated router client', () => {
  it('streams fragmented canonical SSE, authenticates and stops at the first terminal', async () => {
    const mock = vi.fn().mockResolvedValue(
      streamResponse(
        wire(event('content.delta', { text: '你好' })) +
          wire(event('run.completed', { finishReason: 'stop' })) +
          wire(
            event('run.failed', {
              code: 'LATE',
              message: 'ignored',
              retryable: false,
            }),
          ),
      ),
    );
    vi.stubGlobal('fetch', mock);
    const result = await collect();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ text: '你好' });
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toBe('http://router.internal/providers/stream');
    expect(init.headers.authorization).toBe(`Bearer ${options.token}`);
    expect(JSON.parse(init.body)).toEqual(plan);
    expect(init.redirect).toBe('error');
  });
  it.each([
    ['', 'STREAM_TRUNCATED'],
    ['data: not-json\n\n', 'ROUTER_PROTOCOL_ERROR'],
    [
      wire(
        event('run.completed', {
          finishReason: 'stop',
          runId: crypto.randomUUID(),
        }),
      ),
      'ROUTER_PROTOCOL_ERROR',
    ],
    [
      wire(event('content.delta', { text: 'a'.repeat(262145) })),
      'OUTPUT_LIMIT_EXCEEDED',
    ],
  ])('rejects broken streams', async (body, code) => {
    // One chunk avoids allocating a separate object for every byte of the cap test.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    );
    await expect(collect()).rejects.toMatchObject({ code });
  });
  it('normalizes internal auth rejection without reading its body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('SECRET', { status: 401 })),
    );
    await expect(collect()).rejects.toMatchObject({
      code: 'ROUTER_AUTH_FAILED',
      message: 'Generation could not complete',
    });
  });
  it('redacts provider error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamResponse(
          wire(
            event('run.failed', {
              code: 'HTTP_429',
              message: 'SECRET',
              retryable: true,
            }),
          ),
        ),
      ),
    );
    expect(JSON.stringify(await collect())).not.toContain('SECRET');
  });
  it.each(['timeout', 'cancel'])(
    'aborts a blocked request on %s',
    async (kind) => {
      let upstreamSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              upstreamSignal = init.signal as AbortSignal;
              upstreamSignal.addEventListener('abort', () =>
                reject(new Error('aborted')),
              );
            }),
        ),
      );
      const controller = new AbortController();
      const result = collect(controller.signal);
      if (kind === 'cancel') controller.abort();
      await expect(result).rejects.toMatchObject({
        code: kind === 'cancel' ? 'CANCELLED' : 'ROUTER_TIMEOUT',
      });
      expect(upstreamSignal?.aborted).toBe(true);
    },
  );
  it('disables mock execution in production and requires internal configuration for real providers', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FILES_STORAGE_DRIVER', 's3');
    vi.stubEnv('FILES_S3_BUCKET', 'test-private-file-bucket');
    vi.stubEnv('FILES_S3_REGION', 'ap-southeast-1');
    vi.stubEnv('EMBEDDING_PROVIDER', 'disabled');
    vi.stubEnv('AI_EXECUTION_PROVIDER', undefined);
    expect(executionProvider()).toBeUndefined();
    vi.stubEnv('AI_EXECUTION_PROVIDER', 'mock');
    expect(() => executionProvider()).toThrow('AI_EXECUTION_PROVIDER');
    vi.stubEnv('AI_EXECUTION_PROVIDER', 'openai');
    vi.stubEnv('AI_ROUTER_INTERNAL_TOKEN', '');
    expect(() => executionProvider()).toThrow('AI_ROUTER_INTERNAL_TOKEN');
    vi.stubEnv('AI_ROUTER_INTERNAL_TOKEN', options.token);
    vi.stubEnv('AI_ROUTER_URL', options.origin);
    expect(executionProvider()).toBe('openai');
    vi.stubEnv('AI_EXECUTION_PROVIDER', 'groq');
    expect(executionProvider()).toBe('groq');
    vi.stubEnv('AI_EXECUTION_PROVIDER', 'openrouter');
    expect(executionProvider()).toBe('openrouter');
    vi.stubEnv('AI_EXECUTION_PROVIDER', 'multi');
    expect(executionProvider()).toBe('multi');
  });
});
