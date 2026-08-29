import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';

// DIRECT_DATABASE_URL 沒有 pooler，給本機維護與資料庫 migration 使用。
// 留空就用 DATABASE_URL。
//
// 但在 Vercel 上一律忽略它。它同時也是 GitHub Actions 跑 migration 用的 secret，
// 很容易被順手貼進 Vercel 的環境變數；真的貼了，每個 function instance 都會改走
// 直連，然後在流量上來的時候把 Postgres 的 max_connections 吃光——那是本機測不
// 出來、只在正式環境炸的失敗。靠註解提醒不夠，這裡直接讓它不可能發生。
const onVercel = Boolean(process.env.VERCEL);
const connectionString = (!onVercel && env.directDatabaseUrl) || env.databaseUrl;

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
