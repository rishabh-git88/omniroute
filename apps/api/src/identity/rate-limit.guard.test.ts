import { describe, expect, it, vi } from 'vitest';

import {
  CoordinationService,
  MemoryCoordinationBackend,
} from '../coordination/coordination.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';

function contextFor(url: string) {
  const header = vi.fn();
  return {
    getClass: () => RateLimitGuard,
    getHandler: () => contextFor,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url,
        authentication: {
          user: { id: 'user-a' },
          workspace: { id: 'workspace-a' },
        },
      }),
      getResponse: () => ({ header }),
    }),
    header,
  };
}

describe('RateLimitGuard', () => {
  it('returns a normalized 429 and Retry-After for a protected execution command', async () => {
    const coordination = new CoordinationService(
      new MemoryCoordinationBackend(),
    );
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => false } as never,
      coordination,
    );
    const context = contextFor('/v1/conversations/conversation-a/turns');
    // The configured production/default limit is deliberately not relied on:
    // pre-fill the shared window through the same public primitive.
    for (let count = 0; count < 12; count += 1)
      await coordination.limit({
        key: 'omniroute:v1:rate:execution:workspace-a:user-a',
        limit: 12,
        windowMs: 60_000,
      });

    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 429,
      response: 'RATE_LIMITED',
    });
    expect(context.header).toHaveBeenCalledWith(
      'retry-after',
      expect.any(String),
    );
  });
});
