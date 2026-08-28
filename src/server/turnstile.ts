import { prisma } from './db.js';
import { env, turnstileEnabled } from './env.js';

const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** 通過驗證後這段時間內不再要求。擋的是自動化，不是每一次送出。 */
const trustedForSeconds = 12 * 60 * 60;

export async function verifyTurnstileToken(token: string, ip: string) {
  if (!turnstileEnabled) return true;
  if (!token) return false;

  const body = new FormData();
  body.append('secret', env.turnstileSecretKey);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);

  try {
    const response = await fetch(verifyUrl, { method: 'POST', body });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    // Cloudflare 連不上時放行：擋住所有寫入比放過幾個機器人糟得多。
    return true;
  }
}

export function isHumanVerified(humanVerifiedAt: Date | null) {
  if (!turnstileEnabled) return true;
  if (!humanVerifiedAt) return false;
  return Date.now() - humanVerifiedAt.getTime() < trustedForSeconds * 1000;
}

/**
 * 寫入前的關卡。在有效期內直接放行，過期或從沒驗過才要 token。
 * 回傳 false 代表要請前端出示 Turnstile。
 */
export async function ensureHuman(
  forecaster: { id: string; humanVerifiedAt: Date | null },
  token: string,
  ip: string,
) {
  if (isHumanVerified(forecaster.humanVerifiedAt)) return true;
  if (!(await verifyTurnstileToken(token, ip))) return false;

  const now = new Date();
  await prisma.forecaster.update({
    where: { id: forecaster.id },
    data: { humanVerifiedAt: now },
  });
  forecaster.humanVerifiedAt = now;
  return true;
}
