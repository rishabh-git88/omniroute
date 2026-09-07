import type { HealthResponse } from '@omniroute/types';

export function GET(): Response {
  const response: HealthResponse = {
    service: 'web',
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  };

  return Response.json(response);
}
