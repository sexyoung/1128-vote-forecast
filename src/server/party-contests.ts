import { prisma } from './db.js';
import { getRegisteredContest } from './contest-registry.js';
import { readContestTallies } from './predictions.js';
import { avatarUrl } from '../client/avatars.js';
import { jurisdictionOrder } from '../shared/jurisdictions.js';

const pageSize = 100;
const typeOrder = ['EXECUTIVE', 'COUNCIL', 'TOWNSHIP', 'REPRESENTATIVE', 'VILLAGE'] as const;

export async function listPartyCandidateCounts() {
  const groups = await prisma.candidate.groupBy({
    by: ['partyId', 'contestId'],
    where: { partyId: { not: null }, status: { in: ['REGISTERED', 'CONFIRMED'] } },
    _count: { _all: true },
  });
  const parties = new Map<
    string,
    { candidateCount: number; offices: Map<(typeof typeOrder)[number], number> }
  >();
  for (const group of groups) {
    const contest = getRegisteredContest(group.contestId);
    if (!group.partyId || !contest) continue;
    const summary = parties.get(group.partyId) ?? { candidateCount: 0, offices: new Map() };
    summary.candidateCount += group._count._all;
    summary.offices.set(contest.type, (summary.offices.get(contest.type) ?? 0) + group._count._all);
    parties.set(group.partyId, summary);
  }
  return {
    parties: Object.fromEntries(
      [...parties].map(([id, summary]) => [
        id,
        {
          candidateCount: summary.candidateCount,
          offices: typeOrder.flatMap((type) => {
            const candidateCount = summary.offices.get(type) ?? 0;
            return candidateCount ? [{ type, candidateCount }] : [];
          }),
        },
      ]),
    ),
  };
}

export async function listPartyContests(
  partyId: string,
  requestedPage = 1,
  jurisdictionId = '',
  requestedType = '',
) {
  const candidates = await prisma.candidate.findMany({
    where: { partyId, status: { in: ['REGISTERED', 'CONFIRMED'] } },
    select: { id: true, contestId: true, name: true, nameEn: true, ballotNo: true },
  });
  const items = candidates
    .flatMap((candidate) => {
      const contest = getRegisteredContest(candidate.contestId);
      return contest ? [{ contest, candidate }] : [];
    })
    .sort(
      (left, right) =>
        jurisdictionOrder.indexOf(left.contest.jurisdictionId) -
          jurisdictionOrder.indexOf(right.contest.jurisdictionId) ||
        typeOrder.indexOf(left.contest.type) - typeOrder.indexOf(right.contest.type) ||
        left.contest.id.localeCompare(right.contest.id) ||
        (left.candidate.ballotNo ?? Number.MAX_SAFE_INTEGER) -
          (right.candidate.ballotNo ?? Number.MAX_SAFE_INTEGER) ||
        left.candidate.name.localeCompare(right.candidate.name),
    );
  const regions = [...new Set(items.map(({ contest }) => contest.jurisdictionId))].map((id) => ({
    id,
    candidateCount: items.filter(({ contest }) => contest.jurisdictionId === id).length,
    offices: typeOrder.flatMap((type) => {
      const candidateCount = items.filter(
        ({ contest }) => contest.jurisdictionId === id && contest.type === type,
      ).length;
      return candidateCount ? [{ type, candidateCount }] : [];
    }),
  }));
  const regionItems = jurisdictionId
    ? items.filter(({ contest }) => contest.jurisdictionId === jurisdictionId)
    : [];
  const activeType =
    typeOrder.find(
      (type) => type === requestedType && regionItems.some(({ contest }) => contest.type === type),
    ) ?? typeOrder.find((type) => regionItems.some(({ contest }) => contest.type === type));
  const filteredItems = activeType
    ? regionItems.filter(({ contest }) => contest.type === activeType)
    : [];
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const pagedItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);
  const contestIds = [...new Set(pagedItems.map(({ contest }) => contest.id))];
  const tallies = await readContestTallies(contestIds);

  return {
    items: pagedItems.map(({ contest, candidate }) => {
      const tally = tallies.get(contest.id);
      const row = tally?.rows.find(({ targetId }) => targetId === candidate.id);
      const predictedWinners = new Set(
        tally?.totalPicks ? tally.rows.slice(0, contest.seats).map((row) => row.targetId) : [],
      );
      return {
        contest,
        hasPredictions: Boolean(tally?.totalPicks),
        candidate: {
          id: candidate.id,
          name: candidate.name,
          ballotNo: candidate.ballotNo,
          photo: avatarUrl(contest.id, partyId, candidate.nameEn ?? undefined),
          predictionCount: row?.count ?? 0,
          predictionPercent: row?.percent ?? 0,
          predictedElected: predictedWinners.has(candidate.id),
        },
      };
    }),
    page,
    pageSize,
    total: filteredItems.length,
    candidateTotal: items.length,
    activeType: activeType ?? null,
    totalPages,
    regions,
  };
}
