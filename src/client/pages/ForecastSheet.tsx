import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type ContestDetail,
  type MapCell,
  getContest,
  getSession,
  submitPrediction,
} from '../api';
import { type Contest, getParty } from '../mock-election';
import { track } from '../analytics';
import { CandidatePhoto, Icon } from './ElectionPrototypeShared';

// 送出後留下來的預測。要記 id 才有辦法在「修改我的預測」時把原本那幾格勾回來，
// 光留 label 對不回選項。
export type ForecastPick = { id: string; label: string };

// 同一個表單掛在兩處（選區頁的 ForecastSheet、地圖抽屜的 MapInspector），不分開
// 就分不出地圖上的預測佔多少。
export type ForecastSurface = 'contest_page' | 'map_inspector';

type MapResult = { cells: MapCell[] };

export function updateCachedMaps(
  queryClient: QueryClient,
  contest: Contest,
  tally: ContestDetail['tally'],
) {
  let previousCell: MapCell | undefined;
  const leader = tally.rows[0];
  const tiedParties = [
    ...new Set(
      tally.rows
        .filter(({ count }) => count === leader?.count)
        .map(({ partyId }) => partyId)
        .filter((partyId): partyId is string => Boolean(partyId)),
    ),
  ].slice(0, 2);
  const cell: MapCell = {
    contestId: contest.id,
    party: leader?.partyId ?? null,
    ...(tiedParties.length === 2 ? { tiedParties } : {}),
    percent: leader?.percent ?? 0,
    total: tally.totalPredictions,
  };

  for (const [key, current] of queryClient.getQueriesData<MapResult>({ queryKey: ['map'] })) {
    const matchesNational = key[1] === 'national' && contest.view === 'EXECUTIVE';
    const matchesRegion = key[1] === contest.jurisdictionId && key[2] === contest.view;
    if (!current || (!matchesNational && !matchesRegion)) continue;
    previousCell ??= current.cells.find(({ contestId }) => contestId === contest.id);
    queryClient.setQueryData<MapResult>(key, {
      cells: current.cells.some(({ contestId }) => contestId === contest.id)
        ? current.cells.map((item) => (item.contestId === contest.id ? cell : item))
        : [...current.cells, cell],
    });
  }
  return { previousCell, nextCell: cell };
}

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: 'light';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScript: Promise<TurnstileApi> | null = null;

/** Turnstile 表單是動態開啟的 drawer，必須用 explicit render，不能靠初始 HTML 掃描。 */
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile 載入失敗。'));
    };
    script.onerror = () => reject(new Error('Turnstile 載入失敗，請檢查網路或阻擋外掛。'));
    document.head.append(script);
  }).catch((error: unknown) => {
    turnstileScript = null;
    throw error;
  });
  return turnstileScript;
}

function TurnstileChallenge({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('人機驗證載入中…');

  useEffect(() => {
    let active = true;
    let widgetId: string | null = null;
    onToken(null);
    void loadTurnstile().then(
      (turnstile) => {
        if (!active || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token) => {
            if (active) {
              setStatus('');
              onToken(token);
            }
          },
          'expired-callback': () => {
            if (active) {
              onToken(null);
              setStatus('人機驗證已逾時，請再驗證一次。');
            }
          },
          'error-callback': () => {
            if (active) {
              onToken(null);
              setStatus('人機驗證無法完成，請重新整理後再試。');
            }
          },
        });
      },
      (failure: unknown) =>
        active && setStatus(failure instanceof Error ? failure.message : '驗證載入失敗。'),
    );
    return () => {
      active = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, siteKey]);

  return (
    <div className="turnstile-challenge">
      <p>請先完成人機驗證。</p>
      <div ref={containerRef} />
      {status && <small>{status}</small>}
    </div>
  );
}

