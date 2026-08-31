import { jurisdictions } from '../client/mock-election.js';
import {
  type ContestType,
  getRegisteredContest,
  getRegisteredContests,
} from './contest-registry.js';
import { prisma } from './db.js';
import { describeTarget } from './prediction-targets.js';
import { readContestTally } from './predictions.js';
import { cacheGet, cacheSet, takeTrackedKeys, trackKey } from './redis.js';
import { contestKey, jurisdictionKey, nationalKey } from './snapshot-keys.js';
import { isVisibleCandidateId } from './site-settings.js';

/**
 * 地圖首頁一次要 22 個縣市的領先者，下鑽還要幾百個選區——每次都 COUNT 會拖垮
 * 資料庫。所以聚合結果都先算好放進 Redis，請求只讀快照。
 *
 * 快照是 cache-aside ＋ 主動重算的混合：讀不到就當場算並寫回，同時把 key 記進
 * 一個追蹤集合；cron 每分鐘只重算集合裡的 key。這樣熱門的縣市永遠是新的，沒人
 * 看的村里層不會為了沒人看的數字每分鐘掃 7,780 個選區。
 */

const hotKeys = 'snap:hot';
const snapshotTtlSeconds = 90;

export type MapCell = {
  contestId: string;
  /** 領先者的黨籍。地圖只要顏色，不需要是誰。 */
  party: string | null;
  percent: number;
  total: number;
};

function toCell(summary: {
  contestId: string;
  leaderType: string | null;
  leaderId: string | null;
  leaderPercent: number | null;
  totalPredictions: number;
}): MapCell | null {
  const contest = getRegisteredContest(summary.contestId);
  if (!contest) return null;
  if (
    summary.leaderType === 'CANDIDATE' &&
    summary.leaderId &&
    !isVisibleCandidateId(summary.leaderId)
  )
    return {
      contestId: summary.contestId,
      party: null,
      percent: 0,
      total: 0,
    };
  const described =
    summary.leaderType && summary.leaderId
      ? describeTarget(contest, summary.leaderType, summary.leaderId)
      : null;
  return {
    contestId: summary.contestId,
    party: described?.partyId ?? null,
    percent: summary.leaderPercent ?? 0,
    total: summary.totalPredictions,
  };
}

async function buildNational(): Promise<MapCell[]> {
  const contestIds = jurisdictions.map((jurisdiction) => `${jurisdiction.id}-EXECUTIVE-1`);
  const summaries = await prisma.contestSummary.findMany({
    where: { contestId: { in: contestIds } },
  });
  return summaries.flatMap((summary) => toCell(summary) ?? []);
}

async function buildJurisdiction(jurisdictionId: string, type: ContestType): Promise<MapCell[]> {
  const ids = getRegisteredContests(jurisdictionId, type).map(({ id }) => id);
  if (ids.length === 0) return [];
  const summaries = await prisma.contestSummary.findMany({ where: { contestId: { in: ids } } });
  return summaries.flatMap((summary) => toCell(summary) ?? []);
}

async function read<T>(key: string, build: () => Promise<T>): Promise<T> {
  await trackKey(hotKeys, key);
  const cached = await cacheGet(key);
  if (cached) return JSON.parse(cached) as T;
  const value = await build();
  await cacheSet(key, JSON.stringify(value), snapshotTtlSeconds);
  return value;
}

export function readNationalMap() {
  return read(nationalKey(), buildNational);
}

export function readJurisdictionMap(jurisdictionId: string, type: ContestType) {
  return read(jurisdictionKey(jurisdictionId, type), () => buildJurisdiction(jurisdictionId, type));
}

/** 單一選區的分布。抽屜與卡片打的是這一個。 */
export function readContestSnapshot(contestId: string) {
  return read(contestKey(contestId), async () => {
    const contest = getRegisteredContest(contestId);
    const tally = await readContestTally(contestId);
    return {
      ...tally,
      rows: tally.rows.map((row) => ({
        ...row,
        ...(contest
          ? describeTarget(contest, row.targetType, row.targetId)
          : { label: row.targetId, partyId: null, color: null }),
      })),
    };
  });
}

/** key 長什麼樣就知道要怎麼重算，cron 不必自己記清單。 */
async function rebuild(key: string) {
  if (key === nationalKey()) {
    await cacheSet(key, JSON.stringify(await buildNational()), snapshotTtlSeconds);
    return;
  }
  const map = /^snap:map:([A-Z]+):([A-Z]+):cv:/.exec(key);
  if (map) {
    const value = await buildJurisdiction(map[1], map[2] as ContestType);
    await cacheSet(key, JSON.stringify(value), snapshotTtlSeconds);
    return;
  }
  // 選區層的快照留給 cache-aside：它在寫預測時就被清掉了，重算沒有意義。
}

/**
 * cron 的內容。只重算「這一輪有人讀過」的 key——追蹤集合取出後就清空，沒人再讀
 * 的 key 下一輪自然不在裡面。國情地圖永遠重算，那是首頁。
 */
export async function refreshHotSnapshots() {
  const tracked = await takeTrackedKeys(hotKeys);
  const keys = [...new Set([nationalKey(), ...tracked])];
  for (const key of keys) await rebuild(key);
  return keys;
}
