import { randomBytes } from 'node:crypto';
import migration from './data/candidate-id-migration.json' with { type: 'json' };

export function candidateIdPrefix(partyId: string | null, contestId: string) {
  return `${partyId ?? 'IND'}-${contestId}-`;
}

export function isCanonicalCandidateId(
  candidateId: string,
  partyId: string | null,
  contestId: string,
) {
  const prefix = candidateIdPrefix(partyId, contestId);
  return candidateId.startsWith(prefix) && /^[A-F0-9]{8}$/.test(candidateId.slice(prefix.length));
}

export function createCandidateId(partyId: string | null, contestId: string) {
  return `${candidateIdPrefix(partyId, contestId)}${randomBytes(4).toString('hex').toUpperCase()}`;
}

const aliases = new Map(
  (migration.entries as { from: string; to: string }[]).flatMap(({ from, to }) => [
    [from, to],
    [to, from],
  ]),
);

export function alternateCandidateId(candidateId: string) {
  return aliases.get(candidateId) ?? null;
}
