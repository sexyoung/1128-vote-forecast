import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  type Contest,
  type ElectionView,
  electionViews,
  getContests,
  getJurisdiction,
  getParty,
} from '../mock-election';
import {
  Breadcrumbs,
  ElectionTabs,
  Icon,
  LeadingBadge,
  PageShell,
  PrototypeNotice,
} from './ElectionPrototypeShared';
import { ForecastSheet } from './ForecastSheet';

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
