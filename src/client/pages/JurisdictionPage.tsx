import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  buildRepresentativeContest,
  buildTownshipContest,
  buildVillageContest,
  jurisdictionToMapLocation,
  loadTownshipShapes,
  loadVillageShapes,
} from '../map-shapes';
import {
  type Contest,
  type ElectionView,
  type Jurisdiction,
  electionViews,
  getContests,
  getJurisdiction,
} from '../mock-election';
import {
  Breadcrumbs,
  CandidateList,
  CardCover,
  ElectionTabs,
  Icon,
  PageShell,
  usePrototype,
} from './ElectionPrototypeShared';
import { regionCounts } from '../region-counts';
import { getResultRows } from './ForecastSheet';

// 最窄的卡片（.contest-grid 的 304px）文字欄約 170px，13px 中文一行約 13 字，
// 兩行就是這個數。
const areaTwoLineLimit = 26;

// 區域清單的長度差距很大：92% 在 16 字內（一行就放得下），但最長的到 145 字——
// 新竹市議員第一選舉區列了 36 個里。超過兩行的就收成「前兩項 等 N 個X」：把 145 字
// 壓進兩行需要 3px 上下的字級，而中文低於 11px 就讀不動了，所以縮字級這條路走不通。
export function summariseArea(area: string) {
  const parts = area.split('、');
  if (area.length <= areaTwoLineLimit || parts.length < 3) return area;
  const units = new Set(parts.map((part) => part.slice(-1)));
  // 單位從各項的最後一個字推：全是「里」就講里，混到鄉鎮市就退回中性的「區域」。
  const unit = units.size === 1 ? `個${[...units][0]}` : '個區域';
  return `${parts[0]}、${parts[1]} 等 ${parts.length} ${unit}`;
}

function ContestCard({ contest }: { contest: Contest }) {
  const { phase } = usePrototype();
  const rowLimit = contest.view === 'COUNCIL' ? Math.max(4, contest.seatCount) : 4;
  const rows = getResultRows(contest, phase).slice(0, rowLimit);
  // 代表的名額依地方制度法第 33 條按人口決定，公告還沒下來，標明是暫定值。
  const seats =
    contest.view === 'REPRESENTATIVE'
      ? `暫定 ${contest.seatCount} 席`
      : contest.seatCount === 1
        ? '單席'
        : `應選 ${contest.seatCount} 席`;
  return (
    <Link
      className={`contest-card ${contest.view === 'COUNCIL' ? 'council-contest-card' : ''}`.trim()}
      to={`/contest/${contest.id}`}
    >
      <span className="card-link">
        {contest.forecasts.toLocaleString()} 份 <Icon name="chevron" />
      </span>
      {/* 區域清單放標題下面而不是上面的 kicker：那一行是單行截斷的，
          「石門區、三芝區、淡水區、八里區」這種會被切掉一半，也會撞到右上角的份數。 */}
      <CardCover kicker={seats} meta={summariseArea(contest.area)} title={contest.name} />
      <CandidateList forecasts={contest.forecasts} rows={rows} winnerCount={contest.seatCount} />
    </Link>
  );
}

const defaultView: ElectionView = 'EXECUTIVE';

// 網址上寫小寫（/region/TPE?view=township），讀的時候大小寫都收，
// 認不得的值（手改網址、舊連結）就退回縣市長，不讓頁面開天窗。
export function parseView(value: string | null): ElectionView {
  const match = electionViews.find((item) => item.id.toLowerCase() === value?.toLowerCase());
  return match?.id ?? defaultView;
}

// 這三種都從圖資產生，跟地圖上看到的是同一組 id 與名稱。縣市長與議員走中選會
// 公告的靜態資料。
export function usesShapeContests(view: ElectionView) {
  return view === 'TOWNSHIP' || view === 'REPRESENTATIVE' || view === 'VILLAGE';
}

// 直轄市與市的區長是官派，不是選出來的；縣才有鄉鎮市長與代表。
export function isViewAvailable(jurisdiction: Jurisdiction, view: ElectionView) {
  if (view === 'TOWNSHIP' || view === 'REPRESENTATIVE') return jurisdiction.kind === 'county';
  return true;
}

type ShapeContests = { contests: Contest[]; townNames: string[] };
type ShapeLoad = { key: string; value: ShapeContests | 'error' };
type SkeletonPhase = 'loading' | 'resetting' | 'revealed';

