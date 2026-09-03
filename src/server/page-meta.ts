import { electionViews, jurisdictions } from '../client/mock-election.js';
import { summariseArea } from '../shared/area.js';
import { candidateParties } from '../shared/candidates.js';
import {
  type ContestType,
  type RegisteredContest,
  countRegisteredContests,
  getRegisteredContest,
  getRegisteredContests,
  listRegisteredContests,
} from './contest-registry.js';
import { seoIndexable } from './env.js';

export const siteName = '九合一選舉預測';
export const defaultOgImage = '/og-image.webp';
const indexableTypes = new Set<ContestType>(['EXECUTIVE', 'COUNCIL', 'TOWNSHIP']);
const indexRobots = 'index,follow,max-image-preview:large';
const seoViewLabels: Record<ContestType, string> = {
  EXECUTIVE: '縣市長',
  COUNCIL: '議員',
  TOWNSHIP: '鄉鎮市長',
  REPRESENTATIVE: '鄉鎮市民代表',
  VILLAGE: '村里長',
};

export type PageMeta = {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  canonical: string;
  robots: string;
  status: 200 | 404;
  private?: boolean;
  jsonLd?: object;
  ogImage?: string;
  ogUrl?: string;
};

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => escapes[char]);
const qualify = (contest: RegisteredContest, jurisdiction: string) =>
  contest.name.startsWith(jurisdiction) ? contest.name : `${jurisdiction}${contest.name}`;
const findJurisdiction = (id: string) => jurisdictions.find((item) => item.id === id) ?? null;
const formatCount = (count: number) => count.toLocaleString('en-US');
const officeName = (jurisdiction: (typeof jurisdictions)[number], view: ContestType) =>
  view === 'EXECUTIVE'
    ? `${jurisdiction.name.slice(0, -1)}${jurisdiction.kind === 'county' ? '縣長' : '市長'}`
    : `${jurisdiction.name}${seoViewLabels[view]}`;

function seatsLabel(contest: RegisteredContest) {
  if (contest.seatsSource === 'PLACEHOLDER') return `暫定 ${contest.seats} 席`;
  return contest.seats === 1 ? '' : `應選 ${contest.seats} 席`;
}

function absolute(origin: string, path: string) {
  return new URL(path, `${origin}/`).toString();
}

