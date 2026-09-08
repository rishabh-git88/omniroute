import { Injectable } from '@nestjs/common';

import type { ProviderRegistryEntry } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface RegisteredModel extends ProviderRegistryEntry {
  model: { displayName: string; modelKey: string; providerModelId: string };
  provider: { displayName: string; key: string };
}

export interface ModelRegistryRepository {
  findEnabled(): Promise<RegisteredModel[]>;
  findVersion(
    modelKey: string,
    registryVersion: number,
  ): Promise<RegisteredModel | null>;
}

@Injectable()
export class PrismaModelRegistryRepository implements ModelRegistryRepository {
  public constructor(private readonly database: PrismaService) {}

  public findEnabled(): Promise<RegisteredModel[]> {
    return this.database.client.providerRegistryEntry.findMany({
      where: {
        enabled: true,
        retiredAt: null,
        provider: { enabled: true },
      },
      include: {
        model: {
          select: { displayName: true, modelKey: true, providerModelId: true },
        },
        provider: { select: { displayName: true, key: true } },
      },
      orderBy: [{ provider: { key: 'asc' } }, { model: { modelKey: 'asc' } }],
    });
  }

  public findVersion(
    modelKey: string,
    registryVersion: number,
  ): Promise<RegisteredModel | null> {
    return this.database.client.providerRegistryEntry.findFirst({
      where: { model: { modelKey }, registryVersion },
      include: {
        model: {
          select: { displayName: true, modelKey: true, providerModelId: true },
        },
        provider: { select: { displayName: true, key: true } },
      },
    });
  }
}
