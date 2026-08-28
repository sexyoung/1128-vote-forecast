import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { type ContestDetail, getContestTallies } from '../api';
import { type Jurisdiction, getContests, jurisdictions } from '../mock-election';
import {
  CandidateList,
  CardCover,
  Icon,
  PageShell,
  toCandidateRows,
} from './ElectionPrototypeShared';

// 官方的行政區順序：六個直轄市，接著縣與同級的市。jurisdictions 本身是照地圖的
// 圖層排的，直接拿來列會變成連江縣開頭。
const displayOrder = [
  'TPE',
  'NTP',
  'TAO',
  'TXG',
  'TNN',
  'KHH',
  'ILA',
  'HSQ',
  'MIA',
  'CHA',
  'NAN',
  'YUN',
  'CYQ',
  'PIF',
  'HUA',
  'TTT',
  'PEN',
  'KEE',
  'HSZ',
  'CYI',
  'KIN',
  'LIE',
];

const orderedJurisdictions = displayOrder.flatMap(
  (id) => jurisdictions.find((item) => item.id === id) ?? [],
);

const kindLabels: Record<Jurisdiction['kind'], string> = {
  municipality: '直轄市',
  city: '市',
  county: '縣',
};

function RegionCard({
  jurisdiction,
  tally,
}: {
  jurisdiction: Jurisdiction;
  tally?: ContestDetail['tally'];
}) {
  const contest = getContests(jurisdiction, 'EXECUTIVE')[0];
  return (
    <Link className="contest-card" to={`/region/${jurisdiction.id}`}>
      <span className="card-link">
        {(tally?.totalPredictions ?? 0).toLocaleString()} 份 <Icon name="chevron" />
      </span>
      <CardCover
        kicker={kindLabels[jurisdiction.kind]}
        meta={contest.name}
        title={jurisdiction.name}
      />
      <CandidateList
        forecasts={tally?.totalPicks ?? 0}
        rows={toCandidateRows(tally)}
        winnerCount={contest.seatCount}
      />
    </Link>
  );
}

// 麵包屑的「全國」指向這裡，而不是地圖：地圖是操作介面，麵包屑往上一層應該還是
// 一份看得完的清單。
export function RegionsPage() {
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
