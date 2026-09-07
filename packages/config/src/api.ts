import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'production']);

const apiEnvironmentSchema = z.object({
  AI_ROUTER_URL: z.url().default('http://localhost:8001'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  CORS_ORIGIN: z.url().default('http://localhost:3000'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default(
      'postgresql://omniroute:change-me-local-only@localhost:5432/omniroute',
    ),
  NODE_ENV: environmentSchema.default('development'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export class EnvironmentValidationError extends Error {
  public constructor(keys: readonly string[]) {
    super(`Invalid environment configuration: ${keys.join(', ')}`);
    this.name = 'EnvironmentValidationError';
  }
}

export function parseApiEnvironment(source: NodeJS.ProcessEnv): ApiEnvironment {
  const result = apiEnvironmentSchema.safeParse(source);

  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join('.'));
    throw new EnvironmentValidationError(keys);
  }

  return result.data;
}
