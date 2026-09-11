import { Injectable } from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';
import {
  providerExecutionPlanSchema,
  type CanonicalChatRequest,
  type ProviderEvent,
} from '@omniroute/provider-contracts';
import { PrismaService } from '../database/prisma.service.js';
import { AiRouterClient, ProviderExecutionError } from './ai-router.client.js';
import { MockProvider } from './mock.provider.js';

export function executionProvider():
  'fake' | 'openai' | 'anthropic' | 'gemini' | 'multi' | undefined {
  const mode = parseApiEnvironment(process.env).AI_EXECUTION_PROVIDER;
  return mode === 'mock' ? 'fake' : mode === 'disabled' ? undefined : mode;
}

@Injectable()
export class ExecutionGateway {
  public constructor(
    private readonly database: PrismaService,
    private readonly router: AiRouterClient,
    private readonly mock: MockProvider,
  ) {}

  public async *streamChat(
    request: CanonicalChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    if (signal.aborted) throw new ProviderExecutionError('CANCELLED');
    if (!executionEnabled(request.provider))
      throw new ProviderExecutionError('PROVIDER_DISABLED');
    if (request.provider === 'fake') {
      const cancel = () => {
        void this.mock.cancel(request.runId);
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        yield* this.mock.streamChat(request);
      } catch (error) {
        if (this.mock.isCancellation(error))
          throw new ProviderExecutionError('CANCELLED');
        throw error;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
      return;
    }
    const run = await this.database.client.modelRun.findUniqueOrThrow({
      where: { id: request.runId },
      include: { registryEntry: true, model: true, provider: true },
    });
    if (
      !run.provider.enabled ||
      !run.registryEntry.enabled ||
      run.registryEntry.retiredAt !== null
    )
      throw new ProviderExecutionError('PROVIDER_DISABLED');
    if (
      run.provider.key !== request.provider ||
      run.model.modelKey !== request.modelKey
    )
      throw new ProviderExecutionError('REGISTRY_MISMATCH');
    const plan = providerExecutionPlanSchema.parse({
      request,
      model: {
        provider: run.provider.key,
        providerModelId: run.model.providerModelId,
        registryVersion: run.registryEntry.registryVersion,
        pricingVersion: run.registryEntry.pricingVersion,
        capabilities: run.registryEntry.capabilities,
      },
    });
    yield* this.router.stream(plan, signal);
  }
}

export function executionEnabled(provider: string): boolean {
  const mode = executionProvider();
  return mode === 'multi'
    ? ['openai', 'anthropic', 'gemini'].includes(provider)
    : mode === provider;
}
