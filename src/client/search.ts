import {
  type Contest,
  type Jurisdiction,
  getContests,
  getMockCandidates,
  jurisdictions,
} from './mock-election';

export type SearchHit = {
  id: string;
  /** 顯示在第一行，命中的字會在這裡標色。 */
  label: string;
  /** 第二行的來歷，例如「臺北市 · 臺北市全境」。 */
  sub: string;
  to: string;
  /** 不一定顯示、但可用來找職務分類（例如「縣市長」）的關鍵字。 */
  keywords?: string;
  candidate?: boolean;
};

// 縣市與議員選區是靜態的，候選人由選區推出來；鄉鎮市長、代表、村里長要載入圖資
// 才知道有哪些，不在這份索引裡。索引只建一次，第一次搜尋時才建。
let index: SearchHit[] | null = null;

function contestHits(jurisdiction: Jurisdiction, contest: Contest): SearchHit[] {
  const sub = `${jurisdiction.name} · ${contest.area}`;
  const to = `/contest/${contest.id}`;
  const office =
    contest.view === 'EXECUTIVE'
      ? '縣市長 首長'
      : contest.view === 'COUNCIL'
        ? '議員'
        : contest.view === 'TOWNSHIP'
          ? '鄉鎮市長'
          : contest.view === 'REPRESENTATIVE'
            ? '代表'
            : '村里長';
  return [
    { id: contest.id, label: contest.name, sub, to, keywords: office },
    // 選區名（例如「內湖區、南港區」）自己也要搜得到，但顯示的還是選舉名稱。
    {
      id: `${contest.id}-area`,
      label: contest.area,
      sub: `${jurisdiction.name}${contest.name}`,
      to,
      keywords: office,
    },
    ...getMockCandidates(contest).map((candidate) => ({
      id: candidate.id,
      label: candidate.name,
      sub: `${jurisdiction.name}${contest.name}`,
      to,
      candidate: true,
    })),
  ];
}

function buildIndex(): SearchHit[] {
  return jurisdictions.flatMap((jurisdiction) => [
    {
      id: jurisdiction.id,
      label: jurisdiction.name,
      sub: '縣市選情總覽',
      to: `/region/${jurisdiction.id}`,
    },
    ...getContests(jurisdiction, 'EXECUTIVE').flatMap((contest) =>
      contestHits(jurisdiction, contest),
    ),
    ...getContests(jurisdiction, 'COUNCIL').flatMap((contest) =>
      contestHits(jurisdiction, contest),
    ),
  ]);
}

export function searchEverything(
  query: string,
  limit = 6,
  includeCandidateHits = true,
): SearchHit[] {
  const needle = query.trim();
  if (!needle) return [];
  index ??= buildIndex();
  const hits: SearchHit[] = [];
  for (const hit of index) {
    if (!includeCandidateHits && hit.candidate) continue;
    if (hit.label.includes(needle) || hit.keywords?.includes(needle)) hits.push(hit);
    if (hits.length === limit) break;
  }
  return hits;
}

/** 把字串切成命中與未命中的片段，交給畫面標色。 */
export function highlightParts(text: string, query: string) {
  const needle = query.trim();
  if (!needle) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let rest = text;
  let at = rest.indexOf(needle);
  while (at !== -1) {
    if (at > 0) parts.push({ text: rest.slice(0, at), hit: false });
    parts.push({ text: needle, hit: true });
    rest = rest.slice(at + needle.length);
    at = rest.indexOf(needle);
  }
  if (rest) parts.push({ text: rest, hit: false });
  return parts;
}
