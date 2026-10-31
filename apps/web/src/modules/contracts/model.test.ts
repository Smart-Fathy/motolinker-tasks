import { CONTRACT_PAYMENT_WHEN, CONTRACT_SECTIONS } from '@motolinker/contracts/documents';
import { describe, expect, it } from 'vitest';
import {
  blocksOf,
  dataOf,
  fieldId,
  fieldsOf,
  fixedPaysOf,
  getPath,
  isAuto,
  isSale,
  newPayRow,
  payRowsOf,
  seedOf,
  startValues,
  textOf,
  titleOf,
  withLead,
  withPath,
  type Data,
} from './model';

const SALE: Data = {
  template: 'sale-v2',
  contractNo: 'MC2610-1',
  buyer: { name: 'Ali', nationalId: '29001' },
  vehicle: { make: 'BYD', model: 'Seal' },
  total: 1500000,
  payments: [
    { amount: '500000', when: 'now', label: 'deposit' },
    { amount: '1000000', when: 'later', label: '' },
  ],
  custom_fields: { cf_ref: 'R-1', cf_secret: 'keep' },
};
const OLDER: Data = {
  buyer: { name: 'قديم' },
  importCountry: 'الصين',
  lateFee: 50,
  payments: [
    { amount: '100', when: 'عند التوقيع', label: 'الدفعة الأولى' },
    { amount: '200', when: 'عند الاستلام' },
  ],
};

