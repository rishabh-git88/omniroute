import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { ContextModule } from './context/context.module.js';
import { AuthModule } from './identity/auth.module.js';
import { PersistenceModule } from './persistence.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { UsageModule } from './usage/usage.module.js';
import { CoordinationModule } from './coordination/coordination.module.js';

@Module({
  imports: [
    AuthModule,
    CoordinationModule,
    ContextModule,
    ConversationsModule,
    ObservabilityModule,
    PersistenceModule,
    UsageModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
