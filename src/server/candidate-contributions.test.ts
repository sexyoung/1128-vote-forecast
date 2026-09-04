import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import {
  CandidateContributionRejected,
  approveCandidateContribution,
  createCandidateContribution,
} from './candidate-contributions.js';
import { prisma } from './db.js';

const forecasterId = `contribution-test-${Date.now()}`;
const candidateName = `提案候選人${Date.now()}`;
let contributionId = '';
let candidateId = '';

beforeAll(async () => {
  await prisma.forecaster.create({ data: { id: forecasterId } });
});

afterAll(async () => {
  if (candidateId) await prisma.candidate.deleteMany({ where: { id: candidateId } });
  await prisma.candidateContribution.deleteMany({ where: { forecasterId } });
  await prisma.forecaster.deleteMany({ where: { id: forecasterId } });
});

describe('candidate contributions', () => {
  it('assigns a permanent candidate id before a new candidate is approved', async () => {
    const contribution = await createCandidateContribution(forecasterId, 'TPE-EXECUTIVE-1', {
      kind: 'NEW_CANDIDATE',
      candidateName,
      partyId: 'DPP',
      photoUrl: 'https://images.example/candidate.jpg',
    });
    contributionId = contribution.id;
    candidateId = contribution.candidateId;

    expect(contribution.candidateId).toMatch(/^DPP-TPE-EXECUTIVE-1-[A-F0-9]{8}$/);
    expect(contribution.status).toBe('PENDING');
    expect(
      await prisma.candidate.findUnique({ where: { id: contribution.candidateId } }),
    ).toBeNull();
  });

  it('requires https photo URLs', async () => {
    await expect(
      createCandidateContribution(forecasterId, 'TPE-EXECUTIVE-1', {
        kind: 'NEW_CANDIDATE',
        candidateName: `${candidateName}二`,
        partyId: 'DPP',
        photoUrl: 'http://images.example/candidate.jpg',
      }),
    ).rejects.toBeInstanceOf(CandidateContributionRejected);
  });

  it('does not create the formal candidate until approval', async () => {
    const contribution = await prisma.candidateContribution.findUnique({
      where: { id: contributionId },
    });
    expect(contribution?.candidateName).toBe(candidateName);
    expect(contribution?.status).toBe('PENDING');
  });

  it('approves the contribution without downloading the submitted photo', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('approval must not download the submitted photo');
    };
    try {
      await approveCandidateContribution(contributionId);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(
      await prisma.candidateContribution.findUnique({ where: { id: contributionId } }),
    ).toMatchObject({ status: 'APPROVED' });
    expect(await prisma.candidate.findUnique({ where: { id: candidateId } })).toMatchObject({
      name: candidateName,
    });
  });
});
