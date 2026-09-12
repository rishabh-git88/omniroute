import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../next.config';

describe('application branding routes', () => {
  afterEach(() => vi.unstubAllEnvs());

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
  it('proxies the browser /v1 origin to the private Render API origin', async () => {
    vi.stubEnv('RENDER_API_ORIGIN', 'https://api.example.com');

    await expect(nextConfig.rewrites?.()).resolves.toEqual([
      { source: '/v1', destination: 'https://api.example.com/v1' },
      {
        source: '/v1/:path*',
        destination: 'https://api.example.com/v1/:path*',
      },
    ]);
  });
  it('rejects a missing or path-bearing Render API origin', async () => {
    vi.stubEnv('RENDER_API_ORIGIN', '');
    await expect(nextConfig.rewrites?.()).rejects.toThrow('RENDER_API_ORIGIN');

    vi.stubEnv('RENDER_API_ORIGIN', 'https://api.example.com/v1');
    await expect(nextConfig.rewrites?.()).rejects.toThrow('without a path');
  });
});
