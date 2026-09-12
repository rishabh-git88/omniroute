import { readFile } from 'node:fs/promises';
import {
  parseRegistrySeed,
  validateRoutingRegistry,
} from '@omniroute/config/registry-seed';
import { createDatabaseClient } from '../src/database/database-client.js';
import { seedProviderRegistry } from '../src/database/provider-seed.js';

const confirmation = 'approve-reviewed-registry-import';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (process.env.MODEL_REGISTRY_ADMIN_CONFIRM !== confirmation)
  throw new Error(
    'Refusing registry administration without MODEL_REGISTRY_ADMIN_CONFIRM.',
  );

const models = parseRegistrySeed(
  JSON.parse(await readFile(required('MODEL_REGISTRY_SEED_FILE'), 'utf8')),
);
const database = createDatabaseClient(required('DATABASE_URL'));

try {
  await seedProviderRegistry(database, models);
  if (process.env.MODEL_REGISTRY_ACTIVATE !== 'true') {
    console.log(
      `Imported ${models.length} reviewed registry snapshots disabled; no provider was enabled.`,
    );
  } else {
    for (const model of models) {
      validateRoutingRegistry(model);
      const provider = await database.provider.findUniqueOrThrow({
        where: { key: model.provider },
      });
      const entry = await database.providerRegistryEntry.findFirstOrThrow({
        where: {
          providerId: provider.id,
          registryVersion: model.registryVersion,
          model: { modelKey: model.modelKey },
        },
      });
      await database.$transaction([
        database.provider.update({
          where: { id: provider.id },
          data: { enabled: true },
        }),
        database.providerRegistryEntry.update({
          where: { id: entry.id },
          data: { enabled: true, rolloutState: 'GENERAL' },
        }),
      ]);
    }
    console.log(
      `Imported and activated ${models.length} reviewed registry snapshots.`,
    );
  }
} finally {
  await database.$disconnect();
}
