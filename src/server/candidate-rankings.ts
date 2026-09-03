import { avatarUrl } from '../client/avatars.js';
import { getParty, type PartyId } from '../shared/candidates.js';
import { listRegisteredContests } from './contest-registry.js';
import { prisma } from './db.js';
import { cachedJson } from './redis.js';
import { battlegroundRankingsKey } from './snapshot-keys.js';
import { placeholderCandidatesHidden } from './site-settings.js';

export async function listBattlegroundRankings() {
  return cachedJson(battlegroundRankingsKey(), 60, async () => {
    const eligibleContests = new Map(
      listRegisteredContests()
        .filter(({ seats }) => seats === 1)
        .map((contest) => [contest.id, contest]),
    );
    const tallies = (
      await prisma.contestTally.findMany({
        where: { targetType: 'CANDIDATE', count: { gt: 0 } },
      })
    ).filter(({ contestId }) => eligibleContests.has(contestId));
    const contestIds = [...new Set(tallies.map(({ contestId }) => contestId))];
    const candidates = await prisma.candidate.findMany({
      where: {
        contestId: { in: contestIds },
        status: { in: ['REGISTERED', 'CONFIRMED'] },
        ...(placeholderCandidatesHidden() ? { NOT: { id: { contains: '-CANDIDATE-' } } } : {}),
      },
      select: { id: true, contestId: true, partyId: true, name: true },
    });
    const counts = new Map(
      tallies.map((tally) => [`${tally.contestId}\0${tally.targetId}`, tally.count]),
    );
    const candidatesByContest = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const list = candidatesByContest.get(candidate.contestId) ?? [];
      list.push(candidate);
      candidatesByContest.set(candidate.contestId, list);
    }

    return {
      contests: [...candidatesByContest]
        .flatMap(([contestId, entries]) => {
          const contest = eligibleContests.get(contestId);
          const ranked = entries
            .map((candidate) => ({
              ...candidate,
              predictionCount: counts.get(`${contestId}\0${candidate.id}`) ?? 0,
            }))
            .sort(
              (left, right) =>
                right.predictionCount - left.predictionCount || left.id.localeCompare(right.id),
            );
          const totalPredictions = ranked.reduce(
            (total, candidate) => total + candidate.predictionCount,
            0,
          );
          if (!contest || ranked.length < 2 || totalPredictions === 0) return [];
          const gapRatio =
            (ranked[0].predictionCount - ranked[1].predictionCount) / totalPredictions;
          return [
            {
              contest,
              gapRatio,
              gapPercent: Math.round(gapRatio * 100_000) / 1000,
              totalPredictions,
              candidates: ranked.map((candidate) => {
                const party = getParty((candidate.partyId ?? 'IND') as PartyId);
                return {
                  id: candidate.id,
                  name: candidate.name,
                  photo: avatarUrl(candidate.id),
                  party: { id: party.id, name: party.name, color: party.color },
                  predictionCount: candidate.predictionCount,
                  predictionPercent:
                    Math.round((candidate.predictionCount / totalPredictions) * 1000) / 10,
                };
              }),
            },
          ];
        })
        .sort(
          (left, right) =>
            left.gapRatio - right.gapRatio ||
            right.totalPredictions - left.totalPredictions ||
            left.contest.id.localeCompare(right.contest.id),
        )
        .slice(0, 20)
        .map(({ gapRatio: _gapRatio, ...entry }, index) => ({ ...entry, rank: index + 1 })),
    };
  });
}
