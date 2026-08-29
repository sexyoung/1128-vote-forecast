import { describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { env } from './env.js';

describe('admin overview', () => {
  it('returns both dependency health fields', async () => {
    const response = await app.request('/api/admin/overview', {
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    const overview = (await response.json()) as {
      database?: { reachable: boolean };
      redis?: { reachable: boolean };
    };

    expect(response.status).toBe(200);
    expect(overview.database?.reachable).toBe(true);
    expect(overview.redis?.reachable).toEqual(expect.any(Boolean));
  });
});
