import contracts from '@motolinker/contracts';
import {
  DOC_STATUS_COLORS,
  PO_LINE_FIELDS,
  PO_LINE_STATUSES,
  PO_STATUSES,
  RFQ_LINE_FIELDS,
  RFQ_STATUSES,
} from '@motolinker/contracts/documents';
import { describe, expect, it } from 'vitest';
import {
  cellOf,
  DOC_ICONS,
  docStatusColumn,
  fileName,
  isLeadList,
  isPdf,
  isPo,
  isPoDefaults,
  isPoList,
  isRfq,
  isRfqDefaults,
  isRfqList,
  isXlsx,
  lineTotal,
  PO_LINE_COLUMNS,
  poLineFilled,
  RFQ_LINE_COLUMNS,
  rfqLineFilled,
  savedLines,
  thousands,
  titleOf,
  whenOf,
} from './model';
import type { Column } from '../columns';

const S = contracts.schemas;

const rfq = (over: Record<string, unknown> = {}) => ({
  id: 4,
  rfq_no: 'MT26W036Y26',
  title: 'Yu Motors — 1 vehicle(s)',
  supplier_id: 1,
  supplier_name: 'Yu Motors',
  supplier_contact: 'yu@example.com',
  supplier_address: 'Shanghai',
  supplier_country: 'China',
  issuer: 'Admin',
  rfq_date: '2026-09-02',
  status: 'sent',
  customer_id: null,
  payment_terms: '30% deposit',
  delivery_location: 'Alexandria',
  service_provider: 'Maersk',
  contact: 'ops@example.com',
  documents_required: 'B/L',
  custom_fields: { cf_ref: 'R-1' },
  items: [{ brand: 'BYD', model: 'Seal' }],
  created_by: 'admin',
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
  ...over,
});
const po = (over: Record<string, unknown> = {}) => ({
  id: 9,
  po_number: 'PO2026-0001',
  title: 'Yu Motors — 1 vehicle(s)',
  supplier: 'Yu Motors',
  po_date: '2026-09-03',
  currency: 'USD',
  status: 'confirmed',
  customer_id: 3,
  items: [{ client: 'Ali', units: 2, pi_price: 31000 }],
  created_by: 'admin',
  created_at: '2026-09-01T10:00:00Z',
  notes: 'Ship together',
  supplier_id: 1,
  supplier_contact: 'yu@example.com',
  supplier_address: 'Shanghai',
  supplier_country: 'China',
  issuer: 'Admin',
  quote_id: 'MT26W036Y26',
  incoterm: 'CIF',
  delivery_location: 'Alexandria',
  service_provider: '',
  contact: '',
  documents_required: '',
  payment_terms: '',
  custom_fields: {},
  updated_at: null,
  ...over,
});

