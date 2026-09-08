import type { FastifyRequest } from 'fastify';

export interface IdentityProfile {
  email: string;
  name: string | null;
  provider: string;
  providerAccountId: string;
}

export interface IdentityUser {
  email: string;
  id: string;
  name: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED' | 'DELETED';
  workspace: {
    id: string;
    name: string;
  };
}

export interface ActiveSession extends IdentityUser {
  expiresAt: Date;
  lastSeenAt: Date | null;
  sessionId: string;
  tokenHash: string;
}

export interface RequestAuthentication {
  csrfToken: string;
  sessionId: string;
  user: {
    email: string;
    id: string;
    name: string | null;
  };
  workspace: {
    id: string;
    name: string;
  };
}

export interface AuthenticatedRequest extends FastifyRequest {
  authentication?: RequestAuthentication;
}

export interface GoogleTokenClaims {
  email: string;
  name: string | null;
  subject: string;
}
