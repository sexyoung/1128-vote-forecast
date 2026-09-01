import { describe, expect, it } from 'vite-plus/test';
import { searchEverything } from './search.js';

describe('search index', () => {
  it('finds executive contests by the shared county and city mayor label', () => {
    const hits = searchEverything('縣市長', 30, false);

    expect(hits.length).toBeGreaterThan(20);
    expect(hits).toContainEqual(
      expect.objectContaining({ id: 'TPE-EXECUTIVE-1', label: '臺北市長' }),
    );
  });
});
