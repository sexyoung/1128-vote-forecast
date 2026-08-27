import { useState } from 'react';
import { type ElectionView, getContests, getJurisdiction } from '../mock-election';
import { HeaderNav, Icon, PageShell, SearchBox, usePrototype } from './ElectionPrototypeShared';
import { getResultRows } from './ForecastSheet';

// 系統配發的編號，使用者改不了：它是匿名身份的實際識別碼，名字只是顯示用的外皮。
const forecasterCode = '#8F2A';
const defaultForecasterName = '預測者';

// 這一頁是從地圖點進來的，所以頁首只留標題、預測者身份與一顆「回地圖」——品牌列、
// 搜尋、原型的預覽狀態切換在這裡都只是干擾。
function MineHeader({ name }: { name: string }) {
  return (
    <header className="app-header mine-header">
      <h1>我的預測</h1>
      <span className="forecaster-id">
        <Icon name="user" />
        {name} {forecasterCode}
      </span>
      <SearchBox className="mine-search" />
      <HeaderNav />
    </header>
  );
}

function IdentityCard({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();
  const saved = trimmed === name;

  return (
    <section className="identity-card">
      <h2>顯示名稱</h2>
      <p>留言與排行榜上其他人看到的名字。後面的編號是系統配發的，不會跟著改。</p>
      <div className="identity-field">
        <input
          aria-label="顯示名稱"
          maxLength={12}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={defaultForecasterName}
          value={draft}
        />
        <span>{forecasterCode}</span>
      </div>
      <button
        className="button button-dark button-wide"
        disabled={!trimmed || saved}
        onClick={() => onRename(trimmed)}
        type="button"
      >
        {saved ? '已儲存' : '儲存名稱'}
      </button>
      <small>編號不會變，換名字也不會影響已送出的預測。</small>
    </section>
  );
}

// 示意用的三筆紀錄：選了哪一場、押在結果列的第幾位。
const savedForecasts: {
  jurisdictionId: string;
  view: ElectionView;
  contestIndex: number;
  pickIndex: number;
}[] = [
  { jurisdictionId: 'TPE', view: 'EXECUTIVE', contestIndex: 0, pickIndex: 0 },
  { jurisdictionId: 'NTP', view: 'COUNCIL', contestIndex: 1, pickIndex: 1 },
  { jurisdictionId: 'HSZ', view: 'EXECUTIVE', contestIndex: 0, pickIndex: 2 },
];

export function MyPredictionsPage() {
  const { phase } = usePrototype();
  // 原型先記在記憶體，正式版會跟著匿名身份一起存。
  const [name, setName] = useState(defaultForecasterName);
  const items = savedForecasts.map(({ jurisdictionId, view, contestIndex, pickIndex }) => {
    const jurisdiction = getJurisdiction(jurisdictionId);
    const contest = getContests(jurisdiction, view)[contestIndex];
    const rows = getResultRows(contest, phase);
    return { contest, jurisdiction, mine: rows[pickIndex], rows };
  });

  return (
    <PageShell header={<MineHeader name={name} />}>
      <main className="page mine-page">
        <div className="mine-layout">
          <section>
            <div className="section-heading">
              <h2>已預測 {items.length} 個選區</h2>
              <span>最近更新：今天</span>
            </div>
            <div className="prediction-list">
              {items.map(({ contest, jurisdiction, mine, rows }) => (
                <article key={contest.id}>
                  <header>
                    <span>{jurisdiction.name}</span>
                    <h3>{contest.name}</h3>
                    <small className={rows[0].id === mine.id ? 'leading' : ''}>
                      {rows[0].id === mine.id ? '目前領先' : '目前落後'}
                    </small>
                  </header>
                  <p>
                    我的預測：
                    <strong>
                      <i style={{ background: mine.color }} />
                      {mine.label}
                    </strong>
                    <b>{mine.value}%</b>
                  </p>
                  {/* 只寫自己押誰看不出局勢，所以整場的分布也一起放上來。 */}
                  <div className="map-share-bar">
                    {rows.map((row) => (
                      <i key={row.id} style={{ background: row.color, width: `${row.value}%` }} />
                    ))}
                  </div>
                  <footer>
                    <div className="prediction-legend">
                      {rows.map((row) => (
                        <span key={row.id}>
                          <i style={{ background: row.color }} />
                          {row.label} {row.value}%
                        </span>
                      ))}
                    </div>
                    <button type="button">修改</button>
                  </footer>
                </article>
              ))}
            </div>
          </section>
          <div className="mine-side">
            <IdentityCard name={name} onRename={setName} />
            <aside className="account-card" id="account">
              <span className="account-icon">
                <Icon name="spark" />
              </span>
              <h2>建立帳號，帶著預測走</h2>
              <p>註冊後可跨裝置保留預測，並在選區結果下留言。</p>
              <button className="button button-dark button-wide" type="button">
                建立免費帳號
              </button>
              <button className="button button-ghost button-wide" type="button">
                我已經有帳號
              </button>
              <small>註冊不會增加預測權重。</small>
            </aside>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
