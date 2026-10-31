import { cleanup, screen, waitFor, within } from '@testing-library/react';
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

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  po_number: `MT26P0${id}Y26`,
  title: 'x',
  supplier: null,
  po_date: null,
  currency: 'USD',
  status: 'draft',
  customer_id: null,
  items: [],
  created_by: 'admin',
  created_at: '2026-09-01T10:00:00Z',
  ...over,
});
const full = (id: number, over: Record<string, unknown> = {}) => ({
  ...row(id),
  supplier_id: null,
  supplier_contact: null,
  supplier_address: null,
  supplier_country: null,
  issuer: null,
  quote_id: null,
  payment_terms: null,
  incoterm: null,
  delivery_location: null,
  service_provider: null,
  contact: null,
  documents_required: null,
  notes: null,
  custom_fields: {},
  ...over,
});
const YU = {
  id: 1,
  name: 'Yu Motors',
  contact: 'yu@example.com',
  address: 'Shanghai',
  country: 'China',
  notes: '',
  custom_fields: {},
};
const GULF = { ...YU, id: 2, name: 'Gulf Auto', contact: '', address: '', country: 'UAE' };
const OFFER = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  supplier_id: 1,
  brand: 'BYD',
  model: 'Seal',
  trim: 'Max',
  model_year: 2026,
  availability: '',
  fob_price: 32789,
  currency: 'USD',
  lead_time: '4 weeks',
  accessories: 'mats',
  notes: '',
  custom_fields: {},
  supplier_name: 'Yu Motors',
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
const DOC_COLUMNS: Column[] = [
  col('status', {
    label: 'Status',
    type: 'select',
    builtin: true,
    options: [
      { key: 'draft', label: 'Draft', color: '#b9b3a4' },
      { key: 'sent', label: 'Sent Out', color: '#e69650' },
      { key: 'confirmed', label: 'Confirmed', color: '#10b981' },
    ],
  }),
  col('cf_ref', { label: 'Reference', required: true }),
  col('cf_urgent', { label: 'Urgent', type: 'checkbox' }),
  col('cf_secret', { label: 'Internal', visible: false }),
];

const ALL = {
  purchaseorders: true,
  purchaseordersActions: { view: true, create: true, edit: true, delete: true, export: true },
};
const VIEWER = {
  purchaseorders: true,
  purchaseordersActions: { view: true, create: false, edit: false, delete: false, export: false },
};

type Body = Record<string, unknown>;
interface World {
  orders: unknown[] | 'forbidden' | 'failing' | 'odd';
  one: Record<number, unknown>;
  defaults: unknown;
  docColumns: Column[] | null;
  itemColumns: Column[] | null;
  suppliers: unknown[];
  leads: unknown[] | 'forbidden';
  offers: unknown[];
  writes: { method: string; path: string; body: Body | null }[];
  saveError: string | null;
  deleteError: string | null;
  pdf: 'ok' | 'failing' | 'odd';
  /** the list is answered when this is settled (at once where there is none) */
  listGate: Promise<void> | null;
  /** …and the PDF, likewise */
  pdfGate: Promise<void> | null;
}

const DEFAULTS = {
  po_number: 'MT26P040Y26',
  po_date: '2026-10-31',
  currency: 'USD',
  items: [{ units: 1, payment_term: '30/70' }, {}, {}],
  customer_id: null,
};

