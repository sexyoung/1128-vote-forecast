import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { databaseSchema, prisma } from './db.js';
import { listPartyCandidateCounts, listPartyContests } from './party-contests.js';

const candidateIds = [
  'PARTY-PAGE-TEST-CANDIDATE-1',
  'PARTY-PAGE-TEST-CANDIDATE-2',
  'PARTY-PAGE-TEST-CANDIDATE-3',
];

beforeAll(async () => {
  if (databaseSchema !== 'vote_forecast_test') throw new Error('拒絕寫入非測試資料庫。');
  await prisma.contestTally.deleteMany({ where: { targetId: { in: candidateIds } } });
  await prisma.candidate.deleteMany({ where: { id: { in: candidateIds } } });
  await prisma.candidate.createMany({
    data: candidateIds.map((id, index) => ({
      id,
      contestId: index === 2 ? 'CHA-COUNCIL-1' : 'TPE-COUNCIL-1',
      partyId: 'DPP',
      name: `政黨頁測試候選人${index + 1}`,
      nameEn: index === 0 ? 'Test Candidate' : null,
      ballotNo: 998 + index,
    })),
  });
});

afterAll(async () => {
  await prisma.contestTally.deleteMany({ where: { targetId: { in: candidateIds } } });
  await prisma.candidate.deleteMany({ where: { id: { in: candidateIds } } });
  await prisma.$disconnect();
});

describe('party candidate list', () => {
  it('counts every active candidate by party', async () => {
    const result = await listPartyCandidateCounts();

    expect(result.parties.DPP).toEqual({
      candidateCount: 3,
      offices: [{ type: 'COUNCIL', candidateCount: 3 }],
    });
  });

  it('returns one item per candidate even in the same contest', async () => {
    const page = await listPartyContests('DPP', 1, 'TPE');

    expect(page.total).toBe(2);
    expect(page.candidateTotal).toBe(3);
    expect(page.activeType).toBe('COUNCIL');
    expect(page.regions).toEqual([
      {
        id: 'TPE',
        candidateCount: 2,
        offices: [{ type: 'COUNCIL', candidateCount: 2 }],
      },
      {
        id: 'CHA',
        candidateCount: 1,
        offices: [{ type: 'COUNCIL', candidateCount: 1 }],
      },
    ]);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      contest: { id: 'TPE-COUNCIL-1' },
      hasPredictions: false,
      candidate: {
        id: candidateIds[0],
        name: '政黨頁測試候選人1',
        photo: '/avatars/TPE-COUNCIL-1-DPP-test-candidate.jpg',
        predictedElected: false,
      },
    });
    expect(page.items[1].candidate.id).toBe(candidateIds[1]);
  });

  it('marks a candidate inside the predicted seat count as elected', async () => {
    await prisma.contestTally.create({
      data: {
        contestId: 'TPE-COUNCIL-1',
        targetType: 'CANDIDATE',
        targetId: candidateIds[0],
        count: 3,
      },
    });

    const page = await listPartyContests('DPP', 1, 'TPE');

    expect(page.items[0].candidate).toMatchObject({
      predictedElected: true,
      predictionCount: 3,
      predictionPercent: 100,
    });
    expect(page.items[0].hasPredictions).toBe(true);
    expect(page.items[1].candidate.predictedElected).toBe(false);
  });
});
