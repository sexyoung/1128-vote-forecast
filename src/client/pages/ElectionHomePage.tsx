import { useQuery } from '@tanstack/react-query';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link } from 'react-router-dom';
import { type MapCell, getContest, getJurisdictionMap, getNationalMap } from '../api';
import { useDocumentTitle } from '../use-document-title';
import { SocialShare } from '../SocialShare';
import { findRegionalCouncilDistricts, needsVillageCouncilGeometry } from '../council-districts';
import {
  type TownshipShape,
  type VillageShape,
  buildRepresentativeContest,
  buildTownshipContest,
  buildVillageContest,
  jurisdictionToMapLocation,
  loadMapPaths,
  loadTownshipShapes,
  loadVillageShapes,
  mapLocationToJurisdiction,
} from '../map-shapes';
import {
  type Contest,
  type ElectionView,
  type Jurisdiction,
  type PartyId,
  electionViews,
  getContests,
  getJurisdiction,
  getParty,
  jurisdictions,
} from '../mock-election';
import {
  AppHeader,
  CandidateList,
  ForecastButton,
  Icon,
  SearchBox,
  toCandidateRows,
} from './ElectionPrototypeShared';
import { type ForecastPick, ForecastForm } from './ForecastSheet';
import { track } from '../analytics';

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
type CountyLayer<Shape> = { locationId: string; shapes: Shape[] };

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
export function getMapResultScale() {
  return 2;
}

export function paintAnimatedLast<T>(
  items: readonly T[],
  animatedId: string | null,
  getContestId: (item: T) => string | null | undefined,
) {
  if (!animatedId) return items;
  return [
    ...items.filter((item) => getContestId(item) !== animatedId),
    ...items.filter((item) => getContestId(item) === animatedId),
  ];
}
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

// 與 styles.css 的 @media (max-width: 720px) 同一個斷點：這個寬度以下預測面板
// 是底部抽屜，地圖只剩上半塊可用。
const drawerLayoutQuery = '(max-width: 720px)';

function isDrawerLayout() {
  return typeof window !== 'undefined' && window.matchMedia(drawerLayoutQuery).matches;
}

// 與 .header-nav 的隱藏門檻同一個斷點：這個寬度以上有浮動頁首（搜尋＋主選單），
// 地圖自己那組浮動圓鈕就是重複的，直接不 render——連帶讓只有那顆搜尋鈕會用到的
// searchOpen 狀態在桌機不存在，而不是留一個永遠打不開的開關。
const compactChromeQuery = '(max-width: 1000px)';

