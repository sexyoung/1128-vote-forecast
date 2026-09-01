import { getFingerprint } from './fingerprint';

/**
 * 後端 API。身份靠 httpOnly cookie，所以每個請求都要 `credentials: 'include'`；
 * 指紋放在 header 上，只在 cookie 被清掉時當作認回身份的線索。
 */

export type Session = {
  forecaster: {
    id: string;
    displayName: string | null;
    predictionCount: number;
    humanVerified: boolean;
    blocked: boolean;
  };
  turnstile: { siteKey: string } | null;
};

/** 一場選舉現在可以押的目標。名單公布後這裡會換成真候選人，前端不用改。 */
export type PredictionTarget = {
  targetType: 'PARTY' | 'CANDIDATE';
  targetId: string;
  partyId: string | null;
  label: string;
  ballotNo: number | null;
  photo: string | null;
};

export type TallyRow = {
  targetType: string;
  targetId: string;
  count: number;
  percent: number;
  label: string;
  partyId: string | null;
  color: string | null;
  photo: string | null;
};

export type ContestDetail = {
  contest: {
    id: string;
    jurisdictionId: string;
    type: 'EXECUTIVE' | 'COUNCIL' | 'TOWNSHIP' | 'REPRESENTATIVE' | 'VILLAGE';
    name: string;
    area: string;
    seats: number;
    seatsSource: 'OFFICIAL' | 'PLACEHOLDER';
  };
  targets: PredictionTarget[];
  tally: { totalPredictions: number; totalPicks: number; rows: TallyRow[] };
  mine: { contestId: string; version: number; targetIds: string[] } | null;
};

export type ContestListTally = ContestDetail['tally'] & { targets: PredictionTarget[] };

export type PartyContestsPage = {
  items: {
    contest: ContestDetail['contest'];
    hasPredictions: boolean;
    candidate: {
      id: string;
      name: string;
      ballotNo: number | null;
      photo: string | null;
      predictionCount: number;
      predictionPercent: number;
      predictedElected: boolean;
    };
  }[];
  page: number;
  pageSize: number;
  total: number;
  candidateTotal: number;
  activeType: ContestDetail['contest']['type'] | null;
  totalPages: number;
  regions: {
    id: string;
    candidateCount: number;
    offices: { type: ContestDetail['contest']['type']; candidateCount: number }[];
  }[];
};

export type CandidateRanking = {
  rank: number;
  id: string;
  name: string;
  photo: string | null;
  party: { id: string; name: string; color: string };
  contest: ContestDetail['contest'];
  predictionCount: number;
};

export type MapCell = {
  contestId: string;
  party: string | null;
  tiedParties?: string[];
  percent: number;
  total: number;
};

export type TrendSeries = {
  targetId: string;
  label: string;
  partyId: string | null;
  color: string | null;
  points: { date: string; count: number }[];
};

export type Comment = {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: { id: string; code: string; displayName: string | null };
};

export type ReportReason = 'SPAM' | 'ABUSE' | 'ADULT' | 'ILLEGAL' | 'OTHER';

export type Announcement = {
  version: number;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
};

export class ApiError extends Error {
  status: number;
  /** 伺服器要求先過人機驗證。前端該把 Turnstile 叫出來再送一次。 */
  needsTurnstile: boolean;

  constructor(message: string, status: number, needsTurnstile = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.needsTurnstile = needsTurnstile;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Headers 收得下陣列與物件兩種寫法，展開 init.headers 則只吃得下物件。
  const headers = new Headers(init.headers);
  headers.set('x-forecaster-fingerprint', await getFingerprint());
  if (init.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, { ...init, credentials: 'include', headers });

  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    needsTurnstile?: boolean;
  };
  if (!response.ok)
    throw new ApiError(
      data.error ?? '要求失敗，請稍後再試。',
      response.status,
      data.needsTurnstile === true,
    );
  return data;
}

export const getSession = () => request<Session>('/api/session');

export const getCandidateVisibility = () =>
  request<{ hidePlaceholderCandidates: boolean; candidateVisibilityVersion: string }>(
    '/api/settings/candidate-visibility',
  );

