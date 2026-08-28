import { getRegisteredContest } from './contest-registry.js';
import { prisma } from './db.js';
import { describeTarget } from './prediction-targets.js';

/**
 * 趨勢分頁要的是「每天的票數」，但 Prediction 只留最新一版，算不回昨天的樣子。
 * 所以每天把 ContestTally 抄一份進 ContestTallySnapshot。
 *
 * 只抄有票的選區：8,429 個選區 × 4 個目標 × 365 天大半是零，全抄一年就是千萬列。
 */

export function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * 一天一次。用 INSERT ... SELECT 一句寫完，不要把幾萬列拉回 Node 再寫回去。
 * 同一天重跑會覆蓋，所以補跑是安全的。
 */
export async function captureDailySnapshot(capturedOn = today()) {
  return prisma.$executeRaw`
    INSERT INTO "ContestTallySnapshot" ("contestId", "capturedOn", "targetType", "targetId", "count")
    SELECT "contestId", ${capturedOn}::date, "targetType", "targetId", "count"
    FROM "ContestTally"
    WHERE "count" > 0
    ON CONFLICT ("contestId", "capturedOn", "targetType", "targetId")
    DO UPDATE SET "count" = EXCLUDED."count"
  `;
}

export type TrendSeries = {
  targetId: string;
  label: string;
  partyId: string | null;
  color: string | null;
  points: { date: string; count: number }[];
};

/**
 * 一個選區近 N 天的走勢。最後一個點用現在的 ContestTally 而不是昨天的快照，
 * 線的終點才會跟清單上的數字一致。
 */
export async function readTrend(contestId: string, days: number): Promise<TrendSeries[]> {
  const contest = getRegisteredContest(contestId);
  if (!contest) return [];

  const since = new Date(today().getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const [snapshots, live] = await Promise.all([
    prisma.contestTallySnapshot.findMany({
      where: { contestId, capturedOn: { gte: since } },
      orderBy: { capturedOn: 'asc' },
    }),
    prisma.contestTally.findMany({ where: { contestId } }),
  ]);

  const series = new Map<string, TrendSeries>();
  const ensure = (targetType: string, targetId: string) => {
    const existing = series.get(targetId);
    if (existing) return existing;
    const described = describeTarget(contest, targetType, targetId);
    const created: TrendSeries = { targetId, ...described, points: [] };
    series.set(targetId, created);
    return created;
  };

  for (const row of snapshots)
    ensure(row.targetType, row.targetId).points.push({
      date: row.capturedOn.toISOString().slice(0, 10),
      count: row.count,
    });

  const todayIso = today().toISOString().slice(0, 10);
  for (const row of live) {
    if (row.count <= 0) continue;
    const target = ensure(row.targetType, row.targetId);
    const last = target.points[target.points.length - 1];
    if (last?.date === todayIso) last.count = row.count;
    else target.points.push({ date: todayIso, count: row.count });
  }

  return [...series.values()].sort(
    (a, b) =>
      (b.points[b.points.length - 1]?.count ?? 0) - (a.points[a.points.length - 1]?.count ?? 0),
  );
}

/** 今天抄過了沒。cron 每小時問一次，答案是「抄過了」就什麼都不做。 */
export async function hasSnapshotFor(capturedOn = today()) {
  const row = await prisma.contestTallySnapshot.findFirst({ where: { capturedOn } });
  return row !== null;
}
