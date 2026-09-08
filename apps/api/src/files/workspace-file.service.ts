import { createHash, randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';

import {
  FileProcessingStatus,
  FileScanStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { chunkText } from '../context/text-chunker.js';
import { SemanticRetrievalService } from '../context/semantic-retrieval.service.js';
import { WorkspaceFileRepository } from './workspace-file.repository.js';

const MAX_TEXT_FILE_BYTES = 2_000_000;

@Injectable()
export class WorkspaceFileService {
  public constructor(
    private readonly database: PrismaService,
    private readonly files: WorkspaceFileRepository,
    private readonly retrieval: SemanticRetrievalService,
  ) {}

  /** MVP text upload: raw bytes are extracted immediately and only chunks persist. */
  public async uploadText(
    workspaceId: string,
    input: { content: string; mime?: string; originalName: string },
  ) {
    const content = input.content.replace(/^\uFEFF/, '').trim();
    if (!content)
      throw new BadRequestException('Text file content is required');
    const size = Buffer.byteLength(content, 'utf8');
    if (size > MAX_TEXT_FILE_BYTES) {
      throw new BadRequestException('Text file exceeds the 2 MB MVP limit');
    }
    const originalName = input.originalName.trim();
    if (!originalName || originalName.length > 255) {
      throw new BadRequestException('File name is invalid');
    }
    const mime = input.mime?.trim() || 'text/plain';
    if (!mime.startsWith('text/')) {
      throw new BadRequestException('Only text files are supported by the MVP');
    }
    const checksumSha256 = createHash('sha256').update(content).digest('hex');
    const file = await this.files.create({
      checksumSha256,
      mime,
      objectKey: `workspace/${workspaceId}/text/${randomUUID()}`,
      originalName,
      size: BigInt(size),
      workspaceId,
    });
    const chunks = chunkText(content);
    try {
      const createdChunks = await this.database.client.$transaction(
        async (transaction) => {
          await transaction.workspaceFile.update({
            where: { id: file.id },
            data: { processingStatus: FileProcessingStatus.PROCESSING },
          });
          await transaction.fileChunk.createMany({
            data: chunks.map((chunk, chunkIndex) => ({
              chunkIndex,
              content: chunk.content,
              fileId: file.id,
              tokenCount: chunk.tokenCount,
            })),
          });
          return transaction.fileChunk.findMany({
            where: { fileId: file.id },
            orderBy: { chunkIndex: 'asc' },
          });
        },
      );
      for (const chunk of createdChunks) {
        await this.retrieval.indexFileChunk({
          content: chunk.content,
          contentHash: createHash('sha256').update(chunk.content).digest('hex'),
          fileChunkId: chunk.id,
          workspaceId,
        });
      }
      return this.database.client.workspaceFile.update({
        where: { id: file.id },
        data: {
          processingStatus: FileProcessingStatus.READY,
          scanStatus: FileScanStatus.CLEAN,
        },
      });
    } catch (error) {
      await this.database.client.workspaceFile.update({
        where: { id: file.id },
        data: { processingStatus: FileProcessingStatus.FAILED },
      });
      throw error;
    }
  }
}
