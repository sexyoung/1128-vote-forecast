import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getMyPredictions,
  getSession,
  removeAvatar,
  updateDisplayName,
  uploadAvatar,
} from '../api';
import {
  CandidateList,
  CardCover,
  Icon,
  PageShell,
  toCandidateRows,
} from './ElectionPrototypeShared';

const defaultForecasterName = '預測者';

/** 系統配發的短碼。跟伺服器的 forecasterCode() 是同一套規則，名字重複時靠它分辨。 */
function forecasterCode(id: string) {
  return `#${id.slice(-4).toUpperCase()}`;
}

function IdentityDialog({
  name,
  avatar,
  saving,
  error,
  onSave,
  onClose,
}: {
  name: string;
  avatar: string | null;
  saving: boolean;
  error: string;
  onSave: (name: string, photo: File | null, removePhoto: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [photo, setPhoto] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const trimmed = draft.trim();
  const changed = trimmed !== name || photo !== null || removed;
  // 送出前先在本地預覽，不必等上傳完才看得到自己選了哪張。網址在 render 時就算好，
  // effect 只負責釋放，避免多跑一次 render。
  const objectUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  const preview = removed ? null : (objectUrl ?? avatar);

  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

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
        <p>留言與排行榜上其他人看到的名字與照片。後面的編號是系統配發的，不會跟著改。</p>
        <div className="identity-photo">
          <i>{preview ? <img alt="" src={preview} /> : <Icon name="user" />}</i>
          <span>
            <label className="button button-glass button-small">
              上傳照片
              <input
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  setPhoto(event.target.files?.[0] ?? null);
                  setRemoved(false);
                }}
                type="file"
              />
            </label>
            {preview && (
              <button
                className="text-action"
                onClick={() => {
                  setPhoto(null);
                  setRemoved(true);
                }}
                type="button"
              >
                移除
              </button>
            )}
          </span>
        </div>
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
          disabled={!changed || saving}
          onClick={() => onSave(trimmed, photo, removed)}
          type="button"
        >
          {saving ? '儲存中…' : '儲存'}
        </button>
        <small>編號不會變，換名字或照片也不會影響已送出的預測。</small>
      </section>
    </div>
  );
}

export function MyPredictionsPage() {
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
    mutationFn: async (input: { name: string; photo: File | null; removePhoto: boolean }) => {
      // 名字與照片是兩個端點，但對使用者是同一次「儲存」。
      if (input.name !== (forecaster?.displayName ?? defaultForecasterName))
        await updateDisplayName(input.name === defaultForecasterName ? null : input.name);
      if (input.photo) await uploadAvatar(input.photo);
      else if (input.removePhoto) await removeAvatar();
    },
    onSuccess: async () => {
      setError('');
      setEditing(false);
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
            onClick={() => setEditing((open) => !open)}
            type="button"
          >
            {forecaster?.avatarUrl ? (
              <img alt="" src={forecaster.avatarUrl} />
            ) : (
              <Icon name="user" />
            )}
            {name} {code}
          </button>
          <span className="page-stat">
            已預測 <strong>{items.length}</strong> 個選區
          </span>
        </section>

        {editing && forecaster && (
          <IdentityDialog
            avatar={forecaster.avatarUrl}
            error={error}
            name={name}
            onClose={() => {
              setError('');
              setEditing(false);
            }}
            onSave={(nextName, photo, removePhoto) =>
              save.mutate({ name: nextName, photo, removePhoto })
            }
            saving={save.isPending}
          />
        )}

        <div className="section-heading">
          <h2>預測紀錄</h2>
          <span>{mine.isPending ? '載入中…' : `共 ${items.length} 筆`}</span>
        </div>

        {!mine.isPending && items.length === 0 && (
          <p className="view-note">
            還沒有預測。回<Link to="/">地圖</Link>挑一個選區開始。
          </p>
        )}

        {/* 跟 /regions、/region 同一組卡片：桌機多欄、手機自然收成單欄條列。
            封面寫的是自己押了誰而不是領先者——這一頁的主角是我的預測。 */}
        <div className="contest-grid">
          {items.map(({ contest, picks, tally }) => {
            const leading = tally.rows[0]?.targetId;
            const mineIsLeading = picks.some(({ targetId }) => targetId === leading);
            return (
              <Link className="contest-card" key={contest.id} to={`/contest/${contest.id}`}>
                <span className="card-link">
                  {tally.totalPredictions.toLocaleString()} 份 <Icon name="chevron" />
                </span>
                <CardCover
                  kicker={contest.area}
                  meta={`我預測 ${picks.map(({ label }) => label).join('、')} · ${
                    mineIsLeading ? '目前領先' : '目前落後'
                  }`}
                  title={contest.name}
                />
                <CandidateList
                  forecasts={tally.totalPicks}
                  highlightId={picks[0]?.targetId}
                  rows={toCandidateRows(tally)}
                  winnerCount={contest.seats}
                />
              </Link>
            );
          })}
        </div>
      </main>
    </PageShell>
  );
}
