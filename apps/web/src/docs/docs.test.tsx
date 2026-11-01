import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionValue } from '../app/context';
import type { Column, Columns } from '../columns';
import { Catalogue, offerLabel, offerMatches } from './Catalogue';
import { Extras } from './Extras';
import { Area, Field, Grid, Input, Lbl, Pick, StatusPick } from './Fields';
import { blobOf, downloadXlsx, pdfUrl } from './files';
import { LinesGrid, rowOf, type Row } from './Lines';
import { DocPage, Loading } from './Page';
import { useRows } from './useRows';
import { DocViewer, type Viewing } from './Viewer';
import type { Offer } from '../modules/suppliers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  document.documentElement.setAttribute('data-mode', 'dark');
});

const col = (key: string, over: Partial<Column> = {}): Column => ({
  key,
  label: key.toUpperCase(),
  type: 'text',
  builtin: true,
  visible: true,
  ...over,
});

/** A column engine that does nothing but remember what it was asked (the real one is held to its own tests). */
function fakeColumns(shown: Column[], over: Partial<Columns> = {}): Columns {
  return {
    entity: 'x',
    loaded: true,
    canEdit: false,
    all: shown,
    shown,
    col: (key: string) => shown.find(c => c.key === key),
    menu: null,
    dialog: null,
    openMenu: vi.fn(),
    openPicker: vi.fn(),
    openAdd: vi.fn(),
    openField: vi.fn(),
    openType: vi.fn(),
    openOptions: vi.fn(),
    closeMenu: vi.fn(),
    closeDialog: vi.fn(),
    setVisible: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    reorder: vi.fn(),
    hide: vi.fn(),
    remove: vi.fn(),
    saveNew: vi.fn(() => null),
    saveField: vi.fn(() => null),
    saveType: vi.fn(() => null),
    saveOptions: vi.fn(() => null),
    ...over,
  } as Columns;
}

const inSession = (portal: 'admin' | 'team', ui: ReactNode) => (
  <SessionContext value={{ portal } as unknown as SessionValue}>{ui}</SessionContext>
);

