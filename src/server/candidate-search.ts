import { getRegisteredContest } from './contest-registry.js';
import { prisma } from './db.js';
import { placeholderCandidatesHidden } from './site-settings.js';

/** 只搜尋已匯入且前台可見的真候選人；假名單永遠不會混進姓名搜尋結果。 */
export async function searchCandidateNames(query: string, limit = 6) {
  const name = query.trim().slice(0, 40);
  if (!name) return [];
  const candidates = await prisma.candidate.findMany({
    where: {
      name: { contains: name, mode: 'insensitive' },
      status: { in: ['REGISTERED', 'CONFIRMED'] },
      ...(placeholderCandidatesHidden() ? { NOT: { id: { contains: '-CANDIDATE-' } } } : {}),
    },
    select: { id: true, contestId: true, name: true, partyId: true },
    orderBy: [{ name: 'asc' }, { contestId: 'asc' }],
    take: Math.min(Math.max(limit, 1), 12),
  });

  return candidates.flatMap((candidate) => {
    const contest = getRegisteredContest(candidate.contestId);
    if (!contest) return [];
    return [
      {
        id: candidate.id,
        label: candidate.name,
        sub: `${contest.name}${candidate.partyId ? ` · ${candidate.partyId}` : ''}`,
        to: `/contest/${contest.id}`,
      },
    ];
  });
}
