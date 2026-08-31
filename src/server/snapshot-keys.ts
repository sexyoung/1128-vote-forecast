import { contestTypes } from './contest-registry.js';

/**
 * 快照的 key 命名。寫預測時要清掉它們，讀的時候要建它們——兩邊都需要，但
 * predictions 與 snapshots 互相 import 會變成循環，所以名字放在這裡。
 */
export const nationalKey = 'snap:map:national';

export function jurisdictionKey(jurisdictionId: string, type: string) {
  return `snap:map:${jurisdictionId}:${type}`;
}

export function commentsKey(contestId: string) {
  return `snap:comments:${contestId}:p1`;
}

export function contestKey(contestId: string) {
  return `snap:contest:${contestId}`;
}

export function tallyKey(contestId: string) {
  return `snap:tally:${contestId}`;
}

export const candidateRankingsKey = 'snap:rankings:candidates';
export const partyCountsKey = 'snap:parties:counts';
export const publicAnnouncementKey = 'snap:announcement:public';
export const candidateDataKey = 'data:candidates:v1';

export function partyCandidatesKey(partyId: string) {
  return `snap:parties:${partyId}:candidates`;
}

/** 一筆預測會影響這個選區、它所屬縣市的每一層，以及全國地圖。 */
export function keysAffectedBy(contestId: string, jurisdictionId: string) {
  return [
    contestKey(contestId),
    tallyKey(contestId),
    candidateRankingsKey,
    nationalKey,
    ...contestTypes.map((type) => jurisdictionKey(jurisdictionId, type)),
  ];
}
