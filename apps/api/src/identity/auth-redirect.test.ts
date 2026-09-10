import { describe, expect, it, vi } from 'vitest';
import { parseAuthEnvironment } from '@omniroute/config/api';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { GoogleOAuthClient } from './google-oauth.client.js';

const environment = parseAuthEnvironment({
  NODE_ENV: 'production',
  API_PUBLIC_URL: 'https://api.example.com',
  WEB_APP_URL: 'https://app.example.com',
  AUTH_COOKIE_DOMAIN: 'example.com',
  AUTH_SESSION_SECRET: 'test-only-secret-at-least-32-characters',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
});
const google = {
  createAuthorizationUrl: vi.fn(() => 'https://accounts.google.com/test'),
};
const auth = new AuthService(
  environment,
  {} as AuthRepository,
  google as unknown as GoogleOAuthClient,
);

describe('OAuth return path', () => {
  it('uses the configured API origin for the Google callback URI', () => {
    const client = new GoogleOAuthClient(environment);
    const url = new URL(
      client.createAuthorizationUrl({
        codeChallenge: 'challenge',
        nonce: 'nonce',
        state: 'state',
      }),
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/v1/auth/google/callback',
    );
  });
  it.each([
    undefined,
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    'https://evil.example',
    '\\evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
  ])('rejects redirect escape %j both at start and callback', (value) => {
    expect(auth.startGoogleSignIn(value).returnTo).toBe('/');
    expect(auth.callbackRedirect(value)).toBe('https://app.example.com/');
  });
  it('preserves local paths, queries, and fragments', () => {
    const value = '/chat/thread?view=all#answer';
    expect(auth.startGoogleSignIn(value).returnTo).toBe(value);
    expect(auth.callbackRedirect(value)).toBe(
      `https://app.example.com${value}`,
    );
  });
  it.each(['/%2f%2fevil.example', '/%5cevil.example', '/safe/../chat'])(
    'resolves encoded/normalized paths without changing origin: %s',
    (value) => {
      expect(new URL(auth.callbackRedirect(value)).origin).toBe(
        environment.WEB_APP_URL,
      );
    },
  );
});