function subscribeToCompactChrome(onChange: () => void) {
  const query = window.matchMedia(compactChromeQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function useCompactChrome() {
  // useSyncExternalStore 而不是 useState + useEffect：後者要在 effect 裡同步
  // setState 才能補上首次 render 的值，會被 React Compiler 擋下來。
  return useSyncExternalStore(
    subscribeToCompactChrome,
    () => window.matchMedia(compactChromeQuery).matches,
    () => true,
  );
}

export function shouldShowVillageBoundaryPreview(
  selectedTownshipId: string | null,
  villageMode: boolean,
  animating = false,
) {
  return selectedTownshipId !== null && !villageMode && !animating;
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
  view: ElectionView,
): Contest | null {
  if (view === 'COUNCIL') return getCouncilContestForTownship(township, jurisdiction);
  // 鄉鎮市長、代表都跟 /region 列表頁共用同一份產生規則，兩邊名稱與 id 才一致。
  if (view === 'TOWNSHIP') return buildTownshipContest(township, jurisdiction);
  return buildRepresentativeContest(township, jurisdiction);
}

export function getTownshipContestOptions(township: TownshipShape, jurisdiction: Jurisdiction) {
  return getElectionViewsForMapLevel(jurisdiction, 'township')
    .map((view) => getTownshipContest(township, jurisdiction, view))
    .filter((contest): contest is Contest => contest !== null);
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

/** 還沒有人預測的選區。灰色是誠實的答案，不要用假資料填出一張看起來有內容的地圖。 */
const noDataFill = '#e2e1dc';
const noDataSelectedFill = '#c6c5bf';

/**
 * 地圖著色只看伺服器的統計。cell 是 /api/map/* 回來的那一格；沒有 cell 或還沒有
 * 人預測就是灰的。
 */
function mapFill(cell: MapCell | undefined, selected: boolean) {
  const partyId = getMapParty(cell);
  if (!cell || cell.total === 0 || !partyId) return selected ? noDataSelectedFill : noDataFill;
  return tint(getParty(partyId as PartyId).color, cell.percent, selected);
}

export function getMapParty(cell: MapCell | undefined) {
  if (cell?.tiedParties?.length !== 2) return cell?.party ?? null;
  let hash = 0;
  for (let index = 0; index < cell.contestId.length; index++)
    hash = (Math.imul(hash, 31) + cell.contestId.charCodeAt(index)) >>> 0;
  return cell.tiedParties[hash % 2];
}

export function shouldAnimateMapResult(previousCell: MapCell | undefined, nextCell: MapCell) {
  const previousParty = getMapParty(previousCell);
  const nextParty = getMapParty(nextCell);
  return Boolean(previousParty && nextParty && previousParty !== nextParty);
}

function mapLabel(name: string, cell: MapCell | undefined) {
  if (!cell || cell.total === 0 || !cell.party) return `${name}，尚無預測`;
  if (cell.tiedParties?.length === 2)
    return `${name}，${cell.tiedParties
      .map((partyId) => getParty(partyId as PartyId).shortName)
      .join('、')}平手，各 ${cell.percent}%`;
  return `${name}，${getParty(cell.party as PartyId).shortName} ${cell.percent}%`;
}

// 模擬資料的預測份數落在 80–799（見 getShapeResult），門檻設在這個區間的低段，
// 讓「樣本太少」這個狀態在原型裡真的走得到。正式版應該改成依選區規模決定。
const lowSampleThreshold = 150;

// 候選人的頭像位置，放在名字左邊。照片要等中選會 2026-11 公告名單才會有
// （檔名規則見 public/avatars/README.md），在那之前留一塊淺灰的空位——填名字的
// 第一個字會被誤讀成資訊。放在名字旁邊而不是標題列：職稱長度每個選區都不一樣。
function CandidatePortrait({ large = false }: { large?: boolean }) {
  return <i className={`map-portrait ${large ? 'large' : ''}`} />;
}

function MapInspector({
  contest,
  contestOptions,
  jurisdiction,
  expanded,
  showForm,
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
  showForm: boolean;
  onContestChange: (contest: Contest) => void;
  onExpandedChange: (expanded: boolean) => void;
  onForecast: () => void;
  onBackToResult: () => void;
  onSubmitted: (
    picked: ForecastPick[],
    previousMapCell: MapCell | undefined,
    nextMapCell: MapCell,
  ) => void;
}) {
  // 分布來自伺服器；還沒載回來之前不畫數字，不要先給一個等一下會跳掉的假值。
  const detail = useQuery({
    queryKey: ['contest', contest.id],
    queryFn: () => getContest(contest.id),
  });
  const tally = detail.data?.tally;
  const rows = toCandidateRows(tally, detail.data?.targets);
  const leader = rows[0];
  const totalPredictions = tally?.totalPredictions ?? 0;
  // 份數太少時不放大領先者，避免十來份預測被讀成民調。
  const lowSample = totalPredictions < lowSampleThreshold;

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
        {/* key 綁 contest：在表單開著的時候換場次，勾選狀態要跟著換掉。
            上次押了誰由伺服器回答，不再從這裡傳進去。 */}
        <ForecastForm
          contest={contest}
          key={contest.id}
          onSubmitted={onSubmitted}
          surface="map_inspector"
        />
      </aside>
    );

  return (
    <aside className={`map-inspector ${expanded ? 'expanded' : ''}`}>
      <header>
        {/* 手機展開後是滿版，地圖整個被蓋住，所以左上角要有退路。它只把面板收回
            成一列，選取的區域與鏡頭都留著。桌機不顯示。 */}
        <button
          className="map-inspector-dismiss"
          onClick={() => {
            track('map_inspector_toggled', {
              expanded: false,
              contest_id: contest.id,
              contest_type: contest.view,
            });
            onExpandedChange(false);
          }}
          type="button"
        >
          ‹ 返回
        </button>
        <div>
          <span>{jurisdiction.name}</span>
          <h2>{contest.name}</h2>
          <small>
            {contest.area} · 應選 {contest.seatCount} 席
          </small>
        </div>
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
              onClick={() => {
                track('map_contest_switched', {
                  from_contest_id: contest.id,
                  from_contest_type: contest.view,
                  to_contest_id: option.id,
                  to_contest_type: option.view,
                  jurisdiction_id: jurisdiction.id,
                  option_count: contestOptions.length,
                });
                onContestChange(option);
              }}
              role="tab"
              type="button"
            >
              {electionViews.find((item) => item.id === option.view)?.shortLabel}
            </button>
          ))}
        </div>
      )}
      {/* 收合的手機抽屜專用摘要：左邊職稱、右邊領先者與百分比，整列就是抽屜的
          全部內容。整列都可按，但右端放一顆看得懂的「看更多」，讓人知道是用按的
          ——手把那種橫條會讓人以為要用拖的。桌機與展開後都不顯示。 */}
      <button
        aria-expanded={expanded}
        className={`map-peek ${lowSample ? 'low' : ''}`}
        onClick={() => {
          track('map_inspector_toggled', {
            expanded: true,
            contest_id: contest.id,
            contest_type: contest.view,
          });
          onExpandedChange(true);
        }}
        type="button"
      >
        <strong>{contest.name}</strong>
        <span>
          <CandidatePortrait />
          {leader ? (lowSample ? '預測份數還很少' : leader.label) : '尚無預測'}
        </span>
        <b style={leader && !lowSample ? { color: leader.color } : undefined}>
          {leader
            ? lowSample
              ? `${totalPredictions.toLocaleString()} 份`
              : `${leader.value}%`
            : '—'}
        </b>
        <em>看更多 ›</em>
      </button>
      {detail.data?.mine && (
        <div className="map-my-forecast">
          <i>
            <Icon name="check" />
          </i>
          <span>
            <strong>
              你預測{' '}
              {(detail.data.mine.targetIds ?? [])
                .map((id) => rows.find((row) => row.id === id)?.label ?? id)
                .join('、')}{' '}
              勝出
            </strong>
            <small>可隨時修改</small>
          </span>
        </div>
      )}
      {lowSample && (
        <div className="map-low-sample">
          <i />
          <span>
            <strong>
              {totalPredictions === 0
                ? '還沒有人預測這一區'
                : `目前只有 ${totalPredictions.toLocaleString()} 份預測`}
            </strong>
            <small>
              {totalPredictions === 0
                ? '你可以是第一個。'
                : '份數太少，分布容易被少數人左右，先當作參考就好。'}
            </small>
          </span>
        </div>
      )}
      <div className="map-share-bar t-progress-fill" key={`share-${contest.id}`}>
        {rows.map((row) => (
          <i key={row.id} style={{ background: row.color, width: `${row.value}%` }} />
        ))}
      </div>
      <div className="map-inspector-scroll t-progress-list" key={`results-${contest.id}`}>
        <CandidateList
          forecasts={tally?.totalPicks ?? 0}
          highlightIds={detail.data?.mine?.targetIds}
          rows={rows}
          winnerCount={lowSample ? 0 : (detail.data?.contest.seats ?? contest.seatCount)}
        />
        <p className="map-inspector-total">
          共 <strong>{totalPredictions.toLocaleString()}</strong> 份預測
        </p>
        <div className="map-inspector-links">
          <Link to={`/contest/${contest.id}?tab=trend`}>查看趨勢</Link>
          <i />
          <Link to={`/contest/${contest.id}?tab=comments`}>留言</Link>
        </div>
      </div>
      <footer className="map-inspector-footer">
        <ForecastButton
          editing={Boolean(detail.data?.mine)}
          onClick={() => {
            track('forecast_sheet_opened', {
              contest_id: contest.id,
              contest_type: contest.view,
              jurisdiction_id: jurisdiction.id,
              seats: contest.seatCount,
              surface: 'map_inspector',
              is_update: Boolean(detail.data?.mine),
            });
            onForecast();
          }}
        />
      </footer>
    </aside>
  );
}

