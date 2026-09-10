import { z } from 'zod';
import { httpOriginSchema, isProductionOrigin } from './http-origin.js';

const webEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_URL: httpOriginSchema,
});

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function parseWebEnvironment(source: {
  NEXT_PUBLIC_API_URL?: string | undefined;
  NODE_ENV?: string | undefined;
}): WebEnvironment {
  const apiUrl =
    source.NEXT_PUBLIC_API_URL ??
    (source.NODE_ENV === 'development' || source.NODE_ENV === 'test'
      ? 'http://localhost:4000'
      : undefined);
  const result = webEnvironmentSchema.safeParse({
    NEXT_PUBLIC_API_URL: apiUrl,
  });
  if (
    !result.success ||
    (source.NODE_ENV === 'production' &&
      !isProductionOrigin(result.data.NEXT_PUBLIC_API_URL))
  ) {
    throw new Error(
      'Invalid NEXT_PUBLIC_API_URL: configure an HTTP(S) API origin; production requires an explicit HTTPS DNS origin.',
    );
  }
  return result.data;
}
