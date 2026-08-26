import { useEffect, useState } from 'react';
import { type Contest, getMockCandidates, getParty, parties } from '../mock-election';
import { type CandidatePhase, Icon, usePrototype } from './ElectionPrototypeShared';

export function getResultRows(contest: Contest, phase: CandidatePhase) {
  const orderedParties = [
    getParty(contest.leader),
    ...parties.filter((party) => party.id !== contest.leader),
  ];
  const remaining = 100 - contest.percentage;
  const values = [contest.percentage, Math.round(remaining * 0.48), Math.round(remaining * 0.32)];
  values.push(100 - values.reduce((total, value) => total + value, 0));
  if (phase === 'party')
    return orderedParties.map((party, index) => ({
      id: party.id,
      label: party.shortName,
      meta: party.name,
      color: party.color,
      value: values[index],
    }));
  return getMockCandidates(contest)
    .slice(0, 4)
    .map((candidate, index) => {
      const party = getParty(candidate.partyId);
      return {
        id: candidate.id,
        label: candidate.name,
        meta: party.shortName,
        color: party.color,
        value: values[index],
      };
    });
}

function usesPreAnnouncementCandidateSelection(contest: Contest) {
  return contest.view === 'COUNCIL' || contest.view === 'REPRESENTATIVE';
}

export function getForecastInputMode(contest: Contest, phase: CandidatePhase) {
  return usesPreAnnouncementCandidateSelection(contest) || phase === 'candidate'
    ? 'candidate'
    : 'party';
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

type ForecastOption = {
  id: string;
  label: string;
  sub: string;
  color: string;
  number: number | null;
};

function getForecastOptions(contest: Contest, phase: CandidatePhase): ForecastOption[] {
  if (getForecastInputMode(contest, phase) === 'party')
    return parties.map((party) => ({
      id: party.id,
      label: party.shortName,
      sub: party.name,
      color: party.color,
      number: null,
    }));
  return getMockCandidates(contest).map((candidate) => {
    const party = getParty(candidate.partyId);
    return {
      id: candidate.id,
      label: candidate.name,
      sub: party.shortName,
      color: party.color,
      number: candidate.number,
    };
  });
}

function tintChoice(hex: string) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  return `rgb(${channels.map((channel) => Math.round(250 + (channel - 250) * 0.09)).join(' ')})`;
}

export function ForecastForm({
  contest,
  onSubmitted,
}: {
  contest: Contest;
  onSubmitted: (picked: string[]) => void;
}) {
  const { phase } = usePrototype();
  const options = getForecastOptions(contest, phase);
  const byNumber = getForecastInputMode(contest, phase) === 'candidate';
  const singleSeat = contest.seatCount === 1;
  const [picks, setPicks] = useState<string[]>([]);
  const isValid = picks.length === contest.seatCount;

  function toggle(id: string) {
    setPicks((current) =>
      singleSeat
        ? [id]
        : current.includes(id)
          ? current.filter((pick) => pick !== id)
          : current.length < contest.seatCount
            ? [...current, id]
            : current,
    );
  }

  function submit() {
    if (!isValid) return;
    onSubmitted(
      picks.map((id) => options.find((option) => option.id === id)?.label ?? '').filter(Boolean),
    );
  }

  return (
    <>
      <div className="forecast-body">
        <h3>{singleSeat ? '你認為誰會勝出？' : `預測 ${contest.seatCount} 個當選席次`}</h3>
        <p className={`forecast-counter ${isValid ? 'done' : ''}`}>
          {isValid && <Icon name="check" />}
          {singleSeat
            ? isValid
              ? '已選好'
              : '請選擇一項'
            : `${picks.length} / ${contest.seatCount} 席`}
        </p>
        <p className="forecast-notice">
          <i />
          {usesPreAnnouncementCandidateSelection(contest)
            ? '正式候選人名單尚未公告，以下為黨籍示意候選人。'
            : byNumber
              ? '官方候選人名單已匯入。'
              : '候選人名單尚未公布，目前以政黨進行預測。'}
        </p>
        <div className="forecast-options">
          {options.map((option) => {
            const selected = picks.includes(option.id);
            return (
              <label
                className={selected ? 'selected' : ''}
                key={option.id}
                style={
                  selected
                    ? { background: tintChoice(option.color), borderColor: option.color }
                    : undefined
                }
              >
                <input
                  checked={selected}
                  name={singleSeat ? `forecast-${contest.id}` : undefined}
                  onChange={() => toggle(option.id)}
                  type={singleSeat ? 'radio' : 'checkbox'}
                />
                <span
                  className="forecast-mark"
                  style={
                    byNumber
                      ? selected
                        ? { borderColor: option.color }
                        : undefined
                      : { background: option.color, borderColor: option.color, color: '#fffdf8' }
                  }
                >
                  {option.number}
                </span>
                <span className="forecast-option-text">
                  <strong>{option.label}</strong>
                  <small>
                    {byNumber && <i style={{ background: option.color }} />}
                    {option.sub}
                  </small>
                </span>
                <b className="forecast-tick" style={{ background: option.color }}>
                  <Icon name="check" />
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
          disabled={!isValid}
          onClick={submit}
          type="button"
        >
          {isValid
            ? '確認送出'
            : singleSeat
              ? '請先選擇一項'
              : `還要再選 ${contest.seatCount - picks.length} 位`}
          {isValid && <Icon name="chevron" />}
        </button>
      </footer>
    </>
  );
}
