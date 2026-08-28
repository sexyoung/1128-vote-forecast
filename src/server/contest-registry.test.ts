import { describe, expect, it } from 'vite-plus/test';
import {
  countRegisteredContests,
  getRegisteredContest,
  getRegisteredContests,
  listRegisteredContests,
} from './contest-registry';

// 清冊是 build 產生的（npm run data:contests）。這些測試是它與前端之間的合約：
// 前端能列出來的選區，伺服器都必須認得，否則預測會被拒絕。
describe('contest registry', () => {
  it('covers every election type', () => {
    const byType = listRegisteredContests().reduce<Record<string, number>>((totals, contest) => {
      totals[contest.type] = (totals[contest.type] ?? 0) + 1;
      return totals;
    }, {});

    expect(byType.EXECUTIVE).toBe(22);
    // 中選務字第 1153150253 號公告：161 區域 ＋ 23 平地原住民 ＋ 37 山地原住民。
    expect(byType.COUNCIL).toBe(221);
    expect(byType.TOWNSHIP).toBe(byType.REPRESENTATIVE);
    expect(byType.VILLAGE).toBeGreaterThan(7000);
    expect(countRegisteredContests()).toBe(
      Object.values(byType).reduce((total, count) => total + count, 0),
    );
  });

  it('has no duplicate ids', () => {
    const ids = listRegisteredContests().map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks only the representative seats as placeholders', () => {
    for (const contest of listRegisteredContests()) {
      expect(contest.seatsSource).toBe(
        contest.type === 'REPRESENTATIVE' ? 'PLACEHOLDER' : 'OFFICIAL',
      );
      expect(contest.seats).toBeGreaterThan(0);
    }
  });

  it('gives single-seat contests exactly one seat', () => {
    for (const contest of listRegisteredContests()) {
      if (contest.type === 'EXECUTIVE' || contest.type === 'TOWNSHIP' || contest.type === 'VILLAGE')
        expect(contest.seats).toBe(1);
    }
  });

  it('keeps the official council seat counts', () => {
    expect(getRegisteredContest('TPE-COUNCIL-1')?.seats).toBe(12);
    expect(getRegisteredContest('TPE-COUNCIL-6')?.seats).toBe(13);
    expect(getRegisteredContest('NTP-COUNCIL-10')?.seats).toBe(1);
  });

  // 地方制度法第 83-2 條：直轄市只有這五個山地原住民區有區長與區民代表。
  it('lists mountain indigenous districts but no other municipal district', () => {
    expect(getRegisteredContests('KHH', 'TOWNSHIP').map(({ name }) => name)).toEqual([
      '茂林區長',
      '桃源區長',
      '那瑪夏區長',
    ]);
    expect(getRegisteredContests('TAO', 'TOWNSHIP').map(({ name }) => name)).toEqual(['復興區長']);
    expect(getRegisteredContests('TXG', 'TOWNSHIP')).toHaveLength(1);
    expect(getRegisteredContests('TPE', 'TOWNSHIP')).toHaveLength(0);
    expect(getRegisteredContests('KEE', 'REPRESENTATIVE')).toHaveLength(0);
  });

  it('returns null for an id nobody issued', () => {
    expect(getRegisteredContest('TPE-COUNCIL-99')).toBeNull();
    expect(getRegisteredContest('town-00000000-TOWNSHIP')).toBeNull();
  });
});
