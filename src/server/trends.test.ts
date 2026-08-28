import { afterAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { getRegisteredContest } from './contest-registry.js';
import { prisma } from './db.js';
import { forecasterCookieName } from './identity.js';
import { getPredictionTargets } from './prediction-targets.js';
import { disconnectRedis } from './redis.js';
import { captureDailySnapshot, hasSnapshotFor, readTrend, today } from './trends.js';

/** 每個訪客一個不重複的來源 IP：同一個 IP 每小時只能開 30 個身份，測試檔跑在
    一起時很容易撞到那個上限。 */
function randomIp() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

function requireContest(contestId: string) {
  const contest = getRegisteredContest(contestId);
  if (!contest) throw new Error(`清冊裡少了測試要用的選區 ${contestId}`);
  return contest;
}

const contest = requireContest('TTT-EXECUTIVE-1');
const targets = getPredictionTargets(contest).map(({ targetId }) => targetId);
const forecasters: string[] = [];

function daysAgo(days: number) {
  return new Date(today().getTime() - days * 24 * 60 * 60 * 1000);
}

async function reset() {
  await prisma.prediction.deleteMany({ where: { contestId: contest.id } });
  await prisma.contestTally.deleteMany({ where: { contestId: contest.id } });
  await prisma.contestSummary.deleteMany({ where: { contestId: contest.id } });
  await prisma.contestTallySnapshot.deleteMany({ where: { contestId: contest.id } });
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

async function predict(targetId: string) {
  const session = await app.request('/api/session', {
    headers: { 'x-forwarded-for': randomIp() },
  });
  const body = (await session.json()) as { forecaster: { id: string } };
  forecasters.push(body.forecaster.id);
  const cookie = /vf_fid=([^;]+)/.exec(session.headers.get('set-cookie') ?? '')?.[1] ?? '';
  await app.request(`/api/contests/${contest.id}/prediction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `${forecasterCookieName}=${cookie}` },
    body: JSON.stringify({ targetIds: [targetId] }),
  });
}

describe('daily trend snapshot', () => {
  it('copies only the contests that have predictions', async () => {
    await predict(targets[0]);
    const rows = await captureDailySnapshot();

    expect(rows).toBeGreaterThan(0);
    const stored = await prisma.contestTallySnapshot.findMany({
      where: { contestId: contest.id },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ targetId: targets[0], count: 1 });
  });

  it('can be re-run for the same day without doubling the numbers', async () => {
    await predict(targets[0]);
    await captureDailySnapshot();
    await predict(targets[0]);
    await captureDailySnapshot();

    const stored = await prisma.contestTallySnapshot.findMany({ where: { contestId: contest.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].count).toBe(2);
  });

  it('knows whether today has been captured', async () => {
    await predict(targets[0]);
    await prisma.contestTallySnapshot.deleteMany({ where: { capturedOn: today() } });
    expect(await hasSnapshotFor()).toBe(false);
    await captureDailySnapshot();
    expect(await hasSnapshotFor()).toBe(true);
  });
});

describe('reading a trend', () => {
  it('ends the line on the live number, not yesterday’s snapshot', async () => {
    await prisma.contestTallySnapshot.create({
      data: {
        contestId: contest.id,
        capturedOn: daysAgo(1),
        targetType: 'CANDIDATE',
        targetId: targets[0],
        count: 5,
      },
    });
    await predict(targets[0]);

    const series = await readTrend(contest.id, 30);
    const line = series.find((item) => item.targetId === targets[0]);

    expect(line?.points).toHaveLength(2);
    expect(line?.points[0].count).toBe(5);
    // 昨天 5 票，現在資料庫裡是 1 票——線的終點要是現在的數字。
    expect(line?.points[1].count).toBe(1);
    expect(line?.points[1].date).toBe(today().toISOString().slice(0, 10));
  });

  it('leaves out days beyond the window', async () => {
    await prisma.contestTallySnapshot.createMany({
      data: [40, 3].map((days) => ({
        contestId: contest.id,
        capturedOn: daysAgo(days),
        targetType: 'CANDIDATE' as const,
        targetId: targets[0],
        count: days,
      })),
    });

    const series = await readTrend(contest.id, 30);
    expect(series[0].points.map(({ count }) => count)).toEqual([3]);
  });

  it('serves the trend over http, clamped to a sane window', async () => {
    await predict(targets[1]);

    const response = await app.request(`/api/contests/${contest.id}/trend?days=9999`);
    const body = (await response.json()) as { days: number; series: { targetId: string }[] };

    expect(response.status).toBe(200);
    expect(body.days).toBe(180);
    expect(body.series[0].targetId).toBe(targets[1]);
  });

  it('returns nothing for a contest nobody issued', async () => {
    expect(await readTrend('TPE-COUNCIL-99', 30)).toEqual([]);
  });
});
