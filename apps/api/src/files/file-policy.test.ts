import { describe, expect, it } from 'vitest';
import { decodeBase64, validateFileMetadata } from './file-policy.js';
const limits = {
  maxBytes: 100,
  maxChunks: 10,
  maxExtractedTextBytes: 100,
  maxPdfPages: 3,
  processingTimeoutMs: 1_000,
};
describe('file upload policy', () => {
  it.each([
    ['notes.txt', 'text/plain', 'text'],
    ['notes.md', 'text/markdown', 'markdown'],
    ['notes.markdown', 'text/x-markdown', 'markdown'],
    ['source.pdf', 'application/pdf', 'pdf'],
  ])('accepts supported pairs', (originalName, mime, kind) => {
    expect(
      validateFileMetadata({ originalName, mime, size: 1 }, limits).kind,
    ).toBe(kind);
  });
  it.each([
    ['notes.pdf', 'text/plain'],
    ['../notes.txt', 'text/plain'],
    ['empty.txt', 'application/pdf'],
    ['notes.docx', 'application/octet-stream'],
  ])('rejects unsafe or mismatched metadata', (originalName, mime) => {
    expect(() =>
      validateFileMetadata({ originalName, mime, size: 1 }, limits),
    ).toThrow();
  });
  it('rejects empty, oversized and malformed base64 input', () => {
    expect(() => decodeBase64('', 10)).toThrow('FILE_CONTENT_INVALID');
    expect(() => decodeBase64('%%%=', 10)).toThrow('FILE_CONTENT_INVALID');
    expect(() => decodeBase64(Buffer.alloc(11).toString('base64'), 10)).toThrow(
      'FILE_TOO_LARGE',
    );
  });
});
