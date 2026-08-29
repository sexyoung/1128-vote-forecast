export type PartyId = 'KMT' | 'DPP' | 'TPP' | 'IND';

export const parties = [
  { id: 'KMT' as const, name: '中國國民黨', shortName: '國民黨', color: '#3f69b1' },
  { id: 'DPP' as const, name: '民主進步黨', shortName: '民進黨', color: '#2c8a64' },
  { id: 'TPP' as const, name: '台灣民眾黨', shortName: '民眾黨', color: '#28a5a5' },
  { id: 'IND' as const, name: '無黨籍／其他', shortName: '無黨籍', color: '#8b8f8a' },
];

export function getParty(id: PartyId) {
  return parties.find((party) => party.id === id) ?? parties[3];
}

export function getMockCandidates(contest: { id: string; seatCount: number }) {
  const partyOrder: PartyId[] = ['KMT', 'DPP', 'TPP', 'IND'];
  const singleSeat = contest.seatCount === 1;
  const candidateCount = singleSeat ? partyOrder.length : Math.max(4, contest.seatCount + 4);
  const partyCounts: Record<PartyId, number> = { KMT: 0, DPP: 0, TPP: 0, IND: 0 };

  return Array.from({ length: candidateCount }, (_, index) => {
    const partyId = partyOrder[index % partyOrder.length];
    partyCounts[partyId] += 1;
    return {
      id: `${contest.id}-CANDIDATE-${index + 1}`,
      name: singleSeat
        ? `${getParty(partyId).shortName}候選人`
        : `${getParty(partyId).shortName}候選人 ${partyCounts[partyId]}`,
      partyId,
      number: index + 1,
    };
  });
}
