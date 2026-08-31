import { describe, expect, it } from 'vite-plus/test';
import { isPlaceholderCandidateId } from './site-settings.js';

describe('placeholder candidate identifiers', () => {
  it('recognises only the seed placeholder marker', () => {
    expect(isPlaceholderCandidateId('TPE-EXECUTIVE-1-CANDIDATE-1')).toBe(true);
    expect(isPlaceholderCandidateId('TPE-MAYOR-001')).toBe(false);
  });
});
