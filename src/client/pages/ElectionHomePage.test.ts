import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';
import { buildRepresentativeContest } from '../map-shapes';
import { getContests, getJurisdiction, getMockCandidates } from '../mock-election';
import {
  getElectionViewsForMapLevel,
  getMapParty,
  getMapResultScale,
  getTownshipContestOptions,
  interpolateMapBounds,
  paintAnimatedLast,
  predictionBubbleSize,
  randomPointInPath,
  shouldAnimateMapResult,
  shouldImmediatelyFocusJurisdiction,
  shouldShowMapInspector,
  shouldShowVillageBoundaryPreview,
} from './ElectionHomePage';
import { getPredictionMode } from '../../shared/prediction';

describe('election home map behavior', () => {
  it('keeps the busiest collected candidate at the current bubble size', () => {
    expect(predictionBubbleSize(4, 4)).toBe(56);
    expect(predictionBubbleSize(1, 4)).toBe(38);
  });

  it('places a prediction bubble inside the county path', () => {
    const values = [0.1, 0.5, 0.8, 0.25];
    const point = randomPointInPath(
      {
        getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
        isPointInFill: ({ x = 0 }) => x > 5,
      },
      () => values.shift() ?? 0,
    );

    expect(point).toEqual({ x: 8, y: 2.5 });
  });

  it('shows live prediction photos only on their county map path', async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    ]);

    expect(source).toContain("new EventSource('/api/prediction-events')");
    expect(source).toContain('pathRefs.current[candidate.jurisdictionId]');
    expect(source).toContain('className="map-prediction-bubbles"');
    expect(source).toContain('const key = `${event.jurisdictionId}:${bubble.targetId}`');
    expect(source).toContain('window.setTimeout(flushPredictionBubbles, 400)');
    expect(source).toContain('height: bubble.size');
    expect(styles).toContain('@keyframes prediction-bubble');
    expect(source).toContain('className="map-prediction-color-flash"');
    expect(source).toContain('fill={`color-mix(in srgb, ${bubble.color} 35%, white)`}');
    expect(source).not.toContain('<radialGradient');
    expect(source).toContain('requestAnimationFrame(followMap)');
    expect(source).toContain('pathRefs.current[bubble.jurisdictionId]?.getScreenCTM()');
    expect(styles).toContain('@keyframes map-prediction-color-flash');
    expect(styles).toContain('opacity: 0.78');
  });

  it('paints the animated district above its neighbors', () => {
    const paths = [{ id: 'first' }, { id: 'animated' }, { id: 'last' }];
    expect(paintAnimatedLast(paths, 'animated', ({ id }) => id)).toEqual([
      { id: 'first' },
      { id: 'last' },
      { id: 'animated' },
    ]);
  });

  it('doubles the animated district at every map zoom level', () => {
    expect(getMapResultScale()).toBe(2);
  });

  it('animates only the district whose forecast just changed', async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    ]);

    expect(source).toContain('setAnimatedContestId(activeContest.id)');
    expect(source).toContain('shouldAnimateMapResult(previousMapCell, nextMapCell)');
    expect(source).toContain("? 'map-result-changed' : ''");
    expect(styles).toContain('@keyframes map-result-change');
    expect(styles).toContain('map-result-change 2.5s');
    expect(styles).toContain(
      '54% {\n    filter: none;\n    transform: scale(var(--map-result-peak-scale))',
    );
    expect(styles).not.toContain('transform: translate(-3px');
    expect(styles).toContain('62% {\n    animation-timing-function: step-start;');
    expect(styles).toContain('63% {\n    filter: drop-shadow(0 0 2px');
    expect(styles).toContain('drop-shadow(0 0 22px transparent)');
    expect(source).toContain(
      'setHeldMapCell({ contestId: activeContest.id, cell: previousMapCell })',
    );
    expect(source).toContain('setInspectorExpanded(!isDrawerLayout())');
    expect(styles).toContain('brightness(5) saturate(0)');
    expect(styles).toContain('.map-result-changed {\n    animation: none;');
  });

  it('animates only when an existing displayed leader changes party', () => {
    const kmt = {
      contestId: 'NTP-EXECUTIVE-1',
      party: 'KMT',
      percent: 50,
      total: 2,
    };
    const dpp = { ...kmt, party: 'DPP', total: 3 };

    expect(shouldAnimateMapResult(kmt, dpp)).toBe(true);
    expect(shouldAnimateMapResult(kmt, { ...kmt, percent: 60, total: 3 })).toBe(false);
    expect(shouldAnimateMapResult(undefined, dpp)).toBe(false);
  });

  it('uses one stable party color for a tied district without SVG effects', async () => {
    const cell = {
      contestId: 'NTP-EXECUTIVE-1',
      party: 'DPP',
      tiedParties: ['DPP', 'KMT'],
      percent: 50,
      total: 2,
    };
    const party = getMapParty(cell);
    expect(cell.tiedParties).toContain(party);
    expect(getMapParty(cell)).toBe(party);

    const source = await readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('MapTiePatterns');
    expect(source).not.toContain('<feTurbulence');
  });

  it('renders a map before client-side SVG parsing finishes', async () => {
    const source = await readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('className="taiwan-map-static"');
    expect(source).toContain('src="/maps/taiwan-counties.svg"');
  });

  it('keeps the parties link in the compact map controls', async () => {
    const source = await readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('aria-label="政黨列表"');
    expect(source).toContain('to="/parties"');
  });

  it.each(['PEN', 'KIN', 'LIE'])('immediately focuses offshore jurisdiction %s', (id) => {
    expect(shouldImmediatelyFocusJurisdiction(id)).toBe(true);
  });

  it('keeps the existing selection behavior for other jurisdictions', () => {
    expect(shouldImmediatelyFocusJurisdiction('TPE')).toBe(false);
  });

  it('does not preview township boundaries at county zoom', async () => {
    const source = await readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('township-boundary-preview');
  });

  it('shows village boundaries over a selected township until village mode starts', () => {
    expect(shouldShowVillageBoundaryPreview('township-1', false)).toBe(true);
    expect(shouldShowVillageBoundaryPreview('township-1', true)).toBe(false);
    expect(shouldShowVillageBoundaryPreview('township-1', false, true)).toBe(false);
    expect(shouldShowVillageBoundaryPreview(null, false)).toBe(false);
  });

  it('shows the forecast inspector for the selected county contest', () => {
    const contest = getContests(getJurisdiction('TPE'), 'EXECUTIVE')[0];

    expect(shouldShowMapInspector('TPE', contest)).toBe(true);
    expect(shouldShowMapInspector('NTP', contest)).toBe(false);
    expect(shouldShowMapInspector('TPE', null)).toBe(false);
  });

  it('derives forecast types from the selected map level', () => {
    const taipei = getJurisdiction('TPE');
    const keelung = getJurisdiction('KEE');
    const nantou = getJurisdiction('NAN');

    expect(getElectionViewsForMapLevel(taipei, 'jurisdiction')).toEqual(['EXECUTIVE']);
    expect(getElectionViewsForMapLevel(taipei, 'township')).toEqual(['COUNCIL']);
    expect(getElectionViewsForMapLevel(keelung, 'township')).toEqual(['COUNCIL']);
    expect(getElectionViewsForMapLevel(nantou, 'township')).toEqual([
      'COUNCIL',
      'TOWNSHIP',
      'REPRESENTATIVE',
    ]);
    expect(getElectionViewsForMapLevel(nantou, 'village')).toEqual(['VILLAGE']);
  });

  it('maps Taipei administrative districts to one shared council contest', () => {
    const taipei = getJurisdiction('TPE');
    const shape = (id: string, townCode: string, townName: string) => ({
      countyName: '臺北市',
      id,
      path: '',
      townCode,
      townName,
    });
    const neihu = getTownshipContestOptions(shape('neihu', '63000100', '內湖區'), taipei)[0];
    const nangang = getTownshipContestOptions(shape('nangang', '63000090', '南港區'), taipei)[0];

    expect(neihu.id).toBe(nangang.id);
    expect(neihu.view).toBe('COUNCIL');
    expect(neihu.area).toBe('內湖區、南港區');
  });

  it('uses candidate selection for council contests before official names are available', () => {
    const contest = getContests(getJurisdiction('NTP'), 'COUNCIL')[1];
    const candidates = getMockCandidates(contest);

    expect(getPredictionMode(contest.view, contest.seatCount, false)).toBe('candidate');
    expect(candidates.length).toBeGreaterThan(contest.seatCount);
    expect(candidates.every(({ name }) => /^[\p{Script=Han}]{3}$/u.test(name))).toBe(true);
    expect(new Set(candidates.map(({ partyId }) => partyId)).size).toBeLessThan(candidates.length);
    expect(new Set(candidates.map(({ id }) => id)).size).toBe(candidates.length);
  });

  it('offers more candidates than there are council seats', () => {
    const contest = getContests(getJurisdiction('ILA'), 'COUNCIL')[0];

    expect(contest.seatCount).toBe(7);
    // 落選的人也要在名單上，不然「預測誰當選」變成「把名單全勾起來」。
    expect(getMockCandidates(contest)).toHaveLength(11);
  });

  it('uses the same candidate selection for township representative contests', () => {
    // 代表改成從圖資產生（一鄉鎮市一筆），不再有 mock-election 的佔位選舉區。
    const contest = buildRepresentativeContest(
      {
        id: 'town-10008010',
        path: '',
        townCode: '10008010',
        townName: '南投市',
        countyName: '南投縣',
      },
      getJurisdiction('NAN'),
    );
    const candidates = getMockCandidates(contest);

    expect(contest.name).toBe('南投市民代表');
    expect(contest.area).toBe('南投縣南投市代表選區');
    expect(getPredictionMode(contest.view, contest.seatCount, false)).toBe('candidate');
    expect(candidates.length).toBeGreaterThan(contest.seatCount);
  });

  // 這三種選舉現在只從圖資產生。留著舊的佔位資料會變成第二套假的選舉區，
  // 而且 findContest 會讓 /contest/ILA-VILLAGE-1 這種舊連結解出假頁面。
  it.each(['TOWNSHIP', 'REPRESENTATIVE', 'VILLAGE'] as const)(
    'no longer invents placeholder districts for %s',
    (view) => {
      expect(getContests(getJurisdiction('NAN'), view)).toEqual([]);
    },
  );

  it('names candidates for single-seat contests instead of bare parties', () => {
    const contest = getContests(getJurisdiction('TPE'), 'EXECUTIVE')[0];

    expect(contest.seatCount).toBe(1);
    expect(getPredictionMode(contest.view, contest.seatCount, false)).toBe('candidate');
    expect(getMockCandidates(contest)[0].name).toMatch(/^[\p{Script=Han}]{3}$/u);
  });

  it('fields exactly one candidate per party in single-seat contests', () => {
    const candidates = getMockCandidates(getContests(getJurisdiction('TPE'), 'EXECUTIVE')[0]);

    expect(new Set(candidates.map(({ partyId }) => partyId)).size).toBe(candidates.length);
  });

  it('highlights only the official New Taipei district 2 membership', () => {
    const newTaipei = getJurisdiction('NTP');
    const shape = (townName: string) => ({
      countyName: '新北市',
      id: townName,
      path: '',
      townCode: townName,
      townName,
    });
    const contestId = (townName: string) =>
      getTownshipContestOptions(shape(townName), newTaipei)[0]?.id;

    expect([contestId('林口區'), contestId('五股區'), contestId('泰山區')]).toEqual([
      'NTP-COUNCIL-2',
      'NTP-COUNCIL-2',
      'NTP-COUNCIL-2',
    ]);
    expect(contestId('三重區')).toBe('NTP-COUNCIL-4');
    expect(contestId('鶯歌區')).toBe('NTP-COUNCIL-8');
  });

  it('moves offshore badges with the desktop map when the inspector opens', async () => {
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

    expect(styles).toContain(`.map-app.has-selection .taiwan-map-svg,
.map-app.has-selection .map-island-insets {
  transform: translateX(-205px);
}`);
  });

  it('docks the map inspector to the bottom of the phone screen', async () => {
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    const phone = styles.slice(styles.indexOf('@media (max-width: 720px) {'));
    const inspector = phone.slice(phone.indexOf('\n  .map-inspector {'));
    const baseRule = inspector.slice(0, inspector.indexOf('\n  }'));

    // 這些宣告一旦漏掉，面板會退回桌機的 right/top/width，變成一片蓋住地圖的浮動直條。
    // 選區沒有選舉切換器（縣市長、村里長）時只剩基礎規則兜著，所以它必須自己完整。
    for (const declaration of ['bottom: 0;', 'right: 0;', 'top: auto;', 'width: 100%;'])
      expect(baseRule).toContain(declaration);
    expect(baseRule).toContain('animation: drawer-up');
  });

  it('omits the removed map chrome', async () => {
    const source = await readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8');

    for (const marker of [
      '<MapLegend',
      '<MapSearch',
      'className="map-zoom-controls"',
      'className="map-status"',
    ]) {
      expect(source).not.toContain(marker);
    }
    expect(source).not.toMatch(/<select\s+aria-label="選舉種類"/);
    expect(source).not.toContain('aria-label="候選人名單狀態"');
    expect(source).not.toContain('className="map-select phase"');
  });

  it('keeps mobile search above share controls and aligns the regular search to the right', async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    ]);
    const phone = styles.slice(styles.indexOf('@media (max-width: 720px) {'));

    expect(source).toContain("searchOpen ? 'search-open' : ''");
    expect(phone).toContain('.map-stage.search-open .map-share');
    expect(phone).toContain('.map-search:focus-within');
    expect(phone).toContain('.map-search input');
    expect(phone).toContain('grid-template-columns: minmax(0, 1fr) 40px;');
    expect(phone).toContain('grid-column: 2;');
    expect(source).toContain('setSearchOpen(false);');
  });

  it('colours the map from the API, never from the mock numbers', async () => {
    const source = await readFile(new URL('./ElectionHomePage.tsx', import.meta.url), 'utf8');

    // contest.percentage 是 mock-election 的示意數字。地圖著色一旦用回它，畫面上
    // 就會出現看起來像預測、其實沒人送出過的顏色。
    expect(source).not.toContain('contest.percentage');
    expect(source).toContain('mapFill(cell');
    // 沒有人預測的選區要是灰的，不是隨便一個政黨的顏色。
    expect(source).toContain('noDataFill');
  });

  it('smoothly interpolates both map position and zoom', () => {
    const start = { x: 0, y: 10, width: 100, height: 200 };
    const end = { x: 100, y: 110, width: 20, height: 40 };

    expect(interpolateMapBounds(start, end, 0)).toEqual(start);
    expect(interpolateMapBounds(start, end, 0.5)).toEqual({
      x: 87.5,
      y: 97.5,
      width: 30,
      height: 60,
    });
    expect(interpolateMapBounds(start, end, 1)).toEqual(end);
  });
});
