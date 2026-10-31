import { schemas } from '@motolinker/contracts';
import { STOCK_UNIT_FIELDS } from '@motolinker/contracts/logistics';
import { afterEach, describe, expect, it } from 'vitest';
import type { ColumnOption } from '../../columns';
import {
  bySupplier,
  cardsOf,
  cellText,
  egp,
  isBulkResult,
  isUnit,
  isVehicle,
  isVehicleList,
  lanesOf,
  legacyOf,
  matching,
  nameOf,
  priceOf,
  problemWith,
  rowsOf,
  saveView,
  savedView,
  statusMeta,
  statusOptions,
  STOCK_COLUMNS,
  summaryOf,
  swatch,
  thousands,
  unitsOf,
  VIEW_KEY,
  withoutVin,
  type Vehicle,
} from './model';
import { oneAtATime } from '../../test/wrongly';

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
const vehicle = (id: number, over: Record<string, unknown> = {}): Vehicle =>
  ({
    id,
    make: 'BYD',
    model: 'Seal',
    trim: '',
    price: 0,
    quantity: 0,
    units: [],
    notes: '',
    legacy_count: null,
    ...over,
  }) as Vehicle;

const OPTIONS: ColumnOption[] = [
  { key: 'a', label: 'Alpha', color: '#112233' },
  { key: 'b', label: 'Beta' },
];

/** The guards are the schemas' (the bundle does not carry zod): each agrees with its schema on what it is shown. */
describe('the guards of the Models tab agree with the contract’s schemas', () => {
  const same = (
    guard: (v: unknown) => boolean,
    schema: { safeParse: (v: unknown) => { success: boolean } },
    v: unknown,
  ) => expect(guard(v), JSON.stringify(v)?.slice(0, 90)).toBe(schema.safeParse(v).success);

  it('for a car', () => {
    for (const v of [
      unit(),
      {},
      { vin: 'V1', cf_plate: 'ABC', price_list: '1,000' },
      { vin: 1 },
      { price_list: null },
      { discounted: [] },
      { colour: null },
      null,
      [],
      'x',
    ])
      same(isUnit, schemas.StockUnit, v);
  });

  it('for a model, and a list of them', () => {
    for (const v of [
      vehicle(1),
      vehicle(2, { units: [unit({ vin: 'V' })], legacy_count: 3 }),
      vehicle(3, { units: null }),
      vehicle(4, { trim: null, price: null, notes: null }),
      vehicle(5, { price: '1,950,000' }),
      { ...vehicle(6), units: undefined, legacy_count: undefined },
      { ...vehicle(7), created_by: null, created_at: '2026-09-01T00:00:00Z' },
      vehicle(8, { id: '8' }),
      vehicle(9, { make: null }),
      vehicle(10, { quantity: 'two' }),
      vehicle(11, { units: [{ vin: 7 }] }),
      vehicle(12, { legacy_count: 'x' }),
      { id: 1, make: 'A', model: 'B' },
      null,
      [],
    ])
      same(isVehicle, schemas.StockVehicle, v);
    expect(isVehicleList([vehicle(1), vehicle(2)])).toBe(true);
    expect(isVehicleList([vehicle(1), { id: 'x' }])).toBe(false);
    expect(isVehicleList({})).toBe(false);
  });

  it('for a car, and for a model, a field at a time: each field wrong in each way, and each left out', () => {
    const car = unit({ vin: 'V', colour: 'Red', price_list: 5, cf_plate: 'ABC' });
    const model = {
      ...vehicle(1, {
        trim: 'Design',
        price: 1950000,
        notes: 'n',
        legacy_count: 2,
        units: [car],
      }),
      created_by: 'dashboard',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-02T00:00:00Z',
    };
    for (const v of oneAtATime(car)) same(isUnit, schemas.StockUnit, v);
    for (const v of oneAtATime(model)) same(isVehicle, schemas.StockVehicle, v);
    for (const v of oneAtATime({ inserted: 2, errors: ['Row 3: Make is required'] }))
      same(isBulkResult, schemas.StockBulkResult, v);
  });

  it('for what a CSV upload answers', () => {
    for (const v of [
      { inserted: 2, errors: [] },
      { inserted: 0, errors: ['Row 2: Make is required'] },
      { inserted: 1.5, errors: [] },
      { inserted: 1 },
      { inserted: 1, errors: [3] },
      {},
    ])
      same(isBulkResult, schemas.StockBulkResult, v);
  });
});

