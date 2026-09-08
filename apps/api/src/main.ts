import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  parseApiEnvironment,
  parseAuthEnvironment,
} from '@omniroute/config/api';
import fastifyCookie from '@fastify/cookie';
import { config as loadEnvironment } from 'dotenv';

import { startTelemetry, stopTelemetry } from './observability/telemetry.js';

async function bootstrap(): Promise<void> {
  loadEnvironment({ path: ['../../.env', '.env'], quiet: true });
  const environment = parseApiEnvironment(process.env);
  const authEnvironment = parseAuthEnvironment(process.env);
  if (
    new URL(environment.CORS_ORIGIN).origin !==
    new URL(authEnvironment.WEB_APP_URL).origin
  ) {
    throw new Error('CORS_ORIGIN and WEB_APP_URL must have the same origin');
  }
  startTelemetry();
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      genReqId: (request: IncomingMessage) => {
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
      },
      trustProxy: true,
    }),
  );

  const spans = new WeakMap<object, Span>();
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    const path = new URL(request.raw.url ?? '/', 'http://localhost').pathname;
    const span = trace
      .getTracer('omniroute.api')
      .startSpan(`${request.method} ${path}`);
    span.setAttributes({
      'http.request.method': request.method,
      'url.path': path,
      'omniroute.request_id': request.id,
    });
    spans.set(request, span);
    done();
  });
  fastify.addHook('onResponse', (request, reply, done) => {
    const span = spans.get(request);
    if (span) {
      span.setAttribute('http.response.status_code', reply.statusCode);
      if (reply.statusCode >= 500)
        span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      spans.delete(request);
    }
    done();
  });

  await app.register(fastifyCookie);
  app.enableCors({
    allowedHeaders: ['content-type', 'x-csrf-token'],
    credentials: true,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    origin: environment.CORS_ORIGIN,
  });
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onClose', async () => {
      await stopTelemetry();
    });
  app.setGlobalPrefix('v1');

  await app.listen(environment.API_PORT, environment.API_HOST);
  Logger.log(
    `API listening on ${environment.API_HOST}:${environment.API_PORT}`,
    'Bootstrap',
  );
}

void bootstrap();