export function ForecastSheet({
  contest,
  onClose,
  onSubmitted,
}: {
  contest: Contest;
  onClose: () => void;
  onSubmitted: (summary: string) => void;
}) {
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
    <div className="sheet-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="forecast-title"
        aria-modal="true"
        className="forecast-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          <div>
            <span className="eyebrow">MAKE A FORECAST</span>
            <h2 id="forecast-title">{contest.name}</h2>
            <p>{contest.area}</p>
          </div>
          <button aria-label="關閉" className="icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </header>
        <ForecastForm
          contest={contest}
          onSubmitted={() =>
            onSubmitted(`已更新「${contest.name}」的示意預測。正式版將同步寫入你的匿名身份。`)
          }
          surface="contest_page"
        />
      </section>
    </div>
  );
}

export function ForecastForm({
  contest,
  onSubmitted,
  surface,
}: {
  contest: Contest;
  onSubmitted: (
    picked: ForecastPick[],
    previousMapCell: MapCell | undefined,
    nextMapCell: MapCell,
  ) => void;
  surface: ForecastSurface;
}) {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: getSession });
  // 名單、席次與目前分布都由伺服器給：中選會公告後只要換伺服器那一份，這裡不用動。
  const detail = useQuery({
    queryKey: ['contest', contest.id],
    queryFn: () => getContest(contest.id),
  });
  const [picks, setPicks] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const receiveTurnstileToken = useCallback((token: string | null) => setTurnstileToken(token), []);

  const targets = detail.data?.targets ?? [];
  const seats = detail.data?.contest.seats ?? contest.seatCount;
  const singleSeat = seats === 1;
  // 沒動過就顯示伺服器記得的那一組，動過之後才用本地的。
  const selected = picks ?? detail.data?.mine?.targetIds ?? [];
  const isValid = selected.length > 0;
  const shares = new Map(detail.data?.tally.rows.map((row) => [row.targetId, row.percent]) ?? []);
  // onSuccess 時 detail 已經被 invalidate，當場再讀 detail.data?.mine 永遠是 true；
  // 送出前先算好「這是新的還是修改」，才分得出轉換漏斗裡有多少是回頭客。
  const isUpdate = Boolean(detail.data?.mine);
  const turnstile = session.data?.turnstile;
  // 伺服器對驗證過的預測者在 12 小時內直接放行（見 server/turnstile.ts），只有沒驗過、
  // 過期，或送出被回 403 要求驗證時才真的要 token。跟著 humanVerified 走，回頭客就不會
  // 每次都被叫去驗一次。
  const humanVerified = session.data?.forecaster.humanVerified ?? false;
  const requiresTurnstile = Boolean(turnstile) && (!humanVerified || needsVerification);
  const missingTurnstile = requiresTurnstile && !turnstileToken;

  const submit = useMutation({
    mutationFn: () => submitPrediction(contest.id, selected, turnstileToken ?? undefined),
    onSuccess: (result) => {
      setError('');
      track('forecast_submitted', {
        contest_id: contest.id,
        contest_type: detail.data?.contest.type,
        jurisdiction_id: detail.data?.contest.jurisdictionId,
        seats,
        seats_source: detail.data?.contest.seatsSource,
        picks: selected.length,
        is_update: isUpdate,
        surface,
      });
      queryClient.setQueryData<ContestDetail>(['contest', contest.id], (current) =>
        current ? { ...current, ...result } : current,
      );
      const { previousCell, nextCell } = updateCachedMaps(queryClient, contest, result.tally);
      void queryClient.invalidateQueries({ queryKey: ['my-predictions'] });
      onSubmitted(
        selected.flatMap((id) => {
          const target = targets.find((item) => item.targetId === id);
          return target ? [{ id, label: target.label }] : [];
        }),
        previousCell,
        nextCell,
      );
    },
    onError: (failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : '送出失敗，請稍後再試。');
      if (failure instanceof ApiError && failure.needsTurnstile) setNeedsVerification(true);
      track('forecast_failed', {
        contest_id: contest.id,
        status: failure instanceof ApiError ? failure.status : null,
        needs_turnstile: failure instanceof ApiError ? failure.needsTurnstile : false,
        surface,
      });
    },
  });
  const canSubmit = isValid && !submit.isPending && !missingTurnstile;

  // 按鈕不因缺 token 而變灰：那樣點下去沒反應也沒理由。缺 token 時仍可點，點了就說原因，
  // 並把下方的驗證狀態指出來，使用者才知道下一步。
  function handleSubmit() {
    if (missingTurnstile) {
      setError('請先完成下方的人機驗證再送出。');
      track('forecast_blocked', {
        contest_id: contest.id,
        reason: 'turnstile_pending',
        surface,
      });
      return;
    }
    submit.mutate();
  }

  function toggle(id: string) {
    setError('');
    setPicks((current) => {
      const now = current ?? detail.data?.mine?.targetIds ?? [];
      if (singleSeat) return [id];
      if (now.includes(id)) return now.filter((pick) => pick !== id);
      return now.length < seats ? [...now, id] : now;
    });
  }

  if (detail.isPending)
    return (
      <div className="forecast-body">
        <p className="forecast-counter">名單載入中…</p>
      </div>
    );

  if (detail.isError)
    return (
      <div className="forecast-body">
        <p className="forecast-notice">
          <i />
          名單載入失敗，請重新整理。
        </p>
      </div>
    );

  return (
    <>
      <div className="forecast-body">
        <h3>{singleSeat ? '你認為誰會勝出？' : `最多預測 ${seats} 個當選席次`}</h3>
        <p className={`forecast-counter ${isValid ? 'done' : ''}`}>
          {isValid && <Icon name="check" />}
          {singleSeat ? (isValid ? '已選好' : '請選擇一項') : `${selected.length} / ${seats} 席`}
        </p>
        <p className="forecast-notice">
          <i />
          {detail.data?.contest.seatsSource === 'PLACEHOLDER'
            ? '這一區的應選名額尚未取得公告，席次為暫定值。'
            : '正式候選人名單尚未公告，以下為黨籍示意候選人。'}
        </p>
        {error && (
          <p className="forecast-notice error">
            <i />
            {error}
          </p>
        )}
        <div className="forecast-options">
          {targets.map((target) => {
            const party = getParty((target.partyId ?? 'IND') as Parameters<typeof getParty>[0]);
            const color = party.color;
            const isSelected = selected.includes(target.targetId);
            return (
              <label
                className={isSelected ? 'selected' : ''}
                key={target.targetId}
                style={
                  {
                    ...(isSelected ? { borderColor: color } : null),
                    '--share': `${shares.get(target.targetId) ?? 0}%`,
                    '--share-color': color,
                  } as CSSProperties
                }
              >
                <input
                  checked={isSelected}
                  name={singleSeat ? `forecast-${contest.id}` : undefined}
                  onChange={() => toggle(target.targetId)}
                  type={singleSeat ? 'radio' : 'checkbox'}
                />
                {/* 使用 API 的候選人照片；檔案不存在時沿用共用的人物圖示 fallback。 */}
                <span className="forecast-mark">
                  <CandidatePhoto photo={target.photo} />
                </span>
                <span className="forecast-option-text">
                  <strong>{target.label}</strong>
                  <small>
                    <i style={{ background: color }} />
                    {target.ballotNo === null ? party.name : `${target.ballotNo} · ${party.name}`}
                  </small>
                </span>
                {/* 右邊的投票格：平常是空白的格子，選取後才蓋上圈選章。章一律紅色，
                    真的選票就是這樣，不跟著黨色跑。 */}
                <b className="forecast-tick">
                  <Icon name="stamp" />
                </b>
              </label>
            );
          })}
        </div>
      </div>
      <footer className="forecast-footer">
        <p>再次送出只會更新原預測，不會重複計票。</p>
        {requiresTurnstile &&
          (turnstile?.siteKey ? (
            <TurnstileChallenge onToken={receiveTurnstileToken} siteKey={turnstile.siteKey} />
          ) : (
            <p className="forecast-turnstile-error">人機驗證尚未設定完成，請稍後再試。</p>
          ))}
        <button
          className="button button-accent button-wide"
          disabled={!isValid || submit.isPending}
          onClick={handleSubmit}
          type="button"
        >
          {submit.isPending
            ? '送出中…'
            : isValid
              ? '確認送出'
              : singleSeat
                ? '請先選擇一項'
                : '請至少選擇一位'}
          {canSubmit && <Icon name="chevron" />}
        </button>
      </footer>
    </>
  );
}
