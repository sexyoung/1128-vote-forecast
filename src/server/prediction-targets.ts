import { type Contest, getMockCandidates, getParty, parties } from '../client/mock-election.js';
import { getPredictionMode } from '../shared/prediction.js';
import type { RegisteredContest } from './contest-registry.js';

/**
 * 一場選舉現在可以押哪些目標。
 *
 * 中選會的候選人名單要到 2026-11 才公告，在那之前 getMockCandidates() 會依選區
 * 產生固定的佔位人選（「國民黨候選人 1」）。這裡刻意 import 前端那支同一個函式：
 * 它是純函式、結果只由選區決定，兩邊算出來一定一樣，伺服器才驗得了前端送來的
 * targetId。名單進來之後這裡改讀 Candidate 資料表，其餘不動。
 */

export type PredictionTarget = {
  targetType: 'PARTY' | 'CANDIDATE';
  targetId: string;
  /** 押的那一位的黨籍。名單公布後靠它把佔位預測對回真候選人。 */
  partyId: string | null;
  label: string;
  ballotNo: number | null;
};

/** 名單還沒進來。之後這裡會變成「這個選區有沒有 Candidate 資料」。 */
const candidatesPublished = false;

/** getMockCandidates 需要一個 Contest；清冊只有選區的骨架，補齊它用不到的欄位。 */
function toContest(contest: RegisteredContest): Contest {
  return {
    id: contest.id,
    jurisdictionId: contest.jurisdictionId,
    name: contest.name,
    area: contest.area,
    seatCount: contest.seats,
    view: contest.type,
    // 下面三個只影響畫面上的示意數字，不影響候選人名單。
    leader: 'KMT',
    percentage: 0,
    forecasts: 0,
  };
}

export function getPredictionTargets(contest: RegisteredContest): PredictionTarget[] {
  const mode = getPredictionMode(contest.type, contest.seats, candidatesPublished);
  if (mode === 'party')
    return parties.map((party) => ({
      targetType: 'PARTY' as const,
      targetId: party.id,
      partyId: party.id,
      label: party.shortName,
      ballotNo: null,
    }));

  return getMockCandidates(toContest(contest)).map((candidate) => ({
    targetType: 'CANDIDATE' as const,
    targetId: candidate.id,
    partyId: candidate.partyId,
    label: candidate.name,
    ballotNo: candidate.number,
  }));
}

/**
 * 把前端送來的 targetId 換成要寫進資料庫的東西。認不得就回 null——政黨代號與
 * 候選人 id 都由這裡決定，前端送什麼進來都要對得上這份名單。
 */
export function resolvePredictionTarget(contest: RegisteredContest, targetId: string) {
  return getPredictionTargets(contest).find((target) => target.targetId === targetId) ?? null;
}

/** 統計要顯示的名字與顏色。政黨代號查得到就用政黨的，否則用候選人的。 */
export function describeTarget(contest: RegisteredContest, targetType: string, targetId: string) {
  const target = getPredictionTargets(contest).find(
    (item) => item.targetType === targetType && item.targetId === targetId,
  );
  if (target) {
    const party = target.partyId ? getParty(target.partyId as never) : null;
    return { label: target.label, partyId: target.partyId, color: party?.color ?? null };
  }
  // 名單換過之後舊的統計列還在，至少要回得出一個能顯示的東西。
  return { label: targetId, partyId: null, color: null };
}
