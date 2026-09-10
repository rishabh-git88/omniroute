import { describe, expect, it } from 'vitest';

import { parseWebEnvironment } from './web.js';

describe('web environment', () => {
  it('uses localhost only outside production', () => {
    expect(parseWebEnvironment({}).NEXT_PUBLIC_API_URL).toBe(
      'http://localhost:4000',
    );
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