export function ElectionHomePage() {
  useDocumentTitle('九合一選舉預測｜2026.11.28 全臺 22 縣市預測地圖');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<Jurisdiction | null>(null);
  const [selectedContest, setSelectedContest] = useState<Contest | null>(null);
  const [detailMode, setDetailMode] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [animatedContestId, setAnimatedContestId] = useState<string | null>(null);
  const [heldMapCell, setHeldMapCell] = useState<{
    contestId: string;
    cell: MapCell | undefined;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const compactChrome = useCompactChrome();
  // 這一版先記在記憶體裡，正式版會綁到匿名身份。key 是 contest.id。

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
  // 縮放（滾輪／雙指）與點選都會改變 mapLevelView，量測要分辨是哪一種；applyZoom
  // 一開始就把它改成 'zoom'，其餘（含預設）都算 'select'。
  const levelChangeTriggerRef = useRef<'zoom' | 'select'>('select');
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

  useEffect(() => {
    if (!animatedContestId) return;
    const reveal = window.setTimeout(() => setHeldMapCell(null), 1_375);
    const finish = window.setTimeout(() => setAnimatedContestId(null), 2_550);
    return () => {
      window.clearTimeout(reveal);
      window.clearTimeout(finish);
    };
  }, [animatedContestId]);

  const selectedLocationId = selectedJurisdiction
    ? (jurisdictionToMapLocation[selectedJurisdiction.id] ?? null)
    : null;
  const mapWidth = parseMapBounds(viewBox).width;
  const mapResultPeakScale = getMapResultScale();
  const mapResultAnimationStyle = {
    '--map-result-peak-scale': mapResultPeakScale,
  } as CSSProperties;
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

  // 地圖著色只看伺服器的統計。全國地圖是首頁必打的一支，永遠拉；下鑽的那一層
  // 等真的切進去才拉。
  const nationalMap = useQuery({ queryKey: ['map', 'national'], queryFn: getNationalMap });
  const drillLevel: ElectionView | null = !detailMode
    ? null
    : villageZoom
      ? 'VILLAGE'
      : (activeTownshipView ?? 'COUNCIL');
  const drillMap = useQuery({
    enabled: Boolean(selectedJurisdiction && drillLevel),
    queryKey: ['map', selectedJurisdiction?.id, drillLevel],
    queryFn: () => getJurisdictionMap(selectedJurisdiction?.id ?? '', drillLevel ?? 'COUNCIL'),
  });

  const cells = useMemo(() => {
    const all = new Map<string, MapCell>();
    for (const cell of nationalMap.data?.cells ?? []) all.set(cell.contestId, cell);
    for (const cell of drillMap.data?.cells ?? []) all.set(cell.contestId, cell);
    return all;
  }, [nationalMap.data, drillMap.data]);

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
    return townshipLayer.shapes.map((township) => {
      const options = getTownshipContestOptions(township, selectedJurisdiction);
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
      contest: buildVillageContest(village, selectedJurisdiction),
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

  // mapLevelView 是推導值，不是哪個 handler 的回傳——滾輪縮放（applyZoom）跟五處
  // setDetailMode 呼叫點都會改到它，逐一埋點一定漏掉滾輪那條最常見的路。改成盯著
  // 這個推導值本身，用 ref 記上一個值，變了才發，這樣不管哪條路都量得到。
  const previousMapLevelRef = useRef(mapLevelView);
  useEffect(() => {
    if (previousMapLevelRef.current === mapLevelView) return;
    track('map_level_changed', {
      level: mapLevelView,
      previous_level: previousMapLevelRef.current,
      jurisdiction_id: selectedJurisdiction?.id ?? null,
      trigger: levelChangeTriggerRef.current,
    });
    previousMapLevelRef.current = mapLevelView;
  }, [mapLevelView, selectedJurisdiction]);

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
    levelChangeTriggerRef.current = 'select';
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
    levelChangeTriggerRef.current = 'zoom';
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
    // 搜尋輸入框一旦失焦會套回手機頁首的 Icon 模式；開始操作地圖就直接收起，
    // 不留下只有外框、看似可點卻沒有輸入欄位的滿寬空殼。
    setSearchOpen(false);
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
    // 手機一次清乾淨，但鏡頭留在原地：放大到某個縣市是使用者花力氣做的，誤觸
    // 海面不該把它丟掉。要退回全國視野走「‹ 回到全臺」按鈕，那是明確的操作。
    if (isDrawerLayout()) {
      if (selectedJurisdiction || selectedContest) clearMapSelection();
      return;
    }
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

  // 只清選取狀態，不動 viewBox。detailMode 一起關掉：鄉鎮市區層本來就要有選取
  // 的縣市才畫得出來，留著只會是個沒有內容的層級。
  function clearMapSelection() {
    setDetailMode(false);
    setSelectedJurisdiction(null);
    setSelectedTownshipId(null);
    setSelectedVillageId(null);
    setSelectedContest(null);
    setInspectorExpanded(false);
    clearTownshipFocus();
  }

  // 回到「看得到所有縣市」的視野就一併取消選取，不留著上一個縣市。
  function resetMap() {
    cancelMapFocusAnimation();
    setViewBox(initialMapViewBox);
    clearMapSelection();
  }

  return (
    <>
      {/* 桌機才掛：窄畫面地圖用自己的浮動 UI，頁首會跟它重複，CSS 裡直接隱藏。 */}
      <AppHeader overlay />
      <main
        className={`map-app ${activeContest ? 'has-selection' : ''} ${detailMode ? 'detail-mode' : ''} ${townshipFocus ? 'township-focus' : ''} ${activeContestOptions.length > 1 ? 'has-switch' : ''}`}
      >
        <section className={`map-stage ${searchOpen ? 'search-open' : ''}`} ref={mapStageRef}>
          <SocialShare className="map-share" />
          <div className="map-floating-top">
            <div className="map-context" aria-label={`目前顯示${mapLevelLabel}預測`}>
              <Icon name="map" />
              <span>{selectedJurisdiction ? `${selectedJurisdiction.name} ›` : '全臺 ›'}</span>
              <strong>{mapLevelLabel}</strong>
            </div>
          </div>

          {/* 窄畫面才有：這個寬度以上，搜尋與主選單都在浮動頁首上，這一組是重複的。 */}
          {compactChrome && searchOpen && <SearchBox autoFocus className="map-search" />}

          {compactChrome && (
            <div className="map-floating-actions">
              <button
                aria-label="搜尋縣市"
                aria-expanded={searchOpen}
                className="map-round-button"
                onClick={() => {
                  track('map_search_toggled', { open: !searchOpen });
                  setSearchOpen((open) => !open);
                }}
                type="button"
              >
                <Icon name={searchOpen ? 'close' : 'search'} />
              </button>
              <Link aria-label="選區列表" className="map-round-button stamp" to="/regions">
                <Icon name="stamp" />
              </Link>
              <Link aria-label="政黨列表" className="map-round-button" to="/parties">
                <Icon name="user" />
              </Link>
              <Link aria-label="我的預測" className="map-round-button" to="/mine">
                <Icon name="vote" />
              </Link>
            </div>
          )}

          {/* 取消選取後鏡頭還留在原地，這顆按鈕就是唯一的退路，所以條件看的是
            「視野還縮在全國視野之內」，不是有沒有選取縣市。 */}
          {(mapWidth < nationalViewWidth || (detailMode && selectedJurisdiction)) && (
            <button
              className="map-back-button"
              onClick={() => {
                track('map_reset', {
                  from_level: mapLevelView,
                  jurisdiction_id: selectedJurisdiction?.id ?? null,
                });
                resetMap();
              }}
              type="button"
            >
              ‹ 回到全臺
            </button>
          )}

          {countyShapes.length === 0 && !mapError && (
            <img
              alt="臺灣直轄市及縣市界線"
              className="taiwan-map-static"
              src="/maps/taiwan-counties.svg"
            />
          )}

          <svg
            aria-hidden={countyShapes.length === 0}
            aria-label="臺灣縣市預測地圖"
            className={`taiwan-map-svg ${countyShapes.length === 0 ? 'loading' : ''}`}
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
              {paintAnimatedLast(countyShapes, animatedContestId, (location) => {
                const jurisdiction = getJurisdiction(mapLocationToJurisdiction[location.id]);
                return getContests(jurisdiction, 'EXECUTIVE')[0].id;
              }).map((location) => {
                const jurisdiction = getJurisdiction(mapLocationToJurisdiction[location.id]);
                const contest = getContests(jurisdiction, 'EXECUTIVE')[0];
                const cell =
                  heldMapCell?.contestId === contest.id ? heldMapCell.cell : cells.get(contest.id);
                const selected = selectedJurisdiction?.id === jurisdiction.id;
                return (
                  <path
                    aria-label={mapLabel(jurisdiction.name, cell)}
                    className={`taiwan-county ${selected ? 'selected' : ''} ${animatedContestId === contest.id ? 'map-result-changed' : ''}`}
                    data-jurisdiction-id={jurisdiction.id}
                    d={location.path}
                    fill={mapFill(cell, selected)}
                    key={location.id}
                    onClick={() => {
                      if (!mapClickAllowed()) return;
                      track('map_area_selected', {
                        level: 'county',
                        jurisdiction_id: jurisdiction.id,
                        contest_id: contest.id,
                        contest_type: contest.view,
                        source: 'county_path',
                      });
                      selectJurisdictionFromMap(jurisdiction, contest);
                    }}
                    ref={(node) => {
                      pathRefs.current[jurisdiction.id] = node;
                    }}
                    role="button"
                    stroke="#fffdf8"
                    style={animatedContestId === contest.id ? mapResultAnimationStyle : undefined}
                    tabIndex={0}
                  />
                );
              })}
            </g>

            {detailMode && selectedJurisdiction && (
              <g className={`township-layer ${villageMode ? 'faded' : ''}`}>
                {paintAnimatedLast(
                  visibleTownships,
                  animatedContestId,
                  ({ contest }) => contest?.id,
                ).map(({ contest, township }) => {
                  const cell = contest
                    ? heldMapCell?.contestId === contest.id
                      ? heldMapCell.cell
                      : cells.get(contest.id)
                    : undefined;
                  const selected =
                    contest !== null &&
                    (selectedTownshipId === township.id ||
                      (contest.view === 'COUNCIL' && selectedContest?.id === contest.id));
                  return (
                    <path
                      aria-label={
                        contest
                          ? mapLabel(`${township.countyName}${township.townName}`, cell)
                          : `${township.countyName}${township.townName}，請由村里界線選擇議員選區`
                      }
                      className={`taiwan-township ${selected ? 'selected' : ''} ${contest ? '' : 'unresolved'} ${contest?.id === animatedContestId ? 'map-result-changed' : ''}`}
                      data-jurisdiction-id={selectedJurisdiction.id}
                      data-town-code={township.townCode}
                      d={township.path}
                      fill={contest ? mapFill(cell, selected) : '#e5e3dd'}
                      key={township.id}
                      onClick={() => {
                        if (!mapClickAllowed() || !contest) return;
                        levelChangeTriggerRef.current = 'select';
                        track('map_area_selected', {
                          level: 'township',
                          jurisdiction_id: selectedJurisdiction.id,
                          contest_id: contest.id,
                          contest_type: contest.view,
                          town_code: township.townCode,
                        });
                        setSelectedTownshipId(township.id);
                        setSelectedVillageId(null);
                        setFocusedTownCode(township.townCode);
                        setSelectedContest(contest);
                        setInspectorExpanded(false);
                      }}
                      role="button"
                      stroke="#fffdf8"
                      style={
                        contest?.id === animatedContestId ? mapResultAnimationStyle : undefined
                      }
                      tabIndex={0}
                    />
                  );
                })}
              </g>
            )}

            {visibleCouncilVillages.length > 0 && selectedJurisdiction && (
              <g className={`council-village-layer ${villageMode ? 'faded' : ''}`}>
                {paintAnimatedLast(
                  visibleCouncilVillages,
                  animatedContestId,
                  ({ contest }) => contest.id,
                ).map(({ contest, village }) => {
                  const cell =
                    heldMapCell?.contestId === contest.id
                      ? heldMapCell.cell
                      : cells.get(contest.id);
                  const selected = selectedContest?.id === contest.id;
                  return (
                    <path
                      aria-label={mapLabel(
                        `${village.countyName}${village.townName}${village.villName}，${contest.name}`,
                        cell,
                      )}
                      className={`taiwan-township council-village ${selected ? 'selected' : ''} ${contest.id === animatedContestId ? 'map-result-changed' : ''}`}
                      data-council-village="true"
                      data-jurisdiction-id={selectedJurisdiction.id}
                      data-town-code={village.townCode}
                      d={village.path}
                      fill={mapFill(cell, selected)}
                      key={`council-${village.id}`}
                      onClick={() => {
                        if (!mapClickAllowed()) return;
                        levelChangeTriggerRef.current = 'select';
                        track('map_area_selected', {
                          level: 'council_village',
                          jurisdiction_id: selectedJurisdiction.id,
                          contest_id: contest.id,
                          contest_type: contest.view,
                          town_code: village.townCode,
                        });
                        setSelectedTownshipId(null);
                        setSelectedVillageId(null);
                        setSelectedContest(contest);
                        setInspectorExpanded(false);
                      }}
                      role="button"
                      stroke="#fffdf8"
                      style={contest.id === animatedContestId ? mapResultAnimationStyle : undefined}
                      tabIndex={0}
                    />
                  );
                })}
              </g>
            )}

            {shouldShowVillageBoundaryPreview(
              selectedTownshipId,
              villageMode,
              animatedContestId !== null,
            ) && (
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
                {paintAnimatedLast(
                  visibleVillages,
                  animatedContestId,
                  ({ contest }) => contest.id,
                ).map(({ contest, village }) => {
                  const cell =
                    heldMapCell?.contestId === contest.id
                      ? heldMapCell.cell
                      : cells.get(contest.id);
                  const name = village.villName || '未編定村里';
                  const dimmed = townshipFocus !== null && village.townCode !== townshipFocus;
                  const selected = selectedVillageId === village.id;
                  return (
                    <path
                      aria-label={mapLabel(`${village.countyName}${village.townName}${name}`, cell)}
                      className={`taiwan-village ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''} ${contest.id === animatedContestId ? 'map-result-changed' : ''}`}
                      data-jurisdiction-id={selectedJurisdiction.id}
                      data-town-code={village.townCode}
                      d={village.path}
                      fill={mapFill(cell, selected)}
                      key={village.id}
                      onClick={() => {
                        if (!mapClickAllowed()) return;
                        levelChangeTriggerRef.current = 'select';
                        track('map_area_selected', {
                          level: 'village',
                          jurisdiction_id: selectedJurisdiction.id,
                          contest_id: contest.id,
                          contest_type: contest.view,
                          town_code: village.townCode,
                        });
                        setSelectedVillageId(village.id);
                        setSelectedTownshipId(null);
                        setFocusedTownCode(village.townCode);
                        setSelectedContest(contest);
                        setInspectorExpanded(false);
                      }}
                      role="button"
                      stroke="#fffdf8"
                      style={contest.id === animatedContestId ? mapResultAnimationStyle : undefined}
                      tabIndex={0}
                    />
                  );
                })}
              </g>
            )}
          </svg>

          {mapError && (
            <div aria-live="polite" className="map-data-message error" role="status">
              {mapError}
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
                    onClick={() => {
                      track('map_area_selected', {
                        level: 'county',
                        jurisdiction_id: jurisdiction.id,
                        contest_id: contest.id,
                        contest_type: contest.view,
                        source: 'island_inset',
                      });
                      selectJurisdictionFromMap(jurisdiction, contest);
                    }}
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
              onBackToResult={() => setForecastOpen(false)}
              onContestChange={(contest) => {
                setForecastOpen(false);
                setSelectedContest(contest);
              }}
              onExpandedChange={setInspectorExpanded}
              onForecast={() => setForecastOpen(true)}
              // 送出後的顯示由伺服器回答，這裡只負責把畫面切回結果。
              onSubmitted={(_, previousMapCell, nextMapCell) => {
                if (shouldAnimateMapResult(previousMapCell, nextMapCell)) {
                  setHeldMapCell({ contestId: activeContest.id, cell: previousMapCell });
                  setAnimatedContestId(activeContest.id);
                } else {
                  setHeldMapCell(null);
                  setAnimatedContestId(null);
                }
                setForecastOpen(false);
                setInspectorExpanded(!isDrawerLayout());
              }}
              showForm={forecastOpen}
            />
          )}
      </main>
    </>
  );
}
