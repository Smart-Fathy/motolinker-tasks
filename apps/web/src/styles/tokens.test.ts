import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The new app wears the classic portals' look from the first paint, so the design tokens in base.css have to be the
// values the classic sheet ships. This holds them to it until the classic sheet is gone.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
// Two spellings of the same value are the same value: spaces, case, and a leading zero (`.09` and `0.09`) do not count.
const squash = (s: string) =>
  s
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/(^|[^0-9])0\./g, '$1.');

/** every `--token: value;` declared in a `:root,.on-dark { … }` block, first declaration of a name wins */
function defaultTokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of css.matchAll(/:root\s*,\s*\.on-dark\s*\{([^}]*)\}/g)) {
    for (const d of (block[1] ?? '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const [, name, value] = d;
      if (name && value && !out.has(name)) out.set(name, squash(value));
    }
  }
  return out;
}

describe('the look the new app starts from', () => {
  const mine = defaultTokens(read('./base.css'));
  const classic = defaultTokens(read('../../../../public/assets/dashboard.css'));

  it('finds the tokens in both sheets (so this test cannot pass by finding nothing)', () => {
    expect(mine.size).toBeGreaterThanOrEqual(15);
    expect(classic.size).toBeGreaterThan(50);
  });

  it('uses the classic portals’ value for every token it defines', () => {
    const differ = [...mine]
      .filter(([name, value]) => classic.get(name) !== value)
      .map(([name, value]) => `${name}: ${value} (classic: ${classic.get(name) ?? 'not defined'})`);
    expect(differ).toEqual([]);
  });
});
