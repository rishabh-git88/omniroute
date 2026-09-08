import { Module } from '@nestjs/common';

import { FeedbackRepository } from './analytics/feedback.repository.js';
import { PrismaConversationRepository } from './conversations/conversation.repository.js';
import { MemoryRepository } from './context/memory.repository.js';
import { DatabaseModule } from './database/database.module.js';
import { WorkspaceFileRepository } from './files/workspace-file.repository.js';
import { PrismaUserRepository } from './identity/user.repository.js';
import { PrismaModelRegistryRepository } from './model-registry/model-registry.repository.js';
import { CreditLedgerRepository } from './usage/credit-ledger.repository.js';
import { UsageRepository } from './usage/usage.repository.js';

const repositories = [
  CreditLedgerRepository,
  FeedbackRepository,
  MemoryRepository,
  PrismaConversationRepository,
  PrismaModelRegistryRepository,
  PrismaUserRepository,
  UsageRepository,
  WorkspaceFileRepository,
];

@Module({
  imports: [DatabaseModule],
  providers: repositories,
  exports: repositories,
})
export class PersistenceModule {}
