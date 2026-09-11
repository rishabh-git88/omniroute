import { defineConfig } from 'prisma/config';
import { integrationDatabaseUrl } from './src/database/integration-safety.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: integrationDatabaseUrl(process.env),
  },
});
