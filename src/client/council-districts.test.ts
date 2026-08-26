import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';
import {
  councilDistricts,
  findRegionalCouncilDistricts,
  getCouncilDistricts,
  getRegionalCouncilDistricts,
} from './council-districts';
import { getContests, jurisdictions } from './mock-election';

const officialSummary: Record<
  string,
  { districts: number; regionalDistricts: number; regionalSeats: number; seats: number }
> = {
  TPE: { districts: 8, regionalDistricts: 6, regionalSeats: 59, seats: 61 },
  NTP: { districts: 13, regionalDistricts: 11, regionalSeats: 62, seats: 68 },
  TAO: { districts: 14, regionalDistricts: 12, regionalSeats: 57, seats: 65 },
  TXG: { districts: 17, regionalDistricts: 14, regionalSeats: 62, seats: 65 },
  TNN: { districts: 13, regionalDistricts: 11, regionalSeats: 55, seats: 57 },
  KHH: { districts: 15, regionalDistricts: 11, regionalSeats: 61, seats: 65 },
  HSQ: { districts: 14, regionalDistricts: 11, regionalSeats: 34, seats: 37 },
  MIA: { districts: 8, regionalDistricts: 6, regionalSeats: 36, seats: 38 },
  CHA: { districts: 10, regionalDistricts: 8, regionalSeats: 53, seats: 55 },
  NAN: { districts: 8, regionalDistricts: 5, regionalSeats: 34, seats: 37 },
  YUN: { districts: 8, regionalDistricts: 6, regionalSeats: 43, seats: 45 },
  CYQ: { districts: 7, regionalDistricts: 6, regionalSeats: 36, seats: 37 },
  PIF: { districts: 16, regionalDistricts: 7, regionalSeats: 46, seats: 55 },
  ILA: { districts: 13, regionalDistricts: 10, regionalSeats: 31, seats: 34 },
  HUA: { districts: 10, regionalDistricts: 4, regionalSeats: 23, seats: 33 },
  TTT: { districts: 16, regionalDistricts: 6, regionalSeats: 17, seats: 30 },
  PEN: { districts: 6, regionalDistricts: 6, regionalSeats: 19, seats: 19 },
  KIN: { districts: 3, regionalDistricts: 3, regionalSeats: 19, seats: 19 },
  LIE: { districts: 4, regionalDistricts: 4, regionalSeats: 9, seats: 9 },
  KEE: { districts: 9, regionalDistricts: 7, regionalSeats: 30, seats: 32 },
  HSZ: { districts: 7, regionalDistricts: 5, regionalSeats: 33, seats: 35 },
  CYI: { districts: 2, regionalDistricts: 2, regionalSeats: 23, seats: 23 },
};

function values(source: string, attribute: string) {
  return [...source.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))].map((match) => match[1]);
}