describe('the answers the document screens accept', () => {
  // The bundle does not carry zod; these tables are what keep each hand-written check honest against the schema.
  const rfqs: Array<[string, unknown]> = [
    ['an RFQ', rfq()],
    [
      'one with nothing filled in (every text column is null)',
      rfq({
        supplier_id: null,
        supplier_name: null,
        supplier_contact: null,
        supplier_address: null,
        supplier_country: null,
        issuer: null,
        rfq_date: null,
        payment_terms: null,
        delivery_location: null,
        service_provider: null,
        contact: null,
        documents_required: null,
        created_by: null,
        created_at: null,
      }),
    ],
    ['one with no added fields (migration 012 never ran)', rfq({ custom_fields: undefined })],
    ['one whose added fields are null', rfq({ custom_fields: null })],
    ['one with no update time', rfq({ updated_at: undefined })],
    ['one with a null update time', rfq({ updated_at: null })],
    [
      'lines that are free records',
      rfq({ items: [{ brand: 'X', cf_grade: 'a', fob_price: 3 }, {}] }),
    ],
    ['no lines at all', rfq({ items: [] })],
    ['a lead', rfq({ customer_id: 12 })],
    ['no id', rfq({ id: undefined })],
    ['a fractional id', rfq({ id: 1.5 })],
    ['a numeric number', rfq({ rfq_no: 7 })],
    ['no title', rfq({ title: undefined })],
    ['a missing status', rfq({ status: undefined })],
    ['a null status', rfq({ status: null })],
    ['lines that are not a list', rfq({ items: {} })],
    ['a line that is text', rfq({ items: ['BYD'] })],
    ['a line that is a list', rfq({ items: [[]] })],
    ['a lead that is text', rfq({ customer_id: '12' })],
    ['a supplier id that is text', rfq({ supplier_id: '1' })],
    ['added fields that are a list', rfq({ custom_fields: [] })],
    ['a numeric issuer', rfq({ issuer: 5 })],
    ['a missing supplier name', rfq({ supplier_name: undefined })],
    ['not an object', 'rfq'],
    ['null', null],
  ];
  it.each(rfqs)('%s: the check and the schema agree', (_n, v) => {
    expect(isRfq(v)).toBe(S.Rfq.safeParse(v).success);
  });
  it('a list of RFQs is a list of rows (what a list needs of each)', () => {
    for (const v of [
      [rfq()],
      [],
      [rfq(), rfq({ id: 5 })],
      [rfq(), 'x'],
      [rfq({ items: 3 })],
      {},
      null,
    ]) {
      expect(isRfqList(v)).toBe(S.RfqList.safeParse(v).success);
    }
    // (a row of the list does not carry the supplier block, and is none the worse for it)
    const row = Object.fromEntries(
      Object.entries(rfq()).filter(([k]) => S.RfqRow.shape[k as keyof typeof S.RfqRow.shape]),
    );
    expect(isRfqList([row])).toBe(true);
    expect(S.RfqList.safeParse([row]).success).toBe(true);
  });

  const rfqDefaults = (over: Record<string, unknown> = {}) => ({
    rfq_no: 'MT26W040Y26',
    rfq_date: '2026-10-31',
    items: [{}, {}, {}, {}, {}, {}, {}, {}],
    payment_terms: '30% advance',
    documents_required: 'Bill of lading',
    customer_id: null,
    ...over,
  });
  it.each<[string, unknown]>([
    ['the starting form of a new RFQ', rfqDefaults()],
    ['…made for a lead', rfqDefaults({ customer_id: 5 })],
    ['no number', rfqDefaults({ rfq_no: undefined })],
    ['no date', rfqDefaults({ rfq_date: undefined })],
    ['a null date', rfqDefaults({ rfq_date: null })],
    ['no lines', rfqDefaults({ items: undefined })],
    ['no standing words', rfqDefaults({ payment_terms: undefined })],
    ['null standing words', rfqDefaults({ documents_required: null })],
    ['no lead entry', rfqDefaults({ customer_id: undefined })],
    ['a lead that is text', rfqDefaults({ customer_id: '5' })],
    ['a list', []],
    ['null', null],
  ])('%s: the check and the schema agree', (_n, v) => {
    expect(isRfqDefaults(v)).toBe(S.RfqDefaults.safeParse(v).success);
  });

  const orders: Array<[string, unknown]> = [
    ['a purchase order', po()],
    [
      'one the letterhead fields came too late for (a database without them)',
      {
        ...po(),
        supplier_id: undefined,
        supplier_contact: undefined,
        supplier_address: undefined,
        supplier_country: undefined,
        issuer: undefined,
        quote_id: undefined,
        incoterm: undefined,
        delivery_location: undefined,
        service_provider: undefined,
        contact: undefined,
        documents_required: undefined,
        payment_terms: undefined,
        updated_at: undefined,
      },
    ],
    [
      'one with null letterhead fields',
      po({
        supplier_contact: null,
        issuer: null,
        incoterm: null,
        quote_id: null,
        supplier_id: null,
      }),
    ],
    [
      'one with null words',
      po({ supplier: null, po_date: null, notes: null, created_by: null, created_at: null }),
    ],
    ['one with no added fields', po({ custom_fields: undefined })],
    ['one with null added fields', po({ custom_fields: null })],
    ['no notes entry', po({ notes: undefined })],
    ['a null currency', po({ currency: null })],
    ['no currency', po({ currency: undefined })],
    ['no number', po({ po_number: undefined })],
    ['a numeric number', po({ po_number: 7 })],
    ['no title', po({ title: undefined })],
    ['lines that are not a list', po({ items: 'none' })],
    ['a lead that is text', po({ customer_id: '3' })],
    ['a supplier id that is text', po({ supplier_id: '1' })],
    ['a numeric quote id', po({ quote_id: 5 })],
    ['a numeric incoterm', po({ incoterm: 5 })],
    ['a numeric delivery place', po({ delivery_location: 5 })],
    ['a numeric update time', po({ updated_at: 5 })],
    ['added fields that are a list', po({ custom_fields: [] })],
    ['null', null],
  ];
  it.each(orders)('%s: the check and the schema agree', (_n, v) => {
    expect(isPo(v)).toBe(S.Po.safeParse(v).success);
  });
  it('a list of purchase orders is a list of rows', () => {
    for (const v of [
      [po()],
      [],
      [po(), po({ id: 10 })],
      [po(), 3],
      [po({ currency: undefined })],
      {},
      null,
    ]) {
      expect(isPoList(v)).toBe(S.PoList.safeParse(v).success);
    }
  });

  const poDefaults = (over: Record<string, unknown> = {}) => ({
    po_number: 'PO2610-8247',
    po_date: '2026-10-31',
    currency: 'USD',
    items: [{}],
    customer_id: null,
    ...over,
  });
  it.each<[string, unknown]>([
    ['the starting form of a new purchase order', poDefaults()],
    ['…made for a lead', poDefaults({ customer_id: 4 })],
    ['no number', poDefaults({ po_number: undefined })],
    ['no date', poDefaults({ po_date: undefined })],
    ['a null date', poDefaults({ po_date: null })],
    ['no currency', poDefaults({ currency: undefined })],
    ['no lines', poDefaults({ items: undefined })],
    ['a lead that is text', poDefaults({ customer_id: '4' })],
    ['null', null],
  ])('%s: the check and the schema agree', (_n, v) => {
    expect(isPoDefaults(v)).toBe(S.PoDefaults.safeParse(v).success);
  });

  it('a workbook has its file and a name, a PDF its file and (for a saved order) a name', () => {
    for (const v of [
      { xlsx: 'UEs=', name: 'Yu' },
      { xlsx: 'UEs=' },
      { name: 'Yu' },
      { xlsx: 1, name: 'Yu' },
      null,
      'x',
    ]) {
      expect(isXlsx(v)).toBe(S.RfqXlsx.safeParse(v).success);
    }
    for (const v of [
      { pdf: 'JVBER' },
      { pdf: 'JVBER', name: 'PO-1' },
      { pdf: 'JVBER', name: 3 },
      { name: 'PO-1' },
      { pdf: 3 },
      null,
      [],
    ]) {
      expect(isPdf(v)).toBe(S.PoPdf.safeParse(v).success);
    }
  });

  it('a list of leads is a list of people with an id and a name (and whatever else their row holds)', () => {
    for (const v of [
      [{ id: 1, name: 'Ali', phone: '+971' }],
      [{ id: 1, name: null }],
      [{ id: 1, name: 'Ali', phone: null, lead_status: 'hot', budget: 5 }],
      [{ id: 1, name: 'Ali' }],
      [{ id: 1.5, name: 'Ali' }],
      [{ id: '1', name: 'Ali' }],
      [{ name: 'Ali' }],
      [{ id: 1, name: 5 }],
      [{ id: 1, name: 'Ali', phone: 5 }],
      [],
      [3],
      {},
      null,
    ]) {
      expect(isLeadList(v)).toBe(S.LeadOptionList.safeParse(v).success);
    }
  });
});

