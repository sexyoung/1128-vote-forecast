import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';
import { getContests, getJurisdiction, jurisdictions } from '../mock-election';
import { parseView, summariseArea } from './JurisdictionPage';

describe('jurisdiction page tab in the url', () => {
  it('reads the tab from the view param', () => {
    expect(parseView('council')).toBe('COUNCIL');
    expect(parseView('township')).toBe('TOWNSHIP');
    expect(parseView('representative')).toBe('REPRESENTATIVE');
    expect(parseView('village')).toBe('VILLAGE');
  });

  it('accepts the id in any case, so hand-typed and older links keep working', () => {
    expect(parseView('COUNCIL')).toBe('COUNCIL');
    expect(parseView('Village')).toBe('VILLAGE');
  });

  it('falls back to the executive tab rather than rendering nothing', () => {
    expect(parseView(null)).toBe('EXECUTIVE');
    expect(parseView('')).toBe('EXECUTIVE');
    expect(parseView('mayor')).toBe('EXECUTIVE');
  });
});

describe('contest card cover', () => {
  it('keeps the cover photo square whatever the area list does', async () => {
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    const whole = styles.slice(styles.indexOf('.card-cover > i {'));
    const rule = whole.slice(0, whole.indexOf('\n}'));

    // 橫向：沒有 flex: none 的話，flex-shrink 預設是 1 而 min-width: auto 只退到
    // 內容寬（一個字），長鄉鎮清單會把照片壓成一條窄長方形。
    expect(rule).toContain('flex: none;');
    // 縱向：父層是 align-items: stretch，不覆寫的話 stretch 會蓋掉 aspect-ratio
    // 算出的高度，封面一變高照片就拉長。
    expect(rule).toContain('align-self: flex-start;');
    expect(rule).toContain('aspect-ratio: 1;');
  });

  it('has area lists long enough to matter', () => {
    const areas = getContests(getJurisdiction('PIF'), 'COUNCIL').map((contest) => contest.area);
    const longest = areas.reduce((a, b) => (b.length > a.length ? b : a));

    expect(longest.length).toBeGreaterThan(30);
  });
});

describe('area list shown on a contest card', () => {
  it('leaves a list that already fits alone', () => {
    expect(summariseArea('石門區、三芝區、淡水區、八里區')).toBe('石門區、三芝區、淡水區、八里區');
    expect(summariseArea('臺北市全境')).toBe('臺北市全境');
  });

  it('collapses a list too long for two lines, keeping the unit', () => {
    expect(
      summariseArea('長治鄉、麟洛鄉、九如鄉、里港鄉、鹽埔鄉、高樹鄉、三地門鄉、霧臺鄉、瑪家鄉'),
    ).toBe('長治鄉、麟洛鄉 等 9 個鄉');
    expect(
      summariseArea('東區東門里、榮光里、成功里、育賢里、中正里、親仁里、文華里、復中里'),
    ).toBe('東區東門里、榮光里 等 8 個里');
  });

  it('falls back to a neutral unit when the list mixes them', () => {
    expect(summariseArea('中壢區、平鎮鄉、龍潭鄉、楊梅鎮、新屋鄉、觀音鄉、大溪鎮、復興鄉')).toBe(
      '中壢區、平鎮鄉 等 8 個區域',
    );
  });

  // 這是整個機制存在的理由：不收的話這一筆會在卡片上排成十行。
  it('keeps every real area string within two lines', () => {
    const views = ['EXECUTIVE', 'COUNCIL', 'TOWNSHIP', 'REPRESENTATIVE', 'VILLAGE'] as const;
    const summarised = jurisdictions.flatMap((jurisdiction) =>
      views.flatMap((view) =>
        getContests(jurisdiction, view).map((contest) => summariseArea(contest.area)),
      ),
    );

    expect(Math.max(...summarised.map((area) => area.length))).toBeLessThanOrEqual(30);
  });
});
