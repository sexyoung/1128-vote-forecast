import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { getMockCandidates } from '../src/shared/candidates.js';
import { listRegisteredContests } from '../src/server/contest-registry.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('缺少 DATABASE_URL。');

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString },
    process.env.VITEST ? { schema: 'vote_forecast_test' } : undefined,
  ),
});
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
  const result = await prisma.$transaction(
    async (tx) => {
      const formalCandidates = await tx.candidate.count({
        where: { NOT: { id: { contains: '-CANDIDATE-' } } },
      });
      if (formalCandidates > 0) return { inserted: 0, protected: formalCandidates };

      await tx.candidate.deleteMany();
      for (let index = 0; index < candidates.length; index += 500)
        await tx.candidate.createMany({ data: candidates.slice(index, index + 500) });
      return { inserted: candidates.length, protected: 0 };
    },
    { timeout: 300_000 },
  );

  console.log(
    result.protected > 0
      ? `Candidate 已有 ${result.protected.toLocaleString()} 位非假資料，略過 seed。`
      : `已建立 ${result.inserted.toLocaleString()} 位假候選人。`,
  );
} finally {
  await prisma.$disconnect();
}
