import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  experimental: {
    useTypeScriptCli: false,
  },
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  reactStrictMode: true,
  transpilePackages: ['@omniroute/config', '@omniroute/types', '@omniroute/ui'],
};

export default nextConfig;
