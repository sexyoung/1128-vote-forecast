import { type Context, Hono } from 'hono';
import type { Prisma } from '../generated/prisma/client.js';
import { closeAdminSession, openAdminSession, requireAdmin } from './admin-session.js';
import { AnnouncementRejected, getAdminAnnouncement, saveAnnouncement } from './announcement.js';
import {
  CandidateImportRejected,
  importCandidates,
  prepareCandidateImport,
} from './candidate-import.js';
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
import { cacheDelete, pingRedis } from './redis.js';
import { commentsKey } from './snapshot-keys.js';
import { hasSnapshotFor } from './trends.js';

/**
 * 每一支 /api/admin/* 路由都在這裡，用一個獨立的 Hono 子 app 掛進 app.ts，
 * app.ts 因此不必再長 300 行。這支子 app 自己管認證：/session 是換 cookie
 * 的入口，必須留在 requireAdmin 之外，其餘全部要有後台權限。
 */
export const adminApp = new Hono();

type CommentWithForecaster = Prisma.CommentGetPayload<{ include: { forecaster: true } }>;

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

// --- 認證 -----------------------------------------------------------------
// 這兩支路由要留在 requireAdmin 之前註冊：Hono 依註冊順序組成 middleware 鏈，
// 這裡的 handler 會直接回應、不呼叫 next()，下面的 requireAdmin 因此永遠不會
// 套用在 /session 上——這正是我們要的，換 cookie 本來就不該先要求已經有 cookie。

adminApp.post('/session', async (c) => {
  if (!env.adminToken) return c.json({ error: '後台未啟用。' }, 503);
  const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
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

// --- 候選人 CSV ------------------------------------------------------------

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
    candidates: candidates.map((candidate) => ({
      ...candidate,
      contestName: getRegisteredContest(candidate.contestId)?.name ?? candidate.contestId,
    })),
  });
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
    return c.json({ summary: plan.summary, rows: plan.rows.slice(0, 100), updates: plan.updates });
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
    return c.json({ summary: await importCandidates(body.csv, body.replaceCodes as string[]) });
  } catch (error) {
    if (error instanceof CandidateImportRejected) return c.json({ error: error.message }, 400);
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
    where: { id: { in: [...new Set(reports.map((report) => report.targetId))] } },
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
    prisma.comment.update({ where: { id: commentId }, data: { status: 'HIDDEN' } }),
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

  await prisma.comment.update({ where: { id: comment.id }, data: { status: 'VISIBLE' } });
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
