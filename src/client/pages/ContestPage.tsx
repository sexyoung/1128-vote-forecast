import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type Contest, findContest } from '../mock-election';
import {
  Breadcrumbs,
  CandidateList,
  ForecastButton,
  Icon,
  PageShell,
  usePrototype,
} from './ElectionPrototypeShared';
import { ForecastSheet, getResultRows } from './ForecastSheet';

function ResultsPanel({ contest }: { contest: Contest }) {
  const { phase } = usePrototype();
  const rows = getResultRows(contest, phase);
  return (
    <section className="results-panel">
      <div className="results-total">
        <span>預測</span>
        <strong>{contest.forecasts.toLocaleString()}</strong>
        <small>份</small>
      </div>
      <CandidateList forecasts={contest.forecasts} rows={rows} />
      <p className="method-note">每個匿名身份在本選區只計一份預測。重複送出會覆蓋原紀錄。</p>
    </section>
  );
}

// 示意用的走勢：從 id 生出固定的擾動，越靠近今天越收斂到目前的百分比，所以
// 線的終點就是清單上的數字。正式版會換成真的每日快照。
function buildTrendPath(row: { id: string; value: number }, domain: number) {
  let seed = 0;
  for (let index = 0; index < row.id.length; index += 1) seed += row.id.charCodeAt(index);
  const points = 7;
  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1);
    const wobble = Math.sin(seed + index * 1.7) * (1 - progress) * row.value * 0.3;
    const value = Math.max(0, row.value + wobble);
    const x = progress * 600;
    const y = 180 - (value / domain) * 172;
    return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function TrendPanel({ contest }: { contest: Contest }) {
  const { phase } = usePrototype();
  const rows = getResultRows(contest, phase);
  const domain = Math.max(...rows.map((row) => row.value)) * 1.35;
  return (
    <section className="trend-panel">
      <div className="trend-legend">
        {rows.map((row) => (
          <span key={row.id}>
            <i style={{ background: row.color }} />
            {row.label}
          </span>
        ))}
        <b>近 30 日</b>
      </div>
      <div className="trend-chart" aria-label="近三十日預測趨勢示意圖">
        <div className="grid-line line-1" />
        <div className="grid-line line-2" />
        <div className="grid-line line-3" />
        <svg preserveAspectRatio="none" viewBox="0 0 600 180">
          {rows.map((row) => (
            <path d={buildTrendPath(row, domain)} key={row.id} stroke={row.color} />
          ))}
        </svg>
        <div className="trend-axis">
          <span>7/27</span>
          <span>8/05</span>
          <span>8/15</span>
          <span>今天</span>
        </div>
      </div>
      <div className="trend-callout">
        <Icon name="spark" />
        <span>
          <strong>近 7 日變化</strong>
          {rows[0].label}增加 4.8 個百分點
        </span>
      </div>
    </section>
  );
}

function CommentsPanel() {
  const comments = [
    {
      name: '北區觀察員',
      time: '12 分鐘前',
      body: '這一區的變化比上週明顯，想看看正式名單公布後會不會重新洗牌。',
    },
    {
      name: '山線居民',
      time: '1 小時前',
      body: '目前樣本還不算多，地圖如果能顯示樣本門檻會更清楚。',
    },
    { name: '選舉資料控', time: '昨天', body: '希望之後能看到名單公布前後的預測差異。' },
  ];
  return (
    <section className="comments-panel">
      <div className="comment-compose">
        <div>
          <Icon name="user" />
        </div>
        <button type="button">登入後參與討論</button>
      </div>
      {comments.map((comment) => (
        <article className="comment" key={comment.name}>
          <div className="comment-avatar">{comment.name.slice(0, 1)}</div>
          <div>
            <p>
              <strong>{comment.name}</strong>
              <time>{comment.time}</time>
            </p>
            <span>{comment.body}</span>
            <button type="button">回覆</button>
          </div>
        </article>
      ))}
    </section>
  );
}

export function ContestPage() {
  const { contestId } = useParams();
  const { contest, jurisdiction } = findContest(contestId);
  const [activeTab, setActiveTab] = useState<'results' | 'trend' | 'comments'>('results');
  const [forecastOpen, setForecastOpen] = useState(false);
  const [message, setMessage] = useState('');
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
          <button
            className={activeTab === 'results' ? 'active' : ''}
            onClick={() => setActiveTab('results')}
            role="tab"
            type="button"
          >
            預測結果
          </button>
          <button
            className={activeTab === 'trend' ? 'active' : ''}
            onClick={() => setActiveTab('trend')}
            role="tab"
            type="button"
          >
            趨勢
          </button>
          <button
            className={activeTab === 'comments' ? 'active' : ''}
            onClick={() => setActiveTab('comments')}
            role="tab"
            type="button"
          >
            留言 <span>36</span>
          </button>
        </div>

        <div className="contest-content">
          <div>
            {activeTab === 'results' && <ResultsPanel contest={contest} />}
            {activeTab === 'trend' && <TrendPanel contest={contest} />}
            {activeTab === 'comments' && <CommentsPanel />}
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
