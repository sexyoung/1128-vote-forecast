import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { prisma } from './db.js';
import { env } from './env.js';

const adminHeaders = { authorization: `Bearer ${env.adminToken}` };

describe('admin overview', () => {
  it('returns both dependency health fields', async () => {
    const response = await app.request('/api/admin/overview', {
      headers: adminHeaders,
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
      headers: adminHeaders,
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

describe('admin forecaster detail', () => {
  const forecasterId = `admin-detail-${Date.now()}`;
  const predictionId = `${forecasterId}-prediction`;
  const commentId = `${forecasterId}-comment`;

  beforeAll(async () => {
    await prisma.forecaster.create({
      data: {
        id: forecasterId,
        displayName: '測試預測者',
        lastIp: '203.0.113.42',
        lastIpAt: new Date(),
        lastCountry: 'TW',
        lastRegion: 'TPE',
        lastCity: '臺北市',
        lastGeoSource: 'VERCEL',
        signals: {
          create: {
            kind: 'IP',
            hash: 'abcdef1234567890abcdef1234567890',
            seenCount: 3,
          },
        },
        predictions: {
          create: {
            id: predictionId,
            contestId: 'TPE-EXECUTIVE-1',
            seatCount: 1,
          },
        },
        comments: {
          create: {
            id: commentId,
            contestId: 'TPE-EXECUTIVE-1',
            body: '後台詳情測試留言',
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.forecaster.deleteMany({ where: { id: forecasterId } });
  });

  it('returns profile, activity counts, and privacy-safe signal codes', async () => {
    const response = await app.request(`/api/admin/forecasters/${forecasterId}`, {
      headers: adminHeaders,
    });
    const body = (await response.json()) as {
      forecaster: {
        counts: { predictions: number; comments: number; signals: number };
        lastIp: string | null;
        lastCountry: string | null;
        lastCity: string | null;
        signals: { kind: string; code: string; seenCount: number }[];
      };
    };

    expect(response.status).toBe(200);
    expect(body.forecaster.counts).toMatchObject({ predictions: 1, comments: 1, signals: 1 });
    expect(body.forecaster).toMatchObject({
      lastIp: '203.0.113.42',
      lastCountry: 'TW',
      lastCity: '臺北市',
    });
    expect(body.forecaster.signals).toContainEqual(
      expect.objectContaining({ kind: 'IP', code: 'abcdef123456', seenCount: 3 }),
    );
  });

  it('returns predictions and comments on separate paginated endpoints', async () => {
    const [predictions, comments] = await Promise.all([
      app.request(`/api/admin/forecasters/${forecasterId}/predictions`, {
        headers: adminHeaders,
      }),
      app.request(`/api/admin/forecasters/${forecasterId}/comments`, {
        headers: adminHeaders,
      }),
    ]);
    const predictionBody = (await predictions.json()) as { items: { id: string }[] };
    const commentBody = (await comments.json()) as { items: { id: string; body: string }[] };

    expect(predictions.status).toBe(200);
    expect(comments.status).toBe(200);
    expect(predictionBody.items).toContainEqual(expect.objectContaining({ id: predictionId }));
    expect(commentBody.items).toContainEqual(
      expect.objectContaining({ id: commentId, body: '後台詳情測試留言' }),
    );
  });

  it('blocks and unblocks the forecaster from the admin API', async () => {
    const blocked = await app.request(`/api/admin/forecasters/${forecasterId}/block`, {
      method: 'POST',
      headers: adminHeaders,
    });
    expect(blocked.status).toBe(200);
    expect(
      (await prisma.forecaster.findUnique({ where: { id: forecasterId } }))?.blockedAt,
    ).toBeInstanceOf(Date);

    const unblocked = await app.request(`/api/admin/forecasters/${forecasterId}/unblock`, {
      method: 'POST',
      headers: adminHeaders,
    });
    expect(unblocked.status).toBe(200);
    expect(
      (await prisma.forecaster.findUnique({ where: { id: forecasterId } }))?.blockedAt,
    ).toBeNull();
  });
});
