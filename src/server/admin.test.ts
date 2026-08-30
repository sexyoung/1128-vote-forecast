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

describe('admin forecasters', () => {
  it('returns at most 50 forecasters per page', async () => {
    const response = await app.request('/api/admin/forecasters?page=1', {
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    const body = (await response.json()) as {
      items: unknown[];
      page: number;
      pageSize: number;
      totalPages: number;
    };

    expect(response.status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.items.length).toBeLessThanOrEqual(50);
    expect(body.totalPages).toBeGreaterThanOrEqual(1);
  });
});
