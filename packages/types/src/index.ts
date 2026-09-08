export type ServiceName = 'web' | 'api' | 'ai-router';

export interface HealthResponse {
  service: ServiceName;
  status: 'ok';
  timestamp: string;
  version: string;
}

export const AUTH_SESSION_COOKIE = 'omniroute_session';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthenticatedWorkspace {
  id: string;
  name: string;
}

export interface CurrentUserResponse {
  csrfToken: string;
  user: AuthenticatedUser;
  workspace: AuthenticatedWorkspace;
}
