import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { env } from './env.js';
import { hitCounter } from './redis.js';

/**
 * 後台不是使用者身份，跟 vf_fid 完全無關的一組 cookie。Path 鎖在 /api/admin，
 * 公開站的任何請求都不會帶到它。
 */
export const adminCookieName = 'vf_admin';

/** 常數時間比較。長度不同就直接假，不要讓長度本身變成訊號。 */
function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** cookie 是「發放時間 + 簽章」，不查資料庫。後台只有我一個人用，
 *  撤銷的辦法是換掉 ADMIN_SESSION_SECRET，比維護一張 session 表誠實。 */
function sign(issuedAt: number) {
  const payload = String(issuedAt);
  const mac = createHmac('sha256', env.adminSessionSecret).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

function verify(value: string) {
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return false;
  if (!sameSecret(mac, createHmac('sha256', env.adminSessionSecret).update(payload).digest('hex')))
    return false;
  const age = Date.now() - Number(payload);
  return Number.isFinite(age) && age >= 0 && age < env.adminSessionHours * 3600_000;
}

/** POST /api/admin/session 的實作。回 false 時呼叫端自己決定要回 401 還是 429。 */
export async function openAdminSession(c: Context, token: string) {
  // 猜 token 的人一分鐘只有 5 次機會。正常登入一天用不到一次。
  if ((await hitCounter(`rl:admin:${c.req.header('cf-connecting-ip') ?? 'unknown'}`, 60)) > 5)
    return false;
  if (!env.adminToken || !sameSecret(token, env.adminToken)) return false;
  setCookie(c, adminCookieName, sign(Date.now()), {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'Strict',
    path: '/api/admin',
    maxAge: env.adminSessionHours * 3600,
  });
  return true;
}

export function closeAdminSession(c: Context) {
  deleteCookie(c, adminCookieName, { path: '/api/admin' });
}

/**
 * 沒設定 token 就整組關閉，而不是留一個誰都進得去的後台。curl 與腳本繼續走
 * bearer token；瀏覽器裡的後台 UI 走 cookie，因為 token 不能留在 localStorage
 * ——公開站會原樣渲染留言內容（comments.ts 的 body 是原文），任何一處 XSS
 * 都能讀到 localStorage。
 */
export const requireAdmin = createMiddleware(async (c, next) => {
  if (!env.adminToken) return c.json({ error: '後台未啟用。' }, 503);

  const header = c.req.header('authorization') ?? '';
  if (header.startsWith('Bearer ') && sameSecret(header.slice(7), env.adminToken)) return next();

  const cookie = getCookie(c, adminCookieName) ?? '';
  if (!cookie || !verify(cookie)) return c.json({ error: '需要後台權限。' }, 401);

  // cookie 是 SameSite=Strict，但瀏覽器對 SameSite 的實作有過空窗；自訂 header
  // 沒有 preflight 就送不出去，多這一道是免費的。
  if (c.req.method !== 'GET' && c.req.header('x-admin-request') !== '1')
    return c.json({ error: '需要後台權限。' }, 401);

  return next();
});
