import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { findRegionalCouncilDistricts, needsVillageCouncilGeometry } from '../council-districts';
import {
  type Contest,
  type ElectionView,
  type Jurisdiction,
  electionViews,
  getContests,
  getJurisdiction,
  getParty,
  jurisdictions,
} from '../mock-election';
import { Icon, usePrototype } from './ElectionPrototypeShared';
import { ForecastForm, getResultRows } from './ForecastSheet';

const mapLocationToJurisdiction: Record<string, string> = {
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

type MapBounds = { x: number; y: number; width: number; height: number };
type MapPanState = MapBounds & {
  inverseMatrix: DOMMatrix;
  pointerId: number;
  screenX: number;
  screenY: number;
  moved: boolean;
};
// Safari 專屬的手勢事件，TypeScript 的 DOM 型別沒有定義。
type GestureLikeEvent = Event & { clientX?: number; clientY?: number; scale?: number };
type MapPinchState = {
  anchor: { x: number; y: number };
  bounds: MapBounds;
  distance: number;
  inverseMatrix: DOMMatrix;
  screenX: number;
  screenY: number;
};
type CountyShape = { id: string; name: string; path: string };
export type TownshipShape = {
  id: string;
  path: string;
  townCode: string;
  townName: string;
  countyName: string;
};
export type VillageShape = TownshipShape & { villCode: string; villName: string };
type CountyLayer<Shape> = { locationId: string; shapes: Shape[] };

const jurisdictionToMapLocation: Record<string, string> = Object.fromEntries(
  Object.entries(mapLocationToJurisdiction).map(([locationId, jurisdictionId]) => [
    jurisdictionId,
    locationId,
  ]),
);

// 開場就把整張畫布放進來：臺灣本島在 x 184–836，澎湖、金門、馬祖在圖資裡是
// 投影在左側 x 18–158 那一欄，寬度要涵蓋兩邊才會一起出現。
const initialMapViewBox = '0 10 860 1080';
// 可平移／縮放的範圍，四邊都比畫布（860×1100）留出空白，臺灣才能移開浮動 UI。
// 寬度必須大於 maximumZoomWidth：相等的話 clampToWorld 夾出來的區間會縮成單一
// 點，縮到最小時水平就完全鎖死。
const mapWorldBounds = { x: -90, y: -140, width: 1145, height: 1400 };
// 顯示鄉鎮市區的門檻依縣市大小而定：臺北市和花蓮縣差了五倍，用同一個絕對
// 寬度的話，臺北市會在自己還很小的時候就切成區。門檻＝該縣市外框的兩倍，
// 也就是它大約佔畫面一半寬時才切層；上下限用來避免臺東一開場就切層、
// 嘉義市則要縮到比村里級距還小才切得動。
const townshipZoomFactor = 2;
const minTownshipZoomWidth = 130;
const maxTownshipZoomWidth = 420;
// 視野寬到這個程度就算「看得到所有縣市」，此時才取消縣市選取。
const nationalViewWidth = 600;
// 切成村里的門檻同樣依「目前這個鄉鎮市區有多大」而定：秀林鄉和吉安鄉差了
// 六倍，用同一個絕對寬度的話，小的鄉鎮還沒放大就切成村里，大的鄉鎮已經滿出
// 畫面卻還沒切。門檻＝該鄉鎮外框的 2.2 倍，大約是它佔畫面一半時切層。
const villageZoomFactor = 2.2;
const defaultVillageZoomWidth = 64;
const minVillageZoomWidth = 20;
// 上限壓住頭城鎮（含釣魚臺）、旗津區（含東沙南沙）這種外框橫跨整張畫布的區。
const maxVillageZoomWidth = 160;
const minimumZoomWidth = 14;
// 比開場視野（860）再往外一級。必須大於開場寬度，否則第一次滾動就會被夾回來。
const maximumZoomWidth = 965;
const mapFocusAnimationDuration = 520;
const mainMapBounds = { x: 184, y: 20, width: 652, height: 1060 };
const islandInsets = [
  {
    bounds: { x: 18, y: 30, width: 140, height: 110 },
    jurisdictionId: 'LIE',
    label: '馬祖',
    locationId: 'lienchiang-county',
    viewBox: '18 30 140 110',
  },
  {
    bounds: { x: 18, y: 185, width: 140, height: 110 },
    jurisdictionId: 'KIN',
    label: '金門',
    locationId: 'kinmen-county',
    viewBox: '18 185 140 110',
  },
  {
    bounds: { x: 18, y: 340, width: 140, height: 150 },
    jurisdictionId: 'PEN',
    label: '澎湖',
    locationId: 'penghu-county',
    viewBox: '18 340 140 150',
  },
];

export function shouldImmediatelyFocusJurisdiction(jurisdictionId: string) {
  return islandInsets.some((inset) => inset.jurisdictionId === jurisdictionId);
}

export function shouldShowTownshipBoundaryPreview(
  jurisdictionId: string | null,
  detailMode: boolean,
) {
  return (
    jurisdictionId !== null && !detailMode && !shouldImmediatelyFocusJurisdiction(jurisdictionId)
  );
}

export function shouldShowVillageBoundaryPreview(
  selectedTownshipId: string | null,
  villageMode: boolean,
) {
  return selectedTownshipId !== null && !villageMode;
}

export function shouldShowMapInspector(jurisdictionId: string | null, contest: Contest | null) {
  return jurisdictionId !== null && contest?.jurisdictionId === jurisdictionId;
}

export type MapElectionLevel = 'jurisdiction' | 'township' | 'village';

// 地圖層級只決定「這裡有哪些正式選舉」，不再讓全域選單把同一塊行政區
// 臨時變成任意選舉。縣的鄉鎮層可能同時對應議員、鄉鎮市長與代表，這三種
// 留到選取區域後在資訊 panel 內切換；直轄市與市的區沒有區長／代表選舉。
export function getElectionViewsForMapLevel(
  jurisdiction: Jurisdiction,
  level: MapElectionLevel,
): ElectionView[] {
  if (level === 'jurisdiction') return ['EXECUTIVE'];
  if (level === 'village') return ['VILLAGE'];
  return jurisdiction.kind === 'county' ? ['COUNCIL', 'TOWNSHIP', 'REPRESENTATIVE'] : ['COUNCIL'];
}

export function interpolateMapBounds(start: MapBounds, end: MapBounds, progress: number) {
  const clamped = Math.min(1, Math.max(0, progress));
  const eased = 1 - (1 - clamped) ** 3;
  return {
    x: start.x + (end.x - start.x) * eased,
    y: start.y + (end.y - start.y) * eased,
    width: start.width + (end.width - start.width) * eased,
    height: start.height + (end.height - start.height) * eased,
  };
}

function parseMapBounds(viewBox: string): MapBounds {
  const [x, y, width, height] = viewBox.split(' ').map(Number);
  return { x, y, width, height };
}

function formatMapBounds(bounds: MapBounds) {
  return `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`;
}

// 以 anchor（SVG 座標）為定點縮放，滾輪與雙指縮放共用。
function scaleMapBounds(
  bounds: MapBounds,
  requestedScale: number,
  anchor: { x: number; y: number },
): MapBounds {
  const width = Math.min(
    maximumZoomWidth,
    Math.max(minimumZoomWidth, bounds.width * requestedScale),
  );
  const scale = width / bounds.width;
  return {
    x: anchor.x - (anchor.x - bounds.x) * scale,
    y: anchor.y - (anchor.y - bounds.y) * scale,
    width,
    height: bounds.height * scale,
  };
}

function constrainMapBounds(bounds: MapBounds): MapBounds {
  return {
    ...bounds,
    x: clampToWorld(bounds.x, mapWorldBounds.x, mapWorldBounds.width, bounds.width),
    y: clampToWorld(bounds.y, mapWorldBounds.y, mapWorldBounds.height, bounds.height),
  };
}

// 視野比可平移範圍還大的時候（縮到最小的一段）夾不出區間，改成置中，
// 不然會被釘在某一角。
function clampToWorld(value: number, start: number, span: number, size: number) {
  const end = start + span - size;
  if (start > end) return (start + end) / 2;
  return Math.min(end, Math.max(start, value));
}

async function loadMapPaths(url: string, selector: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('地圖資料載入失敗');
  const document = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  return [...document.querySelectorAll<SVGPathElement>(selector)];
}

async function loadCountyShapes() {
  const paths = await loadMapPaths('/maps/taiwan-counties.svg', 'path.county');
  const counties = paths.map((path) => ({
    id: path.id,
    name: path.dataset.name ?? '',
    path: path.getAttribute('d') ?? '',
  }));
  if (counties.length !== 22) throw new Error('地圖資料不完整');
  return counties;
}

// 鄉鎮市區與村里都按縣市切檔，點到哪個縣市才載入哪一份；靜態圖資不會變動，
// 所以用 module 層的 cache 保留已載入的 promise。
const countyLayerCache = new Map<string, Promise<TownshipShape[] | VillageShape[]>>();

function loadTownshipShapes(locationId: string): Promise<TownshipShape[]> {
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

function loadVillageShapes(locationId: string): Promise<VillageShape[]> {
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

function getShapeSeed(value: string) {
  return value
    .split('')
    .reduce(
      (total, character) => total + (Number.isNaN(Number(character)) ? 7 : Number(character)),
      0,
    );
}

function getShapeResult(jurisdiction: Jurisdiction, seed: number) {
  const challengers: Contest['leader'][] = ['KMT', 'DPP', 'TPP', 'IND'];
  return {
    forecasts: 80 + ((seed * 47) % 720),
    leader: seed % 5 < 3 ? jurisdiction.leader : challengers[seed % challengers.length],
    percentage: 36 + (seed % 18),
  };
}

function getCouncilContestForTownship(
  township: TownshipShape,
  jurisdiction: Jurisdiction,
): Contest | null {
  const districts = findRegionalCouncilDistricts(jurisdiction.id, township.townName);
  if (districts.length !== 1) return null;
  return getContests(jurisdiction, 'COUNCIL').find(({ id }) => id === districts[0].id) ?? null;
}

function getCouncilContestForVillage(village: VillageShape, jurisdiction: Jurisdiction) {
  const districts = findRegionalCouncilDistricts(
    jurisdiction.id,
    village.townName,
    village.villName,
  );
  if (districts.length !== 1 || districts[0].villageGroups.length === 0) return null;
  return getContests(jurisdiction, 'COUNCIL').find(({ id }) => id === districts[0].id) ?? null;
}

function getTownshipContest(
  township: TownshipShape,
  jurisdiction: Jurisdiction,
  index: number,
  view: ElectionView,
): Contest | null {
  if (view === 'COUNCIL') return getCouncilContestForTownship(township, jurisdiction);

  const seed = getShapeSeed(township.townCode);
  const result = getShapeResult(jurisdiction, seed);
  const representative = view === 'REPRESENTATIVE';
  const representativeContests = representative ? getContests(jurisdiction, 'REPRESENTATIVE') : [];
  const representativeTemplate = representativeContests[index % representativeContests.length];
  return {
    id: `${township.id}-${view}`,
    jurisdictionId: jurisdiction.id,
    name: representative ? `${township.townName}民代表` : `${township.townName}長`,
    area: `${jurisdiction.name}${township.townName}${representative ? '代表選區' : '全境'}`,
    seatCount: representativeTemplate?.seatCount ?? 1,
    view,
    ...result,
  };
}

export function getTownshipContestOptions(
  township: TownshipShape,
  jurisdiction: Jurisdiction,
  index: number,
) {
  return getElectionViewsForMapLevel(jurisdiction, 'township')
    .map((view) => getTownshipContest(township, jurisdiction, index, view))
    .filter((contest): contest is Contest => contest !== null);
}

function getVillageContest(village: VillageShape, jurisdiction: Jurisdiction): Contest {
  // 未編定村里的 VILLCODE 夾雜英文字母（例如 09007010S31），非數字一律當 7。
  const seed = getShapeSeed(village.villCode);
  const name = village.villName || '未編定村里';
  return {
    id: `${village.id}-VILLAGE`,
    jurisdictionId: jurisdiction.id,
    name: `${village.townName}${name}長`,
    area: `${jurisdiction.name}${village.townName}${name}全境`,
    seatCount: 1,
    view: 'VILLAGE',
    ...getShapeResult(jurisdiction, seed),
  };
}

// selected 的加深直接算進 fill，不用 CSS filter：Safari（含 iOS）對 inline SVG
// 子元素的 filter 支援不穩，手機上會完全看不到選取效果。
function tint(hex: string, percentage: number, selected = false) {
  const value = hex.replace('#', '');
  const strength = Math.min(0.94, Math.max(0.34, 0.34 + (percentage - 32) * 0.028));
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const shade = selected ? 0.56 : 1;
  return `rgb(${channels
    .map((channel) => Math.round((248 + (channel - 248) * strength) * shade))
    .join(' ')})`;
}

function MapBrand() {
  return (
    <Link className="map-brand" to="/">
      <span>
        <Icon name="spark" />
      </span>
      <strong>看選情</strong>
    </Link>
  );
}

// 模擬資料的預測份數落在 80–799（見 getShapeResult），門檻設在這個區間的低段，
// 讓「樣本太少」這個狀態在原型裡真的走得到。正式版應該改成依選區規模決定。
const lowSampleThreshold = 150;

function MapInspector({
  contest,
  contestOptions,
  jurisdiction,
  expanded,
  myForecast,
  showForm,
  onClose,
  onContestChange,
  onExpandedChange,
  onForecast,
  onBackToResult,
  onSubmitted,
}: {
  contest: Contest;
  contestOptions: Contest[];
  jurisdiction: Jurisdiction;
  expanded: boolean;
  myForecast?: string;
  showForm: boolean;
  onClose: () => void;
  onContestChange: (contest: Contest) => void;
  onExpandedChange: (expanded: boolean) => void;
  onForecast: () => void;
  onBackToResult: () => void;
  onSubmitted: (picked: string[]) => void;
}) {
  const { phase } = usePrototype();
  const rows = getResultRows(contest, phase);
  const leader = rows[0];
  // 份數太少時不放大領先者，避免十來份預測被讀成民調。
  const lowSample = contest.forecasts < lowSampleThreshold;
  const countOf = (value: number) => Math.round((contest.forecasts * value) / 100).toLocaleString();

  if (showForm)
    return (
      <aside className="map-inspector expanded forecasting">
        <header className="map-inspector-back">
          <button
            aria-label="返回預測結果"
            className="map-round-button"
            onClick={onBackToResult}
            type="button"
          >
            <Icon name="back" />
          </button>
          <span>
            <strong>{contest.name}</strong>
            <small>{contest.area}</small>
          </span>
        </header>
        <ForecastForm contest={contest} onSubmitted={onSubmitted} />
      </aside>
    );

  return (
    <aside
      className={`map-inspector ${expanded ? 'expanded' : ''} ${
        contestOptions.length > 1 ? 'has-switch' : ''
      }`}
    >
      <button
        aria-label={expanded ? '收合資訊' : '展開資訊'}
        className="map-sheet-handle"
        onClick={() => onExpandedChange(!expanded)}
        type="button"
      >
        <i />
      </button>
      <header>
        <div>
          <span>{jurisdiction.name}</span>
          <h2>{contest.name}</h2>
          <small>
            {contest.area} · 應選 {contest.seatCount} 席
          </small>
        </div>
        <button
          aria-label="關閉選區資訊"
          className="map-round-button"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" />
        </button>
      </header>
      {/* 切換器要排在摘要前面：手機收合時「投的是哪一場」必須跟送出按鈕一起看得到，
          不然像宜蘭第九選區有議員／鄉鎮市長／代表三場時，只能投到當下那一場。 */}
      {contestOptions.length > 1 && (
        <div className="map-contest-switch" role="tablist" aria-label="此區域的選舉">
          {contestOptions.map((option) => (
            <button
              aria-selected={option.id === contest.id}
              className={option.id === contest.id ? 'active' : ''}
              key={option.id}
              onClick={() => onContestChange(option)}
              role="tab"
              type="button"
            >
              {electionViews.find((item) => item.id === option.view)?.shortLabel}
            </button>
          ))}
        </div>
      )}
      {/* 收合的手機抽屜專用摘要，桌機與展開後都不顯示。 */}
      <div className={`map-peek ${lowSample ? 'low' : ''}`}>
        <span>
          <i style={{ background: leader.color }} />
          {lowSample ? '預測份數還很少' : `${leader.label}領先`}
        </span>
        <b style={lowSample ? undefined : { color: leader.color }}>
          {lowSample ? `${contest.forecasts.toLocaleString()} 份` : `${leader.value}%`}
        </b>
      </div>
      {myForecast && (
        <div className="map-my-forecast">
          <i>
            <Icon name="check" />
          </i>
          <span>
            <strong>你預測 {myForecast} 勝出</strong>
            <small>剛剛送出 · 可隨時修改</small>
          </span>
        </div>
      )}
      {lowSample ? (
        <div className="map-low-sample">
          <i />
          <span>
            <strong>目前只有 {contest.forecasts.toLocaleString()} 份預測</strong>
            <small>份數太少，分布容易被少數人左右，先當作參考就好。</small>
          </span>
        </div>
      ) : (
        <span className="eyebrow map-share-head">目前預測分布</span>
      )}
      <div className={`map-share-bar ${lowSample ? 'faint' : ''}`}>
        {rows.map((row) => (
          <i key={row.id} style={{ background: row.color, width: `${row.value}%` }} />
        ))}
      </div>
      <div className="map-inspector-scroll">
        {!lowSample && (
          <div className="map-leader">
            <span>
              <i style={{ background: leader.color }} />
              {leader.label}
            </span>
            <b style={{ color: leader.color }}>{leader.value}%</b>
            <small>目前領先 · {countOf(leader.value)} 份</small>
          </div>
        )}
        <div className="map-result-list">
          {(lowSample ? rows : rows.slice(1)).map((row) => (
            <div key={row.id}>
              <span>
                <i style={{ background: row.color }} />
                {row.label}
              </span>
              <b>{lowSample ? countOf(row.value) : `${row.value}%`}</b>
              <small>{lowSample ? `${row.value}%` : `${countOf(row.value)} 份`}</small>
            </div>
          ))}
        </div>
        <p className="map-inspector-total">
          共 <strong>{contest.forecasts.toLocaleString()}</strong> 份有效預測 · 2 分鐘前更新
        </p>
        <div className="map-inspector-links">
          <button type="button">查看趨勢</button>
          <i />
          <button type="button">留言 36</button>
        </div>
      </div>
      <footer className="map-inspector-footer">
        <button
          className={`button button-wide ${myForecast ? 'button-ghost' : 'button-accent'}`}
          onClick={onForecast}
          type="button"
        >
          {!myForecast && <Icon name="vote" />}
          {myForecast
            ? '修改我的預測'
            : lowSample
              ? `成為第 ${(contest.forecasts + 1).toLocaleString()} 份預測`
              : '送出我的預測'}
        </button>
      </footer>
    </aside>
  );
}

export function ElectionHomePage() {
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<Jurisdiction | null>(null);
  const [selectedContest, setSelectedContest] = useState<Contest | null>(null);
  const [detailMode, setDetailMode] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  // 這一版先記在記憶體裡，正式版會綁到匿名身份。key 是 contest.id。
  const [myForecasts, setMyForecasts] = useState<Record<string, string>>({});
  const [viewBox, setViewBox] = useState(initialMapViewBox);
  const [selectedTownshipId, setSelectedTownshipId] = useState<string | null>(null);
  const [selectedVillageId, setSelectedVillageId] = useState<string | null>(null);
  // 目前聚焦的鄉鎮市區：滑鼠滾輪放大時會自動跟著游標下的區切換，點選也會設定。
  // 只要它不是 null，同縣市其他鄉鎮市區與村里就淡化。
  const [focusedTownCode, setFocusedTownCode] = useState<string | null>(null);
  // 依游標下的鄉鎮市區大小算出來的村里切層門檻，隨縮放更新。
  const [villageZoomWidth, setVillageZoomWidth] = useState(defaultVillageZoomWidth);
  const [countyShapes, setCountyShapes] = useState<CountyShape[]>([]);
  const [townshipLayer, setTownshipLayer] = useState<CountyLayer<TownshipShape> | null>(null);
  const [villageLayer, setVillageLayer] = useState<CountyLayer<VillageShape> | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [insetAnchors, setInsetAnchors] = useState<Record<string, { left: number; top: number }>>(
    {},
  );
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const mapStageRef = useRef<HTMLElement | null>(null);
  const mapSvgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<MapPanState | null>(null);
  const pinchRef = useRef<MapPinchState | null>(null);
  const trackpadGestureRef = useRef<{ anchor: DOMPoint; bounds: MapBounds } | null>(null);
  // 原生監聽器只掛一次，透過這個 ref 取得每次 render 後最新的處理函式。
  const mapGestureRef = useRef({
    onGestureChange: (_event: Event) => {},
    onGestureEnd: (_event: Event) => {},
    onGestureStart: (_event: Event) => {},
    onWheel: (_event: WheelEvent) => {},
  });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const multiTouchRef = useRef(false);
  const suppressClickRef = useRef(false);
  const mapFocusAnimationRef = useRef<number | null>(null);

  const selectedLocationId = selectedJurisdiction
    ? (jurisdictionToMapLocation[selectedJurisdiction.id] ?? null)
    : null;
  const mapWidth = parseMapBounds(viewBox).width;
  const activeContest = selectedContest;
  const townshipViews = selectedJurisdiction
    ? getElectionViewsForMapLevel(selectedJurisdiction, 'township')
    : [];
  const activeTownshipView =
    activeContest && townshipViews.includes(activeContest.view)
      ? activeContest.view
      : townshipViews[0];
  const councilVillageGeometryNeeded =
    detailMode &&
    activeTownshipView === 'COUNCIL' &&
    selectedJurisdiction !== null &&
    needsVillageCouncilGeometry(selectedJurisdiction.id);
  // 新竹縣竹北市與新竹市的議員選區本來就由村里組成。剛進入該層時先把這些
  // 村里當「議員選區幾何」顯示；只有使用者再往內縮放並聚焦某區，才切成里長。
  const villageZoom =
    detailMode &&
    mapWidth <= villageZoomWidth &&
    (!councilVillageGeometryNeeded || focusedTownCode !== null);

  useEffect(() => {
    let active = true;
    loadCountyShapes()
      .then((counties) => {
        if (active) setCountyShapes(counties);
      })
      .catch((error: unknown) => {
        if (active) setMapError(error instanceof Error ? error.message : '地圖資料載入失敗');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (mapFocusAnimationRef.current !== null) {
        window.cancelAnimationFrame(mapFocusAnimationRef.current);
      }
    },
    [],
  );

  // 離島標籤要跟著地圖跑：把每個離島框右緣的畫布座標換算成畫面座標，標籤就
  // 貼在該島旁邊，縮放平移都不會跑掉。detail mode 不顯示標籤，就不用算。
  useEffect(() => {
    if (detailMode) return;

    function updateAnchors() {
      const svg = mapSvgRef.current;
      const stage = mapStageRef.current;
      const matrix = svg?.getScreenCTM();
      if (!svg || !stage || !matrix) return;

      const stageRect = stage.getBoundingClientRect();
      setInsetAnchors(
        Object.fromEntries(
          islandInsets.map((inset) => {
            const point = new DOMPoint(
              inset.bounds.x + inset.bounds.width,
              inset.bounds.y + inset.bounds.height / 2,
            ).matrixTransform(matrix);
            return [
              inset.locationId,
              { left: point.x - stageRect.left, top: point.y - stageRect.top },
            ];
          }),
        ),
      );
    }

    updateAnchors();
    window.addEventListener('resize', updateAnchors);
    return () => window.removeEventListener('resize', updateAnchors);
  }, [detailMode, viewBox]);

  // 所有縮放手勢都要用 passive: false 的原生監聽器：React 的 onWheel／onTouchMove
  // 是 passive 的，裡面的 preventDefault() 沒有效果，瀏覽器會照樣縮放整個頁面。
  // 監聽器只掛在地圖區塊，頁面其他地方仍可正常縮放。
  useEffect(() => {
    const stage = mapStageRef.current;
    if (!stage) return;

    const options = { passive: false };
    const onWheel = (event: WheelEvent) => mapGestureRef.current.onWheel(event);
    const onGestureStart = (event: Event) => mapGestureRef.current.onGestureStart(event);
    const onGestureChange = (event: Event) => mapGestureRef.current.onGestureChange(event);
    const onGestureEnd = (event: Event) => mapGestureRef.current.onGestureEnd(event);
    const preventMultiTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };

    stage.addEventListener('wheel', onWheel, options);
    stage.addEventListener('gesturestart', onGestureStart, options);
    stage.addEventListener('gesturechange', onGestureChange, options);
    stage.addEventListener('gestureend', onGestureEnd, options);
    stage.addEventListener('touchmove', preventMultiTouch, options);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('gesturestart', onGestureStart);
      stage.removeEventListener('gesturechange', onGestureChange);
      stage.removeEventListener('gestureend', onGestureEnd);
      stage.removeEventListener('touchmove', preventMultiTouch);
    };
  }, []);

  useEffect(() => {
    if (!selectedLocationId) return;
    let active = true;
    loadTownshipShapes(selectedLocationId)
      .then((shapes) => {
        if (active) setTownshipLayer({ locationId: selectedLocationId, shapes });
      })
      .catch((error: unknown) => {
        if (active) setMapError(error instanceof Error ? error.message : '鄉鎮市區圖層載入失敗');
      });
    return () => {
      active = false;
    };
  }, [selectedLocationId]);

  // 村里圖層每個縣市 40 KB～730 KB：快靠近村里縮放級距時預先抓，
  // 或在區檢視點了某個鄉鎮市區後載入，才能疊上該區的村里界線。
  const villageNeeded =
    detailMode &&
    (councilVillageGeometryNeeded ||
      selectedTownshipId !== null ||
      mapWidth <= villageZoomWidth * 2);
  useEffect(() => {
    if (!selectedLocationId || !villageNeeded) return;
    let active = true;
    loadVillageShapes(selectedLocationId)
      .then((shapes) => {
        if (active) setVillageLayer({ locationId: selectedLocationId, shapes });
      })
      .catch((error: unknown) => {
        if (active) setMapError(error instanceof Error ? error.message : '村里圖層載入失敗');
      });
    return () => {
      active = false;
    };
  }, [selectedLocationId, villageNeeded]);

  const visibleTownships = useMemo(() => {
    if (!selectedJurisdiction || townshipLayer?.locationId !== selectedLocationId) return [];
    return townshipLayer.shapes.map((township, index) => {
      const options = getTownshipContestOptions(township, selectedJurisdiction, index);
      return {
        contest: options.find((contest) => contest.view === activeTownshipView) ?? null,
        options,
        township,
      };
    });
  }, [activeTownshipView, selectedJurisdiction, selectedLocationId, townshipLayer]);
  // 村里圖層在接近村里級距時就先掛上（畫成透明），離開時也還留著，這樣兩層
  // 才能靠 CSS 的 opacity transition 交叉淡入淡出，而不是瞬間切換。
  const visibleVillages = useMemo(() => {
    if (!selectedJurisdiction || !villageNeeded) return [];
    if (villageLayer?.locationId !== selectedLocationId) return [];
    return villageLayer.shapes.map((village) => ({
      contest: getVillageContest(village, selectedJurisdiction),
      village,
    }));
  }, [selectedJurisdiction, selectedLocationId, villageLayer, villageNeeded]);
  const visibleCouncilVillages = useMemo(() => {
    if (!selectedJurisdiction || !councilVillageGeometryNeeded) return [];
    return visibleVillages.flatMap(({ village }) => {
      const contest = getCouncilContestForVillage(village, selectedJurisdiction);
      return contest ? [{ contest, village }] : [];
    });
  }, [councilVillageGeometryNeeded, selectedJurisdiction, visibleVillages]);
  const villageMode = villageZoom && visibleVillages.length > 0;
  // 村里還沒畫出來就不要淡化：不然會停在「縣市灰底＋單一區有顏色、卻沒有更
  // 細的東西可看」的中間狀態。
  const townshipFocus = villageMode ? focusedTownCode : null;
  const selectedTownship = visibleTownships.find(
    ({ township }) => township.id === selectedTownshipId,
  );
  const activeContestOptions = selectedTownship?.options ?? (activeContest ? [activeContest] : []);
  const mapLevelView = villageMode
    ? 'VILLAGE'
    : selectedVillageId
      ? 'VILLAGE'
      : selectedTownshipId && activeTownshipView
        ? activeTownshipView
        : detailMode
          ? townshipViews[0]
          : 'EXECUTIVE';
  const mapLevelLabel = electionViews.find((item) => item.id === mapLevelView)?.label ?? '選舉';

  // 先清掉上一個選區的面板；從地圖點縣市時會在下方的入口放回該縣市 contest。
  function selectJurisdiction(jurisdiction: Jurisdiction) {
    cancelMapFocusAnimation();
    setSelectedJurisdiction(jurisdiction);
    setSelectedContest(null);
    setSelectedTownshipId(null);
    setSelectedVillageId(null);
    clearTownshipFocus();
    setVillageZoomWidth(defaultVillageZoomWidth);
    setInspectorExpanded(false);
  }

  function selectJurisdictionFromMap(jurisdiction: Jurisdiction, contest: Contest) {
    selectJurisdiction(jurisdiction);
    setSelectedContest(contest);
    if (shouldImmediatelyFocusJurisdiction(jurisdiction.id)) {
      focusOnJurisdiction(jurisdiction, true);
      return;
    }

    // 切層本來只發生在縮放事件裡，所以縮放深度已經夠、卻是用
    // 「點選」換縣市時，區不會出現，得再滾一下才有。這裡補上：
    // 目前視野已經到該縣市的區級距就直接切層，畫面不動。
    if (detailMode || mapWidth <= getTownshipZoomWidth(jurisdiction)) {
      setDetailMode(true);
    }
  }

  // 該縣市要切成鄉鎮市區層的 viewBox 寬度門檻。
  function getTownshipZoomWidth(jurisdiction: Jurisdiction | null) {
    const bounds = jurisdiction ? getSelectedMapBounds(jurisdiction) : null;
    if (!bounds) return maxTownshipZoomWidth;
    const extent = Math.max(bounds.width, bounds.height) * townshipZoomFactor;
    return Math.min(maxTownshipZoomWidth, Math.max(minTownshipZoomWidth, extent));
  }

  // 剛好框住某個縣市的 viewBox（含四周留白）。
  function getFittedBounds(jurisdiction: Jurisdiction): MapBounds | null {
    const bounds = getSelectedMapBounds(jurisdiction);
    if (!bounds) return null;
    const padding = Math.max(bounds.width, bounds.height) * 0.3;
    return {
      x: bounds.x - padding,
      y: bounds.y - padding,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    };
  }

  function cancelMapFocusAnimation() {
    if (mapFocusAnimationRef.current === null) return;
    window.cancelAnimationFrame(mapFocusAnimationRef.current);
    mapFocusAnimationRef.current = null;
  }

  function animateMapToBounds(bounds: MapBounds) {
    cancelMapFocusAnimation();
    const target = constrainMapBounds(bounds);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setViewBox(formatMapBounds(target));
      return;
    }

    const start = parseMapBounds(viewBox);
    let startedAt: number | null = null;
    const animate = (timestamp: number) => {
      startedAt ??= timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / mapFocusAnimationDuration);
      setViewBox(formatMapBounds(interpolateMapBounds(start, target, progress)));
      if (progress < 1) {
        mapFocusAnimationRef.current = window.requestAnimationFrame(animate);
      } else {
        mapFocusAnimationRef.current = null;
      }
    };
    mapFocusAnimationRef.current = window.requestAnimationFrame(animate);
  }

  // 帶到某個縣市並切進鄉鎮層，只剩該縣市的區有顏色。澎金馬從全臺視野進入時會平滑移動與放大。
  function focusOnJurisdiction(jurisdiction: Jurisdiction, smooth = false) {
    const fitted = getFittedBounds(jurisdiction);
    if (!fitted) return;
    if (smooth) animateMapToBounds(fitted);
    else {
      cancelMapFocusAnimation();
      setViewBox(formatMapBounds(constrainMapBounds(fitted)));
    }
    setDetailMode(true);
    setSelectedTownshipId(null);
    setSelectedVillageId(null);
    clearTownshipFocus();
  }

  function zoomIntoSelection() {
    if (selectedJurisdiction) focusOnJurisdiction(selectedJurisdiction);
  }

  // 跟縣市層同一套規則：往內縮放時，游標下的那一區就是聚焦目標，其餘淡化。
  // 縣市層沒有大小門檻（滑到哪個縣市就選哪個），這裡也刻意不加。
  function focusTownshipUnder(target: EventTarget) {
    const path = target instanceof Element ? target.closest('[data-town-code]') : null;
    const townCode = path?.getAttribute('data-town-code');
    if (townCode) setFocusedTownCode(townCode);
  }

  function clearTownshipFocus() {
    setFocusedTownCode(null);
  }

  // 用游標下那個鄉鎮市區的外框重算村里門檻。只在還沒進村里層時更新——進去之後
  // 游標下的是村里，拿村里的外框算會讓門檻縮水，畫面會在兩層之間彈來彈去。
  function updateVillageZoomWidth(target: EventTarget | null) {
    const path = target instanceof Element ? target.closest('[data-town-code]') : null;
    if (!(path instanceof SVGGraphicsElement)) return;
    if (path.hasAttribute('data-council-village')) return;
    const box = path.getBBox();
    const extent = Math.max(box.width, box.height) * villageZoomFactor;
    setVillageZoomWidth(Math.min(maxVillageZoomWidth, Math.max(minVillageZoomWidth, extent)));
  }

  // 滾輪與雙指縮放共用：套用新的 viewBox，並依縮放方向切換縣市／鄉鎮層級。
  function applyZoom(bounds: MapBounds, zoomingIn: boolean, target: EventTarget | null) {
    cancelMapFocusAnimation();
    const next = constrainMapBounds(bounds);
    const element = target instanceof Element ? target.closest('[data-jurisdiction-id]') : null;
    const targetId = element?.getAttribute('data-jurisdiction-id');
    const targetJurisdiction = targetId
      ? jurisdictions.find((jurisdiction) => jurisdiction.id === targetId)
      : null;

    // 往內縮放跨進鄉鎮級距時只切層，不動 viewBox——使用者停在哪就留在哪。
    // 已經選取的縣市優先：臺北市被新北市包住，游標稍微偏一點就會被判成新北市，
    // 顯示的區就跑掉了。沒有選取時才看游標下方。
    if (zoomingIn) {
      const jurisdiction = selectedJurisdiction ?? targetJurisdiction;
      if (jurisdiction && next.width <= getTownshipZoomWidth(jurisdiction)) {
        if (jurisdiction.id !== selectedJurisdiction?.id) selectJurisdiction(jurisdiction);
        setDetailMode(true);
      }
    }

    setViewBox(formatMapBounds(next));

    // 聚焦／淡化只存在於村里層。還沒放大到村里之前，整個縣市的鄉鎮市區維持
    // 全部上色；縮回鄉鎮層時也要立刻還原，不然會退不回「每一區都有顏色」。
    if (!villageMode) updateVillageZoomWidth(target);
    if (next.width > villageZoomWidth) {
      clearTownshipFocus();
      if (selectedVillageId) {
        setSelectedVillageId(null);
        setSelectedContest(null);
      }
    } else {
      if (target) focusTownshipUnder(target);
      if (zoomingIn && selectedContest?.view !== 'VILLAGE') {
        setSelectedContest(null);
        setSelectedTownshipId(null);
        setInspectorExpanded(false);
      }
    }

    if (
      !zoomingIn &&
      detailMode &&
      next.width > getTownshipZoomWidth(selectedJurisdiction) * 1.25
    ) {
      setDetailMode(false);
      setSelectedTownshipId(null);
      setSelectedVillageId(null);
      setSelectedContest(null);
      clearTownshipFocus();
    }

    // 取消縣市選取要等真的縮回「看得到所有縣市」為止。門檻依縣市大小而定，
    // 臺北市離開區級距時視野才 160 出頭，這時就清掉選取太早了。
    if (!zoomingIn && next.width > nationalViewWidth) setSelectedJurisdiction(null);
  }

  function getSelectedMapBounds(jurisdiction: Jurisdiction): MapBounds | null {
    const inset = islandInsets.find((item) => item.jurisdictionId === jurisdiction.id);
    if (inset) return inset.bounds;

    const bounds = pathRefs.current[jurisdiction.id]?.getBBox();
    if (!bounds) return null;
    const right = Math.min(bounds.x + bounds.width, mainMapBounds.x + mainMapBounds.width);
    const bottom = Math.min(bounds.y + bounds.height, mainMapBounds.y + mainMapBounds.height);
    const x = Math.max(bounds.x, mainMapBounds.x);
    const y = Math.max(bounds.y, mainMapBounds.y);
    return { x, y, width: right - x, height: bottom - y };
  }

  function toCanvasPoint(clientX: number, clientY: number) {
    const matrix = mapSvgRef.current?.getScreenCTM();
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null;
  }

  function handleMapWheel(event: WheelEvent) {
    event.preventDefault();
    const anchor = toCanvasPoint(event.clientX, event.clientY);
    if (!anchor) return;

    // Chrome、Edge、Firefox 把觸控板的雙指縮放送成 ctrl+wheel，deltaY 比滾輪
    // 小很多，係數要放大才跟得上手指。
    const intensity = event.ctrlKey ? 0.012 : 0.0015;
    const requestedScale = Math.exp(event.deltaY * intensity);
    applyZoom(
      scaleMapBounds(parseMapBounds(viewBox), requestedScale, anchor),
      requestedScale < 1,
      event.target,
    );
  }

  // Safari（桌機與 iOS）的雙指縮放另外送非標準的 gesture* 事件。桌機沒有
  // pointer 可用，就靠這組驅動縮放；觸控裝置已經有 pointer 那條路，這裡只擋掉
  // 瀏覽器自己的頁面縮放，不重複處理。
  function handleGestureStart(event: Event) {
    event.preventDefault();
    if (pointersRef.current.size >= 2) return;
    cancelMapFocusAnimation();
    const gesture = event as GestureLikeEvent;
    const anchor = toCanvasPoint(gesture.clientX ?? 0, gesture.clientY ?? 0);
    if (!anchor) return;
    trackpadGestureRef.current = { anchor, bounds: parseMapBounds(viewBox) };
  }

  function handleGestureChange(event: Event) {
    event.preventDefault();
    const gesture = trackpadGestureRef.current;
    if (!gesture || pointersRef.current.size >= 2) return;

    const scale = (event as GestureLikeEvent).scale ?? 1;
    const requestedScale = 1 / Math.max(0.05, scale);
    const { clientX = 0, clientY = 0 } = event as GestureLikeEvent;
    applyZoom(
      scaleMapBounds(gesture.bounds, requestedScale, gesture.anchor),
      requestedScale < 1,
      document.elementFromPoint(clientX, clientY),
    );
  }

  function handleGestureEnd(event: Event) {
    event.preventDefault();
    trackpadGestureRef.current = null;
  }

  // 監聽器本身只掛一次，每次 render 後把最新的處理函式塞進 ref。
  useEffect(() => {
    mapGestureRef.current = {
      onGestureChange: handleGestureChange,
      onGestureEnd: handleGestureEnd,
      onGestureStart: handleGestureStart,
      onWheel: handleMapWheel,
    };
  });

  function handleMapPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cancelMapFocusAnimation();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // 新的單指序列開始，清掉上一輪的多指旗標。這是唯一的清除點，所以縮放
    // 補送的 click 一定還被擋著，而真正的點擊一定已經解除。
    if (pointersRef.current.size === 1) multiTouchRef.current = false;

    // 第二根手指落下就從拖曳切成雙指縮放，並記下起始的距離、中點與 viewBox；
    // 之後每次移動都以這組起始值換算，手指才會跟畫面貼合。
    if (pointersRef.current.size === 2) {
      multiTouchRef.current = true;
      const matrix = event.currentTarget.getScreenCTM();
      if (!matrix) return;
      const [first, second] = [...pointersRef.current.values()];
      const screenX = (first.x + second.x) / 2;
      const screenY = (first.y + second.y) / 2;
      panRef.current = null;
      event.currentTarget.classList.remove('panning');
      pinchRef.current = {
        anchor: new DOMPoint(screenX, screenY).matrixTransform(matrix.inverse()),
        bounds: parseMapBounds(viewBox),
        distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
        inverseMatrix: matrix.inverse(),
        screenX,
        screenY,
      };
      return;
    }
    if (pointersRef.current.size > 2) return;

    const bounds = parseMapBounds(viewBox);
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    panRef.current = {
      ...bounds,
      inverseMatrix: matrix.inverse(),
      moved: false,
      pointerId: event.pointerId,
      screenX: event.clientX,
      screenY: event.clientY,
    };
    // 指標捕捉留到真的拖動才啟用：一按下就捕捉的話，click 會改派給 SVG
    // 本身，點縣市、鄉鎮市區、村里就都選不到了。
  }

  function handleMapPinch() {
    const pinch = pinchRef.current;
    const pointers = [...pointersRef.current.values()];
    if (!pinch || pointers.length < 2) return false;

    const [first, second] = pointers;
    const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
    const requestedScale = pinch.distance / distance;
    const zoomed = scaleMapBounds(pinch.bounds, requestedScale, pinch.anchor);

    // 兩指同時平移的部分：起始矩陣算出來的位移是起始縮放下的單位，要按目前
    // 的縮放比例換算，畫面才跟得上手指。
    const screenX = (first.x + second.x) / 2 - pinch.screenX;
    const screenY = (first.y + second.y) / 2 - pinch.screenY;
    const factor = zoomed.width / pinch.bounds.width;
    const x = (screenX * pinch.inverseMatrix.a + screenY * pinch.inverseMatrix.c) * factor;
    const y = (screenX * pinch.inverseMatrix.b + screenY * pinch.inverseMatrix.d) * factor;

    const midpoint = document.elementFromPoint((first.x + second.x) / 2, (first.y + second.y) / 2);
    applyZoom({ ...zoomed, x: zoomed.x - x, y: zoomed.y - y }, requestedScale < 1, midpoint);
    return true;
  }

  function handleMapPan(event: React.PointerEvent<SVGSVGElement>) {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (handleMapPinch()) return;

    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const screenX = event.clientX - pan.screenX;
    const screenY = event.clientY - pan.screenY;
    if (!pan.moved && Math.hypot(screenX, screenY) > 3) {
      pan.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.classList.add('panning');
    }
    if (!pan.moved) return;
    const x = screenX * pan.inverseMatrix.a + screenY * pan.inverseMatrix.c;
    const y = screenX * pan.inverseMatrix.b + screenY * pan.inverseMatrix.d;
    setViewBox(
      formatMapBounds(
        constrainMapBounds({
          x: pan.x - x,
          y: pan.y - y,
          width: pan.width,
          height: pan.height,
        }),
      ),
    );
  }

  function finishMapPan(event: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pinchRef.current && pointersRef.current.size < 2) pinchRef.current = null;
    // multiTouchRef 這裡刻意不重設：瀏覽器補送的 click 可能比手指放開晚上不只
    // 一個 tick，用計時器擋會賭時間差。改成一直留著旗標，等下一次單指按下
    // （handleMapPointerDown 裡 size === 1 時）才清掉——那一定發生在該次點擊的
    // click 之前，所以真正的點擊不受影響，縮放補送的那一下必定被擋。

    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.classList.remove('panning');
    if (pan.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    panRef.current = null;
  }

  // 點在地圖空白處（海面、背景）取消選取。先關面板，再點一次才退回全臺，
  // 免得在村里層誤觸就被丟回全國視野。
  function handleMapBackgroundClick(event: React.MouseEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget || !mapClickAllowed()) return;
    if (selectedContest) {
      setSelectedContest(null);
      setSelectedTownshipId(null);
      setSelectedVillageId(null);
      setInspectorExpanded(false);
      return;
    }
    if (selectedJurisdiction) resetMap();
  }

  function mapClickAllowed() {
    return !suppressClickRef.current && !multiTouchRef.current;
  }

  // 回到「看得到所有縣市」的視野就一併取消選取，不留著上一個縣市。
  function resetMap() {
    cancelMapFocusAnimation();
    setViewBox(initialMapViewBox);
    setDetailMode(false);
    setSelectedJurisdiction(null);
    setSelectedTownshipId(null);
    setSelectedVillageId(null);
    setSelectedContest(null);
    clearTownshipFocus();
  }

  return (
    <main
      className={`map-app ${activeContest ? 'has-selection' : ''} ${detailMode ? 'detail-mode' : ''} ${townshipFocus ? 'township-focus' : ''}`}
    >
      <section className="map-stage" ref={mapStageRef}>
        <div className="map-floating-top">
          <MapBrand />
          <div className="map-context" aria-label={`目前顯示${mapLevelLabel}預測`}>
            <Icon name="map" />
            <span>{selectedJurisdiction ? `${selectedJurisdiction.name} ›` : '全臺 ›'}</span>
            <strong>{mapLevelLabel}</strong>
          </div>
        </div>

        <div className="map-floating-actions">
          <Link aria-label="我的預測" className="map-round-button" to="/mine">
            <Icon name="vote" />
          </Link>
          <Link aria-label="登入" className="map-round-button" to="/mine#account">
            <Icon name="user" />
          </Link>
        </div>

        {detailMode && selectedJurisdiction && (
          <button className="map-back-button" onClick={() => resetMap()} type="button">
            ‹ 回到全臺
          </button>
        )}

        <svg
          aria-label="臺灣縣市預測地圖"
          className="taiwan-map-svg"
          onClick={handleMapBackgroundClick}
          onDoubleClick={zoomIntoSelection}
          onPointerCancel={finishMapPan}
          onPointerDown={handleMapPointerDown}
          onPointerMove={handleMapPan}
          onPointerUp={finishMapPan}
          ref={mapSvgRef}
          role="img"
          viewBox={viewBox}
        >
          <g className="county-layer">
            {countyShapes.map((location) => {
              const jurisdiction = getJurisdiction(mapLocationToJurisdiction[location.id]);
              const contest = getContests(jurisdiction, 'EXECUTIVE')[0];
              const party = getParty(contest.leader);
              const selected = selectedJurisdiction?.id === jurisdiction.id;
              return (
                <path
                  aria-label={`${jurisdiction.name}，${party.shortName} ${contest.percentage}%`}
                  className={`taiwan-county ${selected ? 'selected' : ''}`}
                  data-jurisdiction-id={jurisdiction.id}
                  d={location.path}
                  fill={tint(party.color, contest.percentage, selected)}
                  key={location.id}
                  onClick={() => {
                    if (!mapClickAllowed()) return;
                    selectJurisdictionFromMap(jurisdiction, contest);
                  }}
                  ref={(node) => {
                    pathRefs.current[jurisdiction.id] = node;
                  }}
                  role="button"
                  stroke="#fffdf8"
                  tabIndex={0}
                />
              );
            })}
          </g>

          {shouldShowTownshipBoundaryPreview(selectedJurisdiction?.id ?? null, detailMode) && (
            <g aria-hidden="true" className="township-boundary-preview">
              {visibleTownships.map(({ township }) => (
                <path className="taiwan-township-boundary" d={township.path} key={township.id} />
              ))}
            </g>
          )}

          {detailMode && selectedJurisdiction && (
            <g className={`township-layer ${villageMode ? 'faded' : ''}`}>
              {visibleTownships.map(({ contest, township }) => {
                const party = contest ? getParty(contest.leader) : null;
                const selected =
                  contest !== null &&
                  (selectedTownshipId === township.id ||
                    (contest.view === 'COUNCIL' && selectedContest?.id === contest.id));
                return (
                  <path
                    aria-label={
                      contest && party
                        ? `${township.countyName}${township.townName}，${party.shortName} ${contest.percentage}%`
                        : `${township.countyName}${township.townName}，請由村里界線選擇議員選區`
                    }
                    className={`taiwan-township ${selected ? 'selected' : ''} ${contest ? '' : 'unresolved'}`}
                    data-jurisdiction-id={selectedJurisdiction.id}
                    data-town-code={township.townCode}
                    d={township.path}
                    fill={
                      contest && party ? tint(party.color, contest.percentage, selected) : '#e5e3dd'
                    }
                    key={township.id}
                    onClick={() => {
                      if (!mapClickAllowed() || !contest) return;
                      setSelectedTownshipId(township.id);
                      setSelectedVillageId(null);
                      setFocusedTownCode(township.townCode);
                      setSelectedContest(contest);
                      setInspectorExpanded(false);
                    }}
                    role="button"
                    stroke="#fffdf8"
                    tabIndex={0}
                  />
                );
              })}
            </g>
          )}

          {visibleCouncilVillages.length > 0 && selectedJurisdiction && (
            <g className={`council-village-layer ${villageMode ? 'faded' : ''}`}>
              {visibleCouncilVillages.map(({ contest, village }) => {
                const party = getParty(contest.leader);
                const selected = selectedContest?.id === contest.id;
                return (
                  <path
                    aria-label={`${village.countyName}${village.townName}${village.villName}，${contest.name}，${party.shortName} ${contest.percentage}%`}
                    className={`taiwan-township council-village ${selected ? 'selected' : ''}`}
                    data-council-village="true"
                    data-jurisdiction-id={selectedJurisdiction.id}
                    data-town-code={village.townCode}
                    d={village.path}
                    fill={tint(party.color, contest.percentage, selected)}
                    key={`council-${village.id}`}
                    onClick={() => {
                      if (!mapClickAllowed()) return;
                      setSelectedTownshipId(null);
                      setSelectedVillageId(null);
                      setSelectedContest(contest);
                      setInspectorExpanded(false);
                    }}
                    role="button"
                    stroke="#fffdf8"
                    tabIndex={0}
                  />
                );
              })}
            </g>
          )}

          {shouldShowVillageBoundaryPreview(selectedTownshipId, villageMode) && (
            <g aria-hidden="true" className="village-boundary-preview">
              {visibleVillages
                .filter(({ village }) => village.townCode === focusedTownCode)
                .map(({ village }) => (
                  <path className="taiwan-village-boundary" d={village.path} key={village.id} />
                ))}
            </g>
          )}

          {visibleVillages.length > 0 && selectedJurisdiction && (
            <g className={`village-layer ${villageMode ? '' : 'faded'}`}>
              {visibleVillages.map(({ contest, village }) => {
                const party = getParty(contest.leader);
                const name = village.villName || '未編定村里';
                const dimmed = townshipFocus !== null && village.townCode !== townshipFocus;
                const selected = selectedVillageId === village.id;
                return (
                  <path
                    aria-label={`${village.countyName}${village.townName}${name}，${party.shortName} ${contest.percentage}%`}
                    className={`taiwan-village ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
                    data-jurisdiction-id={selectedJurisdiction.id}
                    data-town-code={village.townCode}
                    d={village.path}
                    fill={tint(party.color, contest.percentage, selected)}
                    key={village.id}
                    onClick={() => {
                      if (!mapClickAllowed()) return;
                      setSelectedVillageId(village.id);
                      setSelectedTownshipId(null);
                      setFocusedTownCode(village.townCode);
                      setSelectedContest(contest);
                      setInspectorExpanded(false);
                    }}
                    role="button"
                    stroke="#fffdf8"
                    tabIndex={0}
                  />
                );
              })}
            </g>
          )}
        </svg>

        {countyShapes.length === 0 && (
          <div className={`map-data-message ${mapError ? 'error' : ''}`}>
            {mapError ?? '正在載入官方地圖…'}
          </div>
        )}

        {!detailMode && (
          <div className="map-island-insets">
            {islandInsets.map((inset) => {
              const anchor = insetAnchors[inset.locationId];
              const location = countyShapes.find((item) => item.id === inset.locationId);
              if (!anchor || !location) return null;
              const jurisdiction = getJurisdiction(mapLocationToJurisdiction[location.id]);
              const contest = getContests(jurisdiction, 'EXECUTIVE')[0];
              const party = getParty(contest.leader);
              return (
                <button
                  key={inset.locationId}
                  onClick={() => selectJurisdictionFromMap(jurisdiction, contest)}
                  style={{ left: anchor.left, top: anchor.top }}
                  type="button"
                >
                  <i style={{ background: party.color }} />
                  <span>{inset.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedJurisdiction &&
        activeContest &&
        shouldShowMapInspector(selectedJurisdiction.id, activeContest) && (
          <MapInspector
            contest={activeContest}
            contestOptions={activeContestOptions}
            expanded={inspectorExpanded}
            jurisdiction={selectedJurisdiction}
            myForecast={myForecasts[activeContest.id]}
            onBackToResult={() => setForecastOpen(false)}
            onClose={() => {
              setForecastOpen(false);
              resetMap();
            }}
            onContestChange={(contest) => {
              setForecastOpen(false);
              setSelectedContest(contest);
            }}
            onExpandedChange={setInspectorExpanded}
            onForecast={() => setForecastOpen(true)}
            onSubmitted={(picked) => {
              setMyForecasts((current) => ({ ...current, [activeContest.id]: picked.join('、') }));
              setForecastOpen(false);
              setInspectorExpanded(true);
            }}
            showForm={forecastOpen}
          />
        )}
    </main>
  );
}
