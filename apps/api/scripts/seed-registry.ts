import { readFile } from 'node:fs/promises';
import { parseRegistrySeed } from '@omniroute/config/registry-seed';
import { createDatabaseClient } from '../src/database/database-client.js';
import { developmentDatabaseUrl } from '../src/database/development-safety.js';
import { seedProviderRegistry } from '../src/database/provider-seed.js';

const models = process.env.MODEL_REGISTRY_SEED_FILE
  ? parseRegistrySeed(
      JSON.parse(await readFile(process.env.MODEL_REGISTRY_SEED_FILE, 'utf8')),
    )
  : [];
const database = createDatabaseClient(developmentDatabaseUrl(process.env));
try {
  await seedProviderRegistry(database, models);
  console.log(
    `Canonical provider metadata aligned; ${models.length} reviewed model snapshots processed. No providers enabled.`,
  );
} finally {
  await database.$disconnect();
}
