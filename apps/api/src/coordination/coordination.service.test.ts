import { describe, expect, it } from 'vitest';

import {
  CoordinationService,
  MemoryCoordinationBackend,
} from './coordination.service.js';
import { ProviderCircuitService } from './provider-circuit.service.js';

describe('shared coordination primitives', () => {
  it('enforces a bounded distributed limit and returns retry information', async () => {
    const backend = new MemoryCoordinationBackend();
    const first = new CoordinationService(backend);
    const second = new CoordinationService(backend);
    expect(
      await first.limit({
        key: 'omniroute:v1:rate:execution:user',
        limit: 1,
        windowMs: 10_000,
      }),
    ).toMatchObject({ allowed: true });
    await expect(
      second.limit({
        key: 'omniroute:v1:rate:execution:user',
        limit: 1,
        windowMs: 10_000,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('excludes duplicate run ownership and releases only its own lease', async () => {
    const backend = new MemoryCoordinationBackend();
    const first = new CoordinationService(backend);
    const second = new CoordinationService(backend);
    const lease = await first.acquireLease('run-a', 10_000);
    expect(lease).not.toBeNull();
    expect(await second.acquireLease('run-a', 10_000)).toBeNull();
    await first.releaseLease(lease!);
    expect(await second.acquireLease('run-a', 10_000)).not.toBeNull();
  });

  it('opens a transient provider circuit across service instances', async () => {
    const backend = new MemoryCoordinationBackend();
    const first = new ProviderCircuitService(new CoordinationService(backend));
    const second = new ProviderCircuitService(new CoordinationService(backend));
    for (let index = 0; index < 3; index += 1)
      await first.recordFailure('groq', 'reviewed-model', 'PROVIDER_TIMEOUT');
    expect(await second.allow('groq', 'reviewed-model')).toBe(false);
    await second.recordSuccess('groq', 'reviewed-model');
    expect(await first.allow('groq', 'reviewed-model')).toBe(true);
  });
});