/** A signed-in session whose server holds this world (the portal's own routes), and a record of what was written to it. */
function boot(
  portal: 'admin' | 'team',
  perms: Record<string, unknown> = ALL,
  init: Partial<World> = {},
  entries = ['/purchaseorders'],
  extra: Record<string, Answer> = {},
) {
  const w: World = {
    orders: [
      row(1, {
        supplier: 'Yu Motors',
        po_date: '2026-09-02',
        status: 'sent',
        items: [
          { client: 'ACME', brand: 'BYD', units: 2, pi_price: 15000 },
          { brand: 'Aion', pi_price: 9000 },
        ],
      }),
      row(2, {
        status: 'confirmed',
        currency: 'EUR',
        items: [{ brand: 'Geely', pi_price: 1000.5 }],
      }),
      row(3, { supplier: 'Gulf Auto', po_date: '2026-09-04', status: 'archived', currency: '' }),
    ],
    one: {
      1: full(1, {
        supplier_id: 1,
        supplier: 'Yu Motors',
        supplier_contact: 'yu@example.com',
        supplier_address: 'Shanghai',
        supplier_country: 'China',
        issuer: 'Admin',
        quote_id: 'RFQ-9',
        po_date: '2026-09-02',
        status: 'sent',
        payment_terms: '30% deposit',
        incoterm: 'CIF',
        delivery_location: 'Alexandria',
        service_provider: 'Maersk',
        contact: 'ops@example.com',
        documents_required: 'B/L',
        notes: 'Handle with care',
        custom_fields: { cf_ref: 'R-1', cf_urgent: true, cf_secret: 'keep' },
        items: [
          {
            client: 'ACME',
            consignee: 'Ali',
            units: 2,
            brand: 'BYD',
            model: 'Seal',
            trim: 'Max',
            color: 'White',
            year: 2026,
            accessories: 'mats',
            payment_term: '30/70',
            pi_price: 15000,
            status: 'in_logistics',
            vin: 'VIN1',
            file_link: 'https://example.com/f',
            cf_hidden: 'keep this',
          },
          { brand: 'Aion', pi_price: 9000 },
        ],
      }),
      2: full(2, {
        status: 'confirmed',
        currency: 'EUR',
        items: [{ brand: 'Geely', pi_price: 1000.5 }],
        custom_fields: { cf_ref: 'R-2' },
      }),
    },
    defaults: DEFAULTS,
    docColumns: DOC_COLUMNS,
    itemColumns: null,
    suppliers: [YU, GULF],
    leads: [
      { id: 7, name: 'Zed', phone: '+2' },
      { id: 5, name: 'Ali', phone: null },
    ],
    offers: [
      OFFER(1),
      OFFER(2, {
        brand: 'Aion',
        model: 'Y',
        trim: '',
        model_year: null,
        fob_price: null,
        lead_time: '',
      }),
    ],
    writes: [],
    saveError: null,
    deleteError: null,
    pdf: 'ok',
    listGate: null,
    pdfGate: null,
    ...init,
  };
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  const asBody = (init: RequestInit): Body | null =>
    init.body ? (JSON.parse(String(init.body)) as Body) : null;
  const record = (path: string, init: RequestInit) =>
    w.writes.push({ method: String(init.method), path, body: asBody(init) });
  const columns =
    (entity: 'po_doc' | 'po_items'): Answer =>
    init => {
      if (init.method === 'PUT') {
        record(`${base}/columns/${entity}`, init);
        const body = asBody(init) as { columns: Column[] };
        if (entity === 'po_doc') w.docColumns = body.columns;
        else w.itemColumns = body.columns;
        return json(200, { ok: true, columns: body.columns });
      }
      return json(200, { columns: entity === 'po_doc' ? w.docColumns : w.itemColumns, entity });
    };
  const more: Record<string, Answer> = {
    [`${base}/purchase-orders`]: init => {
      if (init.method === 'POST') {
        record(`${base}/purchase-orders`, init);
        if (w.saveError) return json(400, { error: w.saveError });
        return json(200, full(9, asBody(init) ?? {}));
      }
      const answer = () => {
        if (w.orders === 'forbidden') return json(403, { error: 'Not permitted' });
        if (w.orders === 'failing')
          return json(500, { error: 'relation "purchase_orders" does not exist' });
        if (w.orders === 'odd') return json(200, [{ id: 'x' }]);
        return json(200, w.orders);
      };
      return w.listGate ? w.listGate.then(answer) : answer();
    },
    [`${base}/purchase-orders/new/defaults`]: () => json(200, w.defaults),
    [`${base}/purchase-orders/new/defaults?customer_id=7`]: () =>
      json(200, { ...DEFAULTS, customer_id: 7, items: [{ client: 'From the lead' }] }),
    [`${base}/purchase-orders/pdf`]: init => {
      record(`${base}/purchase-orders/pdf`, init);
      const answer = () => {
        if (w.pdf === 'failing') return json(500, { error: 'Failed to render the document' });
        if (w.pdf === 'odd') return json(200, { nothing: true });
        return json(200, { pdf: btoa('%PDF-1.4'), name: 'PO MT26P01Y26' });
      };
      return w.pdfGate ? w.pdfGate.then(answer) : answer();
    },
    [`${base}/columns/po_doc`]: columns('po_doc'),
    [`${base}/columns/po_items`]: columns('po_items'),
    [`${base}/suppliers`]: () => json(200, w.suppliers),
    [`${base}/supplier-vehicles`]: () => json(200, w.offers),
    [`${base}/${portal === 'admin' ? 'customers' : 'leads'}`]: () =>
      w.leads === 'forbidden' ? json(403, { error: 'Not permitted' }) : json(200, w.leads),
    ...extra,
  };
  for (const id of [1, 2, 3, 9]) {
    more[`${base}/purchase-orders/${id}`] = init => {
      record(`${base}/purchase-orders/${id}`, init);
      if (init.method === 'DELETE')
        return w.deleteError ? json(403, { error: w.deleteError }) : json(200, { ok: true });
      if (init.method === 'PUT')
        return w.saveError
          ? json(400, { error: w.saveError })
          : json(200, full(id, asBody(init) ?? {}));
      return w.one[id] ? json(200, w.one[id]) : json(404, { error: 'Purchase order not found' });
    };
  }
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe(perms), { entries, more });
  return { ...s, w, base };
}

const page = () => document.querySelector('[data-part=docPage]') as HTMLElement;
const rows = () =>
  [...document.querySelectorAll('[data-part=list] [data-part=row]')] as HTMLElement[];
const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const cells = (r: HTMLElement) => [...r.children].map(words);
const loaded = async () =>
  waitFor(() =>
    expect(
      rows().length > 0 ||
        /No purchase orders yet|Failed to load|came back in a form|relation/.test(
          page()?.textContent ?? '',
        ),
    ).toBe(true),
  );
const dialog = () => document.querySelector('[data-part=dialog]') as HTMLElement;
const lineRows = () => document.querySelectorAll('[data-part=dialog] tbody tr');
const formReady = async () => {
  await waitFor(() => expect(document.getElementById('po-number')).not.toBeNull());
  await waitFor(() => expect(lineRows().length).toBeGreaterThan(0));
};
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const type = async (id: string, text: string) => {
  const el = field(id);
  await userEvent.clear(el);
  if (text) await userEvent.type(el, text);
};
/** The 1-based place of a line column in the grid (the number is the first), by the name its header carries. */
const at = (name: string) =>
  [...document.querySelectorAll('[data-part=dialog] thead th')].findIndex(
    h => h.textContent === name,
  ) + 1;
const COL = {
  client: 2,
  consignee: 3,
  units: 4,
  brand: 5,
  model: 6,
  trim: 7,
  color: 8,
  year: 9,
  accessories: 10,
  paymentTerm: 11,
  price: 12,
  status: 13,
  vin: 14,
  link: 15,
} as const;
const lineCell = (r: number, c: number) =>
  document.querySelector(
    `[data-part=dialog] tbody tr:nth-child(${r}) td:nth-child(${c})`,
  ) as HTMLElement;
const lineInput = (r: number, c: number) =>
  lineCell(r, c).querySelector('input, textarea') as HTMLInputElement;
const typeLine = async (r: number, c: number, text: string) => {
  const el = lineInput(r, c);
  await userEvent.clear(el);
  if (text) await userEvent.type(el, text);
};
const pickLine = async (r: number, c: number, name: string | RegExp) => {
  await userEvent.click(lineCell(r, c).querySelector('button')!);
  await userEvent.click(screen.getByRole('option', { name }));
};
const pickOption = async (id: string, name: string | RegExp) => {
  await userEvent.click(document.getElementById(id)!);
  await userEvent.click(screen.getByRole('option', { name }));
};
const lastWrite = (w: World, method: string, path: string) =>
  [...w.writes].reverse().find(x => x.method === method && x.path === path);
const total = () => document.querySelector('[data-part=linesTotal]')?.textContent;
const card = () => document.querySelector('[data-part=docCard]') as HTMLElement | null;
const stubBlobs = () => {
  const create = vi.fn(() => 'blob:pdf-1');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  return { create, revoke };
};

