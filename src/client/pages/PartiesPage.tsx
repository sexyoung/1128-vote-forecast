import { useQuery } from '@tanstack/react-query';
import { type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getPartyCandidateCounts, getPartyContests } from '../api';
import { candidateParties } from '../../shared/candidates';
import { useDocumentTitle } from '../use-document-title';
import { type ElectionView, getJurisdiction } from '../mock-election';
import { CardCover, ElectionTabs, Icon, PageShell } from './ElectionPrototypeShared';
import { summariseArea } from '../../shared/area';

const typeLabels = {
  EXECUTIVE: '縣市長',
  COUNCIL: '議員',
  TOWNSHIP: '鄉鎮市長',
  REPRESENTATIVE: '代表',
  VILLAGE: '村里長',
};

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
  useDocumentTitle(party ? `${party.name}候選人｜九合一選舉預測` : '政黨一覽｜九合一選舉預測');

  if (routePartyId && !party)
    return (
      <PageShell>
        <main className="page">
          <p className="view-note">找不到這個政黨。</p>
        </main>
      </PageShell>
    );

  if (!party)
    return (
      <PageShell>
        <main className="page">
          <nav className="breadcrumbs" aria-label="麵包屑">
            <strong>政黨</strong>
          </nav>
          <section className="page-heading">
            <h1>政黨一覽</h1>
            <span className="page-tag">{candidateParties.length} 個政黨</span>
          </section>
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
                  <p>
                    共{' '}
                    {partyCounts.data
                      ? (partyCounts.data.parties[item.id]?.candidateCount ?? 0).toLocaleString()
                      : '—'}{' '}
                    位候選人
                  </p>
                  <div className="party-region-counts party-office-counts">
                    {partyCounts.data ? (
                      (partyCounts.data.parties[item.id]?.offices ?? []).map(
                        ({ type, candidateCount }) => (
                          <small key={type}>
                            {typeLabels[type]} {candidateCount.toLocaleString()}
                          </small>
                        ),
                      )
                    ) : (
                      <small>載入中…</small>
                    )}
                  </div>
                </div>
                <Icon name="chevron" />
              </Link>
            ))}
          </div>
        </main>
      </PageShell>
    );

  const data = contests.data;
  const selectedRegion = data?.regions.some(({ id }) => id === regionId)
    ? getJurisdiction(regionId)
    : null;
  const selectedRegionData = data?.regions.find(({ id }) => id === regionId);
  return (
    <PageShell>
      <main className="page">
        <nav className="breadcrumbs" aria-label="麵包屑">
          <Link to="/parties">政黨</Link>
          <span>/</span>
          <strong>{party.name}</strong>
        </nav>
        <section className="page-heading">
          <h1>{party.name}</h1>
          <span className="page-tag">候選人與參選選區</span>
          <span className="page-stat">
            共 {data?.candidateTotal.toLocaleString() ?? '—'} 位候選人
          </span>
        </section>
        {contests.isPending ? (
          <p className="view-note">載入候選人…</p>
        ) : !selectedRegion ? (
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
        ) : data?.items.length ? (
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
                  available={(item) => selectedRegionData.offices.some(({ type }) => type === item)}
                  count={(item) =>
                    selectedRegionData.offices.find(({ type }) => type === item)?.candidateCount ??
                    null
                  }
                  onChange={(next) =>
                    setSearchParams({ region: regionId, view: next.toLowerCase() })
                  }
                  showIndigenous={false}
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
        ) : (
          <p className="view-note">目前沒有候選人。</p>
        )}
      </main>
    </PageShell>
  );
}
