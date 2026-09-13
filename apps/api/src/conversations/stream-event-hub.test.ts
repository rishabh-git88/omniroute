import { describe, expect, it } from 'vitest';

import { StreamEventHub } from './stream-event-hub.js';

describe('StreamEventHub', () => {
  it('assigns global cursor positions and per-run sequences', () => {
    const hub = new StreamEventHub();
    const first = hub.publish('group', 'content.delta', {
      runId: 'run-a',
      delta: 'A',
    });
    const second = hub.publish('group', 'content.delta', {
      runId: 'run-b',
      delta: 'B',
    });
    const third = hub.publish('group', 'run.status', {
      runId: 'run-a',
      status: 'completed',
    });
    expect([first.position, second.position, third.position]).toEqual([
      1, 2, 3,
    ]);
    expect([first.runSequence, second.runSequence, third.runSequence]).toEqual([
      1, 1, 2,
    ]);
    expect(third.data).toMatchObject({ eventPosition: 3, runSequence: 2 });
  });

  it('requires a durable reset when a bounded replay cursor expires', () => {
    const hub = new StreamEventHub();
    for (
      let index = 0;
      index <= StreamEventHub.MAX_REPLAY_EVENTS + 1;
      index += 1
    )
      hub.publish('group', 'content.delta', {
        runId: 'run-a',
        delta: String(index),
      });
    expect(hub.replay('group', 1)).toMatchObject({
      events: [],
      resetRequired: true,
    });
    expect(hub.replay('group', 2).resetRequired).toBe(false);
  });
});
