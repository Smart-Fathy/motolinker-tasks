import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Column } from '../../columns';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const unit = (over: Record<string, unknown> = {}) => ({
  consignee: '',
  colour: '',
  vin: '',
  status: 'send_to_supplier',
  price_list: 0,
  discounted: 0,
  logistics: '',
  supplier: '',
  ...over,
});
const vehicle = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  make: 'BYD',
  model: 'Seal',
  trim: '',
  price: 0,
  quantity: 0,
  units: [],
  notes: '',
  legacy_count: null,
  created_by: 'dashboard',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  ...over,
});

/** Three models: two with cars (one of them with a car that has no VIN), one from before the cars were named. */
const VEHICLES = () => [
  vehicle(1, {
    make: 'BYD',
    model: 'Seal',
    trim: 'Design',
    price: 1950000,
    quantity: 2,
    notes: 'Immediate delivery',
    units: [
      unit({
        vin: 'LGXC76C41P0123456',
        colour: 'White / Black',
        status: 'in_logistics',
        price_list: 1950000,
        supplier: 'BYD',
        consignee: 'Hany',
      }),
      unit({ vin: 'LGXC76C41P0123457', colour: 'Grey', status: 'delivered', supplier: 'BYD' }),
    ],
  }),
  vehicle(2, {
    make: 'Toyota',
    model: 'Corolla',
    trim: 'GLI 1.6',
    price: 1150000,
    legacy_count: 3,
  }),
  vehicle(3, {
    make: 'BYD',
    model: 'Atto 3',
    quantity: 1,
    units: [unit({ colour: 'Red', status: 'in_preparation', price_list: 800000 })],
  }),
];

const ALL = {
  stock: true,
  stockActions: { view: true, browse: true, create: true, edit: true, tracking: true },
};
const BROWSE = {
  stock: true,
  stockActions: { view: true, browse: true, create: false, edit: false, tracking: false },
};
const NO_TRACKING = {
  stock: true,
  stockActions: { view: true, browse: true, create: true, edit: true, tracking: false },
};

const col = (key: string, over: Partial<Column> = {}): Column => ({
  key,
  label: key,
  type: 'text',
  builtin: false,
  visible: true,
  ...over,
});

type Body = Record<string, unknown>;
interface World {
  stock: unknown[] | 'forbidden' | 'failing' | 'odd' | 'not-a-list' | 'offline';
  columns: Column[] | null;
  writes: { method: string; path: string; body: Body | null }[];
  saveError: string | null;
  saveAnswer: unknown;
  saveGate: Promise<void> | null;
  deleteError: string | null;
  listGate: Promise<void> | null;
  columnsGate: Promise<void> | null;
  bulk: unknown;
  /** what the last upload carried */
  uploaded: FormData | null;
  bulkError: string | null;
}

/** A signed-in session whose server holds this world (the portal's own routes), and a record of what was written to it. */
function boot(
  portal: 'admin' | 'team',
  perms: Record<string, unknown> = ALL,
  init: Partial<World> = {},
  extra: Record<string, Answer> = {},
) {
  const w: World = {
    stock: VEHICLES(),
    columns: null,
    writes: [],
    saveError: null,
    saveAnswer: undefined,
    saveGate: null,
    deleteError: null,
    listGate: null,
    columnsGate: null,
    bulk: { inserted: 2, errors: [] },
    uploaded: null,
    bulkError: null,
    ...init,
  };
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  const asBody = (i: RequestInit): Body | null =>
    i.body && typeof i.body === 'string' ? (JSON.parse(i.body) as Body) : null;
  const record = (path: string, i: RequestInit) =>
    w.writes.push({ method: String(i.method), path, body: asBody(i) });
  const more: Record<string, Answer> = {
    [`${base}/stock`]: i => {
      if (i.method === 'POST') {
        record(`${base}/stock`, i);
        const reply = () =>
          w.saveError
            ? json(400, { error: w.saveError })
            : json(200, w.saveAnswer ?? vehicle(9, { ...(asBody(i) ?? {}), quantity: 1 }));
        return w.saveGate ? w.saveGate.then(reply) : reply();
      }
      const answer = () => {
        if (w.stock === 'offline') throw new TypeError('Failed to fetch');
        if (w.stock === 'forbidden') return json(403, { error: 'Not permitted' });
        if (w.stock === 'failing')
          return json(500, { error: 'relation "stock_vehicles" does not exist' });
        if (w.stock === 'odd') return json(200, [{ id: 'x' }]);
        if (w.stock === 'not-a-list') return json(200, { nothing: true });
        return json(200, w.stock);
      };
      return w.listGate ? w.listGate.then(answer) : answer();
    },
    [`${base}/stock/bulk`]: i => {
      record(`${base}/stock/bulk`, i);
      if (i.body instanceof FormData) w.uploaded = i.body;
      return w.bulkError ? json(400, { error: w.bulkError }) : json(200, w.bulk);
    },
    [`${base}/columns/stock`]: i => {
      if (i.method === 'PUT') {
        record(`${base}/columns/stock`, i);
        const body = asBody(i) as { columns: Column[] };
        w.columns = body.columns;
        return json(200, { ok: true, columns: body.columns });
      }
      const answer = () => json(200, { columns: w.columns, entity: 'stock' });
      return w.columnsGate ? w.columnsGate.then(answer) : answer();
    },
    ...extra,
  };
  for (const id of [1, 2, 3, 9]) {
    more[`${base}/stock/${id}`] = i => {
      record(`${base}/stock/${id}`, i);
      if (i.method === 'DELETE')
        return w.deleteError ? json(403, { error: w.deleteError }) : json(200, { ok: true });
      return w.saveError
        ? json(400, { error: w.saveError })
        : json(200, vehicle(id, { ...(asBody(i) ?? {}), quantity: 1 }));
    };
  }
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe(perms), {
    entries: ['/stock'],
    more,
  });
  return { ...s, w, base };
}

const page = () => document.querySelector('[data-part=stockPage]') as HTMLElement;
/** How many times the register has been read (the same address is written to as well). */
const reads = (s: { calls: (p: string) => { init: RequestInit }[] }) =>
  s.calls('/api/dashboard/stock').filter(c => !c.init.method || c.init.method === 'GET').length;
