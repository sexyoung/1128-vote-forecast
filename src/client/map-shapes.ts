import { type Contest, type Jurisdiction, getJurisdiction } from './mock-election';

// 圖資的鄉鎮市區與村里。地圖與 /region 列表頁共用同一份載入與同一組 contest
// 產生規則，兩邊看到的名稱、範圍與 id 才會一致。
export type TownshipShape = {
  id: string;
  path: string;
  townCode: string;
  townName: string;
  countyName: string;
};

export type VillageShape = TownshipShape & { villCode: string; villName: string };

export const mapLocationToJurisdiction: Record<string, string> = {
  'changhua-county': 'CHA',
  'chiayi-city': 'CYI',
  'chiayi-county': 'CYQ',
  'hualien-county': 'HUA',
  'hsinchu-city': 'HSZ',
  'hsinchu-county': 'HSQ',
  'kaohsiung-city': 'KHH',
  'keelung-city': 'KEE',
  'kinmen-county': 'KIN',
  'lienchiang-county': 'LIE',
  'miaoli-county': 'MIA',
  'nantou-county': 'NAN',
  'new-taipei-city': 'NTP',
  'penghu-county': 'PEN',
  'pingtung-county': 'PIF',
  'taichung-city': 'TXG',
  'tainan-city': 'TNN',
  'taipei-city': 'TPE',
  'taitung-county': 'TTT',
  'taoyuan-city': 'TAO',
  'yilan-county': 'ILA',
  'yunlin-county': 'YUN',
};

export const jurisdictionToMapLocation: Record<string, string> = Object.fromEntries(
  Object.entries(mapLocationToJurisdiction).map(([locationId, jurisdictionId]) => [
    jurisdictionId,
    locationId,
  ]),
);

// 圖資的 id 自己帶著縣市碼（town-10002010、vill-10002010001 的前 5 碼都是 10002），
// 所以 /contest/:id 不必額外傳參數就能反查該載入哪一個縣市的圖層。
const countyCodeToMapLocation: Record<string, string> = {
  '09007': 'lienchiang-county',
  '09020': 'kinmen-county',
  '10002': 'yilan-county',
  '10004': 'hsinchu-county',
  '10005': 'miaoli-county',
  '10007': 'changhua-county',
  '10008': 'nantou-county',
  '10009': 'yunlin-county',
  '10010': 'chiayi-county',
  '10013': 'pingtung-county',
  '10014': 'taitung-county',
  '10015': 'hualien-county',
  '10016': 'penghu-county',
  '10017': 'keelung-city',
  '10018': 'hsinchu-city',
  '10020': 'chiayi-city',
  '63000': 'taipei-city',
  '64000': 'kaohsiung-city',
  '65000': 'new-taipei-city',
  '66000': 'taichung-city',
  '67000': 'tainan-city',
  '68000': 'taoyuan-city',
};

export async function loadMapPaths(url: string, selector: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('地圖資料載入失敗');
  const document = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  return [...document.querySelectorAll<SVGPathElement>(selector)];
}

// 鄉鎮市區與村里都按縣市切檔，點到哪個縣市才載入哪一份；靜態圖資不會變動，
// 所以用 module 層的 cache 保留已載入的 promise。
const countyLayerCache = new Map<string, Promise<TownshipShape[] | VillageShape[]>>();

export function loadTownshipShapes(locationId: string): Promise<TownshipShape[]> {
  const url = `/maps/townships/${locationId}.svg`;
  const cached = countyLayerCache.get(url) as Promise<TownshipShape[]> | undefined;
  if (cached) return cached;

  const pending = loadMapPaths(url, 'path.township').then((paths) =>
    paths.map((path) => ({
      id: path.id,
      path: path.getAttribute('d') ?? '',
      townCode: path.dataset.townCode ?? '',
      townName: path.dataset.townName ?? '',
      countyName: path.dataset.countyName ?? '',
    })),
  );
  pending.catch(() => countyLayerCache.delete(url));
  countyLayerCache.set(url, pending);
  return pending;
}

export function loadVillageShapes(locationId: string): Promise<VillageShape[]> {
  const url = `/maps/villages/${locationId}.svg`;
  const cached = countyLayerCache.get(url) as Promise<VillageShape[]> | undefined;
  if (cached) return cached;

  const pending = loadMapPaths(url, 'path.village').then((paths) =>
    paths.map((path) => ({
      id: path.id,
      path: path.getAttribute('d') ?? '',
      townCode: path.dataset.townCode ?? '',
      townName: path.dataset.townName ?? '',
      countyName: path.dataset.countyName ?? '',
      villCode: path.dataset.villCode ?? '',
      villName: path.dataset.villName ?? '',
    })),
  );
  pending.catch(() => countyLayerCache.delete(url));
  countyLayerCache.set(url, pending);
  return pending;
}

