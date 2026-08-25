import type { Forecast, ForecastInput } from '../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? '要求失敗，請稍後再試。');
  return data;
}

export async function getForecasts(): Promise<Forecast[]> {
  const data = await request<{ forecasts: Forecast[] }>('/api/forecasts');
  return data.forecasts;
}

export async function createForecast(input: ForecastInput): Promise<Forecast> {
  const data = await request<{ forecast: Forecast }>('/api/forecasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return data.forecast;
}
