import { describe, expect, it } from 'vitest';
import { TextLayerExtractor } from './text-extractor.js';
const limits = {
  maxBytes: 1000,
  maxChunks: 10,
  maxExtractedTextBytes: 1000,
  maxPdfPages: 3,
  processingTimeoutMs: 1000,
};
describe('bounded text extraction', () => {
  it('normalizes UTF-8 BOM and line endings without flattening Markdown', async () => {
    const value = await new TextLayerExtractor().extract({
      bytes: Buffer.from(
        String.fromCharCode(0xfeff) +
          '# Heading\r\n\r\n- item\r\n~~~ts\r\nx()\r\n~~~',
      ),
      kind: 'markdown',
      limits,
    });
    expect(value.text).toContain('# Heading\n\n- item');
    expect(value.text).toContain('~~~ts\nx()');
  });
  it('rejects invalid text and malformed PDF input', async () => {
    const extractor = new TextLayerExtractor();
    await expect(
      extractor.extract({ bytes: Buffer.from([0xff]), kind: 'text', limits }),
    ).rejects.toThrow('FILE_TEXT_ENCODING_INVALID');
    await expect(
      extractor.extract({
        bytes: Buffer.from('not a PDF'),
        kind: 'pdf',
        limits,
      }),
    ).rejects.toThrow('FILE_PDF_MALFORMED');
  });
});
