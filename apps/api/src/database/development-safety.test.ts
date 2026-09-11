import { describe, expect, it } from 'vitest';
import { developmentDatabaseUrl } from './development-safety.js';

const local = 'postgresql://omniroute:synthetic@127.0.0.1:5432/omniroute';
describe('development seed target protection', () => {
  it('allows the recognized local development target', () => {
    expect(developmentDatabaseUrl({ DATABASE_URL: local })).toBe(local);
  });
  it.each([
    undefined,
    'invalid',
    local.replace(/\/omniroute$/, '/production'),
    local.replace(/\/omniroute$/, '/omniroute_integration'),
    local.replace('127.0.0.1', 'database.example.invalid'),
    local.replace('omniroute:', 'postgres:'),
    `${local}?host=database.example.invalid`,
  ])('refuses unrecognized targets (case %#)', (value) => {
    expect(() => developmentDatabaseUrl({ DATABASE_URL: value })).toThrow();
  });
  it('refuses production mode even for a loopback URL', () => {
    expect(() =>
      developmentDatabaseUrl({ DATABASE_URL: local, NODE_ENV: 'production' }),
    ).toThrow();
  });
});
