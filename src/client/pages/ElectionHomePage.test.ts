import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';
import { buildRepresentativeContest } from '../map-shapes';
import { getContests, getJurisdiction, getMockCandidates } from '../mock-election';
import {
  getElectionViewsForMapLevel,
  getTownshipContestOptions,
  interpolateMapBounds,
  shouldImmediatelyFocusJurisdiction,
  shouldShowMapInspector,
  shouldShowTownshipBoundaryPreview,
  shouldShowVillageBoundaryPreview,
} from './ElectionHomePage';
import { getPredictionMode } from '../../shared/prediction';

describe('election home map behavior', () => {
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

  it('shows district boundaries over a selected mainland county', () => {
    expect(shouldShowTownshipBoundaryPreview('TPE', false)).toBe(true);
    expect(shouldShowTownshipBoundaryPreview('TPE', true)).toBe(false);
    expect(shouldShowTownshipBoundaryPreview('PEN', false)).toBe(false);
    expect(shouldShowTownshipBoundaryPreview(null, false)).toBe(false);
  });

  it('shows village boundaries over a selected township until village mode starts', () => {
    expect(shouldShowVillageBoundaryPreview('township-1', false)).toBe(true);
    expect(shouldShowVillageBoundaryPreview('township-1', true)).toBe(false);
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
