import { describe, expect, it } from 'vitest';

import { GET } from './route';

describe('web health route', () => {
  it('reports web health', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: 'web',
      status: 'ok',
    });
  });
});
