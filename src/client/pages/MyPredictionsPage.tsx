import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyPredictions, getSession, updateDisplayName } from '../api';
import { useDocumentTitle } from '../use-document-title';
import { track } from '../analytics';
import { SkeletonSwap } from './SkeletonSwap';
import { CandidateList, Icon, PageShell, toCandidateRows } from './ElectionPrototypeShared';

const defaultForecasterName = '預測者';

export function predictionMeta(status: string, labels: string[], mineIsLeading: boolean) {
  if (status === 'INVALIDATED') return '候選人名單已更新，請重新預測';
  return `我預測 ${labels.join('、')} · ${mineIsLeading ? '目前領先' : '目前落後'}`;
}

// 這一頁的卡片跟 /region 的選區卡是同一型（標題＋候選人列），骨架也沿用同一組。
function MinePredictionsSkeleton({ count }: { count: number }) {
  return (
    <div className="contest-grid">
      {Array.from({ length: count }, (_, index) => (
        <div className="contest-card skeleton-card" key={index}>
          <span className="skel-bar skel-bar-float" />
          <div className="skeleton-region-card-heading mine-card-heading">
            <b />
            <b />
            <b />
          </div>
          {Array.from({ length: 4 }, (_, row) => (
            <div className="skeleton-candidate" key={row}>
              <i />
              <span>
                <b />
                <b />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 系統配發的短碼。跟伺服器的 forecasterCode() 是同一套規則，名字重複時靠它分辨。 */
function forecasterCode(id: string) {
  return `#${id.slice(-4).toUpperCase()}`;
}

function IdentityDialog({
  name,
  saving,
  error,
  onSave,
  onClose,
}: {
  name: string;
  saving: boolean;
  error: string;
  onSave: (name: string) => void;
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
        </div>
        {error && <p className="identity-error">{error}</p>}
        <button
          className="button button-dark button-wide"
          disabled={trimmed === name || saving}
          onClick={() => onSave(trimmed)}
          type="button"
        >
          {saving ? '儲存中…' : '儲存'}
        </button>
        <small>編號不會變，換名字也不會影響已送出的預測。</small>
      </section>
    </div>
  );
}

export function MyPredictionsPage() {
  useDocumentTitle('我的預測｜九合一選舉預測');
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: getSession });
  const mine = useQuery({ queryKey: ['my-predictions'], queryFn: getMyPredictions });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const forecaster = session.data?.forecaster;
  const name = forecaster?.displayName ?? defaultForecasterName;
  const code = forecaster ? forecasterCode(forecaster.id) : '';
  const items = mine.data?.predictions ?? [];

  const save = useMutation({
    mutationFn: (next: string) => updateDisplayName(next === defaultForecasterName ? null : next),
    onSuccess: async (_data, next) => {
      setError('');
      setEditing(false);
      // 不送名字本身：只送長度，以及是不是改回預設值（=清掉自訂名稱）。
      track('display_name_saved', {
        name_length: next.length,
        cleared: next === defaultForecasterName,
      });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : '儲存失敗，請稍後再試。');
    },
  });

  return (
    <PageShell>
      <main className="page mine-page">
        <section className="page-heading">
          <h1>我的預測</h1>
          {/* 名字平常只是身份標籤，點了才展開表單——改名不是這一頁的主要目的。 */}
          <button
            aria-expanded={editing}
            className={`forecaster-id ${editing ? 'open' : ''}`}
            disabled={!forecaster}
            onClick={() => {
              if (!editing) {
                track('identity_dialog_opened', {
                  has_name: Boolean(forecaster?.displayName),
                  prediction_count: items.length,
                });
              }
              setEditing((open) => !open);
            }}
            type="button"
          >
            <Icon name="user" />
            {name} {code}
          </button>
          {/* 還在載的時候 items 是空陣列，直接印會變成斬釘截鐵的「已預測 0 個選區」
              ——那是還不知道，不是零。 */}
          <span className="page-stat">
            已預測 <strong>{mine.isPending ? '—' : items.length}</strong> 個選區
          </span>
        </section>

        {editing && forecaster && (
          <IdentityDialog
            error={error}
            name={name}
            onClose={() => {
              setError('');
              setEditing(false);
            }}
            onSave={(nextName) => save.mutate(nextName)}
            saving={save.isPending}
          />
        )}

        <div className="section-heading">
          <h2>預測紀錄</h2>
          <span>{mine.isPending ? '載入中…' : `共 ${items.length} 筆`}</span>
        </div>

        {/* 跟 /regions、/region 同一組卡片：桌機多欄、手機自然收成單欄條列。 */}
        <SkeletonSwap pending={mine.isPending} skeleton={<MinePredictionsSkeleton count={4} />}>
          {mine.isPending ? null : items.length === 0 ? (
            <p className="view-note">
              還沒有預測。回<Link to="/">地圖</Link>挑一個選區開始。
            </p>
          ) : (
            <div className="contest-grid">
              {items.map(({ contest, picks, status, tally }) => {
                const leading = tally.rows[0]?.targetId;
                const mineIsLeading = picks.some(({ targetId }) => targetId === leading);
                return (
                  <Link className="contest-card" key={contest.id} to={`/contest/${contest.id}`}>
                    <span className="card-link">
                      {tally.totalPredictions.toLocaleString()} 份 <Icon name="chevron" />
                    </span>
                    <header className="region-card-heading mine-card-heading">
                      <strong>{contest.name}</strong>
                      <small>{contest.area}</small>
                      <small>
                        {predictionMeta(
                          status,
                          picks.map(({ label }) => label),
                          mineIsLeading,
                        )}
                      </small>
                    </header>
                    <CandidateList
                      forecasts={tally.totalPicks}
                      highlightIds={picks.map(({ targetId }) => targetId)}
                      rows={toCandidateRows(tally)}
                      winnerCount={contest.seats}
                    />
                  </Link>
                );
              })}
            </div>
          )}
        </SkeletonSwap>
      </main>
    </PageShell>
  );
}
