// The purchase order PDF (src/lib/docs/purchase-order.js) — the order MotoLinkers sends a supplier.
//
//   src/lib/docs/purchase-order.js   the look and the layout (buildPurchaseOrderHtml) and the numbers
//                                    it prints (purchaseOrderModel)
//   src/lib/docs/brand.js            the identity every document wears: logo, company block, page shell
//   src/lib/docs/money.js            fmtNum / calcEgp — the quotation's maths; whole-dollar amounts here
//                                    must read the same (the order keeps its own rule for cents)
//   tools/doc-fixtures/po.js         the sample orders (the first is the reference order, ID MT28W88Y26)
//
// What this guards, in order: the reference order to the dollar (every cell, the total); the ID, the
// date and the supplier; the money rules (a quantity left blank is 1, a price of 0 prints nothing, cents,
// the currency, agreement with money.js); the blanks and the standard wording; the words filled in by
// hand (red); the brand; that nothing typed is lost and nothing typed is HTML; a real browser (markup is
// text, nothing overflows, Arabic runs right to left, red is red); and real PDFs (one page for a normal
// order, a long one flows onto more with the table head repeated, whole rows, the total always with the
// last rows, the letterhead and "Page n of N" on every page).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Use the sandbox's Chrome when puppeteer has none of its own: decided before puppeteer is required (it reads it once, at load).
require('./helpers/browser').pointPuppeteerAtChrome();
const puppeteer = require('puppeteer');
const brand = require('../src/lib/docs/brand');
const defaults = require('../src/lib/docs/defaults');
const { fmtNum, calcEgp } = require('../src/lib/docs/money');
const { buildPurchaseOrderHtml, purchaseOrderModel } = require('../src/lib/docs/purchase-order');
const { renderPdf } = require('../src/lib/docs/render');
const fx = require('../tools/doc-fixtures/po');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// compare two values; show what was found only when they differ
const eq = (n, actual, expected) => check(n, same(actual, expected), same(actual, expected) ? '' : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`);
const have = cmd => spawnSync('which', [cmd]).status === 0;

// ── Reading a document the way a reader does ───────────────────────────────────
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const squash = s => s.replace(/\s+/g, ' ').trim();
const nospace = s => s.replace(/\s+/g, '');
const count = (hay, needle) => hay.split(needle).length - 1;
const cellText = c => squash(decode(c.replace(/<[^>]+>/g, ' ')));
// The order's own page, from its wrapper on (the letterhead comes before it in the markup and is read
// apart): every tag becomes a space, then the entities turn back into the characters that were typed —
// so typed markup, being escaped, is still there as text.
const body = h => h.slice(h.indexOf('<div class="po">'));
const plain = h => squash(decode(body(h).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')));
const between = (h, from, to) => h.slice(h.indexOf(from), h.indexOf(to));
const headerOf = h => cellText(between(h, 'class="doc-header"', 'class="doc-footer"'));
const footerOf = h => cellText(between(h, 'class="doc-footer"', '<table class="flow">'));
const cardOf = h => cellText(h.slice(h.indexOf('<div class="card po-meta">'), h.indexOf('</section>', h.indexOf('<div class="card po-meta">'))));
// every row of the order lines table, as its cells' texts: the head, the numbered rows, the dark total block
const rowsOf = h => {
  const at = h.indexOf('<div class="sec-title">ORDER LINES</div>');
  if (at < 0) return null;
  const t = h.slice(at, h.indexOf('</table>', at));
  return [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => cellText(c[1])));
};
// { head, rows (every numbered row, the empty ones too), total (the text of the dark block) }
const table = h => {
  const r = rowsOf(h);
  if (!r) return null;
  const tot = r.pop();
  return { head: r[0], rows: r.slice(1), total: tot[0] };
};
// the class of each numbered row (the last two are chained to the total, the last one closes the card)
const rowClasses = h => [...h.matchAll(/<tr(?: class="([^"]*)")?>\s*<td class="ctr fig no">/g)].map(m => m[1] || '');
// the first phrase of a list that is not found after the one before it, or -1 when all are, in order
const inOrder = (text, phrases) => {
  let at = 0;
  for (const p of phrases) { const i = text.indexOf(p, at); if (i < 0) return p; at = i + p.length; }
  return -1;
};
// the ID as the card, the page header, the footer and the title print it
const idsOf = h => [
  (/<span class="k">ID<\/span><span class="v[^"]*">([^<]*)<\/span>/.exec(h) || [])[1],
  (/<span class="dh-ref">PURCHASE ORDER(?: <span>([^<]*)<\/span>)?<\/span>/.exec(h) || [])[1],
  (/Registration No<\/b> \d+(?:<br>([^<]*))?<\/div>/.exec(h) || [])[1],
  (/<title>Purchase Order ?([^<]*)<\/title>/.exec(h) || [])[1],
];
const red = h => [...h.matchAll(/<span class="red">([\s\S]*?)<\/span>/g)].map(m => decode(m[1]));
const footH = h => +(h.match(/--foot-h:([\d.]+)mm/) || [])[1];
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// An order with nothing in it but what a case needs, and a line to put in it.
const order = over => ({ po_number: 'PO2601-0001', po_date: '2026-01-01', currency: 'USD', supplier_name: 'Test Supplier', items: [], settings: {}, ...over });
const L = o => ({ client: 'Client', brand: 'Brand', model: 'Model', units: 1, pi_price: 0, accessories: 'Mats', ...o });
const html = over => buildPurchaseOrderHtml(order(over));
const tbl = over => table(html(over));
const priced = (items, over) => tbl({ items: items.map(L), ...over });
const FIX_ACC = 'English system , wall mount charging cable , floor mats, tires repairing kit , electric pump';
// a footer note of four lines and an address of four lines: the footer, fixed to the foot of every page, grows
const BIG_NOTE = 'Prices are valid for the period stated above, are quoted ex-works and are subject to change without prior notice. '.repeat(4);
const BIG_ADDRESS = 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo - Arab Republic of Egypt, next to the metro station, opposite the old bakery';

// Markup in every field a person can type into, the settings and the ID included.
const EVIL = '<img src=x onerror=alert(1)> "q" & \'s\' <script>boom()</script>';
const evilOrder = {
  po_number: `${EVIL}N`, po_date: `${EVIL}D`, issuer: `${EVIL}I`, currency: '<b>"&', client_name: `${EVIL}LEAD`,
  supplier_name: `${EVIL}SN`, supplier_contact: `${EVIL}SC`, supplier_address: `${EVIL}SA`, supplier_country: `${EVIL}SK`,
  incoterm: `${EVIL}IN`, delivery_location: `${EVIL}DL`, service_provider: `${EVIL}SP`, contact: `${EVIL}CT`,
  payment_terms: `<b>50%</b> ${EVIL}\n40% ${EVIL}`, documents_required: `${EVIL} XXXXX ${EVIL}\nCIF ONLY ${EVIL}`, notes: `${EVIL}\n${EVIL}`,
  items: [{ client: '', consignee: `${EVIL}CONS`, brand: `${EVIL}B`, model: `${EVIL}M`, trim: `${EVIL}T`, color: `EXT: ${EVIL} INT: ${EVIL}`, year: '<i>&', accessories: `${EVIL}\n${EVIL}`, units: 2, pi_price: 1000 }],
  settings: { company_name: EVIL, company_tagline: EVIL, company_address: EVIL, company_email: EVIL, company_website: EVIL, company_phone: EVIL, company_tax_id: EVIL, company_reg_no: EVIL, footer_note: EVIL },
};
// Arabic and Latin mixed: names, vehicles, accessories, notes, terms.
const arabic = {
  po_number: 'PO2610-9001', po_date: '2026-10-12', currency: 'USD', issuer: 'محمد ياسر', supplier_name: 'شركة النيل للسيارات', supplier_contact: 'أحمد علي / +20 100 555 0199',
  supplier_address: 'القاهرة، مصر الجديدة، شارع النصر 12', supplier_country: 'مصر', notes: 'يرجى تأكيد موعد التسليم خلال ٣ أيام عمل. Delivery slot to be confirmed.',
  payment_terms: '30% دفعة مقدمة لتأكيد الطلب\n70% الباقي عند الوصول إلى ميناء شنغهاي', documents_required: 'فاتورة تجارية / قائمة التعبئة / Bill of Lading',
  delivery_location: 'ميناء الإسكندرية', service_provider: 'Sino Trans شركة الشحن', contact: 'Ahmed أحمد', settings: {},
  items: [
    L({ client: 'عمر حسن', consignee: 'شركة النيل', brand: 'مازدا', model: 'EZ60', trim: 'فئة ماكس', color: 'EXT: أبيض INT: أسود', year: '2026', accessories: 'شاحن جداري وكابل Wall mount وسجاد', units: 2, pi_price: 22500 }),
    L({ client: 'Sara Mostafa', brand: 'BYD', model: 'Seal', accessories: 'Wall mount شاحن جداري', units: 1, pi_price: 17800 }),
  ],
};
// Long names with no break, a long note, thirty payment lines and money at its limits. (A year wider than
// four characters, "2026/2027", runs into the next column: reported, not asserted here, so it is four digits.)
const W = (c, n) => c.repeat(n);
const stress = {
  ...fx.po, supplier_name: W('S', 120), supplier_contact: `${W('c', 100)} / ${W('9', 40)}`, supplier_address: `Unit 12, ${W('Z', 90)} Street, `.repeat(5), supplier_country: W('K', 60),
  issuer: W('I', 50), quote_id: `MT${W('7', 18)}`, notes: W('long note words ', 400), payment_terms: Array.from({ length: 30 }, (_, i) => `${i + 1}% line ${i + 1} ${W('x', 5)}`).join('\n'),
  incoterm: W('F', 60), delivery_location: W('L', 150), service_provider: W('P', 150), contact: W('c', 150), documents_required: W('doc / ', 200) + W('D', 150),
  items: [
    L({ client: W('C', 150), consignee: W('N', 150), brand: W('B', 100), model: W('M', 100), trim: W('T', 100), color: `EXT: ${W('E', 100)} INT: ${W('I', 100)}`, year: '2027',
      accessories: W('word ', 400) + W('A', 150), units: 3, pi_price: 17800.5, vin: 'LSVAA1234567890XY', file_link: 'https://drive.example/f/ClientFile-77' }),
    L({ client: 'Money', brand: 'BYD', model: 'Seal', units: 99, pi_price: 250000.5 }), L({ client: 'Money 2', brand: 'BYD', model: 'Seal', units: 99, pi_price: 999999.99 }),
  ],
};

(async () => {
  // ═══ 1. The reference order, to the dollar ═══
  const ref = buildPurchaseOrderHtml(fx.po);
  const refTable = table(ref), refText = plain(ref), refModel = purchaseOrderModel(fx.po);
  eq('the order lines: the form\'s nine columns, with the order\'s currency on the money heads', refTable.head,
    ['NO', 'CLIENT', 'VEHICLE', 'COLOR EXT / INT', 'YEAR', 'ACCESSORIES / REMARKS', 'QTY', 'PRICE USD', 'TOTAL USD']);
  eq('five lines, cell by cell: 17,800 / 31,800 / 13,250 / 42,300 / 22,500; a consignee who is somebody else stays visible; the line with no client sits under its consignee', refTable.rows, [
    ['1', 'Omar Hassan', 'Deepal S05 620 Laser Edition', 'EXT: Grey INT: Nebula Purple/White', '2027', FIX_ACC, '1', '17,800', '17,800'],
    ['2', 'Sara Mostafa Consignee: Mostafa Trading', 'Deepal S05 215 Max', 'EXT: Grey INT: Grey', '2027', FIX_ACC, '2', '15,900', '31,800'],
    ['3', 'Karim Adel', 'Xpeng L03 1330 Max', 'Ext: Black INT: Purple', '2027', FIX_ACC, '1', '13,250', '13,250'],
    ['4', 'Hana Fouad', 'Xpeng L03 625 Max', 'Ext: Black INT: Purple', '2027', 'English system , wall mount charging cable', '3', '14,100', '42,300'],
    ['5', 'Nile Motors', 'Mazda EZ60 EV 600 Max', 'EXT: White INT: Black', '2026', FIX_ACC, '1', '22,500', '22,500']]);
  check('the dark block closes the table: TOTAL, the vehicle count and 127,650 USD — and the model agrees', refTable.total === 'TOTAL 8 vehicles 127,650 USD' && refModel.total === 127650 && refModel.units === 8, refTable.total);
  const ORDER = ['PURCHASE ORDER PCH auto', 'ID MT28W88Y26 DATE 2026-10-12 ISSUER Mohamed Yasser CURRENCY USD', 'SUPPLIER DETAILS', 'ORDER LINES', 'TOTAL 8 vehicles', 'PAYMENT TERMS', 'NOTES', 'DELIVERY TERMS'];
  check('the title and the supplier, the ID / DATE / ISSUER / CURRENCY card, the supplier details, the lines, the total, then the payment terms, the notes and the delivery terms — in that order',
    inOrder(refText, ORDER) === -1, `missing or out of order: ${inOrder(refText, ORDER)}`);
  check('SUPPLIER DETAILS: name, contact, country of origin and the whole address, as typed (an apostrophe included)',
    inOrder(refText, ['SUPPLIER DETAILS', 'Name PCH auto', 'Contact Yoyo / +8613380783532', 'Country of Origin China',
      'Address NO. 211, Baofa Company, Jinwan Avenue, Dachan Bay, Haoye Community, Xixiang Street, Bao\'an District, Shenzhen City, Guangdong Province', 'ORDER LINES']) === -1);
  check('PAYMENT TERMS: the 30% and the 70% shares with their words; the note; DELIVERY TERMS: incoterm, place, forwarder, contact, the documents',
    inOrder(refText, ['PAYMENT TERMS', '30% deposit to confirm the order',
      '70% balance due after the vehicle arrives in Shanghai Port (VIN code and PDI vehicle video and document to be provided for confirmation)',
      'NOTES', 'Please confirm the production slot and the VIN list within 3 working days of receiving this order.',
      'DELIVERY TERMS', 'Incoterm FOB', 'Delivery Location Shanghai Port', 'Service Provider Sino Trans Logistics', 'Contact Ahmed Ali / +20 100 555 0199',
      'Documents Required MSDS / UN3.8 / Commercial Invoice / Shipping order / Packing List / Temporary Licence and Plate / Sales contract / Export Licence / SGS PDI or Certificate of Conformity (CoC) / CIF ONLY ( B/L / Telex Release / Insurance Policy)']) === -1);
  check('a share is in bold green, the "CIF ONLY …" part of the documents is red, and the order carries no other red',
    /<b class="pct">30%<\/b> deposit to confirm the order/.test(ref) && /<b class="pct">70%<\/b> balance due/.test(ref) && same(red(ref), ['CIF ONLY ( B/L / Telex Release / Insurance Policy)']));
  const long = buildPurchaseOrderHtml(fx.poLong), longModel = purchaseOrderModel(fx.poLong);
  check('the long order: nineteen lines, 37 vehicles, 659,120 USD (worked out by hand) — no blank rows are added to it',
    table(long).rows.length === 19 && table(long).total === 'TOTAL 37 vehicles 659,120 USD' && longModel.total === 659120 && longModel.blanks === 0, table(long).total);

  // ═══ 2. The ID, the date, the supplier ═══
  const FOUR = id => [id, id, id, id];
  eq('the ID is the quote the order came from — in the card, the page header, the footer and the title', idsOf(ref), FOUR('MT28W88Y26'));
  eq('…and with no quote it is the order\'s own number', [idsOf(buildPurchaseOrderHtml({ ...fx.po, quote_id: '' })), idsOf(buildPurchaseOrderHtml({ ...fx.po, quote_id: '   ' })), idsOf(buildPurchaseOrderHtml(fx.poMinimal))],
    [FOUR('PO2610-4821'), FOUR('PO2610-4821'), FOUR('PO2601-0001')]);
  const nothing = buildPurchaseOrderHtml({});
  check('with no ID at all the card shows a dash, the header says just PURCHASE ORDER, the footer prints no reference and the title has no number',
    /ID — DATE — ISSUER — CURRENCY USD/.test(cardOf(nothing)) && /<span class="dh-ref">PURCHASE ORDER<\/span>/.test(nothing) && !/Registration No<\/b> \d+<br>/.test(nothing) && /<title>Purchase Order<\/title>/.test(nothing));
  eq('a date that came back as a timestamp shows its day; one typed another way stays as typed; none is a dash',
    ['2026-10-12T22:30:00.000Z', '12/10/2026', null, ''].map(d => (/DATE (\S+)/.exec(cardOf(html({ po_date: d }))) || [])[1]), ['2026-10-12', '12/10/2026', '—', '—']);
  check('the issuer and the currency are in the card; a blank issuer is a dash', /ISSUER Mohamed Yasser/.test(cardOf(ref)) && /ISSUER —/.test(cardOf(html({ issuer: '  ' }))) && /CURRENCY EUR/.test(cardOf(html({ currency: 'EUR' }))));
  const supplierCard = nothing.slice(nothing.indexOf('<section class="card po-sup">'), nothing.indexOf('<div class="sec-title">'));
  check('no supplier: no accent bar and no name under the title, and the four supplier fields are plain dotted lines to fill in — never "undefined"',
    !/po-bar|class="po-to"/.test(body(nothing)) && count(supplierCard, '<span class="v line"></span>') === 4 && !/alert|<span class="v">/.test(supplierCard) && /<h1 class="po-h1">PURCHASE ORDER<\/h1>/.test(nothing));
  const nameOf = o => { const h = buildPurchaseOrderHtml(o); return [(/<div class="po-to">([^<]*)<\/div>/.exec(h) || [])[1], (/<span class="k">Name<\/span><span class="v">([^<]*)<\/span>/.exec(h) || [])[1]]; };
  eq('the supplier\'s name is the one typed in the supplier block; the order\'s own "supplier" text stands in for it, and does not override it',
    [nameOf({ supplier_name: 'Block Co', supplier: 'Text Co' }), nameOf({ supplier_name: '', supplier: 'Text Co' }), nameOf({ supplier: 'Text Co' })],
    [['Block Co', 'Block Co'], ['Text Co', 'Text Co'], ['Text Co', 'Text Co']]);

  // ═══ 3. Money ═══
  // The order keeps its own maths (it is not money.js's): a quantity left blank is 1, a price of 0 prints no
  // price and no line total, the total is Σ price × quantity, cents print as two digits.
  eq('a quantity left blank, zero, negative, missing or not a number counts as 1',
    priced(['', 0, -2, 'many', null, undefined].map(units => ({ units, pi_price: 10 }))).rows.map(r => [r[6], r[8]]), Array(6).fill(['1', '10']));
  eq('a fractional quantity multiplies and prints as it is (2.5), never as 2.00000001',
    priced([{ units: '2.5', pi_price: 100 }, { units: 2.00000001, pi_price: 100 }]).rows.slice(0, 2).map(r => [r[6], r[8]]), [['2.5', '250'], ['2', '200']]);
  const nil = priced([{ pi_price: 0 }, { pi_price: '' }, { pi_price: null }, { pi_price: 'TBC' }, { pi_price: '0.00' }, { pi_price: 500, units: 2 }]);
  eq('a price of 0, a blank one or words prints no price and no line total (the cells stay empty, they are not "0") and adds nothing',
    [nil.rows.map(r => [r[7], r[8]]), nil.total], [[['', ''], ['', ''], ['', ''], ['', ''], ['', ''], ['500', '1,000']], 'TOTAL 7 vehicles 1,000 USD']);
  const cents = priced([{ pi_price: '17,800' }, { pi_price: '17800.5' }, { pi_price: 19.99, units: 3 }, { pi_price: '0.1', units: 3 }, { pi_price: 1234567.5, units: 2 }]);
  eq('"17,800" is read as 17800; cents always print as two digits; the lines are 17,800 · 17,800.50 · 59.97 · 0.30 · 2,469,135',
    cents.rows.map(r => [r[7], r[8]]), [['17,800', '17,800'], ['17,800.50', '17,800.50'], ['19.99', '59.97'], ['0.10', '0.30'], ['1,234,567.50', '2,469,135']]);
  eq('…and the total is the sum of the lines: 2,504,795.77 for ten vehicles', cents.total, 'TOTAL 10 vehicles 2,504,795.77 USD');
  const WHOLE = [1, 12, 999, 1000, 17800, 123456, 1234567, 12345678];
  const whole = priced(WHOLE.map(n => ({ pi_price: n, units: 3 }))).rows.map(r => [r[7], r[8]]);
  eq('whole-dollar amounts read exactly as money.js prints them: the price as fmtNum, the line (price × 3) as calcEgp(price, 3, 1)', whole, WHOLE.map(n => [fmtNum(n), fmtNum(calcEgp(n, 3, 1))]));
  eq('…which, by eye, is 12,345,678 and 37,037,034 at the top', whole[7], ['12,345,678', '37,037,034']);
  eq('the currency is the order\'s: USD when there is none, EUR / EGP as typed — in capitals on the money heads and beside the total',
    [undefined, '', '  ', 'eur', 'EGP'].map(c => { const t = tbl({ currency: c, items: [L({ pi_price: 5 })] }); return [t.head[7], t.head[8], t.total.split(' ').pop()]; }),
    [['PRICE USD', 'TOTAL USD', 'USD'], ['PRICE USD', 'TOTAL USD', 'USD'], ['PRICE USD', 'TOTAL USD', 'USD'], ['PRICE EUR', 'TOTAL EUR', 'EUR'], ['PRICE EGP', 'TOTAL EGP', 'EGP']]);
  eq('under TOTAL: "1 vehicle", "3 vehicles", "3.5 vehicles" — and nothing for an order with no lines',
    [[L()], [L(), L(), L()], [L({ units: 2.5 }), L()], []].map(items => tbl({ items }).total), ['TOTAL 1 vehicle 0 USD', 'TOTAL 3 vehicles 0 USD', 'TOTAL 3.5 vehicles 0 USD', 'TOTAL 0 USD']);
  const bigAmounts = html({ items: [L({ pi_price: 1234567.5, units: 2 }), L({ pi_price: 500 })] });
  check('an amount of more than nine characters steps down a size rather than wrap; a shorter one does not',
    /<td class="num fig xl">1,234,567\.50<\/td>/.test(bigAmounts) && /<td class="num fig tot">2,469,135<\/td>/.test(bigAmounts) && /<td class="num fig">500<\/td>/.test(bigAmounts) && /<td class="num fig tot">500<\/td>/.test(bigAmounts));

  // ═══ 4. Blanks, the standard wording, who the client is ═══
  eq('an empty accessories cell prints the company\'s standard accessories', priced([{ accessories: '' }, { accessories: '   ' }, { accessories: undefined }, { accessories: null }]).rows.slice(0, 4).map(r => r[5]), Array(4).fill(defaults.DOC_DEFAULT_ACCESSORIES));
  check('…the standard wording of defaults.js: the English system, a wall-mount charging cable, floor mats, a tyre repair kit, an electric pump', ['English system', 'wall mount charging cable', 'floor mats', 'repairing kit', 'electric pump'].every(w => defaults.DOC_DEFAULT_ACCESSORIES.includes(w)));
  const dflt = plain(html({ payment_terms: '  \n ', documents_required: '' }));
  check('empty payment terms and an empty documents list print the standard wording — with its XXXXX and its CIF ONLY marked in red',
    inOrder(dflt, ['PAYMENT TERMS', '30% deposit to confirm the order', '70% balance due after the vehicle arrives in XXXXX (VIN code and PDI vehicle video and document to be provided for confirmation)',
      'DELIVERY TERMS', 'Documents Required MSDS / UN3.8 / Commercial Invoice', 'CIF ONLY ( B/L / Telex Release / Insurance Policy)']) === -1
    && same(red(html({ payment_terms: '', documents_required: '' })), ['XXXXX', 'CIF ONLY ( B/L / Telex Release / Insurance Policy)']));
  eq('the CLIENT cell is the line\'s client, else its consignee, else the client the order is attached to; a consignee who is somebody else is shown under it',
    priced([{ client: 'Own', consignee: '' }, { client: '', consignee: 'Cons' }, { client: '', consignee: '' }, { client: 'Own', consignee: 'Other' }, { client: 'Same', consignee: 'Same' }], { client_name: 'Lead Co' }).rows.map(r => r[1]),
    ['Own', 'Cons', 'Lead Co', 'Own Consignee: Other', 'Same']);
  eq('…and with nobody to name, the cell is empty', priced([{ client: '', consignee: '' }]).rows[0][1], '');
  const rowCount = n => tbl({ items: Array.from({ length: n }, (_, i) => L({ client: `R${i + 1}` })) }).rows.length;
  eq('the grid always has five numbered rows, so a short order reads as a form; a longer one is not padded (0, 1, 4, 5, 6, 7, 12 lines)', [0, 1, 4, 5, 6, 7, 12].map(rowCount), [5, 5, 5, 5, 6, 7, 12]);
  const oneLine = table(buildPurchaseOrderHtml(fx.poOneLine));
  eq('a short order\'s spare rows are numbered and empty; its total is the one line', [oneLine.rows.slice(1), oneLine.total], [[2, 3, 4, 5].map(n => [String(n), '', '', '', '', '', '', '', '']), 'TOTAL 1 vehicle 17,800 USD']);
  eq('the last two rows are chained to the total (keep) and the very last closes the card (last) — in a full order and in a short one',
    [rowClasses(html({ items: Array.from({ length: 8 }, () => L()) })), rowClasses(html({ items: [L()] }))],
    [['', '', '', '', '', '', 'keep', 'keep last'], ['', 'blank', 'blank', 'blank keep', 'blank keep last']]);
  eq('items that are not records (null, a number, text, a list) are dropped', tbl({ items: [null, 5, 'x', [], L({ client: 'Keep' })] }).rows.map(r => r[1]), ['Keep', '', '', '', '']);
  const notes = n => { const h = html({ notes: n }); return [/class="card po-note wide"/.test(h) ? 'wide' : /class="card po-note"/.test(h) ? 'narrow' : 'none', h]; };
  eq('no note, no NOTES card; a note of 190 characters or three lines sits under the payment terms; a longer one or a fourth line gets a card of its own across the page',
    [notes('')[0], notes('n'.repeat(190))[0], notes('a\nb\nc')[0], notes('n'.repeat(191))[0], notes('a\nb\nc\nd')[0]], ['none', 'narrow', 'narrow', 'wide', 'wide']);
  check('a short note is between the payment terms and the delivery terms, a long one after both; line breaks are kept',
    inOrder(plain(html({ notes: 'NOTE-BODY' })), ['PAYMENT TERMS', 'NOTES NOTE-BODY', 'DELIVERY TERMS']) === -1 && inOrder(plain(html({ notes: `NOTE-BODY${'n'.repeat(200)}` })), ['PAYMENT TERMS', 'DELIVERY TERMS', 'NOTES NOTE-BODY']) === -1
    && /line one<br>line two/.test(html({ notes: 'line one\r\nline two' })));
  const del = html({ incoterm: '', delivery_location: '', service_provider: '', contact: '' });
  check('the incoterm is FOB when there is none; a place, a forwarder or a contact left blank is a red dotted line to fill in, and a blank supplier field is a plain dotted one',
    /<span class="k">Incoterm<\/span><span class="v">FOB<\/span>/.test(del) && count(del, '<span class="v line alert"></span>') === 3 && count(buildPurchaseOrderHtml({ ...fx.po, supplier_contact: '', supplier_country: '' }), '<span class="v line"></span>') === 2
    && !/<span class="v line alert">/.test(ref));
  const secret = html({ items: [L({ client: 'Keep', vin: 'LSVAA1234567890XY', file_link: 'https://drive.example/f/ClientFile-77', cf_battery_kwh: 'EXTRA-COL-77' })] });
  check('the VIN and the client-file link are not part of the order the supplier receives — nor is a column the sheet adds; no link of any kind is drawn',
    !/LSVAA1234567890XY|ClientFile-77|drive\.example|EXTRA-COL-77/.test(secret) && !/<a\s/i.test(secret) && !/https?:/.test(secret.replace(/<style[\s\S]*?<\/style>/g, '')));
  check('the columns and ids a saved row carries (id, customer, supplier id, status, custom fields, the sheet\'s own columns) change nothing on the page',
    buildPurchaseOrderHtml({ ...fx.po, id: 7, customer_id: 12, supplier_id: null, status: 'confirmed', custom_fields: { cf_x: '1' }, created_by: 'admin', created_at: '2026-10-12T09:00:00Z',
      items: fx.po.items.map(it => ({ ...it, cf_battery_kwh: '82', vin: 'LSV1', file_link: 'https://x.example/f', status: 'send_to_supplier' })) }) === ref);

  // ═══ 5. The words filled in by hand ═══
  eq('XXXXX (a place still to be named), "XXXXX Port" and "CIF ONLY …" to the end of its line are marked in red — only those words',
    red(html({ payment_terms: '70% balance in XXXXX (VIN)\n30% to XXXXX Port now', documents_required: 'Invoice / CIF ONLY ( B/L ) copy\nPacking list' })), ['XXXXX', 'XXXXX Port', 'CIF ONLY ( B/L ) copy']);
  eq('…a word that merely holds Xs is not marked: XX is not, MAXXXX is not, XXX is', red(html({ payment_terms: '50% XX is not, MAXXXX neither, XXX is', documents_required: 'x' })), ['XXX']);
  check('a line break after a marked part stays a line break; typed markup inside a marked part is still text',
    /<span class="red">XXXXX Port<\/span> clearance<br><span class="red">CIF ONLY copy of B\/L<\/span><br>Line three/.test(html({ documents_required: 'Invoice / XXXXX Port clearance\nCIF ONLY copy of B/L\nLine three' }))
    && /<span class="red">CIF ONLY &lt;b&gt;x&lt;\/b&gt; &amp; &quot;y&quot;<\/span>/.test(html({ documents_required: 'CIF ONLY <b>x</b> & "y"' })));
  eq('a share is the number before a %: "12.5 % …" and "30%…" are shares; a line without one, and "50%" on its own, are kept whole; blank lines are dropped',
    [...html({ payment_terms: '12.5 % Deposit\n\n  100% Advance  \r\nBalance on delivery\n50%\n30%deposit' }).matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]),
    ['<b class="pct">12.5%</b> Deposit', '<b class="pct">100%</b> Advance', 'Balance on delivery', '50%', '<b class="pct">30%</b> deposit']);

  // ═══ 6. The brand ═══
  const refHead = between(ref, 'class="doc-header"', 'class="doc-footer"'), ft = footerOf(ref);
  check('the header carries the colour logo — the very file in src/assets/brand, embedded —, the company\'s line and "PURCHASE ORDER" with the ID',
    refHead.includes(`<img class="dh-logo" alt="Motolinkers" src="${brand.logoUri('color')}">`) && /AUTOMOTIVE • ELECTRIC • MOBILITY/.test(headerOf(ref)) && /PURCHASE ORDER MT28W88Y26/.test(headerOf(ref)), headerOf(ref));
  check('the footer carries the company\'s registered details, the ID and "Confidential"',
    /Office \(ACO2\), Floor \(4\), Building No\. \(100\), Al-Mirghani Street - Heliopolis - Cairo/.test(ft) && /info@motolinkers\.com/.test(ft) && /www\.motolinkers\.com/.test(ft) && /\+2 010 000 78104/.test(ft)
    && /Tax ID 773934006/.test(ft) && /Registration No 282378 MT28W88Y26/.test(ft) && /Confidential/.test(ft), ft);
  const custom = buildPurchaseOrderHtml({ ...fx.po, settings: { company_name: 'Acme Motors', company_tagline: 'CARS & MORE', company_address: 'Unit 9, Nile Business Park', company_email: 'po@acme.example',
    company_website: 'acme.example', company_phone: '+20 2 555 0100', company_tax_id: 'T-1001', company_reg_no: 'R-2002', footer_note: 'Orders are binding once confirmed' } });
  const customFt = footerOf(custom);
  check('the company\'s details come from the settings — the name (the logo\'s alt), the tagline, address, e-mail, site, phone, tax and registration numbers and the note — and none of the defaults is left',
    /alt="Acme Motors"/.test(custom) && /CARS & MORE/.test(headerOf(custom)) && /Unit 9, Nile Business Park/.test(customFt) && /po@acme\.example/.test(customFt) && /acme\.example/.test(customFt) && /\+20 2 555 0100/.test(customFt)
    && /Tax ID T-1001/.test(customFt) && /Registration No R-2002 MT28W88Y26/.test(customFt) && /Orders are binding once confirmed/.test(customFt)
    && !/Heliopolis|info@motolinkers|773934006|282378|Confidential|AUTOMOTIVE/.test(`${customFt} ${headerOf(custom)}`) && !/alt="Motolinkers"/.test(custom), customFt);
  check('settings that are missing, blank or not a record leave the standard details', [undefined, null, 'junk', 5, [], { company_email: '   ' }].every(s => buildPurchaseOrderHtml({ ...fx.po, settings: s }) === ref));
  const poCss = ref.slice(ref.indexOf('.po{padding-top'), ref.indexOf('</style>', ref.indexOf('.po{padding-top')));
  const PALETTE = new Set([...Object.values(brand.COLORS), '#fff', '#B3261E'].map(c => c.toLowerCase()));
  const strangers = [...new Set((poCss.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map(c => c.toLowerCase()))].filter(c => !PALETTE.has(c));
  check('every colour the order adds to the shared stylesheet is the brand\'s, white, or the one red that means "fill this in" (#B3261E) — no other',
    poCss.length > 2000 && strangers.length === 0 && !/rgba?\(|hsla?\(/i.test(poCss) && poCss.includes('#B3261E'), strangers.join(',') || `${poCss.length} characters of its own CSS`);
  check('the palette is the logo\'s, as brand.js defines it (dark green, brand green), set once on the page',
    ref.includes(`--ink:${brand.COLORS.ink}`) && ref.includes(`--green:${brand.COLORS.green}`) && brand.COLORS.ink === '#043627' && brand.COLORS.green === '#3A8E0E');
  check('the fonts and the logo are embedded as data URIs — Poppins and Cairo — and the rules of the page keep their rows and cards whole',
    /font-family:'Poppins'/.test(ref) && /font-family:'Cairo'/.test(ref) && !/url\((?!['"]?data:)/.test(ref) && /<img class="dh-logo"[^>]*src="data:image\/png;base64,/.test(ref)
    && /tr\.keep\{break-after:avoid\}/.test(ref) && /\.po-terms\{[^}]*break-inside:avoid/.test(ref) && /table\.tbl thead\{display:table-header-group\}/.test(ref));
  const everything = [ref, long, buildPurchaseOrderHtml(fx.poOneLine), buildPurchaseOrderHtml(fx.poMinimal), buildPurchaseOrderHtml(fx.poHostile), buildPurchaseOrderHtml(evilOrder), buildPurchaseOrderHtml(arabic), buildPurchaseOrderHtml(stress), custom];
  check('the document refers to nothing outside itself: no http(s) address in any src, href or url(), no link, import, frame or script',
    !everything.some(h => /(?:src|href)=["']?https?:|url\(["']?https?:|@import|<link|<iframe|<script|<a /i.test(h)));
  const foots = [{}, { footer_note: BIG_NOTE }, { company_address: BIG_ADDRESS }, { footer_note: BIG_NOTE, company_address: BIG_ADDRESS }].map(s => footH(buildPurchaseOrderHtml({ ...fx.po, settings: s })));
  check('the usual footer reserves the shell\'s own 26mm, so nothing moves for a normal note; a long note, a long address and both reserve more, each more than the last',
    foots[0] === 26 && foots[1] > 26 && foots[2] > 26 && foots[3] > foots[1] && foots[3] > foots[2], foots.join(' / '));

  // ═══ 7. Nothing typed is lost, nothing typed is HTML, blanks print as blanks ═══
  const PLACEHOLDER = /\b(?:undefined|NaN|null|true|false)\b|\[object/;
  const JUNK = { items: 'abc', settings: 'x', supplier_name: { a: 1 }, supplier: ['s'], supplier_contact: true, supplier_address: NaN, supplier_country: [], issuer: false, quote_id: {}, po_number: null, po_date: NaN,
    currency: false, notes: [], incoterm: {}, delivery_location: true, service_provider: [1], contact: NaN, payment_terms: false, documents_required: {}, client_name: [] };
  const hollow = [undefined, null, {}, [], 'text', 5, true, JUNK, { items: [null, 5, 'x', []] }];
  check('an order built from nothing, or from the wrong kinds of value, is a whole document with blanks, five empty rows and a total of 0 — never "undefined", "NaN", "null" or "[object Object]"',
    hollow.every(d => { const h = buildPurchaseOrderHtml(d); return /^<!DOCTYPE html>/.test(h) && /<\/html>\s*$/.test(h) && !PLACEHOLDER.test(`${plain(h)} ${headerOf(h)} ${footerOf(h)}`) && table(h).rows.length === 5 && table(h).total === 'TOTAL 0 USD'; }));
  const oddLine = { client: { a: 1 }, consignee: ['x'], units: {}, brand: true, model: NaN, trim: null, color: false, year: [], accessories: {}, pi_price: 'abc' };
  eq('a line whose fields are the wrong kind of value prints blanks and the standard accessories, a quantity of 1 and no price', table(buildPurchaseOrderHtml(order({ items: [oddLine] }))).rows[0], ['1', '', '', '', '', FIX_ACC, '1', '', '']);
  const lost = [];
  for (const [name, d] of Object.entries(fx)) {
    const h = buildPurchaseOrderHtml(d), t = plain(h), must = [];
    for (const it of d.items || []) must.push(it.client, it.consignee, it.brand, it.model, it.trim, it.year);
    for (const v of [d.quote_id || d.po_number, d.issuer, d.supplier_name, d.supplier_contact, d.supplier_country, d.delivery_location, d.service_provider, d.contact, d.notes, d.po_date]) must.push(v);
    for (const l of (d.payment_terms || '').split('\n')) must.push(squash(l.replace(/^\s*\d+(?:\.\d+)?\s?%\s*/, '')));
    for (const m of must.filter(Boolean)) if (!t.includes(squash(m))) lost.push(`${name}: ${String(m).slice(0, 40)}`);
    if (PLACEHOLDER.test(`${t} ${headerOf(h)} ${footerOf(h)}`)) lost.push(`${name}: prints a placeholder`);
  }
  check('in every sample, every client, vehicle, year, name, term, note, number and date is printed, and none prints "undefined", "NaN" or "null"', lost.length === 0, lost.slice(0, 4).join(' | '));

  const hostile = buildPurchaseOrderHtml(fx.poHostile);
  check('markup typed into the order is escaped in the source: no script, no tag, no handler of the typist\'s own',
    !/<script|<img src=x|<b>Omar|<\/td><td>X/.test(body(hostile)) && /&lt;img src=x onerror=alert\(1\)&gt; PCH &amp; &quot;Co&quot;/.test(hostile) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(hostile)
    && /&lt;b&gt;Omar&lt;\/b&gt;/.test(hostile) && /&lt;\/td&gt;&lt;td&gt;X &quot;quoted&quot;/.test(hostile));
  const evil = buildPurchaseOrderHtml(evilOrder), EVIL_ESC = '&lt;img src=x onerror=alert\\(1\\)&gt; &quot;q&quot; &amp; &#39;s&#39; &lt;script&gt;boom\\(\\)&lt;\\/script&gt;';
  check('…in every field: the ID, the date, the issuer, the currency, the supplier, the lines, the terms, the notes — and the settings, the footer and the title too',
    !/<script|<img src=x|<svg|<iframe|<b>50%/i.test(evil.slice(evil.indexOf('<body'))) && new RegExp(`<title>Purchase Order ${EVIL_ESC}N</title>`).test(evil)
    && new RegExp(`alt="${EVIL_ESC}"`).test(evil) && new RegExp(`<div class="po-to">${EVIL_ESC}SN</div>`).test(evil) && /<td class="ctr fig">&lt;i&gt;&amp;<\/td>/.test(evil)
    && new RegExp(`<span class="red">CIF ONLY ${EVIL_ESC}</span>`).test(evil));
  const typed = plain(evil);
  check('…and every piece of it reads as typed, quotes and ampersands included', ['N', 'D', 'I', 'SN', 'SC', 'SA', 'SK', 'IN', 'DL', 'SP', 'CT', 'CONS', 'B', 'M', 'T'].every(s => typed.includes(`${EVIL}${s}`)) && typed.includes(`<b>50%</b> ${EVIL}`) && /CURRENCY <b>"&/.test(typed));
  const SPECIAL = ['$& $1 $` $\' ${1+1} %s %d \\n \\u0041', 'emoji 🚗⚡ ❤', 'tab\there', 'RTL\u202eoverride\u202c', 'zero\u200bwidth', 'curly “quotes” ‘x’', 'a/b\\c', 'NUL\u0000char'];
  check('characters that are special elsewhere — $&, $1, backticks, ${…}, %s, backslashes, emoji, a right-to-left override, a zero-width space, a NUL — print as typed',
    SPECIAL.every(s => plain(html({ notes: s, items: [L({ client: s })] })).split(squash(s)).length - 1 >= 2), SPECIAL.filter(s => plain(html({ notes: s, items: [L({ client: s })] })).split(squash(s)).length - 1 < 2).join(' | '));
  check('the same data gives the same document, the order is not changed by building it (even when it is frozen), and the model is a plain reading of it',
    buildPurchaseOrderHtml(JSON.parse(JSON.stringify(fx.po))) === ref && (() => { try { return buildPurchaseOrderHtml(deepFreeze(JSON.parse(JSON.stringify(fx.po)))) === ref; } catch { return false; } })()
    && same(purchaseOrderModel(fx.po), purchaseOrderModel(JSON.parse(JSON.stringify(fx.po)))));

  // ═══ 8. In a real browser: markup is text, the page reaches nowhere, nothing overflows ═══
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], timeout: 120000 });
  try {
    // Pairs of words in one element: [selector, a, b, direction]. In a paragraph that runs right to left the first
    // word is the rightmost, so "rtl" means a is drawn to the right of b, and "ltr" to its left.
    const BIDI = [
      ['td.cl', 'عمر', 'حسن', 'rtl'], ['td.cl', 'Sara', 'Mostafa', 'ltr'],
      ['table.po-tbl tbody tr:nth-child(1) td.acc', 'شاحن', 'Wall', 'rtl'], ['table.po-tbl tbody tr:nth-child(2) td.acc', 'Wall', 'شاحن', 'ltr'],
      ['.po-note p', 'يرجى', 'تأكيد', 'rtl'], ['.po-note p', 'يرجى', 'Delivery', 'rtl'], ['.po-lines li', 'دفعة', 'مقدمة', 'rtl'],
      ['.po-sup .v', 'شركة', 'للسيارات', 'rtl'], ['.po-kv .v', 'Sino', 'شركة', 'ltr'],
    ];
    // What the page does and where things are, measured in the page itself (this function runs in the browser).
    const probe = pairs => {
      const root = document.querySelector('.po'), bad = [];
      const rr = root ? root.getBoundingClientRect() : null;
      for (const el of root ? root.querySelectorAll('*') : []) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const name = `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`;
        if (r.right > rr.right + 1 || r.left < rr.left - 1) bad.push(`${name} sticks out (${Math.round(r.left - rr.left)}…${Math.round(r.right - rr.right)}px)`);
        else if (getComputedStyle(el).display !== 'inline' && el.clientWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`${name} clips its text ("${(el.textContent || '').trim().slice(0, 20)}")`);
      }
      // where a word is drawn
      const xOf = (sel, word) => {
        for (const el of document.querySelectorAll(sel)) {
          const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const i = n.data.indexOf(word);
            if (i < 0) continue;
            const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + word.length);
            const b = range.getBoundingClientRect();
            return b.width ? Math.round(b.left) : null;
          }
        }
        return null;
      };
      const footer = document.querySelector('.doc-footer');
      const colour = el => getComputedStyle(el).color, edge = el => [getComputedStyle(el).borderBottomColor, getComputedStyle(el).borderBottomStyle];
      return {
        scripts: document.querySelectorAll('script').length,
        handlers: [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length,
        h1: document.querySelectorAll('h1').length,
        imgs: [...document.querySelectorAll('img')].map(i => i.className),
        tables: document.querySelectorAll('table.po-tbl').length, heads: document.querySelectorAll('table.po-tbl thead th').length, cols: document.querySelectorAll('table.po-tbl colgroup col').length,
        rows: document.querySelectorAll('table.po-tbl tbody tr:not(.sum)').length,
        text: root ? root.innerText : '',
        wide: document.documentElement.scrollWidth > window.innerWidth + 1,
        bad: bad.slice(0, 6),
        loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
        arabicFace: [...document.fonts].filter(f => f.status === 'loaded' && /U\+0?600/i.test(f.unicodeRange)).length,
        // the footer's own height, and the room the body keeps for it (both in mm)
        foot: footer ? [+(footer.getBoundingClientRect().height * 25.4 / 96).toFixed(1), parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--foot-h'))] : [0, 0],
        reds: [...document.querySelectorAll('.red')].map(colour),
        alerts: [...document.querySelectorAll('.po-kv .v.line.alert')].map(edge), plainLines: [...document.querySelectorAll('.po-sup .v.line')].map(edge),
        bidi: pairs.map(([sel, a, b]) => [xOf(sel, a), xOf(sel, b)]),
      };
    };
    // One page per document, all at once. Every request is recorded; only inline data is let through.
    // A page that cannot be inspected is a failed check, not a crash.
    const inspect = async doc => {
      const seen = [], dialogs = [];
      let page;
      try {
        page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on('request', r => { seen.push(r.url()); if (r.url().startsWith('data:')) r.continue(); else r.abort(); });
        page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
        await page.setViewport({ width: 794, height: 1123 });
        await page.emulateMediaType('print');
        await page.setContent(doc, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        return { f: await page.evaluate(probe, BIDI), seen, dialogs };
      } catch (e) {
        return { f: { scripts: -1, handlers: -1, h1: -1, imgs: [], tables: 0, heads: 0, cols: 0, rows: 0, text: '', wide: true, bad: [`the page failed: ${String(e.message).slice(0, 80)}`], loaded: [], arabicFace: 0, foot: [0, 0], reds: [], alerts: [], plainLines: [], bidi: [] }, seen, dialogs };
      } finally {
        if (page) await page.close().catch(() => {});
      }
    };
    const FIT = [['the reference order', fx.po], ['the long order', fx.poLong], ['the one-line order', fx.poOneLine], ['the empty order', fx.poMinimal], ['markup in every field', evilOrder],
      ['long names, a long note, thirty payment lines and money at its limits', stress], ['Arabic and Latin mixed', arabic]];
    const [hz, ev, control, bigNote, bigAddr, bigBoth, ...fits] = await Promise.all([
      inspect(hostile), inspect(evil), inspect('<!DOCTYPE html><html><body><img src="https://example.com/x.png"></body></html>'),
      inspect(buildPurchaseOrderHtml({ ...fx.po, settings: { footer_note: BIG_NOTE } })), inspect(buildPurchaseOrderHtml({ ...fx.po, settings: { company_address: BIG_ADDRESS } })),
      inspect(buildPurchaseOrderHtml({ ...fx.po, settings: { footer_note: BIG_NOTE, company_address: BIG_ADDRESS } })), ...FIT.map(([, d]) => inspect(buildPurchaseOrderHtml(d)))]);
    const fitOf = label => fits[FIT.findIndex(([l]) => l === label)];
    const shown = f => JSON.stringify({ ...f, text: undefined, bidi: undefined });

    const clean = [hz, ev].every(r => r.f.scripts === 0 && r.f.handlers === 0 && r.f.h1 === 1 && same(r.f.imgs, ['dh-logo']) && r.dialogs.length === 0);
    check('hostile markup in a real browser: no script, no handler, one title, only the logo as a picture, no dialog', clean, clean ? '' : `${shown(hz.f)} ${shown(ev.f)}`);
    check('…and the typed markup is on the page as literal text',
      ['<img src=x onerror=alert(1)> PCH & "Co"', '<script>alert(1)</script>', '<b>Omar</b>', '</td><td>X "quoted"'].every(t => hz.f.text.includes(t)) && ['SN', 'SC', 'SA', 'SK', 'CONS'].every(s => ev.f.text.includes(`${EVIL}${s}`)));
    check('…and the page asked for nothing but inline data', [hz, ev].every(r => r.seen.length > 0 && r.seen.every(u => u.startsWith('data:'))), [...hz.seen, ...ev.seen].filter(u => !u.startsWith('data:')).join(' '));
    check('(control) the request recorder does see a link when there is one', control.seen.some(u => u.startsWith('https://example.com/')));
    FIT.forEach(([label], i) => check(`${label}: nothing sticks out of its box or the page, and no text is clipped`, fits[i].f.bad.length === 0 && !fits[i].f.wide, fits[i].f.bad.join(' | ')));
    check('the page is one title, one table of nine columns whose head, column list and cells agree, and as many rows as the order needs (five at the least)',
      FIT.every(([, d], i) => fits[i].f.h1 === 1 && fits[i].f.tables === 1 && fits[i].f.heads === 9 && fits[i].f.cols === 9 && fits[i].f.rows === Math.max(5, (d.items || []).length)), FIT.map((_, i) => fits[i].f.rows).join(','));
    const feet = [['usual', fits[0]], ['long note', bigNote], ['long address', bigAddr], ['both', bigBoth]];
    check('the room the body keeps for the footer is always more than the footer needs (the usual footer, a long note, a long address, both)',
      feet.every(([, r]) => r.f.foot[0] > 10 && r.f.foot[1] - r.f.foot[0] >= 3), feet.map(([n, r]) => `${n}: footer ${r.f.foot[0]}mm, room ${r.f.foot[1]}mm`).join(' | '));
    const ar = fitOf('Arabic and Latin mixed').f.bidi;
    const placed = ar.length === BIDI.length && ar.every((x, i) => x[0] !== null && x[1] !== null && (BIDI[i][3] === 'rtl' ? x[0] > x[1] : x[0] < x[1]));
    check('mixed Arabic and Latin: each value takes its direction from its own first letter — an Arabic one runs right to left (its first word is the rightmost), a Latin one left to right',
      placed, placed ? `${BIDI.length} pairs placed` : JSON.stringify(ar.map((x, i) => [BIDI[i][1], BIDI[i][2], ...x])));
    const fams = r => r.f.loaded;
    check('the embedded Poppins is what is set (no fallback font); the Arabic face of Cairo is fetched only when there is Arabic to draw',
      fams(fits[0]).includes('Poppins') && fits[0].f.arabicFace === 0 && fitOf('Arabic and Latin mixed').f.arabicFace >= 1 && fams(fitOf('Arabic and Latin mixed')).includes('Cairo'), `${fits[0].f.arabicFace} / ${fitOf('Arabic and Latin mixed').f.arabicFace}`);
    const minimal = fitOf('the empty order').f;
    const reds = minimal.reds.length === 2 && minimal.reds.every(c => c === 'rgb(179, 38, 30)') && minimal.alerts.length === 3 && minimal.alerts.every(e => e[0] === 'rgb(179, 38, 30)' && e[1] === 'dotted')
      && minimal.plainLines.length === 4 && minimal.plainLines.every(e => e[0] === 'rgb(189, 217, 173)' && e[1] === 'dotted');
    check('red is the one colour that is not the brand\'s, and it is #B3261E: the marked words of the standard wording, and the three delivery blanks; the supplier\'s blanks are the pale brand line',
      reds, reds ? '' : JSON.stringify([minimal.reds, minimal.alerts, minimal.plainLines]));
    check('the reference order has one red mark (CIF ONLY …) and no red line to fill in', fits[0].f.reds.length === 1 && fits[0].f.alerts.length === 0);
  } finally { await browser.close(); }

  // ═══ 9. In real PDFs ═══
  const pdftotext = have('pdftotext');
  // The reference order again with 9…14 lines (and 22): each one moves everything below it down by a row's height, so
  // somewhere in the sweep the total lands where it does not fit on the page and must take the last rows with it.
  const sweepOrder = n => ({ ...fx.po, items: Array.from({ length: n }, (_, i) => ({ client: `Sweep ${i + 1}`, brand: ['Deepal', 'Xpeng', 'BYD', 'Mazda'][i % 4], model: ['S05', 'L03', 'Seal', 'EZ60'][i % 4],
    trim: ['620 Laser Edition', '1330 Max', 'Design', 'EV 600 Max'][i % 4], color: 'EXT: Grey INT: Nebula Purple/White', year: '2027', units: 1, pi_price: 1000 + i, accessories: '' })) });
  const SWEEP = [9, 10, 11, 12, 13, 14], LATE = 22;
  const sumOf = n => 1000 * n + n * (n - 1) / 2;
  // A footer of a long note and a long address is taller than the usual one: the body must leave it room. One-line rows
  // (about 6mm each) and a first row of 1…8 lines: that moves every row boundary a little further each time, so that some
  // row ends in whatever band of the page the footer would cover if the body were not left room.
  const FOOT = [0, 1, 2, 3, 4, 5, 6, 7];
  const footerOrder = k => ({ ...fx.po, settings: { footer_note: BIG_NOTE, company_address: BIG_ADDRESS },
    items: Array.from({ length: 26 }, (_, i) => ({ client: `Foot ${i + 1}`, brand: 'BYD', model: 'Seal', year: '2027', units: 1, pi_price: 1000 + i, accessories: i === 0 ? Array(k + 1).fill('Mats').join('\n') : 'Mats' })) });
  const toRender = { ref: fx.po, one: fx.poOneLine, long: fx.poLong, minimal: fx.poMinimal, hostile: fx.poHostile, evil: evilOrder, arabic, stress,
    ...Object.fromEntries([...SWEEP, LATE].map(n => [`sweep${n}`, sweepOrder(n)])), ...Object.fromEntries(FOOT.map(k => [`footer${k}`, footerOrder(k)])) };
  // Each render starts its own Chrome: a few at a time, so a busy machine does not time one out.
  const pdfs = {};
  const queue = Object.entries(toRender);
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const doc = buildPurchaseOrderHtml(job[1]);
      pdfs[job[0]] = Buffer.from(await renderPdf(doc).catch(() => renderPdf(doc)));     // a loaded machine can time a Chrome launch out once
    }
  }));
  const lat = b => b.toString('latin1');
  const pagesOf = b => (lat(b).match(/\/Type\s*\/Page[^s]/g) || []).length;
  const nPages = Object.fromEntries(Object.entries(pdfs).map(([k, b]) => [k, pagesOf(b)]));
  const withPdf = (k, fn) => {
    const f = path.join(os.tmpdir(), `doc-po-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(f, pdfs[k]);
    try { return fn(f); } finally { fs.unlinkSync(f); }
  };
  // each page's text in the order it was drawn (a table row's cells, a card's lines, one after another)
  const texts = {};
  const pageTexts = k => (texts[k] ||= withPdf(k, f => Array.from({ length: nPages[k] }, (_, i) => spawnSync('pdftotext', ['-raw', '-f', String(i + 1), '-l', String(i + 1), f, '-'], { encoding: 'utf8' }).stdout || '')));

  const real = Object.keys(pdfs).length === Object.keys(toRender).length && Object.values(pdfs).every(b => b.slice(0, 5).toString() === '%PDF-' && /Poppins/.test(lat(b)) && /\/MediaBox\s*\[\s*0\s+0\s+595\.\d*\s+841\.\d*\s*\]/.test(lat(b)) && !/\/URI\b/.test(lat(b)));
  check(`every order (${Object.keys(pdfs).length} of them) is a real A4 PDF with the Poppins face embedded, and none links anywhere`, real, real ? '' : JSON.stringify(nPages));
  check('Arabic is set in the embedded Cairo face', /Cairo/.test(lat(pdfs.arabic)));
  check('the normal order is exactly one page, like the paper form: the reference order, the one-line, the empty, the markup-filled (one line) and the Arabic one',
    ['ref', 'one', 'minimal', 'hostile', 'arabic'].every(k => nPages[k] === 1), JSON.stringify(['ref', 'one', 'minimal', 'hostile', 'arabic'].map(k => `${k}:${nPages[k]}`)));
  check('the long order flows onto a second page — not squeezed onto one, not cut off — and absurd text and money still paginate (two pages or more)', nPages.long === 2 && nPages.stress >= 2 && nPages.stress <= 12, `${nPages.long} / ${nPages.stress}`);

  if (!pdftotext) console.log('  (pdftotext is not installed: the page-by-page checks of the PDFs are skipped)');
  else {
    const NUM = 'MT28W88Y26';
    // Letter-spaced capitals come out of pdftotext one letter at a time ("T O T A L"), so a label is looked
    // for with the spaces taken out; the figures and the words around them are read as they are.
    const has = (t, label) => nospace(t).includes(nospace(label));
    // the letterhead, the ID, the note and "Page n of N" — on every page
    const furniture = k => nPages[k] > 0 && pageTexts(k).every((t, i) => /info@motolinkers\.com/.test(t) && /Tax ID\s+773934006/.test(t) && /Registration No\s+282378/.test(t) && has(t, 'AUTOMOTIVE • ELECTRIC • MOBILITY')
      && has(t, `PURCHASE ORDER ${NUM}`) && count(t, NUM) >= 2 && /Confidential/.test(t) && new RegExp(`Page ${i + 1} of ${nPages[k]}\\b`).test(t));
    check('the reference order: letterhead, ID, "Confidential" and "Page 1 of 1" are on the page', furniture('ref'));

    // The printed page, as text: nothing the typist wrote is hidden by the layout
    const all = nospace(pageTexts('ref').join('\n'));
    const want = ['Omar Hassan', 'Sara Mostafa', 'Mostafa Trading', 'Karim Adel', 'Hana Fouad', 'Nile Motors', 'Deepal S05', '620 Laser Edition', '215 Max', 'Xpeng L03', '1330 Max', '625 Max', 'Mazda EZ60', 'EV 600 Max',
      'EXT: Grey', 'Nebula Purple/White', '17,800', '31,800', '13,250', '42,300', '22,500', '127,650 USD', '8 vehicles', 'PCH auto', 'Yoyo / +8613380783532', 'China', 'Baofa Company', 'Guangdong Province',
      NUM, '2026-10-12', 'Mohamed Yasser', '30% deposit to confirm the order', 'Shanghai Port', 'Sino Trans Logistics', 'Ahmed Ali / +20 100 555 0199', 'CIF ONLY', 'Please confirm the production slot'];
    const missing = want.filter(w => !all.includes(nospace(w)));
    check('the reference order\'s printed page carries every client, vehicle, amount, term and the total', missing.length === 0, missing.slice(0, 4).join(' | '));
    const lines = pageTexts('ref')[0].split('\n').map(s => s.trim());
    check('each line\'s quantity, price and total are read off the page in a row: 1 17,800 17,800 · 2 15,900 31,800 · 1 13,250 13,250 · 3 14,100 42,300 · 1 22,500 22,500',
      ['1 17,800 17,800', '2 15,900 31,800', '1 13,250 13,250', '3 14,100 42,300', '1 22,500 22,500'].every(l => lines.includes(l)), lines.filter(l => /^\d+ [\d,.]+ [\d,.]+$/.test(l)).join(' | '));
    check('the Arabic order: its Latin words and every amount are on the page (the Arabic itself is checked in the browser, where the words can be placed)',
      ['Wall mount', 'EZ60', 'Bill of Lading', '22,500', '17,800', '62,800 USD', '3 vehicles', 'Sara Mostafa'].every(w => has(pageTexts('arabic').join('\n'), w)));

    // The long order
    const lp = pageTexts('long');
    const pagesWith = label => lp.map((t, i) => (has(t, label) ? i + 1 : 0)).filter(Boolean);
    check('long: letterhead, ID, "Confidential" and "Page n of 2" are on every page', furniture('long'));
    check('long: each of the 19 lines is printed whole, once — a row is never split across two pages',
      Array.from({ length: 19 }, (_, i) => lp.filter(t => new RegExp(`Client ${i + 1}\\b`).test(t)).length).every(n => n === 1), lp.map(t => count(t, 'Client ')).join(','));
    check('long: the table head is repeated at the top of the second page', lp.length === 2 && has(lp[1].slice(0, lp[1].search(/Client \d/)), 'NO CLIENT VEHICLE COLOR EXT / INT YEAR ACCESSORIES / REMARKS QTY PRICE USD TOTAL USD'));
    check('long: the section title is on the page of its first row, and only once', pagesWith('ORDER LINES').join() === '1' && /Client 1\b/.test(lp[0]));
    check('long: the total is printed once, on the last page, with the last two lines — 659,120 USD for 37 vehicles',
      pagesWith('659,120 USD').join() === '2' && /Client 18\b/.test(lp[1]) && /Client 19\b/.test(lp[1]) && has(lp[1], '37 vehicles'), pagesWith('659,120 USD').join());
    check('long: the payment terms, the notes and the delivery terms are whole and on one page, after the total',
      pagesWith('PAYMENT TERMS').join() === '2' && pagesWith('NOTES').join() === '2' && pagesWith('DELIVERY TERMS').join() === '2' && has(lp[1], 'DOCUMENTS REQUIRED') && has(lp[1], 'CIF ONLY'));

    // Every place a page can break: the total always travels with the last rows
    const sweep = ns => ns.map(n => {
      const t = pageTexts(`sweep${n}`);
      const tp = t.map((x, i) => (has(x, `${sumOf(n).toLocaleString('en-US')} USD`) ? i + 1 : 0)).filter(Boolean);
      const withTotal = tp.length === 1 ? t[tp[0] - 1] : '';
      const row = i => new RegExp(`Sweep ${i}\\b`);
      return {
        n,
        ok: tp.length === 1 && row(n).test(withTotal) && row(n - 1).test(withTotal) && has(withTotal, `${n} vehicles`) && Array.from({ length: n }, (_, i) => t.filter(x => row(i + 1).test(x)).length).every(c => c === 1),
        crossed: t.filter(x => /Sweep \d/.test(x)).length > 1,
        // a title with none of its rows after it on its page
        stranded: t.some(x => { const sq = nospace(x), a = sq.search(/ORDERLINES/); return a >= 0 && !/Sweep\d/.test(sq.slice(a)); }),
      };
    });
    const sw = sweep(SWEEP);
    check(`sweep (${SWEEP.join(', ')} lines): the total is on one page with the last two lines, and every line is printed once`, sw.every(r => r.ok), sw.filter(r => !r.ok).map(r => r.n).join(','));
    check('…and the sweep did cross a page break (the keep-together rule was in play), and no section title is left alone at the foot of a page', sw.some(r => r.crossed) && sw.every(r => !r.stranded), sw.map(r => `${r.n}:${r.crossed ? 'split' : 'one page'}`).join(' '));
    const late = sweep([LATE])[0], lt = pageTexts(`sweep${LATE}`);
    const termPages = ['PAYMENT TERMS', 'NOTES', 'DELIVERY TERMS'].map(l => lt.map((x, i) => (has(x, l) ? i + 1 : 0)).filter(Boolean).join());
    check(`${LATE} lines: the total keeps the last two lines, and the terms — too tall for what is left — move whole to the next page`, late.ok && nPages[`sweep${LATE}`] === 3 && termPages.every(x => x === '3'), `${nPages[`sweep${LATE}`]} pages, terms on ${termPages.join('/')}`);
    check('every sweep page carries the letterhead and its page number', [...SWEEP, LATE].every(n => furniture(`sweep${n}`)));

    // The footer grows with a long note and a long address; the body leaves it room (no row runs under it)
    const words = (k, page) => withPdf(k, f => {
      const xml = spawnSync('pdftotext', ['-bbox', '-f', String(page), '-l', String(page), f, '-'], { encoding: 'utf8' }).stdout || '';
      return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(m => ({ y0: +m[2], y1: +m[4], t: m[5] }));
    });
    const clear = FOOT.flatMap(k => Array.from({ length: nPages[`footer${k}`] }, (_, i) => {
      const w = words(`footer${k}`, i + 1);
      const top = Math.min(...w.filter(x => x.t === 'Office').map(x => x.y0));          // the footer's own first label
      const low = Math.max(...w.filter(x => x.t === 'Mats').map(x => x.y1));            // "Mats", the end of every row
      return { k, page: i + 1, top, low, ok: isFinite(top) && isFinite(low) && low < top - 1 };
    }));
    const tightest = Math.min(...clear.map(c => c.top - c.low));
    check('a long footer note and a long address push the body up, not under the footer: on every page of eight layouts the last row ends above the footer', clear.length >= 16 && clear.every(c => c.ok),
      `${clear.length} pages, the closest row ends ${tightest.toFixed(1)}pt above the footer${clear.some(c => !c.ok) ? `; under it: ${clear.filter(c => !c.ok).map(c => `footer${c.k} page ${c.page}`).join(', ')}` : ''}`);
    check('…and the footer\'s note and address are all there, on every page', FOOT.every(k => nPages[`footer${k}`] >= 2 && pageTexts(`footer${k}`).every(t => has(t, 'Prices are valid for the period stated above') && has(t, 'next to the metro station'))));

    // Absurd text and money: still printed, nothing lost, nothing linked
    const st = nospace(pageTexts('stress').join('\n'));
    const stressWant = ['53,401.50', '24,750,049.50', '98,999,999.01', '123,803,450.01 USD', '201 vehicles', 'Money 2'];
    check('stress: the long lines, the money at its limits (24,750,049.50 · 98,999,999.01) and the total 123,803,450.01 for 201 vehicles are all printed; the VIN and the link are not',
      stressWant.every(w => st.includes(nospace(w))) && !/LSVAA1234567890XY|ClientFile-77|drive\.example/.test(st), stressWant.filter(w => !st.includes(nospace(w))).join(' | '));
  }
})().catch(e => { console.error(e); results.push(false); }).then(() => {
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});