export function resolvePageMeta(
  pathname: string,
  search: URLSearchParams,
  options: {
    origin: string;
    indexable?: boolean;
    ogImage?: string;
    contestLeader?: { label: string; percent: number };
  },
): PageMeta {
  const origin = options.origin.replace(/\/$/, '');
  const canIndex = options.indexable ?? seoIndexable;
  const shareTimestamp = /^\d{10,13}$/.test(search.get('t') ?? '') ? search.get('t') : null;
  const robots = (value = indexRobots) => (canIndex ? value : 'noindex,nofollow');
  const finish = (meta: PageMeta): PageMeta => {
    const image = options.ogImage ?? (!meta.private && meta.status === 200 ? defaultOgImage : null);
    const extraJsonLd = meta.jsonLd
      ? Object.fromEntries(Object.entries(meta.jsonLd).filter(([key]) => key !== '@context'))
      : null;
    return {
      ...meta,
      robots: robots(meta.robots),
      ogImage: image ? absolute(origin, image) : undefined,
      jsonLd:
        !meta.private && meta.status === 200 && meta.canonical
          ? {
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'WebPage',
                  '@id': `${meta.canonical}#webpage`,
                  url: meta.canonical,
                  name: meta.title,
                  description: meta.description,
                  inLanguage: 'zh-Hant-TW',
                  isPartOf: { '@id': absolute(origin, '/#website') },
                  ...(image
                    ? {
                        primaryImageOfPage: {
                          '@type': 'ImageObject',
                          url: absolute(origin, image),
                        },
                      }
                    : {}),
                },
                ...(extraJsonLd ? [extraJsonLd] : []),
              ],
            }
          : undefined,
      ogUrl:
        shareTimestamp && meta.canonical
          ? absolute(origin, `${pathname}?${search.toString()}`)
          : meta.ogUrl,
    };
  };

  if (pathname === '/') {
    const count = formatCount(countRegisteredContests());
    return finish({
      title: '2026 九合一選舉預測｜全臺縣市長、議員與地方選舉',
      description: `查看 2026 年 11 月 28 日九合一選舉群眾預測地圖，涵蓋全臺 22 縣市、共 ${count} 個縣市長、議員、鄉鎮市長、代表與村里長選區。`,
      ogTitle: '2026 九合一選舉預測｜全臺選情地圖',
      ogDescription: `涵蓋全臺 22 縣市、共 ${count} 個選區，查看縣市長、議員與地方選舉的最新群眾預測。`,
      canonical: absolute(origin, '/'),
      robots: indexRobots,
      status: 200,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': absolute(origin, '/#website'),
        name: siteName,
        alternateName: '2026 地方選舉群眾預測地圖',
        url: absolute(origin, '/'),
        inLanguage: 'zh-Hant-TW',
      },
    });
  }

  if (pathname === '/regions')
    return finish({
      title: `2026 全臺縣市長選舉預測｜22 縣市選情總覽｜${siteName}`,
      description:
        '一次瀏覽 2026 九合一選舉全臺 22 縣市的縣市長候選人與群眾預測分布，比較各地目前的領先者與選情差距。',
      ogTitle: '2026 全臺縣市長選舉預測',
      ogDescription: '一次瀏覽全臺 22 縣市的縣市長候選人、領先者與最新群眾預測分布。',
      canonical: absolute(origin, '/regions'),
      robots: indexRobots,
      status: 200,
    });

  if (pathname === '/parties')
    return finish({
      title: `2026 九合一選舉政黨候選人一覽｜各黨提名布局｜${siteName}`,
      description:
        '整理各政黨在 2026 九合一選舉的候選人數、參選職位與行政區分布，快速查看各黨在全臺的提名名單與地方布局。',
      ogTitle: '2026 九合一選舉政黨候選人一覽',
      ogDescription: '查看各政黨的候選人數、參選職位、行政區分布與全臺提名布局。',
      canonical: absolute(origin, '/parties'),
      robots: indexRobots,
      status: 200,
    });

  if (pathname === '/rankings')
    return finish({
      title: `2026 九合一選舉激戰選區 Top 20｜預測票數最接近｜${siteName}`,
      description:
        '整理 2026 九合一選舉第一、二名預測票數最接近的 20 個單席選區，查看各候選人的政黨、預測票數與佔比。',
      ogTitle: '2026 九合一選舉激戰選區 Top 20',
      ogDescription: '第一、二名預測票數最接近的單席選區排行，查看各候選人的政黨、票數與佔比。',
      canonical: absolute(origin, '/rankings'),
      robots: indexRobots,
      status: 200,
    });

  const partyMatch = /^\/parties\/([^/]+)$/.exec(pathname);
  if (partyMatch) {
    const party = candidateParties.find(({ id }) => id === partyMatch[1].toUpperCase());
    if (!party) return notFound();
    const jurisdiction = findJurisdiction((search.get('region') ?? '').toUpperCase());
    const view = jurisdiction
      ? (electionViews.find(
          (item) => item.id.toLowerCase() === search.get('view')?.toLowerCase(),
        ) ?? electionViews[0])
      : undefined;
    const office = jurisdiction && view ? officeName(jurisdiction, view.id) : null;
    const subject = jurisdiction
      ? `2026 ${office}候選人｜${party.name}`
      : `${party.name} 2026 九合一選舉候選人`;
    const description = jurisdiction
      ? `查看${party.name}參選 2026 ${office}的候選人名單、參選選區與目前群眾預測結果。`
      : `查看${party.name}投入 2026 九合一選舉的候選人名單、參選職位、行政區分布與目前群眾預測結果。`;
    const canonical = jurisdiction
      ? `/parties/${party.id}?region=${jurisdiction.id}${view?.id === 'EXECUTIVE' ? '' : `&view=${view?.id.toLowerCase()}`}`
      : `/parties/${party.id}`;
    return finish({
      title: `${subject}｜${siteName}`,
      description,
      ogTitle: subject,
      ogDescription: description,
      canonical: absolute(origin, canonical),
      robots: indexRobots,
      status: 200,
    });
  }

  const regionMatch = /^\/region\/([^/]+)$/.exec(pathname);
  if (regionMatch) {
    const jurisdiction = findJurisdiction(regionMatch[1]);
    if (!jurisdiction) return notFound();
    const view =
      electionViews.find((item) => item.id.toLowerCase() === search.get('view')?.toLowerCase())
        ?.id ?? 'EXECUTIVE';
    const office = officeName(jurisdiction, view);
    const count = getRegisteredContests(jurisdiction.id, view).length;
    const overview = view === 'EXECUTIVE';
    const canonical = `/region/${jurisdiction.id}${overview ? '' : `?view=${view.toLowerCase()}`}`;
    const description = overview
      ? `查看 2026 ${office}選舉候選人與最新群眾預測分布，比較目前領先者、預測比例與選情變化。`
      : view === 'COUNCIL'
        ? `查看 2026 ${office}各選區候選人、應選席次與群眾預測分布，觀察目前可能勝出的席次組合。`
        : `瀏覽 2026 ${office}各選區候選人與群眾預測分布，查看目前各地受到看好的人選。`;
    return finish({
      title: `2026 ${office}選舉預測｜候選人與最新選情｜${siteName}`,
      description,
      ogTitle: `2026 ${office}選舉預測`,
      ogDescription: description,
      canonical: absolute(origin, canonical),
      robots: count === 0 ? 'noindex,follow' : indexRobots,
      status: 200,
      jsonLd: breadcrumbs(origin, jurisdiction.name, jurisdiction.id),
    });
  }

  const contestMatch = /^\/contest\/([^/]+)$/.exec(pathname);
  if (contestMatch) {
    const contest = getRegisteredContest(contestMatch[1]);
    const jurisdiction = contest ? findJurisdiction(contest.jurisdictionId) : null;
    if (!contest || !jurisdiction) return notFound();
    const name = qualify(contest, jurisdiction.name);
    const leader = shareTimestamp && contest.seats === 1 ? options.contestLeader : undefined;
    const singleSeatTitle = `${name}最多人預測的是.....`;
    const seats = seatsLabel(contest);
    const seatSentence =
      contest.seatsSource === 'PLACEHOLDER'
        ? `名額依地方制度法第 33 條按人口決定，公告前先以 ${contest.seats} 席暫定`
        : contest.seats === 1
          ? '選出你認為最可能勝出的人'
          : `預測 ${contest.seats} 席最終歸屬`;
    return finish({
      title: `${contest.seats === 1 ? (leader ? `${name}最多人預測的是${leader.label}` : singleSeatTitle) : `${name}預測${seats ? `｜${seats}` : ''}`}｜${siteName}`,
      description: leader
        ? `目前最多人預測 ${leader.label} 勝出${name}選舉，占 ${leader.percent}% 的預測選擇。查看完整分布，也留下你的選擇。這是群眾預測，不是民調。`
        : contest.seats === 1
          ? `查看${name}目前的群眾預測分布，並留下你認為最可能勝出的候選人。這是群眾預測，不是民調。`
          : `${name}（${summariseArea(contest.area)}）的群眾預測分布，${seatSentence}。匿名就能押，每個身份在本選區只計一份，可隨時修改。`,
      ogTitle: leader
        ? `${name}最多人預測的是${leader.label}`
        : contest.seats === 1
          ? singleSeatTitle
          : `${name}預測`,
      ogDescription: leader
        ? `${leader.label}目前以 ${leader.percent}% 的預測選擇居首。查看${name}完整預測分布。`
        : contest.seats === 1
          ? `查看${name}最新群眾預測分布，看看目前最多人預測誰會勝出。`
          : `${summariseArea(contest.area)}。看 2026 九合一選舉這一區的群眾預測分布。`,
      canonical: absolute(origin, `/contest/${contest.id}`),
      robots: indexableTypes.has(contest.type) ? indexRobots : 'noindex,follow',
      status: 200,
      jsonLd: breadcrumbs(origin, jurisdiction.name, jurisdiction.id, contest.name),
    });
  }

  // 站務頁面：內容固定，沒有 seed，只要 canonical 與可索引的標題。
  const staticPages: Record<string, { title: string; description: string }> = {
    '/privacy': {
      title: '隱私權政策',
      description:
        '說明九合一選舉預測會存哪些資料、哪些會公開、保存多久，以及你可以怎麼修改或刪除自己的預測與留言。',
    },
    '/terms': {
      title: '使用條款',
      description:
        '九合一選舉預測的使用規則：這是群眾預測不是民調、一人一區一份預測、留言規範與免責聲明。',
    },
    '/changelog': {
      title: '更新紀錄',
      description: '九合一選舉預測每次上版新增與修正了什麼，依版本由新到舊排列。',
    },
  };
  const staticPage = staticPages[pathname];
  if (staticPage)
    return finish({
      title: `${staticPage.title}｜${siteName}`,
      description: staticPage.description,
      ogTitle: staticPage.title,
      ogDescription: staticPage.description,
      canonical: absolute(origin, pathname),
      robots: indexRobots,
      status: 200,
    });

  if (pathname === '/mine')
    return finish({
      title: `我的預測｜${siteName}`,
      description: '查看與修改你在各選區留下的預測。',
      ogTitle: '我的預測',
      ogDescription: '查看與修改你的選舉預測。',
      canonical: '',
      robots: 'noindex,nofollow',
      status: 200,
      private: true,
    });

  if (pathname === '/admin' || pathname.startsWith('/admin/'))
    return finish({
      title: `後台｜${siteName}`,
      description: '站點管理後台。',
      ogTitle: '後台',
      ogDescription: '站點管理後台。',
      canonical: '',
      robots: 'noindex,nofollow',
      status: 200,
      private: true,
    });

  return notFound();
}

