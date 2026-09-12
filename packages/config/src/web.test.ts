import { describe, expect, it } from 'vitest';

import { parseWebEnvironment } from './web.js';

describe('web environment', () => {
  it('uses localhost only outside production', () => {
    expect(
      parseWebEnvironment({ NODE_ENV: 'development' }).NEXT_PUBLIC_API_URL,
    ).toBe('http://localhost:4000');
  });

  it('does not guess development when NODE_ENV is absent', () => {
    expect(() => parseWebEnvironment({})).toThrow('NEXT_PUBLIC_API_URL');
  });

  it.each([
    '',
    'http://api.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://127.1',
    'https://[::1]',
    'https://api.localhost',
    'https://0.0.0.0',
    'https://api.example.com/v1',
    'https://user:private@api.example.com',
    'https://api.example.com?x=1',
    'https://api.example.com#fragment',
  ])('rejects unsafe production API origin %s', (NEXT_PUBLIC_API_URL) => {
    expect(() =>
      parseWebEnvironment({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL }),
    ).toThrow('NEXT_PUBLIC_API_URL');
  });

  it('normalizes the configured origin without adding /v1', () => {
    expect(
      parseWebEnvironment({
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: 'https://api.example.com/',
      }).NEXT_PUBLIC_API_URL,
    ).toBe('https://api.example.com');
  });

  it('accepts the Vercel same-origin production URL without adding /v1', () => {
    expect(
      parseWebEnvironment({
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: 'https://oneroute-ai.vercel.app',
      }).NEXT_PUBLIC_API_URL,
    ).toBe('https://oneroute-ai.vercel.app');
  });

  it('honors an explicit development origin and rejects invalid values', () => {
    expect(
      parseWebEnvironment({
        NODE_ENV: 'development',
        NEXT_PUBLIC_API_URL: 'http://127.0.0.1:5000/',
      }).NEXT_PUBLIC_API_URL,
    ).toBe('http://127.0.0.1:5000');
    expect(() =>
      parseWebEnvironment({ NODE_ENV: 'development', NEXT_PUBLIC_API_URL: '' }),
    ).toThrow();
  });

  it('requires an explicit public API URL in production', () => {
    expect(() => parseWebEnvironment({ NODE_ENV: 'production' })).toThrow();
  });

  it('accepts an HTTPS API URL', () => {
    expect(
      parseWebEnvironment({
        NEXT_PUBLIC_API_URL: 'https://api.example.com',
      }).NEXT_PUBLIC_API_URL,
    ).toBe('https://api.example.com');
  });
});
