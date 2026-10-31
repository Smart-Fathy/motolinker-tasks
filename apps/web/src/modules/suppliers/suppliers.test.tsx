import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  window.history.replaceState(null, '', '/');
});

const supplier = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `Supplier ${id}`,
  contact: '',
  address: '',
  country: '',
  notes: '',
  custom_fields: {},
  created_by: 'admin',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});
const YU = supplier(1, {
  name: 'Yu Motors',
  contact: 'yu@example.com',
  country: 'China',
  address: 'Shanghai',
  custom_fields: { cf_rating: 'a', cf_secret: 'keep' },
});
const ALPHA = supplier(2, { name: 'Alpha' });
const vehicle = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  supplier_id: 1,
  brand: 'BYD',
  model: 'Seal',
  trim: 'Max',
  model_year: 2026,
  availability: 'Pre-order',
  fob_price: 32789,
  currency: 'EUR',
  lead_time: '4 weeks',
  accessories: 'mats',
  notes: 'keep',
  custom_fields: { cf_stock: '12', cf_secret: 'keep too' },
  ...over,
});
const col = (key: string, over: Partial<Column> = {}): Column => ({
  key,
  label: key,
  type: 'text',
  builtin: false,
  visible: true,
  ...over,
});
const builtinsOf = (defs: string[][]): Column[] =>
  defs.map(([key, label]) => col(key as string, { label: label as string, builtin: true }));
const SUPPLIER_CONFIG: Column[] = [
  ...builtinsOf([
    ['name', 'Name'],
    ['contact', 'Contact'],
  ]),
  col('country', {
    label: 'Country',
    builtin: true,
    type: 'select',
    options: [{ key: 'China', label: 'China', color: '#dc2626' }],
  }),
  col('address', { label: 'Address', builtin: true, visible: false }),
  ...builtinsOf([['notes', 'Notes']]),
  col('cf_rating', {
    label: 'Rating',
    type: 'select',
    required: true,
    options: [
      { key: 'a', label: 'Gold', color: '#c9a35e' },
      { key: 'b', label: 'Plain' },
    ],
  }),
  col('cf_vip', { label: 'VIP', type: 'checkbox' }),
  col('cf_site', { label: 'Website', type: 'link' }),
  col('cf_secret', { label: 'Internal', visible: false }),
];

const ALL = {
  suppliers: true,
  suppliersActions: {
    view: true,
    create: true,
    edit: true,
    delete: true,
    catalogue: true,
    docs: true,
    purchases: true,
  },
};
const VIEWER = {
  suppliers: true,
  suppliersActions: {
    view: true,
    create: false,
    edit: false,
    delete: false,
    catalogue: false,
    docs: false,
    purchases: false,
  },
};
const SOME = {
  suppliers: true,
  suppliersActions: {
    view: true,
    create: false,
    edit: false,
    delete: false,
    catalogue: true,
    docs: false,
    purchases: true,
  },
};

type Body = Record<string, unknown>;
interface World {
  suppliers: unknown[];
  offers: unknown[] | 'forbidden';
  stock: unknown[] | 'forbidden';
  columns: Column[] | null | 'failing';
  vehicleColumns: Column[] | null;
  vehicles: unknown[];
  docs: unknown[];
  purchases: unknown;
  writes: { method: string; path: string; body: Body | FormData | null }[];
  failWrites: boolean;
  /** what the server says to a save or a delete of a supplier */
  saveStatus: number;
}
const EMPTY_BOUGHT = {
  units: [],
  poLines: [],
  totals: { vehicles: 0, ordered: 0, avg_unit_price: 0, avg_po_price: 0, lead_times: [] },
};

