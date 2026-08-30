import { describe, expect, it } from 'vite-plus/test';
import { predictionMeta } from './MyPredictionsPage';

describe('predictionMeta', () => {
  it('asks for a new prediction after the candidate list changes', () => {
    expect(predictionMeta('INVALIDATED', ['NTP-EXECUTIVE-1-CANDIDATE-1'], false)).toBe(
      '候選人名單已更新，請重新預測',
    );
  });

  it('keeps the result wording for active predictions', () => {
    expect(predictionMeta('ACTIVE', ['李四川'], true)).toBe('我預測 李四川 · 目前領先');
  });
});
