// A corpus for the tests that hold a hand-written guard to its schema: a good thing with one field made wrong, each field and each
// wrongness in turn, and with each field left out. (Only tests import this; the app does not.)

/** The kinds of wrong a field can be: nothing, absent, a number whole and not, text, a flag, a list, an object. */
export const WRONG: readonly unknown[] = [null, undefined, 7, 1.5, 'x', true, [], {}];

export function oneAtATime(good: Record<string, unknown>): Record<string, unknown>[] {
  return Object.keys(good).flatMap(k => [
    ...WRONG.map(w => ({ ...good, [k]: w })),
    Object.fromEntries(Object.entries(good).filter(([x]) => x !== k)),
  ]);
}
