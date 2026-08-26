import { describe, expect, it } from 'vite-plus/test';
import { getContests, getJurisdiction } from '../mock-election';
import {
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
