import { describe, it, expect } from 'vitest';
import { permitsFallback } from './fallback-policy.js';

describe('bounded provider fallback policy', () => {
  it.each([
    'PROVIDER_DISABLED',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_TIMEOUT',
    'RATE_LIMITED',
    'STREAM_TRUNCATED',
    'PROVIDER_PROTOCOL_ERROR',
  ])('allows %s before output', (code) => {
    expect(permitsFallback(code, '', 0)).toBe(true);
    expect(permitsFallback(code, 'partial', 0)).toBe(false);
    expect(permitsFallback(code, '', 2)).toBe(false);
  });
  it.each([
    'PROVIDER_AUTH_FAILED',
    'PROVIDER_INVALID_REQUEST',
    'CONTEXT_BUDGET_EXCEEDED',
    'CANCELLED',
    'SAFETY_STOP',
    'OUTPUT_LIMIT_EXCEEDED',
    'REQUEST_LIMIT_EXCEEDED',
    'unknown',
  ])('never retries %s', (code) => {
    expect(permitsFallback(code, '', 0)).toBe(false);
  });
});
