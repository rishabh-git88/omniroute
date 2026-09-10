import { z } from 'zod';

const webEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
});

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function parseWebEnvironment(source: {
  NEXT_PUBLIC_API_URL?: string | undefined;
  NODE_ENV?: string | undefined;
}): WebEnvironment {
  const apiUrl =
    source.NEXT_PUBLIC_API_URL ??
    (source.NODE_ENV === 'production' ? undefined : 'http://localhost:4000');
  return webEnvironmentSchema.parse({ NEXT_PUBLIC_API_URL: apiUrl });
}
