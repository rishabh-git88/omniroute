import { parseWebEnvironment } from '@omniroute/config/web';

/**
 * The browser's only API origin. It is injected by Vercel or the image build
 * and intentionally excludes the version prefix.
 */
export const API_URL = parseWebEnvironment(process.env).NEXT_PUBLIC_API_URL;
export const API_V1_URL = `${API_URL.replace(/\/$/, '')}/v1`;
