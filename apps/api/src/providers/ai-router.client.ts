import { Injectable } from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';
import {
  providerEventSchema,
  providerHealthSchema,
  routingDecisionSchema,
  routingRequestSchema,
  providerExecutionPlanSchema,
  externalProviderIds,
  type ProviderEvent,
  type ProviderExecutionPlan,
} from '@omniroute/provider-contracts';

export class ProviderExecutionError extends Error {
  public constructor(public readonly code: string) {
    super('Generation could not complete');
  }
}

export interface RouterClientOptions {
  origin: string;
  token: string;
  timeoutMs: number;
}

/** A single attempt, never retried: POST retries could duplicate billable work. */
export async function* routerStream(
  plan: ProviderExecutionPlan,
  options: RouterClientOptions,
  signal: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs);
  const combined = AbortSignal.any([signal, timeout.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(new URL('/providers/stream', options.origin), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.token}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(providerExecutionPlanSchema.parse(plan)),
      signal: combined,
      redirect: 'error',
    });
    if (!response.ok)
      throw new ProviderExecutionError(
        response.status === 401 ? 'ROUTER_AUTH_FAILED' : 'ROUTER_UNAVAILABLE',
      );
    if (
      !response.headers.get('content-type')?.includes('text/event-stream') ||
      !response.body
    )
      throw new ProviderExecutionError('ROUTER_PROTOCOL_ERROR');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let outputBytes = 0;
    let wireBytes = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) throw new ProviderExecutionError('STREAM_TRUNCATED');
      wireBytes += next.value.byteLength;
      if (wireBytes > 4 * 1024 * 1024)
        throw new ProviderExecutionError('OUTPUT_LIMIT_EXCEEDED');
      buffer += decoder.decode(next.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (Buffer.byteLength(buffer) > 512 * 1024)
        throw new ProviderExecutionError('ROUTER_PROTOCOL_ERROR');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const event = providerEventSchema.parse(JSON.parse(data));
        if (event.runId !== plan.request.runId)
          throw new ProviderExecutionError('ROUTER_PROTOCOL_ERROR');
        if (event.type === 'content.delta') {
          outputBytes += Buffer.byteLength(event.text);
          if (outputBytes > 262144)
            throw new ProviderExecutionError('OUTPUT_LIMIT_EXCEEDED');
        }
        // Provider messages may contain request content. Only normalized codes cross to the browser.
        if (event.type === 'run.failed')
          event.message = 'Generation could not complete';
        yield event;
        if (event.type === 'run.completed' || event.type === 'run.failed')
          return;
      }
    }
  } catch (error) {
    if (signal.aborted) throw new ProviderExecutionError('CANCELLED');
    if (timeout.signal.aborted)
      throw new ProviderExecutionError('ROUTER_TIMEOUT');
    if (error instanceof ProviderExecutionError) throw error;
    throw new ProviderExecutionError('ROUTER_PROTOCOL_ERROR');
  } finally {
    clearTimeout(timer);
    timeout.abort();
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

@Injectable()
export class AiRouterClient {
  public async health() {
    const value = await this.json('/providers/health');
    return providerHealthSchema.array().parse(value);
  }

  public async route(request: Record<string, unknown>) {
    return routingDecisionSchema.parse(
      await this.json(
        '/routing/decisions',
        routingRequestSchema.parse(request),
      ),
    );
  }

  private async json(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const config = parseApiEnvironment(process.env);
    if (!config.AI_ROUTER_INTERNAL_TOKEN)
      throw new ProviderExecutionError('ROUTER_AUTH_FAILED');
    try {
      const response = await fetch(new URL(path, config.AI_ROUTER_URL), {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${config.AI_ROUTER_INTERNAL_TOKEN}`,
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(
          Math.min(5000, config.AI_ROUTER_TIMEOUT_MS),
        ),
        redirect: 'error',
      });
      if (!response.ok)
        throw new ProviderExecutionError(
          response.status === 401
            ? 'ROUTER_AUTH_FAILED'
            : response.status === 422
              ? 'NO_ELIGIBLE_MODEL'
              : 'ROUTER_UNAVAILABLE',
        );
      const text = await response.text();
      if (text.length > 262144)
        throw new ProviderExecutionError('ROUTER_PROTOCOL_ERROR');
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof ProviderExecutionError) throw error;
      throw new ProviderExecutionError('ROUTER_UNAVAILABLE');
    }
  }

  public stream(
    plan: ProviderExecutionPlan,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const config = parseApiEnvironment(process.env);
    if (
      (config.AI_EXECUTION_PROVIDER !== 'multi' &&
        !externalProviderIds.includes(
          config.AI_EXECUTION_PROVIDER as (typeof externalProviderIds)[number],
        )) ||
      !config.AI_ROUTER_INTERNAL_TOKEN
    )
      throw new ProviderExecutionError('PROVIDER_DISABLED');
    return routerStream(
      plan,
      {
        origin: config.AI_ROUTER_URL,
        token: config.AI_ROUTER_INTERNAL_TOKEN,
        timeoutMs: config.AI_ROUTER_TIMEOUT_MS,
      },
      signal,
    );
  }
}
