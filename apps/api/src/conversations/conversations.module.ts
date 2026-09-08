import { Module } from '@nestjs/common';

import { PersistenceModule } from '../persistence.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { ContextModule } from '../context/context.module.js';
import { MockProvider } from '../providers/mock.provider.js';
import {
  ConversationController,
  ConversationStreamController,
} from './conversation.controller.js';
import { ConversationExecutionService } from './conversation-execution.service.js';
import { ConversationService } from './conversation.service.js';
import { StreamEventHub } from './stream-event-hub.js';

@Module({
  imports: [ContextModule, PersistenceModule, UsageModule],
  controllers: [ConversationController, ConversationStreamController],
  providers: [
    ConversationExecutionService,
    ConversationService,
    MockProvider,
    StreamEventHub,
  ],
})
export class ConversationsModule {}
