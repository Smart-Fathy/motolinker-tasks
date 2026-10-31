import contracts from '@motolinker/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cardFigures,
  carOf,
  countLine,
  initials,
  isDocList,
  isOffer,
  isOfferList,
  isPurchases,
  isSupplier,
  isSupplierDoc,
  isSupplierList,
  isVehicle,
  isVehicleList,
  kb,
  money,
  saveView,
  savedView,
  shortEgp,
  statsOf,
  SUPPLIER_COLUMNS,
  VEHICLE_COLUMNS,
  VIEW_KEY,
} from './model';
import { isColumn } from '../../columns/model';

const S = contracts.schemas;

const supplier = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: 'Yu Motors',
  contact: 'yu@example.com',
  address: 'Shanghai',
  country: 'China',
  notes: '',
  custom_fields: { cf_rating: 'a' },
  created_by: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});
const vehicle = (over: Record<string, unknown> = {}) => ({
  id: 1,
  supplier_id: 7,
  brand: 'BYD',
  model: 'Seal',
  trim: 'Max',
  model_year: 2026,
  availability: 'Pre-order',
  fob_price: 32789,
  currency: 'USD',
  lead_time: '4 weeks',
  accessories: '',
  notes: '',
  custom_fields: {},
  ...over,
});
const doc = (over: Record<string, unknown> = {}) => ({
  id: 1,
  supplier_id: 7,
  name: 'price-list.pdf',
  drive_file_id: 'f1',
  web_link: 'https://drive.example/f1',
  mime_type: 'application/pdf',
  size_bytes: 20480,
  uploaded_by: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});
const purchases = (over: Record<string, unknown> = {}) => ({
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
    lead_times: ['6 weeks'],
  },
  ...over,
});

