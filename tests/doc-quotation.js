// The quotation PDF (src/lib/docs/quotation.js) — the document a salesperson sends a customer.
//
//   src/lib/docs/quotation.js         the look and the layout (buildQuotationHtml) and the numbers
//                                     it prints (quotationModel)
//   src/lib/docs/money.js             calcEgp / fmtNum — the two functions the editor totals with
//   tools/doc-fixtures/quotation.js   the sample quotations (the first is the company's own
//                                     "Mazda EZ60" quote, MT28W88Y26)
//
// What this guards, in order: the original Mazda quote to the dirham (every line, the total);
// the money rules (Free in any case, an empty price, rounding with a fractional rate, units,
// separators, a price that is words); what is left out when there is nothing to say (the
// vehicle, the specs card, the photo strip); which pictures count as photos (an inline picture
// or an https address, at most five); that nothing a person typed is lost and nothing typed is
// HTML, in any field; the page furniture (header, validity note, number); a real browser (markup
// is text, the page reaches nowhere but for an https photo, nothing overflows, the figures are
// flush right and line up, the cards and the photo strip sit where they should); and real PDFs:
// the normal quotation is exactly one A4 page, a long one flows onto more with the table head
// repeated, whole rows, whole cards, no title left behind and the total always with the last
// rows, and the footer on every page (that last part needs pdftotext and is skipped without it).
//
// The checks were mutation-tested: each key rule was broken in a scratch copy of the repo and the
// test had to go red (the money maths, the Free rule, the hidden-card and hidden-vehicle rules, the
// photo rule, escaping, the page-fit and keep-together rules).
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
const { buildQuotationHtml, quotationModel } = require('../src/lib/docs/quotation');
const { renderPdf } = require('../src/lib/docs/render');
const fx = require('../tools/doc-fixtures/quotation');

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
const cellText = c => squash(decode(c.replace(/<[^>]+>/g, ' ')));
// The page's own content, from the quotation's wrapper on (the letterhead comes before it in
// the markup and is read apart): every tag becomes a space, then the entities turn back into the
// characters that were typed — so typed markup, being escaped, is still there as text.
const body = h => h.slice(h.indexOf('<div class="q">'));
const plain = html => squash(decode(body(html).replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')));
const between = (html, from, to) => html.slice(html.indexOf(from), html.indexOf(to));
const headerOf = html => cellText(between(html, 'class="doc-header"', 'class="doc-footer"'));
const footerOf = html => cellText(between(html, 'class="doc-footer"', '<table class="flow">'));
// every row of the table that follows a section title, as its cells' texts
const rowsOf = (html, title) => {
  const at = html.indexOf(`<div class="sec-title">${title}</div>`);
  if (at < 0) return null;
  const t = html.slice(at, html.indexOf('</table>', at));
  return [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => cellText(c[1])));
};
// { head, rows, total } — the dark total block is the last row of the last table
const table = (html, title) => {
  const r = rowsOf(html, title);
  if (!r) return null;
  const tot = r.length && /^TOTAL PRICE BREAKDOWN IN EGP/.test((r[r.length - 1] || [])[0] || '') ? r.pop() : null;
  return { head: r[0], rows: r.slice(1), total: tot ? tot[0] : null };
};
// the first phrase of a list that is not found after the one before it, or -1 when all are, in order
const inOrder = (text, phrases) => {
  let at = 0;
  for (const p of phrases) { const i = text.indexOf(p, at); if (i < 0) return p; at = i + p.length; }
  return -1;
};

// A quotation with nothing in it but what a case needs.
const q = over => ({ id: 'MT00T00Y26', date: '2026-01-01', validTo: '2026-01-08', name: 'Test', vehicleModel: 'Test Car',
  items: [], logistics: [], currency: 'EGP', exchange: '51', issuer: '', customSpecs: [], imageDataUrls: [], settings: {}, ...over });
const html = over => buildQuotationHtml(q(over));
const bodyRows = (over, which = 'PRICING BREAKDOWN') => table(html(over), which);
const photoCount = h => count(body(h), '<img ');
const svg = i => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="5"><rect width="8" height="5" fill="#0${i}8040"/></svg>`)}`;
const MAZDA_SPECS = fx.quotation.customSpecs.map(s => s.val);
// a footer note of four lines and an address of four lines: the footer, fixed to the foot of every page, grows
const BIG_NOTE = 'Prices are valid for the period stated above, are quoted ex-works and are subject to change without prior notice. '.repeat(4);
const BIG_ADDRESS = 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo - Arab Republic of Egypt, next to the metro station, opposite the old bakery';

(async () => {
  // ═══ 1. The original Mazda quote, to the dirham ═══
  const mz = buildQuotationHtml(fx.quotation);
  const mzP = table(mz, 'PRICING BREAKDOWN'), mzL = table(mz, 'LOGISTICS PRICING BREAKDOWN');
  eq('pricing table: the original\'s columns, ITEM · UNIT · PRICE USD · TOTAL EGP', mzP && mzP.head, ['ITEM', 'UNIT', 'PRICE USD', 'TOTAL EGP']);
  eq('pricing table: 1,147,500 / 10,200 / 2,550 and three Free lines, in the original\'s order', mzP && mzP.rows, [
    ['Mazda EZ60 EV 600 Max', '1', '22,500', '1,147,500'], ['Wall mount', '1', '200', '10,200'], ['Cable', '1', '50', '2,550'],
    ['English Software', '1', 'Free', 'Free'], ['Tire Repair kit', '1', 'Free', 'Free'], ['Electric Pump', '1', 'Free', 'Free']]);
  eq('logistics table: ITEM · PRICE USD · TOTAL EGP, no unit column', mzL && mzL.head, ['ITEM', 'PRICE USD', 'TOTAL EGP']);
  eq('logistics table: 204,000 / 127,500 / 239,700 / 5,100 / 178,500', mzL && mzL.rows, [
    ['Ocean Freight', '4,000', '204,000'], ['THC, Documentation & Clearances', '2,500', '127,500'], ['Customs Vat & Tax', '4,700', '239,700'],
    ['Last Mile Wench to Door', '100', '5,100'], ['Service Fees', '3,500', '178,500']]);
  check('the total block closes the last table and reads 1,915,050 EGP (and the model agrees)',
    !!mzL && mzL.total === 'TOTAL PRICE BREAKDOWN IN EGP 1,915,050 EGP' && mzP.total === null && quotationModel(fx.quotation).total === 1915050, mzL && mzL.total);
  const mzText = plain(mz);
  const ORDER = ['QUOTATION', 'Mazda EZ60 EV 600 Max', 'ID MT28W88Y26 DATE 2026-07-08 VALID TO 2026-07-15 NAME Omar Hassan', 'PRICING BREAKDOWN', 'LOGISTICS PRICING BREAKDOWN', 'TOTAL PRICE BREAKDOWN IN EGP', 'KEY SPECS', 'PAYMENT TERMS'];
  check('the title, the vehicle, the ID / DATE / VALID TO / NAME card, both tables, the total and the cards — in that order', inOrder(mzText, ORDER) === -1, `missing or out of order: ${inOrder(mzText, ORDER)}`);
  check('KEY SPECS: the issuer line, then every spec line as typed', MAZDA_SPECS.length === 3 && inOrder(mzText, ['KEY SPECS', 'Issuer: Mohamed Yasser', ...MAZDA_SPECS.map(squash), 'PAYMENT TERMS']) === -1);
  check('PAYMENT TERMS: the three shares and their words, then Currency and Exchange',
    inOrder(mzText, ['PAYMENT TERMS', '70%', 'Deposit & Operation Kick-off', '20%', 'Upon Logistics', '10%', 'On Arrival to Egypt', 'Currency: EGP', 'Exchange: 51']) === -1);
  check('the vehicle is shown as given: one title, no guessed brand / model / trim split', /<div class="q-veh">Mazda EZ60 EV 600 Max<\/div>/.test(body(mz)) && !/q-veh-sub/.test(body(mz)));

  // ═══ 2. The money rules ═══
  eq('"Free" in any case, with stray spaces, or an empty price: Free in both money columns',
    bodyRows({ exchange: '10', items: [
      { name: 'Mats', unit: 1, priceUsd: 'free' }, { name: 'Kit', unit: 1, priceUsd: 'FREE' }, { name: 'Pump', unit: 1, priceUsd: '  Free  ' },
      { name: 'Blank', unit: 1, priceUsd: '' }, { name: 'Paid', unit: 1, priceUsd: '100' }] }).rows,
    [['Mats', '1', 'Free', 'Free'], ['Kit', '1', 'Free', 'Free'], ['Pump', '1', 'Free', 'Free'], ['Blank', '1', 'Free', 'Free'], ['Paid', '1', '100', '1,000']]);
  const freeItems = [{ name: 'a', priceUsd: 'free' }, { name: 'b', priceUsd: '' }, { name: 'c', priceUsd: 'FREE' }, { name: 'd', priceUsd: '100' }];
  eq('…and the free lines are left out of the total: only the paid 100 × 10 counts',
    [quotationModel(q({ exchange: '10', items: freeItems })).total, bodyRows({ exchange: '10', items: freeItems }).total], [1000, 'TOTAL PRICE BREAKDOWN IN EGP 1,000 EGP']);
  const fracItems = [{ name: 'A', unit: 1, priceUsd: '10' }, { name: 'B', unit: 3, priceUsd: '100.5' }];
  const frac = bodyRows({ exchange: '50.25', items: fracItems, logistics: [{ label: 'L', priceUsd: '7' }] }, 'LOGISTICS PRICING BREAKDOWN');
  eq('a fractional rate rounds each line: 10 × 50.25 = 502.5 → 503; 3 × 100.5 × 50.25 = 15,150.375 → 15,150; logistics 7 × 50.25 = 351.75 → 352',
    [bodyRows({ exchange: '50.25', items: fracItems }).rows.map(r => r[3]), frac.rows[0][2]], [['503', '15,150'], '352']);
  eq('…and the total is the sum of the rounded lines: 503 + 15,150 + 352 = 16,005', frac.total, 'TOTAL PRICE BREAKDOWN IN EGP 16,005 EGP');
  eq('the total adds the rounded lines, as the editor does, not the rounded sum: two lines of 50.5 → 51 + 51 = 102 (not 101)',
    bodyRows({ exchange: '50.5', logistics: [{ label: 'a', priceUsd: '1' }, { label: 'b', priceUsd: '1' }] }, 'LOGISTICS PRICING BREAKDOWN').total, 'TOTAL PRICE BREAKDOWN IN EGP 102 EGP');
  eq('a unit above 1 multiplies: 4 × 250 × 51 = 51,000; a fractional unit too: 2.5 × 250 × 51 = 31,875',
    bodyRows({ exchange: '51', items: [{ name: 'x4', unit: 4, priceUsd: '250' }, { name: 'x2.5', unit: '2.5', priceUsd: '250' }] }).rows,
    [['x4', '4', '250', '51,000'], ['x2.5', '2.5', '250', '31,875']]);
  eq('a unit that is empty, zero, missing or not a number counts as 1, as in the editor',
    bodyRows({ exchange: '2', items: [{ name: 'a', unit: '', priceUsd: '5' }, { name: 'b', unit: 0, priceUsd: '5' }, { name: 'c', unit: 'many', priceUsd: '5' }, { name: 'd', priceUsd: '5' }] }).rows.map(r => [r[1], r[3]]),
    [['1', '10'], ['1', '10'], ['1', '10'], ['1', '10']]);
  eq('thousands separators in the price, the line and the total; a fraction in the price is kept',
    [bodyRows({ exchange: '1', items: [{ name: 'Big', unit: 1, priceUsd: '1234567' }, { name: 'Frac', unit: 1, priceUsd: '320.5' }] }).rows,
      bodyRows({ exchange: '1', items: [{ name: 'Big', unit: 1, priceUsd: '1234567' }] }).total],
    [[['Big', '1', '1,234,567', '1,234,567'], ['Frac', '1', '320.5', '321']], 'TOTAL PRICE BREAKDOWN IN EGP 1,234,567 EGP']);
  eq('a blank or unusable exchange rate counts as 1, as everywhere else; numbers work as well as strings',
    [bodyRows({ exchange: '', items: [{ name: 'a', unit: 1, priceUsd: '100' }] }).rows[0][3], bodyRows({ exchange: 'abc', items: [{ name: 'a', unit: 1, priceUsd: '100' }] }).rows[0][3],
      bodyRows({ exchange: 48, items: [{ name: 'a', unit: 2, priceUsd: 150 }] }).rows[0][3]], ['100', '100', '14,400']);
  eq('every logistics line is price × the rate (unit 1): 4,000 × 51 = 204,000; "0" prints 0, an empty price a dash, "free" Free',
    bodyRows({ exchange: '51', logistics: [{ label: 'Freight', priceUsd: '4000' }, { label: 'Zero', priceUsd: '0' }, { label: 'None', priceUsd: '' }, { label: 'Gift', priceUsd: 'Free' }] }, 'LOGISTICS PRICING BREAKDOWN').rows,
    [['Freight', '4,000', '204,000'], ['Zero', '0', '0'], ['None', '—', '—'], ['Gift', 'Free', 'Free']]);
  const tbc = bodyRows({ exchange: '10', items: [{ name: 'Warranty', unit: 1, priceUsd: 'TBC' }, { name: 'Paid', unit: 1, priceUsd: '10' }] });
  eq('a price that is words ("TBC") prints as typed with a dash for the total, and stays out of the total (never "Free")',
    [tbc.rows, tbc.total], [[['Warranty', '1', 'TBC', '—'], ['Paid', '1', '10', '100']], 'TOTAL PRICE BREAKDOWN IN EGP 100 EGP']);
  const disc = bodyRows({ exchange: '10', items: [{ name: 'Car', priceUsd: '1000' }, { name: 'Discount', priceUsd: '-100' }] });
  eq('a negative price (a discount) is a negative line and lowers the total', [disc.rows[1], disc.total], [['Discount', '1', '-100', '-1,000'], 'TOTAL PRICE BREAKDOWN IN EGP 9,000 EGP']);
  check('with no logistics lines the total closes the pricing table', bodyRows({ exchange: '10', items: [{ name: 'Car', priceUsd: '1000' }] }).total === 'TOTAL PRICE BREAKDOWN IN EGP 10,000 EGP' && !/LOGISTICS PRICING BREAKDOWN/.test(html({ items: [{ name: 'Car', priceUsd: '1' }] })));
  const logOnly = plain(html({ logistics: [{ label: 'x', priceUsd: '1' }] }));
  check('a table with no rows is not drawn: logistics only has no PRICING BREAKDOWN table, and the other way round', count(logOnly, 'PRICING BREAKDOWN') === 1 && /LOGISTICS PRICING BREAKDOWN/.test(logOnly));
  check('with no lines at all the total stands alone, at 0', /class="q-alone"/.test(body(html({}))) && /TOTAL PRICE BREAKDOWN IN EGP 0 EGP/.test(plain(html({}))) && !/<table class="tbl/.test(html({})));
  eq('empty lines (no name and no price) are dropped; a line with only a name or only a price is kept; a bare string is a name',
    bodyRows({ exchange: '1', items: [{ name: '', unit: 1, priceUsd: '' }, { name: '  ', priceUsd: '  ' }, { name: 'Only name' }, { name: '', priceUsd: '5' }, null, 'Bare string'] }).rows.map(r => r[0]),
    ['Only name', '', 'Bare string']);
  eq('…the same for logistics: an empty line is dropped, a line with only a price is kept, a bare string is a label (with a dash for its price)',
    bodyRows({ exchange: '1', logistics: [{ label: '', priceUsd: '' }, { label: '  ', priceUsd: '  ' }, null, 'Bare label', { priceUsd: '5' }] }, 'LOGISTICS PRICING BREAKDOWN').rows,
    [['Bare label', '—', '—'], ['', '5', '5']]);
  eq('a unit of a thousand or more prints with its separator: 1,000 × 2 × 1 = 2,000',
    bodyRows({ exchange: '1', items: [{ name: 'Bulk', unit: 1000, priceUsd: '2' }] }).rows, [['Bulk', '1,000', '2', '2,000']]);
  eq('a logistics line with a price of words ("TBC") prints it as typed with a dash, and stays out of the total',
    (t => [t.rows, t.total])(bodyRows({ exchange: '10', logistics: [{ label: 'Insurance', priceUsd: 'TBC' }, { label: 'Freight', priceUsd: '5' }] }, 'LOGISTICS PRICING BREAKDOWN')),
    [[['Insurance', 'TBC', '—'], ['Freight', '5', '50']], 'TOTAL PRICE BREAKDOWN IN EGP 50 EGP']);
  eq('the total is the sum of the rounded lines of both tables, to the last unit: 0.5 × 51 → 26 (items) + 0.5 × 51 → 26 (logistics) = 52, not the rounded 51',
    bodyRows({ exchange: '51', items: [{ name: 'a', priceUsd: '0.5' }], logistics: [{ label: 'b', priceUsd: '0.5' }] }, 'LOGISTICS PRICING BREAKDOWN').total, 'TOTAL PRICE BREAKDOWN IN EGP 52 EGP');

  // ═══ 3. What is left out when there is nothing to say ═══
  const noSpecs = html({ issuer: '', customSpecs: [] });
  check('no issuer and no spec: the KEY SPECS card is left out and the payment card takes the full width',
    !/KEY SPECS|q-specs/.test(body(noSpecs)) && /class="q-cards solo"/.test(noSpecs) && /PAYMENT TERMS/.test(noSpecs));
  check('blank specs (an empty key and value, spaces, junk) do not make a card either', !/KEY SPECS/.test(html({ issuer: '   ', customSpecs: [{ key: '', val: '' }, { key: ' ', val: ' ' }, null, {}] })));
  check('an issuer alone is enough for the card', /KEY SPECS Issuer: Ahmed PAYMENT TERMS/.test(plain(html({ issuer: 'Ahmed', customSpecs: [] }))));
  const specsOnly = html({ issuer: '', customSpecs: [{ key: 'Range', val: '600 km' }, { key: '', val: 'Heated seats' }, { key: 'Colour', val: '' }, { key: ' ', val: ' ' }] });
  check('specs without an issuer: "key: value", or just the value when the key is empty; a key with no value stays; no "Issuer" line',
    /KEY SPECS Range: 600 km Heated seats Colour: PAYMENT TERMS/.test(plain(specsOnly)) && !/Issuer/.test(specsOnly) && /<li><b>Range:<\/b> 600 km<\/li>/.test(specsOnly) && /<li>Heated seats<\/li>/.test(specsOnly));
  check('a spec value with line breaks keeps them', /<li>line one<br>line two<\/li>/.test(html({ customSpecs: [{ key: '', val: 'line one\nline two' }] })));
  const noVeh = html({ vehicleModel: '' });
  check('no vehicle: no title and no rule under QUOTATION, and the ID card is still there', !/q-veh|q-bar/.test(body(noVeh)) && /<h1 class="q-h1">QUOTATION<\/h1>/.test(noVeh) && /ID MT00T00Y26/.test(plain(noVeh)));
  check('a vehicle of only spaces, or that is not text, is no vehicle', [' ', '   \n ', null, undefined, { a: 1 }, [], false, true].every(v => !/q-veh/.test(body(html({ vehicleModel: v })))));
  const veh = vm => { const h = html({ vehicleModel: vm }); return [(/<div class="q-veh">([^<]*)<\/div>/.exec(h) || [])[1], (/<div class="q-veh-sub">([^<]*)<\/div>/.exec(h) || [])[1]]; };
  eq('a clear separator splits the vehicle into a title and a grey subtitle: " — ", " | " and a line break (a second separator joins the rest)',
    [veh('BYD Seal — Design 700 km'), veh('BYD Seal | Design 700 km'), veh('BYD Seal\nDesign 700 km'), veh('BYD Seal — Design | 700 km')],
    [['BYD Seal', 'Design 700 km'], ['BYD Seal', 'Design 700 km'], ['BYD Seal', 'Design 700 km'], ['BYD Seal', 'Design · 700 km']]);
  eq('…and nothing else does: a hyphen, an en dash, spaces or a slash leave one title, as given',
    [veh('Mazda EZ60 EV 600 Max'), veh('BYD Seal - Design'), veh('BYD Seal – Design'), veh('Hongqi E-HS9 / 99 kWh')],
    [['Mazda EZ60 EV 600 Max', undefined], ['BYD Seal - Design', undefined], ['BYD Seal – Design', undefined], ['Hongqi E-HS9 / 99 kWh', undefined]]);
  const withPhotos = n => buildQuotationHtml({ ...fx.quotation, imageDataUrls: Array.from({ length: n }, (_, i) => svg(i)) });
  check('photos 0 to 5: exactly that many, and none means no strip at all — no empty boxes',
    [0, 1, 2, 3, 4, 5].every(n => { const h = withPhotos(n); return photoCount(h) === n && count(h, '<div class="ph">') === n && /class="q-photos"/.test(h) === (n > 0); }));
  const seven = withPhotos(7);
  check('the strip is capped at five: the first five, in order, and no more',
    photoCount(seven) === 5 && [0, 1, 2, 3, 4].every(i => seven.includes(`src="${escape(svg(i))}"`)) && [5, 6].every(i => !seven.includes(escape(svg(i)))) && inOrder(seven, [0, 1, 2, 3, 4].map(i => escape(svg(i)))) === -1);
  const junk = buildQuotationHtml({ ...fx.quotation, imageDataUrls: ['http://intranet/b.jpg', 'https://photos.example.com/a.jpg', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
    '//cdn.example.org/c.png', '/uploads/d.png', 'https://', '', null, 7, {}, [], svg(1)] });
  check('a photo is an inline picture or an https address: http, file, javascript, a data: page, a path, a bare "https://" and junk are dropped; the two real ones stay, in order',
    photoCount(junk) === 2 && inOrder(junk, ['src="https://photos.example.com/a.jpg"', `src="${escape(svg(1))}"`]) === -1 && !/intranet|file:\/\/|javascript:|PHNjcmlwdD4=|cdn\.example\.org|uploads/.test(junk));
  check('an https address is trimmed and kept whole, and counts toward the cap of five like any photo',
    (h => photoCount(h) === 5 && h.includes('src="https://photos.example.com/c.jpg?w=1&amp;h=2"') && !/photos\.example\.com\/f\.jpg/.test(h))(
      buildQuotationHtml({ ...fx.quotation, imageDataUrls: ['  https://photos.example.com/a.jpg ', svg(1), 'https://photos.example.com/c.jpg?w=1&h=2', svg(3), svg(4), 'https://photos.example.com/f.jpg'] })));
  const brokenSrc = buildQuotationHtml({ ...fx.quotation, imageDataUrls: ['data:image/png;base64,AAAA" onerror="alert(1)'] });
  check('a picture\'s address cannot break out of its attribute', photoCount(brokenSrc) === 1 && !/" onerror="/.test(brokenSrc) && /&quot; onerror=&quot;/.test(brokenSrc));
  check('a photo list that is not a list is no photos', photoCount(buildQuotationHtml({ ...fx.quotation, imageDataUrls: svg(1) })) === 0 && photoCount(buildQuotationHtml({ ...fx.quotation, imageDataUrls: null })) === 0);

  // ═══ 4. Payment terms, the validity note, the number ═══
  const terms = (settings, over) => plain(html({ settings, ...over }));
  const DEFAULT = ['PAYMENT TERMS', '50%', 'Down payment operations start', '30%', 'Upon shipping from supplier', '20%', 'Upon Custom clearances', 'Currency: EGP', 'Exchange: 51'];
  check('the default payment terms when the setting is missing, blank or only spaces', [undefined, {}, { payment_terms: '' }, { payment_terms: '  \n \n ' }, { payment_terms: null }, 'junk'].every(s => inOrder(terms(s), DEFAULT) === -1));
  check('the payment terms setting is printed, in its order, with blank lines dropped and nothing of the default left in',
    inOrder(terms({ payment_terms: '40% Deposit\n\n  35% On shipping  \n25% On arrival' }), ['PAYMENT TERMS', '40%', 'Deposit', '35%', 'On shipping', '25%', 'On arrival', 'Currency']) === -1 && !/50%|Down payment/.test(terms({ payment_terms: '40% Deposit' })));
  const plainTerms = html({ settings: { payment_terms: '100% Advance payment\nBalance on delivery in Cairo' } });
  check('terms that are not all "N% …" become a plain list, with the share kept in its own line',
    /class="q-lines q-terms-plain"/.test(plainTerms) && /100%<\/b> Advance payment/.test(plainTerms) && /<li>Balance on delivery in Cairo<\/li>/.test(plainTerms) && !/class="q-terms"/.test(plainTerms));
  const decimalTerms = html({ settings: { payment_terms: '12.5% Deposit\n87.5 % Rest' } });
  check('a share with a decimal, or a space before the %, is still a share', /<span class="pct">12.5%<\/span><span>Deposit<\/span>/.test(decimalTerms) && /<span class="pct">87.5%<\/span><span>Rest<\/span>/.test(decimalTerms));
  const payCard = h => between(h, 'class="card q-pay"', 'class="q-fx"');
  const messy = html({ settings: { payment_terms: '40% Deposit\n\n   \n  35% On shipping  \r\n25% On arrival\n' } });
  check('blank lines are dropped and each line is trimmed: exactly three terms, every one a share (so a schedule, not a plain list)',
    count(payCard(messy), '<li>') === 3 && /class="q-terms"/.test(messy) && !/q-terms-plain/.test(payCard(messy))
    && /<span class="pct">35%<\/span><span>On shipping<\/span>/.test(messy) && /<span class="pct">25%<\/span><span>On arrival<\/span>/.test(messy));
  check('the schedule keeps one row per term in a real order, and a plain list one bullet per term, with no empty bullet',
    count(payCard(html({})), '<li>') === 3 && count(payCard(plainTerms), '<li>') === 2 && !/<li>\s*<\/li>/.test(payCard(messy) + payCard(plainTerms)));
  check('Currency and Exchange: the typed currency and the rate with its fraction; a blank currency is EGP, a blank rate 1',
    /Currency: USD Exchange: 50.75/.test(terms({}, { currency: 'USD', exchange: '50.75' })) && /Currency: EGP Exchange: 1\b/.test(terms({}, { currency: '', exchange: '' })) && /Exchange: 1,234.5/.test(terms({}, { exchange: '1234.5' })));

  const hd = headerOf(mz), ft = footerOf(mz);
  check('the header repeats the company\'s line and "QUOTATION" with the number', /AUTOMOTIVE • ELECTRIC • MOBILITY/.test(hd) && /QUOTATION MT28W88Y26/.test(hd), hd.slice(0, 90));
  check('the footer carries the company details, the number and "This quotation is valid until <date> | Confidential"',
    /This quotation is valid until 2026-07-15 \| Confidential/.test(ft) && /MT28W88Y26/.test(ft) && /Office \(ACO2\), Floor \(4\)/.test(ft) && /info@motolinkers\.com/.test(ft) && /www\.motolinkers\.com/.test(ft)
    && /\+2 010 000 78104/.test(ft) && /Tax ID 773934006/.test(ft) && /Registration No 282378/.test(ft), ft);
  check('the document\'s title carries the number', /<title>Quotation MT28W88Y26<\/title>/.test(mz) && /<title>Quotation<\/title>/.test(html({ id: '' })));
  const custom = footerOf(html({ settings: { footer_note: 'Prices subject to change without notice', company_email: 'sales@example.com', company_phone: '+20 1 555' } }));
  check('the footer note and the company details come from the settings (and replace the default note)', /valid until 2026-01-08 \| Prices subject to change without notice/.test(custom) && /sales@example\.com/.test(custom) && /\+20 1 555/.test(custom) && !/Confidential/.test(custom), custom);
  const noDate = html({ validTo: '' });
  check('with no "valid to" date there is no "valid until" sentence, only the note, and the card shows a dash', !/valid until/.test(noDate) && /df-note">Confidential</.test(noDate) && /VALID TO —/.test(plain(noDate)));
  const idLess = html({ id: '' });
  check('with no number the header says just QUOTATION, the footer prints no reference, and the card shows a dash',
    /dh-ref">QUOTATION<\/span>/.test(idLess) && /<b>Registration No<\/b> 282378<\/div>/.test(idLess) && /ID —/.test(plain(idLess)));
  check('the "template" an old record carries is ignored: there is one design', [undefined, 'classic', 'brand', 'motolinkers', 'nonsense', 7].every(t => buildQuotationHtml({ ...fx.quotation, template: t }) === mz));
  check('the same data gives the same document', buildQuotationHtml(fx.quotation) === buildQuotationHtml(JSON.parse(JSON.stringify(fx.quotation))));

  // ═══ 5. Nothing typed is lost, nothing typed is HTML, blanks print as blanks ═══
  const lost = [];
  for (const [name, d] of Object.entries(fx)) {
    const h = buildQuotationHtml(d), t = plain(h), must = [];
    for (const it of d.items || []) if (it.name) must.push(it.name);
    for (const l of d.logistics || []) must.push(l.label);
    for (const s of d.customSpecs || []) { if (s.val) must.push(...s.val.split('\n')); if (s.key) must.push(`${s.key.trim()}:`); }
    if (d.issuer) must.push(`Issuer: ${d.issuer}`);
    for (const l of ((d.settings || {}).payment_terms || '').split('\n').filter(Boolean)) must.push(squash(l.replace(/^\s*\d+(?:\.\d+)?\s?%\s*/, '')));
    for (const v of [d.id, d.date, d.validTo, d.name, d.currency]) if (v) must.push(v);
    if (d.vehicleModel) must.push(...d.vehicleModel.split(/\s*(?:—|\||\n)\s*/).filter(Boolean));
    for (const m of must) if (!t.includes(squash(m))) lost.push(`${name}: ${m.slice(0, 40)}`);
    if (/\b(?:undefined|NaN|null)\b|\[object/.test(`${t} ${headerOf(h)} ${footerOf(h)}`)) lost.push(`${name}: prints a placeholder`);
  }
  check('in every sample, every name, line, spec, term, number and date is printed, and none prints "undefined", "NaN" or "null"', lost.length === 0, lost.slice(0, 4).join(' | '));
  check('a quotation built from nothing at all is a whole document with blanks and a total of 0',
    [undefined, null, {}, [], 'text', 5, { items: 'abc', logistics: null, customSpecs: { a: 1 }, settings: 'x', exchange: {}, imageDataUrls: 7 }, { id: false, date: NaN, issuer: true, name: [] }]
      .every(d => { const h = buildQuotationHtml(d); return /^<!DOCTYPE html>/.test(h) && /<\/html>\s*$/.test(h) && !/\b(?:undefined|NaN|null|true|false)\b|\[object/.test(`${plain(h)} ${headerOf(h)} ${footerOf(h)}`) && /TOTAL PRICE BREAKDOWN IN EGP 0 EGP/.test(plain(h)); }));
  check('a spec that is a bare string (an older record) is printed too', /Bare spec/.test(plain(html({ customSpecs: ['Bare spec'] }))));

  const hostile = buildQuotationHtml(fx.quotationHostile);
  check('markup typed into every field is escaped in the source: no script, no tag, no handler of the typist\'s own',
    !/<script|<h1>boom|<b>BYD|<i>k<|<img src=x/.test(body(hostile)) && /&lt;script&gt;alert\(1\)&lt;\/script&gt; Wall mount/.test(hostile) && /&lt;b&gt;BYD&lt;\/b&gt; Seal &quot;Design&quot;/.test(hostile)
    && /&lt;img src=x onerror=alert\(1\)&gt; Omar &amp; &quot;Sons&quot;/.test(hostile) && /&lt;\/div&gt;&lt;h1&gt;boom&lt;\/h1&gt;/.test(hostile) && /&lt;i&gt;k&lt;\/i&gt;/.test(hostile));
  const hostileSettings = html({ id: '"><script>1</script>', date: '<i>d</i>', validTo: '<s>v</s>', settings: { payment_terms: '<b>50%</b> <script>x</script>', footer_note: '<u>note</u>', company_name: '<b>Co</b>', company_address: '<img src=x onerror=1>' } });
  check('the settings, the number, the date and "valid to" are text too (letterhead, footer, title, cards)',
    !/<script|<u>note|<b>Co<|<img src=x|<i>d<|<s>v<|<b>50%/.test(hostileSettings) && /&lt;u&gt;note&lt;\/u&gt;/.test(hostileSettings) && /<title>Quotation &quot;&gt;&lt;script&gt;1&lt;\/script&gt;<\/title>/.test(hostileSettings));
  // Every text field at once carries <u>NAME</u>. None of it may reach the page as a tag, and each one must be there as text.
  const FIELDS = ['id', 'date', 'validTo', 'name', 'vehicle', 'vehicleSub', 'item', 'itemWords', 'logistics', 'logisticsWords', 'issuer', 'specKey', 'specVal', 'currency', 'note',
    'company', 'address', 'email', 'website', 'phone', 'taxId', 'regNo', 'tagline'];
  const u = f => `<u>${f}</u>`;
  const everywhere = terms => buildQuotationHtml({
    id: u('id'), date: u('date'), validTo: u('validTo'), name: u('name'), vehicleModel: `${u('vehicle')} — ${u('vehicleSub')}`,
    items: [{ name: u('item'), unit: 1, priceUsd: u('itemWords') }], logistics: [{ label: u('logistics'), priceUsd: u('logisticsWords') }],
    currency: u('currency'), exchange: '1', issuer: u('issuer'), customSpecs: [{ key: u('specKey'), val: u('specVal') }], imageDataUrls: [],
    settings: { payment_terms: terms, footer_note: u('note'), company_name: u('company'), company_address: u('address'), company_email: u('email'), company_website: u('website'),
      company_phone: u('phone'), company_tax_id: u('taxId'), company_reg_no: u('regNo'), company_tagline: u('tagline') } });
  const schedule = everywhere(`50% ${u('shareA')}\n50% ${u('shareB')}`), bullets = everywhere(`Plain ${u('plainA')}\n50% ${u('plainB')}`);
  const unescaped = [[schedule, 'a schedule of shares', [...FIELDS, 'shareA', 'shareB']], [bullets, 'a plain list', [...FIELDS, 'plainA', 'plainB']]]
    .flatMap(([h, label, fields]) => [...(/<u>/.test(h) ? [`${label}: a raw <u> tag`] : []), ...fields.filter(f => !h.includes(escape(u(f)))).map(f => `${label}: ${f} is not printed as text`)]);
  check('markup typed into ANY text field (the number, the dates, the name, the vehicle, every line, price words, issuer, spec, term, currency, the note, every company detail) is printed as text, never as a tag',
    unescaped.length === 0, unescaped.slice(0, 4).join(' | '));
  check('an ampersand is escaped once, not twice: "Terms & conditions" in the note and in a line reads "&amp;" in the source and "&" on the page',
    (h => /Terms &amp; conditions apply/.test(h) && !/&amp;amp;/.test(h) && /Wall &amp; Cable/.test(h) && /Terms & conditions apply/.test(footerOf(h)))(html({ items: [{ name: 'Wall & Cable', priceUsd: '1' }], settings: { footer_note: 'Terms & conditions apply' } })));
  check('with an https photo that address is the only one in the whole document: nothing else (font, style, logo) is fetched',
    (h => same(h.match(/https?:\/\/[^"'\s)<]+/g), ['https://photos.example.com/a.jpg']))(buildQuotationHtml({ ...fx.quotation, imageDataUrls: ['https://photos.example.com/a.jpg', svg(1)] })));
  check('the document refers to nothing outside itself: no http(s) address in any src, href or url(), no link, import, frame or script',
    ![mz, buildQuotationHtml(fx.quotationImages), hostile, buildQuotationHtml(fx.quotationLong), buildQuotationHtml(fx.quotationStress)].some(h => /(?:src|href)=["']?https?:|url\(["']?https?:|@import|<link|<iframe|<script|<a /i.test(h)));
  check('the fonts and the logo are embedded as data URIs', /font-family:'Poppins'/.test(mz) && /<img class="dh-logo" alt="Motolinkers" src="data:image\/png;base64,/.test(mz) && !/url\((?!['"]?data:)/.test(mz));
  check('Arabic names, items and specs print as typed, mixed with Latin text',
    ['عمر حسن', 'مازدا EZ60', 'EV 600 Max', 'سيارة مازدا EZ60 كهربائية بالكامل (2026)', 'Wall mount شاحن جداري', 'حقيبة أدوات', 'الضمان:', '3 سنوات أو 100,000 كم'].every(s => plain(buildQuotationHtml(fx.quotationArabic)).includes(s)));

  // ═══ 6. In a real browser: markup is text, the page reaches nowhere, nothing overflows ═══
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], timeout: 120000 });
  try {
    // What the page does and where things are, measured in the page itself (this function runs in the browser).
    const probe = () => {
      const root = document.querySelector('.q'), bad = [];
      const rr = root ? root.getBoundingClientRect() : null;
      for (const el of root ? root.querySelectorAll('*') : []) {
        if (el.closest('.ph')) continue;                      // the photos are cropped on purpose
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
      const footer = document.querySelector('.doc-footer');
      const height = sel => { const c = document.querySelector(sel); return c ? Math.round(c.getBoundingClientRect().height) : 0; };
      const width = sel => { const c = document.querySelector(sel); return c ? Math.round(c.getBoundingClientRect().width) : 0; };
      return {
        scripts: document.querySelectorAll('script').length,
        handlers: [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length,
        h1: document.querySelectorAll('h1').length,
        imgs: [...document.querySelectorAll('img')].map(i => (i.closest('.ph') ? 'photo' : i.className)),
        text: root ? root.innerText : '',
        wide: document.documentElement.scrollWidth > window.innerWidth + 1,
        bad: bad.slice(0, 6),
        loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
        cards: [height('.q-specs'), height('.q-pay')],
        // the payment card's width against the page's content: all of it when it stands alone
        pay: [width('.q-pay'), width('.q')],
        // every figure (the last two cells of each row, the total row apart) is set flush right: how many there are, and how many are
        money: (cells => [cells.length, cells.filter(td => getComputedStyle(td).textAlign === 'right').length])([...document.querySelectorAll('table.q-tbl tbody tr:not(.tot) td:nth-last-child(-n+2)')]),
        // the photo strip: each tile's width, and the space left of the first tile and right of the last (a centred strip has equal gaps)
        strip: (tiles => (tiles.length ? { widths: tiles.map(t => Math.round(t.width)), gaps: [Math.round(tiles[0].left - rr.left), Math.round(rr.right - tiles[tiles.length - 1].right)] } : null))(
          [...document.querySelectorAll('.q-photos .ph')].map(e => e.getBoundingClientRect())),
        // what a photo tile shows when its address cannot be loaded: a plain mint cover over the browser's broken-picture icon (a picture that loads has no ::before)
        cover: (img => { const st = img && getComputedStyle(img, '::before'); return st ? [st.content, st.position, st.backgroundColor] : null; })(document.querySelector('.q-photos img')),
        // where the money columns end in each table: in the same place in both, so the figures line up down the page
        cols: [...document.querySelectorAll('table.q-tbl')].map(t => [...t.querySelectorAll('thead th.num')].map(th => Math.round(th.getBoundingClientRect().right))),
        // the footer's own height, and the room the body keeps for it (both in mm)
        foot: footer ? [+(footer.getBoundingClientRect().height * 25.4 / 96).toFixed(1), parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--foot-h'))] : [0, 0],
        bidi: [['td.name', 'سيارة', 'EZ60'], ['li', 'تسليم', 'Delivery'], ['td.name', 'Wall', 'شاحن']].map(([sel, a, b]) => [xOf(sel, a), xOf(sel, b)]),
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
        return { f: await page.evaluate(probe), seen, dialogs };
      } catch (e) {
        return { f: { scripts: -1, handlers: -1, h1: -1, imgs: [], text: '', wide: true, bad: [`the page failed: ${String(e.message).slice(0, 80)}`], loaded: [], cards: [0, 0], pay: [0, 0], money: [0, 1], strip: null, cover: null, cols: [], foot: [0, 0], bidi: [] }, seen, dialogs };
      } finally {
        if (page) await page.close().catch(() => {});
      }
    };
    const FIT = [['the Mazda quote with four photos', fx.quotationImages], ['five photos', fx.quotationFivePhotos], ['the long quote', fx.quotationLong],
      ['words with no break, a 12-digit price and a long note', fx.quotationStress], ['Arabic and Latin mixed', fx.quotationArabic], ['the sparse quote', fx.quotationMinimal],
      ['no specs: the payment card alone', fx.quotationNoSpecs], ['a mixed quote with words for a price', fx.quotationMixed], ['one photo', fx.quotationOnePhoto], ['three photos', fx.quotationThreePhotos]];
    const evil = buildQuotationHtml({ ...fx.quotation, imageDataUrls: ['http://intranet/a.png', 'file:///etc/passwd', 'data:image/png;base64,AAAA" onerror="alert(1)', svg(2)] });
    const remote = buildQuotationHtml({ ...fx.quotation, imageDataUrls: ['https://photos.example.com/a.jpg', svg(1)] });
    const [hz, ev, rm, control, bigNote, bigAddr, bigBoth, ...fits] = await Promise.all([
      inspect(hostile), inspect(evil), inspect(remote), inspect('<!DOCTYPE html><html><body><img src="https://example.com/x.png"></body></html>'),
      inspect(html({ settings: { footer_note: BIG_NOTE } })), inspect(html({ settings: { company_address: BIG_ADDRESS } })), inspect(html({ settings: { footer_note: BIG_NOTE, company_address: BIG_ADDRESS } })),
      ...FIT.map(([, d]) => inspect(buildQuotationHtml(d)))]);

    check('hostile markup in a real browser: no script, no handler, one title, only the logo as a picture, no dialog',
      hz.f.scripts === 0 && hz.f.handlers === 0 && hz.f.h1 === 1 && same(hz.f.imgs, ['dh-logo']) && hz.dialogs.length === 0, JSON.stringify({ ...hz.f, text: undefined }));
    check('…and the typed markup is on the page as literal text',
      ['<script>alert(1)</script> Wall mount', '<b>BYD</b> Seal "Design"', '<img src=x onerror=alert(1)> Omar & "Sons"', '<i>k</i>:', '</div><h1>boom</h1>'].every(t => hz.f.text.includes(t)));
    check('…and the page asked for nothing but inline data', hz.seen.length > 0 && hz.seen.every(u => u.startsWith('data:')), hz.seen.filter(u => !u.startsWith('data:')).join(' '));
    check('a quotation holding an http address, a file and a broken picture address fetches nothing and carries no handler; the two real pictures are drawn',
      ev.f.handlers === 0 && ev.dialogs.length === 0 && ev.seen.every(u => u.startsWith('data:')) && ev.f.imgs.filter(i => i === 'photo').length === 2, JSON.stringify(ev.seen.filter(u => !u.startsWith('data:'))));
    check('an https photo is the one thing the page asks the network for: no font, no style, no http — and nothing sticks out when it cannot be loaded',
      same(rm.seen.filter(u => !u.startsWith('data:')), ['https://photos.example.com/a.jpg']) && rm.f.handlers === 0 && rm.f.bad.length === 0 && !rm.f.wide && rm.f.imgs.filter(i => i === 'photo').length === 2,
      JSON.stringify(rm.seen.filter(u => !u.startsWith('data:'))));
    check('a photo address that does not load leaves a plain mint tile: its picture carries a mint cover that hides the browser\'s broken-picture icon (the first picture here is the one that fails)',
      !!rm.f.cover && rm.f.cover[0] === '""' && rm.f.cover[1] === 'absolute' && rm.f.cover[2] === 'rgb(234, 244, 229)', JSON.stringify(rm.f.cover));
    check('(control) the request recorder does see a link when there is one', control.seen.some(u => u.startsWith('https://example.com/')));
    FIT.forEach(([label], i) => check(`${label}: nothing sticks out of its box or the page, and no text is clipped`, fits[i].f.bad.length === 0 && !fits[i].f.wide, fits[i].f.bad.join(' | ')));
    const feet = [['usual', fits[0]], ['long note', bigNote], ['long address', bigAddr], ['both', bigBoth]];
    check('the room the body keeps for the footer is always more than the footer needs (the usual footer, a long note, a long address, both)',
      feet.every(([, r]) => r.f.foot[0] > 10 && r.f.foot[1] - r.f.foot[0] >= 3), feet.map(([n, r]) => `${n}: footer ${r.f.foot[0]}mm, room ${r.f.foot[1]}mm`).join(' | '));
    const ar = fits[FIT.findIndex(([label]) => label === 'Arabic and Latin mixed')].f.bidi;
    check('mixed Arabic and Latin: each line takes its direction from its own first letter — an Arabic line runs right to left (its first word is the rightmost), a Latin line left to right',
      ar.length === 3 && ar[0][0] > ar[0][1] && ar[1][0] > ar[1][1] && ar[2][0] < ar[2][1] && ar.flat().every(x => x !== null), JSON.stringify(ar));
    check('the embedded Poppins is what is set (no fallback font)', fits[0].f.loaded.includes('Poppins'), fits[0].f.loaded.join(','));
    check('side by side the two cards share one height; when the specs run far longer, the payment card keeps its own',
      Math.abs(fits[0].f.cards[0] - fits[0].f.cards[1]) <= 1 && fits[0].f.cards[0] > 0 && fits[2].f.cards[1] > 0 && fits[2].f.cards[1] < fits[2].f.cards[0] / 2,
      `Mazda ${fits[0].f.cards.join(' / ')}px, long ${fits[2].f.cards.join(' / ')}px`);
    const solo = fits[FIT.findIndex(([label]) => /payment card alone/.test(label))].f;
    check('with no specs the payment card takes the full width of the page; beside the specs it takes about 38% of it',
      solo.pay[0] > 0 && solo.pay[0] >= solo.pay[1] - 1 && fits[0].f.pay[0] > fits[0].f.pay[1] * 0.3 && fits[0].f.pay[0] < fits[0].f.pay[1] * 0.45,
      `alone ${solo.pay.join('/')}px, beside the specs ${fits[0].f.pay.join('/')}px`);
    const mixed = fits[FIT.findIndex(([label]) => /words for a price/.test(label))].f;
    const strips = [[1, /^one photo$/], [3, /^three photos$/], [4, /four photos/], [5, /^five photos$/]].map(([n, re]) => [n, fits[FIT.findIndex(([label]) => re.test(label))].f.strip]);
    check('the photo strip is centred and its tiles are one size, for one, three, four and five photos: equal space left and right, equal widths, none wider than 44mm',
      strips.every(([n, st]) => st && st.widths.length === n && st.widths.every(w => Math.abs(w - st.widths[0]) <= 1) && Math.abs(st.gaps[0] - st.gaps[1]) <= 1 && st.widths[0] <= 44 * 96 / 25.4), JSON.stringify(strips));
    check('every figure is set flush right — prices, totals, "Free", a price in words and a dash alike',
      [fits[0].f, mixed].every(f => f.money[0] >= 10 && f.money[0] === f.money[1]), `${fits[0].f.money.join('/')} and ${mixed.money.join('/')} cells`);
    check('the money columns end in the same place in the pricing and the logistics tables, so the figures line up down the page',
      fits[0].f.cols.length === 2 && fits[0].f.cols.every(c => c.length === 2) && same(fits[0].f.cols[0], fits[0].f.cols[1]), JSON.stringify(fits[0].f.cols));
  } finally { await browser.close(); }

  // ═══ 7. In real PDFs ═══
  const pdftotext = have('pdftotext');
  const logistics = n => ({ ...fx.quotation, imageDataUrls: [], logistics: Array.from({ length: n }, (_, i) => ({ label: `Logistics line ${i + 1}`, priceUsd: String(100 + i) })) });
  const itemsOnly = n => ({ ...fx.quotation, imageDataUrls: [], logistics: [], items: Array.from({ length: n }, (_, i) => ({ name: `Item line ${i + 1}`, unit: 1, priceUsd: String(100 + i) })) });
  // Counts that put a page break in each place the total can land: with it on the page, or moved with the last rows.
  const LOG_SWEEP = [17, 18, 19, 20, 21], ITEM_SWEEP = [26, 27, 28, 29];
  // n items with four logistics lines after them: for 27 and more the logistics title would fall in the last few lines of page 1 with its table on page 2.
  const TITLE_SWEEP = [25, 26, 27, 28];
  const itemsThenLogistics = n => ({ ...fx.quotation, imageDataUrls: [], items: Array.from({ length: n }, (_, i) => ({ name: `Item line ${i + 1}`, unit: 1, priceUsd: String(100 + i) })),
    logistics: Array.from({ length: 4 }, (_, i) => ({ label: `Logistics line ${i + 1}`, priceUsd: String(100 + i) })) });
  // Twenty-six plain lines, then one of seventeen lines of text: it cannot fit in what is left of page 1, so it must move whole.
  const TALL = `A tall line that cannot share the foot of the page: ${'words that keep it going '.repeat(40).trim()}`;
  const tallQuote = { ...fx.quotation, imageDataUrls: [], logistics: [], items: [
    ...Array.from({ length: 26 }, (_, i) => ({ name: `Plain line ${i + 1}`, unit: 1, priceUsd: String(100 + i) })), { name: TALL, unit: 1, priceUsd: '999' }, { name: 'Last line', unit: 1, priceUsd: '5' }] };
  // A footer of a long note and a long address is taller than the usual one: the body must leave it room.
  const bigFooter = { ...fx.quotationLong, settings: { ...fx.quotationLong.settings, footer_note: BIG_NOTE, company_address: BIG_ADDRESS } };
  // Fourteen items instead of six: the cards (about 43mm) no longer fit in what is left of page 1, but a part of them would.
  const nearly = { ...fx.quotation, imageDataUrls: [], items: [...fx.quotation.items, ...Array.from({ length: 8 }, (_, i) => ({ name: `Extra line ${i + 1}`, unit: 1, priceUsd: String(10 + i) }))] };
  const toRender = { nearly, footer: bigFooter, tall: tallQuote, mazda: fx.quotation, images: fx.quotationImages, five: fx.quotationFivePhotos, long: fx.quotationLong, minimal: fx.quotationMinimal, hostile: fx.quotationHostile, arabic: fx.quotationArabic, stress: fx.quotationStress,
    ...Object.fromEntries(LOG_SWEEP.map(n => [`log${n}`, logistics(n)])), ...Object.fromEntries(ITEM_SWEEP.map(n => [`items${n}`, itemsOnly(n)])),
    ...Object.fromEntries(TITLE_SWEEP.map(n => [`title${n}`, itemsThenLogistics(n)])) };
  // Each render starts its own Chrome: a few at a time, so a busy machine does not time one out.
  const pdfs = {};
  const queue = Object.entries(toRender);
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const doc = buildQuotationHtml(job[1]);
      pdfs[job[0]] = Buffer.from(await renderPdf(doc).catch(() => renderPdf(doc)));     // a loaded machine can time a Chrome launch out once
    }
  }));
  const lat = b => b.toString('latin1');
  const pagesOf = b => (lat(b).match(/\/Type\s*\/Page[^s]/g) || []).length;
  const nPages = Object.fromEntries(Object.entries(pdfs).map(([k, b]) => [k, pagesOf(b)]));
  // each page's text in the order it was drawn (a table row's cells, a card's lines, one after another)
  const pageTexts = k => {
    const f = path.join(os.tmpdir(), `doc-quotation-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(f, pdfs[k]);
    try { return Array.from({ length: nPages[k] }, (_, i) => spawnSync('pdftotext', ['-raw', '-f', String(i + 1), '-l', String(i + 1), f, '-'], { encoding: 'utf8' }).stdout || ''); }
    finally { fs.unlinkSync(f); }
  };

  check('every quotation is a real A4 PDF with the Poppins face embedded, and none links anywhere',
    Object.values(pdfs).every(b => b.slice(0, 5).toString() === '%PDF-' && /Poppins/.test(lat(b)) && /\/MediaBox\s*\[\s*0\s+0\s+595\.\d*\s+841\.\d*\s*\]/.test(lat(b)) && !/\/URI\b/.test(lat(b))));
  check('Arabic is set in the embedded Cairo face', /Cairo/.test(lat(pdfs.arabic)));
  check('the normal quotation is exactly one page: the Mazda quote with none, four or five photos', nPages.mazda === 1 && nPages.images === 1 && nPages.five === 1, JSON.stringify({ none: nPages.mazda, four: nPages.images, five: nPages.five }));
  check('the sparse, the markup-filled, the Arabic and the stress quotations are one page each', nPages.minimal === 1 && nPages.hostile === 1 && nPages.arabic === 1 && nPages.stress === 1, JSON.stringify({ minimal: nPages.minimal, hostile: nPages.hostile, arabic: nPages.arabic, stress: nPages.stress }));
  check('the long quotation flows onto further pages — not squeezed onto one, not cut off', nPages.long >= 2 && nPages.long <= 4, String(nPages.long));

  if (!pdftotext) console.log('  (pdftotext is not installed: the page-by-page checks of the PDFs are skipped)');
  else {
    const NUM = 'MT28W88Y26';
    // Letter-spaced capitals come out of pdftotext one letter at a time ("T O T A L"), so a label is
    // looked for with the spaces taken out; the figures and the words around them are read as they are.
    const has = (t, label) => nospace(t).includes(nospace(label));
    // the letterhead, the number, the validity note and "Page n of N" — on every page
    const furniture = (k, note) => pageTexts(k).every((t, i) => /info@motolinkers\.com/.test(t) && /Tax ID\s+773934006/.test(t) && /Registration No\s+282378/.test(t) && has(t, 'AUTOMOTIVE • ELECTRIC • MOBILITY')
      && has(t, 'QUOTATION MT28W88Y26') && count(t, NUM) >= 2 && new RegExp(`This quotation is valid until 2026-07-15 \\| ${note}`).test(t) && new RegExp(`Page ${i + 1} of ${nPages[k]}\\b`).test(t));
    check('the Mazda quotes: letterhead, number, "valid until … | Confidential" and "Page 1 of 1" are on the page', furniture('mazda', 'Confidential') && furniture('images', 'Confidential'));

    // The printed page, as text: nothing the typist wrote is hidden by the layout
    for (const [k, d] of [['mazda', fx.quotation], ['images', fx.quotationImages]]) {
      const all = nospace(pageTexts(k).join('\n'));
      const want = [...d.items.map(i => i.name), ...d.logistics.map(l => l.label), ...d.customSpecs.map(s => s.val), 'Issuer:Mohamed Yasser', 'Deposit & Operation Kick-off', 'Upon Logistics', 'On Arrival to Egypt', 'Currency:EGP', 'Exchange:51',
        '1,147,500', '10,200', '2,550', '204,000', '127,500', '239,700', '5,100', '178,500', '1,915,050', 'TOTAL PRICE BREAKDOWN IN EGP', 'Omar Hassan', NUM, '2026-07-08', '2026-07-15'];
      const missing = want.filter(w => !all.includes(nospace(w)));
      check(`${k}: the printed page carries every line, spec, term, amount and the total`, missing.length === 0, missing.slice(0, 4).join(' | '));
    }

    // The long quotation
    const lp = pageTexts('long');
    const pagesWith = label => lp.map((t, i) => (has(t, label) ? i + 1 : 0)).filter(Boolean);
    const pagesMatching = re => lp.map((t, i) => (re.test(t) ? i + 1 : 0)).filter(Boolean);
    check('long: letterhead, number, validity note and "Page n of N" are on every page', furniture('long', 'Confidential'));
    const accessory = i => `Optional accessory ${i} — extended description that wraps onto a second line to test the row height`;
    check('long: each of the 14 added accessory rows is printed whole, once — a row is never split across two pages',
      Array.from({ length: 14 }, (_, i) => lp.filter(t => has(t, accessory(i + 1))).length).every(n => n === 1), lp.map(t => count(t, 'Optional accessory ')).join(','));
    check('long: the pricing table runs over two pages here, so the repeating head and the row rule were really in play', pagesMatching(/Optional accessory \d/).length >= 2, pagesMatching(/Optional accessory \d/).join(','));
    check('long: the table head is repeated at the top of every page that carries rows',
      lp.every(t => { const i = t.search(/Optional accessory \d|Additional logistics line \d/); return i < 0 || has(t.slice(0, i), 'ITEM UNIT PRICE USD TOTAL EGP') || has(t.slice(0, i), 'ITEM PRICE USD TOTAL EGP'); }));
    check('long: a section title is on the page of its first row, never left alone at the foot of a page',
      pagesWith('LOGISTICS PRICING BREAKDOWN')[0] === pagesMatching(/Ocean Freight/)[0] && pagesWith('PRICING BREAKDOWN')[0] === pagesMatching(/Mazda EZ60 EV 600 Max/)[0]);
    const pg = i => lp[i - 1] || '';
    const totalPage = pagesWith('TOTAL PRICE BREAKDOWN IN EGP');
    check('long: the total is printed once, on the page of the last two logistics lines, and reads 2,557,140',
      totalPage.length === 1 && /Additional logistics line 7\b/.test(pg(totalPage[0])) && /Additional logistics line 8\b/.test(pg(totalPage[0])) && /2,557,140/.test(pg(totalPage[0])), totalPage.join(','));
    const specPage = pagesWith('KEY SPECS'), payPage = pagesWith('PAYMENT TERMS');
    check('long: the two cards are whole and on one page — every spec line with its card, every term with its card',
      specPage.length === 1 && payPage.length === 1 && specPage[0] === payPage[0] && fx.quotationLong.customSpecs.every(s => has(pg(specPage[0]), s.val))
      && /Exchange:\s*51/.test(pg(payPage[0])) && /On Arrival to Egypt/.test(pg(payPage[0])) && /Issuer:\s*Mohamed Yasser/.test(pg(specPage[0])), `${specPage} ${payPage}`);
    check('long: the cards come after the total, never before it', specPage[0] >= totalPage[0]);

    // Cards that almost fit: the room left on page 1 is less than they need, so they move whole to page 2
    const nl = pageTexts('nearly');
    const nSpec = nl.map((t, i) => (has(t, 'KEY SPECS') ? i + 1 : 0)).filter(Boolean), nPay = nl.map((t, i) => (has(t, 'PAYMENT TERMS') ? i + 1 : 0)).filter(Boolean);
    check('cards that almost fit on page 1 move to page 2 whole: the total stays on page 1, every spec line and term goes with its card',
      nl.length === 2 && nSpec.join() === '2' && nPay.join() === '2' && has(nl[0] || '', 'TOTAL PRICE BREAKDOWN IN EGP') && MAZDA_SPECS.every(sp => has(nl[1] || '', sp)) && /Exchange:\s*51/.test(nl[1] || '') && !has(nl[0] || '', 'Currency'),
      `pages ${nl.length}, KEY SPECS on ${nSpec}, PAYMENT TERMS on ${nPay}`);

    // The footer grows with a long note and a long address; the body leaves it room (no row runs under it)
    const bboxes = k => {
      const f = path.join(os.tmpdir(), `doc-quotation-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
      fs.writeFileSync(f, pdfs[k]);
      try {
        const xml = spawnSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', f, '-'], { encoding: 'utf8' }).stdout || '';
        return [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(m => ({ y0: +m[2], y1: +m[4], t: m[5] }));
      } finally { fs.unlinkSync(f); }
    };
    const fw = bboxes('footer');
    const footerTop = Math.min(...fw.filter(w => w.t === 'Office').map(w => w.y0));
    const lowestRow = Math.max(...fw.filter(w => w.t === 'height').map(w => w.y1));   // "…to test the row height", the end of every accessory row
    check('a long footer note and a long address push the body up, not under the footer: the last row ends above the footer', isFinite(footerTop) && isFinite(lowestRow) && lowestRow < footerTop - 1,
      `last row ends at ${lowestRow.toFixed(1)}pt, the footer starts at ${footerTop.toFixed(1)}pt`);
    check('…and the footer\'s note is all there, on every page', pageTexts('footer').every(t => has(t, 'Prices are valid for the period stated above') && has(t, 'next to the metro station')) && nPages.footer >= 2);
    check('the usual footer reserves the shell\'s own room, so nothing moves for a normal note', /--foot-h:26(?:\.0)?mm/.test(mz) && /--foot-h:26(?:\.0)?mm/.test(html({ settings: { footer_note: 'Prices subject to change without notice' } })) && !/--foot-h:26(?:\.0)?mm/.test(buildQuotationHtml(bigFooter)));

    // A row taller than what is left of the page moves to the next page whole
    const tl = pageTexts('tall');
    const tallPages = tl.map((t, i) => (has(t, TALL) ? i + 1 : 0)).filter(Boolean);
    check('a row too tall for the foot of the page moves to the next page whole, not torn across two',
      tallPages.length === 1 && tallPages[0] === 2 && /Plain line 26\b/.test(tl[0]) && !/Plain line 26\b/.test(tl[1]) && /Last line/.test(tl[1]), `whole on page(s) ${tallPages.join(',') || 'none'} of ${tl.length}`);

    // Every place a page can break: the total always travels with the last rows
    const sweep = (keys, label, titleRe, rowRe) => keys.map(k => {
      const t = pageTexts(k), n = +k.replace(/\D/g, '');
      const tp = t.map((x, i) => (has(x, 'TOTAL PRICE BREAKDOWN IN EGP') ? i + 1 : 0)).filter(Boolean);
      const withTotal = tp.length === 1 ? t[tp[0] - 1] : '';
      const row = i => new RegExp(`${label} ${i}\\b`);
      return {
        k,
        ok: tp.length === 1 && row(n).test(withTotal) && row(n - 1).test(withTotal) && Array.from({ length: n }, (_, i) => t.filter(x => row(i + 1).test(x)).length).every(c => c === 1),
        crossed: t.filter(x => new RegExp(`${label} \\d`).test(x)).length > 1,
        // a title with none of its rows after it on its page
        stranded: t.some(x => { const sq = nospace(x), a = sq.search(titleRe); return a >= 0 && !rowRe.test(sq.slice(a)); }),
      };
    });
    const ls = sweep(LOG_SWEEP.map(n => `log${n}`), 'Logistics line', /LOGISTICSPRICINGBREAKDOWN/, /Logisticsline\d/);
    const is = sweep(ITEM_SWEEP.map(n => `items${n}`), 'Item line', /(?<!LOGISTICS)PRICINGBREAKDOWN/, /Itemline\d/);
    check(`logistics sweep (${LOG_SWEEP.join(', ')} lines): the total is on one page with the last two lines, and every line is printed once`, ls.every(r => r.ok), ls.filter(r => !r.ok).map(r => r.k).join(','));
    check('…and the sweep did cross a page break (the keep-together rule was in play)', ls.some(r => r.crossed), ls.map(r => `${r.k}:${r.crossed ? 'split' : 'one page'}`).join(' '));
    check(`pricing sweep (${ITEM_SWEEP.join(', ')} items, no logistics): the total is on one page with the last two items, and every item is printed once`, is.every(r => r.ok), is.filter(r => !r.ok).map(r => r.k).join(','));
    check('…and that sweep crossed a page break too', is.some(r => r.crossed), is.map(r => `${r.k}:${r.crossed ? 'split' : 'one page'}`).join(' '));
    check('no sweep leaves a section title alone at the foot of a page', [...ls, ...is].every(r => !r.stranded), [...ls, ...is].filter(r => r.stranded).map(r => r.k).join(','));
    // The logistics title can fall where there is room for it but not for its table: it must go to the next page with the table, never stay behind.
    const ts = TITLE_SWEEP.map(n => {
      const t = pageTexts(`title${n}`), at = t.map((x, i) => (/LOGISTICSPRICINGBREAKDOWN/.test(nospace(x)) ? i + 1 : 0)).filter(Boolean);
      const sq = at.length === 1 ? nospace(t[at[0] - 1]) : '';
      return { n, page: at[0], together: at.length === 1 && /Logisticsline\d/.test(sq.slice(sq.search(/LOGISTICSPRICINGBREAKDOWN/))) };
    });
    check(`a section title is never left behind at the foot of a page: with ${TITLE_SWEEP.join(', ')} items above it, the logistics title is on the page of its first line`,
      ts.every(r => r.together), ts.map(r => `${r.n}:p${r.page}${r.together ? '' : ' ALONE'}`).join(' '));
    check('…and in that sweep the title stayed on page 1 in one case and moved to page 2 with its table in another (the keep-with-next rule was in play)',
      ts.some(r => r.page === 1) && ts.some(r => r.page === 2), ts.map(r => `${r.n}:p${r.page}`).join(' '));
  }
})().catch(e => { console.error(e); results.push(false); }).then(() => {
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
});
