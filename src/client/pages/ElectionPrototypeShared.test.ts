import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';

describe('persistent header search', () => {
  it('clears its query before result navigation and after any route change', async () => {
    const source = await readFile(
      new URL('./ElectionPrototypeShared.tsx', import.meta.url),
      'utf8',
    );
    const searchBox = source.slice(
      source.indexOf('export function SearchBox'),
      source.indexOf('// overlay：'),
    );

    expect(searchBox).toContain("setSearch('');");
    expect(searchBox).toContain('inputRef.current?.blur();');
    expect(searchBox).toContain('location.pathname, location.search');
    expect(searchBox).toContain('searchActive && matches.length > 0');
    expect(searchBox).toContain('onPointerDown={(event) => event.preventDefault()}');
    expect(searchBox.match(/closeSearch\(\);/g)).toHaveLength(4);
  });
});
