import { Module } from '@nestjs/common';

import { PersistenceModule } from '../persistence.module.js';
import { WorkspaceFileController } from '../files/workspace-file.controller.js';
import { WorkspaceFileService } from '../files/workspace-file.service.js';
import { ContextBuilderService } from './context-builder.service.js';
import { ContextController } from './context.controller.js';
import { DeterministicEmbeddingService } from './deterministic-embedding.service.js';
import { SemanticRetrievalService } from './semantic-retrieval.service.js';

@Module({
  imports: [PersistenceModule],
  controllers: [ContextController, WorkspaceFileController],
  providers: [
    ContextBuilderService,
    DeterministicEmbeddingService,
    SemanticRetrievalService,
    WorkspaceFileService,
  ],
  exports: [ContextBuilderService],
})
export class ContextModule {}
