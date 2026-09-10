import 'reflect-metadata';

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
import { config as loadEnvironment } from 'dotenv';

import { startTelemetry, stopTelemetry } from './observability/telemetry.js';
import { configureHttpBoundary, httpServerOptions } from './http-boundary.js';

async function bootstrap(): Promise<void> {
  loadEnvironment({ path: ['../../.env', '.env'], quiet: true });
  const environment = parseApiEnvironment(process.env);
  const authEnvironment = parseAuthEnvironment(process.env);
  startTelemetry();
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(httpServerOptions(environment)),
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

  await configureHttpBoundary(app, environment, authEnvironment);
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
