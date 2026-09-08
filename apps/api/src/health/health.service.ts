import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@omniroute/types';

import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class HealthService {
  public constructor(private readonly database: PrismaService) {}

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
      return this.getHealth();
    } catch {
      throw new ServiceUnavailableException('Database is not ready');
    }
  }
}
