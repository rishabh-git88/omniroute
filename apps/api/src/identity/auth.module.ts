import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { parseAuthEnvironment } from '@omniroute/config/api';

import { DatabaseModule } from '../database/database.module.js';
import { CoordinationModule } from '../coordination/coordination.module.js';
import { AUTH_ENVIRONMENT } from './auth.constants.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { GoogleOAuthClient } from './google-oauth.client.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { RateLimitGuard } from './rate-limit.guard.js';

@Module({
  imports: [CoordinationModule, DatabaseModule],
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_ENVIRONMENT,
      useFactory: () => parseAuthEnvironment(process.env),
    },
    AuthCookieService,
    AuthRepository,
    AuthService,
    GoogleOAuthClient,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
