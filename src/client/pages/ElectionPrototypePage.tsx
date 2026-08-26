import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import {
  type Contest,
  type ElectionView,
  type Jurisdiction,
  electionViews,
  findContest,
  getContests,
  getJurisdiction,
  getParty,
  jurisdictions,
  mockCandidates,
  parties,
} from '../mock-election';

type CandidatePhase = 'party' | 'candidate';

type PrototypeContextValue = {
  phase: CandidatePhase;
  setPhase: (phase: CandidatePhase) => void;
};

const PrototypeContext = createContext<PrototypeContextValue | null>(null);

export function PrototypeProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<CandidatePhase>('party');
  return (
    <PrototypeContext.Provider value={{ phase, setPhase }}>{children}</PrototypeContext.Provider>
  );
}

function usePrototype() {
  const value = useContext(PrototypeContext);
  if (!value) throw new Error('PrototypeProvider is missing.');
  return value;
}

function Icon({
  name,
}: {
  name: 'map' | 'search' | 'user' | 'spark' | 'chevron' | 'close' | 'vote';
}) {
  const paths = {
    map: <path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2V6Zm5-2v13m8-10v13" />,
    search: <path d="m21 21-4.4-4.4m2.4-5.1a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />,
    user: <path d="M20 21a8 8 0 0 0-16 0m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />,
    spark: (
      <path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2Zm7 13 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    vote: <path d="M5 10h14l2 4v7H3v-7l2-4Zm2-7h10v7H7V3Zm2 3 2 2 4-4" />,
  };
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function AppHeader() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const matches = search.trim()
    ? jurisdictions.filter((item) => item.name.includes(search.trim())).slice(0, 4)
    : [];

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (matches[0]) void navigate(`/region/${matches[0].id}`);
  }

  return (
    <header className="app-header">
      <Link className="brand" to="/">
        <span className="brand-mark">
          <Icon name="spark" />
        </span>
        <span>
          <strong>看選情</strong>
          <small>2026 地方選舉預測</small>
        </span>
      </Link>

      <form className="header-search" onSubmit={handleSearch}>
        <Icon name="search" />
        <input
          aria-label="搜尋縣市或選區"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋縣市或選區"
          value={search}
        />
        {matches.length > 0 && (
          <div className="search-results">
            {matches.map((item) => (
              <button
                key={item.id}
                onClick={() => void navigate(`/region/${item.id}`)}
                type="button"
              >
                {item.name}
                <span>查看選情</span>
              </button>
            ))}
          </div>
        )}
      </form>

      <nav className="header-actions" aria-label="個人功能">
        <Link className="text-action" to="/mine">
          <Icon name="vote" />
          我的預測
        </Link>
        <Link className="button button-dark button-small" to="/mine#account">
          <Icon name="user" />
          登入
        </Link>
      </nav>
    </header>
  );
}

function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="手機主選單">
      <NavLink to="/">
        <Icon name="map" />
        <span>地圖</span>
      </NavLink>
      <NavLink to="/region/TPE">
        <Icon name="search" />
        <span>選區</span>
      </NavLink>
      <NavLink to="/mine">
        <Icon name="vote" />
        <span>我的</span>
      </NavLink>
      <NavLink to="/mine#account">
        <Icon name="user" />
        <span>帳號</span>
      </NavLink>
    </nav>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <AppHeader />
      {children}
      <MobileNav />
    </div>
  );
}

function PrototypeNotice() {
  const { phase, setPhase } = usePrototype();
  return (
    <div className="prototype-notice">
      <span>
        <strong>介面原型</strong> 數字、候選人與部分選區名稱均為示意
      </span>
      <div className="phase-switch" aria-label="切換候選人公布階段">
        <span>預覽狀態</span>
        <button
          className={phase === 'party' ? 'active' : ''}
          onClick={() => setPhase('party')}
          type="button"
        >
          名單公布前
        </button>
        <button
          className={phase === 'candidate' ? 'active' : ''}
          onClick={() => setPhase('candidate')}
          type="button"
        >
          名單公布後
        </button>
      </div>
    </div>
  );
}

function ElectionTabs({
  value,
  onChange,
}: {
  value: ElectionView;
  onChange: (value: ElectionView) => void;
}) {
  return (
    <div className="election-tabs" role="tablist" aria-label="選舉種類">
      {electionViews.map((item) => (
        <button
          aria-selected={value === item.id}
          className={value === item.id ? 'active' : ''}
          key={item.id}
          onClick={() => onChange(item.id)}
          role="tab"
          type="button"
        >
          {item.label}
        </button>
      ))}
      <button className="indigenous-tab" type="button">
        原住民選區 <span>獨立圖層</span>
      </button>
    </div>
  );
}

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
type TownshipShape = {
  id: string;
  path: string;
  townCode: string;
  townName: string;
  countyName: string;
};
type VillageShape = TownshipShape & { villCode: string; villName: string };
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

