import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { currentVersion, releases } from './changelog.js';

describe('changelog', () => {
  it('keeps package.json on the version the footer shows', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.version).toBe(currentVersion);
  });

  it('lists releases newest first with unique versions', () => {
    const dates = releases.map(({ date }) => date);
    expect(dates).toStrictEqual([...dates].sort().reverse());
    expect(new Set(releases.map(({ version }) => version)).size).toBe(releases.length);
    for (const release of releases) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.changes.length).toBeGreaterThan(0);
    }
  });
});
