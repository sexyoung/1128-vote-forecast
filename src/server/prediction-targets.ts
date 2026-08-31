import { getParty } from '../shared/candidates.js';
import type { RegisteredContest } from './contest-registry.js';
import { prisma } from './db.js';
import { avatarUrl } from '../client/avatars.js';
import { cacheDelete, cachedGzipJson } from './redis.js';
import { candidateDataKey } from './snapshot-keys.js';

/**
 * 一場選舉現在可以押哪些目標。
 *
 * `prisma/seed.ts` 先把原型的佔位人選寫進 Candidate；正式名單收到後直接替換資料。
 * 資料庫沒有名單時就回傳空陣列，避免不同頁面看到互相矛盾的資料。
 */

export type PredictionTarget = {
  targetType: 'PARTY' | 'CANDIDATE';
  targetId: string;
  /** 押的那一位的黨籍。 */
  partyId: string | null;
  label: string;
  ballotNo: number | null;
  photo: string | null;
};

/** 啟動時一次載入 Candidate；完整名單也只有幾 MB，不需要分頁。 */
let loadedCandidates = new Map<string, PredictionTarget[]>();
/** 撤銷與停止競選的人不在可押名單裡（見 refreshCandidates 的 continue），但舊的
 *  統計列（ContestTally／PredictionPick）還指著他們，describeTarget 要查得到，
 *  不然畫面只能顯示一串 cuid。 */
let byCandidateId = new Map<string, { label: string; partyId: string | null; contestId: string }>();

/** 啟動時載入一次（src/server/index.ts）；名單更新隨新版部署生效。 */
export async function refreshCandidates(force = false) {
  if (force) await cacheDelete(candidateDataKey);
  const rows = await cachedGzipJson(candidateDataKey, 3600, () =>
    prisma.candidate.findMany({
      orderBy: [{ contestId: 'asc' }, { ballotNo: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        contestId: true,
        partyId: true,
        name: true,
        ballotNo: true,
        status: true,
      },
    }),
  );
  const nextTargets = new Map<string, PredictionTarget[]>();
  const nextById = new Map<string, { label: string; partyId: string | null; contestId: string }>();

  for (const row of rows) {
    nextById.set(row.id, {
      label: row.name,
      partyId: row.partyId,
      contestId: row.contestId,
    });
    if (row.status === 'WITHDRAWN' || row.status === 'DISQUALIFIED') continue;
    const list = nextTargets.get(row.contestId) ?? [];
    list.push({
      targetType: 'CANDIDATE',
      targetId: row.id,
      partyId: row.partyId,
      label: row.name,
      ballotNo: row.ballotNo,
      photo: avatarUrl(row.id),
    });
    nextTargets.set(row.contestId, list);
  }

  loadedCandidates = nextTargets;
  byCandidateId = nextById;
  return rows.length;
}

export function getPredictionTargets(contest: RegisteredContest): PredictionTarget[] {
  return loadedCandidates.get(contest.id) ?? [];
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
    return {
      label: target.label,
      partyId: target.partyId,
      color: party?.color ?? null,
      photo: target.photo,
    };
  }

  // 名單換過或候選人撤銷後，舊的統計列還在資料庫裡，至少要回得出名字，
  // 不能只給前端一個 cuid。
  const withdrawn = byCandidateId.get(targetId);
  if (withdrawn) {
    const party = withdrawn.partyId ? getParty(withdrawn.partyId as never) : null;
    return {
      label: withdrawn.label,
      partyId: withdrawn.partyId,
      color: party?.color ?? null,
      photo: avatarUrl(targetId),
    };
  }

  return { label: targetId, partyId: null, color: null, photo: null };
}

export function getCandidateAvatarUrl(contestId: string, candidateId: string) {
  const candidate = byCandidateId.get(candidateId);
  if (!candidate || candidate.contestId !== contestId) return null;
  return avatarUrl(candidateId);
}
