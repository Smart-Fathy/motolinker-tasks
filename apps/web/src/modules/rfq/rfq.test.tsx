import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Column } from '../../columns';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';
import { askOpen, looking } from '../../test/assistant';

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
  rfq_no: `MT26W0${id}Y26`,
  title: 'x',
  supplier_name: null,
  issuer: null,
  rfq_date: null,
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
  payment_terms: null,
  delivery_location: null,
  service_provider: null,
  contact: null,
  documents_required: null,
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
      { key: 'answered', label: 'Answered', color: '#10b981' },
    ],
  }),
  col('cf_ref', { label: 'Reference', required: true }),
  col('cf_urgent', { label: 'Urgent', type: 'checkbox' }),
  col('cf_secret', { label: 'Internal', visible: false }),
];

const ALL = {
  rfq: true,
  rfqActions: { view: true, create: true, edit: true, delete: true, export: true },
};
const VIEWER = {
  rfq: true,
  rfqActions: { view: true, create: false, edit: false, delete: false, export: false },
};

type Body = Record<string, unknown>;
interface World {
  rfqs: unknown[] | 'forbidden' | 'failing' | 'odd';
  one: Record<number, unknown>;
  defaults: unknown;
  docColumns: Column[] | null;
  itemColumns: Column[] | null;
  suppliers: unknown[];
  leads: unknown[] | 'forbidden';
  offers: unknown[];
  writes: { method: string; path: string; body: Body | null }[];
  saveError: string | null;
  /** a save is answered when this is settled (at once where there is none) */
  saveGate: Promise<void> | null;
  deleteError: string | null;
  xlsx: 'ok' | 'failing' | 'odd';
  /** the list is answered when this is settled (at once where there is none) */
  listGate: Promise<void> | null;
}

const DEFAULTS = {
  rfq_no: 'MT26W040Y26',
  rfq_date: '2026-10-31',
  items: [{ accessories: 'Floor mats' }, {}, {}],
  payment_terms: '30% advance',
  documents_required: 'Bill of lading',
  customer_id: null,
};