describe('the columns a document and its lines start with', () => {
  it("a document's Status is a dropdown of its kind's statuses, each in the colour it starts with", () => {
    const rfqStatus = docStatusColumn(RFQ_STATUSES);
    expect(rfqStatus).toMatchObject({
      key: 'status',
      label: 'Status',
      type: 'select',
      builtin: true,
      visible: true,
    });
    expect(rfqStatus.options?.map(o => o.key)).toEqual(['draft', 'sent', 'answered', 'closed']);
    expect(rfqStatus.options?.map(o => o.label)).toEqual(['Draft', 'Sent', 'Answered', 'Closed']);
    expect(rfqStatus.options?.map(o => o.color)).toEqual([
      DOC_STATUS_COLORS.draft,
      DOC_STATUS_COLORS.sent,
      DOC_STATUS_COLORS.answered,
      DOC_STATUS_COLORS.closed,
    ]);
    expect(docStatusColumn(PO_STATUSES).options?.map(o => o.key)).toEqual([
      'draft',
      'sent',
      'confirmed',
      'closed',
    ]);
  });
  it('a status with no colour of its own is drawn with none (not with an undefined one)', () => {
    const column = docStatusColumn([
      ['draft', 'Draft'],
      ['mystery', 'Mystery'],
    ]);
    expect(column.options?.[0]).toEqual({
      key: 'draft',
      label: 'Draft',
      color: DOC_STATUS_COLORS.draft,
    });
    expect(column.options?.[1]).toEqual({ key: 'mystery', label: 'Mystery' });
    expect('color' in (column.options?.[1] ?? {})).toBe(false);
  });
  it("an RFQ's lines are the nine fields of the contract, in its order, with the two prices as numbers", () => {
    expect(RFQ_LINE_COLUMNS.map(c => [c.key, c.label, c.width])).toEqual(
      RFQ_LINE_FIELDS.map(([k, l, w]) => [k, l, w]),
    );
    expect(RFQ_LINE_COLUMNS.filter(c => c.type === 'number').map(c => c.key)).toEqual([
      'fob_price',
      'cif_price',
    ]);
    expect(RFQ_LINE_COLUMNS.every(c => c.builtin && c.visible)).toBe(true);
  });
  it("a purchase order's lines are the fourteen of the contract; units and price are numbers and Status is a dropdown of where the line is", () => {
    expect(PO_LINE_COLUMNS.map(c => [c.key, c.label, c.width])).toEqual(
      PO_LINE_FIELDS.map(([k, l, w]) => [k, l, w]),
    );
    expect(PO_LINE_COLUMNS.filter(c => c.type === 'number').map(c => c.key)).toEqual([
      'units',
      'pi_price',
    ]);
    const status = PO_LINE_COLUMNS.find(c => c.key === 'status');
    expect(status?.type).toBe('select');
    expect(status?.options).toEqual(
      PO_LINE_STATUSES.map(s => ({ key: s.key, label: s.label, color: s.fg })),
    );
    expect(PO_LINE_COLUMNS.filter(c => c.type === 'select').map(c => c.key)).toEqual(['status']);
  });
  it('names the icons the screens draw', () => {
    expect(DOC_ICONS).toEqual({
      add: 'plus',
      file: 'file-text',
      download: 'download',
      catalogue: 'list-plus',
    });
  });
});

