import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';

import { PrismaClient } from '../generated/prisma/client.js';
import { createDatabaseClient } from './database-client.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  public readonly client: PrismaClient;

  public constructor() {
    const environment = parseApiEnvironment(process.env);
    this.client = createDatabaseClient(environment.DATABASE_URL);
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
