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
  },
): PageMeta {
  const origin = options.origin.replace(/\/$/, '');
  const canIndex = options.indexable ?? seoIndexable;
  const robots = (value = indexRobots) => (canIndex ? value : 'noindex,nofollow');
  const finish = (meta: PageMeta): PageMeta => ({
    ...meta,
    robots: robots(meta.robots),
    ogImage: options.ogImage ? absolute(origin, options.ogImage) : undefined,
  });

  if (pathname === '/') {
    const count = formatCount(countRegisteredContests());
    return finish({
      title: '九合一選舉預測｜2026.11.28 全臺 22 縣市預測地圖',
      description: `點開任一個縣市，看 2026 九合一選舉的群眾預測分布。縣市長、議員、鄉鎮市長、代表、村里長共 ${count} 個選區，匿名就能押，隨時可改。`,
      ogTitle: '2026 九合一選舉群眾預測地圖',
      ogDescription: `全臺 22 縣市、${count} 個選區，匿名就能押一份。11.28 投票前，看大家怎麼預測。`,
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
      title: '全國預測｜22 個縣市的縣市長選情｜九合一選舉預測',
      description:
        '2026 九合一選舉全臺 22 個縣市的縣市長預測一覽，一個縣市一張卡片，看群眾目前押誰。點進去還有議員、鄉鎮市長、代表與村里長。',
      ogTitle: '全國預測：22 個縣市的縣市長選情',
      ogDescription: '一個縣市一張卡片，看 2026 縣市長選舉的群眾預測分布。',
      canonical: absolute(origin, '/regions'),
      robots: indexRobots,
      status: 200,
    });

  if (pathname === '/parties')
    return finish({
      title: `政黨一覽｜${siteName}`,
      description: '查看 2026 九合一選舉各政黨，以及每個政黨有候選人參選的選區。',
      ogTitle: '2026 九合一選舉政黨一覽',
      ogDescription: '從政黨查看參選選區與候選人分布。',
      canonical: absolute(origin, '/parties'),
      robots: indexRobots,
      status: 200,
    });

  if (pathname === '/rankings')
    return finish({
      title: `熱門候選人排行｜${siteName}`,
      description: '查看 2026 九合一選舉中，被群眾選入預測次數最多的前 50 位候選人。',
      ogTitle: '2026 九合一選舉熱門候選人排行',
      ogDescription: '依群眾預測次數排序，查看目前最熱門的候選人。',
      canonical: absolute(origin, '/rankings'),
      robots: indexRobots,
      status: 200,
    });

  const partyMatch = /^\/parties\/([^/]+)$/.exec(pathname);
  if (partyMatch) {
    const party = candidateParties.find(({ id }) => id === partyMatch[1].toUpperCase());
    if (!party) return notFound();
    return finish({
      title: `${party.name}參選選區｜${siteName}`,
      description: `查看 ${party.name} 在 2026 九合一選舉有候選人參選的選區。`,
      ogTitle: `${party.name}參選選區`,
      ogDescription: `查看 ${party.name} 的 2026 九合一選舉參選選區。`,
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
    const label = overview ? '預測總覽' : `${viewLabel}預測`;
    return finish({
      title: `${jurisdiction.name}${label}｜${formatCount(pageCount)} 個選區｜${siteName}`,
      description: overview
        ? `${jurisdiction.name}的 2026 九合一選舉預測總覽，共 ${formatCount(total)} 個選區。看群眾目前怎麼押，也留下你自己的一份。`
        : `${jurisdiction.name}${viewLabel}選舉共 ${formatCount(count)} 個選區，每一區列出目前的群眾預測分布。匿名就能押，可隨時修改。`,
      ogTitle: `${jurisdiction.name}${label}`,
      ogDescription: `${jurisdiction.name}共 ${formatCount(pageCount)} 個選區，看 2026 九合一選舉的群眾預測分布。`,
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
    const singleSeatTitle = `${name}最多人預測的是.....`;
    const seats = seatsLabel(contest);
    const seatSentence =
      contest.seatsSource === 'PLACEHOLDER'
        ? `名額依地方制度法第 33 條按人口決定，公告前先以 ${contest.seats} 席暫定`
        : contest.seats === 1
          ? '選出你認為最可能勝出的人'
          : `預測 ${contest.seats} 席最終歸屬`;
    return finish({
      title: `${contest.seats === 1 ? singleSeatTitle : `${name}預測${seats ? `｜${seats}` : ''}`}｜${siteName}`,
      description:
        contest.seats === 1
          ? `查看${name}最新群眾預測分布，看看目前最多人預測誰會勝出，也留下你的選擇。這是群眾預測，不是民調。`
          : `${name}（${summariseArea(contest.area)}）的群眾預測分布，${seatSentence}。匿名就能押，每個身份在本選區只計一份，可隨時修改。`,
      ogTitle: contest.seats === 1 ? singleSeatTitle : `${name}預測`,
      ogDescription:
        contest.seats === 1
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
    meta.canonical ? tag('property', 'og:url', meta.canonical) : '',
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
