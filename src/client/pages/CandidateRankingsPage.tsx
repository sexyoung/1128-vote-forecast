import { useQuery } from '@tanstack/react-query';
import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { getCandidateRankings } from '../api';
import { useDocumentTitle } from '../use-document-title';
import { Icon, PageShell } from './ElectionPrototypeShared';
import { summariseArea } from '../../shared/area';

const typeLabels = {
  EXECUTIVE: '縣市長',
  COUNCIL: '議員',
  TOWNSHIP: '鄉鎮市長',
  REPRESENTATIVE: '代表',
  VILLAGE: '村里長',
};

export function CandidateRankingsPage() {
  const rankings = useQuery({
    queryKey: ['candidate-rankings'],
    queryFn: getCandidateRankings,
  });
  useDocumentTitle('熱門候選人排行｜九合一選舉預測');

  return (
    <PageShell>
      <main className="page">
        <nav className="breadcrumbs" aria-label="麵包屑">
          <strong>排行</strong>
        </nav>
        <section className="page-heading">
          <h1>熱門候選人</h1>
          <span className="page-tag">預測次數前 50 名</span>
          <span className="page-stat">目前 {rankings.data?.candidates.length ?? '—'} 位</span>
        </section>
        {rankings.isPending ? (
          <p className="view-note">載入排行榜…</p>
        ) : rankings.data?.candidates.length ? (
          <ol className="candidate-ranking-list">
            {rankings.data.candidates.map((candidate) => (
              <li key={candidate.id}>
                <Link to={`/contest/${candidate.contest.id}`}>
                  <b className="candidate-ranking-number">{candidate.rank}</b>
                  <i
                    className="candidate-ranking-avatar"
                    style={{ '--candidate-color': candidate.party.color } as CSSProperties}
                  >
                    {candidate.photo ? <img alt="" src={candidate.photo} /> : <Icon name="user" />}
                  </i>
                  <span className="candidate-ranking-person">
                    <strong>{candidate.name}</strong>
                    <small>{candidate.party.name}</small>
                    <span>
                      {typeLabels[candidate.contest.type]} · {candidate.contest.name} ·{' '}
                      {summariseArea(candidate.contest.area)}
                    </span>
                  </span>
                  <span className="candidate-ranking-score">
                    <strong>{candidate.predictionCount.toLocaleString()}</strong>
                    <small>次預測</small>
                  </span>
                  <Icon name="chevron" />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="view-note">目前還沒有候選人獲得預測。</p>
        )}
      </main>
    </PageShell>
  );
}
