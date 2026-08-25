import 'dotenv/config';
import { serve } from '@hono/node-server';
import { app } from './app.js';
import { prisma } from './db.js';

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hono API 已啟動：http://localhost:${info.port}`);
});

function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
