import { afterAll, describe, expect, it } from 'vite-plus/test';
import { app } from './app.js';
import { prisma } from './db.js';

const testTitle = `API 整合測試 ${crypto.randomUUID()}`;
let createdForecast = false;

afterAll(async () => {
  if (createdForecast) {
    await prisma.forecast.deleteMany({ where: { title: testTitle } });
  }
  await prisma.$disconnect();
});

describe('forecast API', () => {
  it('creates and lists a forecast', async () => {
    const createResponse = await app.request('/api/forecasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: testTitle, probability: 72 }),
    });
    expect(createResponse.status).toBe(201);
    createdForecast = true;

    const listResponse = await app.request('/api/forecasts');
    const body = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(body.forecasts).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: testTitle })]),
    );
  });

  it('rejects an invalid probability', async () => {
    const response = await app.request('/api/forecasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '無效預測', probability: 120 }),
    });
    expect(response.status).toBe(400);
  });
});
