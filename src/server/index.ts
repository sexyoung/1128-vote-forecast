import { serve } from '@hono/node-server';
import { app } from './app.js';
import { prisma } from './db.js';
import { assertProductionEnv, env } from './env.js';
import { disconnectRedis } from './redis.js';
import { refreshHotSnapshots } from './snapshots.js';
import { captureDailySnapshot, hasSnapshotFor } from './trends.js';

assertProductionEnv();

const port = env.port;
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hono API 已啟動：http://localhost:${info.port}`);
});

/**
 * 每分鐘把「這一輪有人讀過」的快照重算一次。熱門的縣市因此永遠是新的，冷門的
 * 村里層不會為了沒人看的數字每分鐘掃 7,780 個選區。
 */
const snapshotTimer = setInterval(() => {
  void refreshHotSnapshots().catch((error: unknown) => {
    console.warn('快照重算失敗：', error instanceof Error ? error.message : error);
  });
}, 60_000);
snapshotTimer.unref();

/**
 * 每天抄一次 tally 當趨勢的資料點。用「今天抄過了沒」判斷而不是排在固定時刻：
 * 伺服器重啟、部署或當機都不會讓那一天缺一格。
 */
const trendTimer = setInterval(
  () => {
    void (async () => {
      if (await hasSnapshotFor()) return;
      const rows = await captureDailySnapshot();
      console.log(`趨勢快照寫入 ${rows} 列`);
    })().catch((error: unknown) => {
      console.warn('趨勢快照失敗：', error instanceof Error ? error.message : error);
    });
  },
  60 * 60 * 1000,
);
trendTimer.unref();

function shutdown() {
  clearInterval(snapshotTimer);
  clearInterval(trendTimer);
  server.close(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
