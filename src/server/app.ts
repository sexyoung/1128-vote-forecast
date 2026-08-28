import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prisma } from './db.js';
import { env, turnstileEnabled } from './env.js';
import { type ContestType, contestTypes, getRegisteredContest } from './contest-registry.js';
import { IdentityRateLimited, type ResolvedForecaster, resolveForecaster } from './identity.js';
import { describeTarget, getPredictionTargets } from './prediction-targets.js';
import { PredictionRejected, readMyPrediction, savePrediction } from './predictions.js';
import { readContestSnapshot, readJurisdictionMap, readNationalMap } from './snapshots.js';
import { hitCounter } from './redis.js';
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
  if (c.req.path === '/api/health') return next();
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
      avatarUrl: forecaster.avatarBlockedAt ? null : forecaster.avatarKey,
      predictionCount,
      humanVerified: isHumanVerified(forecaster.humanVerifiedAt),
      blocked: forecaster.blockedAt !== null,
    },
    turnstile: turnstileEnabled ? { siteKey: env.turnstileSiteKey } : null,
  });
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

  return c.json({
    predictions: predictions.flatMap((prediction) => {
      const contest = getRegisteredContest(prediction.contestId);
      // 選區改制後舊預測可能對不到清冊，那就不列出來，但資料還留著。
      if (!contest) return [];
      return [
        {
          contest,
          status: prediction.status,
          updatedAt: prediction.updatedAt,
          picks: prediction.picks.map((pick) => ({
            targetId: pick.targetId,
            ...describeTarget(contest, pick.targetType, pick.targetId),
          })),
        },
      ];
    }),
  });
});

app.get('/api/forecasts', async (c) => {
  const forecasts = await prisma.forecast.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return c.json({ forecasts });
});

app.post('/api/forecasts', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!isForecastInput(body)) {
    return c.json({ error: '標題不可為空，機率必須是 0 到 100 之間的整數。' }, 400);
  }

  const forecast = await prisma.forecast.create({
    data: {
      title: body.title.trim(),
      description: body.description?.trim() || null,
      probability: body.probability,
    },
  });
  return c.json({ forecast }, 201);
});

app.notFound((c) => c.json({ error: '找不到這個 API 路徑。' }, 404));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: '伺服器暫時無法處理要求。' }, 500);
});

type ForecastInput = {
  title: string;
  description?: string;
  probability: number;
};

function isForecastInput(value: unknown): value is ForecastInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.title === 'string' &&
    input.title.trim().length > 0 &&
    input.title.length <= 120 &&
    (input.description === undefined ||
      (typeof input.description === 'string' && input.description.length <= 500)) &&
    typeof input.probability === 'number' &&
    Number.isInteger(input.probability) &&
    input.probability >= 0 &&
    input.probability <= 100
  );
}
