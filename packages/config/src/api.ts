import { z } from 'zod';
import { httpOriginSchema, isProductionOrigin } from './http-origin.js';

const environmentSchema = z.enum(['development', 'test', 'production']);

const apiEnvironmentSchema = z.object({
  AI_ROUTER_URL: httpOriginSchema.default('http://localhost:8001'),
  AI_EXECUTION_PROVIDER: z
    .enum([
      'disabled',
      'mock',
      'openai',
      'anthropic',
      'gemini',
      'groq',
      'openrouter',
      'multi',
    ])
    .default('disabled'),
  AI_ROUTER_INTERNAL_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  AI_ROUTER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(95_000),
  AI_ROUTING_REGION: z.string().min(1).optional(),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  CORS_ORIGIN: httpOriginSchema.default('http://localhost:3000'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default(
      'postgresql://omniroute:change-me-local-only@localhost:5432/omniroute',
    ),
  DAILY_FREE_CREDITS: z.string().regex(/^\d+$/).default('1000'),
  // File source objects and embeddings are server-only. Deterministic
  // embeddings are deliberately limited to non-production environments.
  EMBEDDING_PROVIDER: z
    .enum(['deterministic', 'disabled'])
    .default('deterministic'),
  FILES_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50_000_000)
    .default(5_000_000),
  FILES_MAX_CHUNKS: z.coerce.number().int().positive().max(10_000).default(256),
  FILES_MAX_EXTRACTED_TEXT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50_000_000)
    .default(10_000_000),
  FILES_MAX_PDF_PAGES: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(100),
  FILES_PROCESSING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(30_000),
  FILES_STALE_PROCESSING_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(15 * 60_000),
  FILES_STORAGE_DRIVER: z.enum(['memory', 'supabase']).default('memory'),
  SUPABASE_STORAGE_BUCKET: z.string().trim().min(3).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1).optional(),
  SUPABASE_URL: z.url().optional(),
  PLATFORM_CREDITS_PER_USD: z.string().regex(/^\d+$/).default('1000000'),
  NODE_ENV: environmentSchema.default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  RATE_LIMIT_EXECUTIONS_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .default(12),
  RATE_LIMIT_FILE_MUTATIONS_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .default(20),
});

const authEnvironmentSchema = z
  .object({
    API_PUBLIC_URL: httpOriginSchema,
    AUTH_COOKIE_DOMAIN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .trim()
        .toLowerCase()
        .transform((value) => value.replace(/^\./, ''))
        .refine(
          (value) =>
            /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value),
          'must be a parent DNS domain',
        )
        .optional(),
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
    WEB_APP_URL: httpOriginSchema,
  })
  .superRefine((environment, context) => {
    const domain = environment.AUTH_COOKIE_DOMAIN;
    if (domain) {
      for (const key of ['API_PUBLIC_URL', 'WEB_APP_URL'] as const) {
        const host = new URL(environment[key]).hostname;
        if (host !== domain && !host.endsWith(`.${domain}`)) {
          context.addIssue({
            code: 'custom',
            message: 'cookie domain must contain both hosts',
            path: ['AUTH_COOKIE_DOMAIN'],
          });
        }
      }
    }
    if (environment.NODE_ENV !== 'production') return;

    for (const key of ['API_PUBLIC_URL', 'WEB_APP_URL'] as const) {
      if (!isProductionOrigin(environment[key])) {
        context.addIssue({
          code: 'custom',
          message: 'must use a public HTTPS DNS origin in production',
          path: [key],
        });
      }
    }
    if (!domain && environment.API_PUBLIC_URL !== environment.WEB_APP_URL) {
      context.addIssue({
        code: 'custom',
        message:
          'production without a cookie domain requires the same web and API origin',
        path: ['AUTH_COOKIE_DOMAIN'],
      });
    }
    if (
      domain &&
      (new URL(environment.WEB_APP_URL).hostname !== `app.${domain}` ||
        new URL(environment.API_PUBLIC_URL).hostname !== `api.${domain}`)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'production cookie-domain deployments require app/API sibling hosts',
        path: ['AUTH_COOKIE_DOMAIN'],
      });
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
  const result = apiEnvironmentSchema.safeParse({
    ...source,
    AI_EXECUTION_PROVIDER:
      source.AI_EXECUTION_PROVIDER ??
      (source.NODE_ENV === 'production' ? 'disabled' : 'mock'),
  });

  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join('.'));
    throw new EnvironmentValidationError(keys);
  }

  if (
    result.data.NODE_ENV === 'production' &&
    result.data.AI_EXECUTION_PROVIDER === 'mock'
  )
    throw new EnvironmentValidationError(['AI_EXECUTION_PROVIDER']);
  if (
    ['openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'multi'].includes(
      result.data.AI_EXECUTION_PROVIDER,
    ) &&
    (!result.data.AI_ROUTER_INTERNAL_TOKEN || !source.AI_ROUTER_URL)
  )
    throw new EnvironmentValidationError([
      'AI_ROUTER_INTERNAL_TOKEN',
      'AI_ROUTER_URL',
    ]);
  if (result.data.NODE_ENV === 'production') {
    if (!source.REDIS_URL) throw new EnvironmentValidationError(['REDIS_URL']);
    if (result.data.FILES_STORAGE_DRIVER !== 'supabase')
      throw new EnvironmentValidationError(['FILES_STORAGE_DRIVER']);
    const missingStorage = [
      !result.data.SUPABASE_URL && 'SUPABASE_URL',
      !result.data.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
      !result.data.SUPABASE_STORAGE_BUCKET && 'SUPABASE_STORAGE_BUCKET',
    ].filter((key): key is string => Boolean(key));
    if (missingStorage.length)
      throw new EnvironmentValidationError([...missingStorage]);
    if (result.data.EMBEDDING_PROVIDER !== 'disabled')
      throw new EnvironmentValidationError(['EMBEDDING_PROVIDER']);
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
