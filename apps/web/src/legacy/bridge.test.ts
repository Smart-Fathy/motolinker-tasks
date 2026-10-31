import { describe, expect, it } from 'vitest';
import { frameUrl, parseFromFrame, toFrame } from './bridge';

const says = (extra: Record<string, unknown>) => ({ ml: 'embed', v: 1, ...extra });

describe('what the frame says', () => {
  it('reads the three things a classic page tells the app', () => {
    expect(parseFromFrame(says({ type: 'ready', page: 'customers' }))).toEqual({
      type: 'ready',
      page: 'customers',
    });
    expect(parseFromFrame(says({ type: 'navigated', page: 'purchaseorders' }))).toEqual({
      type: 'navigated',
      page: 'purchaseorders',
    });
    expect(parseFromFrame(says({ type: 'unauthorized' }))).toEqual({ type: 'unauthorized' });
  });

  it("reads whose a document is when a lead's page sent the person on to make it", () => {
    expect(parseFromFrame(says({ type: 'navigated', page: 'rfqs', lead: 7 }))).toEqual({
      type: 'navigated',
      page: 'rfqs',
      lead: 7,
    });
    // a lead that is not a whole number above nought is none — the move itself still counts
    for (const lead of [0, -3, 1.5, '7', null, NaN, Infinity, [7], { id: 7 }, true]) {
      expect(parseFromFrame(says({ type: 'navigated', page: 'rfqs', lead })), String(lead)).toEqual(
        {
          type: 'navigated',
          page: 'rfqs',
        },
      );
    }
    // only a move carries it: the page that comes up first is not for anybody
    expect(parseFromFrame(says({ type: 'ready', page: 'customers', lead: 7 }))).toEqual({
      type: 'ready',
      page: 'customers',
    });
  });

  it('reads nothing else', () => {
    const bad: unknown[] = [
      null,
      undefined,
      'ready',
      42,
      [],
      {},
      { type: 'ready', page: 'home' }, // no name, no version
      { ml: 'embed', type: 'ready', page: 'home' },
      { ml: 'embed', v: 2, type: 'ready', page: 'home' },
      { ml: 'other', v: 1, type: 'ready', page: 'home' },
      says({ type: 'ready' }), // no page
      says({ type: 'ready', page: 7 }),
      says({ type: 'ready', page: ['home'] }),
      says({ type: 'ready', page: 'Home' }), // pages are lowercase letters
      says({ type: 'ready', page: '../etc' }),
      says({ type: 'ready', page: 'x' }),
      says({ type: 'ready', page: 'a'.repeat(21) }),
      says({ type: 'navigate', page: 'home' }), // that one goes the other way
      says({ type: 'something', page: 'home' }),
    ];
    for (const message of bad) expect(parseFromFrame(message), JSON.stringify(message)).toBeNull();
  });
});

describe('what the app says', () => {
  it('puts the protocol around a message', () => {
    expect(toFrame({ type: 'navigate', page: 'deals' })).toEqual({
      ml: 'embed',
      v: 1,
      type: 'navigate',
      page: 'deals',
    });
    expect(toFrame({ type: 'look', profile: { name: 'Acme' } })).toEqual({
      ml: 'embed',
      v: 1,
      type: 'look',
      profile: { name: 'Acme' },
    });
  });
});

describe('where the frame opens', () => {
  it("is the portal's classic page, embedded, on the page asked for", () => {
    expect(frameUrl('admin', 'customers', false)).toBe('/legacy/dashboard?embed=1#customers');
    expect(frameUrl('team', 'leads', false)).toBe('/legacy/employee?embed=1#leads');
  });

  it('keeps safe mode', () => {
    expect(frameUrl('admin', 'tasks', true)).toBe('/legacy/dashboard?embed=1&safe=1#tasks');
  });
});
