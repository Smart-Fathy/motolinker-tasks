import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The new app wears the classic portals' look from the first paint, so the design tokens in base.css (and, for the
// team portal, portal-team.css) have to be the values the classic sheets ship. This holds them to it until the
// classic sheets are gone.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
// Two spellings of the same value are the same value: spaces, case, and a leading zero (`.09` and `0.09`) do not count.
const squash = (s: string) =>
  s
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/(^|[^0-9])0\./g, '$1.');

/**
 * Every `--token: value;` declared in a block whose selector list is exactly `selectors`. A sheet may declare a token
 * again further down, and the browser takes the LAST one (same selector, same specificity, later in the sheet) — the
 * classic sheets do this for the three status colours — so the last one is the value the page really has.
 */
function tokens(css: string, selectors: string): Map<string, string> {
  const out = new Map<string, string>();
  const list = selectors
    .split(',')
    // a selector is matched as written, whichever quotes the formatter settled on
    .map(s =>
      s
        .trim()
        .replace(/[.[\]*^$|()+?\\]/g, '\\$&')
        .replace(/['"]/g, '["\']'),
    )
    .join('\\s*,\\s*');
  for (const block of css.matchAll(new RegExp(`${list}\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const d of (block[1] ?? '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const [, name, value] = d;
      if (name && value) out.set(name, squash(value));
    }
  }
  return out;
}

const ROOT = ':root, .on-dark';
const mine = tokens(read('./base.css'), ROOT);
const classicAdmin = tokens(read('../../../../public/assets/dashboard.css'), ROOT);
const classicTeam = tokens(read('../../../../public/assets/employee.css'), ROOT);
const team = tokens(
  read('./portal-team.css'),
  ":root[data-portal='team'], [data-portal='team'] .on-dark",
);

describe('the look the new app starts from', () => {
  it('finds the tokens in every sheet (so this test cannot pass by finding nothing)', () => {
    expect(mine.size).toBeGreaterThanOrEqual(25);
    expect(classicAdmin.size).toBeGreaterThan(50);
    expect(classicTeam.size).toBeGreaterThan(50);
    expect(team.size).toBeGreaterThanOrEqual(5);
  });

  it('uses the classic admin portal’s value for every token it defines', () => {
    const differ = [...mine]
      .filter(([name, value]) => classicAdmin.get(name) !== value)
      .map(
        ([name, value]) =>
          `${name}: ${value} (classic: ${classicAdmin.get(name) ?? 'not defined'})`,
      );
    expect(differ).toEqual([]);
  });

  it('takes the last declaration of a token the classic sheet declares twice, as the browser does', () => {
    // the first declaration of these was the desaturated palette; a later block replaced it
    expect(mine.get('--danger')).toBe('#ef4444');
    expect(mine.get('--success')).toBe('#10b981');
    expect(mine.get('--warning')).toBe('#f59e0b');
  });
});

describe('the team portal’s starting point', () => {
  it('uses the classic team portal’s value for every token it overrides', () => {
    const differ = [...team]
      .filter(([name, value]) => classicTeam.get(name) !== value)
      .map(
        ([name, value]) =>
          `${name}: ${value} (classic team: ${classicTeam.get(name) ?? 'not defined'})`,
      );
    expect(differ).toEqual([]);
  });

  it('lists every token the app defines that the team sheet starts from a different value for', () => {
    const missing = [...mine]
      .filter(
        ([name, value]) =>
          classicTeam.has(name) &&
          classicTeam.get(name) !== value &&
          team.get(name) !== classicTeam.get(name),
      )
      .map(([name]) => `${name}: admin ${mine.get(name)}, team ${classicTeam.get(name)}`);
    expect(missing).toEqual([]);
  });
});
