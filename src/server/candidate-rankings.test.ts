import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { listBattlegroundRankings } from './candidate-rankings.js';
import { databaseSchema, prisma } from './db.js';
import { cacheDelete } from './redis.js';
import { battlegroundRankingsKey } from './snapshot-keys.js';

const candidates = [
  { id: 'BATTLE-TPE-1', contestId: 'TPE-EXECUTIVE-1', partyId: 'DPP', count: 10_001 },
  { id: 'BATTLE-TPE-2', contestId: 'TPE-EXECUTIVE-1', partyId: 'KMT', count: 10_000 },
  { id: 'BATTLE-NTP-1', contestId: 'NTP-EXECUTIVE-1', partyId: 'DPP', count: 10_000 },
  { id: 'BATTLE-NTP-2', contestId: 'NTP-EXECUTIVE-1', partyId: 'KMT', count: 9_000 },
  { id: 'BATTLE-MULTI-1', contestId: 'TPE-COUNCIL-2', partyId: 'DPP', count: 20_000 },
  { id: 'BATTLE-MULTI-2', contestId: 'TPE-COUNCIL-2', partyId: 'KMT', count: 20_000 },
];
const candidateIds = candidates.map(({ id }) => id);

beforeAll(async () => {
  if (databaseSchema !== 'vote_forecast_test') throw new Error('拒絕寫入非測試資料庫。');
  await prisma.contestTally.deleteMany({ where: { targetId: { in: candidateIds } } });
  await prisma.candidate.deleteMany({ where: { id: { in: candidateIds } } });
  await prisma.candidate.createMany({
    data: candidates.map(({ count: _count, ...candidate }, index) => ({
      ...candidate,
      name: `激戰選區測試候選人${index + 1}`,
      ballotNo: 9001 + index,
    })),
  });
  await prisma.contestTally.createMany({
    data: candidates.map(({ id: targetId, contestId, count }) => ({
      contestId,
      targetType: 'CANDIDATE',
      targetId,
      count,
    })),
  });
  await cacheDelete(battlegroundRankingsKey());
});

afterAll(async () => {
  await prisma.contestTally.deleteMany({ where: { targetId: { in: candidateIds } } });
  await prisma.candidate.deleteMany({ where: { id: { in: candidateIds } } });
  await prisma.$disconnect();
});

describe('battleground rankings', () => {
  it('ranks single-seat contests by the gap between first and second place', async () => {
    const result = await listBattlegroundRankings();
    const taipei = result.contests.find(({ contest }) => contest.id === 'TPE-EXECUTIVE-1');
    const newTaipei = result.contests.find(({ contest }) => contest.id === 'NTP-EXECUTIVE-1');

    expect(taipei).toMatchObject({ gapPercent: 0.005 });
    expect(taipei?.candidates.slice(0, 2)).toMatchObject([
      { id: 'BATTLE-TPE-1', predictionCount: 10_001, party: { name: '民主進步黨' } },
      { id: 'BATTLE-TPE-2', predictionCount: 10_000, party: { name: '中國國民黨' } },
    ]);
    expect(newTaipei).toBeDefined();
    expect(taipei!.rank).toBeLessThan(newTaipei!.rank);
    expect(result.contests.some(({ contest }) => contest.id === 'TPE-COUNCIL-2')).toBe(false);
    expect(result.contests.length).toBeLessThanOrEqual(20);
  });
});
