import { z } from 'zod';

const webEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.url().default('http://localhost:4000/v1'),
});

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function parseWebEnvironment(source: {
  NEXT_PUBLIC_API_BASE_URL?: string | undefined;
}): WebEnvironment {
  return webEnvironmentSchema.parse(source);
}
