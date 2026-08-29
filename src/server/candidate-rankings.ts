import type { PartyId } from '../shared/candidates.js';
import { getParty } from '../shared/candidates.js';
import { avatarUrl } from '../client/avatars.js';
import { getRegisteredContest } from './contest-registry.js';
import { prisma } from './db.js';

export async function listCandidateRankings() {
  const tallies = await prisma.contestTally.findMany({
    where: { targetType: 'CANDIDATE', count: { gt: 0 } },
    orderBy: [{ count: 'desc' }, { targetId: 'asc' }],
  });
  const candidates = await prisma.candidate.findMany({
    where: {
      id: { in: tallies.map(({ targetId }) => targetId) },
      status: { in: ['REGISTERED', 'CONFIRMED'] },
    },
    select: { id: true, contestId: true, partyId: true, name: true, nameEn: true },
  });
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  return {
    candidates: tallies
      .flatMap((tally) => {
        const candidate = candidatesById.get(tally.targetId);
        const contest = candidate && getRegisteredContest(candidate.contestId);
        if (!candidate || !contest || contest.id !== tally.contestId) return [];
        const party = getParty((candidate.partyId ?? 'IND') as PartyId);
        return [
          {
            id: candidate.id,
            name: candidate.name,
            photo: avatarUrl(contest.id, party.id, candidate.nameEn ?? undefined),
            party: { id: party.id, name: party.name, color: party.color },
            contest,
            predictionCount: tally.count,
          },
        ];
      })
      .slice(0, 50)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 })),
  };
}
