import { describe, expect, it } from 'vitest';

import {
  acceptsStreamEvent,
  decodeSseFrames,
  reconnectDelayMs,
  streamEndpoint,
} from './conversation-stream';

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

  it('preserves run identity for interleaved comparison deltas', () => {
    const decoded = decodeSseFrames(
      [
        'id: 1',
        'event: content.delta',
        'data: {"runId":"run-a","delta":"A"}',
        '',
        'id: 2',
        'event: content.delta',
        'data: {"runId":"run-b","delta":"B"}',
        '',
      ].join('\n') + '\n',
    );
    expect(decoded.frames.map((frame) => frame.data)).toEqual([
      { delta: 'A', runId: 'run-a' },
      { delta: 'B', runId: 'run-b' },
    ]);
  });

  it('uses a cursor to suppress duplicate replayed content', () => {
    expect(acceptsStreamEvent(4, '4')).toBe(false);
    expect(acceptsStreamEvent(4, '5')).toBe(true);
    expect(acceptsStreamEvent(4, undefined)).toBe(true);
    expect(streamEndpoint('group / id', 5)).toBe(
      '/request-groups/group%20%2F%20id/events?after=5',
    );
  });

  it('uses bounded reconnect delays', () => {
    expect(reconnectDelayMs(0)).toBe(250);
    expect(reconnectDelayMs(5)).toBe(4_000);
  });
});
