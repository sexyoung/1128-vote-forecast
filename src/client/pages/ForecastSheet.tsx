import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useState } from 'react';
import { ApiError, getContest, submitPrediction } from '../api';
import { getPredictionMode } from '../../shared/prediction';
import { type Contest, getMockCandidates, getParty, parties } from '../mock-election';
import { type CandidatePhase, Icon } from './ElectionPrototypeShared';

// 結果列跟表單用同一套判斷：面板寫著候選人、表單卻要人選政黨（或反過來）會很錯亂。
export function getResultRows(contest: Contest, phase: CandidatePhase) {
  const orderedParties = [
    getParty(contest.leader),
    ...parties.filter((party) => party.id !== contest.leader),
  ];
  const remaining = 100 - contest.percentage;
  const values = [contest.percentage, Math.round(remaining * 0.48), Math.round(remaining * 0.32)];
  values.push(100 - values.reduce((total, value) => total + value, 0));
  if (getForecastInputMode(contest, phase) === 'party')
    return orderedParties.map((party, index) => ({
      id: party.id,
      label: party.shortName,
      meta: party.name,
      color: party.color,
      value: values[index],
    }));
  const candidates = getMockCandidates(contest);
  return candidates.map((candidate, index) => {
    const party = getParty(candidate.partyId);
    return {
      id: candidate.id,
      label: candidate.name,
      meta: party.shortName,
      color: party.color,
      value:
        contest.seatCount === 1
          ? values[index]
          : Math.max(
              1,
              Math.round((contest.percentage * (candidates.length - index)) / candidates.length),
            ),
    };
  });
}

export function getForecastInputMode(contest: Contest, phase: CandidatePhase) {
  return getPredictionMode(contest.view, contest.seatCount, phase === 'candidate');
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
        />
      </section>
    </div>
  );
}

// 送出後留下來的預測。要記 id 才有辦法在「修改我的預測」時把原本那幾格勾回來，
// 光留 label 對不回選項。
export type ForecastPick = { id: string; label: string };

function tintChoice(hex: string) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  return `rgb(${channels.map((channel) => Math.round(250 + (channel - 250) * 0.09)).join(' ')})`;
}

function targetColor(partyId: string | null) {
  return partyId ? getParty(partyId as Parameters<typeof getParty>[0]).color : '#8b8f8a';
}

export function ForecastForm({
  contest,
  onSubmitted,
}: {
  contest: Contest;
  onSubmitted: (picked: ForecastPick[]) => void;
}) {
  const queryClient = useQueryClient();
  // 名單、席次與目前分布都由伺服器給：中選會公告後只要換伺服器那一份，這裡不用動。
  const detail = useQuery({
    queryKey: ['contest', contest.id],
    queryFn: () => getContest(contest.id),
  });
  const [picks, setPicks] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  const targets = detail.data?.targets ?? [];
  const seats = detail.data?.contest.seats ?? contest.seatCount;
  const singleSeat = seats === 1;
  // 沒動過就顯示伺服器記得的那一組，動過之後才用本地的。
  const selected = picks ?? detail.data?.mine?.targetIds ?? [];
  const isValid = selected.length > 0;
  const shares = new Map(detail.data?.tally.rows.map((row) => [row.targetId, row.percent]) ?? []);

  const submit = useMutation({
    mutationFn: () => submitPrediction(contest.id, selected),
    onSuccess: async () => {
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['contest', contest.id] });
      await queryClient.invalidateQueries({ queryKey: ['my-predictions'] });
      await queryClient.invalidateQueries({ queryKey: ['map'] });
      onSubmitted(
        selected.flatMap((id) => {
          const target = targets.find((item) => item.targetId === id);
          return target ? [{ id, label: target.label }] : [];
        }),
      );
    },
    onError: (failure: unknown) => {
      setError(failure instanceof ApiError ? failure.message : '送出失敗，請稍後再試。');
    },
  });

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
            const color = targetColor(target.partyId);
            const isSelected = selected.includes(target.targetId);
            return (
              <label
                className={isSelected ? 'selected' : ''}
                key={target.targetId}
                style={
                  {
                    ...(isSelected ? { background: tintChoice(color), borderColor: color } : null),
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
                {/* 頭像的位置。照片還沒有就是一塊淺灰，不填字。 */}
                <span className="forecast-mark" />
                <span className="forecast-option-text">
                  <strong>{target.label}</strong>
                  <small>
                    <i style={{ background: color }} />
                    {target.ballotNo === null
                      ? (target.partyId ?? '')
                      : `${target.ballotNo} · ${target.partyId ?? ''}`}
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
        <button
          className="button button-accent button-wide"
          disabled={!isValid || submit.isPending}
          onClick={() => submit.mutate()}
          type="button"
        >
          {submit.isPending
            ? '送出中…'
            : isValid
              ? '確認送出'
              : singleSeat
                ? '請先選擇一項'
                : '請至少選擇一位'}
          {isValid && !submit.isPending && <Icon name="chevron" />}
        </button>
      </footer>
    </>
  );
}
