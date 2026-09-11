import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyMigrationHistory } from './migration-verification.js';

let directory: string;
const name = '202609070001_core_domain';
const sql = 'SELECT 1;';
const applied = {
  migration_name: name,
  checksum: createHash('sha256').update(sql).digest('hex'),
  finished_at: new Date(),
  rolled_back_at: null,
};
function client(rows: unknown[]) {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ table_name: '_prisma_migrations' }] })
      .mockResolvedValueOnce({ rows }),
  } as unknown as Client;
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'omniroute-history-test-'));
  await mkdir(join(directory, name));
  await writeFile(join(directory, name, 'migration.sql'), sql);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe('migration history verification', () => {
  it('accepts the exact applied migration bytes', async () => {
    await expect(
      verifyMigrationHistory(client([applied]), directory),
    ).resolves.toBeUndefined();
  });
  it('refuses changed applied SQL', async () => {
    await writeFile(join(directory, name, 'migration.sql'), 'SELECT 2;');
    await expect(
      verifyMigrationHistory(client([applied]), directory),
    ).rejects.toThrow('checksum');
  });
  it.each([{ migration_name: 'unknown' }, { finished_at: null }])(
    'refuses unknown or failed history',
    async (override) => {
      await expect(
        verifyMigrationHistory(
          client([{ ...applied, ...override }]),
          directory,
        ),
      ).rejects.toThrow('unknown or failed');
    },
  );
  it('requires every migration after deployment, including a rolled-back migration', async () => {
    await expect(verifyMigrationHistory(client([]), directory)).rejects.toThrow(
      'not all',
    );
    await expect(
      verifyMigrationHistory(
        client([{ ...applied, rolled_back_at: new Date() }]),
        directory,
      ),
    ).rejects.toThrow('not all');
    await expect(
      verifyMigrationHistory(client([]), directory, false),
    ).resolves.toBeUndefined();
  });
});
