import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getComments, getContest, getTrend, postComment } from '../api';
import { parseShapeContestId, resolveShapeContest } from '../map-shapes';
import { type Contest, type Jurisdiction, findContest } from '../mock-election';

type ResolvedContest = { contest: Contest; jurisdiction: Jurisdiction };
import {
  Breadcrumbs,
  CandidateList,
  ForecastButton,
  Icon,
  PageShell,
  toCandidateRows,
} from './ElectionPrototypeShared';
import { ForecastSheet } from './ForecastSheet';

function ResultsPanel({ contestId, seats }: { contestId: string; seats: number }) {
  const detail = useQuery({
    queryKey: ['contest', contestId],
    queryFn: () => getContest(contestId),
  });
  const tally = detail.data?.tally;

  if (detail.isPending) return <section className="results-panel">載入中…</section>;

  return (
    <section className="results-panel">
      <div className="results-total">
        <span>預測</span>
        <strong>{(tally?.totalPredictions ?? 0).toLocaleString()}</strong>
        <small>份</small>
      </div>
      {tally && tally.rows.length > 0 ? (
        <CandidateList
          forecasts={tally.totalPicks}
          highlightId={detail.data?.mine?.targetIds[0]}
          rows={toCandidateRows(tally)}
          winnerCount={seats}
        />
      ) : (
        <p className="method-note">還沒有人預測這一區，你可以是第一個。</p>
      )}
      <p className="method-note">每個匿名身份在本選區只計一份預測。重複送出會覆蓋原紀錄。</p>
    </section>
  );
}

/**
 * 把每日快照畫成折線。x 是「第幾天」而不是真實日期間距——中間缺一天（伺服器沒
 * 開機、那天沒人預測）時，照日期畫會出現一段假的斜率。
 */
