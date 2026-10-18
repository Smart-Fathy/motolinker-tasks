// The purchase order PDF (src/lib/docs/purchase-order.js) — the order MotoLinkers sends a supplier.
//
//   src/lib/docs/purchase-order.js    the layout (buildPurchaseOrderHtml) and the numbers and fallbacks
//                                     it prints (purchaseOrderModel)
//   src/lib/docs/defaults.js          the standard accessories, payment terms and documents list
//   tools/doc-fixtures/po.js          the sample orders: po (five lines), poOneLine, poLong (nineteen),
//                                     poMinimal (nothing), poHostile (markup), poStress, poArabic
//   src/routes/purchase-orders.js     the routes that hand the PDF out (checked end to end, at the bottom)
//
// What this guards, in order: every column of the sample order, to the cent; the money rules (the
// total is price × quantity, a price of 0 prints nothing, cents, other currencies); the grid as a form
// (five numbered rows at least, never padded past that; the client name falls back to the consignee and
// then to the lead; a consignee who is somebody else stays visible); the old form's wording fallbacks
// (standard accessories, payment terms, documents) and the words highlighted in red because somebody
// has to fill them in ("XXXXX", "CIF ONLY …", a blank delivery field) — and red nowhere else; the Incoterm;
// notes only when there are some; the letterhead; that nothing typed is lost, nothing typed is HTML, and
// the page reaches nowhere; a real browser (nothing sticks out, the figures line up, a phone number stays
// whole, Arabic runs the right way); real PDFs (the normal order is exactly one A4 page, a long one flows
// onto more with the head row repeated, whole rows, the total always with the last rows, whole terms and
// the footer on every page); and the real app, booted against a stubbed database, handing out the PDF.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3984';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Use the sandbox's Chrome when puppeteer has none of its own (read once, at load).
if (!process.env.PUPPETEER_EXECUTABLE_PATH && !fs.existsSync(path.join(process.env.HOME || '/root', '.cache', 'puppeteer', 'chrome'))) {
  const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (fs.existsSync(exe)) process.env.PUPPETEER_EXECUTABLE_PATH = exe;
}
const puppeteer = require('puppeteer');
const brand = require('../src/lib/docs/brand');
const defaults = require('../src/lib/docs/defaults');
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
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const squash = s => s.replace(/\s+/g, ' ').trim();
const nospace = s => s.replace(/\s+/g, '');
const count = (hay, needle) => hay.split(needle).length - 1;
// A red word or a telephone number sits inside a sentence: its tags are not a gap ("in XXXXX Port, to be …").
const inline = s => s.replace(/<span class="(?:red|tel)">([\s\S]*?)<\/span>/g, '$1');
const cellText = c => squash(decode(inline(c).replace(/<[^>]+>/g, ' ')));
// The page's own content, from the order's wrapper on (the letterhead comes before it in the markup and
// is read apart): every other tag becomes a space, then the entities turn back into the characters that
// were typed — so typed markup, being escaped, is still there as text.
const body = h => h.slice(h.indexOf('<div class="po">'));
const plain = html => squash(decode(inline(body(html).replace(/<style[\s\S]*?<\/style>/g, ' ')).replace(/<[^>]+>/g, ' ')));
const between = (html, from, to) => html.slice(html.indexOf(from), html.indexOf(to));
const headerOf = html => cellText(between(html, 'class="doc-header"', 'class="doc-footer"'));
const footerOf = html => cellText(between(html, 'class="doc-footer"', '<table class="flow">'));
// the first phrase of a list that is not found after the one before it, or -1 when all are, in order
const inOrder = (text, phrases) => {
  let at = 0;
  for (const p of phrases) { const i = text.indexOf(p, at); if (i < 0) return p; at = i + p.length; }
  return -1;
};
const ordered = (name, text, phrases) => { const miss = inOrder(text, phrases); check(name, miss === -1, miss === -1 ? '' : `missing or out of order: ${miss}`); };

// The line grid: its head, its rows (each a list of the cells' texts) and the dark total block under them.
// `classes` holds each row's own class list (blank, keep, last …).
function table(html) {
  const at = html.indexOf('<div class="sec-title">ORDER LINES</div>');
  if (at < 0) return null;
  const t = html.slice(at, html.indexOf('</table>', at));
  const rows = [...t.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map(m => ({
    cls: (/class="([^"]*)"/.exec(m[1]) || [])[1] || '',
    cells: [...m[2].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => cellText(c[1])),
    raw: m[2],
  }));
  return { head: rows[0].cells, rows: rows.slice(1, -1).map(r => r.cells), classes: rows.slice(1, -1).map(r => r.cls), raw: rows.slice(1, -1).map(r => r.raw), total: rows[rows.length - 1].cells[0] };
}
// the label / value pairs of a card (a <span class="k"> followed by its <span class="v …">), with the value's classes
const pairsIn = section => [...section.matchAll(/<span class="k">([^<]*)<\/span><span class="v([^"]*)">([\s\S]*?)<\/span>(?=<\/div>)/g)]
  .map(m => ({ k: decode(m[1]), cls: m[2].trim(), v: cellText(m[3]) }));
const sectionOf = (html, marker) => { const i = html.indexOf(marker); return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i)); };
const metaOf = html => Object.fromEntries(pairsIn(sectionOf(html, 'class="card po-meta"')).map(p => [p.k, p.v]));
const supplierOf = html => Object.fromEntries(pairsIn(sectionOf(html, 'class="card po-sup"')).map(p => [p.k, p.v]));
const deliveryOf = html => pairsIn(sectionOf(html, '<h4>DELIVERY TERMS</h4>'));
// the payment terms as the list the page prints
const paymentOf = html => [...sectionOf(html, '<h4>PAYMENT TERMS</h4>').matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => cellText(m[1]));
// every piece of text printed in red, in order
const redOf = html => [...body(html).matchAll(/<span class="red">([\s\S]*?)<\/span>/g)].map(m => decode(m[1]));

// An order with nothing in it but what a case needs.
const base = { po_number: 'PO2610-0001', po_date: '2026-10-12', currency: 'USD', issuer: 'Tester', supplier_name: 'Test Supplier', settings: {}, items: [] };
const line = o => ({ client: 'Client', brand: 'Brand', model: 'Model', units: 1, pi_price: 0, ...o });
const order = over => ({ ...base, ...over });
const html = over => buildPurchaseOrderHtml(order(over));
const grid = over => table(html(over));
const pricesOf = (items, over) => grid({ items, ...over }).rows.slice(0, items.length).map(r => [r[6], r[7], r[8]]);   // [qty, price, total] of each line
const ACC = defaults.DOC_DEFAULT_ACCESSORIES;
// a footer note of four lines and an address of four lines: the footer, fixed to the foot of every page, grows
const BIG_NOTE = 'Prices are valid for the period stated above, are quoted ex-works and are subject to change without prior notice. '.repeat(4);
const BIG_ADDRESS = 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo - Arab Republic of Egypt, next to the metro station, opposite the old bakery';