export const updateDisplayName = (displayName: string | null) =>
  request<{ displayName: string | null }>('/api/me', {
    method: 'PUT',
    body: JSON.stringify({ displayName }),
  });

/** 一次拿好幾個選區的分布，給卡片牆用。 */
export const getContestTallies = (contestIds: string[]) =>
  request<{ tallies: Record<string, ContestListTally> }>(
    `/api/contests?ids=${encodeURIComponent(contestIds.join(','))}`,
  );

export const getContest = (contestId: string) =>
  request<ContestDetail>(`/api/contests/${encodeURIComponent(contestId)}`);

export type CandidateContributionDraft =
  | { kind: 'NEW_CANDIDATE'; candidateName: string; partyId: string | null; photoUrl: string }
  | { kind: 'PHOTO_UPDATE'; candidateId: string; photoUrl: string };

export const submitCandidateContribution = (
  contestId: string,
  contribution: CandidateContributionDraft,
) =>
  request<{ contribution: { id: string; candidateId: string } }>(
    `/api/contests/${encodeURIComponent(contestId)}/candidate-contributions`,
    { method: 'POST', body: JSON.stringify(contribution) },
  );

export const getPartyCandidateCounts = () =>
  request<{
    parties: Record<
      string,
      {
        candidateCount: number;
        offices: { type: ContestDetail['contest']['type']; candidateCount: number }[];
      }
    >;
  }>('/api/parties');

export const getCandidateRankings = () =>
  request<{ candidates: CandidateRanking[] }>('/api/rankings/candidates');

export const searchCandidateNames = (query: string) =>
  request<{
    candidates: { id: string; label: string; sub: string; to: string }[];
  }>(`/api/search/candidates?q=${encodeURIComponent(query)}`);

export const getPartyContests = (partyId: string, page: number, regionId: string, view: string) =>
  request<PartyContestsPage>(
    `/api/parties/${encodeURIComponent(partyId)}/contests?page=${page}&region=${encodeURIComponent(regionId)}&view=${encodeURIComponent(view)}`,
  );

export const submitPrediction = (contestId: string, targetIds: string[], turnstileToken?: string) =>
  request<Pick<ContestDetail, 'mine' | 'tally'>>(
    `/api/contests/${encodeURIComponent(contestId)}/prediction`,
    { method: 'POST', body: JSON.stringify({ targetIds, turnstileToken }) },
  );

export const getMyPredictions = () =>
  request<{
    predictions: {
      contest: ContestDetail['contest'];
      status: string;
      updatedAt: string;
      picks: { targetId: string; label: string; partyId: string | null; color: string | null }[];
      tally: ContestDetail['tally'];
    }[];
  }>('/api/me/predictions');

export const getNationalMap = () => request<{ cells: MapCell[] }>('/api/map/national');

export const getJurisdictionMap = (jurisdictionId: string, level: string) =>
  request<{ cells: MapCell[] }>(
    `/api/map/${encodeURIComponent(jurisdictionId)}?level=${encodeURIComponent(level)}`,
  );

export const getTrend = (contestId: string, days = 30) =>
  request<{ days: number; series: TrendSeries[] }>(
    `/api/contests/${encodeURIComponent(contestId)}/trend?days=${days}`,
  );

export const getComments = (contestId: string, cursor?: string) =>
  request<{ comments: Comment[]; nextCursor: string | null }>(
    `/api/contests/${encodeURIComponent(contestId)}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );

export const postComment = (contestId: string, body: string, parentId?: string) =>
  request<{ comment: Comment }>(`/api/contests/${encodeURIComponent(contestId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, parentId }),
  });

export const reportComment = (targetId: string, reason: ReportReason) =>
  request<{ reportId: string }>('/api/reports', {
    method: 'POST',
    body: JSON.stringify({ targetType: 'COMMENT', targetId, reason }),
  });

export const getAnnouncement = () =>
  request<{ announcement: Announcement | null }>('/api/announcement');