function buildTrendPath(points: { count: number }[], domain: number) {
  if (points.length === 0) return '';
  if (points.length === 1)
    return `M0 ${(180 - (points[0].count / domain) * 172).toFixed(1)} L600 ${(180 - (points[0].count / domain) * 172).toFixed(1)}`;
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 600;
      const y = 180 - (point.count / domain) * 172;
      return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function formatDay(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${day}`;
}

function TrendPanel({ contestId }: { contestId: string }) {
  const trend = useQuery({ queryKey: ['trend', contestId], queryFn: () => getTrend(contestId) });
  const series = trend.data?.series ?? [];
  const domain =
    Math.max(1, ...series.flatMap((line) => line.points.map(({ count }) => count))) * 1.2;
  const days = series[0]?.points.map(({ date }) => date) ?? [];

  if (trend.isPending) return <section className="trend-panel">載入中…</section>;
  if (series.length === 0)
    return (
      <section className="trend-panel">
        <p className="method-note">還沒有足夠的資料畫出走勢。每天會留下一個資料點。</p>
      </section>
    );

  return (
    <section className="trend-panel">
      <div className="trend-legend">
        {series.map((line) => (
          <span key={line.targetId}>
            <i style={{ background: line.color ?? '#8b8f8a' }} />
            {line.label}
          </span>
        ))}
        <b>近 {trend.data?.days ?? 30} 日</b>
      </div>
      <div className="trend-chart" aria-label="預測走勢">
        <div className="grid-line line-1" />
        <div className="grid-line line-2" />
        <div className="grid-line line-3" />
        <svg preserveAspectRatio="none" viewBox="0 0 600 180">
          {series.map((line) => (
            <path
              d={buildTrendPath(line.points, domain)}
              key={line.targetId}
              stroke={line.color ?? '#8b8f8a'}
            />
          ))}
        </svg>
        <div className="trend-axis">
          {[days[0], days[Math.floor(days.length / 2)], days[days.length - 1]]
            .filter(Boolean)
            .map((date) => (
              <span key={date}>{formatDay(date)}</span>
            ))}
        </div>
      </div>
    </section>
  );
}

function CommentsPanel({ contestId }: { contestId: string }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['comments', contestId],
    queryFn: () => getComments(contestId),
  });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const send = useMutation({
    mutationFn: () => postComment(contestId, draft),
    onSuccess: async () => {
      setDraft('');
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['comments', contestId] });
    },
    onError: (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : '送出失敗，請稍後再試。');
    },
  });

  const comments = list.data?.comments ?? [];

  return (
    <section className="comments-panel">
      <div className="comment-compose">
        <div>
          <Icon name="user" />
        </div>
        <input
          aria-label="留言內容"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) send.mutate();
          }}
          placeholder="留下你的看法"
          type="text"
          value={draft}
        />
        <button
          className="button button-glass button-small"
          disabled={!draft.trim() || send.isPending}
          onClick={() => send.mutate()}
          type="button"
        >
          {send.isPending ? '送出中…' : '送出'}
        </button>
      </div>
      {error && <p className="method-note">{error}</p>}
      {list.isPending && <p className="method-note">載入中…</p>}
      {!list.isPending && comments.length === 0 && <p className="method-note">還沒有人留言。</p>}
      {comments.map((comment) => (
        <article className="comment" key={comment.id}>
          <div className="comment-avatar">
            {comment.author.avatarUrl ? (
              <img alt="" src={comment.author.avatarUrl} />
            ) : (
              (comment.author.displayName ?? '預').slice(0, 1)
            )}
          </div>
          <div>
            <p>
              <strong>{comment.author.displayName ?? '預測者'}</strong>
              <time>{comment.author.code}</time>
            </p>
            <span>{comment.body}</span>
          </div>
        </article>
      ))}
    </section>
  );
}

// 圖資產生的選舉（鄉鎮市長、村里長）id 長 town-10002010-TOWNSHIP，靜態清單裡
// 沒有，要照 id 帶的縣市碼把該縣市的圖層載回來。其他選舉照舊同步解出來。
function useResolvedContest(contestId?: string) {
  const isShapeContest = !!contestId && !!parseShapeContestId(contestId);
  const [loaded, setLoaded] = useState<{ id: string; resolved: ResolvedContest | null } | null>(
    null,
  );

  useEffect(() => {
    if (!contestId || !parseShapeContestId(contestId)) return;
    let active = true;
    void resolveShapeContest(contestId).then((resolved) => {
      if (active) setLoaded({ id: contestId, resolved });
    });
    return () => {
      active = false;
    };
  }, [contestId]);

  if (!isShapeContest) return findContest(contestId);
  // 比對 id 而不是在 effect 裡先清空：換選區的當下自然就是「載入中」。
  return loaded?.id === contestId ? loaded.resolved : null;
}

export type ContestTab = 'results' | 'trend' | 'comments';

const contestTabs: { id: ContestTab; label: string }[] = [
  { id: 'results', label: '預測結果' },
  { id: 'trend', label: '趨勢' },
  { id: 'comments', label: '留言' },
];

/** 分頁寫在網址的 ?tab=，地圖抽屜的「趨勢」「留言」才連得進來，也才分享得出去。 */
export function parseContestTab(value: string | null): ContestTab {
  const id = value?.toLowerCase();
  return contestTabs.find((tab) => tab.id === id)?.id ?? 'results';
}

export function ContestPage() {
  const { contestId } = useParams();
  const resolved = useResolvedContest(contestId);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseContestTab(searchParams.get('tab'));
  const setActiveTab = (tab: ContestTab) =>
    setSearchParams(
      (params) => {
        if (tab === 'results') params.delete('tab');
        else params.set('tab', tab);
        return params;
      },
      { replace: true },
    );
  const [forecastOpen, setForecastOpen] = useState(false);
  const [message, setMessage] = useState('');

  // 鄉鎮市長與村里長是從圖資產生的，不在 mock-election 的靜態清單裡，要先載回來。
  if (!resolved)
    return (
      <PageShell>
        <main className="page contest-page">
          <p className="view-note">載入選區資料…</p>
        </main>
      </PageShell>
    );

  const { contest, jurisdiction } = resolved;
  return (
    <PageShell>
      <main className="page contest-page">
        <Breadcrumbs contest={contest} jurisdiction={jurisdiction} />
        {message && (
          <div className="success-banner">
            <span>✓</span>
            {message}
            <button onClick={() => setMessage('')} type="button">
              關閉
            </button>
          </div>
        )}
        <section className="page-heading">
          <h1>{contest.name}</h1>
          <span className="page-tag">
            {contest.seatCount === 1 ? '單席' : `應選 ${contest.seatCount} 席`}
          </span>
          <span className="page-stat">{contest.area}</span>
        </section>

        <div className="content-tabs" role="tablist">
          {contestTabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="contest-content">
          <div>
            {activeTab === 'results' && (
              <ResultsPanel contestId={contest.id} seats={contest.seatCount} />
            )}
            {activeTab === 'trend' && <TrendPanel contestId={contest.id} />}
            {activeTab === 'comments' && <CommentsPanel contestId={contest.id} />}
          </div>
          <aside className="contest-aside">
            <h3>你還沒有預測這一區</h3>
            <p>
              {contest.seatCount === 1
                ? '選出你認為最可能勝出的政黨或候選人。'
                : `預測 ${contest.seatCount} 席最終歸屬。`}
            </p>
            <ForecastButton onClick={() => setForecastOpen(true)} />
            <div className="privacy-note">
              <span>匿名可參加</span>
              <small>裝置只保留一份預測，可隨時修改。</small>
            </div>
          </aside>
        </div>
      </main>
      {forecastOpen && (
        <ForecastSheet
          contest={contest}
          onClose={() => setForecastOpen(false)}
          onSubmitted={(summary) => {
            setForecastOpen(false);
            setMessage(summary);
          }}
        />
      )}
    </PageShell>
  );
}
