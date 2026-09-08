export interface StreamFrame {
  data: Record<string, unknown>;
  event: string;
  id?: string;
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
