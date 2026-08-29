import type { ReportReason, ReportTargetType } from '../generated/prisma/client.js';
import { prisma } from './db.js';

/** 沒有帳號密碼登入，後台的認證邏輯全部搬進 admin-session.ts。這裡重新匯出，
 *  是因為原本的匯入點（app.ts）不必因為這次搬家而改 import 路徑。 */
export { requireAdmin } from './admin-session.js';

/**
 * 使用者產生的內容需要下架管道。檢舉任何人都能送，處理只有帶著 admin token 的
 * 人能做——這個 token 跟一般身份無關，不共用 cookie。
 */

const reasons: ReportReason[] = ['SPAM', 'ABUSE', 'ADULT', 'ILLEGAL', 'OTHER'];
const targets: ReportTargetType[] = ['COMMENT'];

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

/** 駁回一則檢舉：處理過了，但沒有要下架任何東西。之前只有「隱藏留言」會連帶把
 *  報告標成 ACTIONED，OPEN 因此只會被行動清空，駁回只是把這條路補上。 */
export async function dismissReport(reportId: string) {
  const result = await prisma.report.updateMany({
    where: { id: reportId, status: 'OPEN' },
    data: { status: 'DISMISSED', handledAt: new Date(), handledBy: 'admin' },
  });
  return result.count > 0;
}
