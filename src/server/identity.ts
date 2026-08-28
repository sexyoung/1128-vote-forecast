import { createHmac, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { prisma } from './db.js';
import { env } from './env.js';
import { cacheDelete, cacheGet, cacheSet, hitCounter } from './redis.js';

export const forecasterCookieName = 'vf_fid';

const cookieMaxAgeSeconds = 400 * 24 * 60 * 60; // 瀏覽器對 cookie 上限的普遍值
const sessionCacheSeconds = 30 * 24 * 60 * 60;
/** 超過這段時間沒出現的指紋不再拿來認人，免得把裝置的下一位使用者接成同一個人。 */
const fingerprintRecoveryDays = 90;
/** 同一個 IP 每小時最多開幾個新身份。擋量產，不擋家庭或公司共用同一個出口。 */
const newIdentityPerHour = 30;

/** 指紋與 IP 一律只存 HMAC，不留原值。 */
export function signalHash(value: string) {
  return createHmac('sha256', env.forecasterPepper).update(value).digest('hex');
}

function readIp(c: Context) {
  const header =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    c.req.header('x-forwarded-for') ??
    '';
  // x-forwarded-for 是一串，第一個才是最初的來源。
  return header.split(',')[0]?.trim() ?? '';
}

function readFingerprint(c: Context) {
  const value = c.req.header('x-forecaster-fingerprint')?.trim() ?? '';
  // 太短的值不是指紋，是有人在亂送；當作沒有。
  return value.length >= 8 && value.length <= 256 ? value : '';
}

async function touchSignal(
  forecasterId: string,
  kind: 'COOKIE' | 'FINGERPRINT' | 'IP',
  hash: string,
) {
  await prisma.forecasterSignal.upsert({
    where: { forecasterId_kind_hash: { forecasterId, kind, hash } },
    create: { forecasterId, kind, hash },
    update: { lastSeenAt: new Date(), seenCount: { increment: 1 } },
  });
}

async function findByCookie(cookieHash: string) {
  const cached = await cacheGet(`sess:${cookieHash}`);
  if (cached) {
    const forecaster = await prisma.forecaster.findUnique({ where: { id: cached } });
    if (forecaster) return forecaster;
    // 身份被刪掉了，快取跟著失效。
    await cacheDelete(`sess:${cookieHash}`);
  }

  const signal = await prisma.forecasterSignal.findFirst({
    where: { kind: 'COOKIE', hash: cookieHash },
    include: { forecaster: true },
  });
  if (!signal) return null;
  await cacheSet(`sess:${cookieHash}`, signal.forecasterId, sessionCacheSeconds);
  return signal.forecaster;
}

/**
 * cookie 被清掉時的復原：指紋只有在「近期出現過」而且「只對應到一個身份」時才
 * 採信。同型號同版本的裝置會算出一樣的指紋，對到兩個人以上就不能猜。
 */
async function findByFingerprint(fingerprintHash: string) {
  const since = new Date(Date.now() - fingerprintRecoveryDays * 24 * 60 * 60 * 1000);
  const signals = await prisma.forecasterSignal.findMany({
    where: { kind: 'FINGERPRINT', hash: fingerprintHash, lastSeenAt: { gte: since } },
    include: { forecaster: true },
    take: 2,
  });
  return signals.length === 1 ? signals[0].forecaster : null;
}

export type ResolvedForecaster = {
  id: string;
  displayName: string | null;
  avatarKey: string | null;
  avatarBlockedAt: Date | null;
  humanVerifiedAt: Date | null;
  blockedAt: Date | null;
};

/**
 * 認出這個請求是誰。順序是 cookie、指紋、開新的；認完把 cookie 補回去，讓下一次
 * 走最快也最可靠的那條路。
 */
export async function resolveForecaster(c: Context): Promise<ResolvedForecaster> {
  const ip = readIp(c);
  const ipHash = ip ? signalHash(ip) : '';
  const fingerprint = readFingerprint(c);
  const fingerprintHash = fingerprint ? signalHash(fingerprint) : '';

  const token = getCookie(c, forecasterCookieName) ?? '';
  const fromCookie = token ? await findByCookie(signalHash(token)) : null;
  let forecaster = fromCookie;

  if (!forecaster && fingerprintHash) forecaster = await findByFingerprint(fingerprintHash);

  if (!forecaster) {
    if (ipHash) {
      const hits = await hitCounter(`rl:newid:${ipHash}`, 60 * 60);
      if (hits > newIdentityPerHour) throw new IdentityRateLimited();
    }
    forecaster = await prisma.forecaster.create({ data: {} });
  }

  // 只有在 cookie 沒認出人的時候才換一組（新身份，或靠指紋認回來的）。認得出來
  // 就別動：每次都換等於每次都多一列 COOKIE signal，Redis 掛掉時尤其明顯。
  if (!fromCookie) {
    const issued = randomBytes(32).toString('base64url');
    setCookie(c, forecasterCookieName, issued, {
      httpOnly: true,
      maxAge: cookieMaxAgeSeconds,
      path: '/',
      sameSite: 'Lax',
      secure: env.isProduction,
    });
    const cookieHash = signalHash(issued);
    await touchSignal(forecaster.id, 'COOKIE', cookieHash);
    await cacheSet(`sess:${cookieHash}`, forecaster.id, sessionCacheSeconds);
  }

  if (fingerprintHash) await touchSignal(forecaster.id, 'FINGERPRINT', fingerprintHash);
  if (ipHash) await touchSignal(forecaster.id, 'IP', ipHash);

  await prisma.forecaster.update({
    where: { id: forecaster.id },
    data: { lastSeenAt: new Date() },
  });

  return forecaster;
}

export class IdentityRateLimited extends Error {
  constructor() {
    super('同一個網路開太多身份了，請稍後再試。');
    this.name = 'IdentityRateLimited';
  }
}