function ContestGridSkeleton({ count, pulsing }: { count: number; pulsing: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`contest-grid t-skel-skeleton ${pulsing ? 'is-pulsing' : ''}`.trim()}
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="contest-card skeleton-card" key={index}>
          <div className="skeleton-card-cover">
            <i />
            <span>
              <b />
              <b />
              <b />
            </span>
          </div>
          {Array.from({ length: 4 }, (_, row) => (
            <div className="skeleton-candidate" key={row}>
              <i />
              <span>
                <b />
                <b />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function useShapeContests(jurisdiction: Jurisdiction, view: ElectionView) {
  const locationId = jurisdictionToMapLocation[jurisdiction.id];
  const enabled = usesShapeContests(view) && isViewAvailable(jurisdiction, view) && !!locationId;
  const key = enabled ? `${locationId}:${view}` : '';
  const [loaded, setLoaded] = useState<ShapeLoad | null>(null);

  useEffect(() => {
    if (!key) return;
    let active = true;
    const build = view === 'TOWNSHIP' ? buildTownshipContest : buildRepresentativeContest;
    const pending =
      view === 'VILLAGE'
        ? loadVillageShapes(locationId).then((shapes) => ({
            contests: shapes.map((shape) => buildVillageContest(shape, jurisdiction)),
            townNames: [...new Set(shapes.map((shape) => shape.townName))],
          }))
        : loadTownshipShapes(locationId).then((shapes) => ({
            contests: shapes.map((shape) => build(shape, jurisdiction)),
            townNames: [...new Set(shapes.map((shape) => shape.townName))],
          }));

    pending.then(
      (value) => active && setLoaded({ key, value }),
      () => active && setLoaded({ key, value: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [jurisdiction, key, locationId, view]);

  // 用 key 比對判斷資料是不是這一次要的，切分頁的當下自然就是「載入中」，
  // 不必在 effect 開頭同步 setState 清空（那會多觸發一次 render）。
  const current = loaded?.key === key ? loaded.value : null;
  return {
    state: current === 'error' ? null : current,
    error: current === 'error',
    enabled,
  };
}

// 每個分頁的選區數。縣市長只有一場，不標數字；鄉鎮市長與代表是一鄉鎮市區一場，
// 村里長是一村里一場，數字來自 region-counts.ts（圖資太大，不能為了數字先載）。
function countForView(jurisdiction: Jurisdiction, view: ElectionView) {
  if (view === 'EXECUTIVE') return null;
  if (view === 'COUNCIL') return getContests(jurisdiction, 'COUNCIL').length;
  const counts = regionCounts[jurisdictionToMapLocation[jurisdiction.id] ?? ''];
  if (!counts) return null;
  return view === 'VILLAGE' ? counts.villages : counts.townships;
}

export function JurisdictionPage() {
  const { jurisdictionId } = useParams();
  const jurisdiction = getJurisdiction(jurisdictionId);
  // 分頁狀態放在網址上，重新整理、上一頁、把連結貼給別人都會停在同一個分頁。
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get('view'));
  const { state, error, enabled } = useShapeContests(jurisdiction, view);
  const [skeletonPhase, setSkeletonPhase] = useState<SkeletonPhase>('revealed');
  const skeletonRef = useRef<HTMLDivElement>(null);
  const resetFrameRef = useRef<number | null>(null);

  // 村里長一個縣市可以到一千多筆（新北 1,039 個里），攤平在一頁既慢又找不到東西，
  // 所以先選鄉鎮市區，只列那一區的里。鄉鎮市長最多 33 筆（屏東），不用分。
  const townNames = state?.townNames ?? [];
  const needsTownPicker = view === 'VILLAGE' && townNames.length > 1;
  const town = searchParams.get('town');
  const activeTown = needsTownPicker && town && townNames.includes(town) ? town : townNames[0];

  const contests = useMemo(() => {
    if (!enabled) return getContests(jurisdiction, view);
    if (!state) return [];
    if (!needsTownPicker) return state.contests;
    return state.contests.filter((contest) => contest.area.includes(activeTown));
  }, [activeTown, enabled, jurisdiction, needsTownPicker, state, view]);
  const contestGridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const block = contestGridRef.current;
    if (!block || contests.length === 0) return;
    block.classList.remove('is-hiding');
    block.classList.remove('is-shown');
    void block.offsetHeight;
    const frame = requestAnimationFrame(() => block.classList.add('is-shown'));
    return () => cancelAnimationFrame(frame);
  }, [contests]);

  useEffect(() => {
    if (skeletonPhase !== 'loading' || (enabled && !state && !error)) return;
    const root = skeletonRef.current;
    const styles = getComputedStyle(root ?? document.documentElement);
    const duration = Number.parseFloat(styles.getPropertyValue('--pulse-dur')) || 1000;
    const count = Number.parseFloat(styles.getPropertyValue('--pulse-count')) || 1;
    const timer = window.setTimeout(() => setSkeletonPhase('revealed'), duration * count);
    return () => window.clearTimeout(timer);
  }, [enabled, error, skeletonPhase, state]);

  useEffect(
    () => () => {
      if (resetFrameRef.current !== null) cancelAnimationFrame(resetFrameRef.current);
    },
    [],
  );

  function updateParams(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams);
    update(params);
    // replace：切分頁不該讓使用者按很多次上一頁才離得開這一頁。
    setSearchParams(params, { replace: true });
  }

  function selectView(next: ElectionView) {
    if (next === view) return;
    setSkeletonPhase('resetting');
    if (resetFrameRef.current !== null) cancelAnimationFrame(resetFrameRef.current);
    resetFrameRef.current = requestAnimationFrame(() => {
      setSkeletonPhase('loading');
      resetFrameRef.current = null;
    });
    updateParams((params) => {
      // 預設分頁不留參數，/region/TPE 這種現成連結才不會變成兩種寫法。
      if (next === defaultView) params.delete('view');
      else params.set('view', next.toLowerCase());
      params.delete('town');
    });
  }

  const label = electionViews.find((item) => item.id === view)?.label;
  const unavailable = !isViewAvailable(jurisdiction, view);
  const skeletonLoading = skeletonPhase !== 'revealed' || (enabled && !state && !error);
  const skeletonSwapState =
    skeletonPhase === 'resetting' ? 'is-resetting' : skeletonLoading ? '' : 'is-revealed';

  return (
    <PageShell>
      <main className="page">
        <Breadcrumbs jurisdiction={jurisdiction} />
        <section className="page-heading">
          <h1>{jurisdiction.name}</h1>
          <span className="page-tag">預測總覽</span>
          <span className="page-stat">
            <strong>{(jurisdiction.forecasts * 3).toLocaleString()}</strong> 份預測
          </span>
        </section>

        <ElectionTabs
          available={(item) => isViewAvailable(jurisdiction, item)}
          count={(item) => countForView(jurisdiction, item)}
          onChange={selectView}
          value={view}
        />

        {view === 'VILLAGE' && !unavailable && (
          <div
            aria-busy={skeletonLoading}
            className={`t-skel town-picker-swap ${skeletonSwapState}`.trim()}
          >
            <div
              aria-hidden="true"
              className={`town-picker town-picker-skeleton t-skel-skeleton ${
                skeletonLoading ? 'is-pulsing' : ''
              }`.trim()}
            >
              {Array.from({ length: 8 }, (_, index) => (
                <i key={index} />
              ))}
            </div>
            <div aria-hidden={skeletonLoading} className="t-skel-content">
              {needsTownPicker && (
                <>
                  {/* 手機用下拉選單：一個縣市可以有幾十個鄉鎮市區，攤平的膠囊會佔掉整個畫面。 */}
                  <select
                    aria-label="鄉鎮市區"
                    className="town-select"
                    onChange={(event) =>
                      updateParams((params) => params.set('town', event.target.value))
                    }
                    value={activeTown}
                  >
                    {townNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <div className="town-picker" role="tablist" aria-label="鄉鎮市區">
                    {townNames.map((name) => (
                      <button
                        aria-selected={name === activeTown}
                        className={name === activeTown ? 'active' : ''}
                        key={name}
                        onClick={() => updateParams((params) => params.set('town', name))}
                        role="tab"
                        type="button"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="section-heading">
          <h2></h2>
          <span>{skeletonLoading ? '載入中…' : `${contests.length} 個選區`}</span>
        </div>

        {unavailable ? (
          <p className="view-note">
            {jurisdiction.name}是{jurisdiction.kind === 'municipality' ? '直轄市' : '市'}
            ，區長由市府指派，沒有{label}選舉。
          </p>
        ) : error ? (
          <p className="view-note">圖資載入失敗，重新整理再試一次。</p>
        ) : (
          <div
            aria-busy={skeletonLoading}
            className={`t-skel region-contest-swap ${skeletonSwapState}`.trim()}
            ref={skeletonRef}
          >
            <ContestGridSkeleton count={Math.max(1, contests.length)} pulsing={skeletonLoading} />
            <div aria-hidden={skeletonLoading} className="t-skel-content">
              <div className="contest-grid t-stagger" ref={contestGridRef}>
                {contests.map((contest, index) => (
                  <div
                    className="t-stagger-line"
                    key={contest.id}
                    style={{ '--stagger-delay': `${index * 20}ms` } as CSSProperties}
                  >
                    <ContestCard contest={contest} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {view === 'REPRESENTATIVE' && !unavailable && (
          <p className="view-note">
            代表確實有選舉區劃分，但依公職人員選舉罷免法第 38
            條，那份公告由各縣市選舉委員會發布，中選會的公告只到議員這一層。所以這裡一個鄉鎮市列一筆，鎮內怎麼分不假造；名額也還是暫定值。
          </p>
        )}
      </main>
    </PageShell>
  );
}
