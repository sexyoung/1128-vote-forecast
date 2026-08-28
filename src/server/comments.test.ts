import { afterAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { forecasterCookieName } from './identity.js';
import { disconnectRedis } from './redis.js';

const contestId = 'CYI-EXECUTIVE-1';
const forecasters: string[] = [];

async function reset() {
  await prisma.comment.deleteMany({ where: { contestId } });
  await prisma.report.deleteMany({ where: { reporterId: { in: forecasters } } });
}

beforeEach(reset);

afterAll(async () => {
  await reset();
  if (forecasters.length > 0) {
    await prisma.forecaster.deleteMany({ where: { id: { in: forecasters } } });
  }
  await prisma.$disconnect();
  await disconnectRedis();
});

async function newVisitor() {
  const response = await app.request('/api/session', {
    headers: { 'x-forwarded-for': `198.18.0.${Math.floor(Math.random() * 200) + 1}` },
  });
  const body = (await response.json()) as { forecaster: { id: string } };
  forecasters.push(body.forecaster.id);
  const cookie = /vf_fid=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const headers = {
    'Content-Type': 'application/json',
    cookie: `${forecasterCookieName}=${cookie}`,
  };

  return {
    id: body.forecaster.id,
    headers,
    async comment(text: string, parentId?: string) {
      const result = await app.request(`/api/contests/${contestId}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: text, parentId }),
      });
      return { status: result.status, body: await result.json() };
    },
  };
}

const admin = { authorization: `Bearer ${env.adminToken}` };

describe('comments', () => {
  it('posts a comment and shows who wrote it', async () => {
    const visitor = await newVisitor();
    await app.request('/api/me', {
      method: 'PUT',
      headers: visitor.headers,
      body: JSON.stringify({ displayName: '山線居民' }),
    });

    const { status, body } = await visitor.comment('這一區的變化比上週明顯。');
    expect(status).toBe(201);
    expect(body.comment.author.displayName).toBe('山線居民');
    // 名字會重複，系統配發的短碼不會。
    expect(body.comment.author.code).toMatch(/^#[0-9A-Z]{4}$/);
  });

  it('rejects an empty comment', async () => {
    const visitor = await newVisitor();
    expect((await visitor.comment('   ')).status).toBe(400);
  });

  it('lists newest first and pages with a time cursor', async () => {
    const visitor = await newVisitor();
    for (let index = 0; index < 3; index += 1) await visitor.comment(`第 ${index} 則`);

    const response = await app.request(`/api/contests/${contestId}/comments`);
    const body = (await response.json()) as {
      comments: { body: string }[];
      nextCursor: string | null;
    };

    expect(body.comments[0].body).toBe('第 2 則');
    expect(body.comments).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
  });

  it('keeps a reply in the same contest and only one level deep', async () => {
    const visitor = await newVisitor();
    const top = await visitor.comment('第一層');
    const reply = await visitor.comment('第二層', top.body.comment.id);
    expect(reply.status).toBe(201);

    // 兩層以上的縮排在手機上會排不下。
    const third = await visitor.comment('第三層', reply.body.comment.id);
    expect(third.status).toBe(400);
  });

  it('hides a deleted comment but keeps the row', async () => {
    const visitor = await newVisitor();
    const { body } = await visitor.comment('等一下就刪');

    const removed = await app.request(`/api/comments/${body.comment.id}`, {
      method: 'DELETE',
      headers: visitor.headers,
    });
    expect(removed.status).toBe(200);

    const list = await app.request(`/api/contests/${contestId}/comments`);
    expect(((await list.json()) as { comments: unknown[] }).comments).toHaveLength(0);
    expect(await prisma.comment.findUnique({ where: { id: body.comment.id } })).not.toBeNull();
  });

  it('will not let someone delete another person’s comment', async () => {
    const owner = await newVisitor();
    const stranger = await newVisitor();
    const { body } = await owner.comment('不是你的');

    const response = await app.request(`/api/comments/${body.comment.id}`, {
      method: 'DELETE',
      headers: stranger.headers,
    });
    expect(response.status).toBe(404);
  });
});

describe('reports and takedown', () => {
  it('files a report and only counts it once per person', async () => {
    const author = await newVisitor();
    const reporter = await newVisitor();
    const { body } = await author.comment('被檢舉的內容');

    const send = () =>
      app.request('/api/reports', {
        method: 'POST',
        headers: reporter.headers,
        body: JSON.stringify({
          targetType: 'COMMENT',
          targetId: body.comment.id,
          reason: 'ABUSE',
        }),
      });

    expect((await send()).status).toBe(201);
    await send();
    const open = await prisma.report.count({
      where: { reporterId: reporter.id, targetId: body.comment.id, status: 'OPEN' },
    });
    expect(open).toBe(1);
  });

  it('rejects a report with a reason we do not recognise', async () => {
    const reporter = await newVisitor();
    const response = await app.request('/api/reports', {
      method: 'POST',
      headers: reporter.headers,
      body: JSON.stringify({ targetType: 'COMMENT', targetId: 'x', reason: 'BECAUSE' }),
    });
    expect(response.status).toBe(400);
  });

  it('hides a comment from the admin side and closes its reports', async () => {
    const author = await newVisitor();
    const reporter = await newVisitor();
    const { body } = await author.comment('要被下架的內容');
    await app.request('/api/reports', {
      method: 'POST',
      headers: reporter.headers,
      body: JSON.stringify({ targetType: 'COMMENT', targetId: body.comment.id, reason: 'ILLEGAL' }),
    });

    const hidden = await app.request(`/api/admin/comments/${body.comment.id}/hide`, {
      method: 'POST',
      headers: admin,
    });
    expect(hidden.status).toBe(200);

    const list = await app.request(`/api/contests/${contestId}/comments`);
    expect(((await list.json()) as { comments: unknown[] }).comments).toHaveLength(0);
    expect(
      await prisma.report.count({ where: { targetId: body.comment.id, status: 'OPEN' } }),
    ).toBe(0);
  });

  it('turns away the admin endpoints without the token', async () => {
    const response = await app.request('/api/admin/reports');
    expect(response.status).toBe(401);
  });

  it('blocks an avatar without touching the identity', async () => {
    const visitor = await newVisitor();
    const response = await app.request(`/api/admin/forecasters/${visitor.id}/avatar-block`, {
      method: 'POST',
      headers: admin,
    });
    expect(response.status).toBe(200);

    const stored = await prisma.forecaster.findUnique({ where: { id: visitor.id } });
    expect(stored?.avatarBlockedAt).not.toBeNull();
    expect(stored?.blockedAt).toBeNull();
  });

  it('stops a blocked identity from commenting', async () => {
    const visitor = await newVisitor();
    await app.request(`/api/admin/forecasters/${visitor.id}/block`, {
      method: 'POST',
      headers: admin,
    });

    expect((await visitor.comment('還想說話')).status).toBe(403);
  });
});
