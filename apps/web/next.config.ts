import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

function renderApiOrigin(): string {
  const value = process.env.RENDER_API_ORIGIN;
  if (!value) throw new Error('RENDER_API_ORIGIN is required for /v1 rewrites');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.pathname !== '/')
    throw new Error(
      'RENDER_API_ORIGIN must be an HTTPS origin without a path or /v1 suffix',
    );
  return url.origin;
}

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: false,
  },
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/favicon.ico', destination: '/icon.svg', permanent: true },
    ];
  },
  async rewrites() {
    const origin = renderApiOrigin();
    return [
      { source: '/v1', destination: `${origin}/v1` },
      { source: '/v1/:path*', destination: `${origin}/v1/:path*` },
    ];
  },
  transpilePackages: ['@omniroute/config', '@omniroute/types', '@omniroute/ui'],
};

export default nextConfig;
