import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  type Contest,
  type ElectionView,
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
import { getResultRows } from './ForecastSheet';

function ContestCard({ contest }: { contest: Contest }) {
  const { phase } = usePrototype();
  const rows = getResultRows(contest, phase);
  return (
    <Link className="contest-card" to={`/contest/${contest.id}`}>
      <span className="card-link">
        {contest.forecasts.toLocaleString()} 份 <Icon name="chevron" />
      </span>
      <CardCover
        kicker={contest.area}
        meta={contest.seatCount === 1 ? '單席' : `應選 ${contest.seatCount} 席`}
        row={rows[0]}
        title={contest.name}
      />
      <CandidateList forecasts={contest.forecasts} rows={rows} />
    </Link>
  );
}

export function JurisdictionPage() {
  const { jurisdictionId } = useParams();
  const jurisdiction = getJurisdiction(jurisdictionId);
  const [view, setView] = useState<ElectionView>('EXECUTIVE');
  const contests = useMemo(() => getContests(jurisdiction, view), [jurisdiction, view]);

  return (
    <PageShell>
      <main className="page">
        <Breadcrumbs jurisdiction={jurisdiction} />
        <section className="page-heading">
          <h1>{jurisdiction.name}</h1>
          <span className="page-tag">選情總覽</span>
          <span className="page-stat">
            <strong>{(jurisdiction.forecasts * 3).toLocaleString()}</strong> 份預測
          </span>
        </section>

        <ElectionTabs onChange={setView} value={view} />

        <div className="section-heading">
          <h2>{electionViews.find((item) => item.id === view)?.label}選區</h2>
          <span>{contests.length} 個選區</span>
        </div>
        <div className="contest-grid">
          {contests.map((contest) => (
            <ContestCard contest={contest} key={contest.id} />
          ))}
        </div>
      </main>
    </PageShell>
  );
}
