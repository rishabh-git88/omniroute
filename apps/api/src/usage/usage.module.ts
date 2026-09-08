import { Module } from '@nestjs/common';

import { PersistenceModule } from '../persistence.module.js';
import { CreditBillingService } from './credit-billing.service.js';
import { UsageController } from './usage.controller.js';

@Module({
  imports: [PersistenceModule],
  controllers: [UsageController],
  providers: [CreditBillingService],
  exports: [CreditBillingService],
})
export class UsageModule {}
