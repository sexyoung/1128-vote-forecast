import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { adminApp } from './admin.js';
import { prisma } from './db.js';
import { env, turnstileEnabled } from './env.js';
import { CommentRejected, createComment, deleteOwnComment, listComments } from './comments.js';
import { type ContestType, contestTypes, getRegisteredContest } from './contest-registry.js';
import { IdentityRateLimited, type ResolvedForecaster, resolveForecaster } from './identity.js';
import { describeTarget, getPredictionTargets, refreshCandidates } from './prediction-targets.js';
import {
  PredictionRejected,
  readContestTallies,
  readMyPrediction,
  savePrediction,
} from './predictions.js';
import { readContestSnapshot, readJurisdictionMap, readNationalMap } from './snapshots.js';
import { readTrend } from './trends.js';
import { fileReport, parseReportReason, parseReportTarget } from './moderation.js';
import { cacheDelete, hitCounter } from './redis.js';
import { commentsKey } from './snapshot-keys.js';
import { ensureHuman, isHumanVerified } from './turnstile.js';
import { candidateParties } from '../shared/candidates.js';
import { listPartyCandidateCounts, listPartyContests } from './party-contests.js';
import { listCandidateRankings } from './candidate-rankings.js';

type Variables = { forecaster: ResolvedForecaster };

export const app = new Hono<{ Variables: Variables }>();

// 所有入口都經過 app；在這裡載入，API、SSR 與測試才會看到同一份資料庫名單。
await refreshCandidates();

// 身份靠 cookie，跨網域請求必須帶上它，所以不能用預設的 cors()。
// 後台不在這組規則裡：下面這個 cors() 會把任何來源反射回去，後台端點若也適用，
// 等於任何網站都能帶著使用者的 vf_admin cookie 替他操作後台（credentials:true
// 加上反射的 Access-Control-Allow-Origin，evil.com 讀得到回應）。沒有這行，
// 跨網域請求連 cookie 都不會被瀏覽器允許附上。
const publicCors = cors({ credentials: true, origin: (origin) => origin ?? '*' });
app.use('/api/*', (c, next) =>
  c.req.path.startsWith('/api/admin/') ? next() : publicCors(c, next),
);

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'vote-forecast-api' }));

/**
 * 除了健康檢查以外，每個 /api 請求都先認出使用者。認不出來就開一個新身份——
 * 這一頁不需要登入，所以「還沒有身份」不是錯誤狀態。
 *
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

/** 地圖首頁：22 個縣市的領先者。這是最熱的端點，永遠讀快照。 */
app.get('/api/map/national', async (c) => c.json({ cells: await readNationalMap() }));

/** 下鑽某個縣市的某一層。level 對應選舉種類。 */
app.get('/api/map/:jurisdictionId', async (c) => {
  const jurisdictionId = c.req.param('jurisdictionId');
  const level = (c.req.query('level') ?? 'COUNCIL').toUpperCase();
  if (!contestTypes.includes(level as ContestType)) return c.json({ error: '沒有這個層級。' }, 400);

  return c.json({ cells: await readJurisdictionMap(jurisdictionId, level as ContestType) });
});

app.get('/api/parties', async (c) => c.json(await listPartyCandidateCounts()));

app.get('/api/rankings/candidates', async (c) => c.json(await listCandidateRankings()));

app.get('/api/parties/:partyId/contests', async (c) => {
  const partyId = c.req.param('partyId').toUpperCase();
  if (!candidateParties.some(({ id }) => id === partyId))
    return c.json({ error: '找不到這個政黨。' }, 404);
  const page = Number.parseInt(c.req.query('page') ?? '1', 10);
  const regionId = (c.req.query('region') ?? '').toUpperCase();
  const view = (c.req.query('view') ?? '').toUpperCase();
  return c.json(await listPartyContests(partyId, Number.isFinite(page) ? page : 1, regionId, view));
});

/**
 * 一次拿好幾個選區的分布。卡片牆一頁有幾十張，一張一次請求會變成幾十次往返。
 */
app.get('/api/contests', async (c) => {
  const ids = (c.req.query('ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return c.json({ tallies: {} });
  if (ids.length > 250) return c.json({ error: '一次最多查 250 個選區。' }, 400);

  const known = ids.flatMap((id) => getRegisteredContest(id) ?? []);
  const tallies = await readContestTallies(known.map(({ id }) => id));

  return c.json({
    tallies: Object.fromEntries(
      known.map((contest) => {
        const tally = tallies.get(contest.id);
        return [
          contest.id,
          {
            totalPredictions: tally?.totalPredictions ?? 0,
            totalPicks: tally?.totalPicks ?? 0,
            targets: getPredictionTargets(contest),
            rows: (tally?.rows ?? []).map((row) => ({
              ...row,
              ...describeTarget(contest, row.targetType, row.targetId),
            })),
          },
        ];
      }),
    ),
  });
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

/** 檢舉留言。任何人都能送，處理在後台。 */
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
  const target = await prisma.comment.findFirst({
    where: { id: targetId, status: 'VISIBLE' },
    select: { id: true },
  });
  if (!target) return c.json({ error: '找不到這則留言。' }, 404);

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
// 認證與審核佇列都在 admin.ts；這裡只掛路徑。

app.route('/api/admin', adminApp);

app.notFound((c) => c.json({ error: '找不到這個 API 路徑。' }, 404));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: '伺服器暫時無法處理要求。' }, 500);
});
