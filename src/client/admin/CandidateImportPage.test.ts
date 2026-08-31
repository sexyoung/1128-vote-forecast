import { describe, expect, it } from 'vite-plus/test';
import type { AdminCandidate } from './api';
import { findMissingCandidatePhotos } from './CandidateImportPage';

const candidates: AdminCandidate[] = [
  {
    id: 'TPE-1',
    contestId: 'TPE-EXECUTIVE-1',
    contestName: '臺北市長',
    contestType: 'EXECUTIVE',
    name: '甲',
    partyId: 'DPP',
  },
  {
    id: 'TPE-2',
    contestId: 'TPE-EXECUTIVE-1',
    contestName: '臺北市長',
    contestType: 'EXECUTIVE',
    name: '乙',
    partyId: 'KMT',
  },
];

describe('findMissingCandidatePhotos', () => {
  it('returns only candidates whose image cannot load', async () => {
    await expect(
      findMissingCandidatePhotos(candidates, async ({ id }) => id === 'TPE-1'),
    ).resolves.toEqual([candidates[1]]);
  });
});
