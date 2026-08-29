import { describe, expect, it } from 'vite-plus/test';
import { avatarFileName, avatarUrl } from './avatars';

describe('candidate avatars', () => {
  it('uses the permanent candidate code as a webp filename', () => {
    expect(avatarFileName('TPE-MAYOR-001')).toBe('TPE-MAYOR-001.webp');
    expect(avatarUrl('TPE-MAYOR-001')).toBe('/avatars/TPE-MAYOR-001.webp');
  });

  it('does not request images for placeholders or unsafe codes', () => {
    expect(avatarUrl('TPE-EXECUTIVE-1-CANDIDATE-1')).toBeNull();
    expect(avatarUrl('../candidate')).toBeNull();
  });
});
