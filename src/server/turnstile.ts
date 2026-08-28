import { prisma } from './db.js';
import { env, turnstileEnabled } from './env.js';

const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare 文件公開的測試金鑰，驗證結果是固定的。認得它們就不必為了一個已知
 * 的答案打一次外部 API——開發與測試因此不需要網路，也不會因為 Cloudflare 慢而
 * 拖慢每一次送出。正式金鑰不長這樣，所以不會誤觸。
 */
const testSecrets: Record<string, boolean> = {
  '1x0000000000000000000000000000000AA': true, // 一律通過
  '2x0000000000000000000000000000000AA': false, // 一律失敗
  '3x0000000000000000000000000000000AA': false, // 一律當成已用過
};

/** 通過驗證後這段時間內不再要求。擋的是自動化，不是每一次送出。 */
const trustedForSeconds = 12 * 60 * 60;

export async function verifyTurnstileToken(token: string, ip: string) {
  if (!turnstileEnabled) return true;

  const fixed = testSecrets[env.turnstileSecretKey];
  if (fixed !== undefined) return fixed;

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