describe('the purchase-order screen', () => {
  it("is headed as each portal's classic page is, and names what it is for", async () => {
    const a = boot('admin');
    await loaded();
    expect(document.querySelector('[data-part=pageTitle]')?.textContent).toBe('Purchase Orders');
    expect(
      document
        .querySelector('[data-part=pageHead]')
        ?.contains(screen.getByRole('button', { name: /New purchase order/ })),
    ).toBe(true);
    expect(document.querySelector('[data-part=pageHint]')?.textContent).toBe(
      'Order sheet sent to suppliers. Each PO holds one or more vehicle lines with their own client, spec, PI price and tracking status.',
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
    expect(document.querySelector('[data-part=pageTitle]')?.textContent).toBe('Purchase Orders');
    expect(
      document
        .querySelector('[data-part=pageHead]')
        ?.contains(document.querySelector('[data-part=pageHint]')),
    ).toBe(true);
    expect(document.querySelector('[data-part=pageBody]')).toBeNull();
  });

  it('shows the loader while the list and the status options are asked for', async () => {
    const gate = deferred<void>();
    const s = boot('admin', ALL, { listGate: gate.promise });
    expect(
      (await screen.findByText(/Loading purchase orders…/)).closest('[data-part=loading]'),
    ).toBeTruthy();
    expect(screen.queryByText('No purchase orders yet.')).toBeNull();
    gate.resolve();
    await screen.findByText('MT26P01Y26');
    expect(screen.queryByText(/Loading purchase orders…/)).toBeNull();
    s.unmount();
  });

  it('lists each order: its number, supplier, how many lines, what they come to, status, date and what may be done with it', async () => {
    boot('admin');
    await loaded();
    expect(rows().map(cells)).toEqual([
      ['MT26P01Y26', 'Yu Motors', '2', 'USD 39,000', 'Sent Out', '2026-09-02', 'Edit PDF Delete'],
      [
        'MT26P02Y26',
        '—',
        '1',
        'EUR 1,000.5',
        'Confirmed',
        new Date('2026-09-01T10:00:00Z').toLocaleDateString(),
        'Edit PDF Delete',
      ],
      ['MT26P03Y26', 'Gulf Auto', '0', 'USD 0', 'archived', '2026-09-04', 'Edit PDF Delete'],
    ]);
    // the status is a badge in the colour the administrator gave its option (an option that has gone is drawn plain)
    const sent = rows()[0]!.querySelector('[data-part=badge]') as HTMLElement;
    expect(sent.style.getPropertyValue('--ce-c')).toBe('#e69650');
    const gone = rows()[2]!.querySelector('[data-part=badge]') as HTMLElement;
    expect(gone.textContent).toBe('archived');
    expect(gone.style.getPropertyValue('--ce-c')).toBe('');
    // the number is the one thing in a row that is set in a fixed-width face
    expect(rows()[0]!.children[0]!.className).toContain('num');
    // every cell says what it is on a phone, where the rows are cards
    expect([...rows()[0]!.children].map(c => c.getAttribute('data-label'))).toEqual([
      'PO #',
      'Supplier',
      'Lines',
      'Total',
      'Status',
      'Date',
      'Actions',
    ]);
  });

  it('offers a person only what they may do', async () => {
    boot('team', VIEWER);
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[6]),
    ).toEqual(['', '', '']);
    expect(screen.queryByRole('button', { name: /New purchase order/ })).toBeNull();
    cleanup();
    boot('team', {
      purchaseorders: true,
      purchaseordersActions: { view: true, create: false, edit: true, delete: false, export: true },
    });
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[6]),
    ).toEqual(['Edit PDF', 'Edit PDF', 'Edit PDF']);
    expect(screen.queryByRole('button', { name: /New purchase order/ })).toBeNull();
    cleanup();
    boot('team', {
      purchaseorders: true,
      purchaseordersActions: { view: true, create: true, edit: false, delete: true, export: false },
    });
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[6]),
    ).toEqual(['Delete', 'Delete', 'Delete']);
    expect(screen.getByRole('button', { name: /New purchase order/ })).toBeTruthy();
  });

  it("asks the portal's own routes: a team member's orders are the team's, not the administrator's", async () => {
    const s = boot('team');
    await loaded();
    const paths = s.asked.map(a => a.path);
    expect(paths).toContain('/api/employee/purchase-orders');
    expect(paths.some(p => p.startsWith('/api/dashboard/'))).toBe(false);
  });

  it('says there are none yet, and keeps the way to make one', async () => {
    boot('admin', ALL, { orders: [] });
    expect(await screen.findByText(/No purchase orders yet\./)).toBeTruthy();
    expect(screen.getByText(/Click “New purchase order” to create one\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: /New purchase order/ })).toBeTruthy();
  });

  it('says what the server said when it could not give them, with where to look if the table is missing', async () => {
    boot('admin', ALL, { orders: 'failing' });
    expect(await screen.findByText(/relation "purchase_orders" does not exist/)).toBeTruthy();
    expect(page().textContent).toContain('migrations/002_purchase_orders.sql');
  });

  it("says so in the page's own words when the server cannot be reached", async () => {
    const s = open('admin', adminMe(), {
      entries: ['/purchaseorders'],
      more: {
        '/api/dashboard/purchase-orders': () => {
          throw new TypeError('Failed to fetch');
        },
        '/api/dashboard/columns/po_doc': () => json(200, { columns: null, entity: 'po_doc' }),
      },
    });
    expect(await screen.findByText('Failed to load purchase orders.')).toBeTruthy();
    s.unmount();
  });

  it('says so, and shows nothing, when the list is not a list of purchase orders', async () => {
    boot('admin', ALL, { orders: 'odd' });
    expect(
      await screen.findByText(/The purchase orders came back in a form this app does not know\./),
    ).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  describe('deleting', () => {
    it('asks first, by number, and does nothing if the answer is no', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const s = boot('admin');
      await loaded();
      await userEvent.click(within(rows()[1]!).getByRole('button', { name: 'Delete' }));
      expect(confirm).toHaveBeenCalledWith('Delete purchase order MT26P02Y26?');
      expect(s.w.writes).toEqual([]);
      expect(rows()).toHaveLength(3);
    });
    it('removes it and asks for the list again', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const s = boot('admin');
      await loaded();
      s.w.orders = [row(1, { supplier: 'Yu Motors' })];
      await userEvent.click(within(rows()[1]!).getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'DELETE', '/api/dashboard/purchase-orders/2')).toBeTruthy(),
      );
      await waitFor(() => expect(rows()).toHaveLength(1));
    });
    it('says why in a notice when it is refused, and the list stays as the server has it', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const s = boot('admin', ALL, { deleteError: 'Not permitted' });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Delete' }));
      expect(await screen.findByText('Not permitted')).toBeTruthy();
      expect(rows()).toHaveLength(3);
      s.unmount();
    });
  });

  describe('the PDF of a saved order', () => {
    it('opens the viewer at once, with a note that it is being made, and fills it with the PDF when it is', async () => {
      const blobs = stubBlobs();
      const gate = deferred<void>();
      const s = boot('admin', ALL, { pdfGate: gate.promise });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(card()).not.toBeNull();
      expect(document.querySelector('[data-part=docTitleText]')?.textContent).toBe(
        'Purchase order',
      );
      expect(await screen.findByText(/Rendering PDF…/)).toBeTruthy();
      expect(document.querySelector('[data-part=docFrame]')).toBeNull();
      gate.resolve();
      await waitFor(() => expect(document.querySelector('[data-part=docFrame]')).not.toBeNull());
      expect(document.querySelector('[data-part=docTitleText]')?.textContent).toBe(
        'Purchase order MT26P01Y26',
      );
      expect(document.querySelector('[data-part=docFrame]')?.getAttribute('src')).toBe(
        'blob:pdf-1',
      );
      expect(screen.queryByText(/Rendering PDF…/)).toBeNull();
      // the PDF is made from the record as the server holds it
      const asked = lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders/pdf')!.body!;
      expect(asked).toMatchObject({ id: 1, po_number: 'MT26P01Y26', supplier: 'Yu Motors' });
      expect((blobs.create.mock.calls[0] as unknown as [Blob])[0].type).toBe('application/pdf');
    });
    it('can be downloaded, under the name the server gave it', async () => {
      stubBlobs();
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      boot('admin');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(document.querySelector('[data-part=docFrame]')).not.toBeNull());
      await userEvent.click(within(card()!).getByRole('button', { name: /Download/ }));
      expect(click).toHaveBeenCalledTimes(1);
      const a = click.mock.contexts[0] as HTMLAnchorElement;
      expect(a.download).toBe('PO_MT26P01Y26.pdf');
      expect(a.getAttribute('href')).toBe('blob:pdf-1');
    });
    it('is closed by its button and by Escape, and the PDF is given back each time', async () => {
      const blobs = stubBlobs();
      boot('admin');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(document.querySelector('[data-part=docFrame]')).not.toBeNull());
      await userEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
      expect(card()).toBeNull();
      expect(blobs.revoke).toHaveBeenCalledWith('blob:pdf-1');
      blobs.revoke.mockClear();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(document.querySelector('[data-part=docFrame]')).not.toBeNull());
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(card()).toBeNull());
      expect(blobs.revoke).toHaveBeenCalledWith('blob:pdf-1');
    });
    it('says why in the viewer when it could not be made — it is not a silent nothing', async () => {
      stubBlobs();
      boot('admin', ALL, { pdf: 'failing' });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(
        (
          await screen.findByText(/Could not render this document: Failed to render the document/)
        ).closest('[data-part=docError]'),
      ).toBeTruthy();
      expect(document.querySelector('[data-part=docTitleText]')?.textContent).toBe(
        'Purchase order MT26P01Y26',
      );
      expect(document.querySelector('[data-part=docFrame]')).toBeNull();
      expect(screen.queryByText(/Rendering PDF…/)).toBeNull();
    });
    it('says so when what came back is not a PDF', async () => {
      stubBlobs();
      boot('admin', ALL, { pdf: 'odd' });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(
        await screen.findByText(
          /Could not render this document: The document came back in a form this app does not know\./,
        ),
      ).toBeTruthy();
    });
    it('says so when the order itself cannot be had, and asks the PDF of nothing', async () => {
      stubBlobs();
      const s = boot('admin', ALL, { one: {} });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(
        await screen.findByText(/Could not render this document: Purchase order not found/),
      ).toBeTruthy();
      expect(document.querySelector('[data-part=docTitleText]')?.textContent).toBe(
        'Purchase order',
      );
      expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders/pdf')).toBeUndefined();
    });
    it('gives back the PDF it had when another is opened', async () => {
      const blobs = stubBlobs();
      boot('admin');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(document.querySelector('[data-part=docFrame]')).not.toBeNull());
      await userEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
      blobs.revoke.mockClear();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(document.querySelector('[data-part=docFrame]')).not.toBeNull());
      expect(blobs.revoke).not.toHaveBeenCalled();
    });
  });

  describe('a new purchase order', () => {
    const openNew = async () => {
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
      await formReady();
    };
    it('opens at once, asks the server for its starting form, and is that form: its number, date, currency and incoterm, and the lines it brought', async () => {
      const gate = deferred<void>();
      const s = boot('admin', ALL, {}, ['/purchaseorders'], {
        '/api/dashboard/purchase-orders/new/defaults': () =>
          gate.promise.then(() => json(200, DEFAULTS)),
      });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
      // (the sheet is there before the answer: with a loader in it)
      expect(dialog()).not.toBeNull();
      expect(within(dialog()).getByText(/Loading…/)).toBeTruthy();
      gate.resolve();
      await formReady();
      expect(dialog().querySelector('[data-part=title]')?.textContent).toBe('New purchase order');
      expect(field('po-number').value).toBe('MT26P040Y26');
      expect(field('po-number').readOnly).toBe(false);
      expect(field('po-date').value).toBe('2026-10-31');
      expect(field('po-currency').value).toBe('USD');
      expect(field('po-incoterm').value).toBe('FOB');
      expect(lineRows()).toHaveLength(3);
      expect(lineInput(1, COL.units).value).toBe('1');
      expect(lineInput(1, COL.paymentTerm).value).toBe('30/70');
      expect(s.asked.map(a => a.path)).toContain('/api/dashboard/purchase-orders/new/defaults');
    });
    it('is made for a lead when it is opened from one (?lead=), and the address is cleaned', async () => {
      const s = boot('admin', ALL, {}, ['/purchaseorders?lead=7']);
      await formReady();
      expect(lineInput(1, COL.client).value).toBe('From the lead');
      expect(s.asked.map(a => a.path)).toContain(
        '/api/dashboard/purchase-orders/new/defaults?customer_id=7',
      );
      await waitFor(() => expect(window.location.search).toBe(''));
      // …and it is attached to that lead
      await type('po-supplier', 'Yu Motors');
      await userEvent.type(lineInput(1, COL.brand), 'BYD');
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')).toBeTruthy(),
      );
      expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')!.body!['customer_id']).toBe(
        '7',
      );
    });
    it("is not opened by a lead's link for a person who may not make one", async () => {
      boot('team', VIEWER, {}, ['/purchaseorders?lead=7']);
      await loaded();
      expect(dialog()).toBeNull();
      await waitFor(() => expect(window.location.search).toBe(''));
    });
    it('ignores a lead that is not a number', async () => {
      boot('admin', ALL, {}, ['/purchaseorders?lead=abc']);
      await loaded();
      expect(dialog()).toBeNull();
      await waitFor(() => expect(window.location.search).toBe(''));
    });
    it('offers the status options the administrator has left, starting as the first', async () => {
      boot('admin');
      await openNew();
      expect(within(dialog()).getByRole('button', { name: /Draft/ })).toBeTruthy();
      await userEvent.click(document.getElementById('po-status')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        'Draft',
        'Sent Out',
        'Confirmed',
      ]);
    });
    it("refuses a form with no vehicle named, in the classic page's words, and sends nothing", async () => {
      const s = boot('admin');
      await openNew();
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Add at least one vehicle line (client, brand or model).',
      );
      expect(s.w.writes).toEqual([]);
    });
    it('counts a client, a brand, a model or a VIN as naming a vehicle — and nothing else', async () => {
      const s = boot('admin');
      await openNew();
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R');
      await userEvent.type(lineInput(1, COL.consignee), 'Someone');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect((await screen.findByRole('alert')).textContent).toContain(
        'Add at least one vehicle line',
      );
      await userEvent.type(lineInput(1, COL.vin), 'VIN9');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')).toBeTruthy(),
      );
    });
    it('refuses a form whose required added fields are empty, naming them', async () => {
      const s = boot('admin');
      await openNew();
      await userEvent.type(lineInput(1, COL.brand), 'BYD');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Required: Reference');
      expect(s.w.writes).toEqual([]);
    });
    it('saves what was typed: the supplier block, the lines (with what the grid shows put over them), the added fields and a title', async () => {
      const s = boot('admin');
      await openNew();
      await type('po-number', 'MT-NEW-1');
      await type('po-issuer', 'Admin');
      await type('po-supplier', 'Yu Motors');
      await type('po-supplier-country', 'China');
      await type('po-quote-id', 'RFQ-3');
      await type('po-incoterm', 'CIF');
      await typeLine(1, COL.client, 'ACME');
      await typeLine(1, COL.brand, 'BYD');
      await typeLine(1, COL.model, 'Seal');
      await typeLine(1, COL.price, '32000');
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R-5');
      await userEvent.click(document.getElementById('po-cf-cf_urgent')!);
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')).toBeTruthy(),
      );
      const body = lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')!.body!;
      expect(body).toMatchObject({
        po_number: 'MT-NEW-1',
        po_date: '2026-10-31',
        currency: 'USD',
        issuer: 'Admin',
        status: 'draft',
        customer_id: null,
        supplier_id: null,
        supplier: 'Yu Motors',
        supplier_country: 'China',
        quote_id: 'RFQ-3',
        incoterm: 'CIF',
        title: 'Yu Motors — 1 vehicle(s)',
        custom_fields: { cf_ref: 'R-5', cf_urgent: true },
      });
      const items = body['items'] as Record<string, unknown>[];
      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({
        client: 'ACME',
        brand: 'BYD',
        model: 'Seal',
        pi_price: '32000',
        units: '1',
        payment_term: '30/70',
        status: 'send_to_supplier',
      });
      // (the sheet goes, and the list is asked for again)
      await waitFor(() => expect(dialog()).toBeNull());
    });
    it('is titled "PO" when it has no supplier named', async () => {
      const s = boot('admin');
      await openNew();
      await typeLine(1, COL.brand, 'BYD');
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')).toBeTruthy(),
      );
      expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')!.body!['title']).toBe(
        'PO — 1 vehicle(s)',
      );
    });
    it("keeps the form, and says why in the server's words, when the server refuses it", async () => {
      const s = boot('admin', ALL, { saveError: 'PO number already exists' });
      await openNew();
      await typeLine(1, COL.brand, 'BYD');
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect((await screen.findByRole('alert')).textContent).toBe('PO number already exists');
      expect(dialog()).not.toBeNull();
      expect(lineInput(1, COL.brand).value).toBe('BYD');
      s.unmount();
    });
    it('Save & preview PDF saves, closes the form and shows the PDF of what was saved', async () => {
      stubBlobs();
      const s = boot('admin');
      await openNew();
      await type('po-number', 'MT-NEW-2');
      await type('po-supplier', 'Yu Motors');
      await typeLine(1, COL.brand, 'BYD');
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & preview PDF' }));
      await waitFor(() => expect(document.querySelector('[data-part=docFrame]')).not.toBeNull());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')).toBeTruthy();
      const sent = lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders/pdf')!.body!;
      expect(sent).toMatchObject({
        po_number: 'MT-NEW-2',
        supplier: 'Yu Motors',
        title: 'Yu Motors — 1 vehicle(s)',
      });
      // (the PDF is of the order as it was saved, in the order the two were asked)
      const order = s.w.writes.map(x => `${x.method} ${x.path}`);
      expect(order.indexOf('POST /api/dashboard/purchase-orders')).toBeLessThan(
        order.indexOf('POST /api/dashboard/purchase-orders/pdf'),
      );
      expect(document.querySelector('[data-part=docTitleText]')?.textContent).toBe(
        'Purchase order MT-NEW-2',
      );
      expect(dialog()).toBeNull();
    });
    it('does not preview what was not saved', async () => {
      stubBlobs();
      const s = boot('admin', ALL, { saveError: 'no' });
      await openNew();
      await typeLine(1, COL.brand, 'BYD');
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & preview PDF' }));
      await screen.findByRole('alert');
      expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders/pdf')).toBeUndefined();
      expect(card()).toBeNull();
    });
    it('sends nothing twice when Save is pressed twice at once', async () => {
      const s = boot('admin');
      await openNew();
      await typeLine(1, COL.brand, 'BYD');
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R');
      const save = within(dialog()).getByRole('button', { name: 'Save' });
      await userEvent.dblClick(save);
      await waitFor(() => expect(dialog()).toBeNull());
      expect(
        s.w.writes.filter(x => x.method === 'POST' && x.path === '/api/dashboard/purchase-orders'),
      ).toHaveLength(1);
    });
    it('Cancel, the × and Escape close it without sending anything', async () => {
      const s = boot('admin');
      await loaded();
      for (const how of ['cancel', 'x', 'escape'] as const) {
        await userEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
        await formReady();
        if (how === 'cancel')
          await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
        else if (how === 'x')
          await userEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
        else await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(dialog()).toBeNull());
      }
      expect(s.w.writes).toEqual([]);
    });
    it('can have lines added and taken away, and numbers them as it goes', async () => {
      boot('admin');
      await openNew();
      expect(lineRows()).toHaveLength(3);
      await userEvent.click(within(dialog()).getByRole('button', { name: '+ Add vehicle line' }));
      expect(lineRows()).toHaveLength(4);
      await userEvent.click(within(dialog()).getAllByTitle('Remove line')[0]!);
      expect(lineRows()).toHaveLength(3);
      expect(
        [...document.querySelectorAll('[data-part=gridNumber]')].map(e => e.textContent),
      ).toEqual(['1', '2', '3']);
    });
    it('a line taken away from the middle does not hand its words to the next', async () => {
      boot('admin');
      await openNew();
      await typeLine(1, COL.brand, 'First');
      await typeLine(2, COL.brand, 'Second');
      await typeLine(3, COL.brand, 'Third');
      await userEvent.click(within(dialog()).getAllByTitle('Remove line')[1]!);
      expect([1, 2].map(r => lineInput(r, COL.brand).value)).toEqual(['First', 'Third']);
    });
    it('counts the lines and what they come to as they are typed, in the currency of the form', async () => {
      boot('admin');
      await openNew();
      expect(total()).toBe('3 line(s) · Total USD 0');
      await typeLine(1, COL.price, '15000');
      expect(total()).toBe('3 line(s) · Total USD 15,000');
      await typeLine(1, COL.units, '2');
      expect(total()).toBe('3 line(s) · Total USD 30,000');
      await typeLine(2, COL.price, '500');
      expect(total()).toBe('3 line(s) · Total USD 30,500');
      await type('po-currency', 'EUR');
      expect(total()).toBe('3 line(s) · Total EUR 30,500');
      await userEvent.click(within(dialog()).getByRole('button', { name: '+ Add vehicle line' }));
      expect(total()).toBe('4 line(s) · Total EUR 30,500');
    });
    it('starts each line as the first status it has been given, and keeps the one that is chosen', async () => {
      const s = boot('admin', ALL, {
        itemColumns: [
          col('client', { label: 'CLIENT', builtin: true }),
          col('brand', { label: 'BRAND', builtin: true }),
          col('status', {
            label: 'STATUS',
            type: 'select',
            builtin: true,
            options: [
              { key: 'delivered', label: 'Delivered' },
              { key: 'in_logistics', label: 'In Logistics' },
            ],
          }),
        ],
      });
      await openNew();
      const status = at('STATUS');
      expect(within(lineCell(1, status)).getByRole('button').textContent).toContain('Delivered');
      await userEvent.click(within(dialog()).getByRole('button', { name: '+ Add vehicle line' }));
      expect(within(lineCell(4, status)).getByRole('button').textContent).toContain('Delivered');
      await pickLine(1, status, 'In Logistics');
      await typeLine(1, at('BRAND'), 'BYD');
      await userEvent.type(document.getElementById('po-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')).toBeTruthy(),
      );
      const items = lastWrite(s.w, 'POST', '/api/dashboard/purchase-orders')!.body![
        'items'
      ] as Record<string, unknown>[];
      expect(items.map(i => i['status'])).toEqual([
        'in_logistics',
        'delivered',
        'delivered',
        'delivered',
      ]);
    });
    it('starts as the built-in status when none has been arranged', async () => {
      boot('admin');
      await openNew();
      expect(within(lineCell(1, COL.status)).getByRole('button').textContent).toContain(
        'SEND TO SUPPLIER',
      );
      await userEvent.click(within(lineCell(1, COL.status)).getByRole('button'));
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        '—',
        'SEND TO SUPPLIER',
        'Car in Preparation',
        'In Logistics',
        'Car Delivered to moto',
      ]);
    });
  });

  describe('a purchase order opened for editing', () => {
    const openOne = async (n = 1) => {
      await loaded();
      await userEvent.click(within(rows()[n - 1]!).getByRole('button', { name: 'Edit' }));
      await formReady();
    };
    it('is the record: its number (which cannot be changed), supplier, lines and added fields', async () => {
      const s = boot('admin');
      await openOne();
      expect(dialog().querySelector('[data-part=title]')?.textContent).toBe(
        'Purchase order MT26P01Y26',
      );
      expect(field('po-number').value).toBe('MT26P01Y26');
      expect(field('po-number').readOnly).toBe(true);
      expect(field('po-supplier').value).toBe('Yu Motors');
      expect(field('po-currency').value).toBe('USD');
      expect(field('po-issuer').value).toBe('Admin');
      expect(field('po-quote-id').value).toBe('RFQ-9');
      expect(field('po-supplier-contact').value).toBe('yu@example.com');
      expect(field('po-incoterm').value).toBe('CIF');
      expect(field('po-delivery').value).toBe('Alexandria');
      expect(field('po-service').value).toBe('Maersk');
      expect(field('po-contact').value).toBe('ops@example.com');
      expect((document.getElementById('po-payment') as HTMLTextAreaElement).value).toBe(
        '30% deposit',
      );
      expect((document.getElementById('po-docs') as HTMLTextAreaElement).value).toBe('B/L');
      expect((document.getElementById('po-notes') as HTMLTextAreaElement).value).toBe(
        'Handle with care',
      );
      expect(lineInput(1, COL.client).value).toBe('ACME');
      expect(lineInput(1, COL.consignee).value).toBe('Ali');
      expect(lineInput(1, COL.units).value).toBe('2');
      expect(lineInput(1, COL.brand).value).toBe('BYD');
      expect(lineInput(1, COL.year).value).toBe('2026');
      expect(lineInput(1, COL.accessories).value).toBe('mats');
      expect(lineInput(1, COL.price).value).toBe('15000');
      expect(lineInput(1, COL.vin).value).toBe('VIN1');
      expect(lineInput(1, COL.link).value).toBe('https://example.com/f');
      expect(within(lineCell(1, COL.status)).getByRole('button').textContent).toContain(
        'In Logistics',
      );
      expect(lineInput(2, COL.brand).value).toBe('Aion');
      expect((document.getElementById('po-cf-cf_ref') as HTMLInputElement).value).toBe('R-1');
      expect((document.getElementById('po-cf-cf_urgent') as HTMLInputElement).checked).toBe(true);
      expect(total()).toBe('2 line(s) · Total USD 39,000');
      expect(s.asked.map(a => a.path)).toContain('/api/dashboard/purchase-orders/1');
      // (the status it has, by the label it has now)
      expect(within(dialog()).getByRole('button', { name: /Sent Out/ })).toBeTruthy();
    });
    it('is saved with a PUT to its own address, with what was changed over what was there — a hidden field and a hidden column keep their words', async () => {
      const s = boot('admin');
      await openOne();
      await type('po-issuer', 'Someone');
      await userEvent.type(lineInput(1, COL.brand), ' Auto');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/1')).toBeTruthy(),
      );
      const body = lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/1')!.body!;
      expect(body).toMatchObject({
        po_number: 'MT26P01Y26',
        issuer: 'Someone',
        status: 'sent',
        supplier_id: '1',
        incoterm: 'CIF',
        notes: 'Handle with care',
      });
      expect(body['custom_fields']).toEqual({ cf_ref: 'R-1', cf_urgent: true, cf_secret: 'keep' });
      const items = body['items'] as Record<string, unknown>[];
      expect(items[0]).toMatchObject({
        client: 'ACME',
        brand: 'BYD Auto',
        model: 'Seal',
        status: 'in_logistics',
        vin: 'VIN1',
        cf_hidden: 'keep this',
      });
      expect(items[1]).toMatchObject({ brand: 'Aion' });
      expect(
        s.w.writes.some(x => x.method === 'POST' && x.path === '/api/dashboard/purchase-orders'),
      ).toBe(false);
    });
    it('changes the status of a line, and of the order', async () => {
      const s = boot('admin');
      await openOne();
      await pickLine(2, COL.status, 'Car Delivered to moto');
      await pickOption('po-status', 'Confirmed');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/1')).toBeTruthy(),
      );
      const body = lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/1')!.body!;
      expect(body['status']).toBe('confirmed');
      expect((body['items'] as Record<string, unknown>[]).map(i => i['status'])).toEqual([
        'in_logistics',
        'delivered',
      ]);
    });
    it('keeps a status whose option has since been deleted, rather than changing it quietly', async () => {
      const s = boot('admin', ALL, {
        one: {
          3: full(3, {
            status: 'archived',
            items: [{ brand: 'X' }],
            custom_fields: { cf_ref: 'r' },
          }),
        },
      });
      await openOne(3);
      expect(within(dialog()).getByRole('button', { name: /archived/ })).toBeTruthy();
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/3')).toBeTruthy(),
      );
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/3')!.body!['status']).toBe(
        'archived',
      );
    });
    it('says why when the record cannot be had, and offers only to cancel', async () => {
      boot('admin', ALL, { one: {} });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Purchase order not found');
      expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeTruthy();
      expect(within(dialog()).queryByRole('button', { name: 'Save' })).toBeNull();
    });
    it('puts what the register says about a supplier into the supplier block when one is picked from it', async () => {
      const s = boot('admin');
      await openOne(2);
      await waitFor(() =>
        expect(within(dialog()).getByRole('button', { name: /— None —/ })).toBeTruthy(),
      );
      await pickOption('po-supplier-id', 'Yu Motors');
      expect(field('po-supplier').value).toBe('Yu Motors');
      expect(field('po-supplier-contact').value).toBe('yu@example.com');
      expect(field('po-supplier-address').value).toBe('Shanghai');
      expect(field('po-supplier-country').value).toBe('China');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/2')).toBeTruthy(),
      );
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/2')!.body!).toMatchObject({
        supplier_id: '1',
        supplier: 'Yu Motors',
      });
    });
    it('a supplier with nothing recorded blanks the block it fills (as the classic page does)', async () => {
      boot('admin');
      await openOne();
      await pickOption('po-supplier-id', 'Gulf Auto');
      expect(field('po-supplier').value).toBe('Gulf Auto');
      expect(field('po-supplier-contact').value).toBe('');
      expect(field('po-supplier-country').value).toBe('UAE');
    });
    it('"— None —" leaves the supplier block as it is', async () => {
      boot('admin');
      await openOne();
      await pickOption('po-supplier-id', 'Yu Motors');
      await pickOption('po-supplier-id', '— None —');
      expect(field('po-supplier').value).toBe('Yu Motors');
    });
    it('attaches a lead, listed by name with their phone', async () => {
      const s = boot('admin');
      await openOne();
      await userEvent.click(document.getElementById('po-customer-id')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        '— No lead —',
        'Ali',
        'Zed · +2',
      ]);
      await userEvent.click(screen.getByRole('option', { name: 'Zed · +2' }));
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/1')).toBeTruthy(),
      );
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/purchase-orders/1')!.body!['customer_id']).toBe(
        '7',
      );
    });
    it("a team member's leads are their own, from the team's route", async () => {
      const s = boot('team');
      await openOne();
      await userEvent.click(document.getElementById('po-customer-id')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        '— No lead —',
        'Ali',
        'Zed · +2',
      ]);
      expect(s.asked.map(a => a.path)).toContain('/api/employee/leads');
      expect(s.asked.map(a => a.path).some(p => p === '/api/dashboard/customers')).toBe(false);
    });
    it('a person who may not see leads is offered none (and the form still opens)', async () => {
      boot('team', ALL, { leads: 'forbidden' });
      await openOne();
      await userEvent.click(document.getElementById('po-customer-id')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['— No lead —']);
    });
  });

  describe('the supplier catalogue', () => {
    const openNew = async () => {
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
      await formReady();
    };
    it("adds a line for each vehicle ticked, from what the catalogue says of it (one unit, at the supplier's FOB price), and says how many", async () => {
      boot('admin');
      await openNew();
      await userEvent.click(
        within(dialog()).getByRole('button', { name: /From supplier catalogue/ }),
      );
      expect(await screen.findByText('Add from supplier catalogue')).toBeTruthy();
      for (const name of [/BYD Seal Max/, /Aion Y/])
        await userEvent.click(
          within(screen.getByText(name).closest('label')!).getByRole('checkbox'),
        );
      await userEvent.click(screen.getByRole('button', { name: 'Add selected' }));
      expect(screen.queryByText('Add from supplier catalogue')).toBeNull();
      expect(await screen.findByText('2 lines added.')).toBeTruthy();
      expect(lineRows()).toHaveLength(5);
      expect(lineInput(4, COL.brand).value).toBe('BYD');
      expect(lineInput(4, COL.model).value).toBe('Seal');
      expect(lineInput(4, COL.trim).value).toBe('Max');
      expect(lineInput(4, COL.year).value).toBe('2026');
      expect(lineInput(4, COL.accessories).value).toBe('mats');
      expect(lineInput(4, COL.units).value).toBe('1');
      expect(lineInput(4, COL.price).value).toBe('32789');
      expect(within(lineCell(4, COL.status)).getByRole('button').textContent).toContain(
        'SEND TO SUPPLIER',
      );
      expect(lineInput(5, COL.brand).value).toBe('Aion');
      expect(lineInput(5, COL.year).value).toBe('');
      expect(lineInput(5, COL.price).value).toBe('');
      expect(total()).toBe('5 line(s) · Total USD 32,789');
    });
    it('a single vehicle is "Line added from the catalogue."', async () => {
      boot('admin');
      await openNew();
      await userEvent.click(
        within(dialog()).getByRole('button', { name: /From supplier catalogue/ }),
      );
      await userEvent.click(
        within((await screen.findByText(/BYD Seal Max/)).closest('label')!).getByRole('checkbox'),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Add selected' }));
      expect(await screen.findByText('Line added from the catalogue.')).toBeTruthy();
    });
    it('asks for at least one, and stays open', async () => {
      boot('admin');
      await openNew();
      await userEvent.click(
        within(dialog()).getByRole('button', { name: /From supplier catalogue/ }),
      );
      await screen.findByText('Add from supplier catalogue');
      await userEvent.click(screen.getByRole('button', { name: 'Add selected' }));
      expect(await screen.findByText('Pick at least one vehicle.')).toBeTruthy();
      expect(screen.getByText('Add from supplier catalogue')).toBeTruthy();
      expect(lineRows()).toHaveLength(3);
    });
    it('says where to put some when there are none, and opens nothing', async () => {
      boot('admin', ALL, { offers: [] });
      await openNew();
      await userEvent.click(
        within(dialog()).getByRole('button', { name: /From supplier catalogue/ }),
      );
      expect(
        await screen.findByText(
          'No supplier vehicles yet — add them under Suppliers → Open → Vehicles.',
        ),
      ).toBeTruthy();
      expect(screen.queryByText('Add from supplier catalogue')).toBeNull();
    });
    it('Escape closes the small sheet and leaves the form where it was', async () => {
      boot('admin');
      await openNew();
      await userEvent.click(
        within(dialog()).getByRole('button', { name: /From supplier catalogue/ }),
      );
      await screen.findByText('Add from supplier catalogue');
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('Add from supplier catalogue')).toBeNull());
      expect(dialog()).not.toBeNull();
    });
  });

  describe("the administrator's controls", () => {
    it('are over the lines and the extra fields in the form, for the administrator alone', async () => {
      boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
      await formReady();
      expect(within(dialog()).getAllByRole('button', { name: 'Columns' })).toHaveLength(2);
      expect(within(dialog()).getAllByRole('button', { name: '+ Field' })).toHaveLength(2);
      expect(within(dialog()).getAllByTitle(/Field options/).length).toBeGreaterThan(0);
      expect(within(dialog()).getByText('Additional fields')).toBeTruthy();
      cleanup();
      boot('team');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
      await formReady();
      expect(within(dialog()).queryByRole('button', { name: 'Columns' })).toBeNull();
      expect(within(dialog()).queryByRole('button', { name: '+ Field' })).toBeNull();
      expect(within(dialog()).queryAllByTitle(/Field options/)).toHaveLength(0);
    });
    it('draw the lines from the columns arranged for them: a hidden column is not drawn but keeps its words, one renamed has its new name', async () => {
      boot('admin', ALL, {
        itemColumns: [
          col('brand', { label: 'Make', builtin: true, width: 90 }),
          col('model', { label: 'MODEL', builtin: true, visible: false }),
          col('trim', { label: 'TRIM', builtin: true }),
          col('cf_note', { label: 'Remark', builtin: false }),
        ],
      });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
      await formReady();
      const heads = [...document.querySelectorAll('[data-part=dialog] thead th')].map(
        h => h.textContent,
      );
      // (the arrangement says four; the built-in columns it leaves out follow, as they do in the classic grid)
      expect(heads.slice(0, 4)).toEqual(['No', 'Make', 'TRIM', 'Remark']);
      expect(heads).not.toContain('MODEL');
      expect(heads.at(-1)).toBe('');
    });
  });

  it('a person who may not see suppliers or the catalogue still has a form (the pickers are empty)', async () => {
    const s = open('team', teamMe(ALL), {
      entries: ['/purchaseorders'],
      more: {
        '/api/employee/purchase-orders': () => json(200, [row(1)]),
        '/api/employee/purchase-orders/1': () => json(200, full(1, { items: [{ brand: 'A' }] })),
        '/api/employee/columns/po_doc': () => json(200, { columns: null, entity: 'po_doc' }),
        '/api/employee/columns/po_items': () => json(200, { columns: null, entity: 'po_items' }),
        '/api/employee/suppliers': () => json(403, { error: 'Not permitted' }),
        '/api/employee/leads': () => json(403, { error: 'Not permitted' }),
      },
    });
    await loaded();
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
    await formReady();
    await userEvent.click(document.getElementById('po-supplier-id')!);
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['— None —']);
    s.unmount();
  });

  it('can be opened over and over (a new order is asked for afresh each time)', async () => {
    let n = 0;
    const s = boot('admin');
    await loaded();
    for (let i = 0; i < 2; i++) {
      s.w.defaults = { ...DEFAULTS, po_number: `MT-${++n}` };
      await userEvent.click(screen.getByRole('button', { name: /New purchase order/ }));
      await waitFor(() => expect(field('po-number')?.value).toBe(`MT-${n}`));
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(dialog()).toBeNull());
    }
  });
});
