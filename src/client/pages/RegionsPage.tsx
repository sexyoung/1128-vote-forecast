import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { type ContestListTally, getContestTallies } from '../api';
import { useDocumentTitle } from '../use-document-title';
import { type Jurisdiction, getContests, jurisdictions } from '../mock-election';
import { jurisdictionOrder } from '../../shared/jurisdictions';
import {
  CandidateList,
  CardCover,
  Icon,
  PageShell,
  toCandidateRows,
} from './ElectionPrototypeShared';

const orderedJurisdictions = jurisdictionOrder.flatMap(
  (id) => jurisdictions.find((item) => item.id === id) ?? [],
);

const kindLabels: Record<Jurisdiction['kind'], string> = {
  municipality: '直轄市',
  city: '市',
  county: '縣',
};

export function uniqueLeader(rows: ReturnType<typeof toCandidateRows>) {
  const [leader, runnerUp] = rows;
  return leader?.value > 0 && leader.value > (runnerUp?.value ?? 0) ? leader : undefined;
}

function RegionCard({
  jurisdiction,
  tally,
}: {
  jurisdiction: Jurisdiction;
  tally?: ContestListTally;
}) {
  const contest = getContests(jurisdiction, 'EXECUTIVE')[0];
  const rows = toCandidateRows(tally, tally?.targets);
  const leader = uniqueLeader(rows);
  return (
    <Link
      className={`contest-card ${leader ? 'region-card-has-leader' : ''}`.trim()}
      to={`/region/${jurisdiction.id}`}
    >
      <span className="card-link">
        {(tally?.totalPredictions ?? 0).toLocaleString()} 份 <Icon name="chevron" />
      </span>
      <CardCover
        kicker={kindLabels[jurisdiction.kind]}
        meta={contest.name}
        photo={leader?.photo}
        progress={leader && { color: leader.color, value: leader.value }}
        title={jurisdiction.name}
      />
      <CandidateList
        forecasts={tally?.totalPicks ?? 0}
        rows={rows}
        winnerCount={contest.seatCount}
      />
    </Link>
  );
}

// 麵包屑的「全國」指向這裡，而不是地圖：地圖是操作介面，麵包屑往上一層應該還是
// 一份看得完的清單。
export function RegionsPage() {
  useDocumentTitle('全國預測｜22 個縣市的縣市長選情｜九合一選舉預測');
  const contestIds = orderedJurisdictions.map((jurisdiction) => `${jurisdiction.id}-EXECUTIVE-1`);
  // 22 張卡一次要完，不要一張一次請求。
  const tallies = useQuery({
    queryKey: ['tallies', 'national'],
    queryFn: () => getContestTallies(contestIds),
  });
  const total = Object.values(tallies.data?.tallies ?? {}).reduce(
    (sum, tally) => sum + tally.totalPredictions,
    0,
  );
  return (
    <PageShell>
      <main className="page">
        <nav className="breadcrumbs" aria-label="麵包屑">
          <strong>全國</strong>
        </nav>
        <section className="page-heading">
          <h1>全國預測</h1>
          <span className="page-tag">{orderedJurisdictions.length} 個縣市</span>
          <span className="page-stat">
            <strong>{total.toLocaleString()}</strong> 份預測
          </span>
        </section>
        <div className="contest-grid">
          {orderedJurisdictions.map((jurisdiction) => (
            <RegionCard
              jurisdiction={jurisdiction}
              key={jurisdiction.id}
              tally={tallies.data?.tallies[`${jurisdiction.id}-EXECUTIVE-1`]}
            />
          ))}
        </div>
      </main>
    </PageShell>
  );
}
