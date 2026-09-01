import { readFile } from 'node:fs/promises';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vite-plus/test';
import { updateCachedMaps } from './ForecastSheet';

it('updates the map leader from the submitted authoritative tally', () => {
  const queryClient = new QueryClient();
  const key = ['map', 'national'];
  queryClient.setQueryData(key, {
    cells: [{ contestId: 'NTP-EXECUTIVE-1', party: 'KMT', percent: 100, total: 1 }],
  });

  const result = updateCachedMaps(
    queryClient,
    {
      id: 'NTP-EXECUTIVE-1',
      jurisdictionId: 'NTP',
      name: '新北市長',
      area: '新北市',
      seatCount: 1,
      view: 'EXECUTIVE',
      leader: 'KMT',
      percentage: 100,
      forecasts: 1,
    },
    {
      totalPredictions: 1,
      totalPicks: 1,
      rows: [
        {
          targetType: 'CANDIDATE',
          targetId: 'DPP-NTP-EXECUTIVE-TEST',
          count: 1,
          percent: 100,
          label: '蘇巧慧',
          partyId: 'DPP',
          color: null,
          photo: null,
        },
      ],
    },
  );

  expect(queryClient.getQueryData(key)).toEqual({
    cells: [{ contestId: 'NTP-EXECUTIVE-1', party: 'DPP', percent: 100, total: 1 }],
  });
  expect(result).toEqual({
    previousCell: {
      contestId: 'NTP-EXECUTIVE-1',
      party: 'KMT',
      percent: 100,
      total: 1,
    },
    nextCell: {
      contestId: 'NTP-EXECUTIVE-1',
      party: 'DPP',
      percent: 100,
      total: 1,
    },
  });
});

it('updates the map with both parties when the submitted tally is tied', () => {
  const queryClient = new QueryClient();
  const key = ['map', 'national'];
  queryClient.setQueryData(key, {
    cells: [{ contestId: 'NTP-EXECUTIVE-1', party: 'KMT', percent: 100, total: 1 }],
  });

  updateCachedMaps(
    queryClient,
    {
      id: 'NTP-EXECUTIVE-1',
      jurisdictionId: 'NTP',
      name: '新北市長',
      area: '新北市',
      seatCount: 1,
      view: 'EXECUTIVE',
      leader: 'KMT',
      percentage: 100,
      forecasts: 1,
    },
    {
      totalPredictions: 2,
      totalPicks: 2,
      rows: [
        {
          targetType: 'CANDIDATE',
          targetId: 'DPP-NTP-EXECUTIVE-TEST',
          count: 1,
          percent: 50,
          label: '蘇巧慧',
          partyId: 'DPP',
          color: null,
          photo: null,
        },
        {
          targetType: 'CANDIDATE',
          targetId: 'KMT-NTP-EXECUTIVE-TEST',
          count: 1,
          percent: 50,
          label: '李四川',
          partyId: 'KMT',
          color: null,
          photo: null,
        },
      ],
    },
  );

  expect(queryClient.getQueryData(key)).toEqual({
    cells: [
      {
        contestId: 'NTP-EXECUTIVE-1',
        party: 'DPP',
        tiedParties: ['DPP', 'KMT'],
        percent: 50,
        total: 2,
      },
    ],
  });
});

it('does not overwrite the submitted tally with a cached map response', async () => {
  const source = await readFile(new URL('./ForecastSheet.tsx', import.meta.url), 'utf8');
  expect(source).not.toContain("invalidateQueries({ queryKey: ['map'] })");
});

describe('forecast candidate photos', () => {
  it('renders the photo supplied by the contest target and crops it into the mark', async () => {
    const [component, styles] = await Promise.all([
      readFile(new URL('./ForecastSheet.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    ]);
    const photoRule = styles.slice(
      styles.indexOf('.forecast-mark img {'),
      styles.indexOf('.forecast-option-text {'),
    );

    expect(component).toContain('<CandidatePhoto photo={target.photo} />');
    expect(photoRule).toContain('object-fit: cover;');
    expect(photoRule).toContain('position: absolute;');
  });

  it('leaves room around the option while its selected animation scales up', async () => {
    const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
    const optionsRule = styles.slice(
      styles.indexOf('.forecast-options {'),
      styles.indexOf('.forecast-options label {'),
    );
    const selectedRule = styles.slice(
      styles.indexOf('.forecast-options label.selected {'),
      styles.indexOf('/* 蓋章：'),
    );

    expect(optionsRule).toContain('padding: 4px;');
    expect(selectedRule).toContain('z-index: 1;');
  });
});
