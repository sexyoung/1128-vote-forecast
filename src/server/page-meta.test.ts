import { describe, expect, it } from 'vite-plus/test';
import { listRegisteredContests } from './contest-registry.js';
import {
  defaultOgImage,
  renderCoreSitemap,
  renderHead,
  renderLlmsText,
  renderRobots,
  resolvePageMeta,
  siteName,
} from './page-meta.js';

const origin = 'https://vote.example';

describe('page metadata', () => {
  it('normalises region filters and forces preview noindex', () => {
    const meta = resolvePageMeta('/region/TPE', new URLSearchParams('view=council&town=ignored'), {
      origin,
      indexable: false,
    });
    expect(meta.canonical).toBe(`${origin}/region/TPE?view=council`);
    expect(meta.robots).toBe('noindex,nofollow');
    expect(meta.description).toContain('臺北市議員各選區');
  });

  it('marks missing and unpublished contest pages noindex', () => {
    const representative = listRegisteredContests().find(({ type }) => type === 'REPRESENTATIVE');
    expect(representative).toBeTruthy();
    expect(
      resolvePageMeta(`/contest/${representative?.id}`, new URLSearchParams(), {
        origin,
        indexable: true,
      }).robots,
    ).toBe('noindex,follow');
    expect(
      resolvePageMeta('/missing', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({ status: 404, robots: 'noindex,nofollow', canonical: '' });
  });

  it('uses the default OG image unless a page supplies a more specific one', () => {
    const home = resolvePageMeta('/', new URLSearchParams(), { origin, indexable: true });
    expect(home.ogImage).toBe(`${origin}${defaultOgImage}`);
    expect(renderHead(home)).toContain('property="og:image"');

    const withImage = resolvePageMeta('/contest/TPE-EXECUTIVE-1', new URLSearchParams(), {
      origin,
      indexable: true,
      ogImage: '/avatars/candidate.jpg',
    });
    expect(renderHead(withImage)).toContain('content="https://vote.example/avatars/candidate.jpg"');
  });

  it('gives every public index page distinct metadata and an OG image', () => {
    const pages = [
      ['/', '', '2026 九合一選舉預測｜全臺縣市長、議員與地方選舉', '8,429 個'],
      ['/regions', '', '2026 全臺縣市長選舉預測｜22 縣市選情總覽｜九合一選舉預測', '22 縣市'],
      ['/region/TPE', '', '2026 臺北市長選舉預測｜候選人與最新選情｜九合一選舉預測', '領先者'],
      [
        '/region/TPE',
        'view=council',
        '2026 臺北市議員選舉預測｜候選人與最新選情｜九合一選舉預測',
        '應選席次',
      ],
      [
        '/region/TPE',
        'view=village',
        '2026 臺北市村里長選舉預測｜候選人與最新選情｜九合一選舉預測',
        '各選區候選人',
      ],
      [
        '/region/ILA',
        'view=representative',
        '2026 宜蘭縣鄉鎮市民代表選舉預測｜候選人與最新選情｜九合一選舉預測',
        '鄉鎮市民代表',
      ],
      [
        '/region/ILA',
        'view=township',
        '2026 宜蘭縣鄉鎮市長選舉預測｜候選人與最新選情｜九合一選舉預測',
        '鄉鎮市長',
      ],
      ['/parties', '', '2026 九合一選舉政黨候選人一覽｜各黨提名布局｜九合一選舉預測', '提名名單'],
      ['/parties/DPP', '', '民主進步黨 2026 九合一選舉候選人｜九合一選舉預測', '行政區分布'],
      [
        '/parties/DPP',
        'region=TPE',
        '2026 臺北市長候選人｜民主進步黨｜九合一選舉預測',
        '民主進步黨參選 2026 臺北市長',
      ],
      [
        '/parties/DPP',
        'region=TPE&view=council',
        '2026 臺北市議員候選人｜民主進步黨｜九合一選舉預測',
        '民主進步黨參選 2026 臺北市議員',
      ],
      [
        '/rankings',
        '',
        '2026 九合一選舉激戰選區 Top 20｜預測票數最接近｜九合一選舉預測',
        '預測票數最接近的 20 個單席選區',
      ],
    ] as const;
    for (const [path, query, title, description] of pages)
      expect(
        resolvePageMeta(path, new URLSearchParams(query), { origin, indexable: true }),
      ).toMatchObject({
        title,
        description: expect.stringContaining(description),
        ogImage: `${origin}${defaultOgImage}`,
      });
  });

  it('does not expose the default OG image on private pages', () => {
    for (const path of ['/mine', '/admin'])
      expect(
        resolvePageMeta(path, new URLSearchParams(), { origin, indexable: true }).ogImage,
      ).toBeUndefined();
  });

  it('publishes WebPage JSON-LD on public pages only', () => {
    const region = resolvePageMeta('/region/TPE', new URLSearchParams(), {
      origin,
      indexable: true,
    });
    expect(JSON.stringify(region.jsonLd)).toContain('WebPage');
    expect(JSON.stringify(region.jsonLd)).toContain('BreadcrumbList');
    expect(renderHead(region)).toContain('application/ld+json');
    expect(
      resolvePageMeta('/mine', new URLSearchParams(), { origin, indexable: true }).jsonLd,
    ).toBeUndefined();
  });

  it('keeps single-seat contest metadata stable when the leader changes', () => {
    const meta = resolvePageMeta('/contest/TPE-EXECUTIVE-1', new URLSearchParams(), {
      origin,
      indexable: true,
    });

    expect(meta.title).toBe('臺北市長最多人預測的是.....｜九合一選舉預測');
    expect(meta.description).toContain('最可能勝出的候選人');
    expect(meta.ogTitle).toBe('臺北市長最多人預測的是.....');
    expect(meta.ogImage).toBe(`${origin}${defaultOgImage}`);
  });

  it('snapshots the current leader for timestamped share metadata', () => {
    const timestamp = '1788076800000';
    const meta = resolvePageMeta(
      '/contest/TPE-EXECUTIVE-1',
      new URLSearchParams(`t=${timestamp}`),
      {
        origin,
        indexable: true,
        contestLeader: { label: '測試候選人', percent: 61 },
        ogImage: '/avatars/leader.webp',
      },
    );

    expect(meta.title).toBe('臺北市長最多人預測的是測試候選人｜九合一選舉預測');
    expect(meta.description).toContain('61%');
    expect(meta.canonical).toBe(`${origin}/contest/TPE-EXECUTIVE-1`);
    expect(meta.ogUrl).toBe(`${origin}/contest/TPE-EXECUTIVE-1?t=${timestamp}`);
    expect(meta.ogImage).toBe(`${origin}/avatars/leader.webp`);
  });

  it('gives every public timestamped share its own OG URL', () => {
    const meta = resolvePageMeta(
      '/parties/DPP',
      new URLSearchParams('region=TPE&view=executive&t=1788076800000'),
      { origin, indexable: true },
    );

    expect(meta.canonical).toBe(`${origin}/parties/DPP?region=TPE`);
    expect(meta.ogUrl).toBe(`${origin}/parties/DPP?region=TPE&view=executive&t=1788076800000`);
  });

  it('publishes party index and detail metadata', () => {
    expect(
      resolvePageMeta('/parties', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({ status: 200, canonical: `${origin}/parties` });
    expect(
      resolvePageMeta('/parties/DPP', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({
      status: 200,
      title: expect.stringContaining('民主進步黨 2026 九合一選舉候選人'),
      description: expect.stringContaining('行政區分布'),
    });

    expect(
      resolvePageMeta('/parties/DPP', new URLSearchParams('region=TPE&view=executive'), {
        origin,
        indexable: true,
      }),
    ).toMatchObject({
      title: expect.stringContaining('2026 臺北市長候選人｜民主進步黨'),
      description: expect.stringContaining('民主進步黨參選 2026 臺北市長'),
      canonical: `${origin}/parties/DPP?region=TPE`,
    });
  });

  it('publishes battleground ranking metadata', () => {
    expect(
      resolvePageMeta('/rankings', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({ status: 200, canonical: `${origin}/rankings` });
  });

  it('publishes the static site pages', () => {
    for (const path of ['/privacy', '/terms', '/changelog'])
      expect(
        resolvePageMeta(path, new URLSearchParams(), { origin, indexable: true }),
      ).toMatchObject({
        status: 200,
        canonical: `${origin}${path}`,
        robots: 'index,follow,max-image-preview:large',
      });
  });

  it('builds production robots and a filtered sitemap', () => {
    const productionRobots = renderRobots(origin, true);
    const previewRobots = renderRobots(origin, false);
    expect(productionRobots).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(previewRobots).toBe(
      'User-agent: facebookexternalhit\nAllow: /\n\nUser-agent: *\nDisallow: /\n',
    );
    const sitemap = renderCoreSitemap(origin);
    expect(sitemap).toContain('/contest/TPE-EXECUTIVE-1');
    expect(sitemap).toContain('/parties/DPP');
    expect(sitemap).toContain('/rankings');
    expect(sitemap).not.toContain('-VILLAGE');
  });

  it('builds an llms.txt with public entry points and a prediction disclaimer', () => {
    const llms = renderLlmsText(origin);
    expect(llms).toContain(`# ${siteName}`);
    expect(llms).toContain(`${origin}/regions`);
    expect(llms).toContain(`${origin}/sitemap.xml`);
    expect(llms).toContain('不是民調');
  });
});
