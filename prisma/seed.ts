import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { getMockCandidates } from '../src/shared/candidates.js';
import { listRegisteredContests } from '../src/server/contest-registry.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('缺少 DATABASE_URL。');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const candidates = listRegisteredContests().flatMap((contest) =>
  getMockCandidates({ id: contest.id, seatCount: contest.seats }).map((candidate) => ({
    id: candidate.id,
    contestId: contest.id,
    partyId: candidate.partyId,
    name: candidate.name,
    ballotNo: candidate.number,
  })),
);

try {
  const inserted = await prisma.$transaction(
    async (tx) => {
      if ((await tx.candidate.count()) > 0) return 0;
      for (let index = 0; index < candidates.length; index += 500)
        await tx.candidate.createMany({ data: candidates.slice(index, index + 500) });
      return candidates.length;
    },
    { timeout: 300_000 },
  );

  console.log(
    inserted > 0
      ? `已建立 ${inserted.toLocaleString()} 位佔位候選人。`
      : 'Candidate 已有資料，略過佔位名單。',
  );
} finally {
  await prisma.$disconnect();
}
