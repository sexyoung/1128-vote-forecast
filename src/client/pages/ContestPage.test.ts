import { describe, expect, it } from 'vite-plus/test';
import { forecastAsideTitle } from './ContestPage';

describe('contest forecast prompt', () => {
  it('distinguishes no prediction, a partial prediction, and a full prediction', () => {
    expect(forecastAsideTitle(0, 5)).toBe('你還沒有預測這一區');
    expect(forecastAsideTitle(3, 5)).toBe('你還可以補齊這區的預測');
    expect(forecastAsideTitle(5, 5)).toBe('你已完成這區的預測');
  });
});
