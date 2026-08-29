import registry from './data/election-contests.json' with { type: 'json' };

/** 席次有沒有官方依據；PDF 公告到齊後直接更新 build 進來的清冊。 */
export type SeatsSource = 'OFFICIAL' | 'PLACEHOLDER';

export const contestTypes = [
  'EXECUTIVE',
  'COUNCIL',
  'TOWNSHIP',
  'REPRESENTATIVE',
  'VILLAGE',
] as const;

export type ContestType = (typeof contestTypes)[number];

export type RegisteredContest = {
  id: string;
  jurisdictionId: string;
  type: ContestType;
  name: string;
  area: string;
  seats: number;
  seatsSource: SeatsSource;
};

const contests = registry.contests as RegisteredContest[];
const byId = new Map(contests.map((contest) => [contest.id, contest]));
const byJurisdiction = contests.reduce((groups, contest) => {
  const list = groups.get(contest.jurisdictionId);
  if (list) list.push(contest);
  else groups.set(contest.jurisdictionId, [contest]);
  return groups;
}, new Map<string, RegisteredContest[]>());

export function getRegisteredContest(contestId: string) {
  return byId.get(contestId) ?? null;
}

export function getRegisteredContests(jurisdictionId: string, type?: ContestType) {
  const list = byJurisdiction.get(jurisdictionId) ?? [];
  return type ? list.filter((contest) => contest.type === type) : list;
}

export function countRegisteredContests() {
  return contests.length;
}

export function listRegisteredContests() {
  return contests;
}
