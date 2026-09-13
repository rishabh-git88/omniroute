import { Module } from '@nestjs/common';

import { PersistenceModule } from '../persistence.module.js';
import { WorkspaceFileController } from '../files/workspace-file.controller.js';
import { WorkspaceFileService } from '../files/workspace-file.service.js';
import { ContextBuilderService } from './context-builder.service.js';
import { ContextController } from './context.controller.js';
import { DeterministicEmbeddingService } from './deterministic-embedding.service.js';
import {
  DisabledEmbeddingService,
  EMBEDDING_SERVICE,
} from './embedding.service.js';
import { SemanticRetrievalService } from './semantic-retrieval.service.js';
import {
  OBJECT_STORAGE,
  objectStorageFromEnvironment,
} from '../files/object-storage.js';
import { TextLayerExtractor } from '../files/text-extractor.js';
import { parseApiEnvironment } from '@omniroute/config/api';
import { ObservabilityModule } from '../observability/observability.module.js';

@Module({
  imports: [ObservabilityModule, PersistenceModule],
  controllers: [ContextController, WorkspaceFileController],
  providers: [
    ContextBuilderService,
    DeterministicEmbeddingService,
    DisabledEmbeddingService,
    {
      provide: EMBEDDING_SERVICE,
      inject: [DeterministicEmbeddingService, DisabledEmbeddingService],
      useFactory: (
        deterministic: DeterministicEmbeddingService,
        disabled: DisabledEmbeddingService,
      ) =>
        parseApiEnvironment(process.env).EMBEDDING_PROVIDER === 'deterministic'
          ? deterministic
          : disabled,
    },
    { provide: OBJECT_STORAGE, useFactory: objectStorageFromEnvironment },
    SemanticRetrievalService,
    TextLayerExtractor,
    WorkspaceFileService,
  ],
  exports: [ContextBuilderService],
})
export class ContextModule {}