/** A signed-in session whose server holds this world (the portal's own routes), and a record of what was written to it. */
function boot(
  portal: 'admin' | 'team',
  perms: Record<string, unknown> = ALL,
  init: Partial<World> = {},
  entries = ['/rfq'],
  extra: Record<string, Answer> = {},
  /** the address is the window's own (a test that is about the address), not an in-memory one */
  browser = false,
) {
  const w: World = {
    rfqs: [
      row(1, {
        supplier_name: 'Yu Motors',
        rfq_date: '2026-09-02',
        status: 'sent',
        items: [{ brand: 'BYD' }, { brand: 'Aion' }],
      }),
      row(2, { status: 'answered', items: [{ brand: 'Geely' }] }),
      row(3, { supplier_name: 'Gulf Auto', rfq_date: '2026-09-04', status: 'archived' }),
    ],
    one: {
      1: full(1, {
        supplier_id: 1,
        supplier_name: 'Yu Motors',
        supplier_contact: 'yu@example.com',
        supplier_address: 'Shanghai',
        supplier_country: 'China',
        issuer: 'Admin',
        rfq_date: '2026-09-02',
        status: 'sent',
        payment_terms: '30% deposit',
        delivery_location: 'Alexandria',
        service_provider: 'Maersk',
        contact: 'ops@example.com',
        documents_required: 'B/L',
        custom_fields: { cf_ref: 'R-1', cf_urgent: true, cf_secret: 'keep' },
        items: [
          {
            brand: 'BYD',
            model: 'Seal',
            trim: 'Max',
            colour: 'White',
            fob_price: 32000,
            cf_hidden: 'keep this',
          },
          { brand: 'Aion' },
        ],
      }),
      2: full(2, {
        status: 'answered',
        items: [{ brand: 'Geely' }],
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
        supplier_name: 'Yu Motors',
      }),
    ],
    writes: [],
    saveError: null,
    saveGate: null,
    deleteError: null,
    xlsx: 'ok',
    listGate: null,
    ...init,
  };
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  const asBody = (init: RequestInit): Body | null =>
    init.body ? (JSON.parse(String(init.body)) as Body) : null;
  const record = (path: string, init: RequestInit) =>
    w.writes.push({ method: String(init.method), path, body: asBody(init) });
  const columns =
    (entity: 'rfq_doc' | 'rfq_items'): Answer =>
    init => {
      if (init.method === 'PUT') {
        record(`${base}/columns/${entity}`, init);
        const body = asBody(init) as { columns: Column[] };
        if (entity === 'rfq_doc') w.docColumns = body.columns;
        else w.itemColumns = body.columns;
        return json(200, { ok: true, columns: body.columns });
      }
      return json(200, { columns: entity === 'rfq_doc' ? w.docColumns : w.itemColumns, entity });
    };
  const more: Record<string, Answer> = {
    [`${base}/rfqs`]: init => {
      if (init.method === 'POST') {
        record(`${base}/rfqs`, init);
        const reply = () =>
          w.saveError ? json(400, { error: w.saveError }) : json(200, full(9, asBody(init) ?? {}));
        return w.saveGate ? w.saveGate.then(reply) : reply();
      }
      const answer = () => {
        if (w.rfqs === 'forbidden') return json(403, { error: 'Not permitted' });
        if (w.rfqs === 'failing') return json(500, { error: 'relation "rfqs" does not exist' });
        if (w.rfqs === 'odd') return json(200, [{ id: 'x' }]);
        return json(200, w.rfqs);
      };
      return w.listGate ? w.listGate.then(answer) : answer();
    },
    [`${base}/rfqs/new/defaults`]: () => json(200, w.defaults),
    [`${base}/rfqs/new/defaults?customer_id=7`]: () =>
      json(200, { ...DEFAULTS, customer_id: 7, items: [{ brand: 'From the lead' }] }),
    [`${base}/rfqs/xlsx`]: init => {
      record(`${base}/rfqs/xlsx`, init);
      return json(200, { xlsx: btoa('PK'), name: String(asBody(init)?.['rfq_no'] ?? '') });
    },
    [`${base}/columns/rfq_doc`]: columns('rfq_doc'),
    [`${base}/columns/rfq_items`]: columns('rfq_items'),
    [`${base}/suppliers`]: () => json(200, w.suppliers),
    [`${base}/supplier-vehicles`]: () => json(200, w.offers),
    [`${base}/${portal === 'admin' ? 'customers' : 'leads'}`]: () =>
      w.leads === 'forbidden' ? json(403, { error: 'Not permitted' }) : json(200, w.leads),
    ...extra,
  };
  for (const id of [1, 2, 3, 9]) {
    more[`${base}/rfqs/${id}`] = init => {
      record(`${base}/rfqs/${id}`, init);
      if (init.method === 'DELETE')
        return w.deleteError ? json(403, { error: w.deleteError }) : json(200, { ok: true });
      if (init.method === 'PUT')
        return w.saveError
          ? json(400, { error: w.saveError })
          : json(200, full(id, asBody(init) ?? {}));
      return w.one[id] ? json(200, w.one[id]) : json(404, { error: 'RFQ not found' });
    };
    more[`${base}/rfqs/${id}/xlsx`] = init => {
      record(`${base}/rfqs/${id}/xlsx`, init);
      if (w.xlsx === 'failing') return json(500, { error: 'Failed to build the workbook' });
      if (w.xlsx === 'odd') return json(200, { nothing: true });
      return json(200, { xlsx: btoa('PK'), name: `MT26W0${id}Y26` });
    };
  }
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe(perms), {
    entries,
    more,
    browser,
  });
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
        /No RFQs yet|Failed to load|came back in a form|relation/.test(page()?.textContent ?? ''),
    ).toBe(true),
  );
const dialog = () => document.querySelector('[data-part=dialog]') as HTMLElement;
const formReady = async () => {
  await waitFor(() => expect(document.getElementById('rfq-no')).not.toBeNull());
  await waitFor(() =>
    expect(document.querySelectorAll('[data-part=dialog] tbody tr').length).toBeGreaterThan(0),
  );
};
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const type = async (id: string, text: string) => {
  const el = field(id);
  await userEvent.clear(el);
  if (text) await userEvent.type(el, text);
};
const lineCell = (r: number, c: number) =>
  document.querySelector(
    `[data-part=dialog] tbody tr:nth-child(${r}) td:nth-child(${c})`,
  ) as HTMLElement;
const lineInput = (r: number, c: number) =>
  lineCell(r, c).querySelector('input, textarea') as HTMLInputElement;
const pickOption = async (id: string, name: string | RegExp) => {
  await userEvent.click(document.getElementById(id)!);
  await userEvent.click(screen.getByRole('option', { name }));
};
const lastWrite = (w: World, method: string, path: string) =>
  [...w.writes].reverse().find(x => x.method === method && x.path === path);