describe('the answers the Suppliers screen accepts', () => {
  // The bundle does not carry zod; these tables are what keep each hand-written check honest against the schema.
  const suppliers: Array<[string, unknown]> = [
    ['a supplier', supplier()],
    [
      'one with nothing but a name (the text columns are null)',
      supplier({ contact: null, address: null, country: null, notes: null }),
    ],
    ['one with no added fields', supplier({ custom_fields: undefined })],
    ['one whose added fields are null', supplier({ custom_fields: null })],
    [
      'one with no history',
      supplier({ created_by: undefined, created_at: undefined, updated_at: undefined }),
    ],
    ['no id', supplier({ id: undefined })],
    ['no name', supplier({ name: undefined })],
    ['a null name', supplier({ name: null })],
    ['a fractional id', supplier({ id: 1.5 })],
    ['a numeric name', supplier({ name: 3 })],
    ['added fields that are a list', supplier({ custom_fields: [] })],
    ['a numeric contact', supplier({ contact: 5 })],
    ['not an object', 'supplier'],
    ['null', null],
  ];
  it.each(suppliers)('%s: the check and the schema agree', (_n, v) => {
    expect(isSupplier(v)).toBe(S.Supplier.safeParse(v).success);
  });
  it('a list is a list of those', () => {
    for (const v of [
      [supplier()],
      [],
      [supplier(), supplier({ id: 2 })],
      [supplier(), 'x'],
      {},
      null,
    ]) {
      expect(isSupplierList(v)).toBe(S.SupplierList.safeParse(v).success);
    }
  });

  const vehicles: Array<[string, unknown]> = [
    ['a vehicle', vehicle()],
    ['one with nothing priced', vehicle({ fob_price: null, model_year: null })],
    [
      'one with null words',
      vehicle({ trim: null, availability: null, lead_time: null, accessories: null, notes: null }),
    ],
    ['a price that is text', vehicle({ fob_price: '32789' })],
    ['a year that is text', vehicle({ model_year: '2026' })],
    ['no currency', vehicle({ currency: undefined })],
    ['a null currency', vehicle({ currency: null })],
    ['a supplier id that is text', vehicle({ supplier_id: '7' })],
    ['no brand', vehicle({ brand: undefined })],
    ['added fields', vehicle({ custom_fields: { cf_grade: 'a' } })],
  ];
  it.each(vehicles)('%s: the check and the schema agree', (_n, v) => {
    expect(isVehicle(v)).toBe(S.SupplierVehicle.safeParse(v).success);
  });
  it("a catalogue is a list of vehicles, and an offer has the supplier's name beside it", () => {
    for (const v of [[vehicle()], [], [vehicle(), 3]])
      expect(isVehicleList(v)).toBe(S.SupplierVehicleList.safeParse(v).success);
    for (const v of [vehicle({ supplier_name: 'Yu' }), vehicle(), vehicle({ supplier_name: 3 })]) {
      expect(isOffer(v)).toBe(S.SupplierOffer.safeParse(v).success);
    }
    for (const v of [[vehicle({ supplier_name: 'Yu' })], [vehicle()], []])
      expect(isOfferList(v)).toBe(S.SupplierOfferList.safeParse(v).success);
  });

  const docs: Array<[string, unknown]> = [
    ['a document', doc()],
    [
      'one with nothing recorded of it',
      doc({ drive_file_id: null, web_link: null, mime_type: null, size_bytes: null }),
    ],
    ['one with no uploader', doc({ uploaded_by: undefined, created_at: undefined })],
    ['no name', doc({ name: undefined })],
    ['a size that is text', doc({ size_bytes: '20480' })],
  ];
  it.each(docs)('%s: the check and the schema agree', (_n, v) => {
    expect(isSupplierDoc(v)).toBe(S.SupplierDoc.safeParse(v).success);
  });
  it('a list of documents is a list of those', () => {
    for (const v of [[doc()], [], [doc(), null]])
      expect(isDocList(v)).toBe(S.SupplierDocList.safeParse(v).success);
  });

  const buys: Array<[string, unknown]> = [
    ['what was bought', purchases()],
    [
      'nothing bought',
      purchases({
        units: [],
        poLines: [],
        totals: { vehicles: 0, ordered: 0, avg_unit_price: 0, avg_po_price: 0, lead_times: [] },
      }),
    ],
    [
      'cars with no make',
      purchases({
        units: [
          {
            stock_id: 1,
            make: null,
            model: null,
            trim: null,
            vin: '',
            colour: '',
            status: '',
            price: 0,
          },
        ],
      }),
    ],
    [
      'a line with no number or date',
      purchases({
        poLines: [
          {
            po_id: 2,
            po_number: null,
            po_date: null,
            currency: null,
            brand: '',
            model: '',
            trim: '',
            qty: 1,
            price: 0,
            lead_time: '',
          },
        ],
      }),
    ],
    ['no totals', purchases({ totals: undefined })],
    [
      'a total that is text',
      purchases({
        totals: { vehicles: 1, ordered: 2, avg_unit_price: '3', avg_po_price: 4, lead_times: [] },
      }),
    ],
    [
      'lead times that are not words',
      purchases({
        totals: { vehicles: 1, ordered: 2, avg_unit_price: 3, avg_po_price: 4, lead_times: [1] },
      }),
    ],
    [
      'a unit with no vin',
      purchases({
        units: [{ stock_id: 1, make: 'x', model: 'y', trim: '', colour: '', status: '', price: 1 }],
      }),
    ],
    [
      'a unit whose vin is null',
      purchases({
        units: [
          {
            stock_id: 1,
            make: 'x',
            model: 'y',
            trim: '',
            vin: null,
            colour: '',
            status: '',
            price: 1,
          },
        ],
      }),
    ],
    [
      'totals with no average purchase-order price',
      purchases({ totals: { vehicles: 1, ordered: 2, avg_unit_price: 3, lead_times: [] } }),
    ],
    [
      'totals with no average price paid',
      purchases({ totals: { vehicles: 1, ordered: 2, avg_po_price: 4, lead_times: [] } }),
    ],
    ['not an object', []],
  ];
  it.each(buys)('%s: the check and the schema agree', (_n, v) => {
    expect(isPurchases(v)).toBe(S.SupplierPurchases.safeParse(v).success);
  });
});

describe('the columns the register and the catalogue start with', () => {
  it('are the five fields of a supplier and the eight of an offer, and are valid columns', () => {
    expect(SUPPLIER_COLUMNS.map(c => c.key)).toEqual([
      'name',
      'contact',
      'country',
      'address',
      'notes',
    ]);
    expect(VEHICLE_COLUMNS.map(c => c.key)).toEqual([
      'brand',
      'model',
      'trim',
      'model_year',
      'availability',
      'fob_price',
      'lead_time',
      'accessories',
    ]);
    expect(VEHICLE_COLUMNS.filter(c => c.type === 'number').map(c => c.key)).toEqual([
      'model_year',
      'fob_price',
    ]);
    expect([...SUPPLIER_COLUMNS, ...VEHICLE_COLUMNS].every(isColumn)).toBe(true);
  });
});

