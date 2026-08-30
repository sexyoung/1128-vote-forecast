import { afterAll, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { prisma } from './db.js';
import { forecasterCookieName, signalHash } from './identity.js';
import { disconnectRedis } from './redis.js';

const created: string[] = [];

afterAll(async () => {
  if (created.length > 0) {
    await prisma.forecaster.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.$disconnect();
  await disconnectRedis();
});

/** 每個測試用自己的指紋與 IP，才不會互相認成同一個人。 */
/** 每個訪客一個不重複的來源 IP：同一個 IP 每小時只能開 30 個身份，測試檔跑在
    一起時很容易撞到那個上限。 */
function randomIp() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

function headers(extra: Record<string, string> = {}) {
  return {
    'x-forwarded-for': randomIp(),
    ...extra,
  };
}

function readCookie(response: Response) {
  const header = response.headers.get('set-cookie') ?? '';
  return new RegExp(`${forecasterCookieName}=([^;]+)`).exec(header)?.[1] ?? '';
}

async function session(init: RequestInit = {}) {
  const response = await app.request('/api/session', init);
  const body = (await response.json()) as {
    forecaster: { id: string; displayName: string | null; predictionCount: number };
  };
  created.push(body.forecaster.id);
  return { response, body, cookie: readCookie(response) };
}

describe('forecaster identity', () => {
  it('issues an identity and a cookie to a first-time visitor', async () => {
    const { response, body, cookie } = await session({ headers: headers() });

    expect(response.status).toBe(200);
    expect(body.forecaster.id).toMatch(/^c/);
    expect(body.forecaster.displayName).toMatch(/^[\u3400-\u9fff]{2,3}$/);
    expect(body.forecaster.predictionCount).toBe(0);
    expect(cookie).not.toBe('');
    // cookie 只能給伺服器看，前端不該讀得到它。
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('keeps the same identity when the cookie comes back', async () => {
    const first = await session({ headers: headers() });
    const second = await session({
      headers: headers({ cookie: `${forecasterCookieName}=${first.cookie}` }),
    });

    expect(second.body.forecaster.id).toBe(first.body.forecaster.id);
    // 認得出來就別換：每次換等於每次多一列 COOKIE signal。
    expect(second.response.headers.get('set-cookie')).toBeNull();
    const signals = await prisma.forecasterSignal.count({
      where: { forecasterId: first.body.forecaster.id, kind: 'COOKIE' },
    });
    expect(signals).toBe(1);
  });

  it('recovers the identity from the fingerprint after the cookie is cleared', async () => {
    const fingerprint = `fp-${crypto.randomUUID()}`;
    const first = await session({ headers: headers({ 'x-forecaster-fingerprint': fingerprint }) });

    // 沒有 cookie，只剩指紋——這就是使用者清掉瀏覽器資料之後的樣子。
    const second = await session({ headers: headers({ 'x-forecaster-fingerprint': fingerprint }) });

    expect(second.body.forecaster.id).toBe(first.body.forecaster.id);
    expect(second.cookie).not.toBe('');
    expect(second.cookie).not.toBe(first.cookie);
  });

  it('does not guess when one fingerprint belongs to more than one identity', async () => {
    const fingerprint = `fp-${crypto.randomUUID()}`;
    const hash = signalHash(fingerprint);
    const first = await session({ headers: headers({ 'x-forecaster-fingerprint': fingerprint }) });

    // 同型號同版本的第二台裝置：指紋一樣，但不是同一個人。
    const other = await prisma.forecaster.create({ data: {} });
    created.push(other.id);
    await prisma.forecasterSignal.create({
      data: { forecasterId: other.id, kind: 'FINGERPRINT', hash },
    });

    const third = await session({ headers: headers({ 'x-forecaster-fingerprint': fingerprint }) });

    expect(third.body.forecaster.id).not.toBe(first.body.forecaster.id);
    expect(third.body.forecaster.id).not.toBe(other.id);
  });

  it('stores signals hashed, never the fingerprint itself', async () => {
    const fingerprint = `fp-${crypto.randomUUID()}`;
    const { body } = await session({
      headers: headers({ 'x-forecaster-fingerprint': fingerprint }),
    });

    const signals = await prisma.forecasterSignal.findMany({
      where: { forecasterId: body.forecaster.id },
    });
    const kinds = signals.map(({ kind }) => kind).sort();

    expect(kinds).toEqual(['COOKIE', 'FINGERPRINT', 'IP']);
    expect(signals.map(({ hash }) => hash)).toContain(signalHash(fingerprint));
    expect(signals.map(({ hash }) => hash)).not.toContain(fingerprint);
  });

  it('ignores a fingerprint header too short to be one', async () => {
    const { body } = await session({ headers: headers({ 'x-forecaster-fingerprint': 'abc' }) });

    const signals = await prisma.forecasterSignal.findMany({
      where: { forecasterId: body.forecaster.id, kind: 'FINGERPRINT' },
    });
    expect(signals).toHaveLength(0);
  });

  it('leaves the health check open, with no identity attached', async () => {
    const response = await app.request('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
