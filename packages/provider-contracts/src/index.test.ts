import { describe, expect, it } from 'vitest';

import {
  providerExecutionPlanSchema,
  canonicalChatRequestSchema,
} from './index.js';

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

import { readFileSync } from 'node:fs';
import { z } from 'zod';
const fixtures = JSON.parse(
  readFileSync(
    new URL('../fixtures/canonical-requests.json', import.meta.url),
    'utf8',
  ),
) as Array<{ name: string; valid: boolean; request: unknown }>;
for (const fixture of fixtures) {
  it(`shared wire fixture: ${fixture.name}`, () => {
    expect(canonicalChatRequestSchema.safeParse(fixture.request).success).toBe(
      fixture.valid,
    );
  });
}
it('publishes the schema generated from the actual Zod contract', () => {
  const published = JSON.parse(
    readFileSync(
      new URL('../schemas/canonical-chat-request.schema.json', import.meta.url),
      'utf8',
    ),
  );
  expect(published).toEqual(z.toJSONSchema(canonicalChatRequestSchema));
});

const executionFixtures = JSON.parse(
  readFileSync(
    new URL('../fixtures/execution-plans.json', import.meta.url),
    'utf8',
  ),
) as Array<{ name: string; valid: boolean; plan: unknown }>;
for (const fixture of executionFixtures) {
  it(`execution wire fixture: ${fixture.name}`, () => {
    expect(providerExecutionPlanSchema.safeParse(fixture.plan).success).toBe(
      fixture.valid,
    );
  });
}
it('publishes the execution envelope schema from Zod', () => {
  expect(
    JSON.parse(
      readFileSync(
        new URL(
          '../schemas/provider-execution-plan.schema.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  ).toEqual(z.toJSONSchema(providerExecutionPlanSchema));
});
