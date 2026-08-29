import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  getComments,
  getContest,
  getTrend,
  postComment,
  reportComment,
  type ReportReason,
} from '../api';
import { parseShapeContestId, resolveShapeContest } from '../map-shapes';
import { type Contest, type Jurisdiction, findContest, getJurisdiction } from '../mock-election';
import { useDocumentTitle } from '../use-document-title';
import { track } from '../analytics';

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
  const rows = toCandidateRows(tally, detail.data?.targets);

  if (detail.isPending) return <section className="results-panel">載入中…</section>;

  return (
    <section className="results-panel">
      <div className="results-total">
        <span>預測</span>
        <strong>{(tally?.totalPredictions ?? 0).toLocaleString()}</strong>
        <small>份</small>
      </div>
      {rows.length > 0 ? (
        <CandidateList
          forecasts={tally?.totalPicks ?? 0}
          highlightIds={detail.data?.mine?.targetIds}
          rows={rows}
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

// 留言的身份只剩名字的第一個字。整串都同一個深綠色時，二十則留言看起來像同一個人
// 在自言自語，所以色相從 id 算出來——同一個人在哪一頁都是同一個顏色，重新整理也不會換。
const authorColors = ['#173f33', '#3c5b7a', '#7a4a68', '#8a5a2b', '#2f6b5a', '#5b4a86'];
const reportReasons: { value: ReportReason; label: string }[] = [
  { value: 'SPAM', label: '垃圾訊息' },
  { value: 'ABUSE', label: '辱罵或騷擾' },
  { value: 'ADULT', label: '成人內容' },
  { value: 'ILLEGAL', label: '違法內容' },
  { value: 'OTHER', label: '其他' },
];

function authorColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1)
    hash = (hash * 31 + id.charCodeAt(index)) % 9973;
  return authorColors[hash % authorColors.length];
}

function ReportDialog({
  pending,
  error,
  onSubmit,
  onClose,
}: {
  pending: boolean;
  error: string;
  onSubmit: (reason: ReportReason) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>('SPAM');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.classList.remove('sheet-open');
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop centered" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="report-title"
        aria-modal="true"
        className="identity-card report-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <h2 id="report-title">檢舉留言</h2>
          <button aria-label="關閉" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <p>請選擇最符合的檢舉原因，管理員會在後台審核。</p>
        <label>
          檢舉原因
          <select
            autoFocus
            onChange={(event) => setReason(event.target.value as ReportReason)}
            value={reason}
          >
            {reportReasons.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="identity-error">{error}</p>}
        <button
          className="button button-dark button-wide"
          disabled={pending}
          onClick={() => onSubmit(reason)}
          type="button"
        >
          {pending ? '送出中…' : '送出檢舉'}
        </button>
      </section>
    </div>
  );
}

function CommentsPanel({
  contestId,
  contestType,
}: {
  contestId: string;
  contestType: Contest['view'];
}) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['comments', contestId],
    queryFn: () => getComments(contestId),
  });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportError, setReportError] = useState('');
  const [reportStatus, setReportStatus] = useState<{ id: string; message: string } | null>(null);
  // 送出的當下記住是按 Enter 還是按鈕，onSuccess 才分得出來——mutate() 本身不帶參數。
  const entryRef = useRef<'enter_key' | 'button'>('button');

  const send = useMutation({
    mutationFn: () => postComment(contestId, draft),
    onSuccess: async () => {
      const bodyLength = draft.trim().length;
      setDraft('');
      setError('');
      track('comment_posted', {
        contest_id: contestId,
        contest_type: contestType,
        body_length: bodyLength,
        entry: entryRef.current,
      });
      await queryClient.invalidateQueries({ queryKey: ['comments', contestId] });
    },
    onError: (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : '送出失敗，請稍後再試。');
      track('comment_failed', {
        contest_id: contestId,
        status: failure instanceof ApiError ? failure.status : null,
        needs_turnstile: failure instanceof ApiError ? failure.needsTurnstile : false,
      });
    },
  });

  const report = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: ReportReason }) => reportComment(id, reason),
    onSuccess: (_data, { id, reason }) => {
      setReportingId(null);
      setReportError('');
      setReportStatus({ id, message: '已送出檢舉。' });
      // 內容一律不送：reason 是固定列舉值，note 從沒問過使用者，body 更不用說。
      track('report_submitted', { target_type: 'COMMENT', reason, contest_id: contestId });
    },
    onError: (failure: unknown) => {
      setReportError(failure instanceof Error ? failure.message : '檢舉失敗，請稍後再試。');
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
            if (event.key === 'Enter' && draft.trim()) {
              entryRef.current = 'enter_key';
              send.mutate();
            }
          }}
          placeholder="留下你的看法"
          type="text"
          value={draft}
        />
        <button
          className="button button-glass button-small"
          disabled={!draft.trim() || send.isPending}
          onClick={() => {
            entryRef.current = 'button';
            send.mutate();
          }}
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
          <div
            className="comment-author-mark"
            style={{ '--author-color': authorColor(comment.author.id) } as CSSProperties}
          >
            {(comment.author.displayName ?? '預').slice(0, 1)}
          </div>
          <div>
            <p>
              <strong>{comment.author.displayName ?? '預測者'}</strong>
              <time>{comment.author.code}</time>
            </p>
            <span>{comment.body}</span>
            <button
              aria-expanded={reportingId === comment.id}
              onClick={() => {
                setReportingId(comment.id);
                setReportError('');
                setReportStatus(null);
              }}
              type="button"
            >
              檢舉
            </button>
            {reportStatus?.id === comment.id && (
              <small className="comment-report-status" role="status">
                {reportStatus.message}
              </small>
            )}
          </div>
        </article>
      ))}
      {reportingId && (
        <ReportDialog
          error={reportError}
          onClose={() => setReportingId(null)}
          onSubmit={(reason) => report.mutate({ id: reportingId, reason })}
          pending={report.isPending}
        />
      )}
    </section>
  );
}

