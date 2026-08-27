import { useEffect, useState } from 'react';
import { type ElectionView, getContests, getJurisdiction } from '../mock-election';
import { Link } from 'react-router-dom';
import { CandidateList, CardCover, Icon, PageShell, usePrototype } from './ElectionPrototypeShared';
import { getResultRows } from './ForecastSheet';

// 系統配發的編號，使用者改不了：它是匿名身份的實際識別碼，名字只是顯示用的外皮。
const forecasterCode = '#8F2A';
const defaultForecasterName = '預測者';

function RenameDialog({
  name,
  onRename,
  onClose,
}: {
  name: string;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();

  // 跟 ForecastSheet 同一套對話框行為：Escape 關閉、開著的時候鎖住背景捲動。
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
        aria-labelledby="rename-title"
        aria-modal="true"
        className="identity-card"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <h2 id="rename-title">顯示名稱</h2>
          <button aria-label="關閉" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <p>留言與排行榜上其他人看到的名字。後面的編號是系統配發的，不會跟著改。</p>
        <div className="identity-field">
          <input
            aria-label="顯示名稱"
            autoFocus
            maxLength={12}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={defaultForecasterName}
            value={draft}
          />
          <span>{forecasterCode}</span>
        </div>
        <button
          className="button button-dark button-wide"
          disabled={!trimmed || trimmed === name}
          onClick={() => onRename(trimmed)}
          type="button"
        >
          儲存名稱
        </button>
        <small>編號不會變，換名字也不會影響已送出的預測。</small>
      </section>
    </div>
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
  const [renaming, setRenaming] = useState(false);
  const items = savedForecasts.map(({ jurisdictionId, view, contestIndex, pickIndex }) => {
    const jurisdiction = getJurisdiction(jurisdictionId);
    const contest = getContests(jurisdiction, view)[contestIndex];
    const rows = getResultRows(contest, phase);
    return { contest, jurisdiction, mine: rows[pickIndex], rows };
  });

  return (
    <PageShell>
      <main className="page mine-page">
        <section className="page-heading">
          <h1>我的預測</h1>
          {/* 名字平常只是身份標籤，點了才展開表單——改名不是這一頁的主要目的。 */}
          <button
            aria-expanded={renaming}
            className={`forecaster-id ${renaming ? 'open' : ''}`}
            onClick={() => setRenaming((open) => !open)}
            type="button"
          >
            <Icon name="user" />
            {name} {forecasterCode}
          </button>
          <span className="page-stat">
            已預測 <strong>{items.length}</strong> 個選區
          </span>
        </section>

        {renaming && (
          <RenameDialog
            name={name}
            onClose={() => setRenaming(false)}
            onRename={(next) => {
              setName(next);
              setRenaming(false);
            }}
          />
        )}

        <div className="section-heading">
          <h2>預測紀錄</h2>
          <span>最近更新：今天</span>
        </div>
        {/* 跟 /regions、/region 同一組卡片：桌機多欄、手機自然收成單欄條列。
            封面用自己押的那位當底色而不是領先者——這一頁的主角是我的預測。 */}
        <div className="contest-grid">
          {items.map(({ contest, jurisdiction, mine, rows }) => (
            <Link className="contest-card" key={contest.id} to={`/contest/${contest.id}`}>
              <span className="card-link">
                {contest.forecasts.toLocaleString()} 份 <Icon name="chevron" />
              </span>
              <CardCover
                kicker={jurisdiction.name}
                meta={`我預測 ${mine.label} · ${rows[0].id === mine.id ? '目前領先' : '目前落後'}`}
                row={mine}
                title={contest.name}
              />
              <CandidateList forecasts={contest.forecasts} highlightId={mine.id} rows={rows} />
            </Link>
          ))}
        </div>
      </main>
    </PageShell>
  );
}