describe('the document viewer', () => {
  const noop = () => undefined;
  it('opens at once with the title and "Rendering PDF…", and says nothing of a frame yet', () => {
    render(
      <DocViewer viewing={{ state: 'loading', title: 'Purchase order PO-1' }} onClose={noop} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Purchase order PO-1' });
    expect(within(dialog).getByText('Purchase order PO-1')).toBeTruthy();
    expect(dialog.textContent).toContain('Rendering PDF…');
    expect(dialog.querySelector('iframe')).toBeNull();
  });
  it('shows what could not be made, in its words, where the PDF would be', () => {
    render(
      <DocViewer
        viewing={{ state: 'error', title: 'Purchase order', message: 'Failed to render' }}
        onClose={noop}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Could not render this document: Failed to render');
    expect(dialog.textContent).not.toContain('Rendering PDF…');
    expect(dialog.querySelector('iframe')).toBeNull();
  });
  it('shows the PDF in a frame, and no loader', () => {
    render(
      <DocViewer
        viewing={{
          state: 'ready',
          title: 'Purchase order PO-1',
          url: 'blob:abc',
          name: 'Purchase_order_PO-1',
        }}
        onClose={noop}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const frame = dialog.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe('blob:abc');
    expect(frame?.getAttribute('title')).toBe('Purchase order PO-1');
    expect(dialog.textContent).not.toContain('Rendering PDF…');
  });
  it('a title that is empty is "Document"', () => {
    render(<DocViewer viewing={{ state: 'loading', title: '' }} onClose={noop} />);
    expect(screen.getByRole('dialog').textContent).toContain('Document');
  });
  it('Download saves the PDF under its own name; before there is one it does nothing', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { rerender } = render(
      <DocViewer viewing={{ state: 'loading', title: 'x' }} onClose={noop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(click).not.toHaveBeenCalled();
    rerender(
      <DocViewer
        viewing={{ state: 'ready', title: 'x', url: 'blob:abc', name: 'PO_1' }}
        onClose={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Download/ }));
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('PO_1.pdf');
    expect(anchor.getAttribute('href')).toBe('blob:abc');
  });
  it('Close and Escape ask it to close; Escape goes no further (the form beneath stays)', async () => {
    const onClose = vi.fn();
    const beneath = vi.fn();
    document.addEventListener('keydown', beneath);
    render(<DocViewer viewing={{ state: 'loading', title: 'x' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(beneath).not.toHaveBeenCalled();
    document.removeEventListener('keydown', beneath);
  });
  it('is drawn over everything, on the page itself', () => {
    const { container } = render(
      <DocViewer viewing={{ state: 'loading', title: 'x' }} onClose={noop} />,
    );
    expect(container.querySelector('[data-part=docModal]')).toBeNull();
    expect(document.body.querySelector('[data-part=docModal]')).not.toBeNull();
  });
  const states: Viewing[] = [
    { state: 'loading', title: 'a' },
    { state: 'error', title: 'a', message: 'm' },
    { state: 'ready', title: 'a', url: 'u', name: 'n' },
  ];
  it.each(states)('is a dialog in every state (%o)', v => {
    render(<DocViewer viewing={v} onClose={noop} />);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });
});

describe('the files a document becomes', () => {
  it('a base64 answer is the bytes of a Blob of the kind it was', async () => {
    const blob = blobOf(btoa('%PDF-1.4'), 'application/pdf');
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(8);
    expect(await blob.text()).toBe('%PDF-1.4');
  });
  it('a PDF is an address a frame can show', () => {
    const create = vi.fn(() => 'blob:pdf');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create }));
    expect(pdfUrl(btoa('%PDF'))).toBe('blob:pdf');
    const made = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(made.type).toBe('application/pdf');
  });
  it('a workbook is saved as "RFQ_<name>.xlsx" and its address is given back ten seconds later', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:book');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    downloadXlsx(btoa('PK'), 'Yu Motors / Shanghai');
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('RFQ_Yu_Motors_Shanghai.xlsx');
    expect((create.mock.calls[0] as unknown as [Blob])[0].type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(document.body.contains(anchor)).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith('blob:book');
    vi.useRealTimers();
  });
  it('a workbook is in the page while it is handed over (some browsers save only a link that is there)', () => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:b', revokeObjectURL: vi.fn() }),
    );
    let attached = false;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      attached = document.body.contains(this);
    });
    downloadXlsx(btoa('PK'), 'x');
    expect(attached).toBe(true);
  });
  it('a workbook with no name is called after the company', () => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:b', revokeObjectURL: vi.fn() }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    downloadXlsx(btoa('PK'), '');
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('RFQ_motolinkers.xlsx');
  });
});

