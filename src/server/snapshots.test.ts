import { afterAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { getRegisteredContest } from './contest-registry.js';
import { prisma } from './db.js';
import { forecasterCookieName } from './identity.js';
import { getPredictionTargets } from './prediction-targets.js';
import { cacheDelete, disconnectRedis } from './redis.js';
import { contestKey, jurisdictionKey, nationalKey } from './snapshot-keys.js';
import { refreshHotSnapshots } from './snapshots.js';

function requireContest(contestId: string) {
  const contest = getRegisteredContest(contestId);
  if (!contest) throw new Error(`清冊裡少了測試要用的選區 ${contestId}`);
  return contest;
}

const mayor = requireContest('HUA-EXECUTIVE-1');
const targets = getPredictionTargets(mayor).map(({ targetId }) => targetId);
const forecasters: string[] = [];

async function reset() {
  await prisma.prediction.deleteMany({ where: { contestId: mayor.id } });
  await prisma.contestTally.deleteMany({ where: { contestId: mayor.id } });
  await prisma.contestSummary.deleteMany({ where: { contestId: mayor.id } });
  await cacheDelete(nationalKey, contestKey(mayor.id), jurisdictionKey('HUA', 'EXECUTIVE'));
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

/** 每個訪客一個不重複的來源 IP：同一個 IP 每小時只能開 30 個身份，測試檔跑在
    一起時很容易撞到那個上限。 */
function randomIp() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

async function predict(targetId: string) {
  const session = await app.request('/api/session', {
    headers: { 'x-forwarded-for': randomIp() },
  });
  const body = (await session.json()) as { forecaster: { id: string } };
  forecasters.push(body.forecaster.id);
  const cookie = /vf_fid=([^;]+)/.exec(session.headers.get('set-cookie') ?? '')?.[1] ?? '';

  await app.request(`/api/contests/${mayor.id}/prediction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `${forecasterCookieName}=${cookie}` },
    body: JSON.stringify({ targetIds: [targetId] }),
  });
}

async function nationalMap() {
  const response = await app.request('/api/map/national');
  return (await response.json()) as {
    cells: { contestId: string; party: string; percent: number; total: number }[];
  };
}

describe('map snapshots', () => {
  it('reports the leading party for a jurisdiction', async () => {
    await predict(targets[1]);
    const { cells } = await nationalMap();
    const cell = cells.find((item) => item.contestId === mayor.id);

    expect(cell).toMatchObject({
      party: getPredictionTargets(mayor)[1].partyId,
      percent: 100,
      total: 1,
    });
  });

  it('shows a new prediction straight away, because writing clears the snapshot', async () => {
    await predict(targets[0]);
    await nationalMap(); // 先讓快照寫進 Redis
    await predict(targets[0]);

    const { cells } = await nationalMap();
    expect(cells.find((item) => item.contestId === mayor.id)?.total).toBe(2);
  });

  it('skips contests nobody has predicted', async () => {
    const { cells } = await nationalMap();
    expect(cells.find((item) => item.contestId === mayor.id)).toBeUndefined();
  });

  it('serves a drill-down level, and rejects one that does not exist', async () => {
    await predict(targets[0]);

    const level = await app.request('/api/map/HUA?level=EXECUTIVE');
    const body = (await level.json()) as { cells: { contestId: string }[] };
    expect(level.status).toBe(200);
    expect(body.cells.map(({ contestId }) => contestId)).toContain(mayor.id);

    const bad = await app.request('/api/map/HUA?level=PRESIDENT');
    expect(bad.status).toBe(400);
  });

  it('rebuilds only what was read this round', async () => {
    await predict(targets[0]);
    // 讀過縣市層，它才會進追蹤集合。
    await app.request('/api/map/HUA?level=EXECUTIVE');

    const key = jurisdictionKey('HUA', 'EXECUTIVE');
    // 用「這個 key 在不在」判斷而不是數量：追蹤集合是共用的，同時跑的測試檔也會
    // 把自己讀過的 key 放進去。
    expect(await refreshHotSnapshots()).toContain(key);

    // 集合取出後就清空，這一輪沒人讀它就不會再重算。
    const second = await refreshHotSnapshots();
    expect(second).not.toContain(key);
    expect(second).toContain(nationalKey);
  });
});