function breadcrumbs(origin: string, jurisdiction: string, id: string, contest?: string) {
  const items = [
    { '@type': 'ListItem', position: 1, name: '全國', item: absolute(origin, '/regions') },
    {
      '@type': 'ListItem',
      position: 2,
      name: jurisdiction,
      ...(contest ? { item: absolute(origin, `/region/${id}`) } : {}),
    },
  ];
  if (contest) items.push({ '@type': 'ListItem', position: 3, name: contest, item: '' });
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
}

function notFound(): PageMeta {
  return {
    title: `找不到頁面｜${siteName}`,
    description: '找不到這個頁面。',
    ogTitle: '找不到頁面',
    ogDescription: '找不到這個頁面。',
    canonical: '',
    robots: 'noindex,nofollow',
    status: 404,
  };
}

export function renderHead(meta: PageMeta) {
  const tag = (attr: 'name' | 'property', key: string, value: string) =>
    `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`;
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    tag('name', 'description', meta.description),
    tag('name', 'robots', meta.robots),
    meta.canonical ? `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />` : '',
    tag('property', 'og:site_name', siteName),
    tag('property', 'og:locale', 'zh_TW'),
    tag('property', 'og:type', 'website'),
    meta.ogUrl || meta.canonical ? tag('property', 'og:url', meta.ogUrl ?? meta.canonical) : '',
    tag('property', 'og:title', meta.ogTitle),
    tag('property', 'og:description', meta.ogDescription),
    meta.ogImage ? tag('property', 'og:image', meta.ogImage) : '',
    tag('name', 'twitter:card', meta.ogImage ? 'summary_large_image' : 'summary'),
    tag('name', 'twitter:title', meta.ogTitle),
    tag('name', 'twitter:description', meta.ogDescription),
    meta.ogImage ? tag('name', 'twitter:image', meta.ogImage) : '',
  ].filter(Boolean);
  if (meta.jsonLd)
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`,
    );
  return tags.join('');
}

export function renderRobots(origin: string, indexable = seoIndexable) {
  const facebook = 'User-agent: facebookexternalhit\nAllow: /\n\n';
  return `${facebook}${
    indexable
      ? `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /mine\nSitemap: ${absolute(origin, '/sitemap.xml')}\n`
      : 'User-agent: *\nDisallow: /\n'
  }`;
}

export function renderLlmsText(origin: string) {
  return `# ${siteName}

