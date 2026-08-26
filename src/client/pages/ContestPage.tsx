import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type Contest, findContest } from '../mock-election';
import {
  Breadcrumbs,
  Icon,
  LeadingBadge,
  PageShell,
  PrototypeNotice,
  usePrototype,
} from './ElectionPrototypeShared';
import { ForecastSheet, getResultRows } from './ForecastSheet';

function ResultsPanel({ contest }: { contest: Contest }) {
  const { phase } = usePrototype();
  const rows = getResultRows(contest, phase);
  return (
    <section className="results-panel">
      <div className="results-total">
        <span>有效預測</span>
        <strong>{contest.forecasts.toLocaleString()}</strong>
        <small>份</small>
      </div>
      <div className="result-bars">
        {rows.map((row, index) => (
          <div className="result-row" key={row.id}>
            <div className="result-label">
              <span className="result-rank">{index + 1}</span>
              <i style={{ background: row.color }} />
              <span>
                <strong>{row.label}</strong>
                <small>{row.meta}</small>
              </span>
              <b>{row.value}%</b>
            </div>
            <div className="result-track large">
              <i style={{ background: row.color, width: `${row.value}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="method-note">每個匿名身份在本選區只計一份有效預測。重複送出會覆蓋原紀錄。</p>
    </section>
  );
}

function TrendPanel() {
  return (
    <section className="trend-panel">
      <div className="trend-legend">
        <span>
          <i className="dot-green" />
          領先者
        </span>
        <span>
          <i className="dot-blue" />
          第二名
        </span>
        <b>近 30 日</b>
      </div>
      <div className="trend-chart" aria-label="近三十日預測趨勢示意圖">
        <div className="grid-line line-1" />
        <div className="grid-line line-2" />
        <div className="grid-line line-3" />
        <svg preserveAspectRatio="none" viewBox="0 0 600 180">
          <path
            className="trend-a"
            d="M0 135 C80 125 110 92 180 105 S290 65 360 82 S480 42 600 28"
          />
          <path
            className="trend-b"
            d="M0 80 C90 75 140 110 210 98 S310 120 390 105 S510 124 600 112"
          />
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
          <strong>近 7 日變化</strong>領先者增加 4.8 個百分點
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
  const { phase } = usePrototype();
  const [activeTab, setActiveTab] = useState<'results' | 'trend' | 'comments'>('results');
  const [forecastOpen, setForecastOpen] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <PageShell>
      <PrototypeNotice />
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
        <section className="contest-hero">
          <div>
            <span className="eyebrow">
              {contest.seatCount === 1
                ? 'SINGLE-SEAT CONTEST'
                : `MULTI-MEMBER · ${contest.seatCount} SEATS`}
            </span>
            <h1>{contest.name}</h1>
            <p>
              <Icon name="map" />
              {contest.area}
            </p>
          </div>
          <div className="contest-hero-status">
            <span>{phase === 'party' ? '正式名單尚未公布' : '正式候選人名單已匯入'}</span>
            <LeadingBadge contest={contest} />
          </div>
          <button
            className="button button-accent"
            onClick={() => setForecastOpen(true)}
            type="button"
          >
            <Icon name="vote" />
            送出我的預測
          </button>
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
            {activeTab === 'trend' && <TrendPanel />}
            {activeTab === 'comments' && <CommentsPanel />}
          </div>
          <aside className="contest-aside">
            <span className="eyebrow">YOUR FORECAST</span>
            <h3>你還沒有預測這一區</h3>
            <p>
              {contest.seatCount === 1
                ? '選出你認為最可能勝出的政黨或候選人。'
                : `預測 ${contest.seatCount} 席最終歸屬。`}
            </p>
            <button
              className="button button-dark button-wide"
              onClick={() => setForecastOpen(true)}
              type="button"
            >
              開始預測 <Icon name="chevron" />
            </button>
            <div className="privacy-note">
              <span>匿名可參加</span>
              <small>裝置只保留一份有效預測，可隨時修改。</small>
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
