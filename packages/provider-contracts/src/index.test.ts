import { describe, expect, it } from 'vitest';

import { canonicalChatRequestSchema } from './index.js';

describe('canonicalChatRequestSchema', () => {
  it('accepts a provider-neutral request', () => {
    const request = canonicalChatRequestSchema.parse({
      context: {
        messages: [{ content: 'Hello', role: 'user' }],
        sourceIds: [],
        tokenEstimate: 1,
      },
      contextSnapshotId: '019cd3a5-8d1d-7000-8000-000000000001',
      maxOutputTokens: 512,
      modelKey: 'fake-default',
      provider: 'fake',
      runId: '019cd3a5-8d1d-7000-8000-000000000002',
    });

    expect(request.provider).toBe('fake');
  });
});
