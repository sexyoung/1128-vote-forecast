import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vite-plus/test';
import { getContests, getJurisdiction, jurisdictions } from '../mock-election';
import { countLocalExecutiveDistricts, isLocalExecutiveTownship } from '../map-shapes';
import { isViewAvailable, parseView, summariseArea } from './JurisdictionPage';
import { CandidateList, toCandidateRows } from './ElectionPrototypeShared';

it('shows candidates with zero votes before anyone predicts', () => {
  expect(
    toCandidateRows({ rows: [] }, [
      {
        targetType: 'CANDIDATE',
        targetId: 'TPE-EXECUTIVE-1-CANDIDATE-1',
        label: '陳怡君',
        partyId: 'DPP',
        ballotNo: 1,
        photo: '/avatars/TPE-MAYOR-001.webp',
      },
    ]),
  ).toEqual([
    expect.objectContaining({
      label: '陳怡君',
      partyName: '民主進步黨',
      photo: '/avatars/TPE-MAYOR-001.webp',
      value: 0,
    }),
  ]);
});

it('does not highlight a winner when every candidate has zero votes', () => {
  const html = renderToStaticMarkup(
    createElement(CandidateList, {
      forecasts: 0,
      rows: [
        {
          id: 'candidate-1',
          label: '陳怡君',
          partyName: '民主進步黨',
          color: '#2c8a64',
          value: 0,
        },
      ],
      winnerCount: 1,
    }),
  );

  expect(html).toContain('民主進步黨');
  expect(html).not.toContain('winner');
});

it('stamps every candidate in a multi-seat prediction', () => {
  const rows = ['candidate-1', 'candidate-2'].map((id) => ({
    id,
    label: id,
    color: '#000099',
    value: 50,
  }));
  const html = renderToStaticMarkup(
    createElement(CandidateList, {
      forecasts: 2,
      highlightIds: rows.map(({ id }) => id),
      rows,
      winnerCount: 2,
    }),
  );

  expect(html.match(/class="mine winner"/g)).toHaveLength(2);
});

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

describe('contest list loading state', () => {
  it('keeps the skeleton reveal and reduced-motion fallback', async () => {
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

    expect(styles).toContain('.t-skel.is-revealed .t-skel-content');
    expect(styles).toContain('.t-skel-skeleton.is-pulsing > *');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('responsive council candidate rows', () => {
  it('keeps four desktop rows and reveals every winner on mobile', async () => {
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

    // 四列上限已放寬到所有卡片（/mine 也要），手機的當選者展開仍只在議員卡片。
    expect(styles).toContain('.contest-card .candidate-list li:nth-child(n + 5)');
    expect(styles).toContain('.council-contest-card .candidate-list li.winner');
    expect(styles).toContain('.council-contest-card .candidate-list li:not(.winner)');
  });
});

describe('candidate party colors', () => {
  it('uses the supplied color directly without white mixing or opacity', async () => {
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    const avatarRule = styles.slice(
      styles.indexOf('.candidate-list li > .candidate-avatar {'),
      styles.indexOf('.candidate-list li > .candidate-avatar img'),
    );
    const forecastShareRule = styles.slice(
      styles.indexOf('.forecast-options label::before {'),
      styles.indexOf('.forecast-options label:hover'),
    );

    expect(avatarRule).toContain('border: 2px solid var(--candidate-color);');
    expect(avatarRule).not.toContain('color-mix');
    expect(forecastShareRule).not.toContain('opacity');
    expect(styles).not.toContain('.map-share-bar.faint');
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

describe('indigenous mountain districts', () => {
  // 地方制度法第 83-2 條：這五個區改制為地方自治團體，有區長與區民代表選舉。
  // 其餘市轄區沒有，所以直轄市不能整批開放這兩個分頁。
  it('opens the township tabs for the five mountain indigenous districts only', () => {
    for (const id of ['TAO', 'TXG', 'KHH']) {
      expect(isViewAvailable(getJurisdiction(id), 'TOWNSHIP')).toBe(true);
      expect(isViewAvailable(getJurisdiction(id), 'REPRESENTATIVE')).toBe(true);
    }
    for (const id of ['TPE', 'NTP', 'TNN', 'KEE', 'HSZ', 'CYI']) {
      expect(isViewAvailable(getJurisdiction(id), 'TOWNSHIP')).toBe(false);
    }
    expect(isViewAvailable(getJurisdiction('NAN'), 'TOWNSHIP')).toBe(true);
  });

  it('keeps only the indigenous districts of a municipality', () => {
    const shape = (townCode: string, townName: string) => ({
      id: `town-${townCode}`,
      path: '',
      townCode,
      townName,
      countyName: '高雄市',
    });
    const kaohsiung = getJurisdiction('KHH');

    expect(isLocalExecutiveTownship(kaohsiung, shape('64000380', '那瑪夏區'))).toBe(true);
    expect(isLocalExecutiveTownship(kaohsiung, shape('64000010', '鹽埕區'))).toBe(false);
    // 別的直轄市的山地原住民區不算這一個直轄市的。
    expect(isLocalExecutiveTownship(kaohsiung, shape('68000130', '復興區'))).toBe(false);
    expect(countLocalExecutiveDistricts(kaohsiung, 38)).toBe(3);
    expect(countLocalExecutiveDistricts(getJurisdiction('NAN'), 13)).toBe(13);
  });
});
