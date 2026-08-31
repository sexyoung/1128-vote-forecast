import { afterAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { getRegisteredContest } from './contest-registry.js';
import { databaseSchema, prisma } from './db.js';
import { forecasterCookieName } from './identity.js';
import { getPredictionTargets } from './prediction-targets.js';
import { cacheDelete, disconnectRedis } from './redis.js';
import { keysAffectedBy } from './snapshot-keys.js';

// 用真的選區，但每次測試都自己清乾淨。單一席次用臺北市長，複數席次用臺北市
// 議員第 1 選舉區（應選 12 席），複數席次的規則只有在那種選區才看得出來。
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

const singleSeat = requireContest('TPE-EXECUTIVE-1');
const multiSeat = requireContest('TPE-COUNCIL-1');

const forecasters: string[] = [];

async function reset() {
  if (databaseSchema !== 'vote_forecast_test') {
    throw new Error('拒絕清除非測試資料庫。');
  }
  await prisma.prediction.deleteMany({
    where: { contestId: { in: [singleSeat.id, multiSeat.id] } },
  });
  await prisma.contestTally.deleteMany({
    where: { contestId: { in: [singleSeat.id, multiSeat.id] } },
  });
  await prisma.contestSummary.deleteMany({
    where: { contestId: { in: [singleSeat.id, multiSeat.id] } },
  });
  await cacheDelete(
    ...keysAffectedBy(singleSeat.id, singleSeat.jurisdictionId),
    ...keysAffectedBy(multiSeat.id, multiSeat.jurisdictionId),
  );
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

/** 開一個帶著自己 cookie 的使用者，之後每次請求都是同一個人。 */
async function newVisitor() {
  const response = await app.request('/api/session', {
    headers: { 'x-forwarded-for': randomIp() },
  });
  const body = (await response.json()) as { forecaster: { id: string } };
  forecasters.push(body.forecaster.id);
  const cookie = /vf_fid=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';

  return {
    id: body.forecaster.id,
    async predict(contestId: string, targetIds: string[]) {
      const result = await app.request(`/api/contests/${contestId}/prediction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `${forecasterCookieName}=${cookie}`,
        },
        body: JSON.stringify({ targetIds }),
      });
      return { status: result.status, body: await result.json() };
    },
    async read(contestId: string) {
      const result = await app.request(`/api/contests/${contestId}`, {
        headers: { cookie: `${forecasterCookieName}=${cookie}` },
      });
      return { status: result.status, body: await result.json() };
    },
    async batch(contestIds: string[]) {
      const ids = encodeURIComponent(contestIds.join(','));
      const result = await app.request(`/api/contests?ids=${ids}`, {
        headers: { cookie: `${forecasterCookieName}=${cookie}` },
      });
      return { status: result.status, body: await result.json() };
    },
    async mine() {
      const result = await app.request('/api/me/predictions', {
        headers: { cookie: `${forecasterCookieName}=${cookie}` },
      });
      return (await result.json()) as { predictions: { contest: { id: string } }[] };
    },
  };
}

const singleTargets = getPredictionTargets(singleSeat).map(({ targetId }) => targetId);
const multiTargets = getPredictionTargets(multiSeat).map(({ targetId }) => targetId);

describe('submitting a prediction', () => {
  it('stores one prediction and counts it once', async () => {
    const visitor = await newVisitor();
    const { status, body } = await visitor.predict(singleSeat.id, [singleTargets[0]]);

    expect(status).toBe(201);
    expect(body.mine.targetIds).toEqual([singleTargets[0]]);
    expect(body.tally.totalPredictions).toBe(1);
    expect(body.tally.rows[0]).toMatchObject({
      targetId: singleTargets[0],
      count: 1,
      percent: 100,
    });
  });

  it('records the party behind the placeholder candidate', async () => {
    const visitor = await newVisitor();
    await visitor.predict(singleSeat.id, [singleTargets[0]]);

    const picks = await prisma.predictionPick.findMany({
      where: { prediction: { forecasterId: visitor.id, contestId: singleSeat.id } },
    });
    // 名單公布後要靠 partyId 才對得回真候選人，所以現在就得存下來。
    expect(picks[0].partyId).toBe(getPredictionTargets(singleSeat)[0].partyId);
    expect(picks[0].targetType).toBe('CANDIDATE');
  });

  it('replaces the earlier pick instead of adding a second prediction', async () => {
    const visitor = await newVisitor();
    await visitor.predict(singleSeat.id, [singleTargets[0]]);
    const second = await visitor.predict(singleSeat.id, [singleTargets[1]]);

    expect(second.status).toBe(200);
    expect(second.body.tally.totalPredictions).toBe(1);
    // 舊的那一票要收回去，不能兩邊都算。
    expect(second.body.tally.rows).toHaveLength(1);
    expect(second.body.tally.rows[0]).toMatchObject({ targetId: singleTargets[1], count: 1 });

    const predictions = await prisma.prediction.count({
      where: { forecasterId: visitor.id, contestId: singleSeat.id },
    });
    expect(predictions).toBe(1);
  });

  it('keeps the replaced picks as a revision', async () => {
    const visitor = await newVisitor();
    await visitor.predict(singleSeat.id, [singleTargets[0]]);
    await visitor.predict(singleSeat.id, [singleTargets[1]]);

    const revisions = await prisma.predictionRevision.findMany({
      where: { prediction: { forecasterId: visitor.id, contestId: singleSeat.id } },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].version).toBe(1);
    expect(revisions[0].picks).toEqual([expect.objectContaining({ targetId: singleTargets[0] })]);
  });

  it('adds up predictions from different people', async () => {
    const first = await newVisitor();
    const second = await newVisitor();
    await first.predict(singleSeat.id, [singleTargets[0]]);
    const { body } = await second.predict(singleSeat.id, [singleTargets[0]]);

    expect(body.tally.totalPredictions).toBe(2);
    expect(body.tally.rows[0]).toMatchObject({ count: 2, percent: 100 });
  });

  it('takes fewer picks than seats, but never more', async () => {
    const visitor = await newVisitor();

    // 12 席的選區挑 3 位也是有效的判斷，不必逼人挑滿。
    const partial = await visitor.predict(multiSeat.id, multiTargets.slice(0, 3));
    expect(partial.status).toBe(201);
    expect(partial.body.tally.rows).toHaveLength(3);

    const tooMany = await visitor.predict(multiSeat.id, multiTargets.slice(0, multiSeat.seats + 1));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toContain('12');

    const empty = await visitor.predict(multiSeat.id, []);
    expect(empty.status).toBe(400);
  });

  it('rejects the same candidate twice', async () => {
    const visitor = await newVisitor();
    const picks = [singleTargets[0], singleTargets[0]];
    const { status } = await visitor.predict(multiSeat.id, [
      ...picks,
      ...multiTargets.slice(0, multiSeat.seats - 2),
    ]);

    expect(status).toBe(400);
  });

  it('rejects a candidate who is not in this contest', async () => {
    const visitor = await newVisitor();
    const { status, body } = await visitor.predict(singleSeat.id, ['NTP-EXECUTIVE-1-CANDIDATE-1']);

    expect(status).toBe(400);
    expect(body.error).toContain('不在這一區');
  });

  it('rejects a contest nobody issued', async () => {
    const visitor = await newVisitor();
    const { status } = await visitor.predict('TPE-COUNCIL-99', [singleTargets[0]]);

    expect(status).toBe(404);
  });
});

describe('reading predictions back', () => {
  it('returns candidates in card lists before anyone predicts', async () => {
    const visitor = await newVisitor();
    const { status, body } = await visitor.batch([singleSeat.id]);

    expect(status).toBe(200);
    expect(body.tallies[singleSeat.id].rows).toEqual([]);
    expect(body.tallies[singleSeat.id].targets).toHaveLength(singleTargets.length);
  });

  it('returns my own pick alongside the tally', async () => {
    const visitor = await newVisitor();
    await visitor.predict(singleSeat.id, [singleTargets[2]]);
    const { body } = await visitor.read(singleSeat.id);

    expect(body.contest.id).toBe(singleSeat.id);
    expect(body.mine.targetIds).toEqual([singleTargets[2]]);
    expect(body.targets).toHaveLength(singleTargets.length);
    // 統計列要帶得出名字與顏色，前端才不用自己再查一次。
    expect(body.tally.rows[0].label).toBeTruthy();
    expect(body.tally.rows[0].color).toBeTruthy();
  });

  it('shows nothing of mine to someone else', async () => {
    const owner = await newVisitor();
    const stranger = await newVisitor();
    await owner.predict(singleSeat.id, [singleTargets[0]]);

    const { body } = await stranger.read(singleSeat.id);
    expect(body.mine).toBeNull();
    expect(body.tally.totalPredictions).toBe(1);
  });

  it('lists every contest I predicted', async () => {
    const visitor = await newVisitor();
    await visitor.predict(singleSeat.id, [singleTargets[0]]);
    await visitor.predict(multiSeat.id, multiTargets.slice(0, multiSeat.seats));

    const { predictions } = await visitor.mine();
    expect(predictions.map(({ contest }) => contest.id).sort()).toEqual(
      [singleSeat.id, multiSeat.id].sort(),
    );
  });
});
