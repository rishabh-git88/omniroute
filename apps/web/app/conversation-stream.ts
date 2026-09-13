export interface StreamFrame {
  data: Record<string, unknown>;
  event: string;
  id?: string;
}

export const MAX_STREAM_RECONNECTS = 4;

/** Never append an event that the SSE cursor has already acknowledged. */
export function acceptsStreamEvent(lastEventId: number, id?: string): boolean {
  if (id === undefined) return true;
  return /^\d+$/.test(id) && Number(id) > lastEventId;
}

/** Bounded backoff keeps a transient network loss from becoming a hot loop. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(4_000, 250 * 2 ** Math.max(0, attempt));
}

export function streamEndpoint(groupId: string, afterId: number): string {
  const after = afterId > 0 ? `?after=${encodeURIComponent(afterId)}` : '';
  return `/request-groups/${encodeURIComponent(groupId)}/events${after}`;
}

/** Decode the small SSE subset emitted by the API without tying UI to a provider. */
export function decodeSseFrames(buffer: string): {
  frames: StreamFrame[];
  remainder: string;
} {
  const parts = buffer.split('\n\n');
  const remainder = parts.pop() ?? '';
  const frames = parts.flatMap((part) => {
    const fields = new Map<string, string>();
    for (const line of part.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      fields.set(
        line.slice(0, separator),
        line.slice(separator + 1).trimStart(),
      );
    }
    const event = fields.get('event');
    const data = fields.get('data');
    if (!event || !data) return [];
    try {
      const id = fields.get('id');
      return [
        {
          data: JSON.parse(data) as Record<string, unknown>,
          event,
          ...(id === undefined ? {} : { id }),
        },
      ];
    } catch {
      return [];
    }
  });
  return { frames, remainder };
}