export function getShapeSeed(value: string) {
  return value
    .split('')
    .reduce(
      (total, character) => total + (Number.isNaN(Number(character)) ? 7 : Number(character)),
      0,
    );
}

export function getShapeResult(jurisdiction: Jurisdiction, seed: number) {
  const challengers: Contest['leader'][] = ['KMT', 'DPP', 'TPP', 'IND'];
  return {
    forecasts: 80 + ((seed * 47) % 720),
    leader: seed % 5 < 3 ? jurisdiction.leader : challengers[seed % challengers.length],
    percentage: 36 + (seed % 18),
  };
}

// 鄉鎮市長與村里長沒有選舉區劃分：中選會的選舉區公告只到直轄市長、縣市長與
// 議員（第 38 條第 1 項第 1 款），這兩個職位一鄉一席、一里一席，範圍就是整個
// 行政區本身，所以直接從圖資產生，不需要等各縣市選委會的公告。
export function buildTownshipContest(township: TownshipShape, jurisdiction: Jurisdiction): Contest {
  return {
    id: `${township.id}-TOWNSHIP`,
    jurisdictionId: jurisdiction.id,
    name: `${township.townName}長`,
    area: `${jurisdiction.name}${township.townName}全境`,
    seatCount: 1,
    view: 'TOWNSHIP',
    ...getShapeResult(jurisdiction, getShapeSeed(township.townCode)),
  };
}

// 鄉鎮市民代表跟上面兩個不同，是真的有選舉區劃分的——但那份公告由各縣市選舉
// 委員會發布，中選會的公告只到議員這一層，圖資裡也沒有。我們確定知道的只有
// 「這個鄉鎮市有代表選舉」，所以一鄉鎮市列一筆，鎮內怎麼分不假造。
// 名額依地方制度法第 33 條按人口決定，這裡沒有人口資料，先給暫定值並在畫面上標明。
export function buildRepresentativeContest(
  township: TownshipShape,
  jurisdiction: Jurisdiction,
): Contest {
  const seed = getShapeSeed(township.townCode);
  return {
    id: `${township.id}-REPRESENTATIVE`,
    jurisdictionId: jurisdiction.id,
    name: `${township.townName}民代表`,
    area: `${jurisdiction.name}${township.townName}代表選區`,
    seatCount: 5 + (seed % 4) * 2,
    view: 'REPRESENTATIVE',
    ...getShapeResult(jurisdiction, seed),
  };
}

export function buildVillageContest(village: VillageShape, jurisdiction: Jurisdiction): Contest {
  // 未編定村里的 VILLCODE 夾雜英文字母（例如 09007010S31），非數字一律當 7。
  const name = village.villName || '未編定村里';
  return {
    id: `${village.id}-VILLAGE`,
    jurisdictionId: jurisdiction.id,
    name: `${village.townName}${name}長`,
    area: `${jurisdiction.name}${village.townName}${name}全境`,
    seatCount: 1,
    view: 'VILLAGE',
    ...getShapeResult(jurisdiction, getShapeSeed(village.villCode)),
  };
}

type ShapeContestView = 'TOWNSHIP' | 'REPRESENTATIVE' | 'VILLAGE';

/**
 * `town-10002010-TOWNSHIP`、`town-10002010-REPRESENTATIVE`、
 * `vill-10002010001-VILLAGE` 拆成該去哪裡找的線索。
 */
export function parseShapeContestId(contestId: string) {
  const match = /^(town|vill)-([0-9A-Za-z]+)-(TOWNSHIP|REPRESENTATIVE|VILLAGE)$/.exec(contestId);
  if (!match) return null;
  const [, prefix, code, view] = match;
  const locationId = countyCodeToMapLocation[code.slice(0, 5)];
  // 村里的 id 用 vill-、鄉鎮市的用 town-，對不起來就是編出來的 id。
  if (!locationId || (view === 'VILLAGE') !== (prefix === 'vill')) return null;
  return { shapeId: `${prefix}-${code}`, locationId, view: view as ShapeContestView };
}

/** /contest/:id 用：圖資產生的選舉不在 mock-election 的靜態清單裡，要自己載回來。 */
export async function resolveShapeContest(contestId: string) {
  const parsed = parseShapeContestId(contestId);
  if (!parsed) return null;

  const jurisdiction = getJurisdiction(mapLocationToJurisdiction[parsed.locationId]);
  if (parsed.view === 'VILLAGE') {
    const shapes = await loadVillageShapes(parsed.locationId);
    const village = shapes.find((shape) => shape.id === parsed.shapeId);
    return village ? { contest: buildVillageContest(village, jurisdiction), jurisdiction } : null;
  }

  const build = parsed.view === 'TOWNSHIP' ? buildTownshipContest : buildRepresentativeContest;
  const shapes = await loadTownshipShapes(parsed.locationId);
  const township = shapes.find((shape) => shape.id === parsed.shapeId);
  return township ? { contest: build(township, jurisdiction), jurisdiction } : null;
}