describe("the supplier catalogue's picker", () => {
  const offer = (id: number, over: Partial<Offer> = {}): Offer =>
    ({
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
      accessories: '',
      notes: '',
      custom_fields: {},
      supplier_name: 'Yu Motors',
      ...over,
    }) as Offer;
  const OFFERS = [
    offer(1),
    offer(2, {
      brand: 'Aion',
      model: 'Y',
      trim: '',
      model_year: null,
      fob_price: null,
      lead_time: '',
      supplier_name: 'Yu Motors',
    }),
    offer(3, {
      brand: 'Geely',
      model: 'Starray',
      trim: '',
      supplier_name: 'Gulf Auto',
      currency: '',
      fob_price: 21000,
      lead_time: '',
    }),
    offer(4, {
      brand: '',
      model: '',
      trim: '',
      supplier_name: 'Nobody',
      model_year: null,
      fob_price: null,
      lead_time: '',
    }),
  ];
  it('names a vehicle by its brand, model and trim (or says it has no name)', () => {
    expect(offerLabel(OFFERS[0]!)).toBe('BYD Seal Max');
    expect(offerLabel(OFFERS[1]!)).toBe('Aion Y');
    expect(offerLabel(OFFERS[3]!)).toBe('(unnamed)');
  });
  it('matches what was typed against the name or the supplier, in either case, ignoring the spaces around it', () => {
    expect(offerMatches(OFFERS[0]!, '')).toBe(true);
    expect(offerMatches(OFFERS[0]!, '   ')).toBe(true);
    expect(offerMatches(OFFERS[0]!, 'seal')).toBe(true);
    expect(offerMatches(OFFERS[0]!, ' BYD seal ')).toBe(true);
    expect(offerMatches(OFFERS[0]!, 'yu')).toBe(true);
    expect(offerMatches(OFFERS[2]!, 'yu')).toBe(false);
    expect(offerMatches(OFFERS[2]!, 'GULF')).toBe(true);
    expect(offerMatches(OFFERS[0]!, 'xyz')).toBe(false);
  });
  it('lists every vehicle, each with its year, supplier, price and lead time where it has them', () => {
    render(<Catalogue offers={OFFERS} onPick={vi.fn()} onClose={vi.fn()} />);
    const rows = document.body.querySelectorAll('[data-part=catRow]');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toBe(
      `BYD Seal Max · 2026Yu Motors · USD ${(32789).toLocaleString()} · 4 weeks`,
    );
    expect(rows[1]!.textContent).toBe('Aion YYu Motors');
    expect(rows[2]!.textContent).toBe(
      `Geely Starray · 2026Gulf Auto · USD ${(21000).toLocaleString()}`,
    );
    expect(rows[3]!.textContent).toBe('(unnamed)Nobody');
    expect(screen.getByText('Add from supplier catalogue')).toBeTruthy();
  });
  it('narrows as one types, and says when nothing matches', async () => {
    render(<Catalogue offers={OFFERS} onPick={vi.fn()} onClose={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText('Search brand, model or supplier…'), 'gulf');
    expect(document.body.querySelectorAll('[data-part=catRow]')).toHaveLength(1);
    await userEvent.clear(screen.getByPlaceholderText('Search brand, model or supplier…'));
    await userEvent.type(screen.getByPlaceholderText('Search brand, model or supplier…'), 'zzz');
    expect(document.body.querySelectorAll('[data-part=catRow]')).toHaveLength(0);
    expect(screen.getByText('Nothing matched that.')).toBeTruthy();
  });
  it("hands over the vehicles ticked, in the catalogue's order — and keeps a tick when the search moves on", async () => {
    const onPick = vi.fn();
    render(<Catalogue offers={OFFERS} onPick={onPick} onClose={vi.fn()} />);
    const tick = (name: RegExp) =>
      userEvent.click(within(screen.getByText(name).closest('label')!).getByRole('checkbox'));
    await tick(/Geely Starray/);
    await tick(/BYD Seal Max/);
    await userEvent.type(screen.getByPlaceholderText('Search brand, model or supplier…'), 'aion');
    await userEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect((onPick.mock.calls[0]![0] as Offer[]).map(o => o.id)).toEqual([1, 3]);
  });
  it('a tick taken back is not handed over', async () => {
    const onPick = vi.fn();
    render(<Catalogue offers={OFFERS} onPick={onPick} onClose={vi.fn()} />);
    const box = within(screen.getByText(/BYD Seal Max/).closest('label')!).getByRole('checkbox');
    await userEvent.click(box);
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(onPick).toHaveBeenCalledWith([]);
  });
  it('Cancel, the × and Escape ask it to close', async () => {
    const onClose = vi.fn();
    render(<Catalogue offers={OFFERS} onPick={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByTitle('Close'));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("a document's fields", () => {
  it('a caption sits over its control, spaced when it heads a block', () => {
    const { container } = render(
      <>
        <Field label="Date">
          <Input id="d" />
        </Field>
        <Lbl spaced>Supplier</Lbl>
      </>,
    );
    expect(container.querySelector('[data-part=field] > [data-part=lbl]')?.textContent).toBe(
      'Date',
    );
    const heading = [...container.querySelectorAll('[data-part=lbl]')].find(
      e => e.textContent === 'Supplier',
    )!;
    expect(heading.className).toContain('lblSpaced');
  });
  it('a row of fields fits as many to a line as the width allows (from the least a field is given)', () => {
    const { container } = render(
      <Grid min={160}>
        <span />
      </Grid>,
    );
    expect((container.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe(
      'repeat(auto-fit,minmax(160px,1fr))',
    );
  });
  it('a text box and a text area hold what they are given and hand over what is typed', async () => {
    const onInput = vi.fn();
    const onArea = vi.fn();
    render(
      <>
        <Input aria-label="one" value="a" onChange={e => onInput(e.target.value)} />
        <Area aria-label="two" value="b" rows={2} onChange={e => onArea(e.target.value)} />
      </>,
    );
    await userEvent.type(screen.getByLabelText('one'), 'x');
    await userEvent.type(screen.getByLabelText('two'), 'y');
    expect(onInput).toHaveBeenCalledWith('ax');
    expect(onArea).toHaveBeenCalledWith('by');
  });
  it('a dropdown is the branded one, and hands over the value picked', async () => {
    const onChange = vi.fn();
    render(
      <Pick
        id="p"
        value="b"
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Beta/ }));
    await userEvent.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(onChange).toHaveBeenCalledWith('a');
  });
  describe("the document's Status", () => {
    const status = (
      options = [
        { key: 'draft', label: 'Draft' },
        { key: 'sent', label: 'Sent' },
      ],
    ) => fakeColumns([col('status', { type: 'select', options })]);
    it('offers the options it has been left, and starts as the first when the document has no status', () => {
      render(<StatusPick id="s" columns={status()} value="" onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Draft/ })).toBeTruthy();
    });
    it('shows the stored status by its label', () => {
      render(<StatusPick id="s" columns={status()} value="sent" onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: /Sent/ })).toBeTruthy();
    });
    it('keeps a status whose option was deleted as one more choice (editing cannot change it quietly)', async () => {
      render(<StatusPick id="s" columns={status()} value="archived" onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: /archived/ })).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: /archived/ }));
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        'Draft',
        'Sent',
        'archived',
      ]);
    });
    it('hands over the key of the option picked', async () => {
      const onChange = vi.fn();
      render(<StatusPick id="s" columns={status()} value="draft" onChange={onChange} />);
      await userEvent.click(screen.getByRole('button', { name: /Draft/ }));
      await userEvent.click(screen.getByRole('option', { name: 'Sent' }));
      expect(onChange).toHaveBeenCalledWith('sent');
    });
    it('has nothing to offer a document whose status column has gone (and nothing to say about it)', () => {
      const { container } = render(
        <StatusPick id="s" columns={fakeColumns([])} value="" onChange={vi.fn()} />,
      );
      expect(container.querySelector('[role=option]')).toBeNull();
    });
  });
});

