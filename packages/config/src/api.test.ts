import { describe, expect, it } from 'vitest';

import {
  EnvironmentValidationError,
  parseApiEnvironment,
  parseAuthEnvironment,
} from './api.js';

describe('parseApiEnvironment', () => {
  it('provides safe local defaults', () => {
    const environment = parseApiEnvironment({});

    expect(environment.API_PORT).toBe(4000);
    expect(environment.LOG_LEVEL).toBe('info');
    expect(environment.NODE_ENV).toBe('development');
  });

  it('reports invalid keys without including their values', () => {
    expect(() =>
      parseApiEnvironment({
        API_PORT: 'not-a-port',
        DATABASE_URL: 'sensitive',
      }),
    ).toThrow(EnvironmentValidationError);

    try {
      parseApiEnvironment({
        API_PORT: 'not-a-port',
        DATABASE_URL: 'sensitive',
      });
    } catch (error) {
      expect(String(error)).not.toContain('sensitive');
    }
  });
});

describe('parseAuthEnvironment', () => {
  const validEnvironment = {
    API_PUBLIC_URL: 'http://localhost:4000',
    AUTH_SESSION_SECRET: 'a-secure-test-secret-with-32-characters',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    WEB_APP_URL: 'http://localhost:3000',
  };

  it('requires server-only OAuth and session settings', () => {
    expect(() => parseAuthEnvironment({})).toThrow(
      new EnvironmentValidationError([
        'API_PUBLIC_URL',
        'AUTH_SESSION_SECRET',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'WEB_APP_URL',
      ]),
    );
    expect(parseAuthEnvironment(validEnvironment).AUTH_SESSION_TTL_HOURS).toBe(
      24,
    );
  });

  it('requires HTTPS origins in production', () => {
    expect(() =>
      parseAuthEnvironment({ ...validEnvironment, NODE_ENV: 'production' }),
    ).toThrow(EnvironmentValidationError);
  });

  const sameOriginProduction = {
    ...validEnvironment,
    NODE_ENV: 'production',
    API_PUBLIC_URL: 'https://oneroute-ai.vercel.app',
    WEB_APP_URL: 'https://oneroute-ai.vercel.app',
  };

  it('accepts the Vercel same-origin proxy deployment with host-only cookies', () => {
    expect(
      parseAuthEnvironment(sameOriginProduction).AUTH_COOKIE_DOMAIN,
    ).toBeUndefined();
  });

  it('accepts and normalizes an optional custom cookie domain', () => {
    expect(
      parseAuthEnvironment({
        ...sameOriginProduction,
        API_PUBLIC_URL: 'https://api.example.com',
        WEB_APP_URL: 'https://app.example.com',
        AUTH_COOKIE_DOMAIN: '.example.com',
      }).AUTH_COOKIE_DOMAIN,
    ).toBe('example.com');
    expect(
      parseAuthEnvironment({
        ...sameOriginProduction,
        API_PUBLIC_URL: 'https://api.example.co.uk',
        WEB_APP_URL: 'https://app.example.co.uk',
        AUTH_COOKIE_DOMAIN: 'example.co.uk',
      }).AUTH_COOKIE_DOMAIN,
    ).toBe('example.co.uk');
  });

  it.each([
    { AUTH_COOKIE_DOMAIN: 'com' },
    { AUTH_COOKIE_DOMAIN: 'unrelated.com' },
    { AUTH_COOKIE_DOMAIN: 'https://example.com' },
    { WEB_APP_URL: 'http://oneroute-ai.vercel.app' },
    { API_PUBLIC_URL: 'https://api.example.com/v1' },
    { WEB_APP_URL: 'https://app.example.com?private=value' },
    { API_PUBLIC_URL: 'https://localhost' },
    { API_PUBLIC_URL: 'http://oneroute-ai.vercel.app' },
    { API_PUBLIC_URL: 'https://other.example.com' },
  ])(
    'rejects invalid production authentication configuration %j',
    (override) => {
      expect(() =>
        parseAuthEnvironment({ ...sameOriginProduction, ...override }),
      ).toThrow(EnvironmentValidationError);
    },
  );
});