describe('the columns a car starts with', () => {
  it('are the contract’s eight, with the two numbers and the Status a dropdown of the four statuses', () => {
    expect(STOCK_COLUMNS.map(c => [c.key, c.label, c.width])).toEqual(
      STOCK_UNIT_FIELDS.map(f => [...f]),
    );
    expect(STOCK_COLUMNS.filter(c => c.type === 'number').map(c => c.key)).toEqual([
      'price_list',
      'discounted',
    ]);
    const status = STOCK_COLUMNS.find(c => c.key === 'status')!;
    expect(status.type).toBe('select');
    expect(status.options?.map(o => o.key)).toEqual([
      'send_to_supplier',
      'in_preparation',
      'in_logistics',
      'delivered',
    ]);
    expect(status.options?.[2]).toEqual({
      key: 'in_logistics',
      label: 'In Logistics',
      color: '#8a5a00',
    });
    expect(STOCK_COLUMNS.every(c => c.builtin && c.visible)).toBe(true);
  });
  it('give their status options while the column is shown, and the four it starts with otherwise', () => {
    expect(statusOptions([{ ...STOCK_COLUMNS[3]!, options: OPTIONS }])).toEqual(OPTIONS);
    expect(statusOptions(STOCK_COLUMNS.filter(c => c.key !== 'status')).map(o => o.key)).toEqual([
      'send_to_supplier',
      'in_preparation',
      'in_logistics',
      'delivered',
    ]);
    expect(statusOptions([{ ...STOCK_COLUMNS[3]!, options: undefined as never }]).length).toBe(4);
  });
});

describe('how the register is read', () => {
  it('writes a status in its words and colour; a status the list lacks as it is, and none as “Unassigned”', () => {
    expect(statusMeta(OPTIONS, 'a')).toEqual({ label: 'Alpha', color: '#112233' });
    expect(statusMeta(OPTIONS, 'b')).toEqual({ label: 'Beta', color: 'var(--muted)' });
    expect(statusMeta(OPTIONS, 'gone')).toEqual({ label: 'gone', color: 'var(--muted)' });
    expect(statusMeta(OPTIONS, '')).toEqual({ label: 'Unassigned', color: 'var(--muted)' });
    expect(statusMeta(OPTIONS, undefined).label).toBe('Unassigned');
  });
  it('gives a colour name its paint, and a name it does not know a neutral chip', () => {
    expect(swatch('Obsidian Black')).toBe('#1c1c1f');
    expect(swatch('White / Black')).toBe('#1c1c1f'); // (the first to match: black comes before white)
    expect(swatch('Mineral White')).toBe('#f2f0ea');
    expect(swatch('Pearl')).toBe('#f2f0ea');
    expect(swatch('Silver')).toBe('#b9b3a4');
    expect(swatch('Grey')).toBe('#b9b3a4');
    expect(swatch('Denim')).toBe('#5a78c8');
    expect(swatch('Rosso')).toBe('#ef4444');
    expect(swatch('Green')).toBe('#10b981');
    expect(swatch('Bronze')).toBe('#c98b5e');
    expect(swatch('Magenta')).toBe('rgba(255,255,255,.25)');
    expect(swatch(null)).toBe('rgba(255,255,255,.25)');
  });
  it('knows every name the classic page painted, in any case', () => {
    const paints: [string, string[]][] = [
      ['#1c1c1f', ['black', 'OBSIDIAN', 'Raven', 'attitude']],
      ['#f2f0ea', ['white', 'Mineral', 'CARRARA', 'eminent', 'Pearl']],
      ['#b9b3a4', ['silver', 'Grey', 'GRAY']],
      ['#5a78c8', ['blue', 'Navarra', 'DENIM']],
      ['#ef4444', ['red', 'Rosso']],
      ['#10b981', ['green']],
      ['#c98b5e', ['brown', 'Bronze', 'BEIGE']],
    ];
    for (const [paint, names] of paints)
      for (const name of names) expect(swatch(name), name).toBe(paint);
    expect(swatch('Sunburst Orange')).toBe('rgba(255,255,255,.25)');
    expect(swatch('')).toBe('rgba(255,255,255,.25)');
  });
  it('writes figures with their thousands, and money in pounds', () => {
    expect(thousands(1950000)).toBe('1,950,000');
    expect(thousands('1500')).toBe('1,500');
    expect(thousands('x')).toBe('0');
    expect(egp(2250000)).toBe('2,250,000 EGP');
    expect(egp(null)).toBe('0 EGP');
  });
  it('reads a cell as the column says: a number with its thousands, a tick, else the words or a dash', () => {
    expect(cellText({ type: 'number' }, 1200)).toBe('1,200');
    expect(cellText({ type: 'number' }, 0)).toBe('—');
    expect(cellText({ type: 'number' }, 'x')).toBe('—');
    expect(cellText({ type: 'checkbox' }, true)).toBe('✓');
    expect(cellText({ type: 'checkbox' }, 'true')).toBe('✓');
    expect(cellText({ type: 'checkbox' }, false)).toBe('—');
    expect(cellText({ type: 'text' }, '')).toBe('—');
    expect(cellText({ type: 'text' }, null)).toBe('—');
    expect(cellText({ type: 'text' }, 'Hany')).toBe('Hany');
    expect(cellText({ type: 'text' }, 0)).toBe('0');
  });
  it('names a model for the question before it is deleted', () => {
    expect(nameOf(vehicle(1, { make: 'BYD', model: 'Seal', trim: 'Design' }))).toBe(
      'BYD Seal Design',
    );
    expect(nameOf(vehicle(1, { trim: null }))).toBe('BYD Seal');
    expect(nameOf(undefined)).toBe('this vehicle');
  });
  it('needs a make and a model, both after trimming', () => {
    expect(problemWith({ make: 'A', model: 'B' })).toBeNull();
    expect(problemWith({ make: ' ', model: 'B' })).toBe('Make and Model are required.');
    expect(problemWith({ make: 'A', model: '' })).toBe('Make and Model are required.');
  });
});