const words = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const unitRows = () => [...document.querySelectorAll('[data-part=unitRow]')] as HTMLElement[];
const loaded = async () =>
  waitFor(() =>
    expect(
      document.querySelector('[data-part=views]') !== null ||
        /Failed to load|came back in a form|relation|Not permitted/.test(page()?.textContent ?? ''),
    ).toBe(true),
  );
const tab = (name: string) =>
  [...document.querySelectorAll('[data-part=tab]')].find(t => words(t) === name) as HTMLElement;
const search = () =>
  document.querySelector('input[placeholder^="Search make"]') as HTMLInputElement;
const viewTab = (name: string) =>
  [...document.querySelectorAll('[data-part=viewTab]')].find(t => words(t) === name) as HTMLElement;

describe('Inventory & Logistics — the Models tab', () => {
  it('heads the administrator’s page with the title, the bulk upload and Add model, and the tabs under it', async () => {
    boot('admin');
    await loaded();
    expect(words(document.querySelector('[data-part=pageTitle]'))).toBe('Inventory & Logistics');
    expect(words(document.querySelector('[data-part=csv]'))).toBe('Bulk upload CSV');
    expect(words(document.querySelector('[data-part=add]'))).toBe('Add model');
    expect([...document.querySelectorAll('[data-part=tab]')].map(words)).toEqual([
      'Models',
      'Tracking',
    ]);
    expect(tab('Models').getAttribute('aria-selected')).toBe('true');
  });

  it('heads the team’s page with a card title and hint, the search and Add model, and a strip of tabs', async () => {
    boot('team');
    await loaded();
    expect(words(document.querySelector('[data-part=pageTitle]'))).toBe('Inventory');
    expect(words(document.querySelector('[data-part=pageHint]'))).toBe(
      'Cars in stock, with the units held against each model.',
    );
    expect(document.querySelector('[data-part=csv]')).toBeNull();
    expect(
      (document.querySelector('[data-part=headActions] input') as HTMLInputElement).placeholder,
    ).toBe('Search make, model or trim…');
    expect(words(document.querySelector('[data-part=add]'))).toBe('Add model');
    expect([...document.querySelectorAll('[data-part=tab]')].map(words)).toEqual([
      'Models',
      'Tracking',
    ]);
  });

  it('lets a key do what a click does on the team’s tabs — Enter or Space, and no other', async () => {
    boot('team');
    await loaded();
    tab('Tracking').focus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(tab('Tracking').getAttribute('aria-selected')).toBe('true'));
    tab('Models').focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(tab('Models').getAttribute('aria-selected')).toBe('true'));
    tab('Tracking').focus();
    await userEvent.keyboard('a');
    await userEvent.keyboard('{Escape}');
    expect(tab('Models').getAttribute('aria-selected')).toBe('true');
    expect(tab('Tracking').getAttribute('aria-selected')).toBe('false');
  });

  it('shows the loader until the register and the columns are had', async () => {
    const gate = deferred<void>();
    boot('admin', ALL, { listGate: gate.promise });
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=loading]'))).toBe('Loading stock…'),
    );
    gate.resolve();
    await loaded();
    expect(document.querySelector('[data-part=loading]')).toBeNull();
  });

  it('keeps the loader up until the columns are had, though the register already is', async () => {
    const columns = deferred<void>();
    const s = boot('admin', ALL, { columnsGate: columns.promise });
    await waitFor(() => expect(reads(s)).toBe(1));
    await new Promise(r => setTimeout(r, 40)); // (the register's answer lands meanwhile)
    expect(words(document.querySelector('[data-part=loading]'))).toBe('Loading stock…');
    expect(document.querySelector('[data-part=views]')).toBeNull();
    columns.resolve();
    await loaded();
  });

  it('opens a form only once the columns are had, so that it has the columns the administrator arranged', async () => {
    const columns = deferred<void>();
    boot('admin', ALL, { columnsGate: columns.promise });
    await waitFor(() => expect(document.querySelector('[data-part=add]')).not.toBeNull());
    await userEvent.click(document.querySelector('[data-part=add]') as HTMLElement);
    expect(document.querySelector('[data-part=dialog]')).toBeNull();
    columns.resolve();
    await waitFor(() => expect(document.querySelector('[data-part=dialog]')).not.toBeNull());
  });

  it('asks for the register each time the screen opens, and the page gives way to the loader while it does', async () => {
    const s = boot('admin');
    await loaded();
    expect(s.calls('/api/dashboard/stock').length).toBe(1);
    fireEvent.click(document.querySelector('[data-screen=home]')!);
    await waitFor(() => expect(page()).toBeNull());
    const gate = deferred<void>();
    s.w.listGate = gate.promise;
    fireEvent.click(document.querySelector('[data-screen=stock]')!);
    await waitFor(() => expect(document.querySelector('[data-part=loading]')).not.toBeNull());
    expect(s.calls('/api/dashboard/stock').length).toBe(2);
    expect(unitRows().length).toBe(0); // (the cars of the last visit are not shown while the new ones are had)
    gate.resolve();
    await loaded();
    expect(unitRows().length).toBe(3);
  });

  it('says “Loading inventory…” in the team’s page until the columns are had, then “Loading stock…” as the classic page does', async () => {
    const columns = deferred<void>();
    const list = deferred<void>();
    boot('team', ALL, { columnsGate: columns.promise, listGate: list.promise });
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=loading]'))).toBe('Loading inventory…'),
    );
    columns.resolve();
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=loading]'))).toBe('Loading stock…'),
    );
    list.resolve();
    await loaded();
  });

  it('says “Loading stock…” in the admin’s page all the while', async () => {
    const columns = deferred<void>();
    boot('admin', ALL, { columnsGate: columns.promise });
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=loading]'))).toBe('Loading stock…'),
    );
    columns.resolve();
    await loaded();
  });

  it('says where the cars are: how many, in which state, what the register is worth', async () => {
    boot('admin');
    await loaded();
    expect(words(document.querySelector('[data-part=mixCount]'))).toBe('3');
    expect(words(document.querySelector('[data-part=mixUnit]'))).toBe('units');
    expect([...document.querySelectorAll('[data-part=mixKey]')].map(words)).toEqual([
      'Car in Preparation1',
      'In Logistics1',
      'Car Delivered to moto1',
    ]);
    // 1,950,000 (its own price) + 1,950,000 (the model's, the car having none) + 800,000
    expect(words(document.querySelector('[data-part=mixValue]'))).toBe('4,700,000 EGP');
    expect(words(document.querySelector('[data-part=mixLabel]'))).toBe('3 models · register value');
  });

  it('tells how many cars an older save counted and nobody named, and Review puts the models in front of you', async () => {
    boot('admin');
    await loaded();
    expect(words(document.querySelector('[data-part=notice]'))).toBe(
      '3 units are unmatched. They were recorded before VIN tracking — add their VINs to bring those models back into stock.Review',
    );
    await userEvent.click(viewTab('All vehicles'));
    // (the cars narrowed by a status and by a word, as they may well be when somebody asks to review)
    await userEvent.click(document.querySelector('[data-part=filter]') as HTMLElement);
    await userEvent.click(
      [...document.querySelectorAll('[role=option]')].find(
        o => words(o) === 'In Logistics',
      ) as HTMLElement,
    );
    await userEvent.type(search(), 'seal');
    expect(unitRows().length).toBe(1);
    await userEvent.click(document.querySelector('[data-part=review]') as HTMLElement);
    expect(viewTab('By model').className).toMatch(/active/);
    expect(document.querySelectorAll('[data-part=modelCard]').length).toBe(3);
    // …and nothing is narrowed any more when the cars are looked at again
    await userEvent.click(viewTab('All vehicles'));
    expect(document.querySelector('[data-part=chip]')).toBeNull();
    expect(search().value).toBe('');
    expect(unitRows().length).toBe(3);
  });

  it('writes the notes about unmatched cars and cars with no VIN in the singular where there is one', async () => {
    boot('admin', ALL, {
      stock: [
        vehicle(1, { legacy_count: 1 }),
        vehicle(2, {
          make: 'Kia',
          model: 'Seltos',
          quantity: 2,
          units: [unit({ colour: 'Red' }), unit({ colour: 'Blue' })],
        }),
      ],
    });
    await loaded();
    expect(words(document.querySelector('[data-part=notice]'))).toBe(
      '1 unit is unmatched. It was recorded before VIN tracking — add its VIN to bring those models back into stock.Review',
    );
    await userEvent.click(viewTab('By model'));
    const cards = [...document.querySelectorAll('[data-part=modelCard]')];
    expect(words(cards[0]!.querySelector('[data-part=legacyNote]'))).toBe(
      '1 car was recorded here before VIN tracking. Add it to bring this model back into stock.',
    );
    expect(words(cards[1]!.querySelector('[data-part=legacyNote]'))).toBe(
      '2 cars have no VIN yet.',
    );
    await userEvent.click(document.querySelectorAll('[data-part=cardEdit]')[0] as HTMLElement);
    expect(words(document.querySelector('[data-part=dialog] [data-part=legacyNote]'))).toBe(
      '1 car was recorded here before VIN tracking. Add it above to bring this model back into stock.',
    );
  });

  it('says nothing of unmatched cars where there are none', async () => {
    boot('admin', ALL, { stock: [vehicle(1, { units: [unit({ vin: 'V1' })], quantity: 1 })] });
    await loaded();
    expect(document.querySelector('[data-part=notice]')).toBeNull();
    expect(document.querySelector('[data-part=views]')).not.toBeNull();
  });

  it('draws a row for each car in All vehicles, with the columns the page starts with', async () => {
    boot('admin');
    await loaded();
    const head = [...document.querySelectorAll('[data-part=unitTable] thead th')].map(words);
    expect(head).toEqual([
      'Vehicle',
      'Consignee',
      'Colour EXT / INT',
      'VIN',
      'Status',
      'Price List',
      'Discounted',
      'Logistics',
      'Supplier',
      '',
    ]);
    const rows = unitRows();
    expect(rows.length).toBe(3);
    const first = [...rows[0]!.children].map(words);
    expect(first.slice(0, 5)).toEqual([
      'BYD SealDesign',
      'Hany',
      'White / Black',
      'LGXC76C41P0123456',
      'In Logistics',
    ]);
    expect(first[5]).toBe('1,950,000');
    // (a dot of the colour it names beside each colour: black wins over white where both are named)
    expect(
      rows.map(r => (r.children[2]!.querySelector('i') as HTMLElement).style.background),
    ).toEqual(['rgb(28, 28, 31)', 'rgb(185, 179, 164)', 'rgb(239, 68, 68)']);
    // (a car nobody has said much about: a dash for each thing it has no word for)
    expect([...rows[2]!.children].map(words)).toEqual([
      'BYD Atto 3',
      '—',
      'Red',
      '—',
      'Car in Preparation',
      '800,000',
      '—',
      '—',
      '—',
      '',
    ]);
  });

  it('writes a dash for a colour a car has none of, as for every other word it has none of', async () => {
    boot('admin', ALL, { stock: [vehicle(1, { quantity: 1, units: [unit()] })] });
    await loaded();
    expect([...unitRows()[0]!.children].map(words)).toEqual([
      'BYD Seal',
      '—',
      '—',
      '—',
      'SEND TO SUPPLIER',
      '—',
      '—',
      '—',
      '—',
      '',
    ]);
    // …and in a lane: its model, that it has no VIN, and nothing in the place of a colour or a supplier
    await userEvent.click(viewTab('By status'));
    const [bare] = document.querySelectorAll('[data-part=laneCard]');
    expect(words(bare)).toBe('BYD SealNo VIN0');
    expect(bare!.querySelectorAll('[data-part=laneMeta]').length).toBe(1);
    expect(bare!.querySelector('[data-part=laneFoot]')).toBeNull();
  });

  it('labels each cell of a row from its own heading, as the classic page does for a phone — the Edit cell with none', async () => {
    boot('admin');
    await loaded();
    const heads = [...document.querySelectorAll('[data-part=unitTable] thead th')].map(words);
    const cells = [...unitRows()[0]!.children].map(c => c.getAttribute('data-label'));
    expect(cells).toEqual(heads);
    expect(cells[cells.length - 1]).toBe('');
    // …and the cars inside a model's card, under the card's own headings
    fireEvent.click(document.querySelectorAll('[data-part=viewTab]')[2]!);
    const card = document.querySelector('[data-part=cardUnits]')!;
    const cardHeads = [...card.querySelectorAll('thead th')].map(words);
    expect(cardHeads.length).toBeGreaterThan(5);
    expect(
      [...card.querySelectorAll('tbody tr')[0]!.children].map(c => c.getAttribute('data-label')),
    ).toEqual(cardHeads);
  });

  it('prices a car by its own list price, else its model’s, and a dash where there is neither', async () => {
    boot('admin');
    await loaded();
    const rows = unitRows();
    // the second Seal has no list price: the model’s is used; the discount has nothing to fall back on
    const second = [...rows[1]!.children].map(words);
    expect(second[5]).toBe('1,950,000');
    expect(second[6]).toBe('—');
  });

  it('searches make, model, trim and VIN', async () => {
    boot('admin');
    await loaded();
    const box = search();
    await userEvent.type(box, 'atto');
    expect(unitRows().length).toBe(1);
    await userEvent.clear(box);
    await userEvent.type(box, 'LGXC76C41P0123457');
    expect(unitRows().length).toBe(1);
    await userEvent.clear(box);
    await userEvent.type(box, 'zzz');
    expect(words(document.querySelector('[data-part=register] [data-part=none]'))).toBe(
      'No units match.',
    );
  });

  it('draws the same register as lanes by status, with each lane’s cars, value and share', async () => {
    boot('admin');
    await loaded();
    await userEvent.click(viewTab('By status'));
    const lanes = [...document.querySelectorAll('[data-part=lane]')];
    expect(lanes.map(l => words(l.querySelector('[data-part=pill]')))).toEqual([
      'SEND TO SUPPLIER',
      'Car in Preparation',
      'In Logistics',
      'Car Delivered to moto',
    ]);
    const counts = lanes.map(l => words(l.querySelector('[data-part=laneN]')));
    expect(counts).toEqual(['0', '1', '1', '1']);
    const logistics = lanes[2]!;
    expect(words(logistics.querySelector('[data-part=laneVal]'))).toBe('1,950,000 EGP');
    expect(words(logistics.querySelector('[data-part=laneShare]'))).toBe('33% of units');
    expect(words(logistics.querySelector('[data-part=laneCard]'))).toContain('BYD Seal');
    expect(words(logistics.querySelector('[data-part=laneCard]'))).toContain('LGXC76C41P0123456');
    expect(words(lanes[0]!.querySelector('[data-part=none]'))).toBe('Nothing here');
    // a car with no VIN says so; a lane for cars with no status is there only where there are some
    expect(words(lanes[1]!.querySelector('[data-part=laneCard]'))).toContain('No VIN');
    expect(lanes.some(l => /Unassigned/.test(words(l)))).toBe(false);
    expect(lanes.map(l => [...l.querySelectorAll('[data-part=laneCard]')].map(words))).toEqual([
      [],
      ['BYD Atto 3No VINRed800,000'],
      ['BYD SealLGXC76C41P0123456White / Black1,950,000BYD'],
      ['BYD SealLGXC76C41P0123457Grey1,950,000BYD'],
    ]);
    // (a car with a colour and a supplier says both, on lines of their own)
    expect(logistics.querySelectorAll('[data-part=laneMeta]').length).toBe(2);
    expect(words(logistics.querySelector('[data-part=laneFoot]'))).toBe('BYD');
    expect(lanes.map(l => words(l.querySelector('[data-part=laneVal]')))).toEqual([
      '—',
      '800,000 EGP',
      '1,950,000 EGP',
      '1,950,000 EGP',
    ]);
    expect(lanes.map(l => words(l.querySelector('[data-part=laneShare]')))).toEqual([
      '0% of units',
      '33% of units',
      '33% of units',
      '33% of units',
    ]);
  });

  it('draws a card for each model in By model, with its cars, its price and its notes', async () => {
    boot('admin');
    await loaded();
    await userEvent.click(viewTab('By model'));
    const cards = [...document.querySelectorAll('[data-part=modelCard]')];
    expect(cards.length).toBe(3);
    const seal = cards[0]!;
    expect(words(seal.querySelector('[data-part=modelTitle]'))).toBe('BYD Seal');
    expect(words(seal.querySelector('[data-part=qty]'))).toBe('2 in stock');
    // (green where there are cars, grey where there are none)
    expect(seal.querySelector('[data-part=qty]')!.className).toMatch(/(^|[\s_])in([\s_]|$)/);
    expect(seal.querySelector('[data-part=qty]')!.className).not.toMatch(/(^|[\s_])out([\s_]|$)/);
    expect(words(seal.querySelector('[data-part=modelPrice]'))).toBe('1,950,000 EGP');
    expect(seal.querySelectorAll('[data-part=cardUnits] tbody tr').length).toBe(2);
    expect(words(seal.querySelector('[data-part=notes]'))).toBe('Immediate delivery');
    // (cars that all have a VIN, and none counted in the old way: nothing to warn of)
    expect(seal.querySelector('[data-part=legacyNote]')).toBeNull();
    const corolla = cards[1]!;
    expect(words(corolla.querySelector('[data-part=qty]'))).toBe('0 in stock');
    expect(corolla.querySelector('[data-part=qty]')!.className).toMatch(/(^|[\s_])out([\s_]|$)/);
    expect(corolla.querySelector('[data-part=qty]')!.className).not.toMatch(/(^|[\s_])in([\s_]|$)/);
    expect(words(corolla.querySelector('[data-part=legacyNote]'))).toContain(
      '3 cars were recorded here before VIN tracking',
    );
    // (a model with no cars draws no table of them, and one with no notes no box for them)
    expect(corolla.querySelector('[data-part=cardUnits]')).toBeNull();
    expect(corolla.querySelector('[data-part=notes]')).toBeNull();
    const atto = cards[2]!;
    expect(words(atto.querySelector('[data-part=qty]'))).toBe('1 in stock');
    expect(atto.querySelector('[data-part=qty]')!.className).toMatch(/(^|[\s_])in([\s_]|$)/);
    expect(words(atto.querySelector('[data-part=modelPrice]'))).toBe('Price not set');
    expect(words(atto.querySelector('[data-part=legacyNote]'))).toBe('1 car has no VIN yet.');
  });

  it('remembers the view across visits, and draws All vehicles where it has none', async () => {
    boot('admin');
    await loaded();
    expect(viewTab('All vehicles').className).toMatch(/active/);
    await userEvent.click(viewTab('By status'));
    expect(localStorage.getItem('ml_stock_view')).toBe('status');
    cleanup();
    boot('admin');
    await loaded();
    expect(viewTab('By status').className).toMatch(/active/);
  });

  it('narrows the cars to a status from the Filter menu, and the chip takes it away', async () => {
    boot('admin');
    await loaded();
    const trigger = document.querySelector('[data-part=filter]') as HTMLElement;
    expect(words(trigger)).toBe('Filter');
    await userEvent.click(trigger);
    const options = [...document.querySelectorAll('[role=option]')].map(words);
    expect(options).toEqual([
      '— All statuses —',
      'SEND TO SUPPLIER',
      'Car in Preparation',
      'In Logistics',
      'Car Delivered to moto',
    ]);
    await userEvent.click(
      [...document.querySelectorAll('[role=option]')].find(
        o => words(o) === 'In Logistics',
      ) as HTMLElement,
    );
    expect(unitRows().length).toBe(1);
    expect(words(document.querySelector('[data-part=filter]'))).toBe('In Logistics');
    expect(words(document.querySelector('[data-part=chip]'))).toBe('In Logistics ×');
    await userEvent.click(document.querySelector('[data-part=chip]') as HTMLElement);
    expect(unitRows().length).toBe(3);
    expect(document.querySelector('[data-part=chip]')).toBeNull();
  });

  it('keeps the Filter and the grouping out of By model, and the grouping out of By status', async () => {
    boot('admin');
    await loaded();
    expect(document.querySelector('[data-part=groupBy]')).not.toBeNull();
    await userEvent.click(viewTab('By status'));
    expect(document.querySelector('[data-part=filter]')).not.toBeNull();
    expect(document.querySelector('[data-part=groupBy]')).toBeNull();
    await userEvent.click(viewTab('By model'));
    expect(document.querySelector('[data-part=filter]')).toBeNull();
  });

  it('groups All vehicles by supplier, the names in order, the cars of no supplier together', async () => {
    boot('admin');
    await loaded();
    const group = document.querySelector('[data-part=groupBy]') as HTMLElement;
    expect(words(group)).toBe('Group: None');
    await userEvent.click(group);
    expect(words(document.querySelector('[data-part=groupBy]'))).toBe('Group: Supplier');
    const heads = [...document.querySelectorAll('[data-part=supplierHead]')].map(words);
    expect(heads).toEqual(['BYD2', 'No supplier1']);
    await userEvent.click(document.querySelector('[data-part=groupBy]') as HTMLElement);
    expect(document.querySelectorAll('[data-part=supplierHead]').length).toBe(0);
  });

  it('keeps a model that has no cars when a search is typed that matches its words', async () => {
    boot('admin');
    await loaded();
    await userEvent.click(viewTab('By model'));
    await userEvent.type(search(), 'corolla');
    const cards = [...document.querySelectorAll('[data-part=modelCard]')];
    expect(cards.map(c => words(c.querySelector('[data-part=modelTitle]')))).toEqual([
      'Toyota Corolla',
    ]);
    await userEvent.clear(search());
    await userEvent.type(search(), 'nothing like it');
    expect(words(document.querySelector('[data-part=register] [data-part=none]'))).toBe(
      'No vehicles match your search.',
    );
  });

  it('says there are no vehicles where there are none, and what to do', async () => {
    boot('admin', ALL, { stock: [] });
    await loaded();
    await userEvent.click(viewTab('By model'));
    expect(words(document.querySelector('[data-part=register] [data-part=none]'))).toBe(
      'No vehicles in stock yet.Click “Add vehicle” or “Bulk upload CSV” to get started.',
    );
    expect(words(document.querySelector('[data-part=none]'))).toBe('No units recorded yet.');
  });

  it('gives the server’s words when the register could not be had, and its own when nothing came', async () => {
    boot('admin', ALL, { stock: 'failing' });
    await loaded();
    expect(words(document.querySelector('[data-part=error]'))).toBe(
      'relation "stock_vehicles" does not exist',
    );
    cleanup();
    boot('admin', ALL, { stock: 'odd' });
    await loaded();
    expect(words(document.querySelector('[data-part=error]'))).toBe(
      'The stock came back in a form this app does not know.',
    );
    cleanup();
    boot('team', ALL, { stock: 'forbidden' });
    await loaded();
    expect(words(document.querySelector('[data-part=error]'))).toBe('Not permitted');
    cleanup();
    boot('admin', ALL, { stock: 'offline' });
    await loaded();
    expect(words(document.querySelector('[data-part=error]'))).toBe('Failed to load stock.');
  });

  it('draws no Tracking tab for a member who may not follow the containers, and no Add or Edit for one who may only browse', async () => {
    boot('team', NO_TRACKING);
    await loaded();
    expect([...document.querySelectorAll('[data-part=tab]')].map(words)).toEqual(['Models']);
    cleanup();
    boot('team', BROWSE);
    await loaded();
    expect(document.querySelector('[data-part=add]')).toBeNull();
    expect(document.querySelectorAll('[data-part=rowEdit]').length).toBe(0);
    await userEvent.click(viewTab('By model'));
    expect(document.querySelectorAll('[data-part=cardEdit]').length).toBe(0);
    expect(document.querySelectorAll('[data-part=cardDelete]').length).toBe(0);
  });

  it('puts Edit on a card for those who may edit, and Delete there only in the administrator’s page', async () => {
    boot('team');
    await loaded();
    await userEvent.click(viewTab('By model'));
    expect(document.querySelectorAll('[data-part=cardEdit]').length).toBe(3);
    expect(document.querySelectorAll('[data-part=cardDelete]').length).toBe(0);
    cleanup();
    boot('admin');
    await loaded();
    await userEvent.click(viewTab('By model'));
    expect(document.querySelectorAll('[data-part=cardEdit]').length).toBe(3);
    expect(document.querySelectorAll('[data-part=cardDelete]').length).toBe(3);
  });

  it('deletes a model after asking, and not when the question is answered no', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(viewTab('By model'));
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(document.querySelectorAll('[data-part=cardDelete]')[0] as HTMLElement);
    expect(ask).toHaveBeenCalledWith('Delete BYD Seal Design from stock?');
    expect(s.w.writes).toEqual([]);
    ask.mockReturnValue(true);
    await userEvent.click(document.querySelectorAll('[data-part=cardDelete]')[0] as HTMLElement);
    await waitFor(() =>
      expect(s.w.writes.map(x => x.method + ' ' + x.path)).toEqual([
        'DELETE /api/dashboard/stock/1',
      ]),
    );
    await waitFor(() => expect(reads(s)).toBe(2));
  });

  it('says what the server said when a model could not be deleted, and asks for the register again all the same', async () => {
    const s = boot('admin', ALL, { deleteError: 'Only the administrator may delete a model' });
    await loaded();
    await userEvent.click(viewTab('By model'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(document.querySelectorAll('[data-part=cardDelete]')[0] as HTMLElement);
    await waitFor(() =>
      expect([...document.querySelectorAll('[data-part=toast]')].map(words)).toContain(
        'Only the administrator may delete a model',
      ),
    );
    await waitFor(() => expect(reads(s)).toBe(2));
    expect(document.querySelectorAll('[data-part=modelCard]').length).toBe(3);
  });

  it('opens the form empty for Add model, with no cars until one is asked for, and saves what was typed', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(document.querySelector('[data-part=add]') as HTMLElement);
    expect(words(document.querySelector('[data-part=dialog] [data-part=title]'))).toBe(
      'Add vehicle',
    );
    expect(words(document.querySelector('[data-part=dialog] [data-part=save]'))).toBe(
      'Add vehicle',
    );
    expect((document.querySelector('#stk-make') as HTMLInputElement).value).toBe('');
    expect(document.querySelectorAll('[data-part=gridRow]').length).toBe(0);
    await userEvent.type(document.querySelector('#stk-make') as HTMLInputElement, ' Geely ');
    await userEvent.type(document.querySelector('#stk-model') as HTMLInputElement, ' Monjaro ');
    await userEvent.type(document.querySelector('#stk-trim') as HTMLInputElement, ' GT ');
    await userEvent.type(document.querySelector('#stk-price') as HTMLInputElement, '2450000');
    await userEvent.type(document.querySelector('#stk-notes') as HTMLInputElement, ' Fresh ');
    await userEvent.click(document.querySelector('[data-part=addUnit]') as HTMLElement);
    const cells = document.querySelectorAll('[data-part=gridRow] [data-part=gridCell] input');
    await userEvent.type(cells[2] as HTMLInputElement, 'LGXC1');
    await userEvent.click(document.querySelector('[data-part=save]') as HTMLElement);
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    expect(s.w.writes[0]!.method + ' ' + s.w.writes[0]!.path).toBe('POST /api/dashboard/stock');
    const body = s.w.writes[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      make: 'Geely',
      model: 'Monjaro',
      trim: 'GT',
      price: '2450000',
      notes: 'Fresh',
    });
    const units = body['units'] as Record<string, unknown>[];
    expect(units.length).toBe(1);
    expect(units[0]).toMatchObject({ vin: 'LGXC1', status: 'send_to_supplier' });
    await waitFor(() => expect(document.querySelector('[data-part=dialog]')).toBeNull());
    // (and the register is asked for again, so that the new model is in it)
    await waitFor(() => expect(reads(s)).toBe(2));
  });

  it('says so when the model that was saved came back in a form the app does not know, and keeps the sheet open', async () => {
    const s = boot('admin', ALL, { saveAnswer: { nothing: true } });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=add]') as HTMLElement);
    await userEvent.type(document.querySelector('#stk-make') as HTMLInputElement, 'Geely');
    await userEvent.type(document.querySelector('#stk-model') as HTMLInputElement, 'X');
    await userEvent.click(document.querySelector('[data-part=save]') as HTMLElement);
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=formError]'))).toBe(
        'The saved vehicle came back in a form this app does not know.',
      ),
    );
    expect(document.querySelector('[data-part=dialog]')).not.toBeNull();
    expect(reads(s)).toBe(1);
  });

  it('needs a make and a model, and says so in the sheet without sending anything', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(document.querySelector('[data-part=add]') as HTMLElement);
    await userEvent.type(document.querySelector('#stk-make') as HTMLInputElement, 'Geely');
    await userEvent.click(document.querySelector('[data-part=save]') as HTMLElement);
    expect(words(document.querySelector('[data-part=formError]'))).toBe(
      'Make and Model are required.',
    );
    expect(s.w.writes).toEqual([]);
  });

  it('sends a model once, though Save is pressed again while the server is still answering', async () => {
    const gate = deferred<void>();
    const s = boot('admin', ALL, { saveGate: gate.promise });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=add]') as HTMLElement);
    await userEvent.type(document.querySelector('#stk-make') as HTMLInputElement, 'Geely');
    await userEvent.type(document.querySelector('#stk-model') as HTMLInputElement, 'X');
    const save = document.querySelector('[data-part=save]') as HTMLElement;
    await userEvent.click(save);
    await userEvent.click(save);
    await userEvent.click(save);
    expect(s.w.writes.length).toBe(1);
    gate.resolve();
    await waitFor(() => expect(document.querySelector('[data-part=dialog]')).toBeNull());
    expect(s.w.writes.length).toBe(1);
  });

  it('begins a new car at the first status the administrator arranged', async () => {
    const s = boot('admin', ALL, {
      columns: [
        col('status', {
          label: 'Status',
          type: 'select',
          builtin: true,
          options: [
            { key: 'in_logistics', label: 'Shipped' },
            { key: 'delivered', label: 'Delivered' },
          ],
        }),
      ],
    });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=add]') as HTMLElement);
    await userEvent.type(document.querySelector('#stk-make') as HTMLInputElement, 'Geely');
    await userEvent.type(document.querySelector('#stk-model') as HTMLInputElement, 'X');
    await userEvent.click(document.querySelector('[data-part=addUnit]') as HTMLElement);
    await userEvent.click(document.querySelector('[data-part=save]') as HTMLElement);
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    const units = (s.w.writes[0]!.body as Record<string, unknown>)['units'] as Record<
      string,
      unknown
    >[];
    expect(units[0]).toMatchObject({ status: 'in_logistics' });
  });

  it('says nothing in the form of cars an older save counted where the model has cars named', async () => {
    boot('admin', ALL, {
      stock: [vehicle(1, { legacy_count: 2, quantity: 1, units: [unit({ vin: 'V1' })] })],
    });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=rowEdit]') as HTMLElement);
    expect(document.querySelector('[data-part=dialog]')).not.toBeNull();
    expect(document.querySelector('[data-part=dialog] [data-part=legacyNote]')).toBeNull();
  });

  it('shows the server’s refusal in the sheet and leaves it open', async () => {
    const s = boot('admin', ALL, { saveError: 'Model is required' });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=add]') as HTMLElement);
    await userEvent.type(document.querySelector('#stk-make') as HTMLInputElement, 'Geely');
    await userEvent.type(document.querySelector('#stk-model') as HTMLInputElement, 'X');
    await userEvent.click(document.querySelector('[data-part=save]') as HTMLElement);
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=formError]'))).toBe('Model is required'),
    );
    expect(document.querySelector('[data-part=dialog]')).not.toBeNull();
    expect(s.w.writes.length).toBe(1);
  });

  it('opens a model for change with its words and its cars, and saves the cars it holds', async () => {
    const s = boot('admin');
    await loaded();
    await userEvent.click(document.querySelectorAll('[data-part=rowEdit]')[0] as HTMLElement);
    expect(words(document.querySelector('[data-part=dialog] [data-part=title]'))).toBe(
      'Edit vehicle',
    );
    expect(words(document.querySelector('[data-part=dialog] [data-part=save]'))).toBe(
      'Save changes',
    );
    expect((document.querySelector('#stk-make') as HTMLInputElement).value).toBe('BYD');
    expect((document.querySelector('#stk-trim') as HTMLInputElement).value).toBe('Design');
    expect((document.querySelector('#stk-price') as HTMLInputElement).value).toBe('1950000');
    expect((document.querySelector('#stk-notes') as HTMLInputElement).value).toBe(
      'Immediate delivery',
    );
    expect(document.querySelectorAll('[data-part=gridRow]').length).toBe(2);
    await userEvent.click(document.querySelectorAll('[data-part=gridRemove]')[1] as HTMLElement);
    await userEvent.click(document.querySelector('[data-part=save]') as HTMLElement);
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    expect(s.w.writes[0]!.method + ' ' + s.w.writes[0]!.path).toBe('PUT /api/dashboard/stock/1');
    const units = (s.w.writes[0]!.body as Record<string, unknown>)['units'] as Record<
      string,
      unknown
    >[];
    expect(units.length).toBe(1);
    expect(units[0]).toMatchObject({
      vin: 'LGXC76C41P0123456',
      consignee: 'Hany',
      status: 'in_logistics',
    });
  });

  it('keeps what a car holds that no box of the form is for, and writes nothing over what a model holds besides', async () => {
    const s = boot('admin', ALL, {
      stock: [
        vehicle(1, {
          range_km: 480,
          quantity: 1,
          units: [{ ...unit({ vin: 'V1', colour: 'Red' }), customs_ref: 'KEEP-ME' }],
        }),
      ],
    });
    await loaded();
    await userEvent.click(document.querySelectorAll('[data-part=rowEdit]')[0] as HTMLElement);
    await userEvent.click(document.querySelector('[data-part=save]') as HTMLElement);
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    const body = s.w.writes[0]!.body as Record<string, unknown>;
    // (a model's other fields are not sent at all, so the server leaves them as they were; the cars are all sent, with theirs)
    expect(Object.keys(body).sort()).toEqual(['make', 'model', 'notes', 'price', 'trim', 'units']);
    expect((body['units'] as Record<string, unknown>[])[0]).toMatchObject({
      vin: 'V1',
      colour: 'Red',
      customs_ref: 'KEEP-ME',
    });
  });

  it('says in the form how many cars an older save counted and nobody named', async () => {
    boot('admin');
    await loaded();
    await userEvent.click(viewTab('By model'));
    await userEvent.click(document.querySelectorAll('[data-part=cardEdit]')[1] as HTMLElement);
    expect(words(document.querySelector('[data-part=dialog] [data-part=legacyNote]'))).toBe(
      '3 cars were recorded here before VIN tracking. Add them above to bring this model back into stock.',
    );
  });

  it('draws the columns the administrator arranged, the ones they added among them, in the table and the form', async () => {
    const columns = [
      col('consignee', { label: 'Consignee', builtin: true }),
      col('vin', { label: 'VIN', builtin: true }),
      col('status', {
        label: 'Status',
        type: 'select',
        builtin: true,
        options: [{ key: 'in_logistics', label: 'Shipped', color: '#8a5a00' }],
      }),
      col('cf_plate', { label: 'Plate' }),
    ];
    const s = boot('admin', ALL, {
      columns,
      stock: [
        vehicle(1, {
          units: [{ ...unit({ vin: 'V1', status: 'in_logistics' }), cf_plate: 'ABC 123' }],
        }),
      ],
    });
    await loaded();
    const head = [...document.querySelectorAll('[data-part=unitTable] thead th')].map(words);
    expect(head.slice(0, 5)).toEqual(['Vehicle', 'Consignee', 'VIN', 'Status', 'Plate']);
    const row = [...unitRows()[0]!.children].map(words);
    expect(row.slice(0, 5)).toEqual(['BYD Seal', '—', 'V1', 'Shipped', 'ABC 123']);
    // (a status colour written as hex reads its theme token, where a look defines one)
    expect(
      (unitRows()[0]!.querySelector('[data-part=pill]') as HTMLElement).style.getPropertyValue(
        '--c',
      ),
    ).toBe('var(--h-8a5a00,#8a5a00)');
    await userEvent.click(document.querySelectorAll('[data-part=rowEdit]')[0] as HTMLElement);
    expect(document.querySelector('[data-part=colsButton]')).not.toBeNull();
    const inputs = document.querySelectorAll('[data-part=gridRow] [data-part=gridCell] input');
    expect((inputs[1] as HTMLInputElement).value).toBe('V1');
    // (the builtins the arrangement does not mention follow it: consignee, VIN, Plate, then the rest)
    await userEvent.type(inputs[2] as HTMLInputElement, '9');
    await userEvent.click(document.querySelector('[data-part=save]') as HTMLElement);
    await waitFor(() => expect(s.w.writes.length).toBe(1));
    const units = (s.w.writes[0]!.body as Record<string, unknown>)['units'] as Record<
      string,
      unknown
    >[];
    expect(units[0]).toMatchObject({ vin: 'V1', cf_plate: 'ABC 1239' });
  });

  it('draws each kind of field somebody added in its own way, and a dash for the ones a car has no word for', async () => {
    const options = [
      { key: 'a', label: 'Grade A', color: '#8a5a00' },
      { key: 'b', label: 'Grade B' },
    ];
    boot('admin', ALL, {
      columns: [
        col('cf_note', { label: 'Remark' }),
        col('cf_qty', { label: 'Count', type: 'number' }),
        col('cf_grade', { label: 'Grade', type: 'select', options }),
        col('cf_pick', { label: 'Pick', type: 'radio', options }),
        col('cf_ok', { label: 'Checked', type: 'checkbox' }),
        col('cf_site', { label: 'Site', type: 'link' }),
      ],
      stock: [
        vehicle(1, {
          quantity: 2,
          units: [
            {
              ...unit({ vin: 'V1' }),
              cf_note: 'Fragile',
              cf_qty: 1200,
              cf_grade: 'a',
              cf_pick: 'b',
              cf_ok: true,
              cf_site: 'example.com/cars',
            },
            unit({ vin: 'V2' }),
          ],
        }),
      ],
    });
    await loaded();
    const [full, bare] = unitRows().map(r => [...r.children].slice(1, 7));
    expect(full!.map(words)).toEqual(['Fragile', '1,200', 'Grade A', 'Grade B', '✓', 'cars']);
    expect(full![5]!.querySelector('a')!.getAttribute('href')).toBe('https://example.com/cars');
    expect(full![2]!.querySelector('[data-part=badge]')).not.toBeNull();
    expect(full![3]!.querySelector('[data-part=badge]')).not.toBeNull();
    expect(bare!.map(words)).toEqual(['—', '—', '—', '—', '—', '—']);
  });

  it('gives the team’s columns the same arrangement but no way to change it', async () => {
    boot('team', ALL, { columns: [col('vin', { label: 'VIN', builtin: true })] });
    await loaded();
    await userEvent.click(document.querySelectorAll('[data-part=rowEdit]')[0] as HTMLElement);
    expect(document.querySelector('[data-part=colsButton]')).toBeNull();
    expect(document.querySelector('[data-part=fieldButton]')).toBeNull();
  });

  it('uploads the administrator’s CSV and says how many went in and why a row did not', async () => {
    localStorage.setItem('ml_admin_token', 'a b+c/d');
    const s = boot('admin', ALL, {
      bulk: { inserted: 2, errors: ['Row 3: Model is required', 'Row 5: Price is not a number'] },
    });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=csv]') as HTMLElement);
    expect(words(document.querySelector('[data-part=dialog] [data-part=title]'))).toBe(
      'Bulk upload vehicles',
    );
    const link = document.querySelector('[data-part=template]') as HTMLAnchorElement;
    // (a download cannot carry a header, so the token goes in the address, written for an address)
    expect(link.getAttribute('href')).toBe('/api/dashboard/stock/template.csv?_t=a%20b%2Bc%2Fd');
    await userEvent.click(document.querySelector('[data-part=upload]') as HTMLElement);
    expect(words(document.querySelector('[data-part=csvResult]'))).toBe(
      'Please choose a CSV file.',
    );
    const file = new File(['make,model\nBYD,Seal'], 'stock.csv', { type: 'text/csv' });
    await userEvent.upload(document.querySelector('[data-part=csvFile]') as HTMLInputElement, file);
    await userEvent.click(document.querySelector('[data-part=upload]') as HTMLElement);
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=csvResult]'))).toBe(
        'Imported 2 vehicle(s)Row 3: Model is requiredRow 5: Price is not a number',
      ),
    );
    // (a line to itself for each: one under the count, one between the two)
    expect(document.querySelectorAll('[data-part=csvResult] br').length).toBe(2);
    expect(s.w.writes.map(x => x.method + ' ' + x.path)).toEqual([
      'POST /api/dashboard/stock/bulk',
    ]);
    // (the file goes as the field the server reads it from)
    expect((s.w.uploaded?.get('file') as File | null)?.name).toBe('stock.csv');
    await waitFor(() => expect(reads(s)).toBe(2));
  });

  it('says only how many went in when every row did', async () => {
    boot('admin', ALL, { bulk: { inserted: 2, errors: [] } });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=csv]') as HTMLElement);
    await userEvent.upload(
      document.querySelector('[data-part=csvFile]') as HTMLInputElement,
      new File(['make,model\nBYD,Seal'], 'stock.csv', { type: 'text/csv' }),
    );
    await userEvent.click(document.querySelector('[data-part=upload]') as HTMLElement);
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=csvResult]'))).toBe('Imported 2 vehicle(s)'),
    );
    expect(document.querySelectorAll('[data-part=csvResult] br').length).toBe(0);
  });

  it('says “Upload failed” when the answer to an upload is not one the app knows, and does not read the register again', async () => {
    const s = boot('admin', ALL, { bulk: { nothing: true } });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=csv]') as HTMLElement);
    const file = new File(['make,model\nBYD,Seal'], 'stock.csv', { type: 'text/csv' });
    await userEvent.upload(document.querySelector('[data-part=csvFile]') as HTMLInputElement, file);
    await userEvent.click(document.querySelector('[data-part=upload]') as HTMLElement);
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=csvResult]'))).toBe('Upload failed'),
    );
    expect(reads(s)).toBe(1);
  });

  it('says why a CSV was refused', async () => {
    boot('admin', ALL, { bulkError: 'CSV has no data rows' });
    await loaded();
    await userEvent.click(document.querySelector('[data-part=csv]') as HTMLElement);
    await userEvent.upload(
      document.querySelector('[data-part=csvFile]') as HTMLInputElement,
      new File(['make'], 'a.csv'),
    );
    await userEvent.click(document.querySelector('[data-part=upload]') as HTMLElement);
    await waitFor(() =>
      expect(words(document.querySelector('[data-part=csvResult]'))).toBe('CSV has no data rows'),
    );
  });
});
