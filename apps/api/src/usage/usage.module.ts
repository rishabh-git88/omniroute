import { Module } from '@nestjs/common';

import { PersistenceModule } from '../persistence.module.js';
import { CreditBillingService } from './credit-billing.service.js';
import { UsageController } from './usage.controller.js';
import { CreditReconciliationService } from './credit-reconciliation.service.js';

@Module({
  imports: [PersistenceModule],
  controllers: [UsageController],
  providers: [CreditBillingService, CreditReconciliationService],
  exports: [CreditBillingService, CreditReconciliationService],
})
export class UsageModule {}
