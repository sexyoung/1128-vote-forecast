import { type Context, Hono } from 'hono';
import type { Prisma } from '../generated/prisma/client.js';
import { getParty, parties } from '../shared/candidates.js';
import { closeAdminSession, openAdminSession, requireAdmin } from './admin-session.js';
import { AnnouncementRejected, getAdminAnnouncement, saveAnnouncement } from './announcement.js';
import {
  CandidateImportRejected,
  importCandidates,
  prepareCandidateImport,
  serializeCandidateCsv,
} from './candidate-import.js';
import {
  CandidateContributionRejected,
  approveCandidateContribution,
  rejectCandidateContribution,
} from './candidate-contributions.js';
import { forecasterCode } from './comments.js';
import {
  type ContestType,
  contestTypes,
  countRegisteredContests,
  getRegisteredContest,
} from './contest-registry.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { dismissReport } from './moderation.js';
import { describeTarget, refreshCandidates } from './prediction-targets.js';
import { cacheDelete, pingRedis } from './redis.js';
import { refreshCandidateVisibility, saveCandidateVisibility } from './site-settings.js';
import {
  candidateRankingsKey,
  commentsKey,
  keysAffectedBy,
  partyCandidatesKey,
  partyCountsKey,
} from './snapshot-keys.js';
import { hasSnapshotFor } from './trends.js';

/**
 * 每一支 /api/admin/* 路由都在這裡，用一個獨立的 Hono 子 app 掛進 app.ts，
 * app.ts 因此不必再長 300 行。這支子 app 自己管認證：/session 是換 cookie
 * 的入口，必須留在 requireAdmin 之外，其餘全部要有後台權限。
 */
export const adminApp = new Hono();

type CommentWithForecaster = Prisma.CommentGetPayload<{
  include: { forecaster: true };
}>;

function toAdminComment(comment: CommentWithForecaster) {
  return {
    id: comment.id,
    body: comment.body,
    status: comment.status,
    contestId: comment.contestId,
    forecaster: {
      id: comment.forecasterId,
      code: forecasterCode(comment.forecasterId),
      displayName: comment.forecaster.displayName,
    },
  };
}

function requestedPage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? '1', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

const forecasterSorts = [
  'predictionCount',
  'commentCount',
  'lastIp',
  'lastLocation',
  'status',
  'createdAt',
  'lastSeenAt',
] as const;
type ForecasterSort = (typeof forecasterSorts)[number];
type SortDirection = 'asc' | 'desc';

function requestedForecasterSort(value: string | undefined): ForecasterSort {
  return forecasterSorts.includes(value as ForecasterSort)
    ? (value as ForecasterSort)
    : 'lastSeenAt';
}

function requestedSortDirection(value: string | undefined): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

function forecasterOrderBy(
  sort: ForecasterSort,
  direction: SortDirection,
): Prisma.ForecasterOrderByWithRelationInput[] {
  switch (sort) {
    case 'predictionCount':
      return [{ predictions: { _count: direction } }, { id: 'asc' }];
    case 'commentCount':
      return [{ comments: { _count: direction } }, { id: 'asc' }];
    case 'lastIp':
      return [{ lastIp: direction }, { id: 'asc' }];
    case 'lastLocation':
      return [
        { lastCountry: direction },
        { lastRegion: direction },
        { lastCity: direction },
        { id: 'asc' },
      ];
    case 'status':
      return [{ blockedAt: direction }, { id: 'asc' }];
    case 'createdAt':
      return [{ createdAt: direction }, { id: 'asc' }];
    case 'lastSeenAt':
      return [{ lastSeenAt: direction }, { id: 'asc' }];
  }
}

// --- 認證 -----------------------------------------------------------------
// 這兩支路由要留在 requireAdmin 之前註冊：Hono 依註冊順序組成 middleware 鏈，
// 這裡的 handler 會直接回應、不呼叫 next()，下面的 requireAdmin 因此永遠不會
// 套用在 /session 上——這正是我們要的，換 cookie 本來就不該先要求已經有 cookie。