(async () => {
  // ═══ 1. The sample order, column by column ═══
  const po = buildPurchaseOrderHtml(fx.po);
  const t = table(po);
  eq('the grid\'s columns, in the form\'s order: NO · CLIENT · VEHICLE (brand, model, trim) · COLOR · YEAR · ACCESSORIES · QTY · PRICE · TOTAL',
    t && t.head, ['NO', 'CLIENT', 'VEHICLE', 'COLOR EXT / INT', 'YEAR', 'ACCESSORIES / REMARKS', 'QTY', 'PRICE USD', 'TOTAL USD']);
  eq('every line to the cent: client, vehicle, colours, year, accessories, quantity, price and line total (2 × 15,900 = 31,800)', t && t.rows, [
    ['1', 'Omar Hassan', 'Deepal S05 620 Laser Edition', 'EXT: Grey INT: Nebula Purple/White', '2027', ACC, '1', '17,800', '17,800'],
    ['2', 'Sara Mostafa Consignee: Mostafa Trading', 'Deepal S05 215 Max', 'EXT: Grey INT: Grey', '2027', ACC, '2', '15,900', '31,800'],
    ['3', 'Karim Adel', 'Xpeng L03 1330 Max', 'Ext: Black INT: Purple', '2027', ACC, '1', '13,250', '13,250'],
    ['4', 'Hana Fouad', 'Xpeng L03 625 Max', 'Ext: Black INT: Purple', '2027', 'English system , wall mount charging cable', '3', '14,100', '42,300'],
    ['5', 'Nile Motors', 'Mazda EZ60 EV 600 Max', 'EXT: White INT: Black', '2026', ACC, '1', '22,500', '22,500']]);
  check('the dark total block closes the grid: 8 vehicles, 127,650 USD (and the model agrees)',
    t && t.total === 'TOTAL 8 vehicles 127,650 USD' && purchaseOrderModel(fx.po).total === 127650 && purchaseOrderModel(fx.po).units === 8, t && t.total);
  check('brand and model are one bold line, the trim is under it', /<span class="m">Deepal S05<\/span><span class="tr">620 Laser Edition<\/span>/.test(po) && /<span class="m">Mazda EZ60<\/span><span class="tr">EV 600 Max<\/span>/.test(po));
  check('the colours are one line each, so an interior colour never wraps away from its label', /EXT: Grey<br>INT: Nebula Purple\/White/.test(po) && /Ext: Black<br>INT: Purple/.test(po));
  const mp = plain(po);
  const ORDER = ['PURCHASE ORDER', 'PCH auto', 'ID MT28W88Y26 DATE 2026-10-12 ISSUER Mohamed Yasser CURRENCY USD', 'SUPPLIER DETAILS', 'ORDER LINES', 'TOTAL 8 vehicles 127,650 USD', 'PAYMENT TERMS', 'NOTES', 'DELIVERY TERMS'];
  ordered('the title and the supplier, the ID / DATE / ISSUER / CURRENCY card, the supplier details, the grid, the total, then the terms — in that order', mp, ORDER);
  eq('the meta card: the ID is the quote the order comes from, with the date, the issuer and the currency', metaOf(po), { ID: 'MT28W88Y26', DATE: '2026-10-12', ISSUER: 'Mohamed Yasser', CURRENCY: 'USD' });
  eq('the supplier card: name, contact, country of origin and address, as typed', supplierOf(po), {
    Name: 'PCH auto', Contact: 'Yoyo / +8613380783532', 'Country of Origin': 'China',
    Address: "NO. 211, Baofa Company, Jinwan Avenue, Dachan Bay, Haoye Community, Xixiang Street, Bao'an District, Shenzhen City, Guangdong Province" });
  check('the supplier\'s name is the green line under the title as well', /<div class="po-to">PCH auto<\/div>/.test(po));
  eq('the delivery terms, in the form\'s order: Incoterm, Delivery Location, Service Provider, Contact, Documents Required',
    deliveryOf(po).map(p => [p.k, p.v]), [['Incoterm', 'FOB'], ['Delivery Location', 'Shanghai Port'], ['Service Provider', 'Sino Trans Logistics'], ['Contact', 'Ahmed Ali / +20 100 555 0199'], ['Documents Required', fx.po.documents_required]]);
  eq('the payment terms: the shares and their words, as typed', paymentOf(po), ['30% deposit to confirm the order', '70% balance due after the vehicle arrives in Shanghai Port (VIN code and PDI vehicle video and document to be provided for confirmation)']);
  check('the note is on the page', /NOTES Please confirm the production slot and the VIN list within 3 working days of receiving this order\./.test(mp));
  const withExtras = buildPurchaseOrderHtml({ ...fx.po, items: fx.po.items.map(it => ({ ...it, vin: 'LGXCH6CB5R0012345', file_link: 'https://drive.google.com/file/d/1', payment_term: 'LC at sight', cf_battery: '100 kWh' })) });
  check('the VIN, the client-file link, the line payment term and an extra column are not part of the order the supplier gets: adding them changes nothing',
    withExtras === po && !/LGXCH6CB5R0012345|drive\.google\.com|LC at sight|100 kWh/.test(withExtras));
  check('nor are the order\'s status and its internal title', !/send_to_supplier|October order|\bsent\b/.test(plain(po)) && !/PCH auto — October order/.test(po));
  // ═══ 2. The money rules ═══
  eq('a quantity multiplies the price: 3 × 14,100 = 42,300; a quantity given as text, with a thousands comma, or fractional works too',
    pricesOf([line({ units: 3, pi_price: 14100 }), line({ units: '3', pi_price: 100 }), line({ units: '1,200', pi_price: 2 }), line({ units: 2.5, pi_price: 100 })]),
    [['3', '14,100', '42,300'], ['3', '100', '300'], ['1200', '2', '2,400'], ['2.5', '100', '250']]);
  eq('a quantity that is blank, zero, missing or not a number is 1, as on the old form',
    pricesOf([line({ units: '', pi_price: 100 }), line({ units: 0, pi_price: 100 }), line({ pi_price: 100, units: undefined }), line({ units: 'many', pi_price: 100 }), line({ units: null, pi_price: 100 })]),
    Array(5).fill(['1', '100', '100']));
  eq('a big quantity steps down a size so that it stays on one line in its narrow column: 3 and 120 as they are, 1,200 one size down, 12,000 and 99,999 two',
    [3, 120, 1200, 12000, 99999].map(n => (/<td class="ctr fig qty( [a-z]+)?">/.exec(html({ items: [line({ units: n })] })) || [])[1] || ''), ['', '', ' xl', ' xxl', ' xxl']);
  eq('cents print with two decimals, whole amounts bare: 17,800.50 × 2 = 35,601; 19.99 × 3 = 59.97; 0.10 × 3 = 0.30',
    pricesOf([line({ pi_price: 17800.5, units: 2 }), line({ pi_price: 19.99, units: 3 }), line({ pi_price: 0.1, units: 3 })]),
    [['2', '17,800.50', '35,601'], ['3', '19.99', '59.97'], ['3', '0.10', '0.30']]);
  eq('seven figures and cents: 1,234,567.5 × 3 = 3,703,702.50', pricesOf([line({ pi_price: 1234567.5, units: 3 })]), [['3', '1,234,567.50', '3,703,702.50']]);
  eq('a price typed with a thousands comma is the number it says', pricesOf([line({ pi_price: '17,800' })]), [['1', '17,800', '17,800']]);
  const blanks = pricesOf([line({ pi_price: 0, units: 2 }), line({ pi_price: '', units: 2 }), line({ pi_price: null, units: 2 }), line({ pi_price: undefined, units: 2 }), line({ pi_price: 'abc', units: 2 }), line({ pi_price: '0', units: 2 })]);
  eq('a price of 0 (or none, or words) prints no price and no line total — empty cells, not "0" — while the quantity stays', blanks, Array(6).fill(['2', '', '']));
  const mixed = grid({ items: [line({ pi_price: 1000 }), line({ pi_price: 0, units: 5 }), line({ pi_price: 250, units: 2 })] });
  check('…and an unpriced line adds nothing to the total, but its vehicles are counted: 1,500 for 8 vehicles', mixed.total === 'TOTAL 8 vehicles 1,500 USD', mixed.total);
  const sum = grid({ items: [line({ pi_price: 0.1 }), line({ pi_price: 0.2 })] });
  check('the total is added in cents, so 0.10 + 0.20 is 0.30 and not 0.30000000000000004', sum.total === 'TOTAL 2 vehicles 0.30 USD', sum.total);
  const disc = grid({ items: [line({ pi_price: 1000 }), line({ pi_price: -500, client: 'Discount' })] });
  check('a negative price (a discount) is kept and lowers the total, as before', disc.rows[1][7] === '-500' && disc.total === 'TOTAL 2 vehicles 500 USD', `${disc.rows[1][7]} ${disc.total}`);
  check('the total of the sample order is the sum of the line totals', purchaseOrderModel(fx.poLong).total === fx.poLong.items.reduce((n, it) => n + it.pi_price * it.units, 0) && table(buildPurchaseOrderHtml(fx.poLong)).total === 'TOTAL 37 vehicles 659,120 USD', table(buildPurchaseOrderHtml(fx.poLong)).total);

  const eur = grid({ currency: 'EUR', items: [line({ pi_price: 15900, units: 2 })] });
  eq('another currency is named in both money headings, in the total block and in the card: 2 × 15,900 = 31,800 EUR',
    [eur.head.slice(7), eur.total, metaOf(html({ currency: 'EUR' })).CURRENCY], [['PRICE EUR', 'TOTAL EUR'], 'TOTAL 2 vehicles 31,800 EUR', 'EUR']);
  eq('a currency typed in lower case prints in capitals everywhere; a blank one is USD', [grid({ currency: 'egp' }).head[7], metaOf(html({ currency: 'egp' })).CURRENCY, grid({ currency: '' }).head[7], grid({ currency: undefined }).total, metaOf(html({ currency: '  ' })).CURRENCY],
    ['PRICE EGP', 'EGP', 'PRICE USD', 'TOTAL 0 USD', 'USD']);
  eq('the total block counts the vehicles, singular and plural, and says nothing about them when there are none',
    [grid({ items: [line({ pi_price: 5 })] }).total, grid({ items: [line({ pi_price: 5, units: 2.5 })] }).total, grid({ items: [] }).total],
    ['TOTAL 1 vehicle 5 USD', 'TOTAL 2.5 vehicles 12.50 USD', 'TOTAL 0 USD']);
  check('the order of the maths is one function: the model\'s total and units are what the block prints',
    (m => m.total === 1500 && m.units === 8)(purchaseOrderModel(order({ items: [line({ pi_price: 1000 }), line({ pi_price: 0, units: 5 }), line({ pi_price: 250, units: 2 })] }))));

  // ═══ 3. The grid as a form: five numbered rows, who the client is ═══
  const rowCount = n => grid({ items: Array.from({ length: n }, (_, i) => line({ client: `C${i + 1}` })) });
  eq('a short order is drawn on five numbered rows — 0, 1, 4 and 5 lines all make five',
    [0, 1, 4, 5].map(n => rowCount(n).rows.length), [5, 5, 5, 5]);
  eq('…and a longer order is not padded: 6, 7 and 19 lines are 6, 7 and 19 rows (no blank row among them)',
    [6, 7, 19].map(n => { const g = rowCount(n); return [g.rows.length, g.classes.filter(c => /blank/.test(c)).length]; }), [[6, 0], [7, 0], [19, 0]]);
  const one = rowCount(1);
  eq('the blank rows carry their numbers and nothing else', one.rows.slice(1), [['2', '', '', '', '', '', '', '', ''], ['3', '', '', '', '', '', '', '', ''], ['4', '', '', '', '', '', '', '', ''], ['5', '', '', '', '', '', '', '', '']]);
  check('…and are marked as blank rows, the real line is not', /blank/.test(one.classes[1]) && /blank/.test(one.classes[4]) && !/blank/.test(one.classes[0]), one.classes.join(' | '));
  eq('the rows are numbered 1, 2, 3 … in order', rowCount(12).rows.map(r => r[0]), Array.from({ length: 12 }, (_, i) => String(i + 1)));
  check('an order with no lines at all is five blank rows and a total of 0', (g => g.rows.length === 5 && g.rows.every(r => r.slice(1).every(c => c === '')) && g.total === 'TOTAL 0 USD')(grid({ items: [] })));
  eq('lines with nothing in them (a blank row the editor sent along, null, a string, a list) are not vehicles: dropped, with no phantom "1 vehicle"',
    (g => [g.rows.filter(r => r[1]).map(r => r[1]), g.rows.length, g.total])(grid({ items: [{}, null, 'x', [], { units: 3 }, line({ client: 'Real' }), { client: '  ' }] })), [['Real'], 5, 'TOTAL 1 vehicle 0 USD']);
  const sparse = grid({ client_name: '', items: [{ pi_price: 100 }, { color: 'EXT: Red' }] });
  check('a line with only a price, or only a colour, is still a line the supplier reads: it keeps its row, its number and what it has',
    sparse.rows[0][0] === '1' && sparse.rows[0][8] === '100' && sparse.rows[1][0] === '2' && sparse.rows[1][3] === 'EXT: Red' && !/blank/.test(sparse.classes[0] + sparse.classes[1]), JSON.stringify(sparse.rows.slice(0, 2)));
  eq('the last two rows travel with the total (class keep), the last one closes the grid (class last) — blank rows too',
    [rowCount(7).classes.map(c => c.replace(/\s+/g, '+')), rowCount(2).classes.map(c => c.replace(/\s+/g, '+'))],
    [['', '', '', '', '', 'keep', 'keep+last'], ['', '', 'blank', 'blank+keep', 'blank+keep+last']]);

  const who = (item, lead) => grid({ client_name: lead, items: [item] }).rows[0][1];
  eq('the CLIENT cell: the line\'s client, else its consignee, else the client the order is attached to',
    [who(line({ client: 'Ann', consignee: '' }), 'Lead'), who(line({ client: '', consignee: 'Bob Trading' }), 'Lead'), who(line({ client: '', consignee: '' }), 'Lead'), who(line({ client: '  ', consignee: '  ' }), ' Lead ')],
    ['Ann', 'Bob Trading', 'Lead', 'Lead']);
  check('…and with nobody to name it stays empty (never "undefined")', who(line({ client: '', consignee: '' }), undefined) === '' && who(line({ client: undefined, consignee: undefined }), null) === '');
  eq('a consignee who is somebody else stays visible under the client: "Ann" then "Consignee: Bob Trading"',
    who(line({ client: 'Ann', consignee: 'Bob Trading' }), 'Lead'), 'Ann Consignee: Bob Trading');
  check('…as a muted line of its own under the name', /<td class="t cl">Ann<span class="sub">Consignee: Bob Trading<\/span><\/td>/.test(html({ items: [line({ client: 'Ann', consignee: 'Bob Trading' })] })));
  eq('…and one who is the client (or is all there is) is not repeated',
    [who(line({ client: 'Ann', consignee: 'Ann' }), 'Lead'), who(line({ client: '', consignee: 'Bob' }), 'Bob')], ['Ann', 'Bob']);
  check('the lead the order hangs on is not printed as a consignee', !/Consignee: Lead/.test(html({ client_name: 'Lead', items: [line({ client: '', consignee: '' })] })));
  eq('accessories: the line\'s own text, else the standard accessories; line breaks are kept',
    grid({ items: [line({ accessories: 'Mats only' }), line({ accessories: '' }), line({ accessories: '   ' }), line({ accessories: undefined }), line({ accessories: 'one\ntwo' })] }).rows.map(r => r[5]),
    ['Mats only', ACC, ACC, ACC, 'one two']);
  check('…and a line break in the accessories is a line break on the page', /<td class="t acc">one<br>two<\/td>/.test(html({ items: [line({ accessories: 'one\ntwo' })] })));
  eq('the vehicle cell: brand and model on one line, the trim under it; a missing part leaves no gap',
    grid({ items: [line({ brand: 'BYD', model: 'Seal', trim: 'Design' }), line({ brand: '', model: 'Seal', trim: '' }), line({ brand: 'BYD', model: '', trim: 'Design' }), line({ brand: '', model: '', trim: 'Design' })] }).rows.slice(0, 4).map(r => r[2]),
    ['BYD Seal Design', 'Seal', 'BYD Design', 'Design']);
  eq('numbers typed into text fields print as typed: a year of 2027 (number), a model of 3 (number)',
    (g => [g.rows[0][4], g.rows[0][2]])(grid({ items: [line({ year: 2027, model: 3, brand: 'BYD' })] })), ['2027', 'BYD 3']);
  const colours = c => purchaseOrderModel(order({ items: [line({ color: c })] })).lines[0].colour;
  eq('the colours split into one line each at "EXT" and "INT" (either case); text without them stays one piece; a typed line break is kept',
    ['EXT: Grey INT: Nebula Purple/White', 'Ext: Black INT: Purple', 'Pearl White', 'Exterior: White / Interior: Black', 'EXT: Grey\nINT: Black', ''].map(colours),
    [['EXT: Grey', 'INT: Nebula Purple/White'], ['Ext: Black', 'INT: Purple'], ['Pearl White'], ['Exterior: White / Interior: Black'], ['EXT: Grey', 'INT: Black'], []]);

  // ═══ 4. The old form's wording, the words filled in by hand, the delivery terms, the notes ═══
  const DEFAULT_PAY = defaults.DOC_DEFAULT_PAYMENT_TERMS.split('\n');
  check('payment terms left blank, as spaces, or not as text print the standard 30% / 70% wording', [undefined, '', '  \n ', null, {}, true].every(v => same(paymentOf(html({ payment_terms: v })), DEFAULT_PAY)));
  eq('payment terms typed by the team replace the standard ones: in their order, blank lines dropped, nothing of the old wording left',
    paymentOf(html({ payment_terms: '40% Deposit\n\n  35% On shipping  \r\n25% On arrival' })), ['40% Deposit', '35% On shipping', '25% On arrival']);
  check('…and the share is set in bold green: "40%", "12.5%" and "87.5 %" (a space before the sign) are shares; a line without one, or a bare "100%", is kept whole',
    (h => /<b class="pct">40%<\/b> Deposit/.test(h) && /<b class="pct">12\.5%<\/b> Half/.test(h) && /<b class="pct">87\.5%<\/b> Rest/.test(h) && /<li><span>Balance on delivery in Cairo<\/span><\/li>/.test(h) && /<li><span>100%<\/span><\/li>/.test(h))(
      html({ payment_terms: '40% Deposit\n12.5% Half\n87.5 % Rest\nBalance on delivery in Cairo\n100%' })));
  const docOf = over => (deliveryOf(html(over)).find(p => p.k === 'Documents Required') || {}).v;
  check('documents required left blank, as spaces, or not as text print the standard list', [undefined, '', '   ', null, []].every(v => docOf({ documents_required: v }) === defaults.DOC_DEFAULT_DOCUMENTS));
  eq('…and a list typed by the team replaces it, with its line breaks', [docOf({ documents_required: 'B/L / Invoice\nPacking list' }), /B\/L \/ Invoice<br>Packing list/.test(html({ documents_required: 'B/L / Invoice\nPacking list' }))], ['B/L / Invoice Packing list', true]);

  // red: the words somebody has to fill in
  eq('the standard wording has two such places, and both are red: "XXXXX" in the payment terms and "CIF ONLY …" to the end of its line in the documents',
    redOf(html({})), ['XXXXX', 'CIF ONLY ( B/L / Telex Release / Insurance Policy)']);
  const pay = payment_terms => redOf(html({ payment_terms, documents_required: 'Invoice' }));
  eq('"XXXXX Port" is one red piece; three X are enough, in any case; two X, a word that merely contains Xs, and a number are not',
    [pay('70% due in XXXXX Port today'), pay('70% in XXX and xxxxx'), pay('70% in XX, MAXXXI, 5XXX, TAXXXX')],
    [['XXXXX Port'], ['XXX', 'xxxxx'], []]);
  eq('"CIF ONLY" is red to the end of its own line and no further — in any case — and the words before it are not',
    [redOf(html({ payment_terms: '100% now', documents_required: 'B/L\nCIF ONLY: Insurance + Telex\nPacking list' })), redOf(html({ payment_terms: '100% now', documents_required: 'Invoice / cif only (B/L)\nPacking' })), /Invoice \/ <span class="red">cif only \(B\/L\)<\/span><br>Packing/.test(html({ documents_required: 'Invoice / cif only (B/L)\nPacking' }))],
    [['CIF ONLY: Insurance + Telex'], ['cif only (B/L)'], true]);
  check('with none of those words, and every delivery detail filled in, nothing on the page is red',
    redOf(html({ payment_terms: '100% in advance', documents_required: 'Invoice', delivery_location: 'Sokhna', service_provider: 'Maersk', contact: 'Omar' })).length === 0
    && !/alert/.test(body(html({ payment_terms: '100% in advance', documents_required: 'Invoice', delivery_location: 'Sokhna', service_provider: 'Maersk', contact: 'Omar' }))));
  check('the red words are text: markup beside them is printed, not run', (h => /<span class="red">XXXXX<\/span> &lt;b&gt;x&lt;\/b&gt;/.test(h) && !/<b>x<\/b>/.test(h))(html({ payment_terms: '70% in XXXXX <b>x</b>' })));

  const delivery = over => Object.fromEntries(deliveryOf(html(over)).map(p => [p.k, p]));
  const blankD = delivery({ delivery_location: '', service_provider: undefined, contact: '  ' });
  check('a delivery detail left blank — the place, the forwarder, the contact — is a red line to fill in, empty',
    ['Delivery Location', 'Service Provider', 'Contact'].every(k => blankD[k].v === '' && blankD[k].cls === 'line alert'), JSON.stringify(blankD));
  const fullD = delivery({ delivery_location: 'Sokhna Port', service_provider: 'Maersk', contact: 'Omar / +20 100 555 0199' });
  check('…and the same details filled in print as text, not red', ['Delivery Location', 'Service Provider', 'Contact'].every(k => fullD[k].cls === '' && fullD[k].v !== '') && fullD.Contact.v === 'Omar / +20 100 555 0199');
  eq('the Incoterm row is there on every order, FOB when none is given, and never a red blank',
    [[undefined, '', '  ', null].map(v => delivery({ incoterm: v }).Incoterm), delivery({ incoterm: 'CIF' }).Incoterm, deliveryOf(html({}))[0].k].flat().map(x => (typeof x === 'object' ? [x.v, x.cls] : x)),
    [['FOB', ''], ['FOB', ''], ['FOB', ''], ['FOB', ''], ['CIF', ''], 'Incoterm']);

  const notes = over => html({ notes: over });
  check('notes left blank, as spaces, or not as text leave no NOTES card at all', [undefined, '', '   \n  ', null, false, {}, []].every(v => !/NOTES|po-note/.test(body(notes(v)))));
  const shortNote = notes('Please confirm the slot.');
  check('a short note sits under the payment terms, beside the delivery terms', /<h4>NOTES<\/h4>/.test(shortNote) && !/po-note wide/.test(shortNote)
    && shortNote.indexOf('<h4>PAYMENT TERMS</h4>') < shortNote.indexOf('<h4>NOTES</h4>') && shortNote.indexOf('<h4>NOTES</h4>') < shortNote.indexOf('<h4>DELIVERY TERMS</h4>'));
  const longNote = notes('A long note that goes on and on about the production slot, the VIN list and the second key. '.repeat(3));
  const manyLines = notes('one\ntwo\nthree\nfour');
  check('a long note, or one of four lines or more, gets a card of its own across the page, under the terms',
    [longNote, manyLines].every(h => /po-note wide/.test(h) && h.indexOf('<h4>NOTES</h4>') > h.indexOf('<h4>DELIVERY TERMS</h4>')));
  check('…and a note keeps its line breaks, as text', /<p>one<br>two<br>three<br>four<\/p>/.test(manyLines) && /&lt;b&gt;x&lt;\/b&gt;/.test(notes('<b>x</b>')) && !/<b>x<\/b>/.test(notes('<b>x</b>')));

  // ═══ 5. The letterhead, the number, the supplier ═══
  const idOf = over => metaOf(html(over)).ID;
  eq('the ID is the quote the order comes from; with none, the order\'s own number; with neither, a dash',
    [idOf({ quote_id: 'MT1' }), idOf({ quote_id: '  ' }), idOf({ quote_id: '', po_number: '' }), idOf({ quote_id: undefined, po_number: undefined })], ['MT1', 'PO2610-0001', '—', '—']);
  eq('the date is the day: a plain date as it is, a timestamp cut to its day, a Date object too; none is a dash',
    [html({ po_date: '2026-10-12' }), html({ po_date: '2026-10-12T09:30:00.000Z' }), html({ po_date: new Date(Date.UTC(2026, 9, 12, 8)) }), html({ po_date: null }), html({ po_date: '' })].map(h => metaOf(h).DATE),
    ['2026-10-12', '2026-10-12', '2026-10-12', '—', '—']);
  eq('a blank issuer is a dash, and the card is still the four rows', metaOf(html({ issuer: '', po_date: '', quote_id: '', po_number: '' })), { ID: '—', DATE: '—', ISSUER: '—', CURRENCY: 'USD' });
  const hd = headerOf(po), ft = footerOf(po);
  check('the header repeats the company\'s line and "PURCHASE ORDER" with the ID', /AUTOMOTIVE • ELECTRIC • MOBILITY/.test(hd) && /PURCHASE ORDER MT28W88Y26/.test(hd), hd.slice(0, 90));
  check('the footer carries the company details, the ID and the standard note',
    /Office \(ACO2\), Floor \(4\)/.test(ft) && /info@motolinkers\.com/.test(ft) && /www\.motolinkers\.com/.test(ft) && /\+2 010 000 78104/.test(ft) && /Tax ID 773934006/.test(ft) && /Registration No 282378/.test(ft) && /MT28W88Y26/.test(ft) && /Confidential/.test(ft), ft);
  check('the document\'s title carries the ID', /<title>Purchase Order MT28W88Y26<\/title>/.test(po) && /<title>Purchase Order PO2610-0001<\/title>/.test(html({})) && /<title>Purchase Order<\/title>/.test(html({ quote_id: '', po_number: '' })));
  const custom = footerOf(html({ settings: { footer_note: 'Confidential - for the supplier only', company_email: 'sales@example.com', company_phone: '+20 1 555' } }));
  check('the footer note and the company details come from the settings (and replace the defaults)', /for the supplier only/.test(custom) && /sales@example\.com/.test(custom) && /\+20 1 555/.test(custom) && !/info@motolinkers\.com/.test(custom), custom);
  const idLess = html({ quote_id: '', po_number: '' });
  check('with no ID the header says just PURCHASE ORDER and the footer prints no reference', /dh-ref">PURCHASE ORDER<\/span>/.test(idLess) && /<b>Registration No<\/b> 282378<\/div>/.test(idLess));

  eq('the supplier\'s name is the typed one; the older "supplier" field fills in when there is no name; the name wins',
    [supplierOf(html({ supplier_name: 'Alpha', supplier: 'Beta' })).Name, supplierOf(html({ supplier_name: '', supplier: 'Beta' })).Name, supplierOf(html({ supplier_name: undefined, supplier: 'Beta' })).Name], ['Alpha', 'Beta', 'Beta']);
  const noSup = html({ supplier_name: '', supplier: '' });
  check('no supplier: no name under the title (and no rule), and the four supplier fields are lines to fill in — still the whole card',
    !/class="po-to"|class="po-bar"/.test(body(noSup)) && /<h1 class="po-h1">PURCHASE ORDER<\/h1>/.test(noSup) && count(sectionOf(noSup, 'class="card po-sup"'), '<span class="v line"></span>') === 4 && /SUPPLIER DETAILS/.test(noSup));
  check('a supplier detail left blank among typed ones is a line to fill in, the others print', (h => count(sectionOf(h, 'class="card po-sup"'), '<span class="v line"></span>') === 2 && supplierOf(h).Name === 'A')(html({ supplier_name: 'A', supplier_contact: '', supplier_address: '', supplier_country: 'China' })));
  check('the "template" an old record carries is ignored: there is one design', [undefined, 'classic', 'brand', 'motolinkers', 'nonsense', 7].every(tp => buildPurchaseOrderHtml({ ...fx.po, template: tp }) === po));
  check('the same data gives the same document', buildPurchaseOrderHtml(fx.po) === buildPurchaseOrderHtml(JSON.parse(JSON.stringify(fx.po))));
  check('the order is not changed by printing it', (copy => { buildPurchaseOrderHtml(copy); return same(copy, JSON.parse(JSON.stringify(fx.poStress))); })(JSON.parse(JSON.stringify(fx.poStress))));

  // ═══ 6. Nothing typed is lost, nothing typed is HTML, blanks print as blanks ═══
  const lost = [];
  for (const [name, d] of Object.entries(fx)) {
    const h = buildPurchaseOrderHtml(d), tx = plain(h), must = [];
    for (const k of ['supplier_name', 'supplier_contact', 'supplier_address', 'supplier_country', 'issuer', 'delivery_location', 'service_provider', 'contact', 'notes']) if (d[k]) must.push(...String(d[k]).split('\n'));
    if (d.quote_id || d.po_number) must.push(d.quote_id || d.po_number);   // the form's ID: the quote, else the order's own number
    if (d.po_date) must.push(String(d.po_date).slice(0, 10));
    for (const l of (d.payment_terms || '').split('\n').filter(Boolean)) must.push(l);
    for (const l of (d.documents_required || '').split('\n').filter(Boolean)) must.push(l);
    for (const it of d.items || []) {
      for (const k of ['client', 'consignee', 'brand', 'model', 'trim', 'year']) if (it[k]) must.push(it[k]);
      if (it.color) must.push(...it.color.split(/\s+(?=(?:EXT|INT)\b)/i));
      if (it.accessories) must.push(...it.accessories.split('\n'));
    }
    for (const m of must) if (!tx.includes(squash(m))) lost.push(`${name}: ${m.slice(0, 40)}`);
    if (/\b(?:undefined|NaN|null|true|false)\b|\[object/.test(`${tx} ${headerOf(h)} ${footerOf(h)}`.replace(/Confidential/g, ''))) lost.push(`${name}: prints a placeholder`);
  }
  check('in every sample, every name, line, colour, term, number and date is printed, and none prints "undefined", "NaN" or "null"', lost.length === 0, lost.slice(0, 4).join(' | '));
  const GARBAGE = [undefined, null, {}, [], 'text', 5, { items: 'abc', settings: 'x', currency: {}, po_date: NaN }, { po_number: false, issuer: true, items: [null, 5, 'x', { client: {}, units: [], pi_price: {} }], notes: [] }, { settings: { company_name: 5, footer_note: null, company_address: 7 } }];
  check('an order built from nothing at all, or from junk, is a whole document: five blank rows, a total of 0, no placeholder printed',
    GARBAGE.every(d => { const h = buildPurchaseOrderHtml(d); return /^<!DOCTYPE html>/.test(h) && /<\/html>\s*$/.test(h) && !/\b(?:undefined|NaN|null|true|false)\b|\[object/.test(`${plain(h)} ${headerOf(h)} ${footerOf(h)}`) && table(h).rows.length >= 5 && /^TOTAL 0 USD$|^TOTAL [\d.]+ vehicles? 0 USD$/.test(table(h).total); }));

  const hostile = buildPurchaseOrderHtml(fx.poHostile);
  check('markup typed into the supplier, the client, the vehicle and the note is escaped in the source: no script, no tag, no handler of the typist\'s own',
    !/<script|<img src=x|<b>Omar|<\/td><td>X/.test(body(hostile)) && /&lt;img src=x onerror=alert\(1\)&gt; PCH &amp; &quot;Co&quot;/.test(hostile) && /&lt;b&gt;Omar&lt;\/b&gt;/.test(hostile)
    && /&lt;\/td&gt;&lt;td&gt;X/.test(hostile) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(hostile));
  const U = '<u>x</u>', EU = '&lt;u&gt;x&lt;/u&gt;';
  const everyField = buildPurchaseOrderHtml({
    po_number: U, quote_id: U, po_date: U, issuer: U, currency: U, supplier_name: U, supplier_contact: U, supplier_address: U, supplier_country: U,
    incoterm: U, delivery_location: U, service_provider: U, contact: U, payment_terms: `50% ${U}\n${U}`, documents_required: U, notes: U, client_name: U,
    settings: { company_name: U, company_address: U, company_email: U, company_website: U, company_phone: U, company_tax_id: U, company_reg_no: U, footer_note: U },
    items: [{ client: U, consignee: 'other', brand: U, model: U, trim: U, color: `EXT: ${U} INT: ${U}`, year: U, accessories: U, units: U, pi_price: U }, { client: '', consignee: U, brand: 'B' }],
  });
  check('markup typed into every other field — the number, the date, the currency, the terms, the delivery details, the company settings — is text too',
    !/<u>/.test(everyField) && count(everyField, EU) >= 30, `${count(everyField, EU)} escaped copies`);
  const telHostile = html({ supplier_contact: '<b>+86 755 8888 1234</b>', contact: 'x <i>+20 100 555 0199</i>' });
  check('a telephone number inside markup is still just text: the number is wrapped, the tags around it are escaped',
    /&lt;b&gt;<span class="tel">\+86 755 8888 1234<\/span>&lt;\/b&gt;/.test(telHostile) && !/<b>\+86/.test(telHostile) && /&lt;i&gt;<span class="tel">\+20 100 555 0199<\/span>&lt;\/i&gt;/.test(telHostile));
  check('the order refers to nothing outside itself: no http(s) address in any src, href or url(), no link, import, frame or script',
    !Object.values(fx).some(d => /(?:src|href)=["']?https?:|url\(["']?https?:|@import|<link|<iframe|<script|<a /i.test(buildPurchaseOrderHtml(d))));
  check('…even when the typed text holds an address: it prints as text', (h => /https:\/\/example\.com\/a\/very\/long\/path/.test(plain(h)) && !/(?:src|href)=["']?https?:/.test(h))(buildPurchaseOrderHtml(fx.poStress)));
  check('the fonts and the logo are embedded as data URIs', /font-family:'Poppins'/.test(po) && /<img class="dh-logo" alt="Motolinkers" src="data:image\/png;base64,/.test(po) && !/url\((?!['"]?data:)/.test(po));
  const HEXES = new Set([...Object.values(brand.COLORS), '#FFFFFF', '#FFF', '#B3261E'].map(c => c.toUpperCase()));
  const stray = [...new Set((po.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map(c => c.toUpperCase()).filter(c => !HEXES.has(c)))];
  check('every colour on the page is the brand\'s (palette, white) — plus the one restrained red for "fill this in" — no gold, no navy, no stray grey', stray.length === 0, stray.join(' '));
  check('Arabic names, suppliers, colours and notes print as typed, mixed with Latin text',
    ['شركة النيل للسيارات - Nile Auto', 'السيد/ وانغ لي / +86 755 8888 1234', 'عمر حسن', 'سارة مصطفى', 'شركة مصطفى للتجارة', 'EXT: رمادي', 'INT: أسود', 'برجاء تأكيد موعد الإنتاج وقائمة أرقام الشاسيه خلال ٣ أيام عمل من استلام هذا الأمر.'].every(w => plain(buildPurchaseOrderHtml(fx.poArabic)).includes(w)));
  eq('an Arabic-named lead is the client of a line that names nobody (poArabic, line 3)', table(buildPurchaseOrderHtml(fx.poArabic)).rows[2][1], 'عمر حسن');

  // ═══ 7. In a real browser: markup is text, the page reaches nowhere, nothing overflows, the figures line up ═══
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], timeout: 120000 });
  try {
    // What the page does and where things are, measured in the page itself (this function runs in the browser).
    const probe = () => {
      const root = document.querySelector('.po'), bad = [];
      const rr = root ? root.getBoundingClientRect() : null;
      for (const el of root ? root.querySelectorAll('*') : []) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const name = `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`;
        if (r.right > rr.right + 1 || r.left < rr.left - 1) bad.push(`${name} sticks out (${Math.round(r.left - rr.left)}…${Math.round(r.right - rr.right)}px)`);
        else if (getComputedStyle(el).display !== 'inline' && el.clientWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`${name} clips its text`);
      }
      // where a word is drawn: in a paragraph that runs right to left, the first word is the rightmost
      const xOf = (sel, word) => {
        for (const el of document.querySelectorAll(sel)) {
          const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const i = n.data.indexOf(word);
            if (i < 0) continue;
            const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length);
            const b = r.getBoundingClientRect();
            return b.width ? Math.round(b.left) : null;
          }
        }
        return null;
      };
      const RED = 'rgb(179, 38, 30)';
      const reds = [...document.querySelectorAll('.po *')].map(el => {
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim(), color: cs.color === RED && el.textContent.trim() !== '', border: cs.borderBottomColor === RED && cs.borderBottomWidth !== '0px', cls: String(el.className) };
      }).filter(r => r.color || r.border);
      const fig = document.querySelector('td.fig');
      const widthOf = txt => {
        if (!fig) return 0;
        const cs = getComputedStyle(fig), s = document.createElement('span');
        s.style.cssText = `position:absolute;white-space:nowrap;font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};font-variant-numeric:${cs.fontVariantNumeric}`;
        s.textContent = txt; document.body.appendChild(s);
        const w = s.getBoundingClientRect().width; s.remove(); return w;
      };
      // a figure cell's text: is it on one line, and does it end where its cell's content ends (right-aligned)?
      const money = [...document.querySelectorAll('td.num')].filter(td => td.textContent.trim()).map(td => {
        const range = document.createRange(); range.selectNodeContents(td);
        const cs = getComputedStyle(td), cell = td.getBoundingClientRect(), text = range.getBoundingClientRect();
        return { lines: range.getClientRects().length, gap: Math.abs((cell.right - parseFloat(cs.paddingRight)) - text.right) };
      });
      const sizes = [...document.querySelectorAll('table.po-tbl tbody td')].filter(td => td.textContent.trim() && !td.closest('tr.sum')).map(td => {
        const own = [td, ...td.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.data.trim()));
        return Math.min(...own.map(e => parseFloat(getComputedStyle(e).fontSize)));
      });
      const tbl = document.querySelector('table.po-tbl');
      const footer = document.querySelector('.doc-footer');
      return {
        scripts: document.querySelectorAll('script').length,
        handlers: [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length,
        h1: document.querySelectorAll('h1').length,
        imgs: [...document.querySelectorAll('img')].map(i => i.className),
        text: root ? root.innerText : '',
        wide: document.documentElement.scrollWidth > window.innerWidth + 1,
        bad: bad.slice(0, 6),
        loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
        reds,
        tabular: [widthOf('11111'), widthOf('00000'), widthOf('88888')].map(w => +w.toFixed(3)),
        figFont: fig ? getComputedStyle(fig).fontFamily : '',
        money,
        minFont: Math.min(...sizes, 99),
        tel: [...document.querySelectorAll('.tel')].map(e => e.getClientRects().length),
        tableW: tbl ? Math.round(tbl.getBoundingClientRect().width) : 0, rootW: rr ? Math.round(rr.width) : 0,
        cols: tbl ? [...tbl.querySelectorAll('thead th')].map(th => th.getBoundingClientRect().width) : [],
        foot: footer ? [+(footer.getBoundingClientRect().height * 25.4 / 96).toFixed(1), parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--foot-h'))] : [0, 0],
        bidi: {
          client: [xOf('td.cl', 'عمر'), xOf('td.cl', 'حسن')],
          title: [xOf('.po-to', 'شركة'), xOf('.po-to', 'Nile')],
          phone: ['+86', '755', '8888', '1234'].map(w => xOf('.po-sup .v', w)),
          arNote: ['برجاء', 'تأكيد', 'موعد'].map(w => xOf('.po-note p', w)),
          laNote: ['Please', 'confirm', 'production'].map(w => xOf('.po-note p', w)),
        },
      };
    };
    const FAILED = { scripts: -1, handlers: -1, h1: -1, imgs: [], text: '', wide: true, bad: [], loaded: [], reds: [], tabular: [0, 1, 2], figFont: '', money: [], minFont: 0, tel: [], tableW: 0, rootW: 1, cols: [], foot: [0, 0], bidi: {} };
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
        return { f: await page.evaluate(probe), seen, dialogs };
      } catch (e) {
        return { f: { ...FAILED, bad: [`the page failed: ${String(e.message).slice(0, 80)}`] }, seen, dialogs };
      } finally {
        if (page) await page.close().catch(() => {});
      }
    };
    const FIT = [['the sample order', fx.po], ['the one-line order', fx.poOneLine], ['the nineteen-line order', fx.poLong], ['the empty order', fx.poMinimal], ['the markup-filled order', fx.poHostile],
      ['long names, words with no break, a 13-figure price and a quantity of 120', fx.poStress], ['Arabic and Latin mixed', fx.poArabic],
      ['quantities of 1,200 and 99,999', { ...fx.po, items: fx.po.items.map((it, i) => ({ ...it, units: [3, 1200, 12000, 99999, 120][i] })) }]];
    const complete = { ...fx.po, payment_terms: '100% in advance', documents_required: 'Commercial Invoice / Packing List' };
    const evil = buildPurchaseOrderHtml({ ...fx.po, notes: '<img src="https://example.com/a.png">', supplier_name: '<script>alert(1)</script>' });
    const [hz, ev, control, bigNote, bigAddr, bigBoth, cleanRed, emptyRed, ...fits] = await Promise.all([
      inspect(buildPurchaseOrderHtml(fx.poHostile)), inspect(evil), inspect('<!DOCTYPE html><html><body><img src="https://example.com/x.png"></body></html>'),
      inspect(html({ settings: { footer_note: BIG_NOTE } })), inspect(html({ settings: { company_address: BIG_ADDRESS } })), inspect(html({ settings: { footer_note: BIG_NOTE, company_address: BIG_ADDRESS } })),
      inspect(buildPurchaseOrderHtml(complete)), inspect(buildPurchaseOrderHtml(fx.poMinimal)),
      ...FIT.map(([, d]) => inspect(buildPurchaseOrderHtml(d)))]);
    const byName = Object.fromEntries(FIT.map(([label], i) => [label, fits[i]]));
    const sample = fits[0].f;

    check('hostile markup in a real browser: no script, no handler, one title, only the logo as a picture, no dialog',
      hz.f.scripts === 0 && hz.f.handlers === 0 && hz.f.h1 === 1 && same(hz.f.imgs, ['dh-logo']) && hz.dialogs.length === 0, JSON.stringify({ ...hz.f, text: undefined, reds: undefined }));
    check('…and the typed markup is on the page as literal text',
      ['<img src=x onerror=alert(1)> PCH & "Co"', '<b>Omar</b>', '</td><td>X', '"quoted"', '<script>alert(1)</script>'].every(x => hz.f.text.includes(x)));
    check('…and the page asked for nothing but inline data', hz.seen.length > 0 && hz.seen.every(u => u.startsWith('data:')), hz.seen.filter(u => !u.startsWith('data:')).join(' '));
    check('an order holding a script and a link in its text fetches nothing, runs nothing and carries no handler',
      ev.f.scripts === 0 && ev.f.handlers === 0 && ev.dialogs.length === 0 && ev.seen.every(u => u.startsWith('data:')) && same(ev.f.imgs, ['dh-logo']), JSON.stringify(ev.seen.filter(u => !u.startsWith('data:'))));
    check('(control) the request recorder does see a link when there is one', control.seen.some(u => u.startsWith('https://example.com/')));
    FIT.forEach(([label], i) => check(`${label}: nothing sticks out of its box or the page, and no text is clipped`, fits[i].f.bad.length === 0 && !fits[i].f.wide, fits[i].f.bad.join(' | ')));
    check('the grid is exactly the width of the text column, however much it holds: no cell stretches it',
      FIT.every(([label]) => Math.abs(byName[label].f.tableW - byName[label].f.rootW) <= 1) && sample.cols.length === 9, FIT.map(([label]) => `${byName[label].f.tableW}/${byName[label].f.rootW}`).join(' '));
    const MM = 96 / 25.4;
    check('the column widths are the designed ones (NO 6.5 · CLIENT 25 · VEHICLE 26 · COLOR 21.5 · YEAR 9.5 · QTY 7.5 · PRICE 17 · TOTAL 21 mm), the accessories column takes the rest',
      same([0, 1, 2, 3, 4, 6, 7, 8].map(i => +(sample.cols[i] / MM).toFixed(1)), [6.5, 25, 26, 21.5, 9.5, 7.5, 17, 21]) && Math.abs(sample.cols[5] / MM - 48) < 0.3, sample.cols.map(c => +(c / MM).toFixed(1)).join(' '));
    check('the body text of the grid is 7.5pt or larger — a person can read it (the sample order)', sample.minFont >= 10 - 0.01, `${(sample.minFont * 0.75).toFixed(2)}pt`);
    check('the figures are set in a face whose digits are all one width — a column of amounts lines up digit under digit',
      /^'?Cairo/.test(sample.figFont) && sample.tabular[0] === sample.tabular[1] && sample.tabular[1] === sample.tabular[2] && sample.tabular[0] > 0, `${sample.figFont} ${sample.tabular.join(' / ')}`);
    const stress = byName['long names, words with no break, a 13-figure price and a quantity of 120'].f;
    check('every amount sits on one line and ends exactly at the right edge of its cell (right-aligned), in the sample and in the stress order',
      sample.money.length === 10 && stress.money.length === 6 && [sample, stress].every(f => f.money.every(m => m.lines === 1 && m.gap < 1)), JSON.stringify(stress.money));
    check('every telephone number stays on one line, wherever the text around it wraps', stress.tel.length === 4 && stress.tel.every(n => n === 1) && sample.tel.length >= 2 && sample.tel.every(n => n === 1), `${stress.tel.length} numbers: ${stress.tel.join('')}`);
    check('the embedded Poppins is what is set, and Cairo for the figures (no fallback font)', sample.loaded.includes('Poppins') && sample.loaded.includes('Cairo'), sample.loaded.join(','));

    // red: only the words somebody must fill in, and a blank delivery line
    eq('in the sample order only "CIF ONLY …" is red, in the brand\'s one restrained red, and no line is red', [sample.reds.filter(r => r.color).map(r => r.text), sample.reds.filter(r => r.border).length], [['CIF ONLY ( B/L / Telex Release / Insurance Policy)'], 0]);
    check('in an order with none of those words and every delivery detail filled in, nothing is red at all', cleanRed.f.reds.length === 0, JSON.stringify(cleanRed.f.reds));
    eq('in the empty order the two standard placeholders are red, and so are the three delivery lines left blank — and nothing else',
      [emptyRed.f.reds.filter(r => r.color).map(r => r.text), emptyRed.f.reds.filter(r => r.border).length], [['XXXXX', 'CIF ONLY ( B/L / Telex Release / Insurance Policy)'], 3]);

    // the room the body keeps for the footer
    const feet = [['usual', fits[0]], ['long note', bigNote], ['long address', bigAddr], ['both', bigBoth]];
    check('the room the body keeps for the footer is always more than the footer needs (the usual footer, a long note, a long address, both)',
      feet.every(([, r]) => r.f.foot[0] > 10 && r.f.foot[1] - r.f.foot[0] >= 3), feet.map(([n, r]) => `${n}: footer ${r.f.foot[0]}mm, room ${r.f.foot[1]}mm`).join(' | '));

    // Arabic and Latin mixed: each value takes its direction from its own first letter
    const ar = byName['Arabic and Latin mixed'].f.bidi;
    const known = xs => xs.every(x => x !== null);
    check('mixed Arabic and Latin: an Arabic client name runs right to left — its first word is the rightmost — and so does an Arabic supplier name that ends in Latin',
      known(ar.client) && known(ar.title) && ar.client[0] > ar.client[1] && ar.title[0] > ar.title[1], JSON.stringify([ar.client, ar.title]));
    check('…a telephone number inside Arabic text still reads left to right: +86, 755, 8888, 1234 from the left',
      known(ar.phone) && ar.phone[0] < ar.phone[1] && ar.phone[1] < ar.phone[2] && ar.phone[2] < ar.phone[3], JSON.stringify(ar.phone));
    check('…and each paragraph of a note is read by its own first letter: the Arabic one right to left, the Latin one left to right',
      known(ar.arNote) && known(ar.laNote) && ar.arNote[0] > ar.arNote[1] && ar.arNote[1] > ar.arNote[2] && ar.laNote[0] < ar.laNote[1] && ar.laNote[1] < ar.laNote[2], JSON.stringify([ar.arNote, ar.laNote]));
  } finally { await browser.close(); }

  // ═══ 8. In real PDFs ═══
  const pdftotext = have('pdftotext');
  // every line on the standard accessories, so each row ends with the same words ("… electric pump")
  const nLines = n => ({ ...fx.po, items: Array.from({ length: n }, (_, i) => ({ ...fx.po.items[i % 5], client: `Client ${i + 1}`, units: (i % 3) + 1, accessories: '' })) });
  // Counts that put a page break in each place the total can land: everything on page 1 (5), the terms alone
  // on page 2 (6, 10), the last rows moving to page 2 with the total (11, 12), the terms alone on page 3
  // (23, 26), the last rows moving to page 3 (27, 30).
  const SWEEP = [5, 6, 10, 11, 12, 22, 23, 26, 27, 30];
  const bigFooter = { ...nLines(19), settings: { footer_note: BIG_NOTE, company_address: BIG_ADDRESS } };
  const toRender = { po: fx.po, one: fx.poOneLine, long: fx.poLong, minimal: fx.poMinimal, hostile: fx.poHostile, stress: fx.poStress, arabic: fx.poArabic, footer: bigFooter,
    ...Object.fromEntries(SWEEP.map(n => [`n${n}`, nLines(n)])) };
  // Each render starts its own Chrome: a few at a time, so a busy machine does not time one out.
  const pdfs = {};
  const queue = Object.entries(toRender);
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const doc = buildPurchaseOrderHtml(job[1]);
      pdfs[job[0]] = Buffer.from(await renderPdf(doc).catch(() => renderPdf(doc)));     // a loaded machine can time a Chrome launch out once
    }
  }));
  const lat = b => b.toString('latin1');
  const pagesOf = b => (lat(b).match(/\/Type\s*\/Page[^s]/g) || []).length;
  const nPages = Object.fromEntries(Object.entries(pdfs).map(([k, b]) => [k, pagesOf(b)]));
  // each page's text in the order it was drawn (a table row's cells, a card's lines, one after another)
  const withFile = (k, fn) => {
    const f = path.join(os.tmpdir(), `doc-po-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(f, pdfs[k]);
    try { return fn(f); } finally { fs.unlinkSync(f); }
  };
  const pageTexts = k => withFile(k, f => Array.from({ length: nPages[k] }, (_, i) => spawnSync('pdftotext', ['-raw', '-f', String(i + 1), '-l', String(i + 1), f, '-'], { encoding: 'utf8' }).stdout || ''));

  check('every order is a real A4 PDF with the Poppins face embedded, and none links anywhere',
    Object.values(pdfs).every(b => b.slice(0, 5).toString() === '%PDF-' && /Poppins/.test(lat(b)) && /\/MediaBox\s*\[\s*0\s+0\s+595\.\d*\s+841\.\d*\s*\]/.test(lat(b)) && !/\/URI\b/.test(lat(b))));
  check('Arabic is set in the embedded Cairo face (and the figures of every order too)', /Cairo/.test(lat(pdfs.arabic)) && /Cairo/.test(lat(pdfs.po)));
  check('the normal order is exactly one page: the sample, the one-line order, the empty one, the markup-filled one, the Arabic one, and 1 to 5 lines',
    [pdfs.po, pdfs.one, pdfs.minimal, pdfs.hostile, pdfs.arabic].every(b => pagesOf(b) === 1) && nPages.n5 === 1, JSON.stringify({ po: nPages.po, one: nPages.one, minimal: nPages.minimal, hostile: nPages.hostile, arabic: nPages.arabic, n5: nPages.n5 }));
  check('the nineteen-line order flows onto a second page — not squeezed onto one, not cut off', nPages.long === 2, String(nPages.long));
  check('the stress order (very long names, a quantity of 120, a row of eighteen lines) takes two pages', nPages.stress === 2, String(nPages.stress));

  if (!pdftotext) console.log('  (pdftotext is not installed: the page-by-page checks of the PDFs are skipped)');
  else {
    // Letter-spaced capitals come out of pdftotext one letter at a time ("T O T A L"), so a label is
    // looked for with the spaces taken out; the figures and the words around them are read as they are.
    const has = (t, label) => nospace(t).includes(nospace(label));
    const HEAD = 'NO CLIENT VEHICLE COLOR EXT / INT YEAR ACCESSORIES / REMARKS QTY PRICE USD TOTAL USD';
    // The total block reads "8 vehicles 127,650 USD" in the extracted text: a line that starts with the count marks the page that has the block.
    const TOTAL = /^\d+(?:\.\d+)? vehicles?\b/m;
    // the letterhead, the number and "Page n of N" — on every page
    const furniture = k => pageTexts(k).every((tx, i) => /info@motolinkers\.com/.test(tx) && /Tax ID\s+773934006/.test(tx) && /Registration No\s+282378/.test(tx) && has(tx, 'AUTOMOTIVE • ELECTRIC • MOBILITY')
      && has(tx, 'PURCHASE ORDER MT28W88Y26') && count(tx, 'MT28W88Y26') >= 2 && /Confidential/.test(tx) && new RegExp(`Page ${i + 1} of ${nPages[k]}\\b`).test(tx));
    check('the sample order: letterhead, ID, "Confidential" and "Page 1 of 1" are on the page', furniture('po'));
    check('…and on every page of the long orders: the letterhead, the ID, the note and "Page n of N"', furniture('long') && furniture('stress') && SWEEP.every(n => furniture(`n${n}`)));

    // the printed page, as text: nothing the typist wrote is hidden by the layout
    {
      const all = nospace(pageTexts('po').join('\n'));
      const want = ['Omar Hassan', 'Sara Mostafa', 'Consignee:', 'Mostafa Trading', 'Karim Adel', 'Hana Fouad', 'Nile Motors', 'Deepal S05', '620 Laser Edition', '215 Max', 'Xpeng L03', '1330 Max', '625 Max', 'Mazda EZ60', 'EV 600 Max',
        'EXT: Grey', 'INT: Nebula Purple/White', 'INT: Grey', 'Ext: Black', 'INT: Purple', 'EXT: White', 'INT: Black', '2027', '2026', defaults.DOC_DEFAULT_ACCESSORIES, 'English system , wall mount charging cable',
        '17,800', '15,900', '31,800', '13,250', '14,100', '42,300', '22,500', '127,650', 'TOTAL', '8 vehicles', 'PCH auto', 'Yoyo / +8613380783532', 'China', fx.po.supplier_address, 'MT28W88Y26', '2026-10-12', 'Mohamed Yasser',
        'PAYMENT TERMS', '30% deposit to confirm the order', '70% balance due after the vehicle arrives in Shanghai Port', 'NOTES', fx.po.notes, 'DELIVERY TERMS', 'INCOTERM', 'FOB', 'Shanghai Port', 'Sino Trans Logistics', 'Ahmed Ali / +20 100 555 0199', fx.po.documents_required];
      const missing = want.filter(w => !all.includes(nospace(w)));
      check('the sample order\'s printed page carries every client, vehicle, colour, amount, term, note and delivery detail', missing.length === 0, missing.slice(0, 4).join(' | '));
      const [one] = pageTexts('one');
      check('the one-line order prints its line and its total: 1 vehicle, 17,800', has(one, 'Omar Hassan') && has(one, '17,800') && TOTAL.test(one) && /^1 vehicle\b/m.test(one));
      const mini = nospace(pageTexts('minimal').join('\n'));
      check('the empty order prints its number, a total of 0, the standard accessories-free grid and the standard terms and documents — and no placeholder',
        mini.includes('PO2601-0001') && mini.includes('TOTAL0USD') && mini.includes(nospace(defaults.DOC_DEFAULT_DOCUMENTS)) && mini.includes('30%deposittoconfirmtheorder') && mini.includes('XXXXX') && !/undefined|NaN|null/.test(mini));
    }

    // the long order: the head row, whole rows, the total with the last rows, the terms whole
    const lp = pageTexts('long');
    const pagesWith = (texts, label) => texts.map((tx, i) => (has(tx, label) ? i + 1 : 0)).filter(Boolean);
    const pagesMatching = (texts, re) => texts.map((tx, i) => (re.test(tx) ? i + 1 : 0)).filter(Boolean);
    const clientsOn = tx => [...tx.matchAll(/Client (\d+)\b/g)].map(m => +m[1]);
    check('long: every one of the nineteen lines is printed once and only once — a row is never split across two pages',
      Array.from({ length: 19 }, (_, i) => lp.reduce((n, tx) => n + clientsOn(tx).filter(c => c === i + 1).length, 0)).every(n => n === 1), lp.map(tx => clientsOn(tx).length).join(','));
    // a row split across two pages would leave its name on one page and its last words on the next
    const whole = tx => clientsOn(tx).length === count(tx, 'electric pump');
    check('long: no row is torn across the two pages — each page holds as many endings ("… electric pump") as names', lp.every(whole), lp.map(tx => `${clientsOn(tx).length}/${count(tx, 'electric pump')}`).join(' '));
    check('long: the lines run over two pages, so the repeating head row was really in play', clientsOn(lp[0]).length >= 5 && clientsOn(lp[1]).length >= 5 && clientsOn(lp[0]).length + clientsOn(lp[1]).length === 19, lp.map(tx => clientsOn(tx).length).join(','));
    check('long: the head row is at the top of every page that carries lines', lp.every(tx => { const i = tx.search(/Client \d+\b/); return i < 0 || has(tx.slice(0, i), HEAD); }));
    check('long: the title ORDER LINES is on the page of the first line only', pagesWith(lp, 'ORDER LINES').join() === '1');
    check('long: the total is printed once, on the page of the last lines, and reads 659,120 USD for 37 vehicles',
      pagesMatching(lp, TOTAL).join() === '2' && /^37 vehicles\b/m.test(lp[1]) && has(lp[1], '659,120') && clientsOn(lp[1]).includes(19) && clientsOn(lp[1]).includes(18));
    check('long: the terms are whole and on one page, after the total — payment, notes, delivery, documents', (pp => pp.length === 1 && has(lp[pp[0] - 1], 'DELIVERY TERMS') && has(lp[pp[0] - 1], 'NOTES') && has(lp[pp[0] - 1], fx.poLong.documents_required) && pp[0] >= 2)(pagesWith(lp, 'PAYMENT TERMS')));

    // Every place a page can break: the total always travels with the last rows, the terms never split
    const sweep = SWEEP.map(n => {
      const tx = pageTexts(`n${n}`), where = k => tx.map((x, i) => (k(x) ? i + 1 : 0)).filter(Boolean);
      const totalAt = where(x => TOTAL.test(x)), payAt = where(x => has(x, 'PAYMENT TERMS')), delAt = where(x => has(x, 'DELIVERY TERMS')), docAt = where(x => has(x, 'DOCUMENTS REQUIRED'));
      const withTotal = totalAt.length === 1 ? tx[totalAt[0] - 1] : '';
      return {
        n,
        once: Array.from({ length: n }, (_, i) => tx.reduce((c, x) => c + clientsOn(x).filter(v => v === i + 1).length, 0)).every(c => c === 1) && tx.every(whole),
        total: totalAt.length === 1 && (n < 2 || (clientsOn(withTotal).includes(n) && clientsOn(withTotal).includes(n - 1))),
        terms: payAt.length === 1 && delAt.length === 1 && docAt.length === 1 && payAt[0] === delAt[0] && delAt[0] === docAt[0] && payAt[0] >= totalAt[0],
        head: tx.every(x => { const i = x.search(/Client \d+\b/); return i < 0 || has(x.slice(0, i), HEAD); }),
        title: where(x => has(x, 'ORDER LINES')).join() === '1',
        crossed: tx.filter(x => clientsOn(x).length).length > 1,
        // a head row with no line under it
        stranded: tx.some(x => has(x, 'TOTAL USD') && !clientsOn(x).length && !TOTAL.test(x)),
        pages: tx.length,
      };
    });
    check(`line-count sweep (${SWEEP.join(', ')} lines): every line is printed once and whole, and the total is on one page with the last two lines`, sweep.every(r => r.once && r.total), sweep.filter(r => !r.once || !r.total).map(r => r.n).join(','));
    check('…the terms are whole and on one page, never before the total', sweep.every(r => r.terms), sweep.filter(r => !r.terms).map(r => r.n).join(','));
    check('…the head row tops every page of lines, the title ORDER LINES stays with the first line, and no head row is left alone', sweep.every(r => r.head && r.title && !r.stranded), sweep.filter(r => !(r.head && r.title && !r.stranded)).map(r => r.n).join(','));
    check('…and the sweep did cross page breaks (the keep-together rules were in play): lines on two or three pages, 1 to 3 pages in all',
      sweep.filter(r => r.crossed).length >= 5 && sweep.some(r => r.pages === 1) && sweep.some(r => r.pages === 3), sweep.map(r => `${r.n}:${r.pages}p${r.crossed ? ' split' : ''}`).join(' '));

    // A row taller than what is left of the page moves to the next page whole
    const st = pageTexts('stress');
    check('a row too tall for the foot of the page moves to the next page whole, not torn across two (the 120 × "Floor mats" row)',
      count(nospace(st[0]), 'Floormats') === 0 && count(nospace(st[1]), 'Floormats') === 60 && has(st[1], 'Nile Motors') && !has(st[0], 'Nile Motors') && has(st[0], 'Hana Fouad') && /^134 vehicles\b/m.test(st[1]) && has(st[1], '103,617,507.99'),
      `page 1: ${count(nospace(st[0]), 'Floormats')}, page 2: ${count(nospace(st[1]), 'Floormats')}`);
    check('…the head row is repeated over it, and the total, the terms and the wide note follow it on the same page', has(st[1].slice(0, st[1].search(/Nile Motors/)), HEAD) && TOTAL.test(st[1]) && has(st[1], 'PAYMENT TERMS') && has(st[1], 'NOTES') && has(st[1], 'DELIVERY TERMS'));
    check('the stress order prints every long name, word with no break and amount whole',
      ['Mohamed Abdelrahman El-Sayed Hassan Ibrahim', 'Al-Nahda Automotive Trading & Import Company (Cairo Branch)', 'Supercalifragilisticexpialidocious-Model-Name-Without-Any-Spaces-At-All-X', 'ModelNameWithoutAnySpacesAtAllX', 'TrimNameWithoutAnySpacesAtAllXXXXXXXX', '123,456.50', '1,481,478', '99,999,999.99', '2,136,030', '17,800.25',
        'https://example.com/a/very/long/path/without/spaces/that/keeps/going/and/going?x=1&y=2', 'Guangzhou Zhongxin International Automobile Import & Export Trading Company Limited', '+86 139 0000 1234', '+20 122 333 4455', 'XXXXX Port', 'CIF ONLY: Insurance Certificate + Bill of Lading'].every(w => nospace(st.join('\n')).includes(nospace(w))));

    // The footer grows with a long note and a long address; the body leaves it room (no row runs under it)
    const bboxes = (k, page) => withFile(k, f => {
      const xml = spawnSync('pdftotext', ['-bbox', '-f', String(page), '-l', String(page), f, '-'], { encoding: 'utf8' }).stdout || '';
      return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(m => ({ y0: +m[2], y1: +m[4], t: m[5] }));
    });
    const fw = bboxes('footer', 1);
    const footerTop = Math.min(...fw.filter(w => w.t === 'Office').map(w => w.y0));
    const lowestRow = Math.max(...fw.filter(w => w.t === 'pump').map(w => w.y1));   // "…electric pump", the end of every accessories text
    check('a long footer note and a long address push the body up, not under the footer: the last row ends above the footer', isFinite(footerTop) && isFinite(lowestRow) && lowestRow < footerTop - 1,
      `last row ends at ${lowestRow.toFixed(1)}pt, the footer starts at ${footerTop.toFixed(1)}pt`);
    check('…and the footer\'s note is all there, on every page', pageTexts('footer').every(tx => has(tx, 'Prices are valid for the period stated above') && has(tx, 'next to the metro station')) && nPages.footer >= 2);
    check('the usual footer reserves the shell\'s own room, so nothing moves for a normal note',
      /--foot-h:26(?:\.0)?mm/.test(po) && /--foot-h:26(?:\.0)?mm/.test(html({ settings: { footer_note: 'Prices subject to change without notice' } })) && !/--foot-h:26(?:\.0)?mm/.test(buildPurchaseOrderHtml(bigFooter)));

    // The figures stand on the baseline of the text in the same row: a figure's first baseline sits lower in its
    // line than Poppins' does, and a PDF ignores vertical-align:baseline in a cell, so the grid compensates —
    // measured on the page itself: the lowest dark pixel of "Hassan" (no tail) and of the year and the quantity.
    if (!have('pdftoppm')) console.log('  (pdftoppm is not installed: the baseline check of the figures is skipped)');
    else {
      const words = withFile('po', f => {
        const xml = spawnSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', f, '-'], { encoding: 'utf8' }).stdout || '';
        return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] }));
      });
      const name = words.find(w => w.t === 'Hassan'), year = words.find(w => w.t === '2027');
      const qty = name && words.find(w => w.t === '1' && w.x0 > 330 && Math.abs(w.y0 - name.y0) < 8);
      let base = [];
      if (name && year && qty) {
        const DPI = 400, px = DPI / 72, cropY = Math.floor((name.y0 - 6) * px), cropH = Math.ceil((name.y1 - name.y0 + 12) * px);
        const ppm = withFile('po', f => {
          const out = path.join(os.tmpdir(), `doc-po-row-${process.pid}-${Math.random().toString(36).slice(2)}`);
          spawnSync('pdftoppm', ['-singlefile', '-r', String(DPI), '-f', '1', '-l', '1', '-x', '0', '-y', String(cropY), '-W', String(Math.ceil(595 * px)), '-H', String(cropH), f, out]);
          try { return fs.readFileSync(out + '.ppm'); } catch (_) { return null; } finally { try { fs.unlinkSync(out + '.ppm'); } catch (_) {} }
        });
        // a binary PPM: "P6", the width and height, 255, then rgb bytes
        const m = ppm && /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.slice(0, 40).toString('latin1'));
        if (m) {
          const W = +m[1], H = +m[2], off = m[0].length;
          const lowest = w => {      // the lowest row with a dark pixel inside the word's columns (a little below its box, up to its top)
            const x0 = Math.floor(w.x0 * px), x1 = Math.min(W, Math.ceil(w.x1 * px));
            for (let y = Math.min(H - 1, Math.ceil((w.y1 + 3) * px) - cropY); y >= Math.floor(w.y0 * px) - cropY; y--)
              for (let x = x0; x < x1; x++) if (ppm[off + (y * W + x) * 3] < 120) return y;
            return -1;
          };
          base = [lowest(name), lowest(year), lowest(qty)];
        }
      }
      check('the figures stand on the baseline of the name in the same row (the year and the quantity, to the nearest pixel at 400 dpi)',
        base.length === 3 && base.every(y => y > 0) && Math.abs(base[0] - base[1]) <= 1 && Math.abs(base[0] - base[2]) <= 1, `lowest dark pixel of the name, the year, the quantity: ${base.join(' / ')}`);
    }
  }

  // ═══ 9. The routes, end to end, against the real app ═══
  await routes();

})().catch(e => { console.error(e); results.push(false); }).then(() => {
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// A stubbed Supabase: just the tables the purchase-order routes touch. Everything else answers with an
// empty list, which is all the boot sequence needs.
const SAVED = {
  id: 7, po_number: 'PO2610-7777', title: 'Saved Supplier Co — 2 vehicle(s)', supplier: 'Saved Supplier Co', po_date: '2026-10-05', currency: 'EUR', status: 'sent', customer_id: 5,
  supplier_contact: 'Li / +86 21 5555 0100', supplier_address: 'Pudong, Shanghai', supplier_country: 'China', issuer: 'Sara', quote_id: 'MT30W777Y26',
  incoterm: 'CIF', delivery_location: 'Sokhna Port', service_provider: 'Maersk', contact: 'Omar / +20 100 555 0199',
  payment_terms: 'Saved terms: 100% before shipping', documents_required: 'B/L / Invoice', notes: 'Saved note: handle with care',
  items: [{ client: '', consignee: '', units: 2, brand: 'Zeekr', model: '001', trim: 'You', color: 'EXT: Grey INT: Black', year: '2027', accessories: '', pi_price: 31000,
    status: 'send_to_supplier', vin: 'LVVDB11B0RD000001', file_link: 'https://drive.example/file/1', payment_term: 'LC' }],
  custom_fields: {}, created_by: 'admin', created_at: '2026-10-05T10:00:00Z',
};
const SETTINGS_ROWS = [{ key: 'company_email', value: 'stubbed@motolinkers.example' }, { key: 'company_reg_no', value: '555000' }, { key: 'footer_note', value: 'Stub footer note' }];
const CUSTOMER = { id: 5, name: 'Ahmed Kamal', phone: '0101234567', client_folder: null };

function installFetchStub() {
  const realFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.includes('stub.supabase.co')) return realFetch(input, init);
    const table = (url.match(/\/rest\/v1\/([^?/]+)/) || [])[1] || '?';
    const h = (init && init.headers) || {};
    const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
    const single = accept.includes('pgrst.object');
    const method = (init && init.method) || 'GET';
    const q = new URL(url).searchParams;
    let rows = [];
    if (method === 'GET') {
      if (table === 'quotation_settings') rows = SETTINGS_ROWS;
      if (table === 'purchase_orders') {
        const id = (q.get('id') || '').replace('eq.', '');
        const cust = (q.get('customer_id') || '').replace('eq.', '');
        rows = id ? (id === String(SAVED.id) ? [SAVED] : []) : cust ? (cust === String(SAVED.customer_id) ? [SAVED] : []) : [];
      }
      if (table === 'customers' && (q.get('id') || '').replace('eq.', '') === '5') rows = [CUSTOMER];
    }
    if (single) {
      if (!rows.length) return new Response(JSON.stringify({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' }), { status: 406, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(rows[0]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

async function routes() {
  installFetchStub();
  require(process.cwd() + '/index.js');
  const ctx = require(process.cwd() + '/src/ctx.js');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const base = 'http://127.0.0.1:' + process.env.PORT;
  for (let i = 0; i < 60; i++) {                       // wait for the app to listen
    try { await fetch(base + '/api/auth/check'); break; } catch (_) { await new Promise(r => setTimeout(r, 250)); }
  }
  // Keep the HTML each PDF was printed from, so the page can be read as well as the file.
  let lastHtml = '';
  const render = ctx.renderQuotationPdf;
  check('the context hands the routes one HTML-to-PDF renderer', typeof render === 'function');
  ctx.renderQuotationPdf = async (h, o) => { lastHtml = h; return render(h, o); };

  const { token: admin } = await (await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();
  const mint = (token, permissions) => {
    ctx.employeeSessions.set(token, { id: 7, name: 'Test', username: 'test', job_title: 'Sales', permissions: normEmpPerms(permissions) });
    return token;
  };
  const exporter = mint('po-can-export', { purchaseorders: true, purchaseordersActions: { view: true, create: true, edit: true, delete: false, export: true } });
  const viewer = mint('po-no-export', { purchaseorders: true, purchaseordersActions: { view: true, create: true, edit: true, delete: false, export: false } });
  const nobody = mint('po-nothing', {});
  const call = async (method, p, token, body) => {
    const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; const text = await r.text(); try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text };
  };
  const pdfOf = r => Buffer.from((r.json && r.json.pdf) || '', 'base64');
  const textOfPdf = buf => {
    if (!have('pdftotext')) return null;
    const f = path.join(os.tmpdir(), `doc-po-route-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(f, buf);
    try { return spawnSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8' }).stdout || ''; } finally { fs.unlinkSync(f); }
  };

  // ── POST …/purchase-orders/pdf with a payload (the unsaved form) ──
  const payload = { po_number: 'PO2610-0042', po_date: '2026-10-01', supplier: 'Payload Supplier Ltd', currency: 'usd', customer_id: '5', issuer: 'Admin', quote_id: '',
    supplier_contact: 'Wang / +86 755 8888 1234', delivery_location: 'Alexandria', notes: 'From the form',
    items: [{ client: '', consignee: '', brand: 'BYD', model: 'Seal', trim: 'Design', color: 'EXT: White INT: Black', year: '2027', units: 2, accessories: '', pi_price: 15900, vin: 'LGXCH6CB5R0099999', file_link: 'https://drive.example/x' },
            { client: '', brand: '', model: '', trim: '' },
            { client: 'Mona', consignee: 'Mona Trading', brand: 'Kia', model: 'EV9', units: '3', pi_price: '20,000' }] };
  const r1 = await call('POST', '/api/dashboard/purchase-orders/pdf', admin, payload);
  const buf1 = pdfOf(r1);
  check('POST /api/dashboard/purchase-orders/pdf answers { pdf } — a real one-page A4 PDF',
    r1.status === 200 && buf1.slice(0, 5).toString() === '%PDF-' && /\/MediaBox\s*\[\s*0\s+0\s+595\.\d*\s+841\.\d*\s*\]/.test(buf1.toString('latin1')) && (buf1.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 1, `${r1.status} ${r1.text.slice(0, 80)}`);
  const t1 = table(lastHtml);
  eq('…the lines the form sent, as the route normalised them: a blank line dropped, the lead\'s name for a line with no client, "Consignee:" under another, a quantity and a price typed as text read as numbers',
    t1 && t1.rows.slice(0, 3), [['1', 'Ahmed Kamal', 'BYD Seal Design', 'EXT: White INT: Black', '2027', ACC, '2', '15,900', '31,800'], ['2', 'Mona Consignee: Mona Trading', 'Kia EV9', '', '', ACC, '3', '20,000', '60,000'], ['3', '', '', '', '', '', '', '', '']]);
  check('…five rows in all, a total of 91,800 USD for 5 vehicles (2 × 15,900 + 3 × 20,000)', t1 && t1.rows.length === 5 && t1.total === 'TOTAL 5 vehicles 91,800 USD', t1 && t1.total);
  check('…the supplier is the form\'s "supplier" field, the currency is printed in capitals, the ID falls back to the order\'s number, and the issuer and note are there',
    supplierOf(lastHtml).Name === 'Payload Supplier Ltd' && supplierOf(lastHtml).Contact === 'Wang / +86 755 8888 1234' && metaOf(lastHtml).CURRENCY === 'USD' && metaOf(lastHtml).ID === 'PO2610-0042' && metaOf(lastHtml).ISSUER === 'Admin' && /From the form/.test(plain(lastHtml)));
  check('…the company details come from the database settings (e-mail, registration number, footer note)', /stubbed@motolinkers\.example/.test(footerOf(lastHtml)) && /Registration No 555000/.test(footerOf(lastHtml)) && /Stub footer note/.test(footerOf(lastHtml)), footerOf(lastHtml).slice(0, 200));
  check('…and the VIN and the file link the form carried are not on the page', !/LGXCH6CB5R0099999|drive\.example/.test(lastHtml));
  const txt1 = textOfPdf(buf1);
  if (txt1 === null) console.log('  (pdftotext is not installed: the text of the route\'s PDFs is not read)');
  else check('…and the PDF itself carries them: the supplier, the lead\'s name, the vehicles, the total and the database\'s company details',
    ['Payload Supplier Ltd', 'Ahmed Kamal', 'Mona', 'BYD Seal', 'Kia EV9', '15,900', '31,800', '60,000', '5 vehicles', '91,800', 'stubbed@motolinkers.example', 'Registration No 555000'].every(w => nospace(txt1).includes(nospace(w))));
  const rH = await call('POST', '/api/dashboard/purchase-orders/pdf', admin, { ...payload, supplier: '<img src=x onerror=alert(1)> Evil & "Co"', notes: '<script>alert(1)</script>', items: [{ client: '<b>Omar</b>', brand: '</td><td>X', pi_price: 1000 }] });
  const txtH = textOfPdf(pdfOf(rH));
  check('markup posted to the route comes out as text — in the page the route built and, when pdftotext is there, in the PDF',
    rH.status === 200 && !/<script|<img src=x|<b>Omar|<\/td><td>X/.test(body(lastHtml)) && /&lt;img src=x onerror=alert\(1\)&gt; Evil &amp; &quot;Co&quot;/.test(lastHtml)
    && (txtH === null || ['<img src=x onerror=alert(1)> Evil & "Co"', '<script>alert(1)</script>', '<b>Omar</b>', '</td><td>X'].every(w => nospace(txtH).includes(nospace(w)))));
  const r1b = await call('POST', '/api/dashboard/purchase-orders/pdf', admin, {});
  check('an empty form still makes a PDF (a generated number, five blank rows, the standard terms)', r1b.status === 200 && pdfOf(r1b).slice(0, 5).toString() === '%PDF-' && table(lastHtml).rows.length === 5 && /^PO\d{4}-\d{4}$/.test(metaOf(lastHtml).ID), `${r1b.status} ${r1b.text.slice(0, 80)} ${metaOf(lastHtml).ID}`);

  // ── POST …/purchase-orders/:id/pdf (a saved order) ──
  const r2 = await call('POST', '/api/dashboard/purchase-orders/7/pdf', admin);
  check('POST /api/dashboard/purchase-orders/:id/pdf makes the saved order\'s PDF and names it by its number', r2.status === 200 && r2.json.name === 'PO2610-7777' && pdfOf(r2).slice(0, 5).toString() === '%PDF-', `${r2.status} ${r2.text.slice(0, 80)}`);
  const t2 = table(lastHtml);
  eq('…the saved line, with the lead\'s name for the client it did not name, the standard accessories, 2 × 31,000 in euros',
    [t2 && t2.rows[0], t2 && t2.total, t2 && t2.head.slice(7)], [['1', 'Ahmed Kamal', 'Zeekr 001 You', 'EXT: Grey INT: Black', '2027', ACC, '2', '31,000', '62,000'], 'TOTAL 2 vehicles 62,000 EUR', ['PRICE EUR', 'TOTAL EUR']]);
  check('…the saved supplier, ID (the quote), terms, delivery details and note', metaOf(lastHtml).ID === 'MT30W777Y26' && supplierOf(lastHtml).Name === 'Saved Supplier Co' && same(paymentOf(lastHtml), ['Saved terms: 100% before shipping'])
    && deliveryOf(lastHtml).map(p => p.v).slice(0, 4).join('|') === 'CIF|Sokhna Port|Maersk|Omar / +20 100 555 0199' && /Saved note: handle with care/.test(plain(lastHtml)) && !/LVVDB11B0RD000001|drive\.example/.test(lastHtml));
  const r3 = await call('POST', '/api/dashboard/purchase-orders/999/pdf', admin);
  check('an order that does not exist is a 404, not a broken file', r3.status === 404 && /not found/i.test((r3.json || {}).error || ''), `${r3.status} ${r3.text.slice(0, 80)}`);

  // ── The team portal, and who may export ──
  const e1 = await call('POST', '/api/employee/purchase-orders/pdf', exporter, payload);
  const e2 = await call('POST', '/api/employee/purchase-orders/7/pdf', exporter);
  check('the team portal makes the PDF too, from the form and from a saved order', e1.status === 200 && pdfOf(e1).slice(0, 5).toString() === '%PDF-' && e2.status === 200 && e2.json.name === 'PO2610-7777' && pdfOf(e2).slice(0, 5).toString() === '%PDF-', `${e1.status}/${e2.status}`);
  const refused = r => r.status === 403 && /Not permitted/.test(r.text);
  const d1 = await call('POST', '/api/employee/purchase-orders/pdf', viewer, payload);
  const d2 = await call('POST', '/api/employee/purchase-orders/7/pdf', viewer);
  check('an employee without the purchase-order export permission is refused, for the form and for a saved order', refused(d1) && refused(d2), `${d1.status}/${d2.status}`);
  const d3 = await call('POST', '/api/employee/purchase-orders/pdf', nobody, payload);
  check('an employee with no purchase-order access at all is refused too', refused(d3), String(d3.status));
  const d4 = await call('GET', '/api/employee/purchase-orders/7', viewer);
  check('…while the same employee may still open the order (view is a separate permission)', d4.status === 200 && d4.json.po_number === 'PO2610-7777', String(d4.status));
  const d5 = await call('POST', '/api/dashboard/purchase-orders/pdf', null, payload);
  const d6 = await call('POST', '/api/dashboard/purchase-orders/pdf', 'wrong-token', payload);
  const d7 = await call('POST', '/api/dashboard/purchase-orders/pdf', 'po-can-export', payload);
  check('no login, a wrong token, or an employee token on the admin route are all 401', d5.status === 401 && d6.status === 401 && d7.status === 401, `${d5.status}/${d6.status}/${d7.status}`);

  // ── The client's Drive folder files the order as a PDF ──
  const uploads = [];
  ctx.driveAdminToken = async () => 'token';
  ctx.driveEnsureFolder = async () => 'root-folder';
  ctx.driveFindOrCreateFolder = async () => 'client-folder';
  ctx.driveUploadFile = async (_t, f) => { uploads.push(f); return { id: 'file-' + uploads.length, webViewLink: 'https://drive.example/' + uploads.length }; };
  const f1 = await call('POST', '/api/dashboard/customers/5/folder', admin, {});
  const up = uploads.find(u => /^PO /.test(u.name));
  check('syncing a client\'s folder files the purchase order as a PDF, named by its number', f1.status === 200 && !!up && up.name === 'PO PO2610-7777.pdf' && up.mimeType === 'application/pdf' && up.folderId === 'client-folder' && Buffer.from(up.buffer).slice(0, 5).toString() === '%PDF-', `${f1.status} ${uploads.map(u => u.name).join(',')} ${f1.text.slice(0, 120)}`);
  check('…and it is reported among the documents added', f1.status === 200 && (f1.json.added || []).includes('PO PO2610-7777.pdf') && !(f1.json.failed || []).length, JSON.stringify(f1.json && f1.json.added));
  if (up && have('pdftotext')) {
    const ft = textOfPdf(Buffer.from(up.buffer));
    check('…the filed PDF is the real order, built from the saved record, the lead and the settings', ['Saved Supplier Co', 'Ahmed Kamal', 'Zeekr 001', '62,000', 'MT30W777Y26', 'stubbed@motolinkers.example'].every(w => nospace(ft).includes(nospace(w))));
  }
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/purchase-orders.js'), 'utf8');
  check('the routes are mounted on both portals, guarded by the export permission, and build the page with the shared builder (no retired global logo)',
    (src.match(/requirePerm\('purchaseorders', 'export'\)/g) || []).length === 2 && /mountPurchaseOrderRoutes\('\/api\/dashboard\/purchase-orders', requireAuth\)/.test(src) && /mountPurchaseOrderRoutes\('\/api\/employee\/purchase-orders', requireEmployeeAuth\)/.test(src)
    && /require\('\.\.\/lib\/docs\/purchase-order'\)/.test(src) && !/BRAND_LOGO_URL/.test(src));
  check('the client-folder module and the context reach the same builder', ctx.buildPurchaseOrderHtml === buildPurchaseOrderHtml && typeof ctx.poClientName === 'function');
}