// 圖資產生的選舉（鄉鎮市長、村里長）id 長 town-10002010-TOWNSHIP，靜態清單裡
// 沒有，要照 id 帶的縣市碼把該縣市的圖層載回來。其他選舉照舊同步解出來。
function useResolvedContest(contestId?: string) {
  const queryClient = useQueryClient();
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

  // SSR 已把完整選區放進同一個 query key。圖資產生的選區不用等瀏覽器下載 SVG
  // 才能畫第一版；直接 client-side 導覽時沒有 seed，仍走原本的 effect。
  const seeded = queryClient.getQueryData<import('../api').ContestDetail>(['contest', contestId]);
  if (seeded) {
    const contest = seeded.contest;
    return {
      contest: {
        id: contest.id,
        jurisdictionId: contest.jurisdictionId,
        name: contest.name,
        area: contest.area,
        seatCount: contest.seats,
        view: contest.type,
        leader: 'IND' as const,
        percentage: 0,
        forecasts: seeded.tally.totalPredictions,
      },
      jurisdiction: getJurisdiction(contest.jurisdictionId),
    };
  }
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

export function forecastAsideTitle(pickCount: number, seats: number) {
  if (pickCount === 0) return '你還沒有預測這一區';
  return pickCount < seats ? '你還可以補齊這區的預測' : '你已完成這區的預測';
}

export function ContestPage() {
  const { contestId } = useParams();
  const resolved = useResolvedContest(contestId);
  const detail = useQuery({
    queryKey: ['contest', contestId],
    queryFn: () => getContest(contestId ?? ''),
    enabled: Boolean(contestId),
  });
  const contestTitle = resolved
    ? resolved.contest.name.startsWith(resolved.jurisdiction.name)
      ? resolved.contest.name
      : `${resolved.jurisdiction.name}${resolved.contest.name}`
    : '選區';
  useDocumentTitle(`${contestTitle}預測｜九合一選舉預測`);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseContestTab(searchParams.get('tab'));
  // 分頁寫在網址上，但那是 replace 的，不算換頁；要知道有沒有人看趨勢與留言只能靠這裡。
  const setActiveTab = (tab: ContestTab) => {
    if (resolved)
      track('contest_tab_changed', {
        contest_id: resolved.contest.id,
        contest_type: resolved.contest.view,
        tab,
        entry: 'tab_click',
      });
    setSearchParams(
      (params) => {
        if (tab === 'results') params.delete('tab');
        else params.set('tab', tab);
        return params;
      },
      { replace: true },
    );
  };
  const [forecastOpen, setForecastOpen] = useState(false);
  const [message, setMessage] = useState('');

  // 地圖抽屜的連結直接帶 ?tab= 進來，不會經過 setActiveTab；掛載時分頁不是預設值
  // 就代表是深連結，只在第一次 render 判斷一次。
  const deepLinkTracked = useRef(false);
  useEffect(() => {
    if (deepLinkTracked.current || !resolved) return;
    deepLinkTracked.current = true;
    if (activeTab !== 'results') {
      track('contest_tab_changed', {
        contest_id: resolved.contest.id,
        contest_type: resolved.contest.view,
        tab: activeTab,
        entry: 'deep_link',
      });
    }
    // 刻意不把 activeTab 放進相依：這一輪只負責「進來時網址就帶著 ?tab=」這件事，
    // 之後使用者切分頁走的是 setActiveTab 那條，已經各自送過事件了。放進去會讓
    // 每次切分頁都多送一筆 deep_link。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

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
  const pickCount = detail.data?.mine?.targetIds.length ?? 0;
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
            {activeTab === 'comments' && (
              <CommentsPanel contestId={contest.id} contestType={contest.view} />
            )}
          </div>
          <aside className="contest-aside">
            <h3>{forecastAsideTitle(pickCount, contest.seatCount)}</h3>
            <p>
              {contest.seatCount === 1
                ? '選出你認為最可能勝出的政黨或候選人。'
                : `預測 ${contest.seatCount} 席最終歸屬。`}
            </p>
            <ForecastButton
              editing={pickCount > 0}
              onClick={() => {
                track('forecast_sheet_opened', {
                  contest_id: contest.id,
                  contest_type: contest.view,
                  jurisdiction_id: contest.jurisdictionId,
                  seats: contest.seatCount,
                  surface: 'contest_page',
                  is_update: pickCount > 0,
                });
                setForecastOpen(true);
              }}
            />
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
