import Redis from 'ioredis';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { env } from './env.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const gzipLevel = 6;

/**
 * Redis 在這裡是加速層，不是資料來源：放的都是算得回來的東西（快照、session
 * 對照、速率計數）。所以每個呼叫都自己吞掉錯誤，Redis 掛掉只會變慢。
 *
 * `enableOfflineQueue: false` 是重點——預設會把指令排隊等到重連，那會讓
 * Redis 掛掉時每個請求都卡住，比沒有快取還糟。
 */
let client: Redis | null = null;
let warned = false;
let readyPromise: Promise<void> | null = null;
let retryReadyAfter = 0;

function getClient() {
  if (!env.redisUrl) return null;
  if (client) return client;
  client = new Redis(env.redisUrl, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  client.on('error', (error: Error) => {
    if (warned) return;
    warned = true;
    console.warn('Redis 無法使用，改走資料庫：', error.message);
  });
  readyPromise = new Promise((resolve) => client?.once('ready', resolve));
  void client.connect().catch(() => {});
  return client;
}

/**
 * 冷啟動時 Redis.connect() 還在背景跑；enableOfflineQueue=false 會讓第一個指令直接
 * 失敗。最多等 250ms 讓同區 Redis ready，逾時後短暫退避並回 DB，不讓故障變卡頓。
 */
async function getReadyClient(deadlineMs = 250) {
  const redis = getClient();
  if (!redis) return null;
  if ((redis.status as string) === 'ready') return redis;
  if (Date.now() < retryReadyAfter || !readyPromise) return null;
  await Promise.race([
    readyPromise,
    new Promise<void>((resolve) => setTimeout(resolve, deadlineMs)),
  ]);
  if ((redis.status as string) === 'ready') return redis;
  retryReadyAfter = Date.now() + 1000;
  return null;
}

export async function cacheGet(key: string) {
  try {
    return (await (await getReadyClient())?.get(key)) ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number) {
  try {
    await (await getReadyClient())?.set(key, value, 'EX', ttlSeconds);
  } catch {
    // 寫不進去就算了，下次讀還是會回到資料庫。
  }
}

async function cacheGetBuffer(key: string) {
  try {
    return (await (await getReadyClient())?.getBuffer(key)) ?? null;
  } catch {
    return null;
  }
}

async function cacheSetBuffer(key: string, value: Buffer, ttlSeconds: number) {
  try {
    await (await getReadyClient())?.set(key, value, 'EX', ttlSeconds);
  } catch {
    // 寫不進去就算了，下次讀還是會回到資料庫。
  }
}

export async function cacheMGet(keys: string[]) {
  if (keys.length === 0) return [];
  try {
    return (await (await getReadyClient())?.mget(...keys)) ?? keys.map(() => null);
  } catch {
    return keys.map(() => null);
  }
}

export async function cacheMSet(entries: { key: string; value: string }[], ttlSeconds: number) {
  if (entries.length === 0) return;
  const redis = await getReadyClient();
  if (!redis) return;
  try {
    const transaction = redis.multi();
    for (const entry of entries) transaction.set(entry.key, entry.value, 'EX', ttlSeconds);
    await transaction.exec();
  } catch {
    // 批次快取失敗仍可直接使用剛從資料庫算出的值。
  }
}

/** JSON cache-aside。公開、可重建資料共用；壞掉的 JSON 視同 miss 並覆寫。 */
export async function cachedJson<T>(key: string, ttlSeconds: number, build: () => Promise<T>) {
  const cached = await cacheGet(key);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      await cacheDelete(key);
    }
  }
  const value = await build();
  await cacheSet(key, JSON.stringify(value), ttlSeconds);
  return value;
}

/** 大型 JSON cache-aside。以 gzip level 6 的 binary 儲存，避免 Base64 額外膨脹。 */
export async function cachedGzipJson<T>(key: string, ttlSeconds: number, build: () => Promise<T>) {
  const cached = await cacheGetBuffer(key);
  if (cached !== null) {
    try {
      const json = await gunzipAsync(cached);
      return JSON.parse(json.toString('utf8')) as T;
    } catch {
      await cacheDelete(key);
    }
  }

  const value = await build();
  try {
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(value)), { level: gzipLevel });
    await cacheSetBuffer(key, compressed, ttlSeconds);
  } catch {
    // 壓縮或快取失敗不影響資料庫結果。
  }
  return value;
}

export async function cacheDelete(...keys: string[]) {
  if (keys.length === 0) return;
  try {
    await (await getReadyClient())?.del(...keys);
  } catch {
    // 清不掉的話快照最多撐到 TTL 到期。
  }
}

/**
 * 固定視窗計數。回傳這個視窗內的第幾次，超過上限由呼叫端決定怎麼辦。
 * Redis 不在時回 0，等於放行——真正擋重複預測的是資料庫的唯一鍵。
 */
export async function hitCounter(key: string, windowSeconds: number) {
  const redis = await getReadyClient();
  if (!redis) return 0;
  try {
    const [[, hits]] = (await redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec()) as [
      [Error | null, number],
      unknown,
    ];
    return hits;
  } catch {
    return 0;
  }
}

/** 記下最近被讀過的快照 key，讓 cron 只重算真的有人在看的東西。 */
export async function trackKey(setKey: string, member: string) {
  try {
    await (await getReadyClient())?.sadd(setKey, member);
  } catch {
    // 追蹤不到就少刷一個 key，讀的時候還是會自己重算。
  }
}

/** 取出並清空追蹤集合：沒有再被讀到的 key 自然就不再重算。 */
export async function takeTrackedKeys(setKey: string) {
  const redis = await getReadyClient();
  if (!redis) return [];
  try {
    const [[, members]] = (await redis.multi().smembers(setKey).del(setKey).exec()) as [
      [Error | null, string[]],
      unknown,
    ];
    return members;
  } catch {
    return [];
  }
}

/** 後台總覽要秀「Redis 活著沒」，但不能讓一個掛掉的 Redis 拖慢整個頁面——
 *  設個短 deadline，逾時就當作不可用。 */
export async function pingRedis(deadlineMs = 300) {
  const redis = await getReadyClient(deadlineMs);
  if (!redis) return false;
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deadlineMs)),
    ]);
    return result === 'PONG';
  } catch {
    return false;
  }
}

export async function disconnectRedis() {
  if (!client) return;
  await client.quit().catch(() => client?.disconnect());
  client = null;
  readyPromise = null;
  retryReadyAfter = 0;
}
