import { CONTRACT_PAYMENT_WHEN, CONTRACT_SECTIONS } from '@motolinker/contracts/documents';
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
  contract_no: `MC2610-${id}`,
  title: `عقد — Buyer ${id}`,
  status: 'draft',
  customer_id: null,
  deal_id: null,
  created_by: 'admin',
  created_at: '2026-09-01T10:00:00Z',
  ...over,
});

/** A contract on the car-sale wording, as the server gives it. */
const SALE = (over: Record<string, unknown> = {}) => ({
  template: 'sale-v2',
  contractNo: 'MC2610-1',
  contractDate: { day: 'السبت', d: '31', m: '10', y: '2026' },
  company: {
    name: 'Moto Linkers',
    commercialReg: '111',
    taxId: '222',
    address: 'Alexandria',
    repIn: 'Ahmed',
  },
  rep: { name: 'Ahmed', nationalId: '2900', role: 'Manager' },
  buyer: { name: 'Ali', nationalId: '29001', nationality: 'Egyptian', address: 'Cairo' },
  vehicle: { make: 'BYD', model: 'Seal', color: 'White', year: '2026', notes: 'Mats' },
  total: '1500000',
  totalWords: 'one million five hundred thousand',
  payments: [
    { amount: '500000', when: 'on signing', label: 'deposit' },
    { amount: '1000000', when: 'on delivery', label: '' },
  ],
  custom_fields: { cf_ref: 'R-1', cf_urgent: true, cf_secret: 'keep' },
  ...over,
});
/** …and one on the older wording: no template, its own late fee, and payment lines it keeps. */
const OLDER = () => ({
  buyer: { name: 'قديم', address: 'Giza' },
  vehicle: { make: 'Kia' },
  importCountry: 'الصين',
  total: '900000',
  lateFee: '50',
  lateFeeWords: 'fifty',
  deliveryDeadline: '90 days',
  payments: [
    { amount: '100', when: 'عند التوقيع', label: 'الدفعة الأولى' },
    { amount: '200', when: 'عند الاستلام' },
  ],
  custom_fields: { cf_ref: 'R-3' },
});
const full = (id: number, over: Record<string, unknown> = {}) => ({
  ...row(id),
  updated_at: '2026-09-02T10:00:00Z',
  data: SALE(),
  ...over,
});

const LEADS = [
  {
    id: 7,
    name: 'Zed',
    phone: '+2',
    address: 'Giza',
    custom_fields: {
      cf_national_id: '30012',
      cf_vehicle_offered: 'BYD Seal Max',
    },
  },
  { id: 5, name: 'Ali', phone: null, address: '', custom_fields: { cf_address: 'Cairo' } },
];

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
      { key: 'signed', label: 'Signed', color: '#10b981' },
      { key: 'cancelled', label: 'Void', color: '#dc2626' },
    ],
  }),
  col('cf_ref', { label: 'Reference', required: true }),
  col('cf_urgent', { label: 'Urgent', type: 'checkbox' }),
  col('cf_secret', { label: 'Internal', visible: false }),
];

const ALL = {
  contracts: true,
  contractsActions: { view: true, create: true, edit: true, delete: true, export: true },
};
const VIEWER = {
  contracts: true,
  contractsActions: { view: true, create: false, edit: false, delete: false, export: false },
};

type Body = Record<string, unknown>;
interface World {
  contracts: unknown[] | 'forbidden' | 'failing' | 'odd' | 'not-a-list';
  one: Record<number, unknown>;
  defaults: unknown;
  docColumns: Column[] | null;
  leads: unknown[] | 'forbidden';
  writes: { method: string; path: string; body: Body | null }[];
  saveError: string | null;
  /** a save is answered when this is settled (at once where there is none) */
  saveGate: Promise<void> | null;
  deleteError: string | null;
  pdf: 'ok' | 'failing' | 'odd';
  /** the list is answered when this is settled (at once where there is none) */
  listGate: Promise<void> | null;
  /** …and the PDF, likewise */
  pdfGate: Promise<void> | null;
}

const DEFAULTS = {
  contract_no: 'MC2610-40',
  data: SALE({
    contractNo: 'MC2610-40',
    rep: { name: 'Ahmed' },
    buyer: {},
    vehicle: {},
    total: '',
    totalWords: '',
    payments: [{ amount: '', when: CONTRACT_PAYMENT_WHEN, label: '' }],
    custom_fields: undefined,
  }),
};
const LEAD_DEFAULTS = {
  contract_no: 'MC2610-41',
  data: {
    ...DEFAULTS.data,
    contractNo: 'MC2610-41',
    buyer: { name: 'Zed', nationalId: '30012', address: 'Giza' },
    vehicle: { make: 'BYD', model: 'Seal Max' },
    total: '1500000',
  },
};

