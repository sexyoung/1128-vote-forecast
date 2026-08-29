import { Hono } from 'hono';
import { closeAdminSession, openAdminSession, requireAdmin } from './admin-session.js';
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

// --- 留言檢舉（既有三支移過來，加一支駁回） -----------------------------------

adminApp.get('/reports', async (c) => {
  const reports = await prisma.report.findMany({
    where: { status: 'OPEN', targetType: 'COMMENT' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const comments = await prisma.comment.findMany({
    where: { id: { in: [...new Set(reports.map((report) => report.targetId))] } },
  });
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));

  return c.json({
    reports: reports.map((report) => {
      const comment = commentById.get(report.targetId);
      return {
        ...report,
        comment: comment
          ? {
              body: comment.body,
              status: comment.status,
              contestId: comment.contestId,
              authorCode: forecasterCode(comment.forecasterId),
            }
          : null,
      };
    }),
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
