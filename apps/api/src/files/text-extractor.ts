import { BadRequestException } from '@nestjs/common';
import type { FileLimits, SupportedFileKind } from './file-policy.js';

export const EXTRACTOR_VERSION = 'text-layer-v2';
export interface ExtractedText {
  pageCount?: number;
  text: string;
}
export class FileExtractionError extends BadRequestException {
  public constructor(public readonly code: string) {
    super(code);
  }
}
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(String.fromCharCode(0))
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Text layer only. PDF.js is configured without a worker, eval, network, or OCR. */
export class TextLayerExtractor {
  public async extract(input: {
    bytes: Buffer;
    kind: SupportedFileKind;
    limits: FileLimits;
  }): Promise<ExtractedText> {
    if (input.kind === 'pdf') return this.extractPdf(input.bytes, input.limits);
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    } catch {
      throw new FileExtractionError('FILE_TEXT_ENCODING_INVALID');
    }
    return this.accept(normalizeExtractedText(decoded), input.limits);
  }
  private async extractPdf(
    bytes: Buffer,
    limits: FileLimits,
  ): Promise<ExtractedText> {
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new FileExtractionError('FILE_PDF_MALFORMED');
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const document = await pdfjs.getDocument({
        data: new Uint8Array(bytes),
        disableAutoFetch: true,
        disableStream: true,
        useWorkerFetch: false,
      }).promise;
      if (document.numPages > limits.maxPdfPages) {
        throw new FileExtractionError('FILE_PDF_PAGE_LIMIT');
      }
      const pages: string[] = [];
      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const text = await (
          await document.getPage(pageNumber)
        ).getTextContent();
        const items = text.items as Array<{ hasEOL?: boolean; str?: string }>;
        pages.push(
          items
            .filter((item) => typeof item.str === 'string')
            .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
            .join(''),
        );
      }
      const accepted = this.accept(
        normalizeExtractedText(pages.join('\n\n')),
        limits,
      );
      return { ...accepted, pageCount: pages.length };
    } catch (error) {
      if (error instanceof FileExtractionError) throw error;
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('password') || message.includes('encrypted'))
        throw new FileExtractionError('FILE_PDF_ENCRYPTED');
      throw new FileExtractionError('FILE_PDF_MALFORMED');
    }
  }
  private accept(text: string, limits: FileLimits): ExtractedText {
    if (!text) throw new FileExtractionError('FILE_NO_TEXT');
    if (Buffer.byteLength(text, 'utf8') > limits.maxExtractedTextBytes)
      throw new FileExtractionError('FILE_EXTRACTED_TEXT_LIMIT');
    return { text };
  }
}
