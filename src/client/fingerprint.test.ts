import { describe, expect, it } from 'vite-plus/test';
import { fallbackFingerprint } from './fingerprint';

describe('LAN HTTP fingerprint fallback', () => {
  it('returns a stable 32-character fingerprint', () => {
    expect(fallbackFingerprint('mobile-signals')).toBe(fallbackFingerprint('mobile-signals'));
    expect(fallbackFingerprint('mobile-signals')).toMatch(/^[0-9a-f]{32}$/);
    expect(fallbackFingerprint('mobile-signals')).not.toBe(fallbackFingerprint('other-signals'));
  });
});
