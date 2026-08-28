import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prisma } from './db.js';
import { env, turnstileEnabled } from './env.js';
import {
  AvatarRejected,
  assertUploadableType,
  avatarUrl,
  commitAvatar,
  stagingKey,
} from './avatars.js';
import { CommentRejected, createComment, deleteOwnComment, listComments } from './comments.js';
import { type ContestType, contestTypes, getRegisteredContest } from './contest-registry.js';
import { IdentityRateLimited, type ResolvedForecaster, resolveForecaster } from './identity.js';
import { describeTarget, getPredictionTargets } from './prediction-targets.js';
import {
  PredictionRejected,
  readContestTallies,
  readMyPrediction,
  savePrediction,
} from './predictions.js';
import { readContestSnapshot, readJurisdictionMap, readNationalMap } from './snapshots.js';
import { createUploadUrl, deleteObject, storageEnabled } from './storage.js';
import { readTrend } from './trends.js';
import { fileReport, parseReportReason, parseReportTarget, requireAdmin } from './moderation.js';
import { cacheDelete, hitCounter } from './redis.js';
import { commentsKey } from './snapshot-keys.js';
import { ensureHuman, isHumanVerified } from './turnstile.js';

type Variables = { forecaster: ResolvedForecaster };

export const app = new Hono<{ Variables: Variables }>();

// 身份靠 cookie，跨網域請求必須帶上它，所以不能用預設的 cors()。
app.use(
  '/api/*',
  cors({
    credentials: true,
    origin: (origin) => origin ?? '*',
  }),
);

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'vote-forecast-api' }));

/**
 * 除了健康檢查以外，每個 /api 請求都先認出使用者。認不出來就開一個新身份——
 * 這一頁不需要登入，所以「還沒有身份」不是錯誤狀態。
 */
app.use('/api/*', async (c, next) => {
  // 健康檢查與後台不需要身份，後台走自己的 token。
  if (c.req.path === '/api/health' || c.req.path.startsWith('/api/admin/')) return next();
  try {
    c.set('forecaster', await resolveForecaster(c));
  } catch (error) {
    if (error instanceof IdentityRateLimited) return c.json({ error: error.message }, 429);
    throw error;
  }
  return next();
});

app.get('/api/session', async (c) => {
  const forecaster = c.get('forecaster');
  const predictionCount = await prisma.prediction.count({
    where: { forecasterId: forecaster.id, status: 'ACTIVE' },
  });

  return c.json({
    forecaster: {
      id: forecaster.id,
      displayName: forecaster.displayName,
      avatarUrl: avatarUrl(forecaster.avatarKey, forecaster.avatarBlockedAt),
      predictionCount,
      humanVerified: isHumanVerified(forecaster.humanVerifiedAt),
      blocked: forecaster.blockedAt !== null,
    },
    turnstile: turnstileEnabled ? { siteKey: env.turnstileSiteKey } : null,
  });
});

/** 改暱稱。名字只是顯示用的外皮，編號才是身份，所以這裡不碰 id。 */
app.put('/api/me', async (c) => {
  const forecaster = c.get('forecaster');
  const body = (await c.req.json().catch(() => null)) as { displayName?: unknown } | null;
  const raw = typeof body?.displayName === 'string' ? body.displayName.trim() : null;
  if (raw !== null && raw.length > 24) return c.json({ error: '名字最多 24 個字。' }, 400);

  const updated = await prisma.forecaster.update({
    where: { id: forecaster.id },
    data: { displayName: raw || null },
  });
  return c.json({ displayName: updated.displayName });
});

/** 拿一個上傳網址。前端直接 PUT 到物件儲存，圖片不經過這台伺服器。 */
app.post('/api/me/avatar/upload-url', async (c) => {
  if (!storageEnabled) return c.json({ error: '目前沒有開放上傳。' }, 503);
  const forecaster = c.get('forecaster');
  const body = (await c.req.json().catch(() => null)) as { contentType?: unknown } | null;
  const contentType = typeof body?.contentType === 'string' ? body.contentType : '';

  try {
    assertUploadableType(contentType);
    const key = stagingKey(forecaster.id);
    return c.json({ key, uploadUrl: await createUploadUrl(key, contentType) });
  } catch (error) {
    if (error instanceof AvatarRejected) return c.json({ error: error.message }, 400);
    throw error;
  }
});

