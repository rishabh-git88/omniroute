export interface TextChunk {
  content: string;
  tokenCount: number;
}

const MAX_CHARS = 1_200;
const OVERLAP_CHARS = 180;

export function chunkText(content: string): TextChunk[] {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + MAX_CHARS);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(' ', end);
      if (boundary > start + MAX_CHARS / 2) end = boundary;
    }
    const value = normalized.slice(start, end).trim();
    if (value) {
      chunks.push({
        content: value,
        tokenCount: value.match(/\S+/g)?.length ?? 0,
      });
    }
    if (end === normalized.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return chunks;
}
