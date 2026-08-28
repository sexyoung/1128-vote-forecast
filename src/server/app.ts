import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prisma } from './db.js';
import { env, turnstileEnabled } from './env.js';
import { IdentityRateLimited, type ResolvedForecaster, resolveForecaster } from './identity.js';
import { isHumanVerified } from './turnstile.js';

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