describe('official 2026 council districts', () => {
  it('matches the CEC district and seat totals for all 22 jurisdictions', () => {
    expect(Object.keys(officialSummary)).toHaveLength(22);
    expect(councilDistricts).toHaveLength(221);
    expect(councilDistricts.filter(({ kind }) => kind === 'REGIONAL')).toHaveLength(161);
    expect(councilDistricts.filter(({ kind }) => kind === 'PLAINS_INDIGENOUS')).toHaveLength(23);
    expect(councilDistricts.filter(({ kind }) => kind === 'MOUNTAIN_INDIGENOUS')).toHaveLength(37);
    expect(new Set(councilDistricts.map(({ id }) => id)).size).toBe(councilDistricts.length);

    for (const jurisdiction of jurisdictions) {
      const districts = getCouncilDistricts(jurisdiction.id);
      const expected = officialSummary[jurisdiction.id];
      expect(expected, jurisdiction.name).toBeDefined();
      expect(districts, jurisdiction.name).toHaveLength(expected.districts);
      expect(
        districts.map(({ number }) => number),
        `${jurisdiction.name}選舉區編號`,
      ).toEqual(Array.from({ length: expected.districts }, (_, index) => index + 1));
      expect(
        districts.reduce((total, district) => total + district.seats, 0),
        `${jurisdiction.name}議員總額`,
      ).toBe(expected.seats);
      expect(
        getRegionalCouncilDistricts(jurisdiction.id),
        `${jurisdiction.name}區域選舉區`,
      ).toHaveLength(expected.regionalDistricts);
      expect(
        getRegionalCouncilDistricts(jurisdiction.id).reduce(
          (total, district) => total + district.seats,
          0,
        ),
        `${jurisdiction.name}區域議員總額`,
      ).toBe(expected.regionalSeats);
    }
  });

  it('builds mock results on official contest identities, scopes, and seats', () => {
    for (const jurisdiction of jurisdictions) {
      const official = getCouncilDistricts(jurisdiction.id);
      const contests = getContests(jurisdiction, 'COUNCIL');
      expect(contests.map(({ id }) => id)).toEqual(official.map(({ id }) => id));
      expect(contests.map(({ area }) => area)).toEqual(official.map(({ area }) => area));
      expect(contests.map(({ seatCount }) => seatCount)).toEqual(
        official.map(({ seats }) => seats),
      );
      expect(contests.some(({ area }) => area.includes('示意範圍'))).toBe(false);
    }
  });

  it('maps every official regional scope to exactly one township or village geometry', async () => {
    const townshipDirectory = new URL('../../public/maps/townships/', import.meta.url);
    const villageDirectory = new URL('../../public/maps/villages/', import.meta.url);
    const files = (await readdir(townshipDirectory)).filter((file) => file.endsWith('.svg'));
    expect(files).toHaveLength(22);

    for (const file of files) {
      const townshipSource = await readFile(new URL(file, townshipDirectory), 'utf8');
      const villageSource = await readFile(new URL(file, villageDirectory), 'utf8');
      const countyName = values(townshipSource, 'data-county-name')[0];
      const jurisdiction = jurisdictions.find(({ name }) => name === countyName);
      expect(jurisdiction, `${file}縣市名稱`).toBeDefined();
      if (!jurisdiction) continue;

      const townshipNames = new Set(values(townshipSource, 'data-town-name'));
      const villagePairs = [...villageSource.matchAll(/<path\b[^>]*class="village"[^>]*>/g)].map(
        ([path]) => ({
          township: values(path, 'data-town-name')[0],
          village: values(path, 'data-vill-name')[0],
        }),
      );
      const districts = getRegionalCouncilDistricts(jurisdiction.id);

      for (const district of districts) {
        for (const township of district.townships) {
          expect(townshipNames.has(township), `${district.id}：${township}`).toBe(true);
        }
        for (const group of district.villageGroups) {
          expect(townshipNames.has(group.township), `${district.id}：${group.township}`).toBe(true);
          const actualVillages = new Set(
            villagePairs
              .filter(({ township }) => township === group.township)
              .map(({ village }) => village),
          );
          for (const village of group.villages) {
            expect(actualVillages.has(village), `${district.id}：${village}`).toBe(true);
          }
        }
      }

      for (const township of townshipNames) {
        const matches = findRegionalCouncilDistricts(jurisdiction.id, township);
        const villageSplit = matches.some(({ villageGroups }) =>
          villageGroups.some((group) => group.township === township),
        );
        if (!villageSplit) {
          expect(matches, `${jurisdiction.name}${township}`).toHaveLength(1);
          continue;
        }

        const villages = villagePairs.filter((item) => item.township === township);
        expect(villages.length, `${jurisdiction.name}${township}村里圖資`).toBeGreaterThan(0);
        for (const { village } of villages) {
          expect(
            findRegionalCouncilDistricts(jurisdiction.id, township, village),
            `${jurisdiction.name}${township}${village}`,
          ).toHaveLength(1);
        }
      }
    }
  });

  it('defines New Taipei district 2 as Linkou, Wugu, and Taishan only', () => {
    const district = getCouncilDistricts('NTP').find(({ number }) => number === 2);
    expect(district?.townships).toEqual(['林口區', '五股區', '泰山區']);
    expect(district?.seats).toBe(5);
  });
});
