import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@omniroute/types';

@Injectable()
export class HealthService {
  public getHealth(): HealthResponse {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    };
  }
}
