import { prisma } from './db.js';

const singletonId = 'global';
const placeholderMarker = '-CANDIDATE-';
const refreshIntervalMs = 5_000;

type CandidateVisibility = {
  hidePlaceholderCandidates: boolean;
  candidateVisibilityVersion: number;
};

let visibility: CandidateVisibility = {
  hidePlaceholderCandidates: false,
  candidateVisibilityVersion: 1,
};
let lastLoadedAt = 0;

export function isPlaceholderCandidateId(candidateId: string) {
  return candidateId.includes(placeholderMarker);
}

export function placeholderCandidatesHidden() {
  return visibility.hidePlaceholderCandidates;
}

export function isVisibleCandidateId(candidateId: string) {
  return !visibility.hidePlaceholderCandidates || !isPlaceholderCandidateId(candidateId);
}

/** 候選人相關快取的版本。切換開關時改 namespace，舊快取不會再被讀到。 */
export function candidateVisibilityCacheKey() {
  return `${visibility.hidePlaceholderCandidates ? 'formal' : 'all'}-v${visibility.candidateVisibilityVersion}`;
}

export async function refreshCandidateVisibility(force = false) {
  if (!force && Date.now() - lastLoadedAt < refreshIntervalMs) return visibility;

  const row = await prisma.siteSetting.findUnique({
    where: { id: singletonId },
    select: { hidePlaceholderCandidates: true, candidateVisibilityVersion: true },
  });
  visibility = row ?? { hidePlaceholderCandidates: false, candidateVisibilityVersion: 1 };
  lastLoadedAt = Date.now();
  return visibility;
}

export async function saveCandidateVisibility(hidePlaceholderCandidates: boolean) {
  const row = await prisma.siteSetting.upsert({
    where: { id: singletonId },
    create: { id: singletonId, hidePlaceholderCandidates, candidateVisibilityVersion: 2 },
    update: {
      hidePlaceholderCandidates,
      candidateVisibilityVersion: { increment: 1 },
    },
    select: { hidePlaceholderCandidates: true, candidateVisibilityVersion: true },
  });
  visibility = row;
  lastLoadedAt = Date.now();
  return visibility;
}
