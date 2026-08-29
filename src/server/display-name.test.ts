import { afterAll, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { prisma } from './db.js';
import { forecasterCookieName } from './identity.js';
import { disconnectRedis } from './redis.js';

const forecasters: string[] = [];

afterAll(async () => {
  if (forecasters.length > 0) {
    await prisma.forecaster.deleteMany({ where: { id: { in: forecasters } } });
  }
  await prisma.$disconnect();
  await disconnectRedis();
});

/** 每個訪客一個不重複的來源 IP：同一個 IP 每小時只能開 30 個身份，測試檔跑在
    一起時很容易撞到那個上限。 */
function randomIp() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

async function newVisitor() {
  const response = await app.request('/api/session', {
    headers: { 'x-forwarded-for': randomIp() },
  });
  const body = (await response.json()) as { forecaster: { id: string } };
  forecasters.push(body.forecaster.id);
  const cookie = /vf_fid=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
  return {
    id: body.forecaster.id,
    headers: { 'Content-Type': 'application/json', cookie: `${forecasterCookieName}=${cookie}` },
  };
}

describe('display name', () => {
  it('saves a name and clears it again', async () => {
    const visitor = await newVisitor();

    const saved = await app.request('/api/me', {
      method: 'PUT',
      headers: visitor.headers,
      body: JSON.stringify({ displayName: '  選情觀察  ' }),
    });
    expect(await saved.json()).toEqual({ displayName: '選情觀察' });

    const cleared = await app.request('/api/me', {
      method: 'PUT',
      headers: visitor.headers,
      body: JSON.stringify({ displayName: '' }),
    });
    expect(await cleared.json()).toEqual({ displayName: null });
  });

  it('rejects a name longer than the column', async () => {
    const visitor = await newVisitor();
    const response = await app.request('/api/me', {
      method: 'PUT',
      headers: visitor.headers,
      body: JSON.stringify({ displayName: '一'.repeat(25) }),
    });
    expect(response.status).toBe(400);
  });
});
