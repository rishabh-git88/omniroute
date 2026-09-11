import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));
vi.mock('pg', () => ({
  Client: class {
    connect = mock.connect;
    query = mock.query;
    end = mock.end;
  },
}));
import {
  INTEGRATION_MARKER,
  verifiedIntegrationUrl,
} from './integration-safety.js';

const url =
  'postgresql://omniroute_integration:test@127.0.0.1:55432/omniroute_integration';
const row = {
  name: 'omniroute_integration',
  role: 'omniroute_integration',
  marker: INTEGRATION_MARKER,
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.query.mockResolvedValue({ rows: [row] });
});
describe('integration server identity attestation', () => {
  it('permits only the recognized disposable database and restricted role', async () => {
    expect(await verifiedIntegrationUrl({ DATABASE_TEST_URL: url })).toBe(url);
    expect(mock.end).toHaveBeenCalledOnce();
  });
  it.each([
    { marker: null },
    { name: 'omniroute' },
    { role: 'postgres' },
    { rolsuper: true },
    { rolcreatedb: true },
    { rolcreaterole: true },
  ])('refuses a mismatched database identity', async (override) => {
    mock.query.mockResolvedValue({ rows: [{ ...row, ...override }] });
    await expect(
      verifiedIntegrationUrl({ DATABASE_TEST_URL: url }),
    ).rejects.toThrow('Refusing integration writes');
    expect(mock.end).toHaveBeenCalledOnce();
  });
  it('refuses unsafe DATABASE_URL before connecting', async () => {
    await expect(
      verifiedIntegrationUrl({
        DATABASE_TEST_URL: url,
        DATABASE_URL: 'postgresql://omniroute:private@localhost/omniroute',
      }),
    ).rejects.toThrow('Refusing');
    expect(mock.connect).not.toHaveBeenCalled();
  });
});
