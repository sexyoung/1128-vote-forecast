import { Hono } from 'hono';
import { describe, expect, it } from 'vite-plus/test';
import { mountHtmlRoutes } from './html.js';

const template =
  '<html><head><!--app-head--></head><body><div id="root"><!--app-html--></div><!--app-state--></body></html>';

describe('HTML routes', () => {
  it('renders markup while keeping private pages out of shared caches', async () => {
    const app = new Hono();
    mountHtmlRoutes(app, {
      renderApp: async ({ url }) => ({ appHtml: `<main>${url}</main>`, stateJson: '{}' }),
      loadTemplate: async () => template,
    });

    const home = await app.request('/');
    const homeHtml = await home.text();
    expect(homeHtml).toContain('<main>/</main>');
    expect(homeHtml).toContain('<title>九合一選舉預測');
    expect(home.headers.get('cache-control')).toContain('s-maxage=60');

    const mine = await app.request('/mine');
    expect(mine.headers.get('cache-control')).toBe('private, no-store');
    expect(mine.headers.get('x-robots-tag')).toBe('noindex,nofollow');

    expect((await app.request('/missing')).status).toBe(404);

    const robots = await app.request('/robots.txt');
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
    expect(robots.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const sitemap = await app.request('/sitemap.xml');
    expect(await sitemap.text()).toContain('<sitemapindex');
  });
});
