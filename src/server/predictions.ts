import type { PredictionTargetType } from '../generated/prisma/client.js';
import type { RegisteredContest } from './contest-registry.js';
import { prisma } from './db.js';
import { resolvePredictionTarget } from './prediction-targets.js';
import { cacheDelete } from './redis.js';

export type StoredPick = {
  targetType: PredictionTargetType;
  targetId: string;
  partyId: string | null;
};

export class PredictionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredictionRejected';
  }
}

/**
 * 檢查前端送來的一組 targetId。錯的東西要在進 transaction 之前就擋掉，
 * 免得白開一個交易。
 */
export function validatePicks(contest: RegisteredContest, targetIds: string[]): StoredPick[] {
  if (targetIds.length !== contest.seats)
    throw new PredictionRejected(`這一區應選 ${contest.seats} 席，要剛好選 ${contest.seats} 位。`);

  if (new Set(targetIds).size !== targetIds.length)
    throw new PredictionRejected('同一位不能選兩次。');

  return targetIds.map((targetId) => {
    const target = resolvePredictionTarget(contest, targetId);
    if (!target) throw new PredictionRejected(`${targetId} 不在這一區的名單裡。`);
    return { targetType: target.targetType, targetId: target.targetId, partyId: target.partyId };
  });
}

function pickKey(pick: { targetType: string; targetId: string }) {
  return `${pick.targetType}:${pick.targetId}`;
}

/** 一個選區的所有目標票數，順序固定（高的在前，同票用 targetId 排）。 */
async function readTallies(tx: typeof prisma, contestId: string) {
  const rows = await tx.contestTally.findMany({ where: { contestId } });
  return rows
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.targetId.localeCompare(b.targetId));
}

/**
 * 送出或修改一筆預測。整段在同一個 transaction 裡：預測、明細、統計三者不能
 * 只成功一半，否則地圖上的數字會跟實際預測對不起來。
 */
export async function savePrediction(
  forecasterId: string,
  contest: RegisteredContest,
  targetIds: string[],
) {
  const picks = validatePicks(contest, targetIds);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.prediction.findUnique({
      where: { forecasterId_contestId: { forecasterId, contestId: contest.id } },
      include: { picks: true },
    });

    const before = new Map(existing?.picks.map((pick) => [pickKey(pick), pick]) ?? []);
    const after = new Map(picks.map((pick) => [pickKey(pick), pick]));

    const added = picks.filter((pick) => !before.has(pickKey(pick)));
    const removed = (existing?.picks ?? []).filter((pick) => !after.has(pickKey(pick)));

    let prediction = existing;
    if (existing) {
      // 舊的那一組先收進 revision，再覆蓋。稽核與「改過幾次」都靠它。
      await tx.predictionRevision.create({
        data: {
          predictionId: existing.id,
          version: existing.version,
          picks: existing.picks.map(({ targetType, targetId, partyId }) => ({
            targetType,
            targetId,
            partyId,
          })),
        },
      });
      await tx.predictionPick.deleteMany({ where: { predictionId: existing.id } });
      prediction = await tx.prediction.update({
        where: { id: existing.id },
        data: {
          seatCount: contest.seats,
          status: 'ACTIVE',
          invalidReason: null,
          version: { increment: 1 },
          picks: { create: picks },
        },
        include: { picks: true },
      });
    } else {
      prediction = await tx.prediction.create({
        data: {
          forecasterId,
          contestId: contest.id,
          seatCount: contest.seats,
          picks: { create: picks },
        },
        include: { picks: true },
      });
    }

    // 依 targetId 排序後再逐一更新：多個請求同時改同一區時，鎖的順序一致才不會
    // 互相卡死。
    const deltas = [
      ...added.map((pick) => ({ pick, delta: 1 })),
      ...removed.map((pick) => ({ pick, delta: -1 })),
    ].sort((a, b) => pickKey(a.pick).localeCompare(pickKey(b.pick)));

    for (const { pick, delta } of deltas) {
      await tx.contestTally.upsert({
        where: {
          contestId_targetType_targetId: {
            contestId: contest.id,
            targetType: pick.targetType,
            targetId: pick.targetId,
          },
        },
        create: {
          contestId: contest.id,
          targetType: pick.targetType,
          targetId: pick.targetId,
          count: Math.max(0, delta),
        },
        update: { count: { increment: delta } },
      });
    }

    const tallies = await readTallies(tx as typeof prisma, contest.id);
    const totalPicks = tallies.reduce((total, row) => total + row.count, 0);
    const leader = tallies[0] ?? null;
    const totalPredictions =
      (await tx.contestSummary.findUnique({ where: { contestId: contest.id } }))
        ?.totalPredictions ?? 0;
    const nextTotal = existing ? totalPredictions : totalPredictions + 1;

    await tx.contestSummary.upsert({
      where: { contestId: contest.id },
      create: {
        contestId: contest.id,
        jurisdictionId: contest.jurisdictionId,
        totalPredictions: nextTotal,
        leaderType: leader?.targetType ?? null,
        leaderId: leader?.targetId ?? null,
        leaderPercent:
          leader && totalPicks > 0 ? Math.round((leader.count / totalPicks) * 100) : null,
      },
      update: {
        jurisdictionId: contest.jurisdictionId,
        totalPredictions: nextTotal,
        leaderType: leader?.targetType ?? null,
        leaderId: leader?.targetId ?? null,
        leaderPercent:
          leader && totalPicks > 0 ? Math.round((leader.count / totalPicks) * 100) : null,
      },
    });

    return { prediction, created: !existing };
  });

  // commit 之後才清快照。順序反過來的話，快照會抓到還沒 commit 的舊值。
  await cacheDelete(
    `snap:contest:${contest.id}`,
    `snap:map:national`,
    `snap:map:${contest.jurisdictionId}:township`,
    `snap:map:${contest.jurisdictionId}:village`,
  );

  return result;
}

/** 一個選區目前的分布，給抽屜與卡片用。 */
export async function readContestTally(contestId: string) {
  const [tallies, summary] = await Promise.all([
    readTallies(prisma, contestId),
    prisma.contestSummary.findUnique({ where: { contestId } }),
  ]);
  const totalPicks = tallies.reduce((total, row) => total + row.count, 0);
  return {
    totalPredictions: summary?.totalPredictions ?? 0,
    totalPicks,
    rows: tallies.map((row) => ({
      targetType: row.targetType,
      targetId: row.targetId,
      count: row.count,
      percent: totalPicks > 0 ? Math.round((row.count / totalPicks) * 100) : 0,
    })),
  };
}

export async function readMyPrediction(forecasterId: string, contestId: string) {
  const prediction = await prisma.prediction.findUnique({
    where: { forecasterId_contestId: { forecasterId, contestId } },
    include: { picks: true },
  });
  if (!prediction) return null;
  return {
    contestId,
    status: prediction.status,
    version: prediction.version,
    updatedAt: prediction.updatedAt,
    targetIds: prediction.picks.map(({ targetId }) => targetId),
  };
}
