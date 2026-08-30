import { describe, expect, it } from 'vite-plus/test';
import { randomChineseName } from './display-name';

describe('random Chinese display name', () => {
  it('generates varied Traditional Chinese names', () => {
    const names = Array.from({ length: 30 }, randomChineseName);

    expect(names.every((name) => /^[\u3400-\u9fff]{2,4}$/.test(name))).toBe(true);
    expect(new Set(names).size).toBeGreaterThan(20);
  });
});
