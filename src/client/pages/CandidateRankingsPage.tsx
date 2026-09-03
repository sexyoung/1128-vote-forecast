import { useQuery } from '@tanstack/react-query';
import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { type BattlegroundRanking, getBattlegroundRankings } from '../api';
import { SocialShare } from '../SocialShare';
import { useDocumentTitle } from '../use-document-title';
import { CandidatePhoto, Icon } from './ElectionPrototypeShared';
import { SkeletonSwap } from './SkeletonSwap';

type RankedCandidate = BattlegroundRanking['candidates'][number];

function CandidateAvatar({ candidate }: { candidate: RankedCandidate }) {
  return (
    <i
      className="battle-candidate-avatar"
      style={{ '--candidate-color': candidate.party.color } as CSSProperties}
    >
      <CandidatePhoto photo={candidate.photo} />
    </i>
  );
}

function CandidateEndpoint({ candidate }: { candidate: RankedCandidate }) {
  return (
    <span className="battle-candidate-endpoint">
      <CandidateAvatar candidate={candidate} />
      <span>
        <strong>{candidate.name}</strong>
        <small>{candidate.party.name}</small>
      </span>
    </span>
  );
}

export function getCandidateMarkerPosition(
  candidates: RankedCandidate[],
  candidateIndex: number,
  totalPredictions: number,
) {
  const before = candidates
    .slice(0, candidateIndex)
    .reduce((total, candidate) => total + candidate.predictionCount, 0);
  return ((before + candidates[candidateIndex].predictionCount / 2) / totalPredictions) * 100;
}

function BattlegroundBar({ ranking }: { ranking: BattlegroundRanking }) {
  const first = ranking.candidates[0]!;
  const last = ranking.candidates.at(-1)!;
  return (
    <div className="battle-matchup">
      <CandidateEndpoint candidate={first} />
      <div
        aria-label={ranking.candidates
          .map(({ name, predictionPercent }) => `${name} ${predictionPercent}%`)
          .join('、')}
        className="battle-bar-wrap"
      >
        <span className="battle-color-bar">
          {ranking.candidates.map((candidate) => (
            <i
              key={candidate.id}
              style={{ background: candidate.party.color, flexGrow: candidate.predictionCount }}
              title={`${candidate.name} ${candidate.predictionPercent}% · ${candidate.predictionCount.toLocaleString()} 票`}
            >
              <span>
                {candidate.predictionPercent}% · {candidate.predictionCount.toLocaleString()} 票
              </span>
            </i>
          ))}
        </span>
        {ranking.candidates.slice(1, -1).map((candidate, index) => (
          <span
            className="battle-middle-candidate"
            key={candidate.id}
            style={
              {
                '--battle-marker-left': `${getCandidateMarkerPosition(
                  ranking.candidates,
                  index + 1,
                  ranking.totalPredictions,
                )}%`,
              } as CSSProperties
            }
          >
            <CandidateAvatar candidate={candidate} />
            <strong>{candidate.name}</strong>
            <small>{candidate.party.name}</small>
          </span>
        ))}
      </div>
      <CandidateEndpoint candidate={last} />
    </div>
  );
}

function RankingListSkeleton({ count }: { count: number }) {
  return (
    <ol className="candidate-ranking-list battle-ranking-list">
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          {/* biome-ignore lint/a11y/useValidAnchor: 不可互動的載入骨架 */}
          <a className="battle-ranking-card">
            <header className="battle-ranking-heading">
              <b className="skel-bar skel-ranking-rank" />
              <span>
                <strong className="skel-bar skel-ranking-name" />
              </span>
              <div className="battle-matchup">
                <i className="skel-bar battle-candidate-avatar" />
                <span className="battle-bar-wrap">
                  <i className="skel-bar battle-color-bar" />
                </span>
                <i className="skel-bar battle-candidate-avatar" />
              </div>
            </header>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function CandidateRankingsPage() {
  const rankings = useQuery({
    queryKey: ['battleground-rankings'],
    queryFn: getBattlegroundRankings,
  });
  useDocumentTitle('2026 九合一選舉激戰選區 Top 20｜預測票數最接近｜九合一選舉預測');

  return (
    <main className="page">
      <nav className="breadcrumbs" aria-label="麵包屑">
        <strong>激戰選區</strong>
      </nav>
      <section className="page-heading">
        <h1>激戰選區</h1>
        <span className="page-tag">第一、二名差距最小 Top 20</span>
        <span className="page-stat">目前 {rankings.data?.contests.length ?? '—'} 個選區</span>
      </section>
      <SocialShare />
      <SkeletonSwap pending={rankings.isPending} skeleton={<RankingListSkeleton count={6} />}>
        {rankings.isPending ? null : rankings.data?.contests.length ? (
          <ol className="candidate-ranking-list battle-ranking-list">
            {rankings.data.contests.map((ranking) => (
              <li key={ranking.contest.id}>
                <Link className="battle-ranking-card" to={`/contest/${ranking.contest.id}`}>
                  <header className="battle-ranking-heading">
                    <b className="candidate-ranking-number">{ranking.rank}</b>
                    <span>
                      <strong>{ranking.contest.name}</strong>
                    </span>
                    <BattlegroundBar ranking={ranking} />
                    <Icon name="chevron" />
                  </header>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="view-note">目前還沒有足夠的單席選區預測可供比較。</p>
        )}
      </SkeletonSwap>
    </main>
  );
}
