import { describe, expect, it } from 'vite-plus/test';
import { createCandidateId, isCanonicalCandidateId } from './candidate-ids.js';

describe('candidate ids', () => {
  it('starts generated ids with party and contest', () => {
    expect(createCandidateId('DPP', 'TPE-EXECUTIVE-1')).toMatch(
      /^DPP-TPE-EXECUTIVE-1-[A-F0-9]{8}$/,
    );
    expect(createCandidateId(null, 'TPE-COUNCIL-2')).toMatch(/^IND-TPE-COUNCIL-2-[A-F0-9]{8}$/);
    expect(isCanonicalCandidateId('TPP-TPE-COUNCIL-2-01', 'TPP', 'TPE-COUNCIL-2')).toBe(false);
  });
});