describe('the additional fields of a kind of document', () => {
  const EXTRAS = [
    col('status', { type: 'select', options: [{ key: 'draft', label: 'Draft' }] }),
    col('cf_ref', { builtin: false, label: 'Reference' }),
    col('cf_urgent', { builtin: false, type: 'checkbox', label: 'Urgent' }),
  ];
  it('shows each added field as the type it was given, with what the document holds', () => {
    render(
      <Extras
        columns={fakeColumns(EXTRAS)}
        values={{ cf_ref: 'R-1', cf_urgent: true }}
        onChange={vi.fn()}
        prefix="rfq"
      />,
    );
    expect(screen.getByText('Additional fields')).toBeTruthy();
    expect((screen.getByLabelText('Reference') as HTMLInputElement).value).toBe('R-1');
    expect((screen.getByLabelText(/Urgent/) as HTMLInputElement).checked).toBe(true);
    // (the status is the document's own, drawn at the top of the form, not here)
    expect(screen.queryByText('Draft')).toBeNull();
  });
  it('hands over each change, by field', async () => {
    const onChange = vi.fn();
    render(<Extras columns={fakeColumns(EXTRAS)} values={{}} onChange={onChange} prefix="po" />);
    await userEvent.type(screen.getByLabelText('Reference'), 'A');
    expect(onChange).toHaveBeenCalledWith('cf_ref', 'A');
    await userEvent.click(screen.getByLabelText(/Urgent/));
    expect(onChange).toHaveBeenCalledWith('cf_urgent', true);
  });
  it('gives two forms ids of their own', () => {
    render(<Extras columns={fakeColumns(EXTRAS)} values={{}} onChange={vi.fn()} prefix="rfq" />);
    expect(screen.getByLabelText('Reference').id).toBe('rfq-cf-cf_ref');
  });
  it('has no block at all for a document with no added fields and nobody to add one', () => {
    const { container } = render(
      <Extras columns={fakeColumns([EXTRAS[0]!])} values={{}} onChange={vi.fn()} prefix="rfq" />,
    );
    expect(container.firstChild).toBeNull();
  });
  it('says there are none, and how to add one, to the administrator (who has the way in)', () => {
    const columns = fakeColumns([EXTRAS[0]!], { canEdit: true });
    render(<Extras columns={columns} values={{}} onChange={vi.fn()} prefix="rfq" />);
    expect(
      screen.getByText(/None yet — "\+ Field" adds one to every document of this kind\./),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Field' }));
    expect(columns.openPicker).toHaveBeenCalledTimes(1);
    expect(columns.openAdd).toHaveBeenCalledTimes(1);
  });
  it('offers the way in beside the fields that are there, to the administrator alone', () => {
    const { rerender } = render(
      <Extras
        columns={fakeColumns(EXTRAS, { canEdit: true })}
        values={{}}
        onChange={vi.fn()}
        prefix="a"
      />,
    );
    expect(screen.getByRole('button', { name: '+ Field' })).toBeTruthy();
    rerender(
      <Extras
        columns={fakeColumns(EXTRAS, { canEdit: false })}
        values={{}}
        onChange={vi.fn()}
        prefix="a"
      />,
    );
    expect(screen.queryByRole('button', { name: '+ Field' })).toBeNull();
  });
  it('a hidden field is not drawn', () => {
    const columns = fakeColumns(
      [col('cf_ref', { builtin: false, label: 'Reference', visible: false })].filter(
        c => c.visible,
      ),
    );
    const { container } = render(
      <Extras columns={columns} values={{}} onChange={vi.fn()} prefix="a" />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('the lines of a document', () => {
  const COLUMNS = [
    col('brand', { label: 'BRAND', width: 90 }),
    col('units', { label: 'UNITS', type: 'number', width: 62 }),
    col('status', {
      label: 'STATUS',
      type: 'select',
      options: [
        { key: 'send_to_supplier', label: 'SEND TO SUPPLIER' },
        { key: 'delivered', label: 'Delivered' },
      ],
    }),
    col('cf_ok', { label: 'OK', type: 'checkbox', builtin: false }),
  ];
  it('a row starts with what the line holds in every column drawn', () => {
    const row = rowOf(
      3,
      { brand: 'BYD', units: 2, status: 'delivered', cf_ok: true, other: 'x' },
      COLUMNS,
    );
    expect(row).toEqual({
      id: 3,
      base: { brand: 'BYD', units: 2, status: 'delivered', cf_ok: true, other: 'x' },
      values: { brand: 'BYD', units: '2', status: 'delivered', cf_ok: true },
    });
  });
  it('…and a column the line has nothing in starts as it says (a status begins as the first of the options)', () => {
    const row = rowOf(1, { brand: 'BYD' }, COLUMNS, { status: 'send_to_supplier' });
    expect(row.values).toEqual({
      brand: 'BYD',
      units: '',
      status: 'send_to_supplier',
      cf_ok: false,
    });
    // (a line that has its own words is not given the start)
    expect(
      rowOf(1, { status: 'delivered' }, COLUMNS, { status: 'send_to_supplier' }).values['status'],
    ).toBe('delivered');
    // (nor is a line given a start for a column that is not drawn)
    expect(rowOf(1, {}, COLUMNS, { vin: 'x' }).values).not.toHaveProperty('vin');
  });
  function grid(rows: Row[], over: Partial<Parameters<typeof LinesGrid>[0]> = {}) {
    const change = vi.fn();
    const remove = vi.fn();
    const columns = fakeColumns(COLUMNS, { canEdit: true });
    const view = render(
      <LinesGrid
        columns={columns}
        rows={rows}
        change={change}
        remove={remove}
        number={{ label: 'No', width: 38 }}
        minWidth={1500}
        removeTitle="Remove line"
        {...over}
      />,
    );
    return { ...view, change, remove, columns };
  }
  const ROWS: Row[] = [
    {
      id: 11,
      base: { brand: 'BYD', hidden: 'keep' },
      values: { brand: 'BYD', units: '2', status: 'delivered', cf_ok: true },
    },
    {
      id: 12,
      base: {},
      values: { brand: '', units: '', status: 'send_to_supplier', cf_ok: false },
    },
  ];
  it('draws a number, the columns the administrator has shown, and a × for each line', () => {
    const { container } = grid(ROWS);
    const heads = [...container.querySelectorAll('thead th')].map(h => h.textContent);
    expect(heads).toEqual(['No', 'BRAND', 'UNITS', 'STATUS', 'OK', '']);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect([...rows].map(r => r.querySelector('[data-part=gridNumber]')?.textContent)).toEqual([
      '1',
      '2',
    ]);
    expect(screen.getAllByTitle('Remove line')).toHaveLength(2);
    expect((container.querySelector('table') as HTMLElement).style.minWidth).toBe('1500px');
  });
  it('the number column is as wide as it is told, and every other as the column says (90 where it says none)', () => {
    const { container } = grid(ROWS, { number: { label: '#', width: 34 } });
    const heads = [...container.querySelectorAll('thead th')] as HTMLElement[];
    expect(heads[0]!.textContent).toBe('#');
    expect(heads[0]!.style.width).toBe('34px');
    expect(heads[1]!.style.minWidth).toBe('90px');
    expect(heads[2]!.style.minWidth).toBe('62px');
    expect(heads[3]!.style.minWidth).toBe('90px');
    expect(heads[5]!.style.width).toBe('38px');
  });
  it('a cell shows what the form holds for the line, and hands each keystroke over', async () => {
    const { container, change } = grid(ROWS);
    const cells = container.querySelectorAll('tbody tr:nth-child(1) td');
    expect((cells[1]!.querySelector('input') as HTMLInputElement).value).toBe('BYD');
    expect((cells[2]!.querySelector('input') as HTMLInputElement).value).toBe('2');
    expect((cells[4]!.querySelector('input') as HTMLInputElement).checked).toBe(true);
    await userEvent.type(cells[1]!.querySelector('input')!, 'X');
    expect(change).toHaveBeenLastCalledWith(11, 'brand', 'BYDX');
    await userEvent.click(cells[4]!.querySelector('input')!);
    expect(change).toHaveBeenLastCalledWith(11, 'cf_ok', false);
  });
  it("a value the form has not got is the line's own (a column shown after the form opened)", () => {
    const { container } = grid([{ id: 1, base: { brand: 'Seal' }, values: {} }]);
    expect((container.querySelector('tbody td:nth-child(2) input') as HTMLInputElement).value).toBe(
      'Seal',
    );
  });
  it('a dropdown cell hands over the key of the option picked', async () => {
    const { container, change } = grid(ROWS);
    await userEvent.click(container.querySelector('tbody tr:nth-child(2) td:nth-child(4) button')!);
    await userEvent.click(screen.getByRole('option', { name: 'Delivered' }));
    expect(change).toHaveBeenLastCalledWith(12, 'status', 'delivered');
  });
  it('the × asks for that line to go, and no other', async () => {
    const { remove } = grid(ROWS);
    await userEvent.click(screen.getAllByTitle('Remove line')[1]!);
    expect(remove).toHaveBeenCalledWith(12);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('the administrator reaches the field menu from a heading; nobody else is offered it', () => {
    const { container, columns } = grid(ROWS);
    fireEvent.click(
      container.querySelectorAll('thead th')[1]!.querySelector('[data-part=chevron]')!,
    );
    expect(columns.openMenu).toHaveBeenCalledTimes(1);
    cleanup();
    const view = render(
      <LinesGrid
        columns={fakeColumns(COLUMNS, { canEdit: false })}
        rows={ROWS}
        change={vi.fn()}
        remove={vi.fn()}
        number={{ label: 'No', width: 38 }}
        minWidth={1500}
        removeTitle="Remove line"
      />,
    );
    expect(view.container.querySelector('[data-part=chevron]')).toBeNull();
  });
  it('a table with no lines is a head and nothing under it', () => {
    const { container } = grid([]);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(container.querySelectorAll('thead th')).toHaveLength(6);
  });
});

describe('the lines a form holds', () => {
  const SHOWN = [
    col('brand'),
    col('status', { type: 'select', options: [{ key: 'send_to_supplier', label: 'S' }] }),
  ];
  const STARTS = () => ({ status: 'send_to_supplier' });
  const hook = (lines: Record<string, unknown>[]) =>
    renderHook(() => useRows(lines, SHOWN, STARTS));
  it("starts as the document's lines", () => {
    const { result } = hook([{ brand: 'BYD' }, { brand: 'Aion', status: 'delivered' }]);
    expect(result.current.rows.map(r => r.values)).toEqual([
      { brand: 'BYD', status: 'send_to_supplier' },
      { brand: 'Aion', status: 'delivered' },
    ]);
    expect(result.current.rows.map(r => r.id)).toEqual([0, 1]);
  });
  it('starts as one empty line where the document has none', () => {
    const { result } = hook([]);
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]!.values).toEqual({ brand: '', status: 'send_to_supplier' });
  });
  it('a change is to that line alone', () => {
    const { result } = hook([{ brand: 'BYD' }, { brand: 'Aion' }]);
    act(() => result.current.change(1, 'brand', 'Aion Y'));
    expect(result.current.rows.map(r => r.values['brand'])).toEqual(['BYD', 'Aion Y']);
    expect(result.current.rows[0]!.base).toEqual({ brand: 'BYD' });
  });
  it('a line is added empty, or from what it is given (with its own words kept as the line)', () => {
    const { result } = hook([{ brand: 'BYD' }]);
    act(() => result.current.add());
    act(() => result.current.add({ brand: 'Geely', year: 2026 }));
    expect(result.current.rows.map(r => r.values['brand'])).toEqual(['BYD', '', 'Geely']);
    expect(result.current.rows[2]!.base).toEqual({ brand: 'Geely', year: 2026 });
    expect(result.current.rows.map(r => r.id)).toEqual([0, 1, 2]);
  });
  it('a line taken away takes its place and no other; the next added line is a new one, not the one that went', () => {
    const { result } = hook([{ brand: 'A' }, { brand: 'B' }, { brand: 'C' }]);
    act(() => result.current.remove(1));
    expect(result.current.rows.map(r => r.values['brand'])).toEqual(['A', 'C']);
    act(() => result.current.add({ brand: 'D' }));
    expect(result.current.rows.map(r => r.id)).toEqual([0, 2, 3]);
  });
  it('starts with one empty line where there are none, and with none where the form says it wants none until one is asked for', () => {
    expect(hook([]).result.current.rows.length).toBe(1);
    const none = renderHook(() => useRows([], SHOWN, STARTS, true));
    expect(none.result.current.rows).toEqual([]);
    act(() => none.result.current.add());
    expect(none.result.current.rows.map(r => r.id)).toEqual([0]);
    // (a form that opens on lines it has begins with them, either way)
    const some = renderHook(() => useRows([{ brand: 'BYD' }], SHOWN, STARTS, true));
    expect(some.result.current.rows.map(r => r.values['brand'])).toEqual(['BYD']);
  });
  it('can be taken down to no lines at all', () => {
    const { result } = hook([{ brand: 'A' }]);
    act(() => result.current.remove(0));
    expect(result.current.rows).toEqual([]);
  });
  it('a line made from the catalogue gets the start for a status it has none of', () => {
    const { result } = hook([]);
    act(() => result.current.add({ brand: 'BYD' }));
    expect(result.current.rows[1]!.values['status']).toBe('send_to_supplier');
  });
  it('asks the starts when a line is made (the options may have changed since the form opened)', () => {
    let first = 'a';
    const starts = vi.fn(() => ({ status: first }));
    const { result } = renderHook(() => {
      const stable = useCallback(starts, []);
      return useRows([], SHOWN, stable);
    });
    first = 'b';
    act(() => result.current.add());
    expect(result.current.rows[1]!.values['status']).toBe('b');
  });
});

describe('the page around a list', () => {
  it("the admin's has a header with the title and the button, then a hint and the list", () => {
    const onAdd = vi.fn();
    const { container } = render(
      inSession(
        'admin',
        <DocPage
          screen="rfq"
          title="RFQ"
          hint="Hint words"
          add={{ label: 'New RFQ', onClick: onAdd }}
          sheets={<i data-testid="sheets" />}
        >
          <p>the list</p>
        </DocPage>,
      ),
    );
    const head = container.querySelector('[data-part=pageHead]')!;
    expect(head.querySelector('[data-part=pageTitle]')?.textContent).toBe('RFQ');
    fireEvent.click(head.querySelector('[data-part=add]')!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    const body = container.querySelector('[data-part=pageBody]')!;
    expect(body.querySelector('[data-part=pageHint]')?.textContent).toBe('Hint words');
    expect(body.querySelector('[data-part=list]')?.textContent).toBe('the list');
    expect(screen.getByTestId('sheets')).toBeTruthy();
  });
  it("the team's has a title and hint on the left and the button on the right", () => {
    const { container } = render(
      inSession(
        'team',
        <DocPage
          screen="rfq"
          title="Purchase Orders"
          hint="Hint"
          add={{ label: 'New purchase order', onClick: vi.fn() }}
          sheets={null}
        >
          <p>the list</p>
        </DocPage>,
      ),
    );
    expect(container.querySelector('[data-part=pageBody]')).toBeNull();
    const head = container.querySelector('[data-part=pageHead]')!;
    expect(head.querySelector('[data-part=pageTitle]')?.textContent).toBe('Purchase Orders');
    expect(head.querySelector('[data-part=pageHint]')?.textContent).toBe('Hint');
    expect(head.querySelector('[data-part=add]')?.textContent).toContain('New purchase order');
    expect(container.querySelector('[data-part=list]')?.textContent).toBe('the list');
  });
  it.each(['admin', 'team'] as const)(
    'draws no button for one who may not make a document (%s)',
    portal => {
      const { container } = render(
        inSession(
          portal,
          <DocPage screen="rfq" title="RFQ" hint="h" add={null} sheets={null}>
            x
          </DocPage>,
        ),
      );
      expect(container.querySelector('[data-part=add]')).toBeNull();
      expect(container.querySelector('[data-part=docPage]')).not.toBeNull();
    },
  );
  it("the loader is a block in the admin's page and a line in the team's", () => {
    const admin = render(inSession('admin', <Loading what="RFQs" />));
    expect(admin.container.textContent).toContain('Loading RFQs…');
    expect(admin.container.querySelector('div > div')).not.toBeNull();
    cleanup();
    const team = render(inSession('team', <Loading what="purchase orders" />));
    expect(team.container.textContent).toContain('Loading purchase orders…');
    expect(team.container.querySelector('span')).not.toBeNull();
  });
});
