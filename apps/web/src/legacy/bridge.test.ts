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

  it("reads that the assistant's key was pressed in the page, and nothing more of it", () => {
    expect(parseFromFrame(says({ type: 'ask' }))).toEqual({ type: 'ask' });
    expect(parseFromFrame(says({ type: 'ask', page: 'customers', extra: 1 }))).toEqual({
      type: 'ask',
    });
    expect(parseFromFrame({ ml: 'embed', v: 2, type: 'ask' })).toBeNull();
    expect(parseFromFrame({ ml: 'other', v: 1, type: 'ask' })).toBeNull();
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

describe('the record a page says is open', () => {
  const record = { kind: 'lead', id: '12', title: 'Mona Saleh', sub: 'New · 0100' };

  it('is read as it is said, and none is read as none', () => {
    expect(parseFromFrame(says({ type: 'record', record }))).toEqual({ type: 'record', record });
    expect(parseFromFrame(says({ type: 'record', record: null }))).toEqual({
      type: 'record',
      record: null,
    });
  });

  it('is kept to words on one line, as long as the server keeps them, and a number for an id is its digits', () => {
    const read = parseFromFrame(
      says({
        type: 'record',
        record: { kind: 'purchase_order', id: 7, title: '  a\n  b  ' + 't'.repeat(200), sub: 5 },
      }),
    );
    expect(read).toEqual({
      type: 'record',
      record: {
        kind: 'purchase_order',
        id: '7',
        title: ('a b ' + 't'.repeat(200)).slice(0, 120),
        sub: '',
      },
    });
  });

  it('holds the longest kind and id the server holds, and the shortest', () => {
    const edge = (kind: string, id: string) =>
      parseFromFrame(says({ type: 'record', record: { kind, id, title: 't' } }));
    expect(edge('a'.repeat(24), 'x'.repeat(40))).toEqual({
      type: 'record',
      record: { kind: 'a'.repeat(24), id: 'x'.repeat(40), title: 't', sub: '' },
    });
    expect(edge('a', '1')).toEqual({
      type: 'record',
      record: { kind: 'a', id: '1', title: 't', sub: '' },
    });
  });

  it('is nothing at all unless it names a kind and an id it can hold', () => {
    const bad: unknown[] = [
      undefined,
      'lead',
      7,
      [],
      {},
      { ...record, kind: '' },
      { ...record, kind: 'Lead' },
      { ...record, kind: 'a'.repeat(25) },
      { ...record, kind: '../x' },
      { ...record, kind: 7 },
      { ...record, id: '' },
      { ...record, id: 'x'.repeat(41) },
      { ...record, id: null },
      { ...record, id: ['12'] },
      { title: 'no kind or id' },
    ];
    for (const r of bad) {
      expect(parseFromFrame(says({ type: 'record', record: r })), JSON.stringify(r)).toBeNull();
    }
    expect(parseFromFrame(says({ type: 'record' }))).toBeNull(); // not even a null
  });
});

describe('what a page says is chosen on it', () => {
  const answer = (screen: unknown, id: unknown = 4) => says({ type: 'screen', id, screen });

  it('is read as said, and a page that could not say is read as that', () => {
    expect(
      parseFromFrame(
        answer({
          tab: 'Hot',
          search: 'ahmed',
          filters: { status: 'Hot leads', from: '2026-10-01' },
          selected: [{ kind: 'lead', id: '3', title: 'Ahmed Hassan' }],
        }),
      ),
    ).toEqual({
      type: 'screen',
      id: 4,
      screen: {
        tab: 'Hot',
        search: 'ahmed',
        filters: { status: 'Hot leads', from: '2026-10-01' },
        selected: [{ kind: 'lead', id: '3', title: 'Ahmed Hassan' }],
      },
    });
    expect(parseFromFrame(answer(null))).toEqual({ type: 'screen', id: 4, screen: null });
    expect(parseFromFrame(answer({}))).toEqual({ type: 'screen', id: 4, screen: {} });
  });

  it('keeps each thing it says well and leaves out each it does not', () => {
    expect(
      parseFromFrame(
        answer({
          tab: 7,
          search: '   ',
          filters: { status: 'Hot', '': 'x', bad: 3, nested: { a: 1 } },
          selected: [
            { kind: 'lead', id: 3, title: 'Ahmed' },
            { kind: 'Lead', id: '4' },
            { kind: 'lead', id: '' },
            'row',
            null,
          ],
          record: { kind: 'lead', id: '1' }, // (the record is told on its own, as it opens: not here)
          extra: 'ignored',
        }),
      ),
    ).toEqual({
      type: 'screen',
      id: 4,
      screen: {
        filters: { status: 'Hot' },
        selected: [{ kind: 'lead', id: '3', title: 'Ahmed' }],
      },
    });
  });

  it('is held to what the server keeps: eight filters, ten rows, and their words cut', () => {
    const filters = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, `v${i}`]));
    const selected = Array.from({ length: 14 }, (_, i) => ({
      kind: 'row',
      id: String(i),
      title: 't',
    }));
    const read = parseFromFrame(
      answer({ tab: 't'.repeat(100), search: 's'.repeat(200), filters, selected }),
    );
    if (read?.type !== 'screen' || !read.screen) throw new Error('not read');
    expect(read.screen.tab).toHaveLength(40);
    expect(read.screen.search).toHaveLength(80);
    expect(Object.keys(read.screen.filters ?? {})).toHaveLength(8);
    expect(read.screen.selected).toHaveLength(10);
    expect(
      parseFromFrame(
        answer({ selected: [{ kind: 'row', id: 'x'.repeat(60), title: 'y'.repeat(90) }] }),
      ),
    ).toEqual({
      type: 'screen',
      id: 4,
      screen: { selected: [{ kind: 'row', id: 'x'.repeat(40), title: 'y'.repeat(60) }] },
    });
  });

  it('answers a question by its number, and nothing else', () => {
    for (const id of [0, -1, 1.5, '4', null, undefined, NaN, Infinity, [4], true]) {
      expect(parseFromFrame(says({ type: 'screen', id, screen: {} })), String(id)).toBeNull();
    }
    for (const screen of [undefined, 'tab', 7, []]) {
      // (a page that says something that is not a screen has said nothing: the question still has its answer)
      expect(parseFromFrame(answer(screen)), JSON.stringify(screen)).toEqual({
        type: 'screen',
        id: 4,
        screen: null,
      });
    }
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
