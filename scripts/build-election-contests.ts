/**
 * 產生伺服器用的選區清冊 src/server/data/election-contests.json。
 *
 * 伺服器必須能回答兩件事才收得下一筆預測：這個 contestId 存不存在、這一場應選
 * 幾席。前端的選區是跑在瀏覽器裡從 mock-election 與圖資 SVG 算出來的，伺服器
 * 沒有 DOM 也不該去 fetch 自己的 public 目錄，所以在 build 時先算好一份。
 *
 * 這支腳本刻意 import 前端的同一批函式（getContests、buildTownshipContest…），
 * 名稱與席次的規則只有一份，不會兩邊漂移。SVG 則直接從磁碟用正規表示式讀屬性，
 * 因為 loadTownshipShapes 依賴 fetch 與 DOMParser。
 *
 * 用法：npm run data:contests
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type TownshipShape,
  type VillageShape,
  buildRepresentativeContest,
  buildTownshipContest,
  buildVillageContest,
  hasLocalExecutiveElection,
  isLocalExecutiveTownship,
  jurisdictionToMapLocation,
} from '../src/client/map-shapes';
import {
  type Contest,
  type Jurisdiction,
  getContests,
  jurisdictions,
} from '../src/client/mock-election';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 席次有沒有官方依據。代表的名額由各縣市選委會依地方制度法第 33 條按人口劃分，
 * 那份公告還沒進來，buildRepresentativeContest 目前是估的。
 */
type SeatsSource = 'OFFICIAL' | 'PLACEHOLDER';

type RegistryEntry = {
  id: string;
  jurisdictionId: string;
  type: Contest['view'];
  name: string;
  area: string;
  seats: number;
  seatsSource: SeatsSource;
};

function toEntry(contest: Contest): RegistryEntry {
  return {
    id: contest.id,
    jurisdictionId: contest.jurisdictionId,
    type: contest.view,
    name: contest.name,
    area: contest.area,
    seats: contest.seatCount,
    seatsSource: contest.view === 'REPRESENTATIVE' ? 'PLACEHOLDER' : 'OFFICIAL',
  };
}

/** 從 SVG 讀出 path 的 data-* 屬性。屬性順序固定，直接掃比拉進 DOM 便宜。 */
function readShapes(file: string, className: 'township' | 'village') {
  const svg = readFileSync(file, 'utf8');
  const pattern = new RegExp(`<path\\b[^>]*class="${className}"[^>]*>`, 'g');
  return [...svg.matchAll(pattern)].map((match) => {
    const tag = match[0];
    const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
    return {
      id: attribute('id'),
      path: '',
      townCode: attribute('data-town-code'),
      townName: attribute('data-town-name'),
      countyName: attribute('data-county-name'),
      villCode: attribute('data-vill-code'),
      villName: attribute('data-vill-name'),
    };
  });
}

function townshipFile(locationId: string) {
  return join(root, 'public/maps/townships', `${locationId}.svg`);
}

function villageFile(locationId: string) {
  return join(root, 'public/maps/villages', `${locationId}.svg`);
}

function localExecutiveContests(jurisdiction: Jurisdiction, locationId: string) {
  // 直轄市只有五個山地原住民區有區長與區民代表，其餘市轄區沒有這兩場選舉。
  if (!hasLocalExecutiveElection(jurisdiction)) return [];
  const shapes = readShapes(townshipFile(locationId), 'township') as TownshipShape[];
  const eligible = shapes.filter((shape) => isLocalExecutiveTownship(jurisdiction, shape));
  return [
    ...eligible.map((shape) => buildTownshipContest(shape, jurisdiction)),
    ...eligible.map((shape) => buildRepresentativeContest(shape, jurisdiction)),
  ];
}

function villageContests(jurisdiction: Jurisdiction, locationId: string) {
  const shapes = readShapes(villageFile(locationId), 'village') as VillageShape[];
  return shapes.map((shape) => buildVillageContest(shape, jurisdiction));
}

const entries: RegistryEntry[] = [];

for (const jurisdiction of jurisdictions) {
  const locationId = jurisdictionToMapLocation[jurisdiction.id];
  if (!locationId) throw new Error(`${jurisdiction.id} 沒有對應的圖資檔名`);

  entries.push(
    ...getContests(jurisdiction, 'EXECUTIVE').map(toEntry),
    ...getContests(jurisdiction, 'COUNCIL').map(toEntry),
    ...localExecutiveContests(jurisdiction, locationId).map(toEntry),
    ...villageContests(jurisdiction, locationId).map(toEntry),
  );
}

const duplicates = entries
  .map(({ id }) => id)
  .filter((id, index, all) => all.indexOf(id) !== index);
if (duplicates.length > 0) throw new Error(`選區代號重複：${duplicates.slice(0, 5).join(', ')}`);

const outputDir = join(root, 'src/server/data');
mkdirSync(outputDir, { recursive: true });
// 一列一個選區：8,429 筆縮排開來是 2 MB，diff 也讀不動；一列一筆既小又看得出
// 哪一區變了。
const lines = entries.map((entry) => JSON.stringify(entry)).join(',\n');
writeFileSync(
  join(outputDir, 'election-contests.json'),
  `{"generatedFrom":"npm run data:contests","contests":[\n${lines}\n]}\n`,
);

const byType = entries.reduce<Record<string, number>>((totals, entry) => {
  totals[entry.type] = (totals[entry.type] ?? 0) + 1;
  return totals;
}, {});
console.log(`寫入 ${entries.length} 個選區`, byType);
