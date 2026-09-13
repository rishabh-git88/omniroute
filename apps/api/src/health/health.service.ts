import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@omniroute/types';

import { PrismaService } from '../database/prisma.service.js';
import { CoordinationService } from '../coordination/coordination.service.js';

@Injectable()
export class HealthService {
  public constructor(
    private readonly database: PrismaService,
    private readonly coordination: CoordinationService,
  ) {}

  public getHealth(): HealthResponse {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    };
  }

  /** Readiness is deliberately dependency-aware; liveness is process-only. */
  public async getReadiness(): Promise<HealthResponse> {
    try {
      await this.database.client.$queryRaw`SELECT 1`;
      // Redis protects cross-replica writes but does not own history or money.
      // A temporary outage therefore leaves read-only/durable recovery traffic
      // serviceable while the rate guard safely rejects new cost-bearing work.
      await this.coordination.available();
      return this.getHealth();
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }
  }
}