describe('the figures over the register', () => {
  const V = [
    vehicle(1, {
      make: 'BYD',
      model: 'Seal',
      trim: 'Design',
      price: 1000,
      units: [
        unit({ vin: 'V1', status: 'a', price_list: 900, supplier: 'Zed' }),
        unit({ vin: 'V2', status: 'a', supplier: 'Alpha' }),
        unit({ vin: '', status: 'b', colour: 'Red' }),
      ],
    }),
    vehicle(2, {
      make: 'byd',
      model: 'SEAL',
      trim: 'Excellence',
      price: 500,
      units: [unit({ vin: 'V3', status: 'gone', price_list: 50 })],
    }),
    vehicle(3, { make: 'Toyota', model: 'Corolla', legacy_count: 4 }),
    vehicle(4, { make: 'Kia', model: 'Rio', legacy_count: 2, units: [unit({ status: '' })] }),
  ];
  it('counts the cars, the models (a make and model once, trims not told apart), the value and the cars nobody named', () => {
    const s = summaryOf(V, OPTIONS);
    expect(s.total).toBe(5);
    expect(s.models).toBe(3);
    // 900 (its own) + 1000 (the model's) + 1000 (the model's) + 50 + 0 (a car with no price, in a model with none)
    expect(s.value).toBe(2950);
    expect(s.legacy).toBe(4); // (the model with cars has none of its own to count)
  });
  it('divides the cars by status, in the order of the options, those with none left out, “Unassigned” last', () => {
    const s = summaryOf(V, OPTIONS);
    expect(s.segments).toEqual([
      { label: 'Alpha', n: 2, color: '#112233' },
      { label: 'Beta', n: 1, color: 'var(--muted)' },
      { label: 'Unassigned', n: 1, color: 'var(--muted)' },
    ]);
    expect(summaryOf([], OPTIONS)).toEqual({
      total: 0,
      models: 0,
      value: 0,
      legacy: 0,
      segments: [],
    });
  });
  it('knows which cars a model holds, what a car is worth, and what an older save counted', () => {
    expect(unitsOf(V[2]!)).toEqual([]);
    expect(unitsOf({ ...V[2]!, units: null } as Vehicle)).toEqual([]);
    expect(rowsOf(V).map(r => [r.v.id, r.at])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [4, 0],
    ]);
    expect(priceOf(rowsOf(V)[0]!)).toBe(900);
    expect(priceOf(rowsOf(V)[1]!)).toBe(1000);
    expect(legacyOf(V[2]!)).toBe(4);
    expect(legacyOf(V[3]!)).toBe(0);
    expect(legacyOf(vehicle(9, { legacy_count: 'x' }))).toBe(0);
    expect(withoutVin(V[0]!)).toBe(1);
    expect(withoutVin(vehicle(9, { units: [unit({ vin: '   ' }), unit({ vin: 'V' })] }))).toBe(1); // (blanks are no VIN)
  });
  it('narrows the cars by a search over make, model, trim and VIN, and by a status exactly', () => {
    const rows = rowsOf(V);
    expect(matching(rows, '', '').length).toBe(5);
    expect(matching(rows, 'excellence', '').map(r => r.u.vin)).toEqual(['V3']);
    expect(matching(rows, ' SEAL ', '').length).toBe(4);
    expect(matching(rows, 'v2', '').length).toBe(1);
    expect(matching(rows, 'v2 ', '').length).toBe(1); // (the words typed are trimmed: the VIN ends the line it is searched in)
    expect(matching(rows, '', 'on')).toEqual([]); // (a status is the whole key: “on” is in “gone” and is not it)
    expect(matching(rows, '', 'gone').length).toBe(1);
    expect(matching(rows, '', 'a').length).toBe(2);
    expect(matching(rows, 'seal', 'b').map(r => r.u.colour)).toEqual(['Red']);
    expect(matching(rows, 'nothing', '')).toEqual([]);
  });
  it('writes a lane’s share as a whole percent of the cars shown, rounded', () => {
    const three = rowsOf([
      vehicle(1, { units: [unit({ status: 'a' }), unit({ status: 'a' }), unit({ status: 'b' })] }),
    ]);
    expect(lanesOf(three, OPTIONS).map(l => [l.key, l.share])).toEqual([
      ['a', 67],
      ['b', 33],
    ]);
  });
  it('puts a car with no status at all, not only an empty one, in the lane for none', () => {
    const rows = rowsOf([vehicle(1, { units: [{ ...unit(), status: undefined } as never] })]);
    expect(lanesOf(rows, OPTIONS).map(l => [l.key, l.rows.length])).toEqual([
      ['a', 0],
      ['b', 0],
      ['', 1],
    ]);
  });
  it('groups the cars by supplier, the names in order, those with none together', () => {
    const groups = bySupplier(rowsOf(V));
    expect(groups.map(([n, l]) => [n, l.length])).toEqual([
      ['Alpha', 1],
      ['No supplier', 3],
      ['Zed', 1],
    ]);
  });
  it('makes a lane for each status, then one for the cars with none — only where there are some', () => {
    const lanes = lanesOf(rowsOf(V), OPTIONS);
    // (a car whose status the list lacks is in no lane, though it is counted in the total the shares are of)
    expect(lanes.map(l => [l.key, l.rows.length, l.value, l.share])).toEqual([
      ['a', 2, 1900, 40],
      ['b', 1, 1000, 20],
      ['', 1, 0, 20],
    ]);
    expect(
      lanesOf(
        rowsOf(V).filter(r => r.u.status === 'a'),
        OPTIONS,
      ).map(l => l.key),
    ).toEqual(['a', 'b']);
    expect(lanesOf([], OPTIONS).map(l => [l.key, l.share])).toEqual([
      ['a', 0],
      ['b', 0],
    ]);
  });
  it('keeps a model whose words match the search even when none of its cars do, and drops it when a status leaves none of its cars', () => {
    const rows = rowsOf(V);
    expect(cardsOf(V, matching(rows, 'corolla', ''), 'corolla', '').map(v => v.id)).toEqual([3]);
    expect(cardsOf(V, matching(rows, '', 'a'), '', 'a').map(v => v.id)).toEqual([1]);
    expect(cardsOf(V, matching(rows, 'v3', ''), 'v3', '').map(v => v.id)).toEqual([2]);
    expect(cardsOf(V, rows, '', '').length).toBe(4);
    // (the words typed are trimmed here too)
    expect(cardsOf(V, matching(rows, 'excellence ', ''), 'excellence ', '').map(v => v.id)).toEqual(
      [2],
    );
  });
});

describe('the view that is remembered', () => {
  afterEach(() => localStorage.clear());
  it('is All vehicles until another is chosen, and is kept for the next visit', () => {
    expect(savedView()).toBe('all');
    saveView('status');
    expect(localStorage.getItem(VIEW_KEY)).toBe('status');
    expect(savedView()).toBe('status');
    saveView('model');
    expect(savedView()).toBe('model');
    localStorage.setItem(VIEW_KEY, 'nonsense');
    expect(savedView()).toBe('all');
  });
});
