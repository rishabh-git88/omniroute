import { parseWebEnvironment } from '@omniroute/config/web';

/**
 * The browser's only API origin. It is injected by Vercel or the image build
 * and intentionally excludes the version prefix.
 */
// Keep these direct property accesses: Next.js replaces them at build time.
export const API_URL = parseWebEnvironment({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NODE_ENV: process.env.NODE_ENV,
}).NEXT_PUBLIC_API_URL;
export const API_V1_URL = `${API_URL.replace(/\/$/, '')}/v1`;
