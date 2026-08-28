import Redis from 'ioredis';
import { env } from './env.js';

/**
 * Redis 在這裡是加速層，不是資料來源：放的都是算得回來的東西（快照、session
 * 對照、速率計數）。所以每個呼叫都自己吞掉錯誤，Redis 掛掉只會變慢。
 *
 * `enableOfflineQueue: false` 是重點——預設會把指令排隊等到重連，那會讓
 * Redis 掛掉時每個請求都卡住，比沒有快取還糟。
 */
let client: Redis | null = null;
let warned = false;

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
  void client.connect().catch(() => {});
  return client;
}

export async function cacheGet(key: string) {
  try {
    return (await getClient()?.get(key)) ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number) {
  try {
    await getClient()?.set(key, value, 'EX', ttlSeconds);
  } catch {
    // 寫不進去就算了，下次讀還是會回到資料庫。
  }
}

export async function cacheDelete(...keys: string[]) {
  if (keys.length === 0) return;
  try {
    await getClient()?.del(...keys);
  } catch {
    // 清不掉的話快照最多撐到 TTL 到期。
  }
}

/**
 * 固定視窗計數。回傳這個視窗內的第幾次，超過上限由呼叫端決定怎麼辦。
 * Redis 不在時回 0，等於放行——真正擋重複預測的是資料庫的唯一鍵。
 */
export async function hitCounter(key: string, windowSeconds: number) {
  const redis = getClient();
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
    await getClient()?.sadd(setKey, member);
  } catch {
    // 追蹤不到就少刷一個 key，讀的時候還是會自己重算。
  }
}

/** 取出並清空追蹤集合：沒有再被讀到的 key 自然就不再重算。 */
export async function takeTrackedKeys(setKey: string) {
  const redis = getClient();
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

export async function disconnectRedis() {
  if (!client) return;
  await client.quit().catch(() => client?.disconnect());
  client = null;
}
