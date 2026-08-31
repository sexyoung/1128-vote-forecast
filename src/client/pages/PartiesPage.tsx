import { useQuery } from '@tanstack/react-query';
import { type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getPartyCandidateCounts, getPartyContests } from '../api';
import { candidateParties } from '../../shared/candidates';
import { useDocumentTitle } from '../use-document-title';
import { SocialShare } from '../SocialShare';
import { type ElectionView, getJurisdiction, jurisdictions } from '../mock-election';
import { CardCover, ElectionTabs, Icon } from './ElectionPrototypeShared';
import { summariseArea } from '../../shared/area';
import { SkeletonSwap } from './SkeletonSwap';

const typeLabels = {
  EXECUTIVE: '縣市長',
  COUNCIL: '議員',
  TOWNSHIP: '鄉鎮市長',
  REPRESENTATIVE: '代表',
  VILLAGE: '村里長',
};

// 政黨一覽的卡片框架（黨名、連結）不必等 API，只有候選人數字要等，
// 所以骨架只換掉數字那兩行，不是整張卡片。
function PartyStatSkeleton() {
  return (
    <>
      <p className="skel-bar skel-bar-stat" />
      <div className="party-region-counts party-office-counts">
        <span className="skel-bar skel-bar-pill" />
        <span className="skel-bar skel-bar-pill" />
        <span className="skel-bar skel-bar-pill" />
      </div>
    </>
  );
}

// 行政區清單卡片沒有照片，只是文字卡，用細長的線段模擬標題／標籤／統計列即可。
function RegionGridSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className="feature-card skeleton-card skeleton-feature-card" key={index}>
          <div>
            <span className="skel-bar skel-bar-tag" />
            <p className="skel-bar skel-bar-title" />
            <div className="party-region-counts">
              <span className="skel-bar skel-bar-pill" />
              <span className="skel-bar skel-bar-pill" />
            </div>
            <p className="skel-bar skel-bar-line" />
          </div>
        </div>
      ))}
    </>
  );
}

