import { prisma } from '../src/server/db.js';

const forecastCount = await prisma.forecast.count();

if (forecastCount === 0) {
  await prisma.forecast.createMany({
    data: [
      {
        title: '市民公投案通過',
        description: '根據目前樣本建立的初始預測。',
        probability: 64,
      },
      {
        title: '青年投票率突破 60%',
        description: '示範用資料，可由首頁新增更多預測。',
        probability: 48,
      },
    ],
  });
}

await prisma.$disconnect();
