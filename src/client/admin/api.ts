import { ApiError } from '../api';

/**
 * 後台自己的 fetch client，跟 ../api.ts 是兩個模組。後台不建立 Forecaster 身份，
 * 所以不送 x-forecaster-fingerprint；認證靠 httpOnly cookie（見 admin-session.ts），
 * 不是這裡的責任。這個檔案是唯一知道 /api/admin/* 網址的地方。
 */

export type ContestType = 'EXECUTIVE' | 'COUNCIL' | 'TOWNSHIP' | 'REPRESENTATIVE' | 'VILLAGE';

let onUnauthorized: (() => void) | null = null;

/** AdminApp 掛載時註冊；任何一次 401 都導回登入頁，不必每個頁面各自處理。 */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type RequestOptions = RequestInit & {
  /** 登入本身送出的那次 401（密碼錯誤）不算「session 過期」，不要導頁。 */
  skipAuthRedirect?: boolean;
};

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { skipAuthRedirect, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  // cookie 是 SameSite=Strict，但瀏覽器對它的實作有過空窗；沒有 preflight 的跨站
  // 請求送不出自訂 header，requireAdmin 靠這個再擋一次，所以非 GET 一定要帶。
  if ((rest.method ?? 'GET') !== 'GET') headers.set('x-admin-request', '1');

  const response = await fetch(path, {
    ...rest,
    credentials: 'include',
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (response.status === 401 && !skipAuthRedirect) onUnauthorized?.();
  if (!response.ok) throw new ApiError(data.error ?? '要求失敗，請稍後再試。', response.status);
  return data;
}

// --- 登入 --------------------------------------------------------------

export const adminLogin = (token: string) =>
  request<{ ok: true }>('/api/admin/session', {
    method: 'POST',
    body: JSON.stringify({ token }),
    skipAuthRedirect: true,
  });

export const adminLogout = () => request<{ ok: true }>('/api/admin/session', { method: 'DELETE' });

// --- 總覽 ----------------------------------------------------------------

export type AdminOverview = {
  predictions: { byStatus: Record<string, number>; total: number };
  contestsWithData: number;
  totalContests: number;
  snapshot: { latestCapturedOn: string | null; capturedToday: boolean };
  candidateCoverage: {
    contestsWithCandidates: number;
    totalContests: number;
    byType: Partial<Record<ContestType, number>>;
  };
  redis: { reachable: boolean };
  database: { reachable: boolean };
};

export const getAdminOverview = () => request<AdminOverview>('/api/admin/overview');

// --- 預測使用者 ------------------------------------------------------------

export type AdminForecaster = {
  id: string;
  code: string;
  displayName: string | null;
  predictionCount: number;
  commentCount: number;
  lastIp: string | null;
  lastIpAt: string | null;
  lastCountry: string | null;
  lastRegion: string | null;
  lastCity: string | null;
  lastGeoSource: string | null;
  blockedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
  latestVote: { contestId: string; labels: string[] } | null;
};

export type AdminForecasterSort =
  | 'predictionCount'
  | 'commentCount'
  | 'lastIp'
  | 'lastLocation'
  | 'status'
  | 'createdAt'
  | 'lastSeenAt';
export type SortDirection = 'asc' | 'desc';

export type AdminForecastersPage = {
  items: AdminForecaster[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sort: AdminForecasterSort;
  direction: SortDirection;
};

export const getAdminForecasters = (
  page: number,
  sort: AdminForecasterSort,
  direction: SortDirection,
) =>
  request<AdminForecastersPage>(
    `/api/admin/forecasters?page=${page}&sort=${sort}&direction=${direction}`,
  );

export type AdminForecasterDetail = {
  id: string;
  code: string;
  displayName: string | null;
  blockedAt: string | null;
  humanVerifiedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
  lastIp: string | null;
  lastIpAt: string | null;
  lastCountry: string | null;
  lastRegion: string | null;
  lastCity: string | null;
  lastGeoSource: string | null;
  counts: {
    predictions: number;
    comments: number;
    reports: number;
    signals: number;
  };
  signals: {
    id: string;
    kind: 'COOKIE' | 'FINGERPRINT' | 'IP';
    code: string;
    firstSeenAt: string;
    lastSeenAt: string;
    seenCount: number;
  }[];
};

export type AdminForecasterPrediction = {
  id: string;
  contestId: string;
  seatCount: number;
  status: 'ACTIVE' | 'INVALIDATED';
  invalidReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  contest: { id: string; name: string; area: string; type: ContestType } | null;
  picks: {
    targetType: 'PARTY' | 'CANDIDATE';
    targetId: string;
    partyId: string | null;
    label: string;
    color: string | null;
  }[];
};

export type AdminForecasterComment = {
  id: string;
  contestId: string;
  parentId: string | null;
  body: string;
  status: 'VISIBLE' | 'HIDDEN' | 'DELETED';
  createdAt: string;
  replyCount: number;
  contest: { id: string; name: string; area: string } | null;
};

export type AdminActivityPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const getAdminForecaster = (forecasterId: string) =>
  request<{ forecaster: AdminForecasterDetail }>(
    `/api/admin/forecasters/${encodeURIComponent(forecasterId)}`,
  );

export const getAdminForecasterPredictions = (forecasterId: string, page: number) =>
  request<AdminActivityPage<AdminForecasterPrediction>>(
    `/api/admin/forecasters/${encodeURIComponent(forecasterId)}/predictions?page=${page}`,
  );

export const getAdminForecasterComments = (forecasterId: string, page: number) =>
  request<AdminActivityPage<AdminForecasterComment>>(
    `/api/admin/forecasters/${encodeURIComponent(forecasterId)}/comments?page=${page}`,
  );

// --- 候選人 CSV -------------------------------------------------------------

export type CandidateImportSummary = {
  candidates: number;
  contests: number;
  create: number;
  update: number;
  unchanged: number;
  removePlaceholders: number;
};

export type CandidateImportRow = {
  code: string;
  contestId: string;
  name: string;
  partyId: string;
  ballotNo: number | null;
  status: string;
};

export type CandidateImportUpdate = {
  code: string;
  name: string;
  changes: {
    field: string;
    before: string | number | null;
    after: string | number | null;
  }[];
};

export type AdminCandidate = {
  id: string;
  contestId: string;
  contestName: string;
  contestType: ContestType | null;
  name: string;
  partyId: string | null;
};

export const getAdminCandidates = () =>
  request<{ candidates: AdminCandidate[] }>('/api/admin/candidates');

export async function exportCandidateCsv() {
  const response = await fetch('/api/admin/candidates/export', {
    credentials: 'include',
  });
  if (response.status === 401) onUnauthorized?.();
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(data.error ?? '要求失敗，請稍後再試。', response.status);
  }
  const match = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/i);
  return {
    blob: await response.blob(),
    fileName: match?.[1] ?? 'candidate-import.csv',
  };
}

export const updateAdminCandidate = ({
  id,
  name,
  contestId,
  partyId,
}: Pick<AdminCandidate, 'id' | 'name' | 'contestId' | 'partyId'>) =>
  request<{ candidate: AdminCandidate }>(`/api/admin/candidates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, contestId, partyId }),
  });

export const deleteAdminCandidate = (id: string) =>
  request<{ ok: true }>(`/api/admin/candidates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export type CandidateVisibilitySettings = {
  hidePlaceholderCandidates: boolean;
  candidateVisibilityVersion: number;
  placeholderCount: number;
};

export const getCandidateVisibility = () =>
  request<CandidateVisibilitySettings>('/api/admin/candidate-visibility');

export const saveCandidateVisibility = (hidePlaceholderCandidates: boolean) =>
  request<{
    hidePlaceholderCandidates: boolean;
    candidateVisibilityVersion: number;
  }>('/api/admin/candidate-visibility', {
    method: 'PUT',
    body: JSON.stringify({ hidePlaceholderCandidates }),
  });

export const previewCandidateCsv = (csv: string) =>
  request<{
    summary: CandidateImportSummary;
    rows: CandidateImportRow[];
    updates: CandidateImportUpdate[];
  }>('/api/admin/candidates/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    body: csv,
  });

export const importCandidateCsv = (csv: string, replaceCodes: string[]) =>
  request<{ summary: CandidateImportSummary }>('/api/admin/candidates/import', {
    method: 'POST',
    body: JSON.stringify({ csv, replaceCodes }),
  });

// --- 使用者候選人提案 -------------------------------------------------------

export type AdminCandidateContribution = {
  id: string;
  kind: 'NEW_CANDIDATE' | 'PHOTO_UPDATE';
  contestId: string;
  contestName: string;
  candidateId: string;
  candidateName: string;
  partyId: string | null;
  photoUrl: string;
  createdAt: string;
  forecaster: { code: string; displayName: string | null };
};

export const getCandidateContributions = () =>
  request<{ contributions: AdminCandidateContribution[] }>('/api/admin/candidate-contributions');

export const approveCandidateContribution = (contributionId: string) =>
  request<{ ok: true }>(
    `/api/admin/candidate-contributions/${encodeURIComponent(contributionId)}/approve`,
    { method: 'POST' },
  );

export const rejectCandidateContribution = (contributionId: string) =>
  request<{ ok: true }>(
    `/api/admin/candidate-contributions/${encodeURIComponent(contributionId)}/reject`,
    { method: 'POST' },
  );

// --- 檢舉／留言審核 ---------------------------------------------------------

export type ReportReason = 'SPAM' | 'ABUSE' | 'ADULT' | 'ILLEGAL' | 'OTHER';

export type AdminReport = {
  id: string;
  targetType: 'COMMENT';
  targetId: string;
  reason: ReportReason;
  note: string | null;
  status: 'OPEN' | 'ACTIONED' | 'DISMISSED';
  createdAt: string;
  /** 讓佇列不用再打第二次要求就能判斷——留言本體與作者短碼直接併進來。 */
  comment: {
    id: string;
    body: string;
    status: 'VISIBLE' | 'HIDDEN' | 'DELETED';
    contestId: string;
    forecaster: { id: string; code: string; displayName: string | null };
  } | null;
};

export type AdminHiddenComment = NonNullable<AdminReport['comment']>;
export type AdminBlockedForecaster = {
  id: string;
  code: string;
  displayName: string | null;
  blockedAt: string;
};

export const getReports = () =>
  request<{
    reports: AdminReport[];
    hiddenComments: AdminHiddenComment[];
    blockedForecasters: AdminBlockedForecaster[];
  }>('/api/admin/reports');

export const hideComment = (commentId: string) =>
  request<{ ok: true }>(`/api/admin/comments/${encodeURIComponent(commentId)}/hide`, {
    method: 'POST',
  });

export const restoreComment = (commentId: string) =>
  request<{ ok: true }>(`/api/admin/comments/${encodeURIComponent(commentId)}/restore`, {
    method: 'POST',
  });

export const dismissReport = (reportId: string, note?: string) =>
  request<{ ok: true }>(`/api/admin/reports/${encodeURIComponent(reportId)}/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });

export const blockForecaster = (forecasterId: string) =>
  request<{ ok: true }>(`/api/admin/forecasters/${encodeURIComponent(forecasterId)}/block`, {
    method: 'POST',
  });

export const unblockForecaster = (forecasterId: string) =>
  request<{ ok: true }>(`/api/admin/forecasters/${encodeURIComponent(forecasterId)}/unblock`, {
    method: 'POST',
  });

// --- 全站公告 ----------------------------------------------------------

export type AdminAnnouncement = {
  version: number;
  published: boolean;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  updatedAt: string;
};

export type AnnouncementDraft = {
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  published: boolean;
};

export const getAdminAnnouncement = () =>
  request<{ announcement: AdminAnnouncement | null }>('/api/admin/announcement');

export const saveAnnouncement = (draft: AnnouncementDraft) =>
  request<{ announcement: AdminAnnouncement; versionBumped: boolean }>('/api/admin/announcement', {
    method: 'PUT',
    body: JSON.stringify(draft),
  });
