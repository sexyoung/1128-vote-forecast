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
const indexableTypes = new Set<ContestType>(['EXECUTIVE', 'COUNCIL', 'TOWNSHIP']);
const indexRobots = 'index,follow,max-image-preview:large';

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
  const finish = (meta: PageMeta): PageMeta => ({
    ...meta,
    robots: robots(meta.robots),
    ogImage: options.ogImage ? absolute(origin, options.ogImage) : undefined,
    ogUrl:
      shareTimestamp && meta.canonical
        ? absolute(origin, `${pathname}?${search.toString()}`)
        : meta.ogUrl,
  });

  if (pathname === '/') {
    const count = formatCount(countRegisteredContests());
    return finish({
      title: '九合一選舉預測｜2026.11.28 全臺 22 縣市預測地圖',
      description: `匯集全臺 22 縣市、共 ${count} 個選區的群眾預測，從縣市長到地方民代，觀察各地選情目前的可能走向。`,
      ogTitle: '2026 九合一選舉群眾預測地圖',
      ogDescription: `匯集全臺 22 縣市、共 ${count} 個選區的群眾預測，觀察各地選情目前的可能走向。`,
      canonical: absolute(origin, '/'),
      robots: indexRobots,
      status: 200,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: siteName,
        alternateName: '2026 地方選舉群眾預測地圖',
        url: absolute(origin, '/'),
        inLanguage: 'zh-Hant-TW',
      },
    });
  }

  if (pathname === '/regions')
    return finish({
      title: `全國選舉預測｜22 縣市最新選情｜${siteName}`,
      description:
        '一次瀏覽全臺 22 縣市的縣市長預測分布，看看哪些選情逐漸明朗，哪些仍然接近。',
      ogTitle: '全國選舉預測｜22 縣市最新選情',
      ogDescription: '一次瀏覽全臺 22 縣市的縣市長預測分布，看看哪些選情逐漸明朗，哪些仍然接近。',
      canonical: absolute(origin, '/regions'),
      robots: indexRobots,
      status: 200,
    });

  if (pathname === '/parties')
    return finish({
      title: `2026 九合一選舉政黨與候選人一覽｜${siteName}`,
      description:
        '整理各政黨在 2026 九合一選舉的候選人、參選職務與行政區分布，觀察各黨的地方布局。',
      ogTitle: '2026 九合一選舉政黨與候選人一覽',
      ogDescription:
        '整理各政黨的候選人、參選職務與行政區分布，觀察 2026 九合一選舉的地方布局。',
      canonical: absolute(origin, '/parties'),
      robots: indexRobots,
      status: 200,
    });

  if (pathname === '/rankings')
    return finish({
      title: `熱門候選人排行｜預測次數 Top 50｜${siteName}`,
      description:
        '依群眾預測次數整理目前受到最多關注的 50 位候選人，觀察全臺候選人的預測排名。',
      ogTitle: '熱門候選人排行｜預測次數 Top 50',
      ogDescription:
        '依群眾預測次數整理目前受到最多關注的 50 位候選人，觀察全臺候選人的預測排名。',
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
      ? electionViews.find((item) => item.id.toLowerCase() === search.get('view')?.toLowerCase())
      : undefined;
    const subject = jurisdiction
      ? `${jurisdiction.name}${party.name}${view ? `${view.label}候選人` : '候選人'}`
      : `${party.name}候選人`;
    const description = jurisdiction
      ? view
        ? `查看${party.name}在${jurisdiction.name}參選${view.label}的候選人資料與目前群眾預測分布。`
        : `查看${party.name}在${jurisdiction.name}的候選人名單、參選職務，以及目前是否進入預測當選名單。`
      : `查看${party.name}在各行政區推出的候選人、參選職務，以及目前的群眾預測結果。`;
    return finish({
      title: `${subject}｜${siteName}`,
      description,
      ogTitle: subject,
      ogDescription: description,
      canonical: absolute(origin, `/parties/${party.id}`),
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
    const viewLabel = electionViews.find((item) => item.id === view)?.label ?? '縣市長';
    const count = getRegisteredContests(jurisdiction.id, view).length;
    const total = getRegisteredContests(jurisdiction.id).length;
    const overview = view === 'EXECUTIVE';
    const pageCount = overview ? total : count;
    const canonical = `/region/${jurisdiction.id}${overview ? '' : `?view=${view.toLowerCase()}`}`;
    const label = overview ? '選舉預測' : `${viewLabel}選舉預測`;
    const description = overview
      ? `查看${jurisdiction.name}長、議員與村里長等選舉的群眾預測，掌握各選區目前受到看好的候選人。`
      : view === 'COUNCIL'
        ? `整理${jurisdiction.name}各議員選區的候選人與預測分布，觀察目前可能勝出的席次組合。`
        : `整理${jurisdiction.name}${viewLabel}各選區的候選人與預測分布，觀察目前可能勝出的席次組合。`;
    return finish({
      title: `${jurisdiction.name}${label}｜${formatCount(pageCount)} 個選區｜${siteName}`,
      description,
      ogTitle: `${jurisdiction.name}${label}`,
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
      description:
        leader
          ? `目前最多人預測 ${leader.label} 勝出${name}選舉，占 ${leader.percent}% 的預測選擇。查看完整分布，也留下你的選擇。這是群眾預測，不是民調。`
          : contest.seats === 1
          ? `查看${name}目前的群眾預測分布，並留下你認為最可能勝出的候選人。這是群眾預測，不是民調。`
          : `${name}（${summariseArea(contest.area)}）的群眾預測分布，${seatSentence}。匿名就能押，每個身份在本選區只計一份，可隨時修改。`,
      ogTitle: leader
        ? `${name}最多人預測的是${leader.label}`
        : contest.seats === 1
          ? singleSeatTitle
          : `${name}預測`,
      ogDescription:
        leader
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
    meta.ogUrl || meta.canonical
      ? tag('property', 'og:url', meta.ogUrl ?? meta.canonical)
      : '',
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
  return tags.join('\n    ');
}

export function renderRobots(origin: string, indexable = seoIndexable) {
  return indexable
    ? `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /mine\nSitemap: ${absolute(origin, '/sitemap.xml')}\n`
    : 'User-agent: *\nDisallow: /\n';
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
    ...candidateParties.map(({ id }) => `/parties/${id}`),
    ...jurisdictions.map(({ id }) => `/region/${id}`),
    ...listRegisteredContests()
      .filter(({ type }) => indexableTypes.has(type))
      .map(({ id }) => `/contest/${id}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeHtml(absolute(origin, path))}</loc></url>`).join('')}</urlset>`;
}