/** A signed-in session whose server holds this world (the portal's own routes), and a record of what was written to it. */
function boot(
  portal: 'admin' | 'team',
  perms: Record<string, unknown> = ALL,
  init: Partial<World> = {},
) {
  const w: World = {
    suppliers: [ALPHA, YU],
    offers: [vehicle(1), vehicle(2, { brand: 'Aion', model: 'Y' })],
    stock: [
      {
        id: 1,
        units: [
          { supplier: 'Yu Motors', price_list: 32000 },
          { supplier: 'yu motors', price_list: 34000 },
        ],
      },
    ],
    columns: SUPPLIER_CONFIG,
    vehicleColumns: null,
    vehicles: [vehicle(1), vehicle(2, { brand: 'Aion', model: 'Y', trim: '', custom_fields: {} })],
    docs: [],
    purchases: EMPTY_BOUGHT,
    writes: [],
    failWrites: false,
    saveStatus: 200,
    ...init,
  };
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  const asBody = (init: RequestInit): Body | FormData | null => {
    if (init.body instanceof FormData) return init.body;
    return init.body ? (JSON.parse(String(init.body)) as Body) : null;
  };
  const record = (path: string, init: RequestInit) =>
    w.writes.push({ method: String(init.method), path, body: asBody(init) });
  const list =
    (rows: unknown[] | 'forbidden'): Answer =>
    () =>
      rows === 'forbidden' ? json(403, { error: 'Not permitted' }) : json(200, rows);
  const writable =
    (path: string, ok: (init: RequestInit) => unknown): Answer =>
    init => {
      record(path, init);
      return w.failWrites
        ? json(500, { error: 'simulated database failure' })
        : json(200, ok(init));
    };
  const columns =
    (entity: 'suppliers' | 'supplier_vehicles'): Answer =>
    init => {
      if (init.method === 'PUT') {
        record(`${base}/columns/${entity}`, init);
        if (w.failWrites) return json(500, { error: 'no' });
        const body = asBody(init) as { columns: Column[] };
        if (entity === 'suppliers') w.columns = body.columns;
        else w.vehicleColumns = body.columns;
        return json(200, { ok: true, columns: body.columns });
      }
      const saved = entity === 'suppliers' ? w.columns : w.vehicleColumns;
      return saved === 'failing'
        ? json(500, { error: 'no' })
        : json(200, { columns: saved, entity });
    };
  const more: Record<string, Answer> = {
    [`${base}/suppliers`]: init => {
      if (init.method === 'POST') {
        record(`${base}/suppliers`, init);
        if (w.saveStatus !== 200) return json(w.saveStatus, { error: 'Supplier name is required' });
        return json(200, { ...supplier(9), ...(asBody(init) as Body) });
      }
      return json(200, w.suppliers);
    },
    [`${base}/supplier-vehicles`]: list(w.offers),
    [`${base}/stock`]: list(w.stock),
    [`${base}/columns/suppliers`]: columns('suppliers'),
    [`${base}/columns/supplier_vehicles`]: columns('supplier_vehicles'),
  };
  for (const id of [1, 2, 9]) {
    more[`${base}/suppliers/${id}`] = init => {
      record(`${base}/suppliers/${id}`, init);
      if (w.failWrites) return json(500, { error: 'simulated database failure' });
      if (init.method === 'DELETE') return json(200, { ok: true });
      return json(
        w.saveStatus,
        w.saveStatus === 200
          ? { ...supplier(id), ...(asBody(init) as Body) }
          : { error: 'Supplier name is required' },
      );
    };
    more[`${base}/suppliers/${id}/vehicles`] = init =>
      init.method === 'POST'
        ? (record(`${base}/suppliers/${id}/vehicles`, init),
          w.failWrites
            ? json(500, { error: 'no' })
            : json(200, vehicle(50, { brand: 'New', model: '' })))
        : json(200, w.vehicles);
    more[`${base}/suppliers/${id}/docs`] = init =>
      init.method === 'POST'
        ? writable(`${base}/suppliers/${id}/docs`, () => ({}))(init)
        : json(200, w.docs);
    more[`${base}/suppliers/${id}/purchases`] = () => json(200, w.purchases);
    for (const vid of [1, 2, 50]) {
      more[`${base}/suppliers/${id}/vehicles/${vid}`] = writable(
        `${base}/suppliers/${id}/vehicles/${vid}`,
        init => (init.method === 'DELETE' ? { ok: true } : vehicle(vid)),
      );
    }
  }
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe(perms), {
    entries: ['/suppliers'],
    more,
  });
  return { ...s, w, base };
}

const page = () => document.querySelector('[data-part=suppliersPage]') as HTMLElement;
const names = () =>
  [...document.querySelectorAll('[data-part=card] [data-part=name]')].map(e => e.textContent);
const loaded = async () => screen.findByText(/supplier(s)? ·|No suppliers yet|^\d+ suppliers?$/);
const cardOf = (name: string) => screen.getByText(name).closest('[data-part=card]') as HTMLElement;

