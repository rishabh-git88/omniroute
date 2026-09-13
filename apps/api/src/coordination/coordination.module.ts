import { Global, Module } from '@nestjs/common';

import { CoordinationService } from './coordination.service.js';
import { ProviderCircuitService } from './provider-circuit.service.js';

@Global()
@Module({
  providers: [CoordinationService, ProviderCircuitService],
  exports: [CoordinationService, ProviderCircuitService],
})
export class CoordinationModule {}
