import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, json } from '../test/helpers';
import { open, type Answer } from '../test/session';
import type { Column } from './model';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ml_sup_view', 'table');
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

const col = (key: string, over: Partial<Column> = {}): Column => ({
  key,
  label: key,
  type: 'text',
  builtin: false,
  visible: true,
  ...over,
});
const START: Column[] = [
  col('name', { label: 'Name', builtin: true, width: 140 }),
  col('contact', { label: 'Contact', builtin: true }),
  col('country', {
    label: 'Country',
    builtin: true,
    type: 'select',
    options: [
      { key: 'cn', label: 'China', color: '#dc2626' },
      { key: 'jp', label: 'Japan' },
    ],
  }),
  col('address', { label: 'Address', builtin: true, visible: false }),
  col('notes', { label: 'Notes', builtin: true }),
  col('cf_vip', { label: 'VIP', type: 'checkbox' }),
];

/** An administrator's session whose server holds this arrangement; what was saved is kept, so a screen can be reopened on it. */
function boot(initial: Column[] | null = START, over: Record<string, Answer> = {}) {
  const state = { columns: initial as Column[] | null, saved: [] as Column[][], failing: false };
  const columns: Answer = init => {
    if (init.method === 'PUT') {
      if (state.failing) return json(500, { error: 'no' });
      const body = JSON.parse(String(init.body)) as { columns: Column[] };
      state.saved.push(body.columns);
      state.columns = body.columns;
      return json(200, { ok: true, columns: body.columns });
    }
    return json(200, { columns: state.columns, entity: 'suppliers' });
  };
  const s = open('admin', adminMe(), {
    entries: ['/suppliers'],
    more: {
      '/api/dashboard/suppliers': () =>
        json(200, [
          {
            id: 1,
            name: 'Yu Motors',
            contact: 'yu@example.com',
            address: 'Shanghai',
            country: 'cn',
            notes: '',
            custom_fields: { cf_vip: true },
          },
        ]),
      '/api/dashboard/supplier-vehicles': () => json(200, []),
      '/api/dashboard/stock': () => json(200, []),
      '/api/dashboard/columns/suppliers': columns,
      '/api/dashboard/suppliers/1/vehicles': () => json(200, []),
      '/api/dashboard/columns/supplier_vehicles': () =>
        json(200, { columns: null, entity: 'supplier_vehicles' }),
      ...over,
    },
  });
  return { ...s, state };
}

const heads = () =>
  [...document.querySelectorAll('[data-part=headRow] > th')].map(e => e.textContent?.trim());
const chevron = (label: string) =>
  within(screen.getAllByText(label, { selector: 'th' })[0]!).getByRole('button');
const menu = () => document.querySelector('[data-part=colMenu]') as HTMLElement | null;
const items = () => [...(menu()?.querySelectorAll('button') ?? [])].map(b => b.textContent?.trim());
const table = async () => screen.findByRole('table');
const lastSaved = (s: { state: { saved: Column[][] } }) => s.state.saved.at(-1)!;
const find = (cols: Column[], key: string) => cols.find(c => c.key === key)!;

