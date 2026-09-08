import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { proxy } from './proxy';

describe('authentication proxy', () => {
  it('redirects an anonymous workspace request to login', () => {
    const response = proxy(new NextRequest('http://localhost:3000/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login',
    );
  });

  it('allows a request with the optimistic session cookie', () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: { cookie: `${AUTH_SESSION_COOKIE}=opaque-token` },
    });

    expect(proxy(request).headers.get('location')).toBeNull();
  });
});
