import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { databaseSchema, prisma } from './db.js';
import { listCandidateRankings } from './candidate-rankings.js';
import { cacheDelete } from './redis.js';
import { candidateRankingsKey } from './snapshot-keys.js';

const candidateIds = ['RANKING-TEST-CANDIDATE-1', 'RANKING-TEST-CANDIDATE-2'];

beforeAll(async () => {
  if (databaseSchema !== 'vote_forecast_test') throw new Error('拒絕寫入非測試資料庫。');
  await prisma.contestTally.deleteMany({ where: { targetId: { in: candidateIds } } });
  await prisma.candidate.deleteMany({ where: { id: { in: candidateIds } } });
  await prisma.candidate.createMany({
    data: candidateIds.map((id, index) => ({
      id,
      contestId: 'TPE-COUNCIL-2',
      partyId: index ? 'KMT' : 'DPP',
      name: `排行榜測試候選人${index + 1}`,
      ballotNo: 9001 + index,
    })),
  });
  await prisma.contestTally.createMany({
    data: candidateIds.map((targetId, index) => ({
      contestId: 'TPE-COUNCIL-2',
      targetType: 'CANDIDATE',
      targetId,
      count: 10_001 - index,
    })),
  });
  await cacheDelete(candidateRankingsKey());
});

afterAll(async () => {
  await prisma.contestTally.deleteMany({ where: { targetId: { in: candidateIds } } });
  await prisma.candidate.deleteMany({ where: { id: { in: candidateIds } } });
  await prisma.$disconnect();
});

describe('candidate rankings', () => {
  it('returns active candidates from highest count to lowest', async () => {
    const result = await listCandidateRankings();

    expect(result.candidates.slice(0, 2)).toMatchObject([
      { id: candidateIds[0], rank: 1, predictionCount: 10_001, party: { name: '民主進步黨' } },
      { id: candidateIds[1], rank: 2, predictionCount: 10_000, party: { name: '中國國民黨' } },
    ]);
    expect(result.candidates.length).toBeLessThanOrEqual(50);
  });
});