adminApp.post('/session', async (c) => {
  if (!env.adminToken) return c.json({ error: '後台未啟用。' }, 503);
  const body = (await c.req.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const ok = await openAdminSession(c, token);
  if (!ok) return c.json({ error: '需要後台權限。' }, 401);
  return c.json({ ok: true });
});

adminApp.delete('/session', (c) => {
  closeAdminSession(c);
  return c.json({ ok: true });
});

adminApp.use('*', requireAdmin);

// --- 總覽 -------------------------------------------------------------------

function emptyByType(): Record<ContestType, number> {
  return Object.fromEntries(contestTypes.map((type) => [type, 0])) as Record<ContestType, number>;
}

adminApp.get('/overview', async (c) => {
  const [
    byStatus,
    totalPredictions,
    contestsWithData,
    latestSnapshot,
    snapshotToday,
    candidateGroups,
    redisAlive,
  ] = await Promise.all([
    prisma.prediction.groupBy({ by: ['status'], _count: true }),
    prisma.prediction.count(),
    prisma.contestSummary.count({ where: { totalPredictions: { gt: 0 } } }),
    prisma.contestTallySnapshot.aggregate({ _max: { capturedOn: true } }),
    hasSnapshotFor(),
    prisma.candidate.groupBy({ by: ['contestId'], _count: true }),
    pingRedis(300),
  ]);

  const candidatesByType = emptyByType();
  for (const group of candidateGroups) {
    const contest = getRegisteredContest(group.contestId);
    if (contest) candidatesByType[contest.type] += 1;
  }

  return c.json({
    predictions: {
      total: totalPredictions,
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
    },
    contestsWithData,
    totalContests: countRegisteredContests(),
    snapshot: {
      latestCapturedOn: latestSnapshot._max.capturedOn,
      capturedToday: snapshotToday,
    },
    candidateCoverage: {
      // 「有名單的選區數」跟「全部選區數」放在一起回，畫面才不必自己去別的欄位
      // 湊分母就能算出公告進度。
      contestsWithCandidates: candidateGroups.length,
      totalContests: countRegisteredContests(),
      byType: candidatesByType,
    },
    // 上面的 Prisma 查詢全部成功才會走到這裡；失敗時整支端點會回 500。
    database: { reachable: true },
    // 包成物件而不是裸 boolean：之後要加延遲或錯誤訊息時不必改動前端的形狀。
    redis: { reachable: redisAlive },
  });
});

// --- 預測使用者 -------------------------------------------------------------

adminApp.get('/forecasters', async (c) => {
  const page = requestedPage(c.req.query('page'));
  const sort = requestedForecasterSort(c.req.query('sort'));
  const direction = requestedSortDirection(c.req.query('direction'));
  const pageSize = 50;
  const [total, forecasters] = await Promise.all([
    prisma.forecaster.count(),
    prisma.forecaster.findMany({
      orderBy: forecasterOrderBy(sort, direction),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        displayName: true,
        blockedAt: true,
        createdAt: true,
        lastSeenAt: true,
        lastIp: true,
        lastIpAt: true,
        lastCountry: true,
        lastRegion: true,
        lastCity: true,
        lastGeoSource: true,
        _count: { select: { predictions: true, comments: true } },
        predictions: {
          where: { status: 'ACTIVE' },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: 1,
          select: {
            contestId: true,
            picks: { select: { targetType: true, targetId: true } },
          },
        },
      },
    }),
  ]);

  return c.json({
    items: forecasters.map(({ _count, predictions, ...forecaster }) => {
      const latestPrediction = predictions[0];
      const contest = latestPrediction ? getRegisteredContest(latestPrediction.contestId) : null;
      return {
        ...forecaster,
        code: forecasterCode(forecaster.id),
        predictionCount: _count.predictions,
        commentCount: _count.comments,
        latestVote: latestPrediction
          ? {
              contestId: latestPrediction.contestId,
              labels: latestPrediction.picks.map((pick) =>
                pick.targetType === 'PARTY'
                  ? getParty(pick.targetId as never).shortName
                  : contest
                    ? describeTarget(contest, pick.targetType, pick.targetId).label
                    : pick.targetId,
              ),
            }
          : null,
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sort,
    direction,
  });
});

adminApp.get('/forecasters/:forecasterId', async (c) => {
  const forecaster = await prisma.forecaster.findUnique({
    where: { id: c.req.param('forecasterId') },
    select: {
      id: true,
      displayName: true,
      blockedAt: true,
      humanVerifiedAt: true,
      createdAt: true,
      lastSeenAt: true,
      lastIp: true,
      lastIpAt: true,
      lastCountry: true,
      lastRegion: true,
      lastCity: true,
      lastGeoSource: true,
      signals: {
        orderBy: [{ kind: 'asc' }, { lastSeenAt: 'desc' }],
        select: {
          id: true,
          kind: true,
          hash: true,
          firstSeenAt: true,
          lastSeenAt: true,
          seenCount: true,
        },
      },
      _count: {
        select: {
          predictions: true,
          comments: true,
          reports: true,
          signals: true,
        },
      },
    },
  });
  if (!forecaster) return c.json({ error: '找不到這個身份。' }, 404);
  const { _count, signals, ...profile } = forecaster;
  return c.json({
    forecaster: {
      ...profile,
      code: forecasterCode(profile.id),
      counts: _count,
      signals: signals.map(({ hash, ...signal }) => ({
        ...signal,
        code: hash.slice(0, 12),
      })),
    },
  });
});

adminApp.get('/forecasters/:forecasterId/predictions', async (c) => {
  const forecasterId = c.req.param('forecasterId');
  const page = requestedPage(c.req.query('page'));
  const pageSize = 50;
  const exists = await prisma.forecaster.count({ where: { id: forecasterId } });
  if (!exists) return c.json({ error: '找不到這個身份。' }, 404);
  const [total, predictions] = await Promise.all([
    prisma.prediction.count({ where: { forecasterId } }),
    prisma.prediction.findMany({
      where: { forecasterId },
      include: { picks: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return c.json({
    items: predictions.map((prediction) => {
      const contest = getRegisteredContest(prediction.contestId);
      return {
        ...prediction,
        contest: contest
          ? {
              id: contest.id,
              name: contest.name,
              area: contest.area,
              type: contest.type,
            }
          : null,
        picks: prediction.picks.map((pick) => ({
          ...pick,
          ...(contest
            ? describeTarget(contest, pick.targetType, pick.targetId)
            : { label: pick.targetId, partyId: pick.partyId, color: null }),
        })),
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

adminApp.get('/forecasters/:forecasterId/comments', async (c) => {
  const forecasterId = c.req.param('forecasterId');
  const page = requestedPage(c.req.query('page'));
  const pageSize = 50;
  const exists = await prisma.forecaster.count({ where: { id: forecasterId } });
  if (!exists) return c.json({ error: '找不到這個身份。' }, 404);
  const [total, comments] = await Promise.all([
    prisma.comment.count({ where: { forecasterId } }),
    prisma.comment.findMany({
      where: { forecasterId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        contestId: true,
        parentId: true,
        body: true,
        status: true,
        createdAt: true,
        _count: { select: { replies: true } },
      },
    }),
  ]);

  return c.json({
    items: comments.map(({ _count, ...comment }) => {
      const contest = getRegisteredContest(comment.contestId);
      return {
        ...comment,
        replyCount: _count.replies,
        contest: contest ? { id: contest.id, name: contest.name, area: contest.area } : null,
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

// --- 候選人 CSV ------------------------------------------------------------

adminApp.get('/candidate-visibility', async (c) => {
  const [settings, placeholderCount] = await Promise.all([
    refreshCandidateVisibility(true),
    prisma.candidate.count({ where: { id: { contains: '-CANDIDATE-' } } }),
  ]);
  return c.json({ ...settings, placeholderCount });
});

adminApp.put('/candidate-visibility', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    hidePlaceholderCandidates?: unknown;
  } | null;
  if (typeof body?.hidePlaceholderCandidates !== 'boolean')
    return c.json({ error: '設定值不正確。' }, 400);

  const settings = await saveCandidateVisibility(body.hidePlaceholderCandidates);
  // 同時重新從 PostgreSQL 載入，避免舊的候選人快取讓正式名單被誤認成不存在。
  await refreshCandidates(true);
  return c.json({ ...settings });
});

adminApp.get('/candidates', async (c) => {
  const candidates = await prisma.candidate.findMany({
    where: {
      NOT: { id: { contains: '-CANDIDATE-' } },
      status: { in: ['REGISTERED', 'CONFIRMED'] },
    },
    select: { id: true, contestId: true, name: true, partyId: true },
    orderBy: [{ contestId: 'asc' }, { ballotNo: 'asc' }, { name: 'asc' }],
  });

  return c.json({
    candidates: candidates.map((candidate) => {
      const contest = getRegisteredContest(candidate.contestId);
      return {
        ...candidate,
        contestName: contest?.name ?? candidate.contestId,
        contestType: contest?.type ?? null,
      };
    }),
  });
});

adminApp.get('/candidates/export', async (c) => {
  const candidates = await prisma.candidate.findMany({
    where: { NOT: { id: { contains: '-CANDIDATE-' } } },
    select: {
      id: true,
      contestId: true,
      name: true,
      partyId: true,
      ballotNo: true,
      status: true,
    },
    orderBy: [{ contestId: 'asc' }, { ballotNo: 'asc' }, { name: 'asc' }],
  });
  const csv = serializeCandidateCsv(candidates);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${date}-candidate-import.csv"`);
  return c.body(csv);
});

async function rebuildContestTallies(tx: Prisma.TransactionClient, contestId: string) {
  const contest = getRegisteredContest(contestId);
  if (!contest) return;
  const [picks, totalPredictions] = await Promise.all([
    tx.predictionPick.findMany({
      where: { prediction: { contestId, status: 'ACTIVE' } },
      select: { targetType: true, targetId: true },
    }),
    tx.prediction.count({ where: { contestId, status: 'ACTIVE' } }),
  ]);
  const counts = new Map<
    string,
    { targetType: 'PARTY' | 'CANDIDATE'; targetId: string; count: number }
  >();
  for (const pick of picks) {
    const key = `${pick.targetType}\0${pick.targetId}`;
    const row = counts.get(key);
    if (row) row.count += 1;
    else counts.set(key, { ...pick, count: 1 });
  }
  const rows = [...counts.values()].sort(
    (left, right) => right.count - left.count || left.targetId.localeCompare(right.targetId),
  );
  await tx.contestTally.deleteMany({ where: { contestId } });
  if (rows.length)
    await tx.contestTally.createMany({
      data: rows.map((row) => ({ contestId, ...row })),
    });
  if (!totalPredictions) {
    await tx.contestSummary.deleteMany({ where: { contestId } });
    return;
  }
  const leader = rows[0] ?? null;
  const totalPicks = picks.length;
  const summary = {
    jurisdictionId: contest.jurisdictionId,
    totalPredictions,
    leaderType: leader?.targetType ?? null,
    leaderId: leader?.targetId ?? null,
    leaderPercent: leader ? Math.round((leader.count / totalPicks) * 100) : null,
  };
  await tx.contestSummary.upsert({
    where: { contestId },
    create: { contestId, ...summary },
    update: summary,
  });
}

async function invalidateCandidatePredictions(
  tx: Prisma.TransactionClient,
  candidateId: string,
  contestId: string,
  invalidReason: 'DISTRICT_CHANGED' | 'ADMIN_INVALIDATED',
) {
  const predictions = await tx.prediction.findMany({
    where: {
      contestId,
      status: 'ACTIVE',
      picks: { some: { targetType: 'CANDIDATE', targetId: candidateId } },
    },
    select: { id: true },
  });
  if (predictions.length)
    await tx.prediction.updateMany({
      where: { id: { in: predictions.map(({ id }) => id) } },
      data: { status: 'INVALIDATED', invalidReason },
    });
  await rebuildContestTallies(tx, contestId);
}

async function refreshCandidateAdminCaches(contestIds: string[], partyIds: (string | null)[]) {
  await refreshCandidates(true);
  await cacheDelete(
    candidateRankingsKey(),
    partyCountsKey(),
    ...[...new Set(partyIds.map((partyId) => partyId ?? 'IND'))].map(partyCandidatesKey),
    ...[...new Set(contestIds)].flatMap((contestId) => {
      const contest = getRegisteredContest(contestId);
      return contest ? keysAffectedBy(contest.id, contest.jurisdictionId) : [];
    }),
  );
}

adminApp.patch('/candidates/:candidateId', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    name?: unknown;
    contestId?: unknown;
    partyId?: unknown;
  } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const contestId = typeof body?.contestId === 'string' ? body.contestId.trim() : '';
  const partyId = body?.partyId === null || body?.partyId === 'IND' ? null : body?.partyId;
  if (!name || name.length > 40) return c.json({ error: '姓名必須是 1–40 個字。' }, 400);
  if (!getRegisteredContest(contestId)) return c.json({ error: '找不到這個選區。' }, 400);
  if (typeof partyId !== 'string' && partyId !== null)
    return c.json({ error: '政黨代號不正確。' }, 400);
  if (partyId && !parties.some(({ id }) => id === partyId))
    return c.json({ error: '找不到這個政黨。' }, 400);

  const candidateId = c.req.param('candidateId');
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });
  if (!candidate) return c.json({ error: '找不到這位候選人。' }, 404);
  const duplicate = await prisma.candidate.findFirst({
    where: { id: { not: candidateId }, contestId, name },
    select: { id: true },
  });
  if (duplicate) return c.json({ error: '該選區已有同名候選人。' }, 409);

  const moved = candidate.contestId !== contestId;
  const updated = await prisma.$transaction(async (tx) => {
    if (moved)
      await invalidateCandidatePredictions(
        tx,
        candidateId,
        candidate.contestId,
        'DISTRICT_CHANGED',
      );
    const result = await tx.candidate.update({
      where: { id: candidateId },
      data: { name, contestId, partyId, ...(moved ? { ballotNo: null } : {}) },
    });
    if (candidate.partyId !== partyId)
      await tx.predictionPick.updateMany({
        where: { targetType: 'CANDIDATE', targetId: candidateId },
        data: { partyId },
      });
    if (moved)
      await tx.candidateContribution.updateMany({
        where: { candidateId, status: 'PENDING' },
        data: { contestId },
      });
    return result;
  });
  await refreshCandidateAdminCaches([candidate.contestId, contestId], [candidate.partyId, partyId]);
  return c.json({ candidate: updated });
});

adminApp.delete('/candidates/:candidateId', async (c) => {
  const candidateId = c.req.param('candidateId');
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });
  if (!candidate) return c.json({ error: '找不到這位候選人。' }, 404);
  await prisma.$transaction(async (tx) => {
    await invalidateCandidatePredictions(tx, candidateId, candidate.contestId, 'ADMIN_INVALIDATED');
    await tx.candidateContribution.updateMany({
      where: { candidateId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedBy: 'admin',
        reviewNote: '候選人已由後台刪除。',
      },
    });
    await tx.candidate.delete({ where: { id: candidateId } });
  });
  await refreshCandidateAdminCaches([candidate.contestId], [candidate.partyId]);
  return c.json({ ok: true });
});

async function readCandidateCsv(c: Context) {
  const csv = await c.req.text();
  if (new TextEncoder().encode(csv).byteLength > 2_000_000)
    throw new CandidateImportRejected('CSV 不可超過 2 MB。');
  return csv;
}

adminApp.post('/candidates/import/preview', async (c) => {
  try {
    const plan = await prepareCandidateImport(await readCandidateCsv(c));
    return c.json({
      summary: plan.summary,
      rows: plan.rows.slice(0, 100),
      updates: plan.updates,
    });
  } catch (error) {
    if (error instanceof CandidateImportRejected) return c.json({ error: error.message }, 400);
    throw error;
  }
});

adminApp.post('/candidates/import', async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as {
      csv?: unknown;
      replaceCodes?: unknown;
    } | null;
    if (
      typeof body?.csv !== 'string' ||
      !Array.isArray(body.replaceCodes) ||
      body.replaceCodes.some((code) => typeof code !== 'string')
    )
      throw new CandidateImportRejected('匯入確認內容不完整。');
    if (new TextEncoder().encode(body.csv).byteLength > 2_000_000)
      throw new CandidateImportRejected('CSV 不可超過 2 MB。');
    return c.json({
      summary: await importCandidates(body.csv, body.replaceCodes as string[]),
    });
  } catch (error) {
    if (error instanceof CandidateImportRejected) return c.json({ error: error.message }, 400);
    throw error;
  }
});

// --- 使用者候選人提案 -------------------------------------------------------

adminApp.get('/candidate-contributions', async (c) => {
  const contributions = await prisma.candidateContribution.findMany({
    where: { status: 'PENDING' },
    include: { forecaster: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const existingIds = contributions
    .filter(({ kind }) => kind === 'PHOTO_UPDATE')
    .map(({ candidateId }) => candidateId);
  const candidates = existingIds.length
    ? await prisma.candidate.findMany({
        where: { id: { in: existingIds } },
        select: { id: true, name: true, partyId: true },
      })
    : [];
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  return c.json({
    contributions: contributions.map((contribution) => {
      const existing = candidateById.get(contribution.candidateId);
      return {
        id: contribution.id,
        kind: contribution.kind,
        contestId: contribution.contestId,
        contestName: getRegisteredContest(contribution.contestId)?.name ?? contribution.contestId,
        candidateId: contribution.candidateId,
        candidateName: contribution.candidateName ?? existing?.name ?? '原候選人已不存在',
        partyId: contribution.partyId ?? existing?.partyId ?? null,
        photoUrl: contribution.photoUrl,
        createdAt: contribution.createdAt,
        forecaster: {
          code: forecasterCode(contribution.forecaster.id),
          displayName: contribution.forecaster.displayName,
        },
      };
    }),
  });
});

adminApp.post('/candidate-contributions/:contributionId/approve', async (c) => {
  try {
    const result = await approveCandidateContribution(c.req.param('contributionId'));
    c.header('Content-Disposition', `attachment; filename="${result.photoFile}"`);
    c.header('Content-Type', 'image/webp');
    c.header('X-Photo-File', result.photoFile);
    return c.body(result.webp);
  } catch (error) {
    if (error instanceof CandidateContributionRejected)
      return c.json({ error: error.message }, 400);
    throw error;
  }
});

adminApp.post('/candidate-contributions/:contributionId/reject', async (c) => {
  try {
    await rejectCandidateContribution(c.req.param('contributionId'));
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof CandidateContributionRejected)
      return c.json({ error: error.message }, 400);
    throw error;
  }
});

// --- 留言檢舉（既有三支移過來，加一支駁回） -----------------------------------

adminApp.get('/reports', async (c) => {
  const [reports, hiddenComments, blockedForecasters] = await Promise.all([
    prisma.report.findMany({
      where: { status: 'OPEN', targetType: 'COMMENT' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    prisma.comment.findMany({
      where: { status: 'HIDDEN' },
      include: { forecaster: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.forecaster.findMany({
      where: { blockedAt: { not: null } },
      select: { id: true, displayName: true, blockedAt: true },
      orderBy: { blockedAt: 'desc' },
      take: 100,
    }),
  ]);
  const comments = await prisma.comment.findMany({
    where: {
      id: { in: [...new Set(reports.map((report) => report.targetId))] },
    },
    include: { forecaster: true },
  });
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));

  return c.json({
    reports: reports.map((report) => {
      const comment = commentById.get(report.targetId);
      return {
        ...report,
        comment: comment ? toAdminComment(comment) : null,
      };
    }),
    hiddenComments: hiddenComments.map(toAdminComment),
    blockedForecasters: blockedForecasters.map((forecaster) => ({
      ...forecaster,
      code: forecasterCode(forecaster.id),
    })),
  });
});

adminApp.post('/comments/:commentId/hide', async (c) => {
  const commentId = c.req.param('commentId');
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) return c.json({ error: '找不到這則留言。' }, 404);

  await prisma.$transaction([
    prisma.comment.update({
      where: { id: commentId },
      data: { status: 'HIDDEN' },
    }),
    prisma.report.updateMany({
      where: { targetType: 'COMMENT', targetId: commentId, status: 'OPEN' },
      data: { status: 'ACTIONED', handledAt: new Date() },
    }),
  ]);
  await cacheDelete(commentsKey(comment.contestId));
  return c.json({ ok: true });
});

adminApp.post('/comments/:commentId/restore', async (c) => {
  const comment = await prisma.comment.findFirst({
    where: { id: c.req.param('commentId'), status: 'HIDDEN' },
  });
  if (!comment) return c.json({ error: '找不到已隱藏的留言。' }, 404);

  await prisma.comment.update({
    where: { id: comment.id },
    data: { status: 'VISIBLE' },
  });
  await cacheDelete(commentsKey(comment.contestId));
  return c.json({ ok: true });
});

adminApp.post('/reports/:reportId/dismiss', async (c) => {
  const ok = await dismissReport(c.req.param('reportId'));
  if (!ok) return c.json({ error: '找不到這則檢舉，或已經處理過了。' }, 404);
  return c.json({ ok: true });
});

adminApp.post('/forecasters/:forecasterId/block', async (c) => {
  await prisma.forecaster.update({
    where: { id: c.req.param('forecasterId') },
    data: { blockedAt: new Date() },
  });
  return c.json({ ok: true });
});

adminApp.post('/forecasters/:forecasterId/unblock', async (c) => {
  const result = await prisma.forecaster.updateMany({
    where: { id: c.req.param('forecasterId'), blockedAt: { not: null } },
    data: { blockedAt: null },
  });
  if (!result.count) return c.json({ error: '找不到已封鎖的身份。' }, 404);
  return c.json({ ok: true });
});

// --- 全站公告 ---------------------------------------------------------------

adminApp.get('/announcement', async (c) => c.json({ announcement: await getAdminAnnouncement() }));

adminApp.put('/announcement', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    title?: unknown;
    body?: unknown;
    linkUrl?: unknown;
    linkLabel?: unknown;
    published?: unknown;
  } | null;

  try {
    const { row, versionBumped } = await saveAnnouncement({
      title: typeof body?.title === 'string' ? body.title : '',
      body: typeof body?.body === 'string' ? body.body : '',
      linkUrl: typeof body?.linkUrl === 'string' ? body.linkUrl : null,
      linkLabel: typeof body?.linkLabel === 'string' ? body.linkLabel : null,
      published: body?.published === true,
    });
    return c.json({ announcement: row, versionBumped });
  } catch (error) {
    if (error instanceof AnnouncementRejected) return c.json({ error: error.message }, 400);
    throw error;
  }
});