describe('the Suppliers screen', () => {
  it("is headed as each portal's classic page is: the admin's page title with the line below it, the team's card title with the line under it", async () => {
    const a = boot('admin');
    await loaded();
    expect(document.querySelector('[data-part=pageTitle]')?.textContent).toBe('Suppliers');
    expect(
      document
        .querySelector('[data-part=pageHead]')
        ?.contains(screen.getByRole('button', { name: /Add supplier/ })),
    ).toBe(true);
    expect(document.querySelector('[data-part=pageHint]')?.textContent).toBe(
      'Suppliers you order from. Used by RFQs, purchase orders and stock units.',
    );
    expect(
      document
        .querySelector('[data-part=pageBody]')
        ?.contains(document.querySelector('[data-part=pageHint]')),
    ).toBe(true);
    a.unmount();
    cleanup();
    boot('team');
    await loaded();
    expect(document.querySelector('[data-part=pageTitle]')?.textContent).toBe('Suppliers');
    expect(
      document
        .querySelector('[data-part=pageHead]')
        ?.contains(document.querySelector('[data-part=pageHint]')),
    ).toBe(true);
    expect(document.querySelector('[data-part=pageBody]')).toBeNull();
  });

  it('shows the loader while the register, the figures on its cards and the columns are asked for', async () => {
    const slow = deferred<Response>();
    const s = open('admin', adminMe(), {
      entries: ['/suppliers'],
      more: {
        '/api/dashboard/suppliers': () => slow.promise,
        '/api/dashboard/supplier-vehicles': () => json(200, []),
        '/api/dashboard/stock': () => json(200, []),
        '/api/dashboard/columns/suppliers': () => json(200, { columns: null, entity: 'suppliers' }),
      },
    });
    expect(
      (await screen.findByText(/Loading suppliers…/)).closest('[data-part=loading]'),
    ).toBeTruthy();
    expect(screen.queryByText('No suppliers yet.')).toBeNull();
    slow.resolve(json(200, []));
    await screen.findByText('No suppliers yet.');
    expect(screen.queryByText(/Loading suppliers…/)).toBeNull();
    s.unmount();
  });

  it("draws the register as cards in the order the server gave, with the line above them and each card's figures", async () => {
    boot('admin');
    await loaded();
    expect(names()).toEqual(['Alpha', 'Yu Motors']);
    expect(document.querySelector('[data-part=count]')?.textContent).toBe(
      '2 suppliers · 2 units in the register · 2 catalogue vehicles',
    );
    const yu = [...cardOf('Yu Motors').querySelectorAll('[data-part=figure]')].map(
      e => e.textContent,
    );
    expect(yu).toEqual(['2', 'EGP 66K', '2']);
    expect(
      [...cardOf('Alpha').querySelectorAll('[data-part=figure]')].map(e => e.textContent),
    ).toEqual(['0', '—', '0']);
    expect(cardOf('Yu Motors').querySelector('[data-part=avatar]')?.textContent).toBe('YM');
    expect(cardOf('Yu Motors').querySelector('[data-part=sub]')?.textContent).toBe(
      'China · yu@example.com',
    );
    expect(cardOf('Alpha').querySelector('[data-part=sub]')).toBeNull();
  });

  it('has no figure — not a zero — for what another section would not say, and leaves it out of the line above', async () => {
    boot('admin', ALL, { stock: 'forbidden' });
    await loaded();
    expect(
      [...cardOf('Yu Motors').querySelectorAll('[data-part=figure]')].map(e => e.textContent),
    ).toEqual(['—', '—', '2']);
    expect(document.querySelector('[data-part=count]')?.textContent).toBe(
      '2 suppliers · 2 catalogue vehicles',
    );
  });

  it("keeps the view it was left in, under the classic page's key, and a table shows the columns the administrator arranged", async () => {
    const user = userEvent.setup();
    boot('admin');
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(localStorage.getItem('ml_sup_view')).toBe('table');
    const heads = [...document.querySelectorAll('[data-part=headRow] > th')].map(e =>
      e.textContent?.trim(),
    );
    expect(heads).toEqual([
      'Name',
      'Contact',
      'Country',
      'Notes',
      'Rating',
      'VIP',
      'Website',
      'Actions',
    ]);
    const row = [...document.querySelectorAll('[data-part=row]')].find(r =>
      r.textContent?.includes('Yu Motors'),
    ) as HTMLElement;
    const cells = [...row.querySelectorAll('td')].map(c => c.textContent?.trim());
    expect(cells.slice(0, 7)).toEqual([
      'Yu Motors',
      'yu@example.com',
      'China',
      '',
      'Gold',
      '—',
      '—',
    ]);
    expect(row.querySelector('[data-part=badge]')?.getAttribute('style')).toContain(
      '--ce-c: #dc2626',
    );
    expect(cells[7]).toBe('Open Edit Delete');
    await user.click(screen.getByRole('button', { name: 'Cards' }));
    expect(localStorage.getItem('ml_sup_view')).toBe('cards');
    cleanup();
    localStorage.setItem('ml_sup_view', 'table');
    boot('admin');
    await screen.findByRole('table');
  });

  it('says why the register could not be had — and where to look for a table that was never made — or that nothing reached the server', async () => {
    const s = open('admin', adminMe(), {
      entries: ['/suppliers'],
      more: {
        '/api/dashboard/suppliers': () =>
          json(500, { error: 'relation "suppliers" does not exist' }),
        '/api/dashboard/supplier-vehicles': () => json(200, []),
        '/api/dashboard/stock': () => json(200, []),
        '/api/dashboard/columns/suppliers': () => json(200, { columns: null, entity: 'suppliers' }),
      },
    });
    const error = await screen.findByText(/relation "suppliers" does not exist/);
    expect(error.closest('[data-part=error]')?.textContent).toContain(
      'migrations/003_logistics_deals_docs.sql',
    );
    s.unmount();
    cleanup();
    const down = open('admin', adminMe(), {
      entries: ['/suppliers'],
      more: {
        '/api/dashboard/suppliers': () => {
          throw new TypeError('offline');
        },
        '/api/dashboard/supplier-vehicles': () => json(200, []),
        '/api/dashboard/stock': () => json(200, []),
        '/api/dashboard/columns/suppliers': () => json(200, { columns: null, entity: 'suppliers' }),
      },
    });
    await screen.findByText('Failed to load suppliers.');
    down.unmount();
  });

  it('says there are none yet, and still offers the controls over the columns', async () => {
    boot('admin', ALL, { suppliers: [] });
    expect(await screen.findByText('No suppliers yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Columns' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Field' })).toBeTruthy();
    expect(document.querySelector('[data-part=count]')?.textContent).toBe(
      '0 suppliers · 2 units in the register · 2 catalogue vehicles',
    );
  });

  it("starts from the register's own five columns where nobody arranged any, and when the arrangement cannot be read", async () => {
    const user = userEvent.setup();
    for (const columns of [null, 'failing' as const]) {
      boot('admin', ALL, { columns });
      await loaded();
      await user.click(screen.getByRole('button', { name: 'Table' }));
      expect(
        [...document.querySelectorAll('[data-part=headRow] > th')].map(e => e.textContent?.trim()),
      ).toEqual(['Name', 'Contact', 'Country', 'Address', 'Notes', 'Actions']);
      cleanup();
      localStorage.clear();
    }
  });
});

describe('what each grant is offered', () => {
  it('shows a member who may only view the cards and the catalogue — no Add, no Edit, no Delete, no column controls, no other pages', async () => {
    boot('team', VIEWER, { stock: 'forbidden' });
    await loaded();
    expect(screen.queryByRole('button', { name: /Add supplier/ })).toBeNull();
    expect(document.querySelector('[data-part=cardEdit]')).toBeNull();
    expect(document.querySelector('[data-part=cardDelete]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Columns' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Field' })).toBeNull();
    expect(
      [...cardOf('Yu Motors').querySelectorAll('[data-part=go]')].map(e => e.textContent),
    ).toEqual(['Vehicles']);
    expect(document.querySelector('[data-part=count]')?.textContent).toBe(
      '2 suppliers · 2 catalogue vehicles',
    );
  });

  it("offers a member with every grant Add, Edit, Delete and all three pages — but never the column controls, which are the administrator's", async () => {
    const user = userEvent.setup();
    boot('team', ALL);
    await loaded();
    expect(screen.getByRole('button', { name: /Add supplier/ })).toBeTruthy();
    expect(document.querySelectorAll('[data-part=cardEdit]').length).toBe(2);
    expect(document.querySelectorAll('[data-part=cardDelete]').length).toBe(2);
    expect(
      [...cardOf('Yu Motors').querySelectorAll('[data-part=go]')].map(e => e.textContent),
    ).toEqual(['Vehicles', 'Documents', 'Purchases']);
    expect(screen.queryByRole('button', { name: 'Columns' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(document.querySelector('[data-part=chevron]')).toBeNull();
  });

  it("gives each page its own grant: with the purchases but not the documents, a supplier's sheet has Vehicles and Purchases", async () => {
    const user = userEvent.setup();
    boot('team', SOME);
    await loaded();
    expect(
      [...cardOf('Yu Motors').querySelectorAll('[data-part=go]')].map(e => e.textContent),
    ).toEqual(['Vehicles', 'Purchases']);
    await user.click(within(cardOf('Yu Motors')).getByRole('button', { name: 'Vehicles' }));
    await waitFor(() => expect(document.querySelector('[data-part=tabs]')).toBeTruthy());
    expect(
      [...document.querySelectorAll('[data-part=tabs] [data-part=tab]')].map(t => t.textContent),
    ).toEqual(['Vehicles', 'Purchases']);
  });
});

describe('adding, editing and deleting a supplier', () => {
  const field = (label: string) =>
    screen
      .getAllByText(label, { selector: '[data-part=fieldLabel]' })[0]!
      .closest('[data-part=field]') as HTMLElement;

  it("opens a form made of the register's visible fields, as the types they were given, with a star on what a form requires", async () => {
    const user = userEvent.setup();
    boot('admin');
    await loaded();
    await user.click(screen.getByRole('button', { name: /Add supplier/ }));
    const labels = [...document.querySelectorAll('[data-part=fields] [data-part=fieldLabel]')].map(
      e => e.textContent,
    );
    expect(labels).toEqual(['Name', 'Contact', 'Country', 'Notes', 'Rating *', 'Website']);
    expect(document.querySelectorAll('[data-part=fields] [data-part=fieldSelect]').length).toBe(2);
    expect(document.querySelectorAll('[data-part=fields] [data-part=fieldBox]').length).toBe(1);
    expect(field('Website').querySelector('input')?.getAttribute('type')).toBe('url');
    expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.querySelector('[data-part=dialog] [data-part=title]')?.textContent).toBe(
      'Add supplier',
    );
  });

  it('asks for what is required before the name, and for the name', async () => {
    const user = userEvent.setup();
    const s = boot('admin');
    await loaded();
    await user.click(screen.getByRole('button', { name: /Add supplier/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Required: Rating');
    await user.click(within(field('Rating')).getByRole('button'));
    await user.click(screen.getByRole('option', { name: 'Plain' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Supplier name is required.');
    expect(s.w.writes.length).toBe(0);
  });

  it('saves what was typed, trimmed, with every visible added field in custom_fields — and says what the server said where it refuses', async () => {
    const user = userEvent.setup();
    const s = boot('admin', ALL, { saveStatus: 400 });
    await loaded();
    await user.click(screen.getByRole('button', { name: /Add supplier/ }));
    await user.type(field('Name').querySelector('input')!, '  Gulf Auto  ');
    await user.type(field('Contact').querySelector('input')!, ' sales@gulf.test ');
    await user.click(within(field('Rating')).getByRole('button'));
    await user.click(screen.getByRole('option', { name: 'Gold' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Supplier name is required');
    expect(screen.getByRole('dialog')).toBeTruthy();
    s.w.saveStatus = 200;
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = s.w.writes
      .filter(w => w.method === 'POST' && w.path === '/api/dashboard/suppliers')
      .at(-1);
    expect(post?.body).toEqual({
      name: 'Gulf Auto',
      contact: 'sales@gulf.test',
      country: '',
      address: '',
      notes: '',
      custom_fields: { cf_rating: 'a', cf_vip: false, cf_site: '', cf_secret: undefined },
    } as unknown);
  });

  it('keeps what the form does not show: an edit leaves a column hidden from the register, and a hidden added field, as they were', async () => {
    const user = userEvent.setup();
    const s = boot('admin');
    await loaded();
    await user.click(within(cardOf('Yu Motors')).getByTitle('Edit'));
    expect((field('Name').querySelector('input') as HTMLInputElement).value).toBe('Yu Motors');
    expect(
      (document.querySelector('[data-part=fields] [data-part=fieldBox]') as HTMLInputElement)
        .checked,
    ).toBe(false);
    await user.clear(field('Contact').querySelector('input')!);
    await user.type(field('Contact').querySelector('input')!, 'new@yu.test');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.w.writes.some(w => w.method === 'PUT')).toBe(true));
    const put = s.w.writes.find(w => w.method === 'PUT')!;
    expect(put.path).toBe('/api/dashboard/suppliers/1');
    expect(put.body).toMatchObject({
      name: 'Yu Motors',
      contact: 'new@yu.test',
      country: 'China',
      address: 'Shanghai',
      notes: '',
    });
    expect((put.body as { custom_fields: Body }).custom_fields).toMatchObject({
      cf_rating: 'a',
      cf_secret: 'keep',
    });
  });

  it('shows a dropdown whose stored value is no longer one of its options as empty (and so saves it empty), as the classic form did', async () => {
    const user = userEvent.setup();
    const s = boot('admin', ALL, {
      suppliers: [
        supplier(1, { name: 'Odd', country: 'Atlantis', custom_fields: { cf_rating: 'zzz' } }),
      ],
    });
    await loaded();
    await user.click(within(cardOf('Odd')).getByTitle('Edit'));
    expect(within(field('Country')).getByRole('button').textContent?.trim()).toBe('—');
    await user.click(within(field('Rating')).getByRole('button'));
    await user.click(screen.getByRole('option', { name: 'Plain' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.w.writes.some(w => w.method === 'PUT')).toBe(true));
    expect(s.w.writes.find(w => w.method === 'PUT')?.body).toMatchObject({ country: '' });
  });

  it('sends nothing twice: a save while one is on its way is not asked again', async () => {
    const user = userEvent.setup();
    const slow = deferred<Response>();
    const writes: string[] = [];
    const s = open('admin', adminMe(), {
      entries: ['/suppliers'],
      more: {
        '/api/dashboard/suppliers': init => {
          if (init.method === 'POST') {
            writes.push('post');
            return slow.promise;
          }
          return json(200, []);
        },
        '/api/dashboard/supplier-vehicles': () => json(200, []),
        '/api/dashboard/stock': () => json(200, []),
        '/api/dashboard/columns/suppliers': () => json(200, { columns: null, entity: 'suppliers' }),
      },
    });
    await screen.findByText('No suppliers yet.');
    await user.click(screen.getByRole('button', { name: /Add supplier/ }));
    await user.type(document.querySelector('#sup-name')!, 'Slow Co');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(writes).toEqual(['post']);
    slow.resolve(json(200, supplier(9, { name: 'Slow Co' })));
    s.unmount();
  });

  it('closes the form with Escape, the × and Cancel, and keeps what was typed from a stray click on the curtain', async () => {
    const user = userEvent.setup();
    boot('admin');
    await loaded();
    await user.click(screen.getByRole('button', { name: /Add supplier/ }));
    await user.type(field('Name').querySelector('input')!, 'Kept');
    const curtain = document.querySelector('[data-part=curtain]') as HTMLElement;
    await user.click(curtain);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: /Add supplier/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Add supplier/ }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deletes after asking, by name, and reads the register again; a delete the server refuses is said', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const s = boot('admin');
    await loaded();
    await user.click(within(cardOf('Yu Motors')).getByTitle('Delete'));
    expect(confirm).toHaveBeenCalledWith('Delete supplier Yu Motors?');
    expect(s.w.writes.length).toBe(0);
    confirm.mockReturnValue(true);
    s.w.failWrites = true;
    await user.click(within(cardOf('Yu Motors')).getByTitle('Delete'));
    expect(await screen.findByText('simulated database failure')).toBeTruthy();
    s.w.failWrites = false;
    await user.click(within(cardOf('Yu Motors')).getByTitle('Delete'));
    await waitFor(() => expect(s.w.writes.filter(w => w.method === 'DELETE').length).toBe(2));
    const reads = s
      .calls('/api/dashboard/suppliers')
      .filter(c => !c.init.method || c.init.method === 'GET').length;
    expect(reads).toBeGreaterThanOrEqual(2);
  });
});

describe("a supplier's pages", () => {
  const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string, tab: string) => {
    await user.click(within(cardOf(name)).getByRole('button', { name: tab }));
    await waitFor(() =>
      expect(document.querySelector('[data-part=dialog] [data-part=pane]')).toBeTruthy(),
    );
  };

  it('opens the catalogue as a grid with one input to a cell, by the columns arranged, and saves a cell with the whole row it is in', async () => {
    const user = userEvent.setup();
    const s = boot('admin', ALL, {
      vehicleColumns: [
        col('brand', { builtin: true, label: 'Brand' }),
        col('model', { builtin: true, label: 'Model' }),
        col('trim', { builtin: true, label: 'Trim', visible: false }),
        col('lead_time', { builtin: true, label: 'Lead time' }),
        col('cf_stock', { label: 'In stock' }),
      ],
    });
    await loaded();
    await openTab(user, 'Yu Motors', 'Vehicles');
    await screen.findByDisplayValue('Aion');
    expect(
      [...document.querySelectorAll('[data-part=gridTable] thead th')].map(e =>
        e.textContent?.trim(),
      ),
    ).toEqual([
      'Brand',
      'Model',
      'Lead time',
      'In stock',
      'Year',
      'Availability',
      'FOB price',
      'Accessories',
      '',
    ]);
    const rows = document.querySelectorAll('[data-part=vehicleRow]');
    expect(rows.length).toBe(2);
    const lead = rows[0]!.querySelectorAll('input')[2] as HTMLInputElement;
    expect(lead.value).toBe('4 weeks');
    await user.clear(lead);
    await user.type(lead, '3 weeks');
    await user.tab();
    await waitFor(() =>
      expect(s.w.writes.some(w => w.method === 'PUT' && /vehicles\/1$/.test(w.path))).toBe(true),
    );
    const body = s.w.writes.find(w => w.method === 'PUT' && /vehicles\/1$/.test(w.path))!
      .body as Body;
    expect(body).toMatchObject({
      brand: 'BYD',
      model: 'Seal',
      trim: 'Max',
      lead_time: '3 weeks',
      currency: 'EUR',
      notes: 'keep',
      model_year: 2026,
      fob_price: 32789,
    });
    expect(body['custom_fields']).toEqual({ cf_stock: '12', cf_secret: 'keep too' });
    // …and the next cell of the same row saves with the first one's change in it
    const stock = rows[0]!.querySelectorAll('input')[3] as HTMLInputElement;
    await user.clear(stock);
    await user.type(stock, '40');
    await user.tab();
    await waitFor(() =>
      expect(s.w.writes.filter(w => w.method === 'PUT' && /vehicles\/1$/.test(w.path)).length).toBe(
        2,
      ),
    );
    const second = s.w.writes.filter(w => w.method === 'PUT' && /vehicles\/1$/.test(w.path))[1]!
      .body as Body;
    expect(second['lead_time']).toBe('3 weeks');
    expect((second['custom_fields'] as Body)['cf_stock']).toBe('40');
  });

  it('says so when a cell could not be saved, when a row could not be added and when one could not be removed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const s = boot('admin');
    await loaded();
    await openTab(user, 'Yu Motors', 'Vehicles');
    await screen.findByDisplayValue('Aion');
    s.w.failWrites = true;
    const first = document.querySelector('[data-part=vehicleRow] input') as HTMLInputElement;
    await user.clear(first);
    await user.type(first, 'X');
    await user.tab();
    expect(await screen.findByText('Could not save that change.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Add vehicle/ }));
    expect(await screen.findByText('Could not add that row.')).toBeTruthy();
    await user.click(document.querySelector('[data-part=vehicleDelete]') as HTMLElement);
    expect(await screen.findByText('Could not remove that vehicle.')).toBeTruthy();
  });

  it('adds a vehicle and removes one after asking; a member without the catalogue grant sees plain text and nothing to press', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const s = boot('admin');
    await loaded();
    await openTab(user, 'Yu Motors', 'Vehicles');
    await screen.findByDisplayValue('Aion');
    await user.click(screen.getByRole('button', { name: /Add vehicle/ }));
    await waitFor(() =>
      expect(s.w.writes.some(w => w.method === 'POST' && /vehicles$/.test(w.path))).toBe(true),
    );
    expect(s.w.writes.find(w => w.method === 'POST' && /vehicles$/.test(w.path))?.body).toEqual({
      brand: 'New',
      model: '',
    });
    await user.click(document.querySelector('[data-part=vehicleDelete]') as HTMLElement);
    await waitFor(() =>
      expect(s.w.writes.some(w => w.method === 'DELETE' && /vehicles\/\d+$/.test(w.path))).toBe(
        true,
      ),
    );
    cleanup();
    boot('team', VIEWER);
    await loaded();
    await user.click(within(cardOf('Yu Motors')).getByRole('button', { name: 'Vehicles' }));
    await screen.findByText('Aion');
    expect(document.querySelectorAll('[data-part=gridTable] input').length).toBe(0);
    expect(screen.queryByRole('button', { name: /Add vehicle/ })).toBeNull();
    expect(document.querySelector('[data-part=vehicleDelete]')).toBeNull();
  });

  it('says what a supplier has not got yet', async () => {
    const user = userEvent.setup();
    boot('admin', ALL, { vehicles: [] });
    await loaded();
    await openTab(user, 'Alpha', 'Vehicles');
    expect(
      await screen.findByText(/Nothing listed yet\. Add what this supplier offers/),
    ).toBeTruthy();
  });

  it('lists the paperwork, uploads a file (and says what the server said where it would not take it), and says there is none yet', async () => {
    const user = userEvent.setup();
    const s = boot('admin', ALL, {
      docs: [
        {
          id: 1,
          supplier_id: 1,
          name: 'price-list.pdf',
          drive_file_id: 'f',
          web_link: 'https://drive.example/f',
          mime_type: 'application/pdf',
          size_bytes: 204800,
        },
      ],
    });
    await loaded();
    await openTab(user, 'Yu Motors', 'Documents');
    const link = await screen.findByText('price-list.pdf');
    expect(link.closest('a')?.getAttribute('href')).toBe('https://drive.example/f');
    expect(link.closest('a')?.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('200 KB')).toBeTruthy();
    expect(screen.getByText('Stored in Google Drive, under MotoLinker / Suppliers.')).toBeTruthy();
    const file = new File(['abc'], 'new.pdf', { type: 'application/pdf' });
    await user.upload(document.querySelector('[data-part=fileInput]') as HTMLInputElement, file);
    await waitFor(() => expect(s.w.writes.some(w => /docs$/.test(w.path))).toBe(true));
    const form = s.w.writes.find(w => /docs$/.test(w.path))!.body as FormData;
    expect((form.get('file') as File).name).toBe('new.pdf');
    s.w.failWrites = true;
    await user.upload(document.querySelector('[data-part=fileInput]') as HTMLInputElement, file);
    expect(await screen.findByText('simulated database failure')).toBeTruthy();
    cleanup();
    boot('admin', ALL, { docs: [] });
    await loaded();
    await openTab(user, 'Yu Motors', 'Documents');
    expect(await screen.findByText('No documents yet.')).toBeTruthy();
  });

  it('shows what was bought: four figures, the lead times seen, the cars received and the lines ordered — or that there are none', async () => {
    const user = userEvent.setup();
    boot('admin', ALL, {
      purchases: {
        units: [
          {
            stock_id: 1,
            make: 'BYD',
            model: 'Seal',
            trim: 'Max',
            vin: 'V1',
            colour: 'White',
            status: 'delivered',
            price: 30000,
          },
        ],
        poLines: [
          {
            po_id: 2,
            po_number: 'PO-2',
            po_date: '2026-04-01',
            currency: 'USD',
            brand: 'BYD',
            model: 'Seal',
            trim: '',
            qty: 2,
            price: 31000,
            lead_time: '6 weeks',
          },
        ],
        totals: {
          vehicles: 1,
          ordered: 2,
          avg_unit_price: 30000,
          avg_po_price: 31000,
          lead_times: ['6 weeks', '4 weeks'],
        },
      },
    });
    await loaded();
    await openTab(user, 'Yu Motors', 'Purchases');
    await screen.findByText('Cars received (1)');
    const tiles = [...document.querySelectorAll('[data-part=tile]')].map(e => e.textContent);
    expect(tiles).toEqual([
      'Cars received1',
      'Ordered on POs2',
      'Avg price paid' + (30000).toLocaleString(),
      'Avg PO price' + (31000).toLocaleString(),
    ]);
    expect(screen.getByText('Quoted lead times seen: 6 weeks · 4 weeks')).toBeTruthy();
    expect(
      within(document.querySelector('[data-part=unitsBox]') as HTMLElement).getByText(
        'BYD Seal Max',
      ),
    ).toBeTruthy();
    expect(
      within(document.querySelector('[data-part=linesBox]') as HTMLElement).getByText('PO-2'),
    ).toBeTruthy();
    expect(screen.getByText('Purchase-order lines (1)')).toBeTruthy();
    cleanup();
    boot('admin', ALL);
    await loaded();
    await openTab(user, 'Yu Motors', 'Purchases');
    expect(await screen.findByText(/None attributed to this supplier yet/)).toBeTruthy();
    expect(screen.getByText('No purchase orders yet.')).toBeTruthy();
    expect(screen.queryByText(/Quoted lead times seen/)).toBeNull();
  });

  it('closes with Escape and the Close button, and names the sheet for the supplier', async () => {
    const user = userEvent.setup();
    boot('admin');
    await loaded();
    await openTab(user, 'Yu Motors', 'Vehicles');
    expect(document.querySelector('[data-part=dialog] [data-part=title]')?.textContent).toBe(
      'Yu Motors',
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[data-part=dialog]')).toBeNull());
    await openTab(user, 'Yu Motors', 'Vehicles');
    fireEvent.click(
      within(document.querySelector('[data-part=dialog]') as HTMLElement)
        .getAllByRole('button', { name: 'Close' })
        .at(-1)!,
    );
    await waitFor(() => expect(document.querySelector('[data-part=dialog]')).toBeNull());
  });
});

void page;
