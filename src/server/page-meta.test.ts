import { describe, expect, it } from 'vite-plus/test';
import { listRegisteredContests } from './contest-registry.js';
import { renderCoreSitemap, renderHead, renderRobots, resolvePageMeta } from './page-meta.js';

const origin = 'https://vote.example';

describe('page metadata', () => {
  it('normalises region filters and forces preview noindex', () => {
    const meta = resolvePageMeta('/region/TPE', new URLSearchParams('view=council&town=ignored'), {
      origin,
      indexable: false,
    });
    expect(meta.canonical).toBe(`${origin}/region/TPE?view=council`);
    expect(meta.robots).toBe('noindex,nofollow');
    expect(meta.description).toContain('各議員選區');
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

  it('only emits an OG image when one is supplied', () => {
    const without = resolvePageMeta('/', new URLSearchParams(), { origin, indexable: true });
    expect(renderHead(without)).not.toContain('og:image');

    const withImage = resolvePageMeta('/contest/TPE-EXECUTIVE-1', new URLSearchParams(), {
      origin,
      indexable: true,
      ogImage: '/avatars/candidate.jpg',
    });
    expect(renderHead(withImage)).toContain('content="https://vote.example/avatars/candidate.jpg"');
  });

  it('keeps single-seat contest metadata stable when the leader changes', () => {
    const meta = resolvePageMeta('/contest/TPE-EXECUTIVE-1', new URLSearchParams(), {
      origin,
      indexable: true,
    });

    expect(meta.title).toBe('臺北市長最多人預測的是.....｜九合一選舉預測');
    expect(meta.description).toContain('最可能勝出的候選人');
    expect(meta.ogTitle).toBe('臺北市長最多人預測的是.....');
    expect(meta.ogImage).toBeUndefined();
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

    expect(meta.canonical).toBe(`${origin}/parties/DPP`);
    expect(meta.ogUrl).toBe(
      `${origin}/parties/DPP?region=TPE&view=executive&t=1788076800000`,
    );
  });

  it('publishes party index and detail metadata', () => {
    expect(
      resolvePageMeta('/parties', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({ status: 200, canonical: `${origin}/parties` });
    expect(
      resolvePageMeta('/parties/DPP', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({
      status: 200,
      title: expect.stringContaining('民主進步黨候選人'),
      description: expect.stringContaining('各行政區'),
    });

    expect(
      resolvePageMeta('/parties/DPP', new URLSearchParams('region=TPE&view=executive'), {
        origin,
        indexable: true,
      }),
    ).toMatchObject({
      title: expect.stringContaining('臺北市民主進步黨縣市長候選人'),
      description: expect.stringContaining('臺北市參選縣市長'),
    });
  });

  it('publishes candidate ranking metadata', () => {
    expect(
      resolvePageMeta('/rankings', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({ status: 200, canonical: `${origin}/rankings` });
  });

  it('builds production robots and a filtered sitemap', () => {
    expect(renderRobots(origin, true)).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(renderRobots(origin, false)).toBe('User-agent: *\nDisallow: /\n');
    const sitemap = renderCoreSitemap(origin);
    expect(sitemap).toContain('/contest/TPE-EXECUTIVE-1');
    expect(sitemap).toContain('/parties/DPP');
    expect(sitemap).toContain('/rankings');
    expect(sitemap).not.toContain('-VILLAGE');
  });
});
