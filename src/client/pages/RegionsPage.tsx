import { Link } from 'react-router-dom';
import { type Jurisdiction, getContests, jurisdictions } from '../mock-election';
import { CandidateList, CardCover, Icon, PageShell, usePrototype } from './ElectionPrototypeShared';
import { getResultRows } from './ForecastSheet';

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

function RegionCard({ jurisdiction }: { jurisdiction: Jurisdiction }) {
  const { phase } = usePrototype();
  const contest = getContests(jurisdiction, 'EXECUTIVE')[0];
  const rows = getResultRows(contest, phase);
  return (
    <Link className="contest-card" to={`/region/${jurisdiction.id}`}>
      <span className="card-link">
        {contest.forecasts.toLocaleString()} 份 <Icon name="chevron" />
      </span>
      <CardCover
        kicker={kindLabels[jurisdiction.kind]}
        meta={contest.name}
        title={jurisdiction.name}
      />
      <CandidateList forecasts={contest.forecasts} rows={rows} />
    </Link>
  );
}

// 麵包屑的「全國」指向這裡，而不是地圖：地圖是操作介面，麵包屑往上一層應該還是
// 一份看得完的清單。
export function RegionsPage() {
  const total = orderedJurisdictions.reduce((sum, item) => sum + item.forecasts * 3, 0);
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
            <RegionCard jurisdiction={jurisdiction} key={jurisdiction.id} />
          ))}
        </div>
      </main>
    </PageShell>
  );
}
