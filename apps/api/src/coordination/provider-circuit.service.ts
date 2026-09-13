import { Injectable } from '@nestjs/common';

import { CoordinationService } from './coordination.service.js';

type Circuit = {
  failures: number;
  lastFailure?: string;
  state: 'CLOSED' | 'OPEN';
};

const TRANSIENT_FAILURES = new Set([
  'NETWORK_ERROR',
  'PROVIDER_TEMPORARY_ERROR',
  'PROVIDER_TIMEOUT',
  'RATE_LIMITED',
  'ROUTER_TIMEOUT',
  'ROUTER_UNAVAILABLE',
]);

@Injectable()
export class ProviderCircuitService {
  public constructor(private readonly coordination: CoordinationService) {}

  public async allow(provider: string, modelKey: string): Promise<boolean> {
    const value = await this.coordination.get(this.key(provider, modelKey));
    if (!value) return true;
    try {
      return (JSON.parse(value) as Circuit).state !== 'OPEN';
    } catch {
      return true;
    }
  }

  public async recordSuccess(
    provider: string,
    modelKey: string,
  ): Promise<void> {
    await this.coordination.set(
      this.key(provider, modelKey),
      JSON.stringify({
        failures: 0,
        state: 'CLOSED' satisfies Circuit['state'],
      }),
      60_000,
    );
  }

  public async recordFailure(
    provider: string,
    modelKey: string,
    code: string,
  ): Promise<void> {
    if (!TRANSIENT_FAILURES.has(code)) return;
    const key = this.key(provider, modelKey);
    const previous = await this.coordination.get(key);
    let failures = 0;
    try {
      failures = (JSON.parse(previous ?? '{}') as Circuit).failures ?? 0;
    } catch {
      // A malformed or expired ephemeral value must not permanently deny a model.
    }
    failures += 1;
    const state: Circuit['state'] = failures >= 3 ? 'OPEN' : 'CLOSED';
    await this.coordination.set(
      key,
      JSON.stringify({ failures, lastFailure: code, state } satisfies Circuit),
      state === 'OPEN' ? 30_000 : 60_000,
    );
  }

  private key(provider: string, modelKey: string): string {
    return `omniroute:v1:provider-circuit:${provider}:${modelKey}`;
  }
}
