export interface TextChunk {
  charEnd: number;
  charStart: number;
  content: string;
  tokenCount: number;
}

export const CHUNKER_VERSION = 'text-v2';
export const DEFAULT_MAX_CHARS = 1_200;
export const DEFAULT_OVERLAP_CHARS = 180;

export function chunkText(
  content: string,
  configuration: { maxChars?: number; overlapChars?: number } = {},
): TextChunk[] {
  const maxChars = configuration.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = configuration.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  if (
    !Number.isInteger(maxChars) ||
    !Number.isInteger(overlapChars) ||
    maxChars < 128 ||
    overlapChars < 0 ||
    overlapChars >= maxChars
  )
    throw new Error('Invalid text chunker configuration');
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + maxChars);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf('\n\n', end),
        normalized.lastIndexOf('\n', end),
        normalized.lastIndexOf(' ', end),
      );
      if (boundary > start + maxChars / 2) end = boundary;
    }
    const value = normalized.slice(start, end).trim();
    if (value) {
      chunks.push({
        charEnd: end,
        charStart: start,
        content: value,
        tokenCount: value.match(/\S+/g)?.length ?? 0,
      });
    }
    if (end === normalized.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}
