import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiEnvironment, AuthEnvironment } from '@omniroute/config/api';
import fastifyCookie from '@fastify/cookie';

export function httpServerOptions(
  environment: Pick<ApiEnvironment, 'LOG_LEVEL'> &
    Partial<Pick<ApiEnvironment, 'FILES_MAX_BYTES'>>,
) {
  return {
    // JSON base64 uploads are bounded by the same authoritative source-byte
    // limit plus encoding overhead. The file service still validates bytes.
    bodyLimit:
      Math.ceil((environment.FILES_MAX_BYTES ?? 5_000_000) * 1.37) + 16_384,
    genReqId: (request: Pick<IncomingMessage, 'headers'>) => {
      const supplied = request.headers['x-request-id'];
      return typeof supplied === 'string' &&
        /^[a-zA-Z0-9._-]{8,128}$/.test(supplied)
        ? supplied
        : randomUUID();
    },
    logger: {
      level: environment.LOG_LEVEL,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
      ],
      serializers: {
        // Request queries can contain OAuth credentials. Keep them out of all
        // normal request logs, including the pre-handler "incoming request".
        req(request: { method: string; url: string }) {
          return {
            method: request.method,
            url: request.url.split('?')[0] ?? '/',
          };
        },
      },
    },
    trustProxy: true,
  };
}

export async function configureHttpBoundary(
  app: NestFastifyApplication,
  environment: Pick<ApiEnvironment, 'CORS_ORIGIN'>,
  auth: Pick<AuthEnvironment, 'WEB_APP_URL'>,
): Promise<void> {
  if (environment.CORS_ORIGIN !== auth.WEB_APP_URL) {
    throw new Error('CORS_ORIGIN and WEB_APP_URL must have the same origin');
  }
  await app.register(fastifyCookie);
  app.enableCors({
    allowedHeaders: [
      'content-type',
      'x-csrf-token',
      'idempotency-key',
      'last-event-id',
    ],
    exposedHeaders: ['x-request-id'],
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    origin: environment.CORS_ORIGIN,
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      reply.header('x-request-id', request.id);
      done();
    });
}