> 2026 年 11 月 28 日臺灣九合一地方選舉的群眾預測網站，涵蓋縣市長、議員、鄉鎮市長、代表與村里長選區。

本站內容是民眾自行提交的預測彙整，不是民調、官方候選人公告或開票結果。

## 主要頁面

- [全臺選情地圖](${absolute(origin, '/')}): 全臺各類地方選舉的入口與群眾預測概況。
- [縣市長選情總覽](${absolute(origin, '/regions')}): 全臺 22 縣市的縣市長候選人與預測分布。
- [政黨候選人總覽](${absolute(origin, '/parties')}): 依政黨、行政區與參選職位瀏覽候選人。
- [激戰選區排行](${absolute(origin, '/rankings')}): 第一、二名預測差距最小的單席選區 Top 20。

## 規則與索引

- [使用條款](${absolute(origin, '/terms')}): 預測規則、留言規範與免責聲明。
- [隱私權政策](${absolute(origin, '/privacy')}): 資料蒐集、保存及使用者權利。
- [更新紀錄](${absolute(origin, '/changelog')}): 網站版本與功能變更。
- [XML Sitemap](${absolute(origin, '/sitemap.xml')}): 可索引公開頁面的完整入口。
`;
}

export function renderSitemapIndex(origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${escapeHtml(absolute(origin, '/sitemap-core.xml'))}</loc></sitemap></sitemapindex>`;
}

export function renderCoreSitemap(origin: string) {
  const paths = [
    '/',
    '/regions',
    '/parties',
    '/rankings',
    '/privacy',
    '/terms',
    '/changelog',
    ...candidateParties.map(({ id }) => `/parties/${id}`),
    ...jurisdictions.map(({ id }) => `/region/${id}`),
    ...listRegisteredContests()
      .filter(({ type }) => indexableTypes.has(type))
      .map(({ id }) => `/contest/${id}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeHtml(absolute(origin, path))}</loc></url>`).join('')}</urlset>`;
}