describe("a column's menu", () => {
  it('opens at the pointer, kept inside the window, and offers what can be done to this column', async () => {
    const user = userEvent.setup();
    boot();
    await table();
    fireEvent.click(chevron('Name'), { clientX: 1000, clientY: 760 });
    const box = menu()!;
    expect(box.style.left).toBe(`${window.innerWidth - 230}px`);
    expect(box.style.top).toBe(`${window.innerHeight - 60}px`);
    expect(items()).toEqual([
      'Edit field…',
      'Rename',
      'Change type',
      'Move left',
      'Move right',
      'Hide column',
      'Delete column',
    ]);
    expect((screen.getByRole('button', { name: 'Move left' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Move right' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
    fireEvent.click(chevron('Country'), { clientX: 100, clientY: 100 });
    expect(menu()!.style.left).toBe('100px');
    expect(menu()!.style.top).toBe('106px');
    expect(items()).toEqual([
      'Edit field…',
      'Rename',
      'Change type',
      'Edit options',
      'Move left',
      'Move right',
      'Hide column',
      'Delete column',
    ]);
    fireEvent.click(chevron('VIP'));
    expect((screen.getByRole('button', { name: 'Move right' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(menu()).toBeTruthy();
    // a second menu replaces the first, and a press elsewhere puts it away
    expect(document.querySelectorAll('[data-part=colMenu]').length).toBe(1);
    await user.click(document.body);
    expect(menu()).toBeNull();
  });

  it('is not offered Edit field or Change type for a column that is calculated (a virtual one)', async () => {
    boot([...START, col('cf_calc', { label: 'Owner', type: 'virtual' })]);
    await table();
    fireEvent.click(chevron('Owner'));
    expect(items()).toEqual(['Rename', 'Move left', 'Move right', 'Hide column', 'Delete column']);
  });

  it('renames what the person typed (a blank name or cancelling changes nothing)', async () => {
    const user = userEvent.setup();
    const s = boot();
    await table();
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    fireEvent.click(chevron('Name'));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(prompt).toHaveBeenCalledWith('Column name', 'Name');
    expect(menu()).toBeNull();
    expect(s.state.saved.length).toBe(0);
    prompt.mockReturnValue('   ');
    fireEvent.click(chevron('Name'));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(s.state.saved.length).toBe(0);
    prompt.mockReturnValue('  Maker  ');
    fireEvent.click(chevron('Name'));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(find(lastSaved(s), 'name').label).toBe('Maker'));
    expect(heads()[0]).toBe('Maker');
  });

  it('moves a column among those that are shown, and saves the whole list in its new order', async () => {
    const user = userEvent.setup();
    const s = boot();
    await table();
    fireEvent.click(chevron('Contact'));
    await user.click(screen.getByRole('button', { name: 'Move right' }));
    await waitFor(() =>
      expect(lastSaved(s).map(c => c.key)).toEqual([
        'name',
        'country',
        'contact',
        'address',
        'notes',
        'cf_vip',
      ]),
    );
    expect(heads().slice(0, 3)).toEqual(['Name', 'Country', 'Contact']);
    fireEvent.click(chevron('Notes'));
    await user.click(screen.getByRole('button', { name: 'Move left' }));
    // (the hidden Address is passed over: Notes takes the place of the shown column before it, Contact)
    await waitFor(() =>
      expect(lastSaved(s).map(c => c.key)).toEqual([
        'name',
        'country',
        'notes',
        'contact',
        'address',
        'cf_vip',
      ]),
    );
  });

  it('hides a column (kept in the list, shown nowhere)', async () => {
    const user = userEvent.setup();
    const s = boot();
    await table();
    fireEvent.click(chevron('Notes'));
    await user.click(screen.getByRole('button', { name: 'Hide column' }));
    await waitFor(() => expect(find(lastSaved(s), 'notes').visible).toBe(false));
    expect(heads()).not.toContain('Notes');
    expect(lastSaved(s).length).toBe(START.length);
  });

  it("deletes after asking: a field somebody added is gone, one of the register's own is marked so reading the list does not bring it back", async () => {
    const user = userEvent.setup();
    const s = boot();
    await table();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(chevron('VIP'));
    await user.click(screen.getByRole('button', { name: 'Delete column' }));
    expect(confirm).toHaveBeenCalledWith(
      'Delete column "VIP"? Saved values stay on the records but won\'t be shown.',
    );
    expect(s.state.saved.length).toBe(0);
    confirm.mockReturnValue(true);
    fireEvent.click(chevron('VIP'));
    await user.click(screen.getByRole('button', { name: 'Delete column' }));
    await waitFor(() => expect(lastSaved(s).some(c => c.key === 'cf_vip')).toBe(false));
    fireEvent.click(chevron('Notes'));
    await user.click(screen.getByRole('button', { name: 'Delete column' }));
    await waitFor(() =>
      expect(find(lastSaved(s), 'notes')).toMatchObject({ deleted: true, visible: false }),
    );
  });
});

describe('the Columns list', () => {
  it('lists every column that is not deleted (the hidden ones dimmed), and shows and hides them without closing', async () => {
    const user = userEvent.setup();
    const s = boot([
      ...START,
      col('old', { label: 'Old', builtin: true, deleted: true, visible: false }),
    ]);
    await table();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    const rows = [...document.querySelectorAll('[data-part=pickRow]')];
    expect(rows.map(r => r.textContent?.trim())).toEqual([
      'Name',
      'Contact',
      'Country',
      'Address',
      'Notes',
      'VIP',
    ]);
    expect(
      within(rows[3] as HTMLElement).getByRole('button', { name: 'Address' }).className,
    ).toMatch(/colHidden/);
    await user.click(within(rows[3] as HTMLElement).getByRole('button', { name: 'Address' }));
    await waitFor(() => expect(find(lastSaved(s), 'address').visible).toBe(true));
    expect(menu()).toBeTruthy();
    expect(heads()).toContain('Address');
    await user.click(
      within(document.querySelectorAll('[data-part=pickRow]')[0] as HTMLElement).getByRole(
        'button',
        { name: 'Name' },
      ),
    );
    await waitFor(() => expect(find(lastSaved(s), 'name').visible).toBe(false));
    expect(menu()).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(menu()).toBeNull();
  });

  it("opens a field's editor from its pencil, and the add dialog from Add field", async () => {
    const user = userEvent.setup();
    boot();
    await table();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(
      within(document.querySelectorAll('[data-part=pickRow]')[2] as HTMLElement).getByTitle(
        'Edit field — type, options, colors',
      ),
    );
    expect(menu()).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Edit Field — Country' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    expect(await screen.findByRole('dialog', { name: 'Add Column' })).toBeTruthy();
  });

  it('gives a calculated column no pencil', async () => {
    const user = userEvent.setup();
    boot([...START, col('cf_calc', { label: 'Owner', type: 'virtual' })]);
    await table();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(document.querySelectorAll('[data-part=pickEdit]').length).toBe(START.length);
    expect(
      [...document.querySelectorAll('[data-part=pickRow]')]
        .find(r => r.textContent?.includes('Owner'))
        ?.querySelector('[data-part=pickEdit]'),
    ).toBeNull();
  });
});

describe("the editor's dialogs", () => {
  const dialog = () => screen.getByRole('dialog');
  const alert = () => vi.spyOn(window, 'alert').mockImplementation(() => undefined);

  it('adds a field: it asks for a name, and for options where there are choices, then keeps it with a key made of its name', async () => {
    const user = userEvent.setup();
    const said = alert();
    const s = boot();
    await table();
    await user.click(screen.getByRole('button', { name: '+ Field' }));
    expect(within(dialog()).getByText('Add Column')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    expect(said).toHaveBeenLastCalledWith('Column name is required.');
    await user.type(screen.getByPlaceholderText('e.g. Insurance status'), 'Credit grade');
    expect(document.querySelector('[data-part=ceOptions]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dropdown' }));
    expect(screen.getByRole('button', { name: 'Dropdown' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    expect(said).toHaveBeenLastCalledWith('Add at least one option (one per line).');
    await user.type(
      document.querySelector('[data-part=ceOptions]') as HTMLElement,
      'Prime{Enter}Standard{Enter}{Enter}Risky',
    );
    await user.click(screen.getByLabelText(/Required in forms/));
    await user.type(document.querySelector('[data-part=ceWidth]') as HTMLElement, '120');
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const added = find(lastSaved(s), 'cf_credit_grade');
    expect(added).toMatchObject({
      label: 'Credit grade',
      type: 'select',
      builtin: false,
      visible: true,
      required: true,
      width: 120,
    });
    expect(added.options?.map(o => o.key)).toEqual(['prime', 'standard', 'risky']);
    expect(lastSaved(s).at(-1)?.key).toBe('cf_credit_grade');
    expect(heads()).toContain('Credit grade');
  });

  it('numbers a field whose key is taken, and drops a width that is not a width', async () => {
    const user = userEvent.setup();
    const s = boot([...START, col('cf_vip_2', { label: 'x' })]);
    await table();
    await user.click(screen.getByRole('button', { name: '+ Field' }));
    await user.type(screen.getByPlaceholderText('e.g. Insurance status'), 'VIP');
    await user.type(document.querySelector('[data-part=ceWidth]') as HTMLElement, '39');
    await user.click(screen.getByRole('button', { name: 'Add column' }));
    await waitFor(() => expect(s.state.saved.length).toBe(1));
    const added = lastSaved(s).at(-1)!;
    expect(added.key).toBe('cf_vip_3');
    expect(added.width).toBeUndefined();
  });

  it('edits a field whole: its name, type, options with their colours, whether forms require it and its width — keeping the key of an option whose name changed', async () => {
    const user = userEvent.setup();
    const said = alert();
    const s = boot();
    await table();
    fireEvent.click(chevron('Country'));
    await user.click(screen.getByRole('button', { name: 'Edit field…' }));
    expect(within(dialog()).getByText('Edit Field — Country')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dropdown' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const rows = () => [...document.querySelectorAll('[data-part=ceOptRow]')] as HTMLElement[];
    expect(rows().length).toBe(2);
    expect((rows()[0]!.querySelector('[data-part=ceOptColor]') as HTMLInputElement).value).toBe(
      '#dc2626',
    );
    expect((rows()[1]!.querySelector('[data-part=ceOptColor]') as HTMLInputElement).value).toBe(
      '#8a8f98',
    );
    await user.clear(rows()[1]!.querySelector('input') as HTMLElement);
    await user.type(rows()[1]!.querySelector('input') as HTMLElement, 'Nippon');
    fireEvent.input(rows()[1]!.querySelector('[data-part=ceOptColor]') as HTMLElement, {
      target: { value: '#12ab34' },
    });
    await user.click(screen.getByRole('button', { name: '+ Add option' }));
    await user.keyboard('Korea');
    await user.type(document.querySelector('[data-part=ceWidth]') as HTMLElement, '200');
    await user.click(screen.getByLabelText(/Required in forms/));
    await user.click(screen.getByRole('button', { name: 'Save field' }));
    await waitFor(() => expect(s.state.saved.length).toBe(1));
    const saved = find(lastSaved(s), 'country');
    expect(saved.options).toEqual([
      { key: 'cn', label: 'China', color: '#dc2626' },
      { key: 'jp', label: 'Nippon', color: '#12ab34' },
      { key: 'korea', label: 'Korea' },
    ]);
    expect(saved).toMatchObject({ required: true, width: 200, type: 'select' });
    expect(said).not.toHaveBeenCalled();
  });

  it('refuses a field with no name, and a dropdown with no options, in the classic words', async () => {
    const user = userEvent.setup();
    const said = alert();
    const s = boot();
    await table();
    fireEvent.click(chevron('Country'));
    await user.click(screen.getByRole('button', { name: 'Edit field…' }));
    await user.clear(screen.getByDisplayValue('Country'));
    await user.click(screen.getByRole('button', { name: 'Save field' }));
    expect(said).toHaveBeenLastCalledWith('Field name is required.');
    await user.type(document.querySelector('[data-part=ceName]') as HTMLElement, 'Land');
    for (const x of document.querySelectorAll('[data-part=ceOptRemove]'))
      await user.click(x as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Save field' }));
    expect(said).toHaveBeenLastCalledWith('Add at least one option.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(s.state.saved.length).toBe(0);
  });

  it('gives a field that is made a dropdown its first empty option, and takes the options away from one that is made text', async () => {
    const user = userEvent.setup();
    const s = boot();
    await table();
    fireEvent.click(chevron('Contact'));
    await user.click(screen.getByRole('button', { name: 'Edit field…' }));
    expect(document.querySelector('[data-part=ceOptionsWrap]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Radio' }));
    expect(document.querySelectorAll('[data-part=ceOptRow]').length).toBe(1);
    expect(document.activeElement?.getAttribute('placeholder')).toBe('Option label');
    await user.click(screen.getByRole('button', { name: 'Text' }));
    expect(document.querySelector('[data-part=ceOptionsWrap]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save field' }));
    await waitFor(() => expect(s.state.saved.length).toBe(1));
    expect(find(lastSaved(s), 'contact').options).toBeUndefined();
  });

  it("changes a type alone: the chips start where the classic dialog starts them, and a dropdown's options are typed one to a line", async () => {
    const user = userEvent.setup();
    const said = alert();
    const s = boot();
    await table();
    fireEvent.click(chevron('Country'));
    await user.click(screen.getByRole('button', { name: 'Change type' }));
    expect(screen.getByRole('button', { name: 'Dropdown' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const lines = document.querySelector('[data-part=ceOptions]') as HTMLTextAreaElement;
    expect(lines.value).toBe('China\nJapan');
    await user.clear(lines);
    await user.type(lines, 'China{Enter}Korea');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.state.saved.length).toBe(1));
    expect(find(lastSaved(s), 'country').options).toEqual([
      { key: 'cn', label: 'China', color: '#dc2626' },
      { key: 'korea', label: 'Korea' },
    ]);
    fireEvent.click(chevron('Country'));
    await user.click(screen.getByRole('button', { name: 'Change type' }));
    await user.click(screen.getByRole('button', { name: 'Checkbox' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.state.saved.length).toBe(2));
    expect(find(lastSaved(s), 'country')).toMatchObject({ type: 'checkbox' });
    expect(find(lastSaved(s), 'country').options).toBeUndefined();
    fireEvent.click(chevron('Name'));
    await user.click(screen.getByRole('button', { name: 'Change type' }));
    expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Dropdown' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(said).toHaveBeenLastCalledWith('Add at least one option (one per line).');
  });

  it('edits the options alone, and keeps at least one', async () => {
    const user = userEvent.setup();
    const said = alert();
    const s = boot();
    await table();
    fireEvent.click(chevron('Country'));
    await user.click(screen.getByRole('button', { name: 'Edit options' }));
    for (const x of document.querySelectorAll('[data-part=ceOptRemove]'))
      await user.click(x as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Save options' }));
    expect(said).toHaveBeenLastCalledWith('Keep at least one option.');
    expect(s.state.saved.length).toBe(0);
    await user.click(screen.getByRole('button', { name: '+ Add option' }));
    await user.keyboard('Only');
    await user.click(screen.getByRole('button', { name: 'Save options' }));
    await waitFor(() => expect(s.state.saved.length).toBe(1));
    expect(find(lastSaved(s), 'country').options).toEqual([{ key: 'only', label: 'Only' }]);
  });

  it('closes by Escape, the ×, Cancel and a press on the curtain — and focus starts on the first field and stays among these', async () => {
    const user = userEvent.setup();
    boot();
    await table();
    const addField = async () => {
      await user.click(screen.getByRole('button', { name: '+ Field' }));
      await screen.findByRole('dialog');
    };
    await addField();
    expect(document.activeElement).toBe(document.querySelector('[data-part=ceName]'));
    await user.tab({ shift: true });
    expect(dialog().contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 12; i++) await user.tab();
    expect(dialog().contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await addField();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await addField();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await addField();
    await user.click(document.querySelector('[data-part=ceCurtain]') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    await addField();
    await user.click(dialog());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it("takes Escape for itself over another dialog: the supplier's sheet stays open", async () => {
    const user = userEvent.setup();
    boot();
    await table();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');
    await screen.findByText(/Nothing listed yet/);
    await user.click(
      within(document.querySelector('[data-part=vehicleBar]') as HTMLElement).getByRole('button', {
        name: '+ Field',
      }),
    );
    expect(screen.getAllByRole('dialog').length).toBe(2);
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('dialog').length).toBe(1);
    expect(document.querySelector('[data-part=dialog] [data-part=pane]')).toBeTruthy();
  });
});

describe('what a person sees of a column', () => {
  it("draws a dropdown's value as a badge in the colour of its option, a box as a tick, and only a real web address as a link", async () => {
    boot(
      [
        col('name', { label: 'Name', builtin: true }),
        col('cf_vip', { label: 'VIP', type: 'checkbox' }),
        col('cf_site', { label: 'Website', type: 'link' }),
        col('country', {
          label: 'Country',
          builtin: true,
          type: 'select',
          options: [{ key: 'cn', label: 'China', color: '#dc2626' }],
        }),
      ],
      {
        '/api/dashboard/suppliers': () =>
          json(200, [
            {
              id: 1,
              name: 'A',
              contact: '',
              address: '',
              country: 'cn',
              notes: '',
              custom_fields: { cf_vip: true, cf_site: 'example.com/files/price list.pdf' },
            },
            {
              id: 2,
              name: 'B',
              contact: '',
              address: '',
              country: 'zz',
              notes: '',
              custom_fields: { cf_vip: 'true', cf_site: 'javascript:alert(1)' },
            },
            {
              id: 3,
              name: 'C',
              contact: '',
              address: '',
              country: '',
              notes: '',
              custom_fields: { cf_vip: false, cf_site: '' },
            },
          ]),
      },
    );
    await table();
    const row = (n: string) => screen.getByText(n, { selector: 'td' }).closest('tr') as HTMLElement;
    const link = within(row('A')).getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.com/files/price%20list.pdf');
    expect(link.textContent).toBe('price list.pdf');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(within(row('A')).getByText('✓')).toBeTruthy();
    expect(within(row('A')).getByText('China').getAttribute('style')).toContain('--ce-c: #dc2626');
    expect(within(row('B')).queryByRole('link')).toBeNull();
    expect(within(row('B')).getByText('javascript:alert(1)')).toBeTruthy();
    expect(within(row('B')).getByText('zz').getAttribute('style')).toBeNull();
    expect(within(row('B')).getByText('✓')).toBeTruthy();
    expect(within(row('C')).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

describe('keeping the arrangement', () => {
  it('says so when the server will not keep a change, and asks again for the list the server has', async () => {
    const user = userEvent.setup();
    const s = boot();
    await table();
    s.state.failing = true;
    fireEvent.click(chevron('Notes'));
    await user.click(screen.getByRole('button', { name: 'Hide column' }));
    expect(
      await screen.findByText(
        'Could not save the columns. The list shown is the one on the server.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(heads()).toContain('Notes'));
    expect(
      s.calls('/api/dashboard/columns/suppliers').filter(c => c.init.method === 'PUT').length,
    ).toBe(1);
  });

  it('reads the list again each time the screen opens, so a layout somebody else changed is the one shown', async () => {
    const s = boot();
    await table();
    expect(heads()).toContain('VIP');
    s.state.columns = START.filter(c => c.key !== 'cf_vip');
    cleanup();
    const t = boot(s.state.columns);
    await table();
    expect(heads()).not.toContain('VIP');
    t.unmount();
  });
});
