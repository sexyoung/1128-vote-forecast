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
      ogImage: '/avatars/leader.webp',
    });

    expect(meta.title).toBe('臺北市長最多人預測的是.....｜九合一選舉預測');
    expect(meta.description).toContain('看看目前最多人預測誰會勝出');
    expect(meta.ogTitle).toBe('臺北市長最多人預測的是.....');
    expect(meta.ogImage).toBe(`${origin}/avatars/leader.webp`);
  });

  it('publishes party index and detail metadata', () => {
    expect(
      resolvePageMeta('/parties', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({ status: 200, canonical: `${origin}/parties` });
    expect(
      resolvePageMeta('/parties/DPP', new URLSearchParams(), { origin, indexable: true }),
    ).toMatchObject({ status: 200, title: expect.stringContaining('民主進步黨') });
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
