import { describe, expect, it } from 'vitest';

import { EnvironmentValidationError, parseApiEnvironment } from './api.js';

describe('parseApiEnvironment', () => {
  it('provides safe local defaults', () => {
    const environment = parseApiEnvironment({});

    expect(environment.API_PORT).toBe(4000);
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
