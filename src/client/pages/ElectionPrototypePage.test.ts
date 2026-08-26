import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';
import { getContests, getJurisdiction } from '../mock-election';
import {
  getElectionViewsForMapLevel,
  getTownshipContestOptions,
  interpolateMapBounds,
  shouldImmediatelyFocusJurisdiction,
  shouldShowMapInspector,
  shouldShowTownshipBoundaryPreview,
  shouldShowVillageBoundaryPreview,
} from './ElectionPrototypePage';

describe('map jurisdiction focus behavior', () => {
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
    const neihu = getTownshipContestOptions(shape('neihu', '63000100', '內湖區'), taipei, 0)[0];
    const nangang = getTownshipContestOptions(shape('nangang', '63000090', '南港區'), taipei, 1)[0];

    expect(neihu.id).toBe(nangang.id);
    expect(neihu.view).toBe('COUNCIL');
    expect(neihu.area).toBe('內湖區、南港區');
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
      getTownshipContestOptions(shape(townName), newTaipei, 0)[0]?.id;

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

  it('omits the removed map chrome', async () => {
    const source = await readFile(new URL('./ElectionPrototypePage.tsx', import.meta.url), 'utf8');

    for (const marker of [
      '<MapLegend',
      '<MapSearch',
      'className="map-zoom-controls"',
      'className="map-status"',
    ]) {
      expect(source).not.toContain(marker);
    }
    expect(source).not.toMatch(/<select\s+aria-label="選舉種類"/);
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
