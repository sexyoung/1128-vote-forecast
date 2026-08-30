import { useQuery } from '@tanstack/react-query';
import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { getCandidateRankings } from '../api';
import { useDocumentTitle } from '../use-document-title';
import { CandidatePhoto, Icon, PageShell } from './ElectionPrototypeShared';
import { SkeletonSwap } from './SkeletonSwap';
import { summariseArea } from '../../shared/area';

const typeLabels = {
  EXECUTIVE: '縣市長',
  COUNCIL: '議員',
  TOWNSHIP: '鄉鎮市長',
  REPRESENTATIVE: '代表',
  VILLAGE: '村里長',
};

// 沿用真實列的 class（candidate-ranking-list／-number／-avatar／-person／-score），
// 只把文字換成灰條，尺寸就由同一套 CSS 決定。連 li:nth-child(-n+4) 前四名跨滿
// 整列那條規則都會自動套用，骨架的版型跟真的一模一樣。
//
// 列用 <a> 而不是 <div>：版面規則掛在 `.candidate-ranking-list > li > a` 上，
// 換成別的標籤就拿不到那個 grid。沒有 href 不可聚焦，骨架層本身又是
// aria-hidden + pointer-events: none，不會被點到也不會被讀出來。
function RankingListSkeleton({ count }: { count: number }) {
  return (
    <ol className="candidate-ranking-list">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/a11y/useValidAnchor: 骨架沒有目的地，見上方註解
        <li key={index}>
          <a>
            <b className="skel-bar skel-ranking-rank" />
            <i className="candidate-ranking-avatar" />
            <span className="candidate-ranking-person">
              <strong className="skel-bar skel-ranking-name" />
              <small className="skel-bar skel-ranking-party" />
              <span className="skel-bar skel-ranking-meta" />
            </span>
            <span className="candidate-ranking-score">
              <strong className="skel-bar skel-ranking-score" />
              <small className="skel-bar skel-ranking-unit" />
            </span>
            <span />
          </a>
        </li>
      ))}
    </ol>
  );
}

export function CandidateRankingsPage() {
  const rankings = useQuery({
    queryKey: ['candidate-rankings'],
    queryFn: getCandidateRankings,
  });
  useDocumentTitle('熱門候選人排行｜預測次數 Top 50｜九合一選舉預測');

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
        <SkeletonSwap pending={rankings.isPending} skeleton={<RankingListSkeleton count={8} />}>
          {rankings.isPending ? null : rankings.data?.candidates.length ? (
            <ol className="candidate-ranking-list">
              {rankings.data.candidates.map((candidate) => (
                <li key={candidate.id}>
                  <Link to={`/contest/${candidate.contest.id}`}>
                    <b className="candidate-ranking-number">{candidate.rank}</b>
                    <i
                      className="candidate-ranking-avatar"
                      style={{ '--candidate-color': candidate.party.color } as CSSProperties}
                    >
                      <CandidatePhoto photo={candidate.photo} />
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
        </SkeletonSwap>
      </main>
    </PageShell>
  );
}
