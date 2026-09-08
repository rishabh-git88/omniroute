import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

export function createDatabaseClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: 10,
  });

  return new PrismaClient({ adapter });
}
