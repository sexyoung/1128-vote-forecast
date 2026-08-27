import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';
import {
  buildTownshipContest,
  buildVillageContest,
  mapLocationToJurisdiction,
  parseShapeContestId,
} from './map-shapes';
import { getJurisdiction } from './mock-election';

const yilan = getJurisdiction('ILA');
const luodong = {
  id: 'town-10002040',
  path: '',
  townCode: '10002040',
  townName: '羅東鎮',
  countyName: '宜蘭縣',
};

describe('contests built from the boundary data', () => {
  // 鄉鎮市長與村里長沒有選舉區劃分，範圍就是行政區本身，所以不必等各縣市
  // 選委會的公告，直接從圖資產生。
  it('names a township mayor after the township itself', () => {
    const contest = buildTownshipContest(luodong, yilan);

    expect(contest.name).toBe('羅東鎮長');
    expect(contest.area).toBe('宜蘭縣羅東鎮全境');
    expect(contest.seatCount).toBe(1);
    expect(contest.view).toBe('TOWNSHIP');
  });

  it('names a village chief after the village itself', () => {
    const contest = buildVillageContest(
      { ...luodong, id: 'vill-10002040001', villCode: '10002040001', villName: '仁愛里' },
      yilan,
    );

    expect(contest.name).toBe('羅東鎮仁愛里長');
    expect(contest.area).toBe('宜蘭縣羅東鎮仁愛里全境');
    expect(contest.seatCount).toBe(1);
  });

  // 圖資裡有些村里沒有名字（VILLCODE 夾雜英文字母那種），不能讓卡片變成「鎮長」。
  it('labels an unnamed village rather than dropping the name', () => {
    const contest = buildVillageContest(
      { ...luodong, id: 'vill-09007010S31', villCode: '09007010S31', villName: '' },
      yilan,
    );

    expect(contest.name).toBe('羅東鎮未編定村里長');
  });
});

describe('resolving a boundary contest id back to its county', () => {
  // /contest/:id 沒有其他線索，全靠 id 前 5 碼的縣市碼決定要載入哪一份圖資。
  it('reads the county out of the id', () => {
    expect(parseShapeContestId('town-10002040-TOWNSHIP')).toEqual({
      shapeId: 'town-10002040',
      locationId: 'yilan-county',
      view: 'TOWNSHIP',
    });
    expect(parseShapeContestId('vill-65000010001-VILLAGE')).toEqual({
      shapeId: 'vill-65000010001',
      locationId: 'new-taipei-city',
      view: 'VILLAGE',
    });
  });

  it('handles the village codes that carry letters', () => {
    expect(parseShapeContestId('vill-09007010S31-VILLAGE')?.locationId).toBe('lienchiang-county');
  });

  // 代表跟鄉鎮市長共用 town- 開頭的圖形，第一版正則漏了 REPRESENTATIVE，
  // 結果代表的詳細頁整頁解不開。
  it('handles all three views built from the boundary data', () => {
    for (const view of ['TOWNSHIP', 'REPRESENTATIVE'] as const)
      expect(parseShapeContestId(`town-10008010-${view}`)).toEqual({
        shapeId: 'town-10008010',
        locationId: 'nantou-county',
        view,
      });
  });

  it('ignores ids that belong to the static contest list', () => {
    expect(parseShapeContestId('TPE-EXECUTIVE-1')).toBeNull();
    expect(parseShapeContestId('NTP-COUNCIL-2')).toBeNull();
    expect(parseShapeContestId('town-99999999-TOWNSHIP')).toBeNull();
  });

  // 前綴跟選舉種類要對得起來，不然 vill- 的圖形會被拿去當鄉鎮市長找不到而整頁空白。
  it('rejects a prefix that contradicts the view', () => {
    expect(parseShapeContestId('vill-10002040001-TOWNSHIP')).toBeNull();
    expect(parseShapeContestId('town-10002040-VILLAGE')).toBeNull();
  });

  // 縣市碼對照表是手寫的。這則直接讀圖資，確保沒有哪個縣市漏掉或抄錯——漏掉的話
  // 那個縣市的鄉鎮市長／村里長詳細頁會整頁解不開，而且只有點進去才會發現。
  it('resolves every county present in the boundary data', async () => {
    const directory = new URL('../../public/maps/townships/', import.meta.url);
    const files = (await readdir(directory)).filter((file) => file.endsWith('.svg'));
    expect(files.length).toBe(Object.keys(mapLocationToJurisdiction).length);

    for (const file of files) {
      const svg = await readFile(new URL(file, directory), 'utf8');
      const countyCode = /data-county-code="(\d+)"/.exec(svg)?.[1];
      const locationId = file.replace('.svg', '');

      expect(parseShapeContestId(`town-${countyCode}001-TOWNSHIP`)?.locationId, locationId).toBe(
        locationId,
      );
      expect(mapLocationToJurisdiction[locationId], locationId).toBeTruthy();
    }
  });
});
