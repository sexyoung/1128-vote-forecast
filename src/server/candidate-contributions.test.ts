import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import sharp from 'sharp';
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

  it('returns the processed WebP for the browser to download', async () => {
    const source = await sharp({
      create: { width: 20, height: 30, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const response = new Response(source, {
        headers: { 'content-length': String(source.byteLength) },
      });
      Object.defineProperty(response, 'url', { value: 'https://images.example/candidate.png' });
      return response;
    };
    try {
      const approved = await approveCandidateContribution(contributionId);
      expect(approved.photoFile).toBe(`${candidateId}.webp`);
      await expect(sharp(approved.webp).metadata()).resolves.toMatchObject({
        width: 512,
        height: 512,
        format: 'webp',
      });
      expect(
        await prisma.candidateContribution.findUnique({ where: { id: contributionId } }),
      ).toMatchObject({ status: 'APPROVED' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