describe('what the classic page worked out for itself', () => {
  it("a purchase order's total is what each line is worth for each of its units (one, where it says none)", () => {
    expect(lineTotal([])).toBe(0);
    expect(lineTotal([{ pi_price: 100, units: 3 }])).toBe(300);
    expect(lineTotal([{ pi_price: 100 }])).toBe(100);
    expect(lineTotal([{ pi_price: '100', units: '3' }])).toBe(300);
    expect(lineTotal([{ pi_price: 'x', units: 3 }])).toBe(0);
    expect(lineTotal([{ pi_price: 50, units: 0 }])).toBe(50);
    expect(
      lineTotal([
        { pi_price: 50, units: '' },
        { pi_price: 10, units: 2 },
      ]),
    ).toBe(70);
    expect(lineTotal([{}])).toBe(0);
  });
  it("shows a figure with its thousands separated, in the browser's own way", () => {
    expect(thousands(62000)).toBe((62000).toLocaleString());
    expect(thousands('1500')).toBe((1500).toLocaleString());
    expect(thousands('x')).toBe('0');
    expect(thousands(null)).toBe('0');
    expect(thousands(undefined)).toBe('0');
  });
  it('an RFQ line counts when it names a vehicle: a brand, a model or a trim', () => {
    expect(rfqLineFilled({ brand: 'BYD' })).toBe(true);
    expect(rfqLineFilled({ model: 'Seal' })).toBe(true);
    expect(rfqLineFilled({ trim: 'Max' })).toBe(true);
    expect(rfqLineFilled({ colour: 'White', year: 2026, accessories: 'mats' })).toBe(false);
    expect(rfqLineFilled({})).toBe(false);
    expect(rfqLineFilled({ brand: '', model: '', trim: '' })).toBe(false);
  });
  it('a purchase-order line counts when it names a client, a brand, a model or a VIN (a trim alone is not enough)', () => {
    expect(poLineFilled({ client: 'Ali' })).toBe(true);
    expect(poLineFilled({ brand: 'BYD' })).toBe(true);
    expect(poLineFilled({ model: 'Seal' })).toBe(true);
    expect(poLineFilled({ vin: 'V1' })).toBe(true);
    expect(poLineFilled({ trim: 'Max' })).toBe(false);
    expect(poLineFilled({ units: 2, pi_price: 5 })).toBe(false);
    expect(poLineFilled({})).toBe(false);
  });
  const text: Column = { key: 'brand', label: 'Brand', type: 'text', builtin: true, visible: true };
  const box: Column = {
    key: 'cf_ok',
    label: 'OK',
    type: 'checkbox',
    builtin: false,
    visible: true,
  };
  it("a grid cell starts with the line's own words (a checkbox is ticked or not; nothing is an empty box)", () => {
    expect(cellOf({ brand: 'BYD' }, text)).toBe('BYD');
    expect(cellOf({ brand: 5 }, text)).toBe('5');
    expect(cellOf({}, text)).toBe('');
    expect(cellOf({ brand: null }, text)).toBe('');
    expect(cellOf({ cf_ok: true }, box)).toBe(true);
    expect(cellOf({ cf_ok: 'true' }, box)).toBe(true);
    expect(cellOf({ cf_ok: 1 }, box)).toBe(true);
    expect(cellOf({ cf_ok: 'no' }, box)).toBe(false);
    expect(cellOf({}, box)).toBe(false);
  });
  it('the lines a form saves are what each was with what the grid shows put over it — a hidden column keeps its words', () => {
    const was: Record<string, string | boolean>[] = [
      { brand: 'BYD', cf_secret: 'keep', model: 'Seal' },
      { brand: 'Aion' },
    ];
    const edited: Record<string, string | boolean>[] = [
      { brand: 'BYD Auto', model: 'Seal' },
      { brand: 'Aion', model: 'Y' },
      { brand: 'New' },
    ];
    expect(savedLines(was, edited)).toEqual([
      { brand: 'BYD Auto', cf_secret: 'keep', model: 'Seal' },
      { brand: 'Aion', model: 'Y' },
      { brand: 'New' },
    ]);
    expect(savedLines(was, [])).toEqual([]);
    expect(savedLines([], [{ a: true }])).toEqual([{ a: true }]);
  });
  it('a document is saved under who it goes to and how many vehicles it asks for', () => {
    expect(titleOf('Yu Motors', 'RFQ', 2)).toBe('Yu Motors — 2 vehicle(s)');
    expect(titleOf('', 'RFQ', 1)).toBe('RFQ — 1 vehicle(s)');
    expect(titleOf('', 'PO', 0)).toBe('PO — 0 vehicle(s)');
  });
  it('a file name is safe to give a file', () => {
    expect(fileName('Purchase order PO2026-0001')).toBe('Purchase_order_PO2026-0001');
    expect(fileName('a/b\\c:d*e?f')).toBe('a_b_c_d_e_f');
    expect(fileName('ok.name-1_x')).toBe('ok.name-1_x');
    expect(fileName('')).toBe('');
  });
  it("a date is the document's own, else the day it was made (in this browser's way), else nothing", () => {
    expect(whenOf('2026-09-02', '2026-09-01T10:00:00Z')).toBe('2026-09-02');
    expect(whenOf(null, '2026-09-01T10:00:00Z')).toBe(
      new Date('2026-09-01T10:00:00Z').toLocaleDateString(),
    );
    expect(whenOf('', '2026-09-01T10:00:00Z')).toBe(
      new Date('2026-09-01T10:00:00Z').toLocaleDateString(),
    );
    expect(whenOf(null, null)).toBe('');
    expect(whenOf(null, 'not a date')).toBe('');
  });
});
