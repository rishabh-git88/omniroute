import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export const SUPPORTED_FILE_TYPES = {
  markdown: new Set(['text/markdown', 'text/x-markdown']),
  pdf: new Set(['application/pdf']),
  text: new Set(['text/plain']),
} as const;

export type SupportedFileKind = 'markdown' | 'pdf' | 'text';

export interface FileLimits {
  maxBytes: number;
  maxChunks: number;
  maxExtractedTextBytes: number;
  maxPdfPages: number;
  processingTimeoutMs: number;
}

export function validateFileMetadata(
  input: {
    mime?: string | undefined;
    originalName: string;
    size: number;
  },
  limits: FileLimits,
): { kind: SupportedFileKind; mime: string; originalName: string } {
  const originalName = input.originalName.trim();
  if (
    !originalName ||
    originalName.length > 255 ||
    originalName.includes('/') ||
    originalName.includes('\\') ||
    [...originalName].some((character) => character.charCodeAt(0) < 32)
  )
    throw new BadRequestException('FILE_NAME_INVALID');
  if (!Number.isSafeInteger(input.size) || input.size <= 0)
    throw new BadRequestException('FILE_EMPTY');
  if (input.size > limits.maxBytes)
    throw new PayloadTooLargeException('FILE_TOO_LARGE');

  const extension = originalName.split('.').at(-1)?.toLowerCase();
  const mime = input.mime?.trim().toLowerCase() || '';
  const text = SUPPORTED_FILE_TYPES.text.has(mime) && extension === 'txt';
  const markdown =
    SUPPORTED_FILE_TYPES.markdown.has(mime) &&
    (extension === 'md' || extension === 'markdown');
  const pdf = SUPPORTED_FILE_TYPES.pdf.has(mime) && extension === 'pdf';
  if (!text && !markdown && !pdf) {
    if (
      extension === 'txt' ||
      extension === 'md' ||
      extension === 'markdown' ||
      extension === 'pdf'
    )
      throw new BadRequestException('FILE_MIME_EXTENSION_MISMATCH');
    throw new BadRequestException('FILE_TYPE_UNSUPPORTED');
  }
  return {
    kind: pdf ? 'pdf' : markdown ? 'markdown' : 'text',
    mime,
    originalName,
  };
}

export function decodeBase64(value: string, maximumBytes: number): Buffer {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    throw new BadRequestException('FILE_CONTENT_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length) throw new BadRequestException('FILE_EMPTY');
  if (bytes.length > maximumBytes)
    throw new PayloadTooLargeException('FILE_TOO_LARGE');
  return bytes;
}
