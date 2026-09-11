import { describe, expect, it } from 'vitest';
import { conversationCommand, canAttemptModel } from './conversation-command';

describe('composer mode command', () => {
  it.each(['economy', 'smart', 'max'] as const)(
    'sends %s for automatic routing without pinning a model',
    (mode) => {
      expect(conversationCommand('hello', mode)).toEqual({
        content: 'hello',
        routingMode: mode,
      });
    },
  );
  it('preserves an explicit model override and mode without client prices', () => {
    expect(conversationCommand('hello', 'max', 'registry:model')).toEqual({
      content: 'hello',
      routingMode: 'max',
      modelKey: 'registry:model',
    });
  });
  it.each([
    'disabled',
    'missing_credentials',
    'unavailable',
    'rate_limited',
    'timed_out',
    'temporarily_unhealthy',
  ])('does not advertise %s as usable', (state) => {
    expect(canAttemptModel(state)).toBe(false);
  });
});