/** 上傳完成後把原檔轉成正式頭像。重新編碼是必要的，不是可選項。 */
app.post('/api/me/avatar/commit', async (c) => {
  if (!storageEnabled) return c.json({ error: '目前沒有開放上傳。' }, 503);
  const forecaster = c.get('forecaster');
  const body = (await c.req.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === 'string' ? body.key : '';

  try {
    const finalKey = await commitAvatar(forecaster.id, key);
    const previous = forecaster.avatarKey;
    await prisma.forecaster.update({
      where: { id: forecaster.id },
      data: { avatarKey: finalKey, avatarBlockedAt: null },
    });
    // 換了新的就把舊的刪掉，不要在 bucket 裡累積使用者的舊照片。
    if (previous && previous !== finalKey) await deleteObject(previous);
    return c.json({ avatarUrl: avatarUrl(finalKey, null) });
  } catch (error) {
    if (error instanceof AvatarRejected) return c.json({ error: error.message }, 400);
    throw error;
  }
});

/** 移除頭像。 */
app.delete('/api/me/avatar', async (c) => {
  const forecaster = c.get('forecaster');
  if (forecaster.avatarKey) await deleteObject(forecaster.avatarKey);
  await prisma.forecaster.update({
    where: { id: forecaster.id },
    data: { avatarKey: null },
  });
  return c.json({ avatarUrl: null });
});

/** 地圖首頁：22 個縣市的領先者。這是最熱的端點，永遠讀快照。 */
app.get('/api/map/national', async (c) => c.json({ cells: await readNationalMap() }));

/** 下鑽某個縣市的某一層。level 對應選舉種類。 */
app.get('/api/map/:jurisdictionId', async (c) => {
  const jurisdictionId = c.req.param('jurisdictionId');
  const level = (c.req.query('level') ?? 'COUNCIL').toUpperCase();
  if (!contestTypes.includes(level as ContestType)) return c.json({ error: '沒有這個層級。' }, 400);

  return c.json({ cells: await readJurisdictionMap(jurisdictionId, level as ContestType) });
});

/** 一個選區的名單、目前分布，以及我自己押了誰。 */
app.get('/api/contests/:contestId', async (c) => {
  const contest = getRegisteredContest(c.req.param('contestId'));
  if (!contest) return c.json({ error: '找不到這個選區。' }, 404);

  const forecaster = c.get('forecaster');
  const [tally, mine] = await Promise.all([
    readContestSnapshot(contest.id),
    readMyPrediction(forecaster.id, contest.id),
  ]);

  return c.json({ contest, targets: getPredictionTargets(contest), tally, mine });
});

/** 送出或修改預測。同一個人對同一個選區永遠只有一筆，改是覆蓋。 */
app.post('/api/contests/:contestId/prediction', async (c) => {
  const contest = getRegisteredContest(c.req.param('contestId'));
  if (!contest) return c.json({ error: '找不到這個選區。' }, 404);

  const forecaster = c.get('forecaster');
  if (forecaster.blockedAt) return c.json({ error: '這個身份已被停用。' }, 403);

  const body = (await c.req.json().catch(() => null)) as {
    targetIds?: unknown;
    turnstileToken?: unknown;
  } | null;
  const targetIds = Array.isArray(body?.targetIds) ? body.targetIds : null;
  if (!targetIds || targetIds.some((id) => typeof id !== 'string'))
    return c.json({ error: '請選擇要預測的人選。' }, 400);

  const ip = c.req.header('cf-connecting-ip') ?? '';
  const token = typeof body?.turnstileToken === 'string' ? body.turnstileToken : '';
  if (!(await ensureHuman(forecaster, token, ip)))
    return c.json({ error: '請先完成人機驗證。', needsTurnstile: true }, 403);

  // 一個人一分鐘最多改 20 次。正常使用碰不到，腳本會。
  const hits = await hitCounter(`rl:pred:${forecaster.id}`, 60);
  if (hits > 20) return c.json({ error: '操作太頻繁，請稍後再試。' }, 429);

  try {
    const { created } = await savePrediction(forecaster.id, contest, targetIds as string[]);
    return c.json(
      {
        mine: await readMyPrediction(forecaster.id, contest.id),
        // savePrediction 已經把這個 key 清掉了，所以這裡讀到的是剛寫進去的數字。
        tally: await readContestSnapshot(contest.id),
      },
      created ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof PredictionRejected) return c.json({ error: error.message }, 400);
    throw error;
  }
});

/** 我押過的所有選區，給 /mine 用。 */
app.get('/api/me/predictions', async (c) => {
  const forecaster = c.get('forecaster');
  const predictions = await prisma.prediction.findMany({
    where: { forecasterId: forecaster.id },
    include: { picks: true },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  // 卡片要畫出整場的分布，所以一次把這些選區的統計撈回來，不要一張卡一次查詢。
  const tallies = await readContestTallies(predictions.map(({ contestId }) => contestId));

  return c.json({
    predictions: predictions.flatMap((prediction) => {
      const contest = getRegisteredContest(prediction.contestId);
      // 選區改制後舊預測可能對不到清冊，那就不列出來，但資料還留著。
      if (!contest) return [];
      const tally = tallies.get(contest.id);
      return [
        {
          contest,
          status: prediction.status,
          updatedAt: prediction.updatedAt,
          picks: prediction.picks.map((pick) => ({
            targetId: pick.targetId,
            ...describeTarget(contest, pick.targetType, pick.targetId),
          })),
          tally: {
            totalPredictions: tally?.totalPredictions ?? 0,
            totalPicks: tally?.totalPicks ?? 0,
            rows: (tally?.rows ?? []).map((row) => ({
              ...row,
              ...describeTarget(contest, row.targetType, row.targetId),
            })),
          },
        },
      ];
    }),
  });
});

/** 近 N 天的走勢。線的終點是現在的數字，不是昨天的快照。 */
app.get('/api/contests/:contestId/trend', async (c) => {
  const contest = getRegisteredContest(c.req.param('contestId'));
  if (!contest) return c.json({ error: '找不到這個選區。' }, 404);

  const requested = Number(c.req.query('days') ?? 30);
  const days = Number.isFinite(requested) ? Math.min(180, Math.max(7, Math.trunc(requested))) : 30;
  return c.json({ days, series: await readTrend(contest.id, days) });
});

/** 一個選區的留言。第一頁最熱，之後用時間游標往下翻。 */
app.get('/api/contests/:contestId/comments', async (c) => {
  const contest = getRegisteredContest(c.req.param('contestId'));
  if (!contest) return c.json({ error: '找不到這個選區。' }, 404);

  const cursor = c.req.query('cursor');
  const before = cursor ? new Date(cursor) : undefined;
  if (before && Number.isNaN(before.getTime())) return c.json({ error: '游標不正確。' }, 400);

  return c.json(await listComments(contest.id, before));
});

app.post('/api/contests/:contestId/comments', async (c) => {
  const contest = getRegisteredContest(c.req.param('contestId'));
  if (!contest) return c.json({ error: '找不到這個選區。' }, 404);

  const forecaster = c.get('forecaster');
  if (forecaster.blockedAt) return c.json({ error: '這個身份已被停用。' }, 403);

  const body = (await c.req.json().catch(() => null)) as {
    body?: unknown;
    parentId?: unknown;
    turnstileToken?: unknown;
  } | null;

  const ip = c.req.header('cf-connecting-ip') ?? '';
  const token = typeof body?.turnstileToken === 'string' ? body.turnstileToken : '';
  if (!(await ensureHuman(forecaster, token, ip)))
    return c.json({ error: '請先完成人機驗證。', needsTurnstile: true }, 403);

  // 一分鐘最多 5 則。討論跟得上，洗版跟不上。
  if ((await hitCounter(`rl:comment:${forecaster.id}`, 60)) > 5)
    return c.json({ error: '留言太頻繁，請稍後再試。' }, 429);

  try {
    const comment = await createComment(
      forecaster.id,
      contest.id,
      typeof body?.body === 'string' ? body.body : '',
      typeof body?.parentId === 'string' ? body.parentId : null,
    );
    await cacheDelete(commentsKey(contest.id));
    return c.json({ comment }, 201);
  } catch (error) {
    if (error instanceof CommentRejected) return c.json({ error: error.message }, 400);
    throw error;
  }
});

app.delete('/api/comments/:commentId', async (c) => {
  const forecaster = c.get('forecaster');
  try {
    await deleteOwnComment(forecaster.id, c.req.param('commentId'));
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof CommentRejected) return c.json({ error: error.message }, 404);
    throw error;
  }
});

/** 檢舉留言或頭像。任何人都能送，處理在後台。 */
app.post('/api/reports', async (c) => {
  const forecaster = c.get('forecaster');
  const body = (await c.req.json().catch(() => null)) as {
    targetType?: unknown;
    targetId?: unknown;
    reason?: unknown;
    note?: unknown;
  } | null;

  const targetType = parseReportTarget(body?.targetType);
  const reason = parseReportReason(body?.reason);
  const targetId = typeof body?.targetId === 'string' ? body.targetId : '';
  if (!targetType || !reason || !targetId) return c.json({ error: '檢舉內容不完整。' }, 400);

  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null;
  const report = await fileReport({
    reporterId: forecaster.id,
    targetType,
    targetId,
    reason,
    note,
  });
  return c.json({ reportId: report.id }, 201);
});

// --- 後台 ---------------------------------------------------------------

app.use('/api/admin/*', requireAdmin);

app.get('/api/admin/reports', async (c) => {
  const reports = await prisma.report.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  return c.json({ reports });
});

app.post('/api/admin/comments/:commentId/hide', async (c) => {
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

app.post('/api/admin/forecasters/:forecasterId/avatar-block', async (c) => {
  const forecasterId = c.req.param('forecasterId');
  await prisma.forecaster.update({
    where: { id: forecasterId },
    data: { avatarBlockedAt: new Date() },
  });
  await prisma.report.updateMany({
    where: { targetType: 'AVATAR', targetId: forecasterId, status: 'OPEN' },
    data: { status: 'ACTIONED', handledAt: new Date() },
  });
  return c.json({ ok: true });
});

app.post('/api/admin/forecasters/:forecasterId/block', async (c) => {
  await prisma.forecaster.update({
    where: { id: c.req.param('forecasterId') },
    data: { blockedAt: new Date() },
  });
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: '找不到這個 API 路徑。' }, 404));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: '伺服器暫時無法處理要求。' }, 500);
});
