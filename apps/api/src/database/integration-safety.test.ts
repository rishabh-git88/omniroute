import { describe, expect, it } from 'vitest';
import { integrationDatabaseUrl } from './integration-safety.js';

const safe =
  'postgresql://omniroute_integration:integration-only@127.0.0.1:55432/omniroute_integration';
describe('integration database safety', () => {
  it('accepts the explicitly isolated target', () => {
    expect(
      integrationDatabaseUrl({
        NODE_ENV: 'test',
        DATABASE_TEST_URL: safe,
        DATABASE_URL: safe,
      }),
    ).toBe(safe);
  });
  it.each([
    undefined,
    '',
    'invalid-private-value',
    'postgresql://omniroute:private@localhost/omniroute',
    'postgresql://omniroute_integration:private@localhost/production',
    'postgresql://omniroute_integration:private@localhost/omniroute_test',
    'postgresql://omniroute_integration:private@db.example.com/omniroute_integration',
    `${safe}?host=production`,
    `${safe}#fragment`,
    safe.replace('/omniroute_integration', '/unknown'),
    safe.replace('omniroute_integration:', 'postgres:'),
  ])('refuses unsafe test URL without printing it (case %#)', (url) => {
    expect(() => integrationDatabaseUrl({ DATABASE_TEST_URL: url })).toThrow(
      'Refusing',
    );
    try {
      integrationDatabaseUrl({ DATABASE_TEST_URL: url });
    } catch (error) {
      expect(String(error)).not.toContain('private');
    }
  });
  it.each(['omniroute', 'production', 'unrecognized'])(
    'refuses DATABASE_URL=%s even when DATABASE_TEST_URL is safe',
    (name) => {
      expect(() =>
        integrationDatabaseUrl({
          DATABASE_TEST_URL: safe,
          DATABASE_URL: `postgresql://omniroute_integration:private@localhost/${name}`,
        }),
      ).toThrow('Refusing');
    },
  );
  it('refuses a different recognized target and production mode', () => {
    expect(() =>
      integrationDatabaseUrl({
        DATABASE_TEST_URL: safe,
        DATABASE_URL: `${safe}_upgrade`,
      }),
    ).toThrow('same isolated target');
    expect(() =>
      integrationDatabaseUrl({
        DATABASE_TEST_URL: safe,
        NODE_ENV: 'production',
      }),
    ).toThrow('Refusing');
  });
});