describe('the figures on a card', () => {
  const stock = [
    {
      units: [
        { supplier: 'Yu Motors', price_list: 32000 },
        { supplier: ' yu MOTORS ', price_list: 0 },
        { supplier: '' },
      ],
      price: 10000,
      supplier: '',
    },
    { units: [{ price_list: 5 }], supplier: 'Other', price: 7 },
    { units: 'not a list' },
    null,
  ];
  const offers = [
    { supplier_id: 7 },
    { supplier_id: 7 },
    { supplier_id: 8 },
    { supplier_id: 'x' },
    null,
  ];

  it("counts the units by the supplier's name (any case, trimmed), what they are worth, and the catalogue by id", () => {
    const s = statsOf(offers, stock);
    expect(s.haveStock && s.haveCatalogue).toBe(true);
    expect(cardFigures({ id: 7, name: 'yu motors' }, s)).toEqual({
      units: 2,
      value: 32000 + 10000,
      catalogue: 2,
    });
    expect(cardFigures({ id: 8, name: 'Other' }, s)).toEqual({ units: 1, value: 5, catalogue: 1 });
    expect(cardFigures({ id: 9, name: 'Nobody' }, s)).toEqual({ units: 0, value: 0, catalogue: 0 });
    expect(s.totalUnits).toBe(3);
    expect(s.totalCatalogue).toBe(3);
  });

  it("takes a unit's own supplier before its model's, and the model's price where the unit has none", () => {
    const s = statsOf(
      [],
      [
        {
          supplier: 'Model Supplier',
          price: 100,
          units: [{ supplier: 'Unit Supplier', price_list: 40 }, { price_list: 0 }],
        },
      ],
    );
    expect(cardFigures({ id: 1, name: 'Unit Supplier' }, s).value).toBe(40);
    expect(cardFigures({ id: 1, name: 'Model Supplier' }, s)).toMatchObject({
      units: 1,
      value: 100,
    });
  });

  it('has no figure — not a confident zero — for a list the server would not give', () => {
    const none = statsOf(null, null);
    expect(none.haveStock).toBe(false);
    expect(none.haveCatalogue).toBe(false);
    expect(countLine(3, none)).toBe('3 suppliers');
    expect(countLine(1, statsOf(null, []))).toBe('1 supplier · 0 units in the register');
    expect(statsOf(offers, null).haveCatalogue).toBe(true);
  });

  it('writes the line above the register as the classic page does', () => {
    const s = statsOf([{ supplier_id: 1 }], [{ units: [{ supplier: 'a' }] }]);
    expect(countLine(1, s)).toBe('1 supplier · 1 unit in the register · 1 catalogue vehicle');
    expect(countLine(2, statsOf([{ supplier_id: 1 }, { supplier_id: 1 }], [{ units: [] }]))).toBe(
      '2 suppliers · 0 units in the register · 2 catalogue vehicles',
    );
  });

  it('shortens a value as the card does', () => {
    expect(
      [
        0,
        999,
        1000,
        1499,
        1500,
        32000,
        999999,
        1_000_000,
        1_500_000,
        2_040_000,
        1_500_000_000,
        12_000_000_000,
        NaN,
      ].map(shortEgp),
    ).toEqual([
      '—',
      '999',
      '1K',
      '1K',
      '2K',
      '32K',
      '1000K',
      '1M',
      '1.5M',
      '2M',
      '1.5B',
      '12B',
      '—',
    ]);
  });

  it('gives a supplier two letters', () => {
    expect([
      initials('Yu Motors'),
      initials('  alpha  '),
      initials('Gulf Auto Trading Company'),
      initials(''),
      initials(null),
      initials('x'),
    ]).toEqual(['YM', 'A', 'GA', '?', '?', 'X']);
  });
});

describe("words on the supplier's pages", () => {
  it('writes a size, a figure and a car as the classic page does', () => {
    expect([kb(0), kb(null), kb(1), kb(1024), kb(204800), kb(300)]).toEqual([
      '',
      '',
      '1 KB',
      '1 KB',
      '200 KB',
      '1 KB',
    ]);
    expect(money(1234567)).toBe((1234567).toLocaleString());
    expect([money(null), money('x'), money(0)]).toEqual(['0', '0', '0']);
    expect(carOf({ make: 'BYD', model: 'Seal', trim: 'Max' })).toBe('BYD Seal Max');
    expect(carOf({ brand: 'Aion', model: 'Y', trim: '' })).toBe('Aion Y');
    expect(carOf({ model: null })).toBe('');
  });
});

describe('the view it remembers', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it('is the cards until somebody chooses the table, under the key the classic page uses', () => {
    expect(savedView()).toBe('cards');
    saveView('table');
    expect(localStorage.getItem(VIEW_KEY)).toBe('table');
    expect(VIEW_KEY).toBe('ml_sup_view');
    expect(savedView()).toBe('table');
    saveView('cards');
    expect(savedView()).toBe('cards');
    localStorage.setItem(VIEW_KEY, 'something else');
    expect(savedView()).toBe('cards');
  });
  it('works without a browser that keeps anything', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(savedView()).toBe('cards');
    expect(() => saveView('table')).not.toThrow();
  });
});