// 骨架直接沿用真實結構的 class（party-region-group／section-heading／
// election-tabs／contest-card／card-cover），只把文字節點換成灰條。尺寸因此是同一
// 套 CSS 算出來的，不必自己再維護一份「長得像」的形狀——之前用 skeleton-card-cover
// 另外湊一套，結果卡片高度、照片大小、分頁列都跟真的對不上。
//
// 分頁導覽（party-pagination）刻意不放：它只有在 totalPages > 1 時才會出現，
// 事先猜錯的話反而多晃一下。
function CandidateRegionSkeleton({ count }: { count: number }) {
  return (
    <section className="party-region-group">
      <div className="section-heading">
        <span className="skel-bar skel-bar-heading" />
        <span className="skel-bar skel-bar-heading-meta" />
      </div>
      {/* 有幾個分頁要等資料才知道，取四個：多數行政區是縣市長、議員、里長再加一個。 */}
      <div className="election-tabs">
        {Array.from({ length: 4 }, (_, index) => (
          <span className="skel-bar skel-bar-tab" key={index} />
        ))}
      </div>
      <div className="contest-grid">
        {Array.from({ length: count }, (_, index) => (
          <div className="contest-card party-candidate-card" key={index}>
            <span className="skel-bar skel-bar-float" />
            <div className="card-cover">
              {/* 空的 <i> 就是 card-cover 那顆 104px 正方形照片框，尺寸不用自己算。 */}
              <i />
              <div>
                <span className="skel-bar skel-bar-tag" />
                <strong className="skel-bar skel-bar-title" />
                <small className="skel-bar skel-bar-line" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PartiesPage() {
  const { partyId: routePartyId } = useParams();
  const partyId = routePartyId?.toUpperCase();
  const party = candidateParties.find(({ id }) => id === partyId);
  const [searchParams, setSearchParams] = useSearchParams();
  const regionId = (searchParams.get('region') ?? '').toUpperCase();
  const view = (searchParams.get('view') ?? '').toUpperCase();
  const parsedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const contests = useQuery({
    queryKey: ['party-contests', partyId, regionId, view, page],
    queryFn: () => getPartyContests(partyId ?? '', page, regionId, view),
    enabled: Boolean(party),
  });
  const partyCounts = useQuery({
    queryKey: ['party-counts'],
    queryFn: getPartyCandidateCounts,
    enabled: !routePartyId,
  });
  const titleRegion = jurisdictions.find(({ id }) => id === regionId);
  const titleView = typeLabels[view as keyof typeof typeLabels];
  const partyTitle = party
    ? `${titleRegion?.name ?? ''}${party.name}${titleRegion && titleView ? `${titleView}候選人` : '候選人'}`
    : '2026 九合一選舉政黨與候選人一覽';
  useDocumentTitle(`${partyTitle}｜九合一選舉預測`);

  if (routePartyId && !party)
    return (
      <>
        <main className="page">
          <p className="view-note">找不到這個政黨。</p>
        </main>
      </>
    );

  if (!party)
    return (
      <>
        <main className="page">
          <nav className="breadcrumbs" aria-label="麵包屑">
            <strong>政黨</strong>
          </nav>
          <section className="page-heading">
            <h1>政黨一覽</h1>
            <span className="page-tag">{candidateParties.length} 個政黨</span>
          </section>
          <SocialShare />
          <div className="contest-grid party-grid">
            {candidateParties.map((item) => (
              <Link
                className="feature-card"
                key={item.id}
                style={{ '--party-color': item.color } as CSSProperties}
                to={`/parties/${item.id}`}
              >
                <div>
                  <h2>{item.name}</h2>
                  <SkeletonSwap
                    pending={partyCounts.isPending}
                    skeleton={<PartyStatSkeleton />}
                    wrapperClassName="skel-grid-swap party-stat-swap"
                  >
                    <p>
                      共{' '}
                      {(partyCounts.data?.parties[item.id]?.candidateCount ?? 0).toLocaleString()}{' '}
                      位候選人
                    </p>
                    <div className="party-region-counts party-office-counts">
                      {(partyCounts.data?.parties[item.id]?.offices ?? []).map(
                        ({ type, candidateCount }) => (
                          <small key={type}>
                            {typeLabels[type]} {candidateCount.toLocaleString()}
                          </small>
                        ),
                      )}
                    </div>
                  </SkeletonSwap>
                </div>
                <Icon name="chevron" />
              </Link>
            ))}
          </div>
        </main>
      </>
    );

  const data = contests.data;
  const selectedRegion = data?.regions.some(({ id }) => id === regionId)
    ? getJurisdiction(regionId)
    : null;
  const selectedRegionData = data?.regions.find(({ id }) => id === regionId);
  return (
    <>
      <main className="page">
        <nav className="breadcrumbs" aria-label="麵包屑">
          <Link to="/parties">政黨</Link>
          <span>/</span>
          {selectedRegion ? (
            <Link to={`/parties/${party.id}`}>{party.name}</Link>
          ) : (
            <strong>{party.name}</strong>
          )}
          {selectedRegion && (
            <>
              <span>/</span>
              <strong>{selectedRegion.name}</strong>
            </>
          )}
        </nav>
        <section className="page-heading">
          <h1>{party.name}</h1>
          <span className="page-tag">候選人與參選選區</span>
          <span className="page-stat">
            共 {data?.candidateTotal.toLocaleString() ?? '—'} 位候選人
          </span>
        </section>
        <SocialShare />
        {regionId ? (
          // 頁面／地區／子分頁任何一個變了，query key 就變了，isPending 會重新變 true，
          // 這裡的 resetKey 跟那把 key 對齊，讓骨架跟著同一節奏重置。
          <SkeletonSwap
            pending={contests.isPending}
            resetKey={`${partyId}:${regionId}:${view}:${page}`}
            skeleton={<CandidateRegionSkeleton count={6} />}
            wrapperClassName="skel-grid-swap party-candidate-swap"
          >
            {contests.isPending ? null : selectedRegion && data?.items.length ? (
              <>
                <section className="party-region-group">
                  <div className="section-heading">
                    <h2>{selectedRegion.name}</h2>
                    <span>
                      <Link to={`/parties/${party.id}`}>返回行政區</Link> · {data.total} 位候選人
                    </span>
                  </div>
                  {data.activeType && selectedRegionData && (
                    <ElectionTabs
                      available={(item) =>
                        selectedRegionData.offices.some(({ type }) => type === item)
                      }
                      count={(item) =>
                        selectedRegionData.offices.find(({ type }) => type === item)
                          ?.candidateCount ?? null
                      }
                      onChange={(next) =>
                        setSearchParams({ region: regionId, view: next.toLowerCase() })
                      }
                      value={data.activeType as ElectionView}
                    />
                  )}
                  <div className="contest-grid">
                    {data.items.map(({ candidate, contest, hasPredictions }) => {
                      const state = !hasPredictions
                        ? '尚無預測'
                        : candidate.predictedElected
                          ? '預測當選'
                          : '預測未當選';
                      return (
                        <Link
                          className="contest-card party-candidate-card"
                          key={candidate.id}
                          to={`/contest/${contest.id}`}
                        >
                          <span className="card-link">
                            {state}
                            {hasPredictions && ` · ${candidate.predictionPercent}%`}{' '}
                            <Icon name="chevron" />
                          </span>
                          <CardCover
                            kicker={`${candidate.ballotNo ? `${candidate.ballotNo} 號 · ` : ''}${typeLabels[contest.type]}`}
                            meta={`${contest.name} · ${summariseArea(contest.area)}`}
                            photo={candidate.photo}
                            title={candidate.name}
                          />
                        </Link>
                      );
                    })}
                  </div>
                </section>
                {data.totalPages > 1 && (
                  <nav className="party-pagination" aria-label="候選人分頁">
                    {data.page > 1 && (
                      <Link
                        to={`?region=${regionId}&view=${data.activeType?.toLowerCase()}&page=${data.page - 1}`}
                      >
                        上一頁
                      </Link>
                    )}
                    <span>
                      第 {data.page} / {data.totalPages} 頁
                    </span>
                    {data.page < data.totalPages && (
                      <Link
                        to={`?region=${regionId}&view=${data.activeType?.toLowerCase()}&page=${data.page + 1}`}
                      >
                        下一頁
                      </Link>
                    )}
                  </nav>
                )}
              </>
            ) : selectedRegion ? (
              <p className="view-note">目前沒有候選人。</p>
            ) : (
              // 網址上的地區在資料裡找不到（連結失效、手改網址）：退回行政區清單，
              // 跟原本沒帶 region 參數時同一個畫面，不讓頁面開天窗。
              <div className="contest-grid party-region-grid">
                {data?.regions.map(({ id, candidateCount, offices }) => (
                  <Link className="feature-card" key={id} to={`?region=${id}`}>
                    <div>
                      <span>行政區</span>
                      <h2>{getJurisdiction(id).name}</h2>
                      <div className="party-region-counts">
                        {offices.map(({ type, candidateCount: count }) => (
                          <small key={type}>
                            {typeLabels[type]} {count}
                          </small>
                        ))}
                      </div>
                      <p>共 {candidateCount} 位候選人</p>
                    </div>
                    <Icon name="chevron" />
                  </Link>
                ))}
              </div>
            )}
          </SkeletonSwap>
        ) : (
          <SkeletonSwap
            pending={contests.isPending}
            resetKey={partyId}
            skeleton={<RegionGridSkeleton count={8} />}
            skeletonClassName="contest-grid party-region-grid"
            wrapperClassName="skel-grid-swap party-region-swap"
          >
            {!contests.isPending && (
              <div className="contest-grid party-region-grid">
                {data?.regions.map(({ id, candidateCount, offices }) => (
                  <Link className="feature-card" key={id} to={`?region=${id}`}>
                    <div>
                      <span>行政區</span>
                      <h2>{getJurisdiction(id).name}</h2>
                      <div className="party-region-counts">
                        {offices.map(({ type, candidateCount: count }) => (
                          <small key={type}>
                            {typeLabels[type]} {count}
                          </small>
                        ))}
                      </div>
                      <p>共 {candidateCount} 位候選人</p>
                    </div>
                    <Icon name="chevron" />
                  </Link>
                ))}
              </div>
            )}
          </SkeletonSwap>
        )}
      </main>
    </>
  );
}
