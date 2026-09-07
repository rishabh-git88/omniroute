import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { parseApiEnvironment } from '@omniroute/config/api';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const environment = parseApiEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      trustProxy: true,
    }),
  );

  app.enableCors({
    credentials: true,
    origin: environment.CORS_ORIGIN,
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix('v1');

  await app.listen(environment.API_PORT, environment.API_HOST);
  Logger.log(
    `API listening on ${environment.API_HOST}:${environment.API_PORT}`,
    'Bootstrap',
  );
}

void bootstrap();