/** A signed-in session whose server holds this world (the portal's own routes), and a record of what was written to it. */
function boot(
  portal: 'admin' | 'team',
  perms: Record<string, unknown> = ALL,
  init: Partial<World> = {},
  entries = ['/contracts'],
  extra: Record<string, Answer> = {},
  /** the address is the window's own (a test that is about the address), not an in-memory one */
  browser = false,
) {
  const w: World = {
    contracts: [
      row(1, {
        title: 'عقد — Ali',
        status: 'signed',
        customer_id: 7,
        created_by: 'employee_2',
      }),
      row(2, {
        title: 'عقد — Mona',
        status: 'draft',
        created_by: 'auto_won',
        deal_id: 3,
        created_at: '2026-09-03T10:00:00Z',
      }),
      row(3, { title: '', status: 'archived', created_at: null, created_by: null }),
    ],
    one: {
      1: full(1, { title: 'عقد — Ali', status: 'signed', customer_id: 7 }),
      2: full(2, {
        title: 'عقد — Mona',
        created_by: 'auto_won',
        data: SALE({ contractNo: 'MC2610-2', buyer: { name: 'Mona' }, custom_fields: {} }),
      }),
      3: full(3, { title: '', status: 'archived', data: OLDER() }),
    },
    defaults: DEFAULTS,
    docColumns: DOC_COLUMNS,
    leads: LEADS,
    writes: [],
    saveError: null,
    saveGate: null,
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
  /** the row the server keeps of what was sent: the ids in it are whole numbers, whatever the form said */
  const kept = (id: number, sent: Body | null) => ({
    ...full(id),
    ...(sent ?? {}),
    customer_id: sent?.['customer_id'] ? Number(sent['customer_id']) : null,
  });
  const more: Record<string, Answer> = {
    [`${base}/contracts`]: init => {
      if (init.method === 'POST') {
        record(`${base}/contracts`, init);
        const reply = () =>
          w.saveError ? json(400, { error: w.saveError }) : json(200, kept(9, asBody(init)));
        return w.saveGate ? w.saveGate.then(reply) : reply();
      }
      const answer = () => {
        if (w.contracts === 'forbidden') return json(403, { error: 'Not permitted' });
        if (w.contracts === 'failing')
          return json(500, { error: 'relation "contracts" does not exist' });
        if (w.contracts === 'odd') return json(200, [{ id: 'x' }]);
        if (w.contracts === 'not-a-list') return json(200, { nothing: true });
        return json(200, w.contracts);
      };
      return w.listGate ? w.listGate.then(answer) : answer();
    },
    [`${base}/contracts/new/defaults`]: () => json(200, w.defaults),
    [`${base}/contracts/new/defaults?customer_id=7`]: () => json(200, LEAD_DEFAULTS),
    [`${base}/contracts/pdf`]: init => {
      record(`${base}/contracts/pdf`, init);
      const answer = () => {
        if (w.pdf === 'failing') return json(500, { error: 'Failed to render the document' });
        if (w.pdf === 'odd') return json(200, { nothing: true });
        return json(200, { pdf: btoa('%PDF-1.4'), name: 'Contract MC2610-1' });
      };
      return w.pdfGate ? w.pdfGate.then(answer) : answer();
    },
    [`${base}/columns/contracts`]: init => {
      if (init.method === 'PUT') {
        record(`${base}/columns/contracts`, init);
        const body = asBody(init) as { columns: Column[] };
        w.docColumns = body.columns;
        return json(200, { ok: true, columns: body.columns });
      }
      return json(200, { columns: w.docColumns, entity: 'contracts' });
    },
    [`${base}/${portal === 'admin' ? 'customers' : 'leads'}`]: () =>
      w.leads === 'forbidden' ? json(403, { error: 'Not permitted' }) : json(200, w.leads),
    ...extra,
  };
  for (const id of [1, 2, 3, 9]) {
    more[`${base}/contracts/${id}`] = init => {
      record(`${base}/contracts/${id}`, init);
      if (init.method === 'DELETE')
        return w.deleteError ? json(403, { error: w.deleteError }) : json(200, { ok: true });
      if (init.method === 'PUT')
        return w.saveError ? json(400, { error: w.saveError }) : json(200, kept(id, asBody(init)));
      return w.one[id] ? json(200, w.one[id]) : json(404, { error: 'Contract not found' });
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
        /No contracts yet|Failed to load|came back in a form|relation/.test(
          page()?.textContent ?? '',
        ),
    ).toBe(true),
  );
const dialog = () => document.querySelector('[data-part=dialog]') as HTMLElement;
const formReady = async () => {
  await waitFor(() => expect(document.getElementById('ct-buyer-name')).not.toBeNull());
};
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const type = async (id: string, text: string) => {
  const el = field(id);
  await userEvent.clear(el);
  if (text) await userEvent.type(el, text);
};
const payRows = () => [...document.querySelectorAll('[data-part=payRow]')] as HTMLElement[];
const payInput = (r: number, which: 'amount' | 'when') =>
  payRows()[r - 1]!.querySelector(`[data-pay=${which}]`) as HTMLInputElement;
const fixedPays = () => [...document.querySelectorAll('[data-part=payFixed]')] as HTMLElement[];
const lastWrite = (w: World, method: string, path: string) =>
  [...w.writes].reverse().find(x => x.method === method && x.path === path);
const card = () => document.querySelector('[data-part=docCard]') as HTMLElement | null;
const frame = () => document.querySelector('[data-part=docFrame]');
const heading = () => document.querySelector('[data-part=docTitleText]')?.textContent;
const stubBlobs = () => {
  const create = vi.fn(() => 'blob:pdf-1');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  return { create, revoke };
};
const save = () => within(dialog()).getByRole('button', { name: 'Save' });
/** What the form holds for the contract it opened on, and a buyer name, so that it can be saved. */
const fillTheRequired = async () => {
  await type('ct-buyer-name', 'Mona');
  await userEvent.type(document.getElementById('ct-cf-cf_ref')!, 'R');
};

describe('the contracts screen', () => {
  it("is headed as each portal's classic page is, and names what it is for", async () => {
    const a = boot('admin');
    await loaded();
    expect(document.querySelector('[data-part=pageTitle]')?.textContent).toBe('Contracts');
    expect(
      document
        .querySelector('[data-part=pageHead]')
        ?.contains(screen.getByRole('button', { name: /New contract/ })),
    ).toBe(true);
    expect(document.querySelector('[data-part=pageHint]')?.textContent).toBe(
      'Arabic vehicle import contract (عقد شراء وإستيراد سيارة لحساب الغير). A draft is created automatically whenever a deal moves to Won.',
    );
    // (the "Won" is set in bold, as the classic page sets it)
    expect(document.querySelector('[data-part=pageHint] strong')?.textContent).toBe('Won');
    expect(
      document
        .querySelector('[data-part=pageBody]')
        ?.contains(document.querySelector('[data-part=pageHint]')),
    ).toBe(true);
    a.unmount();
    cleanup();
    boot('team');
    await loaded();
    expect(document.querySelector('[data-part=pageTitle]')?.textContent).toBe('Contracts');
    expect(document.querySelector('[data-part=pageHint]')?.textContent).toBe(
      'Arabic vehicle import contract. A draft is created automatically whenever a deal moves to Won.',
    );
    expect(document.querySelector('[data-part=pageHint] strong')?.textContent).toBe('Won');
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
      (await screen.findByText(/Loading contracts…/)).closest('[data-part=loading]'),
    ).toBeTruthy();
    expect(screen.queryByText('No contracts yet.')).toBeNull();
    gate.resolve();
    await screen.findByText('MC2610-1');
    expect(screen.queryByText(/Loading contracts…/)).toBeNull();
    s.unmount();
  });

  it("keeps the loader until the document's columns are known as well (a list is never drawn with its status unarranged)", async () => {
    const gate = deferred<void>();
    const s = boot('admin', ALL, {}, ['/contracts'], {
      '/api/dashboard/columns/contracts': () =>
        gate.promise.then(() => json(200, { columns: DOC_COLUMNS, entity: 'contracts' })),
    });
    expect(await screen.findByText(/Loading contracts…/)).toBeTruthy();
    await waitFor(() => expect(s.asked.map(a => a.path)).toContain('/api/dashboard/contracts'));
    await new Promise(r => setTimeout(r, 60)); // (the list has had its time to come)
    expect(screen.queryByText('MC2610-1')).toBeNull();
    expect(screen.getByText(/Loading contracts…/)).toBeTruthy();
    gate.resolve();
    await screen.findByText('MC2610-1');
    s.unmount();
  });

  it('lists each contract: its number, title, status, date and what may be done with it', async () => {
    boot('admin');
    await loaded();
    expect(rows().map(cells)).toEqual([
      [
        'MC2610-1',
        'عقد — Ali',
        'Signed',
        new Date('2026-09-01T10:00:00Z').toLocaleDateString(),
        'Edit PDF Delete',
      ],
      [
        'MC2610-2',
        'عقد — Mona auto',
        'Draft',
        new Date('2026-09-03T10:00:00Z').toLocaleDateString(),
        'Edit PDF Delete',
      ],
      ['MC2610-3', '—', 'archived', '', 'Edit PDF Delete'],
    ]);
    // the number is the one thing in a row that is set in a fixed-width face
    expect(rows()[0]!.children[0]!.className).toContain('num');
    // every cell says what it is on a phone, where the rows are cards
    expect([...rows()[0]!.children].map(c => c.getAttribute('data-label'))).toEqual([
      'Contract #',
      'Title',
      'Status',
      'Created',
      'Actions',
    ]);
    expect(
      [...document.querySelectorAll('[data-part=headRow] th')].map(h => h.textContent),
    ).toEqual(['Contract #', 'Title', 'Status', 'Created', 'Actions']);
  });

  it('draws the status as a badge in the colour the administrator gave its option (an option that has gone is drawn plain)', async () => {
    boot('admin');
    await loaded();
    const signed = rows()[0]!.querySelector('[data-part=badge]') as HTMLElement;
    expect(signed.style.getPropertyValue('--ce-c')).toBe('#10b981');
    const draft = rows()[1]!.querySelector('[data-part=badge]') as HTMLElement;
    expect(draft.style.getPropertyValue('--ce-c')).toBe('#b9b3a4');
    const gone = rows()[2]!.querySelector('[data-part=badge]') as HTMLElement;
    expect(gone.textContent).toBe('archived');
    expect(gone.style.getPropertyValue('--ce-c')).toBe('');
  });

  it('marks, and only marks, the contracts a deal that reached Won drafted for itself', async () => {
    boot('admin');
    await loaded();
    expect(document.querySelectorAll('[data-part=auto]')).toHaveLength(1);
    expect(rows()[1]!.querySelector('[data-part=auto]')?.textContent).toBe('auto');
    expect(rows()[0]!.querySelector('[data-part=auto]')).toBeNull();
    expect(rows()[2]!.querySelector('[data-part=auto]')).toBeNull();
  });

  it('offers a person only what they may do', async () => {
    boot('team', VIEWER);
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[4]),
    ).toEqual(['', '', '']);
    expect(screen.queryByRole('button', { name: /New contract/ })).toBeNull();
    cleanup();
    boot('team', {
      contracts: true,
      contractsActions: { view: true, create: false, edit: true, delete: false, export: true },
    });
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[4]),
    ).toEqual(['Edit PDF', 'Edit PDF', 'Edit PDF']);
    expect(screen.queryByRole('button', { name: /New contract/ })).toBeNull();
    cleanup();
    boot('team', {
      contracts: true,
      contractsActions: { view: true, create: true, edit: false, delete: true, export: false },
    });
    await loaded();
    expect(
      rows()
        .map(cells)
        .map(c => c[4]),
    ).toEqual(['Delete', 'Delete', 'Delete']);
    expect(screen.getByRole('button', { name: /New contract/ })).toBeTruthy();
  });

  it("asks the portal's own routes: a team member's contracts are the team's, not the administrator's", async () => {
    const s = boot('team');
    await loaded();
    const paths = s.asked.map(a => a.path);
    expect(paths).toContain('/api/employee/contracts');
    expect(paths).toContain('/api/employee/columns/contracts');
    expect(paths.some(p => p.startsWith('/api/dashboard/'))).toBe(false);
  });

  it('says there are none yet, and keeps the way to make one', async () => {
    boot('admin', ALL, { contracts: [] });
    expect(await screen.findByText(/No contracts yet\./)).toBeTruthy();
    expect(page().textContent).toContain(
      'Click “New contract”, or move a deal to Won to have one drafted automatically.',
    );
    expect(document.querySelector('[data-part=none] strong')?.textContent).toBe('Won');
    expect(screen.getByRole('button', { name: /New contract/ })).toBeTruthy();
  });

  it('says there are none when what came back is not a list at all', async () => {
    boot('admin', ALL, { contracts: 'not-a-list' });
    expect(await screen.findByText(/No contracts yet\./)).toBeTruthy();
  });

  it('says what the server said when it could not give them, with where to look if the table is missing', async () => {
    boot('admin', ALL, { contracts: 'failing' });
    expect(await screen.findByText(/relation "contracts" does not exist/)).toBeTruthy();
    expect(page().textContent).toContain('migrations/001_stock_specs_colors_contracts.sql');
    expect(document.querySelector('[data-part=error]')).not.toBeNull();
  });

  it("says so in the page's own words when the server cannot be reached", async () => {
    const s = open('admin', adminMe(), {
      entries: ['/contracts'],
      more: {
        '/api/dashboard/contracts': () => {
          throw new TypeError('Failed to fetch');
        },
        '/api/dashboard/columns/contracts': () => json(200, { columns: null, entity: 'contracts' }),
      },
    });
    expect(await screen.findByText('Failed to load contracts.')).toBeTruthy();
    expect(page().textContent).not.toContain('migrations/');
    s.unmount();
  });

  it('says so, and shows nothing, when the list is not a list of contracts', async () => {
    boot('admin', ALL, { contracts: 'odd' });
    expect(
      await screen.findByText(/The contracts came back in a form this app does not know\./),
    ).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it('starts from the built-in statuses when none has been arranged', async () => {
    boot('admin', ALL, { docColumns: null });
    await loaded();
    expect(rows().map(r => cells(r)[2])).toEqual(['Signed', 'Draft', 'archived']);
  });

  describe('deleting', () => {
    it('asks first, by number, and does nothing if the answer is no', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const s = boot('admin');
      await loaded();
      await userEvent.click(within(rows()[1]!).getByRole('button', { name: 'Delete' }));
      expect(confirm).toHaveBeenCalledWith('Delete contract MC2610-2?');
      expect(s.w.writes).toEqual([]);
      expect(rows()).toHaveLength(3);
    });
    it('removes it and asks for the list again', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const s = boot('admin');
      await loaded();
      s.w.contracts = [row(1)];
      await userEvent.click(within(rows()[1]!).getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(lastWrite(s.w, 'DELETE', '/api/dashboard/contracts/2')).toBeTruthy(),
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

  describe("the PDF of a saved contract, in the administrator's preview", () => {
    it('opens at once, with a note that it is being made, and fills it with the PDF when it is', async () => {
      const blobs = stubBlobs();
      const gate = deferred<void>();
      const s = boot('admin', ALL, { pdfGate: gate.promise });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(card()).not.toBeNull();
      expect(heading()).toBe('Contract Preview');
      expect(await screen.findByText(/Rendering PDF…/)).toBeTruthy();
      expect(frame()).toBeNull();
      gate.resolve();
      await waitFor(() => expect(frame()).not.toBeNull());
      expect(heading()).toBe('Contract Preview');
      expect(card()?.getAttribute('aria-label')).toBe('Contract MC2610-1');
      expect(frame()?.getAttribute('src')).toBe('blob:pdf-1');
      expect(screen.queryByText(/Rendering PDF…/)).toBeNull();
      // the PDF is made from the contract as the server holds it, and nothing else is sent with it
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts/pdf')!.body).toEqual({
        data: SALE(),
      });
      expect((blobs.create.mock.calls[0] as unknown as [Blob])[0].type).toBe('application/pdf');
    });
    it('can be downloaded, as the classic preview names it', async () => {
      stubBlobs();
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      boot('admin');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      await userEvent.click(within(card()!).getByRole('button', { name: 'Download PDF' }));
      expect(click).toHaveBeenCalledTimes(1);
      const a = click.mock.contexts[0] as HTMLAnchorElement;
      expect(a.download).toBe('Contract_MC2610-1.pdf');
      expect(a.getAttribute('href')).toBe('blob:pdf-1');
    });
    it('is closed by its button and by Escape, and the PDF is given back each time', async () => {
      const blobs = stubBlobs();
      boot('admin');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      await userEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
      expect(card()).toBeNull();
      expect(blobs.revoke).toHaveBeenCalledWith('blob:pdf-1');
      blobs.revoke.mockClear();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(card()).toBeNull());
      expect(blobs.revoke).toHaveBeenCalledWith('blob:pdf-1');
    });
    it('stays shut when it was closed while its PDF was being made — the PDF that comes later is not shown', async () => {
      const blobs = stubBlobs();
      const gate = deferred<void>();
      boot('admin', ALL, { pdfGate: gate.promise });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(await screen.findByText(/Rendering PDF…/)).toBeTruthy();
      await userEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
      expect(card()).toBeNull();
      gate.resolve();
      await new Promise(r => setTimeout(r, 80));
      expect(card()).toBeNull();
      expect(blobs.create).not.toHaveBeenCalled();
    });
    it('says why in the preview when it could not be made — it is not a silent nothing', async () => {
      stubBlobs();
      boot('admin', ALL, { pdf: 'failing' });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(
        (
          await screen.findByText(/Could not render this document: Failed to render the document/)
        ).closest('[data-part=docError]'),
      ).toBeTruthy();
      expect(heading()).toBe('Contract Preview');
      expect(frame()).toBeNull();
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
    it('says so when the contract itself cannot be had, and asks the PDF of nothing', async () => {
      stubBlobs();
      const s = boot('admin', ALL, { one: {} });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(
        await screen.findByText(/Could not render this document: Contract not found/),
      ).toBeTruthy();
      expect(card()?.getAttribute('aria-label')).toBe('Contract');
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts/pdf')).toBeUndefined();
    });
    it('says so when the contract that came back is not a contract, and asks the PDF of nothing', async () => {
      stubBlobs();
      const s = boot('admin', ALL, { one: { 1: { id: 'one', contract_no: 7 } } });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(
        await screen.findByText(
          /Could not render this document: The contract came back in a form this app does not know\./,
        ),
      ).toBeTruthy();
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts/pdf')).toBeUndefined();
    });
    it('is downloaded under the motolinkers name when the contract has no number', async () => {
      stubBlobs();
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      boot('admin', ALL, { one: { 1: full(1, { contract_no: '' }) } });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      expect(card()?.getAttribute('aria-label')).toBe('Contract');
      await userEvent.click(within(card()!).getByRole('button', { name: 'Download PDF' }));
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
        'Contract_motolinkers.pdf',
      );
    });
    it('gives the PDF back when the screen goes away with it open', async () => {
      const blobs = stubBlobs();
      const s = boot('admin');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      expect(blobs.revoke).not.toHaveBeenCalled();
      s.unmount();
      expect(blobs.revoke).toHaveBeenCalledWith('blob:pdf-1');
    });
    it('gives back the PDF it had when another is opened', async () => {
      const blobs = stubBlobs();
      boot('admin');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      await userEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
      blobs.revoke.mockClear();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      expect(blobs.revoke).not.toHaveBeenCalled();
    });
  });

  describe("the PDF of a saved contract, in the team's viewer", () => {
    it('is the document viewer the team has for every other document, titled by the contract', async () => {
      stubBlobs();
      const gate = deferred<void>();
      const s = boot('team', ALL, { pdfGate: gate.promise });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(heading()).toBe('Contract');
      expect(await screen.findByText(/Rendering PDF…/)).toBeTruthy();
      gate.resolve();
      await waitFor(() => expect(frame()).not.toBeNull());
      expect(heading()).toBe('Contract MC2610-1');
      expect(within(card()!).getByRole('button', { name: 'Download' })).toBeTruthy();
      expect(within(card()!).queryByRole('button', { name: 'Download PDF' })).toBeNull();
      expect(lastWrite(s.w, 'POST', '/api/employee/contracts/pdf')!.body).toEqual({ data: SALE() });
    });
    it("is downloaded under the contract's number", async () => {
      stubBlobs();
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      boot('team');
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      await userEvent.click(within(card()!).getByRole('button', { name: 'Download' }));
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Contract_MC2610-1.pdf');
    });
    it('says why in the viewer when it could not be made', async () => {
      stubBlobs();
      boot('team', ALL, { pdf: 'failing' });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'PDF' }));
      expect(
        await screen.findByText(/Could not render this document: Failed to render the document/),
      ).toBeTruthy();
      expect(heading()).toBe('Contract MC2610-1');
    });
  });

  describe('a new contract', () => {
    const openNew = async () => {
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      await formReady();
    };
    it('opens at once, asks the server for its starting form, and is that form: the blanks it brought, one payment line and the number it carries', async () => {
      const gate = deferred<void>();
      const s = boot('admin', ALL, {}, ['/contracts'], {
        '/api/dashboard/contracts/new/defaults': () => gate.promise.then(() => json(200, DEFAULTS)),
      });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      // (the sheet is there before the answer: with a loader in it)
      expect(dialog()).not.toBeNull();
      expect(within(dialog()).getByText(/Loading…/)).toBeTruthy();
      gate.resolve();
      await formReady();
      expect(dialog().querySelector('[data-part=title]')?.textContent).toBe('New contract');
      expect(field('ct-contractDate-d').value).toBe('31');
      expect(field('ct-contractDate-day').value).toBe('السبت');
      expect(field('ct-company-name').value).toBe('Moto Linkers');
      expect(field('ct-company-commercialReg').value).toBe('111');
      expect(field('ct-rep-name').value).toBe('Ahmed');
      expect(field('ct-buyer-name').value).toBe('');
      expect(field('ct-total').value).toBe('');
      expect(payRows()).toHaveLength(1);
      expect(payInput(1, 'amount').value).toBe('');
      expect(payInput(1, 'when').value).toBe(CONTRACT_PAYMENT_WHEN);
      expect(payInput(1, 'when').placeholder).toBe(CONTRACT_PAYMENT_WHEN);
      expect(s.asked.map(a => a.path)).toContain('/api/dashboard/contracts/new/defaults');
    });
    it('is made of the blocks of the paper form, in its order, each with the fields the classic editor gave it', async () => {
      boot('admin');
      await openNew();
      const blocks = [...dialog().querySelectorAll('[data-part^=ctBlock-]')] as HTMLElement[];
      expect(blocks.map(b => b.getAttribute('data-part'))).toEqual(
        CONTRACT_SECTIONS.map(s => `ctBlock-${s.id}`),
      );
      expect(blocks.map(b => b.querySelector('label')?.textContent)).toEqual(
        CONTRACT_SECTIONS.map(s => s.title),
      );
      const captions = (b: HTMLElement) =>
        [...b.querySelectorAll('[data-part=ctField]')].map(f => f.firstElementChild?.textContent);
      expect(captions(blocks[0]!)).toEqual(['Day (اليوم)', 'DD', 'MM', 'YYYY']);
      expect(captions(blocks[2]!)).toEqual([
        'Buyer name',
        'National ID',
        'ID issue date',
        'Nationality',
        'Religion',
        'Address',
      ]);
      // each caption sits over a text box of that field's own
      expect(
        field('ct-vehicle-make').closest('[data-part=ctField]')!.firstElementChild!.textContent,
      ).toBe('Make (ماركة)');
      // a car-sale contract is not offered the older wording's fields
      expect(document.getElementById('ct-importCountry')).toBeNull();
      expect(document.getElementById('ct-lateFee')).toBeNull();
      // the paper form's rows are every blank there is
      const paths = CONTRACT_SECTIONS.flatMap(s => s.rows.flat().map(([p]) => p));
      for (const p of paths)
        expect(document.getElementById('ct-' + p.replace(/\./g, '-')), p).not.toBeNull();
    });
    it('is made for a lead when it is opened from one (?lead=), and the address is cleaned', async () => {
      window.history.replaceState(null, '', '/dashboard/contracts?lead=7');
      const s = boot('admin', ALL, {}, ['/contracts'], {}, true);
      await formReady();
      expect(field('ct-buyer-name').value).toBe('Zed');
      expect(field('ct-buyer-nationalId').value).toBe('30012');
      expect(field('ct-vehicle-make').value).toBe('BYD');
      expect(field('ct-vehicle-model').value).toBe('Seal Max');
      expect(field('ct-total').value).toBe('1500000');
      expect(s.asked.map(a => a.path)).toContain(
        '/api/dashboard/contracts/new/defaults?customer_id=7',
      );
      await waitFor(() => expect(window.location.search).toBe(''));
      expect(window.location.pathname).toBe('/dashboard/contracts');
      // …and it is attached to that lead, whose name the picker shows
      expect(within(dialog()).getByRole('button', { name: /Zed · \+2/ })).toBeTruthy();
      await userEvent.type(document.getElementById('ct-cf-cf_ref')!, 'R');
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')).toBeTruthy());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')!.body!['customer_id']).toBe('7');
    });
    it('is attached to the lead it was made for, even if the starting form did not say so', async () => {
      const s = boot('admin', ALL, {}, ['/contracts?lead=7']);
      await formReady();
      await userEvent.type(document.getElementById('ct-cf-cf_ref')!, 'R');
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')).toBeTruthy());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')!.body!['customer_id']).toBe('7');
    });
    it("is not opened by a lead's link for a person who may not make one", async () => {
      window.history.replaceState(null, '', '/employee/contracts?lead=7');
      boot('team', VIEWER, {}, ['/contracts'], {}, true);
      await loaded();
      expect(dialog()).toBeNull();
      await waitFor(() => expect(window.location.search).toBe(''));
    });
    it.each(['abc', '0', '-3', '1.5', ''])(
      'ignores a lead that is %j, and cleans the address',
      async lead => {
        window.history.replaceState(null, '', `/dashboard/contracts?lead=${lead}`);
        boot('admin', ALL, {}, ['/contracts'], {}, true);
        await loaded();
        expect(dialog()).toBeNull();
        await waitFor(() => expect(window.location.search).toBe(''));
      },
    );
    it('offers the status options the administrator has left, starting as the first', async () => {
      boot('admin');
      await openNew();
      expect(within(dialog()).getByRole('button', { name: /Draft/ })).toBeTruthy();
      await userEvent.click(document.getElementById('ct-status')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        'Draft',
        'Signed',
        'Void',
      ]);
    });
    it("refuses a form with no buyer, in the classic page's words, and sends nothing", async () => {
      const s = boot('admin');
      await openNew();
      await userEvent.click(save());
      expect((await screen.findByRole('alert')).textContent).toBe('Buyer name is required.');
      expect(s.w.writes).toEqual([]);
    });
    it('counts a buyer of spaces as none', async () => {
      const s = boot('admin');
      await openNew();
      await type('ct-buyer-name', '    ');
      await userEvent.click(save());
      expect((await screen.findByRole('alert')).textContent).toBe('Buyer name is required.');
      expect(s.w.writes).toEqual([]);
    });
    it('asks for the buyer before the added fields, and takes the alert away when it saves', async () => {
      const s = boot('admin');
      await openNew();
      await userEvent.click(save());
      expect((await screen.findByRole('alert')).textContent).toBe('Buyer name is required.');
      await type('ct-buyer-name', 'Mona');
      await userEvent.click(save());
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe('Required: Reference'),
      );
      expect(s.w.writes).toEqual([]);
      await userEvent.type(document.getElementById('ct-cf-cf_ref')!, 'R');
      await userEvent.click(save());
      await waitFor(() => expect(dialog()).toBeNull());
    });
    it('saves what was typed: each blank at its place, trimmed, the payment lines exactly as shown, the added fields, the status and a title after the buyer', async () => {
      const s = boot('admin');
      await openNew();
      await type('ct-buyer-name', '  Mona  ');
      await type('ct-buyer-nationalId', ' 29503 ');
      await type('ct-vehicle-make', 'BYD');
      await type('ct-vehicle-model', 'Seal');
      await type('ct-total', '1,500,000');
      await type('ct-contractDate-d', '5');
      await userEvent.type(payInput(1, 'amount'), '500000');
      await userEvent.click(within(dialog()).getByRole('button', { name: '+ Add payment line' }));
      await userEvent.type(payInput(2, 'amount'), '1000000');
      await type('ct-company-name', 'Moto Two');
      await userEvent.type(document.getElementById('ct-cf-cf_ref')!, 'R-5');
      await userEvent.click(document.getElementById('ct-cf-cf_urgent')!);
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')).toBeTruthy());
      const body = lastWrite(s.w, 'POST', '/api/dashboard/contracts')!.body!;
      expect(body).toMatchObject({
        contract_no: 'MC2610-40',
        title: 'عقد — Mona',
        status: 'draft',
        customer_id: null,
      });
      const data = body['data'] as Record<string, unknown>;
      expect(data).toMatchObject({
        template: 'sale-v2',
        contractNo: 'MC2610-40',
        buyer: { name: 'Mona', nationalId: '29503' },
        vehicle: { make: 'BYD', model: 'Seal' },
        company: { name: 'Moto Two', commercialReg: '111' },
        contractDate: { d: '5', day: 'السبت' },
        total: '1,500,000',
        custom_fields: { cf_ref: 'R-5', cf_urgent: true },
      });
      expect(data['payments']).toEqual([
        { amount: '500000', when: CONTRACT_PAYMENT_WHEN, label: '' },
        { amount: '1000000', when: CONTRACT_PAYMENT_WHEN, label: '' },
      ]);
      // (the sheet goes, and the list is asked for again)
      await waitFor(() => expect(dialog()).toBeNull());
    });
    it("keeps the form, and says why in the server's words, when the server refuses it", async () => {
      const s = boot('admin', ALL, { saveError: 'Contract number already exists' });
      await openNew();
      await fillTheRequired();
      await userEvent.click(save());
      expect((await screen.findByRole('alert')).textContent).toBe('Contract number already exists');
      expect(dialog()).not.toBeNull();
      expect(field('ct-buyer-name').value).toBe('Mona');
      s.unmount();
    });
    it('Save & preview PDF saves, closes the form and shows the PDF of the contract as it was saved', async () => {
      stubBlobs();
      const s = boot('admin');
      await openNew();
      await fillTheRequired();
      await type('ct-total', '77');
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & preview PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')).toBeTruthy();
      const saved = lastWrite(s.w, 'POST', '/api/dashboard/contracts')!.body!;
      // (the PDF is of the data the form saved, which the page hands over without asking the server for the record again)
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts/pdf')!.body).toEqual({
        data: saved['data'],
      });
      expect(s.w.writes.filter(x => x.method === 'GET')).toEqual([]);
      const order = s.w.writes.map(x => `${x.method} ${x.path}`);
      expect(order.indexOf('POST /api/dashboard/contracts')).toBeLessThan(
        order.indexOf('POST /api/dashboard/contracts/pdf'),
      );
      expect(heading()).toBe('Contract Preview');
      expect(card()?.getAttribute('aria-label')).toBe('Contract MC2610-40');
      expect(dialog()).toBeNull();
    });
    it("Save & preview PDF shows the team's viewer to the team", async () => {
      stubBlobs();
      boot('team');
      await openNew();
      await fillTheRequired();
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & preview PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      expect(heading()).toBe('Contract MC2610-40');
    });
    it('does not preview what was not saved', async () => {
      stubBlobs();
      const s = boot('admin', ALL, { saveError: 'no' });
      await openNew();
      await fillTheRequired();
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & preview PDF' }));
      await screen.findByRole('alert');
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts/pdf')).toBeUndefined();
      expect(card()).toBeNull();
    });
    it('Save alone does not show the PDF', async () => {
      stubBlobs();
      const s = boot('admin');
      await openNew();
      await fillTheRequired();
      await userEvent.click(save());
      await waitFor(() => expect(dialog()).toBeNull());
      expect(card()).toBeNull();
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts/pdf')).toBeUndefined();
    });
    it('can be saved again once the server has had its say', async () => {
      const s = boot('admin', ALL, { saveError: 'Contract number already exists' });
      await openNew();
      await fillTheRequired();
      await userEvent.click(save());
      await screen.findByRole('alert');
      s.w.saveError = null;
      await userEvent.click(save());
      await waitFor(() => expect(dialog()).toBeNull());
      const posts = s.w.writes.filter(
        x => x.method === 'POST' && x.path === '/api/dashboard/contracts',
      );
      expect(posts).toHaveLength(2);
    });
    it('sends nothing twice when Save is pressed again while the first is still on its way', async () => {
      const gate = deferred<void>();
      const s = boot('admin', ALL, { saveGate: gate.promise });
      await openNew();
      await fillTheRequired();
      const button = save();
      await userEvent.click(button);
      await userEvent.click(button);
      await userEvent.click(button);
      gate.resolve();
      await waitFor(() => expect(dialog()).toBeNull());
      const posts = s.w.writes.filter(
        x => x.method === 'POST' && x.path === '/api/dashboard/contracts',
      );
      expect(posts).toHaveLength(1);
    });
    it('Cancel, the × and Escape close it without sending anything', async () => {
      const s = boot('admin');
      await loaded();
      for (const how of ['cancel', 'x', 'escape'] as const) {
        await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
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
    it('can be opened over and over (a new contract is asked for afresh each time)', async () => {
      let n = 0;
      const s = boot('admin');
      await loaded();
      for (let i = 0; i < 2; i++) {
        s.w.defaults = {
          ...DEFAULTS,
          contract_no: `MC-${++n}`,
          data: { ...DEFAULTS.data, contractNo: `MC-${n}` },
        };
        await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
        await waitFor(() =>
          expect(dialog().querySelector('[data-part=title]')?.textContent).toBe('New contract'),
        );
        await formReady();
        await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & preview PDF' }));
        await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(dialog()).toBeNull());
      }
    });
    it('says why when its starting form cannot be had, and offers only to cancel', async () => {
      boot('admin', ALL, {}, ['/contracts'], {
        '/api/dashboard/contracts/new/defaults': () => json(403, { error: 'Not permitted' }),
      });
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      expect((await screen.findByRole('alert')).textContent).toBe('Not permitted');
      expect(within(dialog()).queryByRole('button', { name: 'Save' })).toBeNull();
      expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });
  });

  describe('payment lines', () => {
    const openNew = async () => {
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      await formReady();
    };
    it('can be added and taken away, each starting with the wording the contract prints for a line with none', async () => {
      boot('admin');
      await openNew();
      const add = within(dialog()).getByRole('button', { name: '+ Add payment line' });
      await userEvent.click(add);
      await userEvent.click(add);
      expect(payRows()).toHaveLength(3);
      expect(payRows().map((_, i) => payInput(i + 1, 'when').value)).toEqual([
        CONTRACT_PAYMENT_WHEN,
        CONTRACT_PAYMENT_WHEN,
        CONTRACT_PAYMENT_WHEN,
      ]);
      await userEvent.click(within(payRows()[1]!).getByRole('button', { name: '×' }));
      expect(payRows()).toHaveLength(2);
      for (const r of [...payRows()])
        await userEvent.click(within(r).getByRole('button', { name: '×' }));
      expect(payRows()).toHaveLength(0);
      // (and one can be added to none)
      await userEvent.click(add);
      expect(payRows()).toHaveLength(1);
    });
    it('a line taken away from the middle does not hand its words to the next', async () => {
      boot('admin');
      await openNew();
      const add = within(dialog()).getByRole('button', { name: '+ Add payment line' });
      await userEvent.click(add);
      await userEvent.click(add);
      await userEvent.type(payInput(1, 'amount'), 'one');
      await userEvent.type(payInput(2, 'amount'), 'two');
      await userEvent.type(payInput(3, 'amount'), 'three');
      await userEvent.click(within(payRows()[1]!).getByRole('button', { name: '×' }));
      expect(payRows().map((_, i) => payInput(i + 1, 'amount').value)).toEqual(['one', 'three']);
    });
    it('are saved as they are on screen: the amount and the words trimmed, none for a line taken away, and the label a line came with', async () => {
      const s = boot('admin', ALL, {
        defaults: {
          ...DEFAULTS,
          data: {
            ...DEFAULTS.data,
            payments: [
              { amount: '5', when: 'now', label: 'deposit' },
              { amount: '6', when: 'later' },
            ],
          },
        },
      });
      await openNew();
      await fillTheRequired();
      await type('ct-contractDate-d', '9');
      await userEvent.type(payInput(1, 'amount'), '0 ');
      await userEvent.clear(payInput(2, 'when'));
      await userEvent.type(payInput(2, 'when'), '  at the door ');
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')).toBeTruthy());
      const data = lastWrite(s.w, 'POST', '/api/dashboard/contracts')!.body!['data'] as Record<
        string,
        unknown
      >;
      expect(data['payments']).toEqual([
        { amount: '50', when: 'now', label: 'deposit' },
        { amount: '6', when: 'at the door', label: '' },
      ]);
    });
    it('are none when every line is taken away', async () => {
      const s = boot('admin');
      await openNew();
      await fillTheRequired();
      await userEvent.click(within(payRows()[0]!).getByRole('button', { name: '×' }));
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')).toBeTruthy());
      const data = lastWrite(s.w, 'POST', '/api/dashboard/contracts')!.body!['data'] as Record<
        string,
        unknown
      >;
      expect(data['payments']).toEqual([]);
    });
  });

  describe('the lead on a contract', () => {
    const openNew = async (portal: 'admin' | 'team' = 'admin', init: Partial<World> = {}) => {
      boot(portal, ALL, init);
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      await formReady();
    };
    it('is listed by name with their phone, and picking one fills the buyer and the car they asked about', async () => {
      await openNew();
      await userEvent.click(document.getElementById('ct-customer-id')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        '— No lead —',
        'Ali',
        'Zed · +2',
      ]);
      await userEvent.click(screen.getByRole('option', { name: 'Zed · +2' }));
      expect(field('ct-buyer-name').value).toBe('Zed');
      expect(field('ct-buyer-nationalId').value).toBe('30012');
      expect(field('ct-buyer-address').value).toBe('Giza');
      expect(field('ct-vehicle-make').value).toBe('BYD');
      expect(field('ct-vehicle-model').value).toBe('Seal Max');
    });
    it('keeps what a person has typed and takes the name of the lead, as the classic picker does', async () => {
      await openNew();
      await type('ct-buyer-name', 'Someone');
      await type('ct-buyer-address', 'My street');
      await type('ct-vehicle-make', 'Audi');
      await userEvent.click(document.getElementById('ct-customer-id')!);
      await userEvent.click(screen.getByRole('option', { name: 'Zed · +2' }));
      expect(field('ct-buyer-name').value).toBe('Zed');
      expect(field('ct-buyer-address').value).toBe('My street');
      expect(field('ct-vehicle-make').value).toBe('Audi');
      expect(field('ct-vehicle-model').value).toBe('Seal Max');
      expect(field('ct-buyer-nationalId').value).toBe('30012');
    });
    it("takes the address from the lead's custom field when it has none of its own", async () => {
      await openNew();
      await userEvent.click(document.getElementById('ct-customer-id')!);
      await userEvent.click(screen.getByRole('option', { name: 'Ali' }));
      expect(field('ct-buyer-name').value).toBe('Ali');
      expect(field('ct-buyer-address').value).toBe('Cairo');
      expect(field('ct-vehicle-make').value).toBe('');
    });
    it('is attached to the contract when it is saved, and "— No lead —" leaves the buyer as it was and attaches none', async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      await formReady();
      await userEvent.click(document.getElementById('ct-customer-id')!);
      await userEvent.click(screen.getByRole('option', { name: 'Zed · +2' }));
      await userEvent.click(document.getElementById('ct-customer-id')!);
      await userEvent.click(screen.getByRole('option', { name: '— No lead —' }));
      expect(field('ct-buyer-name').value).toBe('Zed');
      await userEvent.type(document.getElementById('ct-cf-cf_ref')!, 'R');
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')).toBeTruthy());
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')!.body!['customer_id']).toBeNull();
    });
    it("a team member's leads are their own, from the team's route", async () => {
      const s = boot('team');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      await formReady();
      await userEvent.click(document.getElementById('ct-customer-id')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        '— No lead —',
        'Ali',
        'Zed · +2',
      ]);
      expect(s.asked.map(a => a.path)).toContain('/api/employee/leads');
      expect(s.asked.map(a => a.path).some(p => p === '/api/dashboard/customers')).toBe(false);
    });
    it('a person who may not see leads is offered none (and the form still opens)', async () => {
      await openNew('team', { leads: 'forbidden' });
      await userEvent.click(document.getElementById('ct-customer-id')!);
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['— No lead —']);
    });
  });

  describe('a contract opened for editing', () => {
    const openOne = async (
      n = 1,
      portal: 'admin' | 'team' = 'admin',
      init: Partial<World> = {},
    ) => {
      const s = boot(portal, ALL, init);
      await loaded();
      await userEvent.click(within(rows()[n - 1]!).getByRole('button', { name: 'Edit' }));
      await formReady();
      return s;
    };
    it('is the record: its number, every blank where it was, its payment lines, status, lead and added fields', async () => {
      const s = await openOne();
      expect(dialog().querySelector('[data-part=title]')?.textContent).toBe('Contract MC2610-1');
      expect(field('ct-buyer-name').value).toBe('Ali');
      expect(field('ct-buyer-nationalId').value).toBe('29001');
      expect(field('ct-buyer-nationality').value).toBe('Egyptian');
      expect(field('ct-vehicle-make').value).toBe('BYD');
      expect(field('ct-vehicle-notes').value).toBe('Mats');
      expect(field('ct-total').value).toBe('1500000');
      expect(field('ct-totalWords').value).toBe('one million five hundred thousand');
      expect(field('ct-rep-role').value).toBe('Manager');
      expect(payRows()).toHaveLength(2);
      expect(payInput(1, 'amount').value).toBe('500000');
      expect(payInput(1, 'when').value).toBe('on signing');
      expect(payInput(2, 'amount').value).toBe('1000000');
      expect((document.getElementById('ct-cf-cf_ref') as HTMLInputElement).value).toBe('R-1');
      expect((document.getElementById('ct-cf-cf_urgent') as HTMLInputElement).checked).toBe(true);
      expect(within(dialog()).getByRole('button', { name: /Signed/ })).toBeTruthy();
      expect(within(dialog()).getByRole('button', { name: /Zed · \+2/ })).toBeTruthy();
      expect(s.asked.map(a => a.path)).toContain('/api/dashboard/contracts/1');
    });
    it('is saved with a PUT to its own address, with what was changed over what was there — a hidden field keeps its words, and so does a blank the form does not show', async () => {
      const s = await openOne(1, 'admin', {
        one: {
          1: full(1, {
            status: 'signed',
            customer_id: 7,
            data: SALE({
              internalNote: 'keep me',
              buyer: { name: 'Ali', nationalId: '29001', extra: 'kept' },
            }),
          }),
        },
      });
      await type('ct-buyer-name', 'Ali Hassan');
      await type('ct-total', '1600000');
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')).toBeTruthy());
      const body = lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')!.body!;
      expect(body).toMatchObject({
        contract_no: 'MC2610-1',
        title: 'عقد — Ali Hassan',
        status: 'signed',
        customer_id: '7',
      });
      const data = body['data'] as Record<string, unknown>;
      expect(data).toMatchObject({
        template: 'sale-v2',
        contractNo: 'MC2610-1',
        internalNote: 'keep me',
        buyer: { name: 'Ali Hassan', nationalId: '29001', extra: 'kept' },
        total: '1600000',
        custom_fields: { cf_ref: 'R-1', cf_urgent: true, cf_secret: 'keep' },
      });
      expect(data['payments']).toEqual([
        { amount: '500000', when: 'on signing', label: 'deposit' },
        { amount: '1000000', when: 'on delivery', label: '' },
      ]);
      expect(lastWrite(s.w, 'POST', '/api/dashboard/contracts')).toBeUndefined();
    });
    it('changes the status, and the number it is printed under stays', async () => {
      const s = await openOne();
      await userEvent.click(document.getElementById('ct-status')!);
      await userEvent.click(screen.getByRole('option', { name: 'Void' }));
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')).toBeTruthy());
      const body = lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')!.body!;
      expect(body['status']).toBe('cancelled');
      expect(body['contract_no']).toBe('MC2610-1');
    });
    it('keeps a status whose option has since been deleted, rather than changing it quietly', async () => {
      const s = await openOne(3);
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/3')).toBeTruthy());
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/3')!.body!['status']).toBe('archived');
    });
    it('saves a contract whose buyer is its own, with the title the contract had to be named after', async () => {
      const s = await openOne(2);
      await type('ct-buyer-name', 'Mona Said');
      await userEvent.type(document.getElementById('ct-cf-cf_ref')!, 'R');
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/2')).toBeTruthy());
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/2')!.body!['title']).toBe(
        'عقد — Mona Said',
      );
    });
    it('Save & preview PDF of a saved one shows the contract under its own number', async () => {
      stubBlobs();
      const s = await openOne();
      await userEvent.click(within(dialog()).getByRole('button', { name: 'Save & preview PDF' }));
      await waitFor(() => expect(frame()).not.toBeNull());
      expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')).toBeTruthy();
      expect(card()?.getAttribute('aria-label')).toBe('Contract MC2610-1');
      expect(
        (
          lastWrite(s.w, 'POST', '/api/dashboard/contracts/pdf')!.body!['data'] as Record<
            string,
            unknown
          >
        )['contractNo'],
      ).toBe('MC2610-1');
    });
    it('says why when the record cannot be had, and offers only to cancel', async () => {
      boot('admin', ALL, { one: {} });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Contract not found');
      expect(within(dialog()).queryByRole('button', { name: 'Save' })).toBeNull();
      expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });
    it('says so when what came back is not a contract', async () => {
      boot('admin', ALL, { one: { 1: { id: 1 } } });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(
        /came back in a form this app does not know/,
      );
    });
    it('opens a contract with nothing in its data as a form of blanks', async () => {
      const s = await openOne(1, 'admin', { one: { 1: full(1, { data: {} }) } });
      expect(field('ct-buyer-name').value).toBe('');
      expect(payRows()).toHaveLength(0);
      expect(fixedPays()).toHaveLength(0);
      // (no template, so it is the older wording's form)
      expect(field('ct-importCountry').value).toBe('');
      await type('ct-buyer-name', 'Mona');
      await userEvent.type(document.getElementById('ct-cf-cf_ref')!, 'R');
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')).toBeTruthy());
      const data = lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')!.body!['data'] as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('payments');
      expect(data).not.toHaveProperty('contractNo');
      expect(data).not.toHaveProperty('template');
    });
  });

  describe('a contract on the older wording', () => {
    const openOlder = async () => {
      const s = boot('admin');
      await loaded();
      await userEvent.click(within(rows()[2]!).getByRole('button', { name: 'Edit' }));
      await formReady();
      return s;
    };
    it('is offered the fields that wording had besides, and its payment lines as they are, to change the amounts of', async () => {
      await openOlder();
      expect(field('ct-importCountry').value).toBe('الصين');
      expect(field('ct-lateFee').value).toBe('50');
      expect(field('ct-lateFeeWords').value).toBe('fifty');
      expect(field('ct-deliveryDeadline').value).toBe('90 days');
      expect(field('ct-buyer-name').value).toBe('قديم');
      // no line to add or take away
      expect(payRows()).toHaveLength(0);
      expect(within(dialog()).queryByRole('button', { name: '+ Add payment line' })).toBeNull();
      expect(fixedPays()).toHaveLength(2);
      expect((fixedPays()[0]!.querySelector('input') as HTMLInputElement).value).toBe('100');
      expect(words(fixedPays()[0]!)).toBe('عند التوقيع (الدفعة الأولى)');
      expect((fixedPays()[1]!.querySelector('input') as HTMLInputElement).value).toBe('200');
      expect(words(fixedPays()[1]!)).toBe('عند الاستلام');
    });
    it('is saved with the lines it had and only their amounts changed, with no template and no number written into it', async () => {
      const s = await openOlder();
      await userEvent.type(fixedPays()[1]!.querySelector('input')!, '5');
      await type('ct-importCountry', ' اليابان ');
      await type('ct-lateFee', '75');
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/3')).toBeTruthy());
      const body = lastWrite(s.w, 'PUT', '/api/dashboard/contracts/3')!.body!;
      expect(body['title']).toBe('عقد — قديم');
      const data = body['data'] as Record<string, unknown>;
      expect(data['payments']).toEqual([
        { amount: '100', when: 'عند التوقيع', label: 'الدفعة الأولى' },
        { amount: '2005', when: 'عند الاستلام' },
      ]);
      expect(data).toMatchObject({ importCountry: 'اليابان', lateFee: '75' });
      expect(data).not.toHaveProperty('template');
      expect(data).not.toHaveProperty('contractNo');
    });
  });

  describe("the administrator's controls", () => {
    it('are over the extra fields in the form, for the administrator alone', async () => {
      boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      await formReady();
      expect(within(dialog()).getAllByRole('button', { name: 'Columns' })).toHaveLength(1);
      expect(within(dialog()).getAllByRole('button', { name: '+ Field' })).toHaveLength(1);
      expect(within(dialog()).getByText('Additional fields')).toBeTruthy();
      cleanup();
      boot('team');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      await formReady();
      expect(within(dialog()).queryByRole('button', { name: 'Columns' })).toBeNull();
      expect(within(dialog()).queryByRole('button', { name: '+ Field' })).toBeNull();
    });
    it('open the column editor once over the form (one dialog, which Escape puts away and leaves the form where it was)', async () => {
      boot('admin');
      await loaded();
      await userEvent.click(screen.getByRole('button', { name: /New contract/ }));
      await formReady();
      await userEvent.click(within(dialog()).getByRole('button', { name: '+ Field' }));
      await waitFor(() =>
        expect(document.querySelectorAll('[data-part=ceDialog]')).toHaveLength(1),
      );
      expect(document.querySelectorAll('[data-part=ceName]')).toHaveLength(1);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(document.querySelector('[data-part=ceDialog]')).toBeNull());
      expect(dialog()).not.toBeNull();
      expect(field('ct-buyer-name')).not.toBeNull();
    });
    it('draw the added fields from the columns arranged for them: a hidden one is not drawn but keeps its words, one renamed has its new name', async () => {
      const s = boot('admin', ALL, {
        docColumns: [
          ...DOC_COLUMNS.filter(c => c.key === 'status'),
          col('cf_ref', { label: 'Ref no.' }),
          col('cf_note', { label: 'Remark' }),
          col('cf_secret', { label: 'Internal', visible: false }),
        ],
      });
      await loaded();
      await userEvent.click(within(rows()[0]!).getByRole('button', { name: 'Edit' }));
      await formReady();
      const drawn = words(dialog().querySelector('[data-part=extrasGrid]')!);
      expect(drawn).toContain('Ref no.');
      expect(drawn).toContain('Remark');
      expect(drawn).not.toContain('Internal');
      expect(document.getElementById('ct-cf-cf_secret')).toBeNull();
      await userEvent.click(save());
      await waitFor(() => expect(lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')).toBeTruthy());
      const data = lastWrite(s.w, 'PUT', '/api/dashboard/contracts/1')!.body!['data'] as Record<
        string,
        unknown
      >;
      // (the hidden field, and the one that is no longer a column at all, keep what the contract had)
      expect(data['custom_fields']).toMatchObject({
        cf_ref: 'R-1',
        cf_secret: 'keep',
        cf_urgent: true,
      });
    });
  });
});
