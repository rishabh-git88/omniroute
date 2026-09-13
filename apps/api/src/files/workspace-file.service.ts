import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { parseApiEnvironment } from '@omniroute/config/api';
import {
  FileProcessingStatus,
  FileScanStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { chunkText, CHUNKER_VERSION } from '../context/text-chunker.js';
import { SemanticRetrievalService } from '../context/semantic-retrieval.service.js';
import { WorkspaceFileRepository } from './workspace-file.repository.js';
import {
  decodeBase64,
  type FileLimits,
  validateFileMetadata,
} from './file-policy.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import {
  EXTRACTOR_VERSION,
  FileExtractionError,
  TextLayerExtractor,
} from './text-extractor.js';
import { MetricsService } from '../observability/metrics.service.js';

@Injectable()
export class WorkspaceFileService {
  public constructor(
    private readonly database: PrismaService,
    private readonly files: WorkspaceFileRepository,
    private readonly retrieval: SemanticRetrievalService,
    private readonly extractor: TextLayerExtractor,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly metrics: MetricsService,
  ) {}
  public async upload(
    workspaceId: string,
    input: { dataBase64: string; mime?: string; originalName: string },
  ) {
    const limits = this.limits();
    const bytes = decodeBase64(input.dataBase64, limits.maxBytes);
    const metadata = validateFileMetadata(
      {
        mime: input.mime,
        originalName: input.originalName,
        size: bytes.length,
      },
      limits,
    );
    const id = randomUUID();
    const objectKey = 'workspace/' + workspaceId + '/files/' + id + '/source';
    await this.storage.put({
      body: bytes,
      contentType: metadata.mime,
      key: objectKey,
    });
    this.metrics.recordFileEvent('uploaded', bytes.length);
    try {
      const file = await this.files.create({
        id,
        workspaceId,
        objectKey,
        originalName: metadata.originalName,
        mime: metadata.mime,
        size: BigInt(bytes.length),
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      });
      return this.process(workspaceId, file.id);
    } catch (error) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }
  public async list(workspaceId: string) {
    return (await this.files.list(workspaceId)).map((file) =>
      this.publicMetadata(file),
    );
  }
  public async retry(workspaceId: string, fileId: string) {
    const file = await this.requireFile(workspaceId, fileId);
    if (file.processingStatus === FileProcessingStatus.READY)
      return this.publicMetadata(file);
    return this.process(workspaceId, file.id);
  }
  public async delete(workspaceId: string, fileId: string): Promise<void> {
    const file = await this.requireFile(workspaceId, fileId);
    await this.database.client.$transaction(async (transaction) => {
      await transaction.embedding.deleteMany({
        where: { fileChunk: { fileId } },
      });
      await transaction.fileChunk.deleteMany({ where: { fileId } });
      await transaction.workspaceFile.update({
        where: { id: file.id },
        data: {
          deletedAt: new Date(),
          processingStatus: FileProcessingStatus.DELETED,
        },
      });
    });
    await this.storage.delete(file.objectKey).catch(() => undefined);
    this.metrics.recordFileEvent('deleted');
  }
  /** Marks abandoned work retryable; an operator invokes this in bounded batches. */
  public async recoverStaleProcessing(batchSize = 100): Promise<number> {
    const environment = parseApiEnvironment(process.env);
    const stale = await this.database.client.workspaceFile.findMany({
      where: {
        deletedAt: null,
        processingStatus: FileProcessingStatus.PROCESSING,
        processingStartedAt: {
          lt: new Date(Date.now() - environment.FILES_STALE_PROCESSING_MS),
        },
      },
      select: { id: true },
      orderBy: { processingStartedAt: 'asc' },
      take: Math.min(Math.max(Math.floor(batchSize), 1), 200),
    });
    if (!stale.length) return 0;
    const result = await this.database.client.workspaceFile.updateMany({
      where: {
        id: { in: stale.map((file) => file.id) },
        processingStatus: FileProcessingStatus.PROCESSING,
      },
      data: {
        processingErrorCode: 'FILE_PROCESSING_INTERRUPTED',
        processingStatus: FileProcessingStatus.FAILED,
      },
    });
    for (let index = 0; index < result.count; index += 1)
      this.metrics.recordFileEvent('failed');
    return result.count;
  }
  private async process(workspaceId: string, fileId: string) {
    const file = await this.requireFile(workspaceId, fileId);
    if (file.processingStatus === FileProcessingStatus.READY)
      return this.publicMetadata(file);
    const claimed = await this.database.client.workspaceFile.updateMany({
      where: {
        id: file.id,
        processingStatus: {
          in: [FileProcessingStatus.PENDING, FileProcessingStatus.FAILED],
        },
      },
      data: {
        processingErrorCode: null,
        processingStartedAt: new Date(),
        processingStatus: FileProcessingStatus.PROCESSING,
      },
    });
    if (!claimed.count)
      throw new ConflictException('FILE_PROCESSING_IN_PROGRESS');
    const startedAt = Date.now();
    this.metrics.recordFileEvent('processing_started');
    try {
      const bytes = (await this.storage.get(file.objectKey)).body;
      if (bytes.length !== Number(file.size))
        throw new FileExtractionError('FILE_SOURCE_SIZE_MISMATCH');
      const metadata = validateFileMetadata(
        {
          mime: file.mime,
          originalName: file.originalName,
          size: bytes.length,
        },
        this.limits(),
      );
      const extracted = await this.extractor.extract({
        bytes,
        kind: metadata.kind,
        limits: this.limits(),
      });
      const chunks = chunkText(extracted.text);
      if (!chunks.length) throw new FileExtractionError('FILE_NO_TEXT');
      if (chunks.length > this.limits().maxChunks)
        throw new FileExtractionError('FILE_CHUNK_LIMIT');
      const createdChunks = await this.database.client.$transaction(
        async (transaction) => {
          await transaction.embedding.deleteMany({
            where: { fileChunk: { fileId: file.id } },
          });
          await transaction.fileChunk.deleteMany({
            where: { fileId: file.id },
          });
          await transaction.fileChunk.createMany({
            data: chunks.map((chunk, chunkIndex) => ({
              charEnd: chunk.charEnd,
              charStart: chunk.charStart,
              chunkerVersion: CHUNKER_VERSION,
              chunkIndex,
              content: chunk.content,
              fileId: file.id,
              tokenCount: chunk.tokenCount,
              ...(extracted.pageCount
                ? { pageEnd: extracted.pageCount, pageStart: 1 }
                : {}),
            })),
          });
          return transaction.fileChunk.findMany({
            where: { fileId: file.id },
            orderBy: { chunkIndex: 'asc' },
          });
        },
      );
      for (const chunk of createdChunks)
        await this.retrieval.indexFileChunk({
          content: chunk.content,
          contentHash: createHash('sha256').update(chunk.content).digest('hex'),
          fileChunkId: chunk.id,
          workspaceId,
        });
      this.metrics.recordFileProcessingDuration(Date.now() - startedAt);
      this.metrics.recordFileEvent('ready', undefined, createdChunks.length);
      return this.database.client.workspaceFile
        .update({
          where: { id: file.id },
          data: {
            chunkerVersion: CHUNKER_VERSION,
            embeddingModel: this.retrieval.embeddingModel,
            embeddingVersion: this.retrieval.embeddingVersion,
            extractorVersion: EXTRACTOR_VERSION,
            processedAt: new Date(),
            processingErrorCode: null,
            processingStatus: FileProcessingStatus.READY,
            scanStatus: FileScanStatus.CLEAN,
          },
        })
        .then((result) => this.publicMetadata(result));
    } catch (error) {
      const code =
        error instanceof FileExtractionError
          ? error.code
          : error instanceof Error &&
              error.message === 'EMBEDDING_PROVIDER_NOT_CONFIGURED'
            ? 'EMBEDDING_PROVIDER_NOT_CONFIGURED'
            : 'FILE_PROCESSING_FAILED';
      await this.database.client.workspaceFile.update({
        where: { id: file.id },
        data: {
          processingErrorCode: code,
          processingStatus: FileProcessingStatus.FAILED,
        },
      });
      this.metrics.recordFileProcessingDuration(Date.now() - startedAt);
      this.metrics.recordFileEvent('failed');
      throw new BadRequestException(code);
    }
  }
  private async requireFile(workspaceId: string, fileId: string) {
    const file = await this.files.findById(workspaceId, fileId);
    if (!file) throw new NotFoundException('FILE_NOT_FOUND');
    return file;
  }
  private limits(): FileLimits {
    const environment = parseApiEnvironment(process.env);
    return {
      maxBytes: environment.FILES_MAX_BYTES,
      maxChunks: environment.FILES_MAX_CHUNKS,
      maxExtractedTextBytes: environment.FILES_MAX_EXTRACTED_TEXT_BYTES,
      maxPdfPages: environment.FILES_MAX_PDF_PAGES,
      processingTimeoutMs: environment.FILES_PROCESSING_TIMEOUT_MS,
    };
  }
  private publicMetadata(file: {
    id: string;
    mime: string;
    originalName: string;
    processingErrorCode: string | null;
    processingStatus: FileProcessingStatus;
    size: bigint;
  }) {
    return {
      id: file.id,
      mime: file.mime,
      originalName: file.originalName,
      processingErrorCode: file.processingErrorCode,
      processingStatus: file.processingStatus,
      size: file.size.toString(),
    };
  }
}
