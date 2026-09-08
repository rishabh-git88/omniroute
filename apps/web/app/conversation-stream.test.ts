import { describe, expect, it } from 'vitest';

import { decodeSseFrames } from './conversation-stream';

describe('conversation SSE decoder', () => {
  it('keeps an incomplete frame for the next network chunk', () => {
    const first = decodeSseFrames(
      'id: 3\nevent: content.delta\ndata: {"delta":"hel',
    );
    expect(first.frames).toEqual([]);
    const second = decodeSseFrames(`${first.remainder}lo"}\n\n`);
    expect(second.frames).toEqual([
      { data: { delta: 'hello' }, event: 'content.delta', id: '3' },
    ]);
  });
});
