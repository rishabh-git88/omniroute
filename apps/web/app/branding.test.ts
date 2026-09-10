import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('application branding routes', () => {
  it('supplies a self-contained application icon using existing brand colors', async () => {
    const svg = await readFile(new URL('./icon.svg', import.meta.url), 'utf8');
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('#b9f379');
    expect(svg).not.toMatch(/<script|<image|href=/);
  });
  it('resolves legacy favicon requests to the application SVG', async () => {
    expect(await nextConfig.redirects?.()).toContainEqual({
      source: '/favicon.ico',
      destination: '/icon.svg',
      permanent: true,
    });
  });
});
