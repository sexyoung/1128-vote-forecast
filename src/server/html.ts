import type { Context, Env, Hono } from 'hono';
import { jurisdictions } from '../client/mock-election.js';
import { candidateParties } from '../shared/candidates.js';
import { getPublicAnnouncement } from './announcement.js';
import {
  type ContestType,
  getRegisteredContest,
  getRegisteredContests,
} from './contest-registry.js';
import { describeTarget, getPredictionTargets } from './prediction-targets.js';
import { readContestTallies } from './predictions.js';
import { readContestSnapshot } from './snapshots.js';
import { env, seoIndexable } from './env.js';
import { listPartyCandidateCounts, listPartyContests } from './party-contests.js';
import { listCandidateRankings } from './candidate-rankings.js';
import {
  renderCoreSitemap,
  renderHead,
  renderRobots,
  renderSitemapIndex,
  resolvePageMeta,
} from './page-meta.js';

export type QuerySeed = { key: unknown[]; data: unknown; updatedAt: number };

export type HtmlRenderer = {
  renderApp(input: {
    url: string;
    seeds: QuerySeed[];
  }): Promise<{ appHtml: string; stateJson: string }>;
  loadTemplate(url: string): Promise<string>;
};

const nationalContestIds = jurisdictions.map(({ id }) => `${id}-EXECUTIVE-1`);

async function tallySeed(contestIds: string[], key: unknown[]): Promise<QuerySeed | null> {
  if (contestIds.length === 0) return null;
  const tallies = await readContestTallies(contestIds);
  return {
    key,
    data: {
      tallies: Object.fromEntries(
        contestIds.map((id) => {
          const contest = getRegisteredContest(id);
          const tally = tallies.get(id);
          return [
            id,
            {
              totalPredictions: tally?.totalPredictions ?? 0,
              totalPicks: tally?.totalPicks ?? 0,
              targets: contest ? getPredictionTargets(contest) : [],
              rows: (tally?.rows ?? []).map((row) => ({
                ...row,
                ...(contest
                  ? describeTarget(contest, row.targetType, row.targetId)
                  : { label: row.targetId, partyId: null, color: null }),
              })),
            },
          ];
        }),
      ),
    },
    updatedAt: Date.now(),
  };
}