function getTownshipContest(
  township: TownshipShape,
  jurisdiction: Jurisdiction,
  view: ElectionView,
): Contest {
  const seed = township.townCode.split('').reduce((total, digit) => total + Number(digit), 0);
  const challengers: Contest['leader'][] = ['KMT', 'DPP', 'TPP', 'IND'];
  const leader = seed % 5 < 3 ? jurisdiction.leader : challengers[seed % challengers.length];
  const viewLabel = electionViews.find((item) => item.id === view)?.label ?? '選舉';
  return {
    id: `${township.id}-${view}`,
    jurisdictionId: jurisdiction.id,
    name: township.townName,
    area: `${jurisdiction.name} · ${viewLabel}區域預測示意`,
    seatCount: 1,
    view,
    leader,
    percentage: 36 + (seed % 18),
    forecasts: 80 + ((seed * 47) % 720),
  };
}

function getVillageContest(
  village: VillageShape,
  jurisdiction: Jurisdiction,
  view: ElectionView,
): Contest {
  // 未編定村里的 VILLCODE 夾雜英文字母（例如 09007010S31），非數字一律當 7。
  const seed = village.villCode
    .split('')
    .reduce(
      (total, character) => total + (Number.isNaN(Number(character)) ? 7 : Number(character)),
      0,
    );
  const challengers: Contest['leader'][] = ['KMT', 'DPP', 'TPP', 'IND'];
  const leader = seed % 5 < 3 ? jurisdiction.leader : challengers[seed % challengers.length];
  const viewLabel = electionViews.find((item) => item.id === view)?.label ?? '選舉';
  return {
    id: `${village.id}-${view}`,
    jurisdictionId: jurisdiction.id,
    name: `${village.townName}${village.villName || '未編定村里'}`,
    area: `${jurisdiction.name}${village.townName} · ${viewLabel}村里預測示意`,
    seatCount: 1,
    view,
    leader,
    percentage: 34 + (seed % 22),
    forecasts: 20 + ((seed * 31) % 260),
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

function MapLegend() {
  return (
    <div className="map-legend-panel">
      <strong>預測占比</strong>
      <div className="gradient-legend">
        <span>深藍</span>
        <i />
        <span>拉鋸</span>
        <b />
        <span>深綠</span>
      </div>
      <small>色彩越深，領先政黨占比越高</small>
    </div>
  );
}

function MapSearch({ onSelect }: { onSelect: (jurisdiction: Jurisdiction) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = jurisdictions.filter((item) => item.name.includes(query.trim())).slice(0, 8);
  return (
    <div className={`map-search ${open ? 'open' : ''}`}>
      <button
        aria-label="搜尋縣市"
        className="map-round-button"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Icon name="search" />
      </button>
      {open && (
        <div className="map-search-popover">
          <label>
            <Icon name="search" />
            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋縣市或選區"
              value={query}
            />
          </label>
          <div>
            {matches.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                  setQuery('');
                }}
                type="button"
              >
                <span>{item.name}</span>
                <small>
                  {getParty(item.leader).shortName} {item.percentage}%
                </small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MapInspector({
  contest,
  jurisdiction,
  expanded,
  onClose,
  onExpandedChange,
  onForecast,
}: {
  contest: Contest;
  jurisdiction: Jurisdiction;
  expanded: boolean;
  onClose: () => void;
  onExpandedChange: (expanded: boolean) => void;
  onForecast: () => void;
}) {
  const { phase } = usePrototype();
  const rows = getResultRows(contest, phase);
  return (
    <aside className={`map-inspector ${expanded ? 'expanded' : ''}`}>
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
          <small>{contest.area}</small>
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
      <div className="map-leading">
        <span>目前預測</span>
        <strong style={{ color: getParty(contest.leader).color }}>
          {getParty(contest.leader).shortName}領先
        </strong>
        <b>{contest.percentage}%</b>
      </div>
      <div className="map-result-list">
        {rows.map((row) => (
          <div key={row.id}>
            <span>
              <i style={{ background: row.color }} />
              {row.label}
            </span>
            <div>
              <i style={{ background: row.color, width: `${row.value}%` }} />
            </div>
            <strong>
              {Math.round((contest.forecasts * row.value) / 100).toLocaleString()}
              <small> 份</small>
            </strong>
            <b>{row.value}%</b>
          </div>
        ))}
      </div>
      <div className="map-inspector-total">
        <span>有效預測</span>
        <strong>{contest.forecasts.toLocaleString()}</strong>
        <small>最後更新：2 分鐘前</small>
      </div>
      <button className="button button-accent button-wide" onClick={onForecast} type="button">
        <Icon name="vote" />
        送出我的預測
      </button>
      <div className="map-inspector-links">
        <button type="button">查看趨勢</button>
        <button type="button">留言 36</button>
      </div>
    </aside>
  );
}

export function ElectionHomePage() {
  const { phase, setPhase } = usePrototype();
  const [view, setView] = useState<ElectionView>('EXECUTIVE');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<Jurisdiction | null>(null);
  const [selectedContest, setSelectedContest] = useState<Contest | null>(null);
  const [detailMode, setDetailMode] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
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

  const selectedLocationId = selectedJurisdiction
    ? (jurisdictionToMapLocation[selectedJurisdiction.id] ?? null)
    : null;
  const mapWidth = parseMapBounds(viewBox).width;
  const villageZoom = detailMode && mapWidth <= villageZoomWidth;

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

  // 村里圖層每個縣市 40 KB～730 KB，快靠近村里縮放級距時才預先抓。
  const villageNeeded = detailMode && mapWidth <= villageZoomWidth * 2;
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

  const activeContest = selectedContest;
  const visibleTownships = useMemo(() => {
    if (!selectedJurisdiction || townshipLayer?.locationId !== selectedLocationId) return [];
    return townshipLayer.shapes.map((township) => ({
      contest: getTownshipContest(township, selectedJurisdiction, view),
      township,
    }));
  }, [selectedJurisdiction, selectedLocationId, townshipLayer, view]);
  // 村里圖層在接近村里級距時就先掛上（畫成透明），離開時也還留著，這樣兩層
  // 才能靠 CSS 的 opacity transition 交叉淡入淡出，而不是瞬間切換。
  const visibleVillages = useMemo(() => {
    if (!selectedJurisdiction || !villageNeeded) return [];
    if (villageLayer?.locationId !== selectedLocationId) return [];
    return villageLayer.shapes.map((village) => ({
      contest: getVillageContest(village, selectedJurisdiction, view),
      village,
    }));
  }, [selectedJurisdiction, selectedLocationId, villageLayer, villageNeeded, view]);
  const villageMode = villageZoom && visibleVillages.length > 0;
  // 村里還沒畫出來就不要淡化：不然會停在「縣市灰底＋單一區有顏色、卻沒有更
  // 細的東西可看」的中間狀態。
  const townshipFocus = villageMode ? focusedTownCode : null;

  // 選到縣市、放大到鄉鎮市區都不開面板；面板只在點特定鄉鎮市區或村里時出現。
  function selectJurisdiction(jurisdiction: Jurisdiction) {
    setSelectedJurisdiction(jurisdiction);
    setSelectedContest(null);
    setSelectedTownshipId(null);
    setSelectedVillageId(null);
    clearTownshipFocus();
    setVillageZoomWidth(defaultVillageZoomWidth);
    setInspectorExpanded(false);
  }

  function changeView(nextView: ElectionView) {
    setView(nextView);
    setSelectedContest(null);
    setSelectedTownshipId(null);
    setSelectedVillageId(null);
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

  // 帶到某個縣市並切進鄉鎮層，只剩該縣市的區有顏色。
  function focusOnJurisdiction(jurisdiction: Jurisdiction) {
    const fitted = getFittedBounds(jurisdiction);
    if (!fitted) return;
    setViewBox(formatMapBounds(constrainMapBounds(fitted)));
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
    const box = path.getBBox();
    const extent = Math.max(box.width, box.height) * villageZoomFactor;
    setVillageZoomWidth(Math.min(maxVillageZoomWidth, Math.max(minVillageZoomWidth, extent)));
  }

  // 滾輪與雙指縮放共用：套用新的 viewBox，並依縮放方向切換縣市／鄉鎮層級。
  function applyZoom(bounds: MapBounds, zoomingIn: boolean, target: EventTarget | null) {
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
    if (next.width > villageZoomWidth) clearTownshipFocus();
    else if (target) focusTownshipUnder(target);

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

  // 進入縣市後，＋／− 以畫面中心為準逐級縮放，讓不用滾輪的人也能到村里層。
  function zoomBy(factor: number) {
    const current = parseMapBounds(viewBox);
    const width = Math.min(maximumZoomWidth, Math.max(minimumZoomWidth, current.width * factor));
    if (detailMode && width > getTownshipZoomWidth(selectedJurisdiction) * 1.25) {
      resetMap();
      return;
    }

    // 按鈕沒有游標位置，改用畫面正中央的那一區當作聚焦目標，其餘走跟滾輪、
    // 雙指縮放同一條路徑，層級切換的規則才不會各走各的。
    const stage = mapStageRef.current?.getBoundingClientRect();
    const center = stage
      ? document.elementFromPoint(stage.left + stage.width / 2, stage.top + stage.height / 2)
      : null;
    const anchor = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
    applyZoom(scaleMapBounds(current, factor, anchor), factor < 1, center);
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
          <label className="map-select">
            <Icon name="map" />
            <span>
              {selectedJurisdiction && detailMode ? `${selectedJurisdiction.name} › ` : ''}
            </span>
            <select
              aria-label="選舉種類"
              onChange={(event) => changeView(event.target.value as ElectionView)}
              value={view}
            >
              {electionViews.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="map-select phase">
            <select
              aria-label="候選人名單狀態"
              onChange={(event) => setPhase(event.target.value as CandidatePhase)}
              value={phase}
            >
              <option value="party">名單公布前</option>
              <option value="candidate">名單公布後</option>
            </select>
          </label>
        </div>

        <div className="map-floating-actions">
          <MapSearch onSelect={selectJurisdiction} />
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
              const contest = getContests(jurisdiction, view)[0];
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
                    selectJurisdiction(jurisdiction);
                    // 切層本來只發生在縮放事件裡，所以縮放深度已經夠、卻是用
                    // 「點選」換縣市時，區不會出現，得再滾一下才有。這裡補上：
                    // 目前視野已經到該縣市的區級距就直接切層，畫面不動。
                    if (detailMode || mapWidth <= getTownshipZoomWidth(jurisdiction)) {
                      setDetailMode(true);
                    }
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

          {detailMode && selectedJurisdiction && (
            <g className={`township-layer ${villageMode ? 'faded' : ''}`}>
              {visibleTownships.map(({ contest, township }) => {
                const party = getParty(contest.leader);
                const selected = selectedTownshipId === township.id;
                return (
                  <path
                    aria-label={`${township.countyName}${township.townName}，${party.shortName} ${contest.percentage}%`}
                    className={`taiwan-township ${selected ? 'selected' : ''}`}
                    data-jurisdiction-id={selectedJurisdiction.id}
                    data-town-code={township.townCode}
                    d={township.path}
                    fill={tint(party.color, contest.percentage, selected)}
                    key={township.id}
                    onClick={() => {
                      if (!mapClickAllowed()) return;
                      setSelectedTownshipId(township.id);
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
              const contest = getContests(jurisdiction, view)[0];
              const party = getParty(contest.leader);
              return (
                <button
                  key={inset.locationId}
                  onClick={() => selectJurisdiction(jurisdiction)}
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

        <MapLegend />
        <div className="map-zoom-controls">
          <button
            aria-label={detailMode ? '放大到村里' : '放大選取縣市'}
            disabled={!selectedJurisdiction || (detailMode && mapWidth <= minimumZoomWidth)}
            onClick={() => (detailMode ? zoomBy(0.55) : zoomIntoSelection())}
            type="button"
          >
            ＋
          </button>
          <button
            aria-label="縮小地圖"
            disabled={!detailMode}
            onClick={() => zoomBy(1.8)}
            type="button"
          >
            −
          </button>
          <button aria-label="回到全臺" onClick={() => resetMap()} type="button">
            <Icon name="map" />
          </button>
        </div>
        <div className="map-status">
          <span>
            <i />
            {villageMode
              ? `${visibleVillages.length} 個官方村里邊界`
              : detailMode
                ? `${visibleTownships.length} 個官方鄉鎮市區邊界`
                : '16,263 份有效預測'}
          </span>
          <span>色深依預測占比</span>
          <span>{detailMode ? '預測資料為示意' : '介面原型 · 非科學民調'}</span>
        </div>
      </section>

      {selectedJurisdiction && activeContest && (
        <MapInspector
          contest={activeContest}
          expanded={inspectorExpanded}
          jurisdiction={selectedJurisdiction}
          onClose={() => resetMap()}
          onExpandedChange={setInspectorExpanded}
          onForecast={() => setForecastOpen(true)}
        />
      )}
      {forecastOpen && activeContest && (
        <ForecastSheet
          contest={activeContest}
          onClose={() => setForecastOpen(false)}
          onSubmitted={() => setForecastOpen(false)}
        />
      )}
    </main>
  );
}

function Breadcrumbs({ jurisdiction, contest }: { jurisdiction: Jurisdiction; contest?: Contest }) {
  return (
    <nav className="breadcrumbs" aria-label="麵包屑">
      <Link to="/">全國</Link>
      <span>/</span>
      {contest ? (
        <Link to={`/region/${jurisdiction.id}`}>{jurisdiction.name}</Link>
      ) : (
        <strong>{jurisdiction.name}</strong>
      )}
      {contest && (
        <>
          <span>/</span>
          <strong>{contest.name}</strong>
        </>
      )}
    </nav>
  );
}

function LeadingBadge({ contest }: { contest: Contest }) {
  const party = getParty(contest.leader);
  return (
    <span className="leading-badge" style={{ '--party-color': party.color } as CSSProperties}>
      <i />
      {party.shortName}暫時領先
    </span>
  );
}

function ContestCard({ contest }: { contest: Contest }) {
  const party = getParty(contest.leader);
  return (
    <Link className="contest-card" to={`/contest/${contest.id}`}>
      <div className="contest-card-top">
        <span>{contest.seatCount === 1 ? '單席' : `應選 ${contest.seatCount} 席`}</span>
        <span>{contest.forecasts.toLocaleString()} 份預測</span>
      </div>
      <h3>{contest.name}</h3>
      <p>{contest.area}</p>
      <div className="contest-result">
        <span>
          <i style={{ background: party.color }} />
          {party.shortName}
        </span>
        <strong>{contest.percentage}%</strong>
      </div>
      <div className="result-track">
        <i style={{ background: party.color, width: `${contest.percentage}%` }} />
      </div>
      <span className="card-link">
        查看選情與預測 <Icon name="chevron" />
      </span>
    </Link>
  );
}

function RegionSchematic({
  contests,
  selectedView,
}: {
  contests: Contest[];
  selectedView: ElectionView;
}) {
  return (
    <div className="region-map">
      <span className="region-map-label">選區示意</span>
      <div className="region-shape">
        {contests.slice(0, 6).map((contest, index) => (
          <Link
            className={`district-blob blob-${index + 1}`}
            key={contest.id}
            to={`/contest/${contest.id}`}
          >
            <span>{selectedView === 'EXECUTIVE' ? '全境' : index + 1}</span>
          </Link>
        ))}
      </div>
      <p>正式版將替換為可縮放 GeoJSON 地圖</p>
    </div>
  );
}

export function JurisdictionPage() {
  const { jurisdictionId } = useParams();
  const jurisdiction = getJurisdiction(jurisdictionId);
  const [view, setView] = useState<ElectionView>('EXECUTIVE');
  const contests = useMemo(() => getContests(jurisdiction, view), [jurisdiction, view]);
  const mayorContest = getContests(jurisdiction, 'EXECUTIVE')[0];
  const [forecastContest, setForecastContest] = useState<Contest | null>(null);
  const [message, setMessage] = useState('');

  return (
    <PageShell>
      <PrototypeNotice />
      <main className="page">
        <Breadcrumbs jurisdiction={jurisdiction} />
        <section className="region-heading">
          <div>
            <span className="eyebrow">JURISDICTION OVERVIEW</span>
            <h1>
              {jurisdiction.name}
              <em>選情總覽</em>
            </h1>
            <p>選擇選舉種類，再點擊地圖或選區卡片查看細節。</p>
          </div>
          <div className="region-stat">
            <span>本區有效預測</span>
            <strong>{(jurisdiction.forecasts * 3).toLocaleString()}</strong>
            <small>較昨日 +8.4%</small>
          </div>
        </section>

        {message && (
          <div className="success-banner">
            <span>✓</span>
            {message}
            <button onClick={() => setMessage('')} type="button">
              關閉
            </button>
          </div>
        )}

        <section className="mayor-feature">
          <div>
            <span className="feature-kicker">縣市首長預測</span>
            <h2>{mayorContest.name}</h2>
            <p>{mayorContest.forecasts.toLocaleString()} 人已送出預測</p>
          </div>
          <LeadingBadge contest={mayorContest} />
          <div className="mayor-score">
            <strong>{mayorContest.percentage}%</strong>
            <span>目前領先比例</span>
          </div>
          <button
            className="button button-accent"
            onClick={() => setForecastContest(mayorContest)}
            type="button"
          >
            <Icon name="vote" />
            我要預測
          </button>
        </section>

        <ElectionTabs onChange={setView} value={view} />

        <div className="region-layout">
          <RegionSchematic contests={contests} selectedView={view} />
          <section className="district-list-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">DISTRICTS</span>
                <h2>{electionViews.find((item) => item.id === view)?.label}選區</h2>
              </div>
              <span>{contests.length} 個示意選區</span>
            </div>
            <div className="contest-grid">
              {contests.map((contest) => (
                <ContestCard contest={contest} key={contest.id} />
              ))}
            </div>
          </section>
        </div>
      </main>
      {forecastContest && (
        <ForecastSheet
          contest={forecastContest}
          onClose={() => setForecastContest(null)}
          onSubmitted={(summary) => {
            setForecastContest(null);
            setMessage(summary);
          }}
        />
      )}
    </PageShell>
  );
}

function getResultRows(contest: Contest, phase: CandidatePhase) {
  const orderedParties = [
    getParty(contest.leader),
    ...parties.filter((party) => party.id !== contest.leader),
  ];
  const remaining = 100 - contest.percentage;
  const values = [contest.percentage, Math.round(remaining * 0.48), Math.round(remaining * 0.32)];
  values.push(100 - values.reduce((total, value) => total + value, 0));
  if (phase === 'party')
    return orderedParties.map((party, index) => ({
      id: party.id,
      label: party.shortName,
      meta: party.name,
      color: party.color,
      value: values[index],
    }));
  return mockCandidates.slice(0, 4).map((candidate, index) => {
    const party = getParty(candidate.partyId);
    return {
      id: candidate.id,
      label: candidate.name,
      meta: party.shortName,
      color: party.color,
      value: values[index],
    };
  });
}

function ResultsPanel({ contest }: { contest: Contest }) {
  const { phase } = usePrototype();
  const rows = getResultRows(contest, phase);
  return (
    <section className="results-panel">
      <div className="results-total">
        <span>有效預測</span>
        <strong>{contest.forecasts.toLocaleString()}</strong>
        <small>份</small>
      </div>
      <div className="result-bars">
        {rows.map((row, index) => (
          <div className="result-row" key={row.id}>
            <div className="result-label">
              <span className="result-rank">{index + 1}</span>
              <i style={{ background: row.color }} />
              <span>
                <strong>{row.label}</strong>
                <small>{row.meta}</small>
              </span>
              <b>{row.value}%</b>
            </div>
            <div className="result-track large">
              <i style={{ background: row.color, width: `${row.value}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="method-note">每個匿名身份在本選區只計一份有效預測。重複送出會覆蓋原紀錄。</p>
    </section>
  );
}

function TrendPanel() {
  return (
    <section className="trend-panel">
      <div className="trend-legend">
        <span>
          <i className="dot-green" />
          領先者
        </span>
        <span>
          <i className="dot-blue" />
          第二名
        </span>
        <b>近 30 日</b>
      </div>
      <div className="trend-chart" aria-label="近三十日預測趨勢示意圖">
        <div className="grid-line line-1" />
        <div className="grid-line line-2" />
        <div className="grid-line line-3" />
        <svg preserveAspectRatio="none" viewBox="0 0 600 180">
          <path
            className="trend-a"
            d="M0 135 C80 125 110 92 180 105 S290 65 360 82 S480 42 600 28"
          />
          <path
            className="trend-b"
            d="M0 80 C90 75 140 110 210 98 S310 120 390 105 S510 124 600 112"
          />
        </svg>
        <div className="trend-axis">
          <span>7/27</span>
          <span>8/05</span>
          <span>8/15</span>
          <span>今天</span>
        </div>
      </div>
      <div className="trend-callout">
        <Icon name="spark" />
        <span>
          <strong>近 7 日變化</strong>領先者增加 4.8 個百分點
        </span>
      </div>
    </section>
  );
}

function CommentsPanel() {
  const comments = [
    {
      name: '北區觀察員',
      time: '12 分鐘前',
      body: '這一區的變化比上週明顯，想看看正式名單公布後會不會重新洗牌。',
    },
    {
      name: '山線居民',
      time: '1 小時前',
      body: '目前樣本還不算多，地圖如果能顯示樣本門檻會更清楚。',
    },
    { name: '選舉資料控', time: '昨天', body: '希望之後能看到名單公布前後的預測差異。' },
  ];
  return (
    <section className="comments-panel">
      <div className="comment-compose">
        <div>
          <Icon name="user" />
        </div>
        <button type="button">登入後參與討論</button>
      </div>
      {comments.map((comment) => (
        <article className="comment" key={comment.name}>
          <div className="comment-avatar">{comment.name.slice(0, 1)}</div>
          <div>
            <p>
              <strong>{comment.name}</strong>
              <time>{comment.time}</time>
            </p>
            <span>{comment.body}</span>
            <button type="button">回覆</button>
          </div>
        </article>
      ))}
    </section>
  );
}

export function ContestPage() {
  const { contestId } = useParams();
  const { contest, jurisdiction } = findContest(contestId);
  const { phase } = usePrototype();
  const [activeTab, setActiveTab] = useState<'results' | 'trend' | 'comments'>('results');
  const [forecastOpen, setForecastOpen] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <PageShell>
      <PrototypeNotice />
      <main className="page contest-page">
        <Breadcrumbs contest={contest} jurisdiction={jurisdiction} />
        {message && (
          <div className="success-banner">
            <span>✓</span>
            {message}
            <button onClick={() => setMessage('')} type="button">
              關閉
            </button>
          </div>
        )}
        <section className="contest-hero">
          <div>
            <span className="eyebrow">
              {contest.seatCount === 1
                ? 'SINGLE-SEAT CONTEST'
                : `MULTI-MEMBER · ${contest.seatCount} SEATS`}
            </span>
            <h1>{contest.name}</h1>
            <p>
              <Icon name="map" />
              {contest.area}
            </p>
          </div>
          <div className="contest-hero-status">
            <span>{phase === 'party' ? '正式名單尚未公布' : '正式候選人名單已匯入'}</span>
            <LeadingBadge contest={contest} />
          </div>
          <button
            className="button button-accent"
            onClick={() => setForecastOpen(true)}
            type="button"
          >
            <Icon name="vote" />
            送出我的預測
          </button>
        </section>

        <div className="content-tabs" role="tablist">
          <button
            className={activeTab === 'results' ? 'active' : ''}
            onClick={() => setActiveTab('results')}
            role="tab"
            type="button"
          >
            預測結果
          </button>
          <button
            className={activeTab === 'trend' ? 'active' : ''}
            onClick={() => setActiveTab('trend')}
            role="tab"
            type="button"
          >
            趨勢
          </button>
          <button
            className={activeTab === 'comments' ? 'active' : ''}
            onClick={() => setActiveTab('comments')}
            role="tab"
            type="button"
          >
            留言 <span>36</span>
          </button>
        </div>

        <div className="contest-content">
          <div>
            {activeTab === 'results' && <ResultsPanel contest={contest} />}
            {activeTab === 'trend' && <TrendPanel />}
            {activeTab === 'comments' && <CommentsPanel />}
          </div>
          <aside className="contest-aside">
            <span className="eyebrow">YOUR FORECAST</span>
            <h3>你還沒有預測這一區</h3>
            <p>
              {contest.seatCount === 1
                ? '選出你認為最可能勝出的政黨或候選人。'
                : `預測 ${contest.seatCount} 席最終歸屬。`}
            </p>
            <button
              className="button button-dark button-wide"
              onClick={() => setForecastOpen(true)}
              type="button"
            >
              開始預測 <Icon name="chevron" />
            </button>
            <div className="privacy-note">
              <span>匿名可參加</span>
              <small>裝置只保留一份有效預測，可隨時修改。</small>
            </div>
          </aside>
        </div>
      </main>
      {forecastOpen && (
        <ForecastSheet
          contest={contest}
          onClose={() => setForecastOpen(false)}
          onSubmitted={(summary) => {
            setForecastOpen(false);
            setMessage(summary);
          }}
        />
      )}
    </PageShell>
  );
}

function initialAllocation(seats: number) {
  const first = Math.ceil(seats * 0.4);
  const second = Math.floor(seats * 0.3);
  const third = Math.floor(seats * 0.15);
  return { KMT: first, DPP: second, TPP: third, IND: seats - first - second - third };
}

function ForecastSheet({
  contest,
  onClose,
  onSubmitted,
}: {
  contest: Contest;
  onClose: () => void;
  onSubmitted: (summary: string) => void;
}) {
  const { phase } = usePrototype();
  const singleSeat = contest.seatCount === 1;
  const [selectedTarget, setSelectedTarget] = useState('');
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
  const [allocation, setAllocation] = useState<Record<string, number>>(() =>
    initialAllocation(contest.seatCount),
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.classList.remove('sheet-open');
    };
  }, [onClose]);

  const allocatedSeats = Object.values(allocation).reduce((total, value) => total + value, 0);
  const isValid =
    phase === 'party'
      ? singleSeat
        ? Boolean(selectedTarget)
        : allocatedSeats === contest.seatCount
      : singleSeat
        ? Boolean(selectedTarget)
        : candidateIds.length === contest.seatCount;

  function updateSeats(partyId: string, delta: number) {
    setAllocation((current) => ({ ...current, [partyId]: Math.max(0, current[partyId] + delta) }));
  }

  function toggleCandidate(candidateId: string) {
    setCandidateIds((current) =>
      current.includes(candidateId)
        ? current.filter((id) => id !== candidateId)
        : current.length < contest.seatCount
          ? [...current, candidateId]
          : current,
    );
  }

  function submit() {
    if (!isValid) return;
    onSubmitted(`已更新「${contest.name}」的示意預測。正式版將同步寫入你的匿名身份。`);
  }

  return (
    <div className="sheet-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="forecast-title"
        aria-modal="true"
        className="forecast-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div>
            <span className="eyebrow">MAKE A FORECAST</span>
            <h2 id="forecast-title">{contest.name}</h2>
            <p>{contest.area}</p>
          </div>
          <button aria-label="關閉" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-status">
          <i />
          <span>
            <strong>{phase === 'party' ? '候選人名單尚未公布' : '官方候選人名單已匯入'}</strong>
            {phase === 'party' ? '目前以政黨或席次進行預測' : '目前以候選人進行預測'}
          </span>
        </div>

        <div className="sheet-body">
          <div className="sheet-instruction">
            <h3>{singleSeat ? '你認為誰會勝出？' : `預測 ${contest.seatCount} 個當選席次`}</h3>
            <span>
              {phase === 'party' && !singleSeat
                ? `已分配 ${allocatedSeats} / ${contest.seatCount} 席`
                : phase === 'candidate' && !singleSeat
                  ? `已選 ${candidateIds.length} / ${contest.seatCount} 位`
                  : '請選擇一個項目'}
            </span>
          </div>

          {phase === 'party' && singleSeat && (
            <div className="choice-list">
              {parties.map((party) => (
                <label className={selectedTarget === party.id ? 'selected' : ''} key={party.id}>
                  <input
                    checked={selectedTarget === party.id}
                    name="party"
                    onChange={() => setSelectedTarget(party.id)}
                    type="radio"
                  />
                  <i style={{ background: party.color }} />
                  <span>
                    <strong>{party.shortName}</strong>
                    <small>{party.name}</small>
                  </span>
                  <b>✓</b>
                </label>
              ))}
            </div>
          )}

          {phase === 'party' && !singleSeat && (
            <div className="seat-allocation">
              {parties.map((party) => (
                <div key={party.id}>
                  <span>
                    <i style={{ background: party.color }} />
                    <strong>{party.shortName}</strong>
                  </span>
                  <div>
                    <button
                      aria-label={`減少${party.shortName}席次`}
                      onClick={() => updateSeats(party.id, -1)}
                      type="button"
                    >
                      −
                    </button>
                    <b>{allocation[party.id]}</b>
                    <button
                      aria-label={`增加${party.shortName}席次`}
                      disabled={allocatedSeats >= contest.seatCount}
                      onClick={() => updateSeats(party.id, 1)}
                      type="button"
                    >
                      ＋
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {phase === 'candidate' && (
            <div className="candidate-grid">
              {mockCandidates.slice(0, Math.max(4, contest.seatCount + 2)).map((candidate) => {
                const party = getParty(candidate.partyId);
                const selected = singleSeat
                  ? selectedTarget === candidate.id
                  : candidateIds.includes(candidate.id);
                return (
                  <label className={selected ? 'selected' : ''} key={candidate.id}>
                    <input
                      checked={selected}
                      name={singleSeat ? 'candidate' : undefined}
                      onChange={() =>
                        singleSeat ? setSelectedTarget(candidate.id) : toggleCandidate(candidate.id)
                      }
                      type={singleSeat ? 'radio' : 'checkbox'}
                    />
                    <span className="candidate-number">{candidate.number}</span>
                    <span>
                      <strong>{candidate.name}</strong>
                      <small>
                        <i style={{ background: party.color }} />
                        {party.shortName}
                      </small>
                    </span>
                    <b>✓</b>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <footer className="sheet-footer">
          <p>再次送出只會更新原預測，不會重複計票。</p>
          <button
            className="button button-accent"
            disabled={!isValid}
            onClick={submit}
            type="button"
          >
            確認送出 <Icon name="chevron" />
          </button>
        </footer>
      </section>
    </div>
  );
}

export function MyPredictionsPage() {
  const examples = [
    {
      jurisdiction: '臺北市',
      contest: '臺北市長',
      target: '民進黨',
      color: '#2c8a64',
      status: '目前領先',
    },
    {
      jurisdiction: '新北市',
      contest: '議員第 3 選舉區',
      target: '國民黨 3 席、民進黨 2 席',
      color: '#3f69b1',
      status: '已送出',
    },
    {
      jurisdiction: '新竹市',
      contest: '新竹市長',
      target: '民眾黨',
      color: '#28a5a5',
      status: '目前領先',
    },
  ];
  return (
    <PageShell>
      <PrototypeNotice />
      <main className="page mine-page">
        <section className="mine-heading">
          <div>
            <span className="eyebrow">MY FORECASTS</span>
            <h1>我的預測</h1>
            <p>匿名使用也能在這台裝置查看與修改紀錄。</p>
          </div>
          <div className="anonymous-id">
            <Icon name="user" />
            <span>
              <strong>匿名身份 #8F2A</strong>
              <small>已保護這台裝置上的預測</small>
            </span>
          </div>
        </section>
        <div className="mine-layout">
          <section>
            <div className="section-heading">
              <h2>已預測 3 個選區</h2>
              <span>最近更新：今天</span>
            </div>
            <div className="prediction-list">
              {examples.map((item) => (
                <article key={item.contest}>
                  <i style={{ background: item.color }} />
                  <div>
                    <span>{item.jurisdiction}</span>
                    <h3>{item.contest}</h3>
                    <p>
                      我的預測：<strong>{item.target}</strong>
                    </p>
                  </div>
                  <div>
                    <small>{item.status}</small>
                    <button type="button">修改</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <aside className="account-card" id="account">
            <span className="account-icon">
              <Icon name="spark" />
            </span>
            <h2>建立帳號，帶著預測走</h2>
            <p>註冊後可跨裝置保留預測，並在選區結果下留言。</p>
            <button className="button button-dark button-wide" type="button">
              建立免費帳號
            </button>
            <button className="button button-ghost button-wide" type="button">
              我已經有帳號
            </button>
            <small>註冊不會增加預測權重。</small>
          </aside>
        </div>
      </main>
    </PageShell>
  );
}
