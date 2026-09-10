import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy } from './proxy';

describe('authentication proxy', () => {
  it.each(['/', '/login', '/api/health', '/icon.svg', '/favicon.ico'])(
    'allows public route %s',
    (path) => {
      const response = proxy(new NextRequest(`http://localhost:3000${path}`));

      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('redirects an anonymous chat request to login', () => {
    const response = proxy(
      new NextRequest('http://localhost:3000/chat/conversation-id'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login',
    );
  });

  it('allows a request with the optimistic session cookie', () => {
    const request = new NextRequest(
      'http://localhost:3000/chat/conversation-id',
      {
        headers: { cookie: `${AUTH_SESSION_COOKIE}=opaque-token` },
      },
    );

    expect(proxy(request).headers.get('location')).toBeNull();
  });
});
