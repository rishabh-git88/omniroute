import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { verifiedIntegrationUrl } from '../src/database/integration-safety.js';
import {
  verifyMemorySchema,
  verifyMigrationHistory,
} from '../src/database/migration-verification.js';

const url = await verifiedIntegrationUrl(); // Before migrations, generation, or env overrides.
const upgrade = process.argv.includes('--upgrade');
if (
  new URL(url).pathname !==
  (upgrade ? '/omniroute_integration_upgrade' : '/omniroute_integration')
) {
  throw new Error('Select the dedicated database for this verification mode.');
}
process.env.DATABASE_URL = url;
process.env.DATABASE_TEST_URL = url;
process.env.NODE_ENV = 'test';
const migrations = resolve('prisma/migrations');
const client = new Client({ connectionString: url });

function run(tool: 'prisma' | 'vitest', args: string[]) {
  const result = spawnSync(resolve(`node_modules/.bin/${tool}`), args, {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${tool} verification failed (exit ${result.status ?? 'unknown'}).`,
    );
}

await client.connect();
try {
  // Serializes this runner against other release-test runners on this target.
  await client.query('SELECT pg_advisory_lock(73492401)');
  await verifyMigrationHistory(client, migrations, false);
  let config = 'prisma-test.config.ts';
  let memoryId: string | undefined;
  if (upgrade) {
    const exists = await client.query(
      "SELECT to_regclass('public.users') AS existing",
    );
    if (exists.rows[0]?.existing)
      throw new Error(
        'Upgrade rehearsal requires a fresh disposable database; it will not reset existing data.',
      );
    const temporary = await mkdtemp(join(tmpdir(), 'omniroute-migrations-'));
    const staged = join(temporary, 'migrations');
    await cp(
      join(migrations, '202609070001_core_domain'),
      join(staged, '202609070001_core_domain'),
      { recursive: true },
    );
    await cp(
      join(migrations, 'migration_lock.toml'),
      join(staged, 'migration_lock.toml'),
    );
    config = join(temporary, 'prisma.config.mjs');
    // Keep credentials in the environment, never embed them in the temp file.
    await writeFile(
      config,
      `export default { schema: ${JSON.stringify(resolve('prisma/schema.prisma'))}, migrations: { path: ${JSON.stringify(staged)} }, datasource: { url: process.env.DATABASE_TEST_URL } };\n`,
    );
    run('prisma', ['migrate', 'deploy', '--config', config]);
    const user = await client.query(
      "INSERT INTO users(email,updated_at) VALUES ('migration-rehearsal@omniroute.local',now()) RETURNING id",
    );
    const workspace = await client.query(
      "INSERT INTO workspaces(owner_id,name,updated_at) VALUES ($1,'Migration fixture',now()) RETURNING id",
      [user.rows[0].id],
    );
    const memory = await client.query(
      "INSERT INTO memories(workspace_id,kind,content) VALUES ($1,'WORKSPACE_RULE','Preserve this memory through upgrade') RETURNING id",
      [workspace.rows[0].id],
    );
    memoryId = memory.rows[0].id;
    await cp(migrations, staged, { recursive: true });
  }
  run('prisma', ['validate', '--config', 'prisma-generate.config.ts']);
  run('prisma', ['migrate', 'deploy', '--config', config]);
  run('prisma', ['migrate', 'status', '--config', 'prisma-test.config.ts']);
  await verifyMigrationHistory(client, migrations);
  await verifyMemorySchema(client);
  run('prisma', [
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema.prisma',
    '--exit-code',
    '--config',
    'prisma-test.config.ts',
  ]);
  if (memoryId) {
    const memory = await client.query(
      'SELECT content, source_hash FROM memories WHERE id=$1',
      [memoryId],
    );
    if (
      memory.rows[0]?.content !== 'Preserve this memory through upgrade' ||
      memory.rows[0]?.source_hash !== null
    )
      throw new Error('Upgrade failed to preserve the core-schema fixture.');
    console.log('Core-to-memory upgrade verified with retained fixture data.');
  } else {
    run('prisma', ['generate', '--config', 'prisma-generate.config.ts']);
    // Every integration file targets the same guarded disposable database and
    // some intentionally TRUNCATE fixture tables. Keep this command-level so
    // the release gate remains serial even if Vitest config defaults change.
    run('vitest', [
      'run',
      '--config',
      'vitest.integration.config.ts',
      '--no-file-parallelism',
      '--maxWorkers=1',
      '--maxConcurrency=1',
      '--pool=forks',
    ]);
  }
} finally {
  await client.end();
}
