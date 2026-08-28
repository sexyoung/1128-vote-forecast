import { serve } from '@hono/node-server';
import { app } from './app.js';
import { prisma } from './db.js';
import { assertProductionEnv, env } from './env.js';
import { disconnectRedis } from './redis.js';

assertProductionEnv();

const port = env.port;
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hono API 已啟動：http://localhost:${info.port}`);
});

function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
