import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prisma } from './db.js';

export const app = new Hono();

app.use('/api/*', cors());
app.get('/api/health', (c) => c.json({ status: 'ok', service: 'vote-forecast-api' }));

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
