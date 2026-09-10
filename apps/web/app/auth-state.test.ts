import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TIMEOUT_MS, loadAuthState } from './auth-state';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('session availability', () => {
  it('treats only HTTP 401 as logged out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    expect((await loadAuthState()).status).toBe('anonymous');
  });
  it.each([403, 429, 500, 503])(
    'distinguishes HTTP %i from logged out',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(null, { status })),
      );
      expect((await loadAuthState()).status).toBe('unavailable');
    },
  );
  it('distinguishes a network outage from logged out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    expect((await loadAuthState()).status).toBe('unavailable');
  });
  it('bounds a hung session request and allows a later retry', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const pending = loadAuthState();
    await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS);
    expect((await pending).status).toBe('unavailable');
    fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await loadAuthState()).status).toBe('anonymous');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves a valid authenticated session and includes credentials', async () => {
    const session = {
      user: { id: 'user', name: 'User', email: 'user@example.com' },
      workspace: { id: 'workspace', name: 'Personal' },
      csrfToken: 'csrf-test',
    };
    const fetcher = vi.fn().mockResolvedValue(Response.json(session));
    vi.stubGlobal('fetch', fetcher);
    expect(await loadAuthState()).toEqual({ status: 'authenticated', session });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/auth\/me$/),
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });
  it.each(['not JSON', '{}'])(
    'does not call a malformed successful response a session',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      expect((await loadAuthState()).status).toBe('unavailable');
    },
  );
});
