import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@omniroute/types';

import { Public } from '../identity/public.decorator.js';
import { HealthService } from './health.service.js';

@Public()
@Controller('health')
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  @Get()
  public getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get('live')
  public getLiveness(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get('ready')
  public getReadiness(): Promise<HealthResponse> {
    return this.healthService.getReadiness();
  }
}
