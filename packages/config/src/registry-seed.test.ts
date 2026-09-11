import { describe, expect, it } from 'vitest';
import { parseRegistrySeed } from './registry-seed.js';

const fixture = {
  provider: 'openai',
  modelKey: 'openai:synthetic',
  providerModelId: 'synthetic',
  displayName: 'Synthetic test only',
  registryVersion: 1,
  capabilities: {
    modalities: { input: ['text'], output: ['text'] },
    files: false,
    images: false,
    tools: false,
    search: false,
    contextWindow: 4096,
    maxOutputTokens: 512,
  },
  pricing: {
    currency: 'USD',
    inputPerMillionTokens: '1.25000000',
    outputPerMillionTokens: '4.75000000',
    sourceUrl: 'https://pricing.example.invalid',
    reviewedAt: '2026-09-10T00:00:00Z',
  },
  pricingVersion: 'synthetic-test-only',
  effectiveAt: '2026-09-10T00:00:00Z',
  regionConstraints: [],
};
describe('reviewed registry seed configuration', () => {
  it('does not invent any model or price by default', () => {
    expect(parseRegistrySeed({ models: [] })).toEqual([]);
  });
  it('accepts explicit exact prices and provenance', () => {
    expect(
      parseRegistrySeed({ models: [fixture] })[0]?.pricing
        .inputPerMillionTokens,
    ).toBe('1.25000000');
  });
  it.each([
    { pricing: undefined },
    { pricingVersion: '' },
    { provider: 'fake' },
    { modelKey: 'google:synthetic' },
    { pricing: { ...fixture.pricing, inputPerMillionTokens: 1.25 } },
    { pricing: { ...fixture.pricing, inputPerMillionTokens: '-1' } },
    { pricing: { ...fixture.pricing, sourceUrl: undefined } },
    { enabled: true },
  ])('rejects incomplete/unreviewed or enabling configuration', (override) => {
    expect(() =>
      parseRegistrySeed({ models: [{ ...fixture, ...override }] }),
    ).toThrow('Invalid model registry seed');
  });
  it('rejects duplicate versions', () => {
    expect(() => parseRegistrySeed({ models: [fixture, fixture] })).toThrow();
  });
});

import { validateRoutingRegistry } from './registry-seed.js';
const routingFixture = {
  ...fixture,
  capabilities: {
    ...fixture.capabilities,
    taskScores: { general: 70, coding: 90 },
    qualityScore: 85,
    typicalLatencyMs: 900,
  },
};
it('requires reviewed routing metadata and retains zero price', () => {
  expect(() => validateRoutingRegistry(fixture)).toThrow();
  expect(
    validateRoutingRegistry({
      ...routingFixture,
      pricing: {
        ...fixture.pricing,
        inputPerMillionTokens: '0',
        outputPerMillionTokens: '0',
      },
    }).pricing.inputPerMillionTokens,
  ).toBe('0');
});
it.each([
  { qualityScore: 101 },
  { typicalLatencyMs: -1 },
  { taskScores: { coding: 90 } },
  { taskScores: { general: -1 } },
  { taskScores: { general: 80, invented: 90 } },
  { modalities: { input: ['image'], output: ['text'] } },
])('rejects unsafe routing metadata %j', (capabilities) => {
  expect(() =>
    validateRoutingRegistry({
      ...routingFixture,
      capabilities: { ...routingFixture.capabilities, ...capabilities },
    }),
  ).toThrow();
});
