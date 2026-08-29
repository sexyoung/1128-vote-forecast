import { execFileSync } from 'node:child_process';
import 'dotenv/config';

export function setup() {
  const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('缺少測試資料庫連線。');

  const url = new URL(connectionString);
  url.searchParams.set('schema', 'vote_forecast_test');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
}
