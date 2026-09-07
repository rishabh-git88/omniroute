export type ServiceName = 'web' | 'api' | 'ai-router';

export interface HealthResponse {
  service: ServiceName;
  status: 'ok';
  timestamp: string;
  version: string;
}