export function mountHtmlRoutes<E extends Env>(app: Hono<E>, renderer: HtmlRenderer) {
  async function send(
    c: Context<E>,
    seeds: QuerySeed[],
    options: {
      head?: string;
      ogImage?: string;
    } = {},
  ) {
    const url = new URL(c.req.url);
    const origin =
      env.publicSiteUrl ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : url.origin);
    const meta = resolvePageMeta(url.pathname, url.searchParams, {
      origin,
      ogImage: options.ogImage,
    });
    // 每一支 HTML 路由都經過這裡，公告因此不必在每個 route handler 各塞一次——
    // 也不會有「先進站的頁面沒有公告，後面才補上」的縫。是否跳出來看的是使用者
    // 有沒有關過這個版本，SSR 只負責把「現在的公告是什麼」帶到瀏覽器手上。
    const announcementSeed: QuerySeed = {
      key: ['announcement'],
      data: { announcement: await getPublicAnnouncement() },
      updatedAt: Date.now(),
    };
    const allSeeds = [...seeds, announcementSeed];
    const [{ appHtml, stateJson }, template] = await Promise.all([
      renderer.renderApp({ url: url.pathname + url.search, seeds: allSeeds }),
      renderer.loadTemplate(url.pathname),
    ]);
    const html = template
      .replace('<!--app-head-->', [renderHead(meta), options.head].filter(Boolean).join('\n    '))
      .replace('<!--app-html-->', appHtml)
      .replace(
        '<!--app-state-->',
        allSeeds.length === 0 ? '' : `<script>window.__RQ_STATE__=${stateJson}</script>`,
      );

    c.header(
      'Cache-Control',
      meta.private
        ? 'private, no-store'
        : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    );
    if (meta.robots.includes('noindex')) c.header('X-Robots-Tag', meta.robots);
    return c.html(html, meta.status);
  }

  const siteOrigin = (c: Context<E>) =>
    env.publicSiteUrl ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(c.req.url).origin);

  app.get('/robots.txt', (c) => {
    c.header('Content-Type', 'text/plain; charset=UTF-8');
    c.header('Cache-Control', 'public, max-age=0, s-maxage=300');
    if (!seoIndexable) c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.body(renderRobots(siteOrigin(c)));
  });
  app.get('/sitemap.xml', (c) => {
    c.header('Content-Type', 'application/xml; charset=UTF-8');
    if (!seoIndexable) c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.body(renderSitemapIndex(siteOrigin(c)));
  });
  app.get('/sitemap-core.xml', (c) => {
    c.header('Content-Type', 'application/xml; charset=UTF-8');
    if (!seoIndexable) c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.body(renderCoreSitemap(siteOrigin(c)));
  });

  // HTML 不進 /api/* 的身份 middleware；否則新訪客的 Set-Cookie 會污染 CDN 快取。
  app.get('/', (c) =>
    send(c, [], {
      head: '<link rel="preload" as="fetch" href="/maps/taiwan-counties.svg" crossorigin />',
    }),
  );

  app.get('/regions', async (c) => {
    const seed = await tallySeed(nationalContestIds, ['tallies', 'national']);
    return send(c, seed ? [seed] : []);
  });

  app.get('/region/:jurisdictionId', async (c) => {
    const jurisdictionId = c.req.param('jurisdictionId');
    if (!jurisdictions.some(({ id }) => id === jurisdictionId)) return send(c, []);

    const view = (c.req.query('view') ?? 'EXECUTIVE').toUpperCase() as ContestType;
    const contestIds =
      view === 'EXECUTIVE' || view === 'COUNCIL'
        ? getRegisteredContests(jurisdictionId, view)
            .map(({ id }) => id)
            .slice(0, 250)
        : [];
    const seed = await tallySeed(contestIds, ['tallies', contestIds]);
    return send(c, seed ? [seed] : []);
  });

  app.get('/contest/:contestId', async (c) => {
    const contest = getRegisteredContest(c.req.param('contestId'));
    if (!contest) return send(c, []);

    const tally = await readContestSnapshot(contest.id);
    const seed: QuerySeed = {
      key: ['contest', contest.id],
      data: {
        contest,
        targets: getPredictionTargets(contest),
        tally,
        mine: null,
      },
      // mine 綁在 cookie 上，SSR 不讀；0 讓瀏覽器掛上去後立刻重拉自己的資料。
      updatedAt: 0,
    };
    return send(c, [seed]);
  });

  app.get('/parties', async (c) =>
    send(c, [
      {
        key: ['party-counts'],
        data: await listPartyCandidateCounts(),
        updatedAt: Date.now(),
      },
    ]),
  );
  app.get('/rankings', async (c) =>
    send(c, [
      {
        key: ['candidate-rankings'],
        data: await listCandidateRankings(),
        updatedAt: Date.now(),
      },
    ]),
  );
  app.get('/parties/:partyId', async (c) => {
    const partyId = c.req.param('partyId').toUpperCase();
    if (!candidateParties.some(({ id }) => id === partyId)) return send(c, []);
    const requestedPage = Number.parseInt(c.req.query('page') ?? '1', 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const regionId = (c.req.query('region') ?? '').toUpperCase();
    const view = (c.req.query('view') ?? '').toUpperCase();
    const seed: QuerySeed = {
      key: ['party-contests', partyId, regionId, view, page],
      data: await listPartyContests(partyId, page, regionId, view),
      updatedAt: Date.now(),
    };
    return send(c, [seed]);
  });

  app.get('/mine', (c) => send(c, []));
  const admin = (c: Context<E>) => send(c, []);
  app.get('/admin', admin);
  app.get('/admin/*', admin);

  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    return send(c, []);
  });
}
