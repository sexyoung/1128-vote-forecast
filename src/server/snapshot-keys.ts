import { contestTypes } from './contest-registry.js';
import { candidateVisibilityCacheKey } from './site-settings.js';

/**
 * 快照的 key 命名。寫預測時要清掉它們，讀的時候要建它們——兩邊都需要，但
 * predictions 與 snapshots 互相 import 會變成循環，所以名字放在這裡。
 */
const candidateKey = () => `:cv:${candidateVisibilityCacheKey()}`;

export const nationalKey = () => `snap:map:national${candidateKey()}`;

export function jurisdictionKey(jurisdictionId: string, type: string) {
  return `snap:map:${jurisdictionId}:${type}${candidateKey()}`;
}

export function commentsKey(contestId: string) {
  return `snap:comments:${contestId}:p1`;
}

export function contestKey(contestId: string) {
  return `snap:contest:${contestId}${candidateKey()}`;
}

export function tallyKey(contestId: string) {
  return `snap:tally:${contestId}${candidateKey()}`;
}

export const battlegroundRankingsKey = () => `snap:rankings:battlegrounds${candidateKey()}`;
export const partyCountsKey = () => `snap:parties:counts${candidateKey()}`;
export const publicAnnouncementKey = 'snap:announcement:public';
export const candidateDataKey = 'data:candidates:gzip:v2';

export function partyCandidatesKey(partyId: string) {
  return `snap:parties:${partyId}:candidates${candidateKey()}`;
}

/** 一筆預測會影響這個選區、它所屬縣市的每一層，以及全國地圖。 */
export function keysAffectedBy(contestId: string, jurisdictionId: string) {
  return [
    contestKey(contestId),
    tallyKey(contestId),
    battlegroundRankingsKey(),
    nationalKey(),
    ...contestTypes.map((type) => jurisdictionKey(jurisdictionId, type)),
  ];
}
