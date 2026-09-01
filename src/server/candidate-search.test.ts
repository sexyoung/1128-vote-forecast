import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { prisma } from './db.js';
import { searchCandidateNames } from './candidate-search.js';

const candidateId = `candidate-search-${Date.now()}`;
const name = `搜尋測試${Date.now()}`;

beforeAll(async () => {
  await prisma.candidate.create({
    data: {
      id: candidateId,
      contestId: 'TPE-EXECUTIVE-1',
      name,
      partyId: 'DPP',
      status: 'REGISTERED',
    },
  });
});

afterAll(async () => {
  await prisma.candidate.deleteMany({ where: { id: candidateId } });
});

describe('candidate name search', () => {
  it('returns imported candidates and their contest destination', async () => {
    const hits = await searchCandidateNames(name);

    expect(hits).toContainEqual(
      expect.objectContaining({ id: candidateId, label: name, to: '/contest/TPE-EXECUTIVE-1' }),
    );
  });
});
