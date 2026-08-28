import { createMiddleware } from 'hono/factory';
import type { ReportReason, ReportTargetType } from '../generated/prisma/client.js';
import { prisma } from './db.js';
import { env } from './env.js';

/**
 * 使用者產生的內容需要下架管道。檢舉任何人都能送，處理只有帶著 admin token 的
 * 人能做——這個 token 跟一般身份無關，不共用 cookie。
 */

const reasons: ReportReason[] = ['SPAM', 'ABUSE', 'ADULT', 'ILLEGAL', 'OTHER'];
const targets: ReportTargetType[] = ['COMMENT', 'AVATAR'];

export function parseReportReason(value: unknown) {
  return reasons.includes(value as ReportReason) ? (value as ReportReason) : null;
}

export function parseReportTarget(value: unknown) {
  return targets.includes(value as ReportTargetType) ? (value as ReportTargetType) : null;
}

export async function fileReport(input: {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  note: string | null;
}) {
  // 同一個人重複檢舉同一個東西不再多開一筆，否則清單會被洗版。
  const existing = await prisma.report.findFirst({
    where: {
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      status: 'OPEN',
    },
  });
  if (existing) return existing;
  return prisma.report.create({ data: input });
}

/** 沒設定 token 就整組關閉，而不是留一個誰都進得去的後台。 */
export const requireAdmin = createMiddleware(async (c, next) => {
  if (!env.adminToken) return c.json({ error: '後台未啟用。' }, 503);
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== env.adminToken) return c.json({ error: '需要後台權限。' }, 401);
  return next();
});