describe('the RFQ screen', () => {
  it("is headed as each portal's classic page is, and names what it is for", async () => {
    const a = boot('admin');
    await loaded();
    expect(document.querySelector('[data-part=pageTitle]')?.textContent).toBe('RFQ');
    expect(
      document
        .querySelector('[data-part=pageHead]')
        ?.contains(screen.getByRole('button', { name: /New RFQ/ })),
    ).toBe(true);
    expect(document.querySelector('[data-part=pageHint]')?.textContent).toBe(
      'Request for Quotation sent to a supplier. Prefills from a lead, like the quotation.',
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
    expect(document.querySelector('[data-part=pageTitle]')?.textContent).toBe('RFQ');
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
    expect((await screen.findByText(/Loading RFQs…/)).closest('[data-part=loading]')).toBeTruthy();
    expect(screen.queryByText('No RFQs yet.')).toBeNull();
    gate.resolve();
    await screen.findByText('MT26W01Y26');
    expect(screen.queryByText(/Loading RFQs…/)).toBeNull();
    s.unmount();
  });

  it("keeps the loader until the document's columns are known as well (a list is never drawn with its status unarranged)", async () => {
    const gate = deferred<void>();
    const s = boot('admin', ALL, {}, ['/rfq'], {
      '/api/dashboard/columns/rfq_doc': () =>
        gate.promise.then(() => json(200, { columns: DOC_COLUMNS, entity: 'rfq_doc' })),
    });
    expect(await screen.findByText(/Loading RFQs…/)).toBeTruthy();
    await waitFor(() => expect(s.asked.map(a => a.path)).toContain('/api/dashboard/rfqs'));
    await new Promise(r => setTimeout(r, 60)); // (the list has had its time to come)
    expect(screen.queryByText('MT26W01Y26')).toBeNull();
    expect(screen.getByText(/Loading RFQs…/)).toBeTruthy();
    gate.resolve();
    await screen.findByText('MT26W01Y26');
    s.unmount();
  });

  it('lists each RFQ: its number, supplier, how many lines, status, date and what may be done with it', async () => {
    boot('admin');
    await loaded();
    expect(rows().map(cells)).toEqual([
      ['MT26W01Y26', 'Yu Motors', '2', 'Sent Out', '2026-09-02', 'Edit Excel Delete'],
      [
        'MT26W02Y26',
        '—',
        '1',
        'Answered',
        new Date('2026-09-01T10:00:00Z').toLocaleDateString(),
        'Edit Excel Delete',
      ],
      ['MT26W03Y26', 'Gulf Auto', '0', 'archived', '2026-09-04', 'Edit Excel Delete'],
    ]);
    // the status is a badge in the colour the administrator gave its option (an option that has gone is drawn plain)
    const sent = rows()[0]!.querySelector('[data-part=badge]') as HTMLElement;
    expect(sent.style.getPropertyValue('--ce-c')).toBe('#e69650');
    const gone = rows()[2]!.querySelector('[data-part=badge]') as HTMLElement;
    expect(gone.textContent).toBe('archived');
    expect(gone.style.getPropertyValue('--ce-c')).toBe('');
    // the number is the one thing in a row that is set in a fixed-width face
    expect(rows()[0]!.children[0]!.className).toContain('num');
  });

  it('offers a person only what they may do', async () => {
    boot('team', VIEWER);
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[5]),
    ).toEqual(['', '', '']);
    expect(screen.queryByRole('button', { name: /New RFQ/ })).toBeNull();
    cleanup();
    boot('team', {
      rfq: true,
      rfqActions: { view: true, create: false, edit: true, delete: false, export: true },
    });
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[5]),
    ).toEqual(['Edit Excel', 'Edit Excel', 'Edit Excel']);
    expect(screen.queryByRole('button', { name: /New RFQ/ })).toBeNull();
    cleanup();
    boot('team', {
      rfq: true,
      rfqActions: { view: true, create: true, edit: false, delete: true, export: false },
    });
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[5]),
    ).toEqual(['Delete', 'Delete', 'Delete']);
    expect(screen.getByRole('button', { name: /New RFQ/ })).toBeTruthy();
  });

  it("asks the portal's own routes: a team member's RFQs are the team's, not the administrator's", async () => {
    const s = boot('team');
    await loaded();
    const paths = s.asked.map(a => a.path);
    expect(paths).toContain('/api/employee/rfqs');
    expect(paths.some(p => p.startsWith('/api/dashboard/'))).toBe(false);
  });

  it('says there are none yet, and keeps the way to make one', async () => {
    boot('admin', ALL, { rfqs: [] });
    expect(await screen.findByText('No RFQs yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /New RFQ/ })).toBeTruthy();
  });

  it('says what the server said when it could not give them, with where to look if the table is missing', async () => {
    boot('admin', ALL, { rfqs: 'failing' });
    expect(await screen.findByText(/relation "rfqs" does not exist/)).toBeTruthy();
    expect(page().textContent).toContain('migrations/003_logistics_deals_docs.sql');
  });

  it("says so in the page's own words when the server cannot be reached", async () => {
    const s = open('admin', adminMe(), {
      entries: ['/rfq'],
      more: {
        '/api/dashboard/rfqs': () => {
          throw new TypeError('Failed to fetch');
        },
        '/api/dashboard/columns/rfq_doc': () => json(200, { columns: null, entity: 'rfq_doc' }),
      },
    });
    expect(await screen.findByText('Failed to load RFQs.')).toBeTruthy();
    s.unmount();
  });

  it('says so, and shows nothing, when the list is not a list of RFQs', async () => {
    boot('admin', ALL, { rfqs: 'odd' });
    expect(
      await screen.findByText(/The RFQs came back in a form this app does not know\./),
    ).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  describe('deleting', () => {
    it('asks first, by number, and does nothing if the answer is no', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const s = boot('admin');
      await loaded();
      await userEvent.click(within(rows()[1]!).getByRole('button', { name: 'Delete' }));
      expect(confirm).toHaveBeenCalledWith('Delete RFQ MT26W02Y26?');
      expect(s.w.writes).toEqual([]);
      expect(rows()).toHaveLength(3);
    });
    it('removes it and asks for the list again', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const s = boot('admin');
      await loaded();
      s.w.rfqs = [row(1, { supplier_name: 'Yu Motors' })];
      await userEvent.click(within(rows()[1]!).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(lastWrite(s.w, 'DELETE', '/api/dashboard/rfqs/2')).toBeTruthy());
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

  describe('the workbook', () => {
    const stubDownload = () => {
      const create = vi.fn(() => 'blob:book');
      vi.stubGlobal(
        'URL',
        Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }),
      );
      return {
        create,
        click: vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined),
      };
    };
    it('is made from the saved RFQ and handed to the browser, named after its number', async () => {
      const d = stubDownload();
      const s = boot('admin');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Excel' }));
      await waitFor(() => expect(d.click).toHaveBeenCalledTimes(1));
      expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs/1/xlsx')).toBeTruthy();
      expect((d.click.mock.contexts[0] as HTMLAnchorElement).download).toBe('RFQ_MT26W01Y26.xlsx');
      expect((d.create.mock.calls[0] as unknown as [Blob])[0].type).toContain('spreadsheetml');
    });
    it('says why in a notice when it could not be made', async () => {
      const d = stubDownload();
      boot('admin', ALL, { xlsx: 'failing' });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Excel' }));
      expect(
        await screen.findByText('Could not export this RFQ: Failed to build the workbook'),
      ).toBeTruthy();
      expect(d.click).not.toHaveBeenCalled();
    });
    it('says so when the answer is not a workbook', async () => {
      stubDownload();
      boot('admin', ALL, { xlsx: 'odd' });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Excel' }));
      expect(
        await screen.findByText(
          /Could not export this RFQ: The workbook came back in a form this app does not know\./,
        ),
      ).toBeTruthy();
    });
  });

  describe('a new RFQ', () => {
    it('opens at once, asks the server for its starting form, and is that form: its number and date, the standing wording, the lines it brought', async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      // (the sheet is there before the answer: with a loader in it)
      expect(dialog()).not.toBeNull();
      await formReady();
      expect(dialog().querySelector('[data-part=title]')?.textContent).toBe('New RFQ');
      expect(field('rfq-no').value).toBe('MT26W040Y26');
      expect(field('rfq-no').readOnly).toBe(false);
      expect(field('rfq-date').value).toBe('2026-10-31');
      expect((document.getElementById('rfq-payment') as HTMLTextAreaElement).value).toBe(
        '30% advance',
      );
      expect((document.getElementById('rfq-docs') as HTMLTextAreaElement).value).toBe(
        'Bill of lading',
      );
      expect(document.querySelectorAll('[data-part=dialog] tbody tr')).toHaveLength(3);
      expect(lineInput(1, 7).value).toBe('Floor mats');
      expect(s.asked.map(a => a.path)).toContain('/api/dashboard/rfqs/new/defaults');
    });
    it('is made for a lead when it is opened from one (?lead=), and the address is cleaned', async () => {
      window.history.replaceState(null, '', '/dashboard/rfq?lead=7');
      const s = boot('admin', ALL, {}, ['/rfq'], {}, true);
      await formReady();
      expect(lineInput(1, 2).value).toBe('From the lead');
      expect(s.asked.map(a => a.path)).toContain('/api/dashboard/rfqs/new/defaults?customer_id=7');
      await waitFor(() => expect(window.location.search).toBe(''));
      expect(window.location.pathname).toBe('/dashboard/rfq');
    });
    it.each(['abc', '0', '-3', '1.5', ''])(
      'ignores a lead that is %j, and cleans the address',
      async lead => {
        window.history.replaceState(null, '', `/dashboard/rfq?lead=${lead}`);
        boot('admin', ALL, {}, ['/rfq'], {}, true);
        await loaded();
        expect(dialog()).toBeNull();
        await waitFor(() => expect(window.location.search).toBe(''));
      },
    );
    it('is attached to the lead it was made for, even if the starting form did not say so', async () => {
      const s = boot('admin', ALL, {}, ['/rfq?lead=7'], {
        '/api/dashboard/rfqs/new/defaults?customer_id=7': () =>
          json(200, { ...DEFAULTS, customer_id: null }),
      });
      await formReady();
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')).toBeTruthy());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')!.body!['customer_id']).toBe('7');
    });
    it("is not opened by a lead's link for a person who may not make one", async () => {
      window.history.replaceState(null, '', '/employee/rfq?lead=7');
      boot('team', VIEWER, {}, ['/rfq'], {}, true);
      await loaded();
      expect(dialog()).toBeNull();
      await waitFor(() => expect(window.location.search).toBe(''));
    });
    it('offers the status options the administrator has left, starting as the first', async () => {
      boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.click(document.getElementById('rfq-status')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        'Draft',
        'Sent Out',
        'Answered',
      ]);
    });
    it("refuses a form with no vehicle named, in the classic page's words, and sends nothing", async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Add at least one vehicle line (brand, model or trim).',
      );
      expect(s.w.writes).toEqual([]);
    });
    it('refuses a form whose required added fields are empty, naming them', async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Required: Reference');
      expect(s.w.writes).toEqual([]);
    });
    it('saves what was typed: the supplier block, the lines (with what the grid shows put over them), the added fields and a title', async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await type('rfq-no', 'MT-NEW-1');
      await type('rfq-issuer', 'Admin');
      await type('rfq-supplier-name', 'Yu Motors');
      await type('rfq-supplier-country', 'China');
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(lineInput(1, 3), 'Seal');
      await userEvent.type(lineInput(1, 9), '32000');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R-5');
      await userEvent.click(document.getElementById('rfq-cf-cf_urgent')!);
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')).toBeTruthy());
      const body = lastWrite(s.w, 'POST', '/api/dashboard/rfqs')!.body!;
      expect(body).toMatchObject({
        rfq_no: 'MT-NEW-1',
        rfq_date: '2026-10-31',
        issuer: 'Admin',
        status: 'draft',
        customer_id: null,
        supplier_id: null,
        supplier_name: 'Yu Motors',
        supplier_country: 'China',
        payment_terms: '30% advance',
        documents_required: 'Bill of lading',
        title: 'Yu Motors — 1 vehicle(s)',
        custom_fields: { cf_ref: 'R-5', cf_urgent: true },
      });
      const items = body['items'] as Record<string, unknown>[];
      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({
        brand: 'BYD',
        model: 'Seal',
        fob_price: '32000',
        accessories: 'Floor mats',
      });
      // (the sheet goes, and the list is asked for again)
      await waitFor(() => expect(dialog()).toBeNull());
    });
    it('is titled "RFQ" when it has no supplier named', async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')).toBeTruthy());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')!.body!['title']).toBe(
        'RFQ — 1 vehicle(s)',
      );
    });
    it("keeps the form, and says why in the server's words, when the server refuses it", async () => {
      const s = boot('admin', ALL, { saveError: 'RFQ number already exists' });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      expect((await screen.findByRole('alert')).textContent).toBe('RFQ number already exists');
      expect(dialog()).not.toBeNull();
      expect(lineInput(1, 2).value).toBe('BYD');
      s.unmount();
    });
    it('starts as the first status the administrator left, which is what the form shows and what is saved', async () => {
      const first = { key: 'sent', label: 'Sent Out', color: '#e69650' };
      const s = boot('admin', ALL, {
        docColumns: DOC_COLUMNS.map(c =>
          c.key === 'status'
            ? { ...c, options: [first, ...(c.options ?? []).filter(o => o.key !== 'sent')] }
            : c,
        ),
      });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      expect(within(dialog()).getByRole('button', { name: /Sent Out/ })).toBeTruthy();
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')).toBeTruthy());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')!.body!['status']).toBe('sent');
    });
    it('a date left empty is sent as none, not as an empty word', async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      fireEvent.change(field('rfq-date'), { target: { value: '' } });
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')).toBeTruthy());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')!.body!['rfq_date']).toBeNull();
    });
    it('can be saved again once the server has had its say', async () => {
      const s = boot('admin', ALL, { saveError: 'RFQ number already exists' });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await screen.findByRole('alert');
      s.w.saveError = null;
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(dialog()).toBeNull());
      const posts = s.w.writes.filter(x => x.method === 'POST' && x.path === '/api/dashboard/rfqs');
      expect(posts).toHaveLength(2);
    });
    it('sends nothing twice when Save is pressed again while the first is still on its way', async () => {
      const gate = deferred<void>();
      const s = boot('admin', ALL, { saveGate: gate.promise });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      const save = within(dialog()).getByRole('button', { name: 'Save' });
      await userEvent.click(save);
      await userEvent.click(save);
      await userEvent.click(save);
      gate.resolve();
      await waitFor(() => expect(dialog()).toBeNull());
      const posts = s.w.writes.filter(x => x.method === 'POST' && x.path === '/api/dashboard/rfqs');
      expect(posts).toHaveLength(1);
    });
    it('saves what was typed without the spaces around it', async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await type('rfq-no', '  MT-SPACED  ');
      await type('rfq-issuer', '  Admin  ');
      await type('rfq-supplier-name', '  Yu Motors  ');
      await type('rfq-payment', '  30/70  ');
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')).toBeTruthy());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')!.body).toMatchObject({
        rfq_no: 'MT-SPACED',
        issuer: 'Admin',
        supplier_name: 'Yu Motors',
        payment_terms: '30/70',
        title: 'Yu Motors — 1 vehicle(s)',
      });
    });
    it('Save & export Excel saves, closes the form and hands the browser the workbook of what was saved', async () => {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      vi.stubGlobal(
        'URL',
        Object.assign(URL, { createObjectURL: () => 'blob:b', revokeObjectURL: vi.fn() }),
      );
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await type('rfq-supplier-name', 'Yu Motors');
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & export Excel' }));
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs')).toBeTruthy();
      const sent = lastWrite(s.w, 'POST', '/api/dashboard/rfqs/xlsx')!.body!;
      expect(sent).toMatchObject({ supplier_name: 'Yu Motors', title: 'Yu Motors — 1 vehicle(s)' });
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('RFQ_MT26W040Y26.xlsx');
      expect(dialog()).toBeNull();
    });
    it('does not export what was not saved', async () => {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const s = boot('admin', ALL, { saveError: 'no' });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.type(lineInput(1, 2), 'BYD');
      await userEvent.type(document.getElementById('rfq-cf-cf_ref')!, 'R');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & export Excel' }));
      await screen.findByRole('alert');
      expect(lastWrite(s.w, 'POST', '/api/dashboard/rfqs/xlsx')).toBeUndefined();
      expect(click).not.toHaveBeenCalled();
    });
    it('Cancel, the × and Escape close it without sending anything', async () => {
      const s = boot('admin');
      await loaded();
      for (const how of ['cancel', 'x', 'escape'] as const) {
        await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
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
    it('can have lines added and taken away', async () => {
      boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      expect(document.querySelectorAll('[data-part=dialog] tbody tr')).toHaveLength(3);
      await userEvent.click(within(dialog()).getByRole('button', { name: '+ Add line' }));
      expect(document.querySelectorAll('[data-part=dialog] tbody tr')).toHaveLength(4);
      await userEvent.click(within(dialog()).getAllByTitle('Remove')[0]!);
      expect(document.querySelectorAll('[data-part=dialog] tbody tr')).toHaveLength(3);
      expect(
        [...document.querySelectorAll('[data-part=gridNumber]')].map(e => e.textContent),
      ).toEqual(['1', '2', '3']);
    });
  });

  describe('an RFQ opened for editing', () => {
    const openOne = async (n = 1) => {
      await loaded();
      await userEvent.click(within(rows()[n - 1]!).getByRole('button', { name: 'Edit' }));
      await formReady();
    };
    it('is the record the assistant is told is open, until the form is closed — and a new RFQ is none', async () => {
      boot('admin');
      await openOne();
      await askOpen();
      expect(looking()).toBe('RFQ #1 · MT26W01Y26');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(looking()).toBe(''));
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      expect(looking()).toBe('');
    });
    it('is the record: its number (which cannot be changed), supplier, lines and added fields', async () => {
      const s = boot('admin');
      await openOne();
      expect(dialog().querySelector('[data-part=title]')?.textContent).toBe('RFQ MT26W01Y26');
      expect(field('rfq-no').value).toBe('MT26W01Y26');
      expect(field('rfq-no').readOnly).toBe(true);
      expect(field('rfq-issuer').value).toBe('Admin');
      expect(field('rfq-supplier-name').value).toBe('Yu Motors');
      expect(field('rfq-supplier-contact').value).toBe('yu@example.com');
      expect(field('rfq-delivery').value).toBe('Alexandria');
      expect((document.getElementById('rfq-payment') as HTMLTextAreaElement).value).toBe(
        '30% deposit',
      );
      expect(lineInput(1, 2).value).toBe('BYD');
      expect(lineInput(1, 4).value).toBe('Max');
      expect(lineInput(2, 2).value).toBe('Aion');
      expect((document.getElementById('rfq-cf-cf_ref') as HTMLInputElement).value).toBe('R-1');
      expect((document.getElementById('rfq-cf-cf_urgent') as HTMLInputElement).checked).toBe(true);
      expect(s.asked.map(a => a.path)).toContain('/api/dashboard/rfqs/1');
      // (the status it has, by the label it has now)
      expect(within(dialog()).getByRole('button', { name: /Sent Out/ })).toBeTruthy();
    });
    it('is saved with a PUT to its own address, with what was changed over what was there — a hidden field and a hidden column keep their words', async () => {
      const s = boot('admin');
      await openOne();
      await type('rfq-issuer', 'Someone');
      await userEvent.type(lineInput(1, 2), ' Auto');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/rfqs/1')).toBeTruthy());
      const body = lastWrite(s.w, 'PUT', '/api/dashboard/rfqs/1')!.body!;
      expect(body).toMatchObject({
        rfq_no: 'MT26W01Y26',
        issuer: 'Someone',
        status: 'sent',
        supplier_id: '1',
      });
      expect(body['custom_fields']).toEqual({ cf_ref: 'R-1', cf_urgent: true, cf_secret: 'keep' });
      const items = body['items'] as Record<string, unknown>[];
      expect(items[0]).toMatchObject({ brand: 'BYD Auto', model: 'Seal', cf_hidden: 'keep this' });
      expect(items[1]).toMatchObject({ brand: 'Aion' });
      expect(s.w.writes.some(x => x.method === 'POST' && x.path === '/api/dashboard/rfqs')).toBe(
        false,
      );
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
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/rfqs/3')).toBeTruthy());
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/rfqs/3')!.body!['status']).toBe('archived');
    });
    it('says why when the record cannot be had, and offers only to cancel', async () => {
      boot('admin', ALL, { one: {} });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
      expect((await screen.findByRole('alert')).textContent).toBe('RFQ not found');
      expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeTruthy();
      expect(within(dialog()).queryByRole('button', { name: 'Save' })).toBeNull();
    });
    it('puts what the register says about a supplier into the supplier block when one is picked from it', async () => {
      const s = boot('admin');
      await openOne(2);
      await waitFor(() =>
        expect(within(dialog()).getByRole('button', { name: /— None —/ })).toBeTruthy(),
      );
      await pickOption('rfq-supplier-id', 'Yu Motors');
      expect(field('rfq-supplier-name').value).toBe('Yu Motors');
      expect(field('rfq-supplier-contact').value).toBe('yu@example.com');
      expect(field('rfq-supplier-address').value).toBe('Shanghai');
      expect(field('rfq-supplier-country').value).toBe('China');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/rfqs/2')).toBeTruthy());
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/rfqs/2')!.body!).toMatchObject({
        supplier_id: '1',
        supplier_name: 'Yu Motors',
      });
    });
    it('a supplier with nothing recorded blanks the block it fills (as the classic page does)', async () => {
      boot('admin');
      await openOne();
      await pickOption('rfq-supplier-id', 'Gulf Auto');
      expect(field('rfq-supplier-name').value).toBe('Gulf Auto');
      expect(field('rfq-supplier-contact').value).toBe('');
      expect(field('rfq-supplier-address').value).toBe('');
      expect(field('rfq-supplier-country').value).toBe('UAE');
    });
    it('"— None —" leaves the supplier block as it is', async () => {
      boot('admin');
      await openOne();
      await pickOption('rfq-supplier-id', 'Yu Motors');
      await pickOption('rfq-supplier-id', '— None —');
      expect(field('rfq-supplier-name').value).toBe('Yu Motors');
    });
    it('attaches a lead, listed by name with their phone', async () => {
      const s = boot('admin');
      await openOne();
      await userEvent.click(document.getElementById('rfq-customer-id')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        '— No lead —',
        'Ali',
        'Zed · +2',
      ]);
      await userEvent.click(screen.getByRole('option', { name: 'Zed · +2' }));
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/rfqs/1')).toBeTruthy());
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/rfqs/1')!.body!['customer_id']).toBe('7');
    });
    it("a team member's leads are their own, from the team's route (the classic page never filled the list)", async () => {
      const s = boot('team');
      await openOne();
      await userEvent.click(document.getElementById('rfq-customer-id')!);
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
      await userEvent.click(document.getElementById('rfq-customer-id')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['— No lead —']);
    });
  });

  describe('the supplier catalogue', () => {
    it('adds a line for each vehicle ticked, from what the catalogue says of it, and says how many', async () => {
      boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.click(
        within(dialog()).getByRole('button', { name: /From supplier catalogue/ }),
      );
      const sheet = await screen.findByText('Add from supplier catalogue');
      expect(sheet).toBeTruthy();
      for (const name of [/BYD Seal Max/, /Aion Y/])
        await userEvent.click(
          within(screen.getByText(name).closest('label')!).getByRole('checkbox'),
        );
      await userEvent.click(screen.getByRole('button', { name: 'Add selected' }));
      expect(screen.queryByText('Add from supplier catalogue')).toBeNull();
      expect(await screen.findByText('2 lines added.')).toBeTruthy();
      expect(document.querySelectorAll('[data-part=dialog] tbody tr')).toHaveLength(5);
      expect(lineInput(4, 2).value).toBe('BYD');
      expect(lineInput(4, 3).value).toBe('Seal');
      expect(lineInput(4, 4).value).toBe('Max');
      expect(lineInput(4, 6).value).toBe('2026');
      expect(lineInput(4, 7).value).toBe('mats');
      expect(lineInput(4, 8).value).toBe('4 weeks');
      expect(lineInput(4, 9).value).toBe('32789');
      expect(lineInput(5, 2).value).toBe('Aion');
      expect(lineInput(5, 9).value).toBe('');
    });
    it('a single vehicle is "Line added from the catalogue."', async () => {
      boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
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
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      await userEvent.click(
        within(dialog()).getByRole('button', { name: /From supplier catalogue/ }),
      );
      await screen.findByText('Add from supplier catalogue');
      await userEvent.click(screen.getByRole('button', { name: 'Add selected' }));
      expect(await screen.findByText('Pick at least one vehicle.')).toBeTruthy();
      expect(screen.getByText('Add from supplier catalogue')).toBeTruthy();
      expect(document.querySelectorAll('[data-part=dialog] tbody tr')).toHaveLength(3);
    });
    it('says where to put some when there are none, and opens nothing', async () => {
      boot('admin', ALL, { offers: [] });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
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
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
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
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      expect(within(dialog()).getAllByRole('button', { name: 'Columns' })).toHaveLength(2);
      expect(within(dialog()).getAllByRole('button', { name: '+ Field' })).toHaveLength(2);
      expect(within(dialog()).getAllByTitle(/Field options/).length).toBeGreaterThan(0);
      expect(within(dialog()).getByText('Additional fields')).toBeTruthy();
      cleanup();
      boot('team');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
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
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await formReady();
      const heads = [...document.querySelectorAll('[data-part=dialog] thead th')].map(
        h => h.textContent,
      );
      // (the arrangement says four; the built-in columns it leaves out follow, as they do in the classic grid)
      expect(heads.slice(0, 4)).toEqual(['#', 'Make', 'TRIM', 'Remark']);
      expect(heads).not.toContain('MODEL');
      expect(heads.at(-1)).toBe('');
    });
  });

  it('a person who may not see suppliers or the catalogue still has a form (the pickers are empty)', async () => {
    const s = open('team', teamMe(ALL), {
      entries: ['/rfq'],
      more: {
        '/api/employee/rfqs': () => json(200, [row(1)]),
        '/api/employee/rfqs/1': () => json(200, full(1, { items: [{ brand: 'A' }] })),
        '/api/employee/columns/rfq_doc': () => json(200, { columns: null, entity: 'rfq_doc' }),
        '/api/employee/columns/rfq_items': () => json(200, { columns: null, entity: 'rfq_items' }),
        '/api/employee/suppliers': () => json(403, { error: 'Not permitted' }),
        '/api/employee/leads': () => json(403, { error: 'Not permitted' }),
      },
    });
    await loaded();
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
    await formReady();
    await userEvent.click(document.getElementById('rfq-supplier-id')!);
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['— None —']);
    s.unmount();
  });

  it('can be opened over and over (a new RFQ is asked for afresh each time)', async () => {
    let n = 0;
    const s = boot('admin');
    await loaded();
    for (let i = 0; i < 2; i++) {
      s.w.defaults = { ...DEFAULTS, rfq_no: `MT-${++n}` };
      await userEvent.click(screen.getByRole('button', { name: /New RFQ/ }));
      await waitFor(() => expect(field('rfq-no')?.value).toBe(`MT-${n}`));
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(dialog()).toBeNull());
    }
  });
});