describe('a path into a contract', () => {
  it('reads what is at a dotted path, and nothing where there is nothing', () => {
    expect(getPath(SALE, 'buyer.name')).toBe('Ali');
    expect(getPath(SALE, 'total')).toBe(1500000);
    expect(getPath(SALE, 'buyer.age')).toBeUndefined();
    expect(getPath(SALE, 'rep.name')).toBeUndefined();
    expect(getPath(SALE, 'buyer.name.first')).toBeUndefined();
    expect(getPath(SALE, 'total.x')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
    expect(getPath(undefined, 'a.b')).toBeUndefined();
    expect(getPath('text', 'length')).toBeUndefined();
    expect(getPath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('goes through a list by position', () => {
    expect(getPath(SALE, 'payments.1.amount')).toBe('1000000');
    expect(getPath(SALE, 'payments.5.amount')).toBeUndefined();
  });

  it('puts a value at a path, making what is not there yet, and leaves the original as it was', () => {
    const was: Data = { buyer: { name: 'Ali' }, total: 5 };
    const made = withPath(was, 'rep.name', 'Mona');
    expect(made).toEqual({ buyer: { name: 'Ali' }, total: 5, rep: { name: 'Mona' } });
    expect(was).toEqual({ buyer: { name: 'Ali' }, total: 5 });
    const over = withPath(was, 'buyer.address', 'Cairo');
    expect(over['buyer']).toEqual({ name: 'Ali', address: 'Cairo' });
    expect(over['buyer']).not.toBe(was['buyer']);
    expect(was['buyer']).toEqual({ name: 'Ali' });
  });

  it('puts one at the top, and replaces something that is not a place to put things in', () => {
    expect(withPath({}, 'total', '7')).toEqual({ total: '7' });
    expect(withPath({ buyer: 'Ali' }, 'buyer.name', 'Mona')).toEqual({ buyer: { name: 'Mona' } });
    expect(withPath({ buyer: null }, 'buyer.name', 'Mona')).toEqual({ buyer: { name: 'Mona' } });
    expect(withPath({ buyer: ['x'] }, 'buyer.name', 'Mona')).toEqual({ buyer: { name: 'Mona' } });
  });

  it('shows a value as words: nothing is empty, a number is its digits', () => {
    expect(textOf(null)).toBe('');
    expect(textOf(undefined)).toBe('');
    expect(textOf(0)).toBe('0');
    expect(textOf(1500000)).toBe('1500000');
    expect(textOf('x')).toBe('x');
    expect(textOf(false)).toBe('false');
  });

  it('names the input of a field after its path', () => {
    expect(fieldId('buyer.name')).toBe('ct-buyer-name');
    expect(fieldId('total')).toBe('ct-total');
    expect(fieldId('contractDate.d')).toBe('ct-contractDate-d');
  });
});

describe('the blanks of the form', () => {
  it('knows a contract on the car-sale wording by its template, and no other', () => {
    expect(isSale(SALE)).toBe(true);
    expect(isSale(OLDER)).toBe(false);
    expect(isSale({ template: 'sale-v1' })).toBe(false);
    expect(isSale({})).toBe(false);
  });

  it('has the same five blocks, in order, for every wording', () => {
    expect(blocksOf(SALE).map(b => b.id)).toEqual(['date', 'company', 'buyer', 'vehicle', 'money']);
    expect(blocksOf(OLDER).map(b => b.id)).toEqual([
      'date',
      'company',
      'buyer',
      'vehicle',
      'money',
    ]);
    expect(blocksOf(SALE).map(b => b.title)).toEqual(CONTRACT_SECTIONS.map(s => s.title));
  });

  it("offers a car-sale contract the paper form's rows, and an older one the rows that wording had besides", () => {
    const sale = fieldsOf(SALE).map(([path]) => path);
    const older = fieldsOf(OLDER).map(([path]) => path);
    expect(sale).not.toContain('importCountry');
    expect(sale).not.toContain('lateFee');
    expect(older).toContain('importCountry');
    expect(older).toContain('lateFee');
    expect(older).toContain('lateFeeWords');
    expect(older).toContain('deliveryDeadline');
    // …and everything the car-sale one has, the older has, in the same places
    expect(older.filter(p => sale.includes(p))).toEqual(sale);
  });

  it("joins the older wording's fields to the last row of the block they belong to — one grid, as the classic editor drew it — and to no other", () => {
    const vehicle = blocksOf(OLDER).find(b => b.id === 'vehicle')!;
    expect(vehicle.rows).toHaveLength(1);
    expect(vehicle.rows[0]!.map(([p]) => p)).toEqual([
      'vehicle.make',
      'vehicle.model',
      'vehicle.color',
      'vehicle.year',
      'vehicle.notes',
      'importCountry',
    ]);
    const money = blocksOf(OLDER).find(b => b.id === 'money')!;
    expect(money.rows).toHaveLength(1);
    expect(money.rows[0]!.map(([p]) => p)).toEqual([
      'total',
      'totalWords',
      'lateFee',
      'lateFeeWords',
      'deliveryDeadline',
    ]);
    // the blocks that have none of the older wording's are as they are on a car-sale contract
    for (const id of ['date', 'company', 'buyer']) {
      expect(blocksOf(OLDER).find(b => b.id === id)!.rows).toEqual(
        blocksOf(SALE).find(b => b.id === id)!.rows,
      );
    }
    expect(blocksOf(SALE).find(b => b.id === 'money')!.rows).toHaveLength(1);
    expect(blocksOf(SALE).find(b => b.id === 'money')!.rows[0]).toHaveLength(2);
  });

  it('starts each field with what the contract holds at its path, as words', () => {
    const v = startValues(SALE);
    expect(v['buyer.name']).toBe('Ali');
    expect(v['total']).toBe('1500000');
    expect(v['vehicle.make']).toBe('BYD');
    expect(v['rep.name']).toBe('');
    expect(Object.keys(v)).toEqual(fieldsOf(SALE).map(([p]) => p));
    // a field the form does not offer a car-sale contract is not started
    expect('importCountry' in startValues(SALE)).toBe(false);
    expect(startValues(OLDER)['importCountry']).toBe('الصين');
    expect(startValues(OLDER)['lateFee']).toBe('50');
  });
});

describe('payment lines', () => {
  it('start with the wording the contract prints for a line with none, and nothing else', () => {
    expect(newPayRow(3)).toEqual({ id: 3, amount: '', when: CONTRACT_PAYMENT_WHEN, label: '' });
    expect(CONTRACT_PAYMENT_WHEN).toBe('فور التوقيع علي هذا العقد');
  });

  it('are the lines a contract holds, numbered as they come, anything else being no line', () => {
    expect(payRowsOf(SALE)).toEqual([
      { id: 0, amount: '500000', when: 'now', label: 'deposit' },
      { id: 1, amount: '1000000', when: 'later', label: '' },
    ]);
    expect(payRowsOf({})).toEqual([]);
    expect(payRowsOf({ payments: 'x' })).toEqual([]);
    expect(payRowsOf({ payments: { 0: {} } })).toEqual([]);
    // a line that is not an object is a blank one, still a line
    expect(payRowsOf({ payments: [null, 'x', { amount: 7 }] })).toEqual([
      { id: 0, amount: '', when: '', label: '' },
      { id: 1, amount: '', when: '', label: '' },
      { id: 2, amount: '7', when: '', label: '' },
    ]);
  });

  it('are, on an older contract, the lines as they were, to be read beside their amounts', () => {
    expect(fixedPaysOf(OLDER)).toEqual([
      { amount: '100', note: 'عند التوقيع (الدفعة الأولى)' },
      { amount: '200', note: 'عند الاستلام' },
    ]);
    expect(fixedPaysOf({})).toEqual([]);
    expect(fixedPaysOf({ payments: 3 })).toEqual([]);
    expect(fixedPaysOf({ payments: [null] })).toEqual([{ amount: '', note: '' }]);
  });
});

describe('what the contract is once the form is done with it', () => {
  const values = (over: Record<string, string> = {}) => ({ ...startValues(SALE), ...over });
  const pays = payRowsOf(SALE);

  it('puts each field at its path, trimmed, over what the contract had', () => {
    const data = dataOf(
      SALE,
      values({ 'buyer.name': '  Mona  ', 'rep.name': ' Sami ' }),
      pays,
      {},
      'MC2610-1',
    );
    expect(getPath(data, 'buyer.name')).toBe('Mona');
    expect(getPath(data, 'rep.name')).toBe('Sami');
    expect(getPath(data, 'buyer.nationalId')).toBe('29001');
    // a number the form showed as words goes back as words (the form is text)
    expect(data['total']).toBe('1500000');
  });

  it('leaves the contract it was given as it was', () => {
    const copy = JSON.parse(JSON.stringify(SALE)) as Data;
    dataOf(SALE, values({ 'buyer.name': 'Mona' }), [newPayRow(0)], { cf_ref: 'X' }, 'N-9');
    expect(SALE).toEqual(copy);
  });

  it('keeps what the form does not show: a field the contract has that no row names', () => {
    const was: Data = { ...SALE, secretNote: 'keep me', buyer: { name: 'Ali', extra: 'kept' } };
    const data = dataOf(was, values(), pays, {}, 'MC2610-1');
    expect(data['secretNote']).toBe('keep me');
    expect(getPath(data, 'buyer.extra')).toBe('kept');
    expect(data['template']).toBe('sale-v2');
  });

  it('makes the payment lines of a car-sale contract exactly the rows on screen — trimmed, each keeping the label it came with', () => {
    const rows = [
      { id: 0, amount: ' 500 ', when: ' now ', label: ' deposit ' },
      { id: 4, amount: '', when: '', label: '' },
    ];
    const data = dataOf(SALE, values(), rows, {}, 'MC2610-1');
    expect(data['payments']).toEqual([
      { amount: '500', when: 'now', label: ' deposit ' },
      { amount: '', when: '', label: '' },
    ]);
    // a row taken away is gone
    expect(dataOf(SALE, values(), [], {}, 'MC2610-1')['payments']).toEqual([]);
  });

  it('carries its own number, so that a preview of it prints the number too — where it has one', () => {
    expect(dataOf(SALE, values(), pays, {}, 'MC2610-9')['contractNo']).toBe('MC2610-9');
    expect(dataOf(SALE, values(), pays, {}, '')['contractNo']).toBe('MC2610-1');
    expect(dataOf({ template: 'sale-v2' }, values(), pays, {}, '')).not.toHaveProperty(
      'contractNo',
    );
  });

  it('puts the added fields over the ones the contract had, and keeps the ones the form did not show', () => {
    const data = dataOf(SALE, values(), pays, { cf_ref: 'R-2', cf_new: true }, 'MC2610-1');
    expect(data['custom_fields']).toEqual({ cf_ref: 'R-2', cf_secret: 'keep', cf_new: true });
    // a contract with none gets the ones given; one with a custom_fields that is not an object is not spread
    expect(dataOf({ template: 'sale-v2' }, {}, [], { a: 1 }, '')['custom_fields']).toEqual({
      a: 1,
    });
    expect(
      dataOf({ template: 'sale-v2', custom_fields: 'x' }, {}, [], { a: 1 }, '')['custom_fields'],
    ).toEqual({
      a: 1,
    });
    expect(
      dataOf({ template: 'sale-v2', custom_fields: ['x'] }, {}, [], {}, '')['custom_fields'],
    ).toEqual({});
  });

  it('changes only the amounts of an older contract, which keeps its lines, their words and the number it was written without', () => {
    const fixed = [
      { amount: ' 111 ', note: 'x' },
      { amount: '222', note: 'y' },
    ];
    const data = dataOf(OLDER, startValues(OLDER), fixed, {}, 'MC2610-7');
    expect(data['payments']).toEqual([
      { amount: '111', when: 'عند التوقيع', label: 'الدفعة الأولى' },
      { amount: '222', when: 'عند الاستلام' },
    ]);
    expect(data).not.toHaveProperty('contractNo');
    expect(data).not.toHaveProperty('template');
  });

  it('gives an older contract with no lines none, and does not make a list of what was not there', () => {
    expect(dataOf({ buyer: { name: 'x' } }, {}, [], {}, '')).not.toHaveProperty('payments');
    // more amounts than lines make lines; fewer leave the rest as they were
    const more = dataOf(
      { payments: [{ amount: '1', when: 'w' }] },
      {},
      [
        { amount: '5', note: '' },
        { amount: '6', note: '' },
      ],
      {},
      '',
    );
    expect(more['payments']).toEqual([{ amount: '5', when: 'w' }, { amount: '6' }]);
    const fewer = dataOf(OLDER, {}, [{ amount: '9', note: '' }], {}, '');
    expect((fewer['payments'] as unknown[]).length).toBe(2);
    expect(getPath(fewer, 'payments.1.amount')).toBe('200');
  });

  it('writes a field of an older contract into the place the older form had it', () => {
    const data = dataOf(
      OLDER,
      { ...startValues(OLDER), importCountry: ' اليابان ', lateFee: '75' },
      fixedPaysOf(OLDER),
      {},
      '',
    );
    expect(data['importCountry']).toBe('اليابان');
    expect(data['lateFee']).toBe('75');
  });
});

describe('a contract named after its buyer', () => {
  it('is "عقد — " and the buyer', () => {
    expect(titleOf('Ali')).toBe('عقد — Ali');
    expect(titleOf('')).toBe('عقد — ');
  });

  it('knows one drafted when a deal reached Won, and no other', () => {
    expect(isAuto({ created_by: 'auto_won' })).toBe(true);
    expect(isAuto({ created_by: 'admin' })).toBe(false);
    expect(isAuto({ created_by: 'employee_3' })).toBe(false);
    expect(isAuto({ created_by: null })).toBe(false);
    expect(isAuto({ created_by: 'auto_won ' })).toBe(false);
  });
});

describe('a lead put into the buyer block', () => {
  const lead = {
    id: 7,
    name: 'Zed',
    address: 'Giza',
    custom_fields: {
      cf_national_id: '30012',
      cf_address: 'Cairo',
      cf_vehicle_offered: ' BYD Seal Max ',
      cf_vehicle_requested: 'Geely',
    },
    car_in_question: 'Kia',
  };

  it('is read for what a contract is made of: who they are and what their page knows', () => {
    expect(seedOf(lead)).toEqual({
      id: 7,
      name: 'Zed',
      address: 'Giza',
      car: 'BYD Seal Max',
      nationalId: '30012',
    });
    expect(seedOf(undefined)).toBeNull();
  });

  it('has an address from the custom field when the lead has none of its own', () => {
    expect(seedOf({ ...lead, address: '' })!.address).toBe('Cairo');
    expect(seedOf({ ...lead, address: null })!.address).toBe('Cairo');
    expect(seedOf({ id: 1, name: 'x' })!.address).toBe('');
  });

  it('has the car it was offered, else the one it was asked for, else the one in question', () => {
    expect(seedOf(lead)!.car).toBe('BYD Seal Max');
    expect(seedOf({ ...lead, custom_fields: { cf_vehicle_requested: 'Geely Coolray' } })!.car).toBe(
      'Geely Coolray',
    );
    expect(seedOf({ ...lead, custom_fields: {} })!.car).toBe('Kia');
    expect(seedOf({ id: 1, name: 'x', custom_fields: null })!.car).toBe('');
    expect(seedOf({ id: 1, name: 'x', custom_fields: [] })!.nationalId).toBe('');
  });

  it('fills the name always and the rest only where the form has nothing yet', () => {
    const seed = seedOf(lead)!;
    const blank = Object.fromEntries(fieldsOf(SALE).map(([p]) => [p, '']));
    const filled = withLead(blank, seed);
    expect(filled['buyer.name']).toBe('Zed');
    expect(filled['buyer.nationalId']).toBe('30012');
    expect(filled['buyer.address']).toBe('Giza');
    expect(filled['vehicle.make']).toBe('BYD');
    expect(filled['vehicle.model']).toBe('Seal Max');
    // a person who has typed keeps it — and a name is replaced, as the classic picker does
    const typed = withLead(
      {
        ...blank,
        'buyer.name': 'Someone',
        'buyer.address': 'Mine',
        'vehicle.make': 'Audi',
        'vehicle.model': 'A4',
      },
      seed,
    );
    expect(typed['buyer.name']).toBe('Zed');
    expect(typed['buyer.address']).toBe('Mine');
    expect(typed['vehicle.make']).toBe('Audi');
    expect(typed['vehicle.model']).toBe('A4');
    expect(typed['buyer.nationalId']).toBe('30012');
  });

  it('counts a field of spaces as nothing yet', () => {
    const next = withLead({ 'buyer.address': '   ', 'vehicle.make': ' ' }, seedOf(lead)!);
    expect(next['buyer.address']).toBe('Giza');
    expect(next['vehicle.make']).toBe('BYD');
  });

  it('puts nothing where the lead has nothing, and leaves the vehicle alone when there is no car', () => {
    const bare = seedOf({ id: 2, name: 'Bare' })!;
    const next = withLead({ 'buyer.address': 'Mine', 'vehicle.make': 'Audi' }, bare);
    expect(next).toEqual({ 'buyer.name': 'Bare', 'buyer.address': 'Mine', 'vehicle.make': 'Audi' });
  });

  it("splits one word of car into a make alone, and leaves the form's other values alone", () => {
    const next = withLead({ total: '5' }, seedOf({ id: 3, name: 'N', car_in_question: 'Toyota' })!);
    expect(next).toEqual({ total: '5', 'buyer.name': 'N', 'vehicle.make': 'Toyota' });
  });

  it('splits a car on any run of spaces', () => {
    const next = withLead(
      {},
      seedOf({ id: 3, name: 'N', car_in_question: 'Land   Cruiser  300' })!,
    );
    expect(next['vehicle.make']).toBe('Land');
    expect(next['vehicle.model']).toBe('Cruiser 300');
  });

  it('does not change the values it was given', () => {
    const given = { 'buyer.name': 'Old' };
    withLead(given, seedOf(lead)!);
    expect(given).toEqual({ 'buyer.name': 'Old' });
  });
});
