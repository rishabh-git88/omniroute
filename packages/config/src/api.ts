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
  DAILY_FREE_CREDITS: z.string().regex(/^\d+$/).default('1000'),
  PLATFORM_CREDITS_PER_USD: z.string().regex(/^\d+$/).default('1000000'),
  NODE_ENV: environmentSchema.default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
});

const authEnvironmentSchema = z
  .object({
    API_PUBLIC_URL: z.url(),
    AUTH_COOKIE_DOMAIN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    AUTH_SESSION_ROTATION_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .max(60)
      .default(15),
    AUTH_SESSION_SECRET: z.string().min(32),
    AUTH_SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .max(168)
      .default(24),
    GOOGLE_CLIENT_ID: z.string().trim().min(1),
    GOOGLE_CLIENT_SECRET: z.string().trim().min(1),
    NODE_ENV: environmentSchema.default('development'),
    WEB_APP_URL: z.url(),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') return;

    for (const key of ['API_PUBLIC_URL', 'WEB_APP_URL'] as const) {
      if (new URL(environment[key]).protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          message: 'must use HTTPS in production',
          path: [key],
        });
      }
    }
  });

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type AuthEnvironment = z.infer<typeof authEnvironmentSchema>;

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

export function parseAuthEnvironment(
  source: NodeJS.ProcessEnv,
): AuthEnvironment {
  const result = authEnvironmentSchema.safeParse(source);

  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join('.'));
    throw new EnvironmentValidationError(keys);
  }

  return result.data;
}
