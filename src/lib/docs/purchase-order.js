'use strict';
// The purchase order PDF — the order MotoLinkers sends a supplier.
//
// po: the purchase_orders row (+ client_name, settings) — see poBuildRow in
//     src/routes/purchase-orders.js for the fields:
//       po_number, quote_id, po_date, issuer, currency (default USD),
//       supplier_name | supplier, supplier_contact / _address / _country,
//       incoterm (default FOB), delivery_location, service_provider, contact,
//       payment_terms, documents_required, notes,
//       items [{ client, consignee, units, brand, model, trim, color, year, accessories, pi_price, … }],
//       client_name (the lead the order is attached to), settings (company_* …)
//
// It is the quotation's sibling: the same title block and meta card, the same dark-headed table, the
// same dark total block and cards. Top to bottom: the title (PURCHASE ORDER, and who it goes to) beside
// a card with the order's ID / DATE / ISSUER / CURRENCY; the supplier's details; the line grid; the
// total; optional notes; then the payment terms and the delivery terms (incoterm, place, forwarder,
// contact, the documents the supplier must send).
//
// What the paper form did, and this keeps doing:
//  * the total is Σ price × quantity, printed with the order's currency (named in the two money headings
//    and in the total block rather than in every cell); a quantity left blank is 1;
//  * a price of 0 prints no price and no line total (the cells stay empty, they are not "0");
//  * an empty accessories cell prints the company's standard accessories; empty payment terms and an
//    empty documents list print the standard wording (src/lib/docs/defaults.js);
//  * the CLIENT cell is the line's client, else its consignee, else the client the order is attached to;
//    a consignee who is somebody else stays visible underneath ("Consignee: …");
//  * the grid always has at least five numbered rows, so a short order still reads as a form to be
//    filed — a longer order is not padded;
//  * the words the team fills in by hand ("XXXXX", "CIF ONLY …") are marked in red, and so is a
//    delivery field (place, forwarder, contact) left blank. Red means "fill this in"; it is the only
//    colour here that is not the brand's.
//
// Rules of this document (see README.md):
//  * Text is text: every value goes through esc(); nothing typed is interpolated as HTML.
//  * A blank never prints "undefined"; it prints as a line to fill in. A line with nothing in it (a
//    blank row the editor sent along) is not a vehicle and is left out.
//  * The VIN, the client-file link, the line's status and payment term, an admin-added column, the order's
//    title and the `template` an old record carries are not part of the order the supplier receives.
//  * A telephone number never breaks across two lines and reads left to right inside Arabic text.
//  * The page is built to flow: the head row repeats, a row never splits, the last two rows travel with
//    the total block, and the terms move to the next page whole.

const { shell, esc, escBr, company } = require('./brand');
const { DOC_DEFAULT_ACCESSORIES, DOC_DEFAULT_DOCUMENTS, DOC_DEFAULT_PAYMENT_TERMS } = require('./defaults');

const MIN_ROWS = 5;   // a short order is drawn with blank numbered rows up to this many
const KEEP = 2;       // how many of the last rows travel with the total

// ── Values ────────────────────────────────────────────────────────────────────
// What a field holds, as text: a string or a finite number is itself; anything else (null, a boolean,
// an object, NaN) is nothing, so a stray value never prints as "false" or "[object Object]".
const str = v => (typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '').trim();
const arr = v => (Array.isArray(v) ? v : []);
const rec = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// A number typed by a person: 17800, "17,800", "17800.50". Junk is 0.
function amount(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}
// 17,800 — a whole amount prints bare, one with cents always prints two decimals.
function money(n) {
  const v = Math.round(n * 100) / 100;
  return v.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}
// A date column can come back as a full timestamp; the order shows the day.
const day = v => (v instanceof Date && !isNaN(v) ? v.toISOString() : str(v)).replace(/^(\d{4}-\d{2}-\d{2})T.*$/, '$1');

// ── The words filled in by hand ───────────────────────────────────────────────
// "XXXXX" (a place still to be named) and "CIF ONLY …" (to the end of its line), as the paper form
// highlighted them. split() with one capture group alternates plain text and tokens, so each piece is
// escaped on its own and nothing is ever matched against markup.
const FILL_IN = /(\bX{3,}\b(?:\s+Port\b)?|CIF ONLY[^\r\n]*)/gi;
const redify = text => String(text).split(FILL_IN)
  .map((seg, i) => (i % 2 ? `<span class="red">${esc(seg)}</span>` : esc(seg).replace(/\r?\n/g, '<br>'))).join('');

// A telephone number is read as one piece: it never breaks across two lines, and in a line of Arabic it
// keeps its own left-to-right order ("+86 755 8888 1234", not "1234 8888 755 86+"). Only the number is
// wrapped (at most about 20 characters, so it always fits its column); every piece, number or not, is
// escaped on its own.
const PHONE = /(\+?\d[\d ().-]{4,16}\d)/g;
const phones = text => String(text).split(PHONE)
  .map((seg, i) => (i % 2 ? `<span class="tel">${esc(seg)}</span>` : esc(seg))).join('');

// "70% balance due …" → the share, in green, and the words. A line without a share is kept whole.
function termLine(line) {
  const m = /^(\d+(?:[.,]\d+)?\s?%)\s*(.*)$/.exec(line);
  return m && m[2] ? `<b class="pct">${esc(m[1].replace(/\s+/g, ''))}</b> ${redify(m[2])}` : redify(line);
}

// "EXT: Grey INT: Nebula Purple/White" → one line per colour, so an interior colour never wraps away
// from its label. A line break typed in the box is kept; text without EXT/INT is left as it is.
const colourLines = text => str(text).split(/\s*\r?\n\s*|\s+(?=(?:EXT|INT)\b)/i).filter(Boolean);

// A line with nothing in it (a blank row the editor sent along) is not a vehicle: it is dropped, and the
// grid draws its own numbered blanks. Anything the supplier would read — a name, a model, a price — counts.
const PRINTED = ['client', 'consignee', 'brand', 'model', 'trim', 'color', 'year', 'accessories'];
const hasContent = it => PRINTED.some(k => str(it[k])) || amount(it.pi_price) !== 0;

// ── The model ─────────────────────────────────────────────────────────────────
// Everything the page prints, worked out once. Exported so the maths and the fallbacks can be tested
// without a browser; buildPurchaseOrderHtml only lays it out.
function purchaseOrderModel(po) {
  const d = rec(po);
  const s = rec(d.settings);
  const currency = str(d.currency).toUpperCase() || 'USD';
  const lead = str(d.client_name);
  let cents = 0, units = 0;

  const lines = arr(d.items).filter(it => it && typeof it === 'object' && !Array.isArray(it) && hasContent(it)).map(it => {
    const consignee = str(it.consignee);
    const client = str(it.client) || consignee || lead;
    const q = amount(it.units);
    const qty = q > 0 ? q : 1;
    const price = amount(it.pi_price);
    const lineCents = price ? Math.round(price * qty * 100) : 0;
    cents += lineCents;
    units += qty;
    return {
      client, consignee: consignee && consignee !== client ? consignee : '',
      brand: str(it.brand), model: str(it.model), trim: str(it.trim),
      colour: colourLines(it.color), year: str(it.year),
      accessories: str(it.accessories) || DOC_DEFAULT_ACCESSORIES,
      qty, price: price ? money(price) : '', total: price ? money(lineCents / 100) : '',
    };
  });

  const supplier = {
    name: str(d.supplier_name) || str(d.supplier), contact: str(d.supplier_contact),
    address: str(d.supplier_address), country: str(d.supplier_country),
  };
  const termLines = (str(d.payment_terms) || DOC_DEFAULT_PAYMENT_TERMS).split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  return {
    id: str(d.quote_id) || str(d.po_number),       // the form's "ID": the quote it came from, else the order's own number
    poNumber: str(d.po_number), date: day(d.po_date), issuer: str(d.issuer), currency,
    supplier, lines,
    blanks: Math.max(0, MIN_ROWS - lines.length),
    total: cents / 100, units,
    notes: str(d.notes),
    terms: termLines,
    delivery: {
      incoterm: str(d.incoterm) || 'FOB', location: str(d.delivery_location),
      provider: str(d.service_provider), contact: str(d.contact),
      documents: str(d.documents_required) || DOC_DEFAULT_DOCUMENTS,
    },
    note: company(s).note,
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const RED = '#B3261E';   // "fill this in" — the one colour here that is not the brand's

const CSS = `
.po{padding-top:.5mm}
.red{color:${RED};font-weight:600}

/* title block + meta card (the quotation's own) */
.po-hero{display:grid;grid-template-columns:minmax(0,1fr) 68mm;gap:9mm;align-items:center;break-inside:avoid}
.po-h1{font-size:26pt;font-weight:700;letter-spacing:.02em;line-height:1;color:var(--ink);white-space:nowrap}
.po-bar{width:12mm;height:1.2mm;border-radius:1mm;background:var(--green);margin:2.8mm 0 2.6mm}
.po-to{font-size:14pt;font-weight:700;line-height:1.22;color:var(--green);overflow-wrap:anywhere}
.po .po-meta{padding:1.1mm 4.4mm}
.po-meta .r{display:grid;grid-template-columns:19mm minmax(0,1fr);gap:3mm;align-items:baseline;padding:.9mm 0;line-height:1.25;border-bottom:.25mm solid var(--mint-200)}
.po-meta .r:last-child{border-bottom:0}
.po-meta .k{font-size:5.9pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.po-meta .v{font-size:8.8pt;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.po-meta .v.dim{font-weight:500;color:var(--muted)}
/* a telephone number is one piece: it does not break across lines, and inside Arabic text it reads left to right */
.tel{white-space:nowrap;direction:ltr;unicode-bidi:isolate}
/* typed text may be Arabic or mixed: order each value by its own first letter, keep the columns left-aligned */
.po-to,.po-meta .v,.po-sup .v,.po-tbl td.t,.po-note p,.po-lines li>span,.po-kv .v{unicode-bidi:plaintext;text-align:left}

/* supplier */
.po-sup{margin-top:4.6mm;padding:2.6mm 4.4mm 3mm}
.po-sup .g{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:2.2mm 6mm}
.po-sup .k,.po-kv .k{display:block;font-size:5.9pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.po-sup .v{display:block;font-size:8.6pt;line-height:1.35;font-weight:600;color:var(--ink);overflow-wrap:anywhere;min-height:4.2mm}
.po-sup .wide{grid-column:1/-1}
.po-sup .v.line,.po-kv .v.line{border-bottom:.3mm dotted var(--mint-300)}

/* the line grid: body text 7.5pt and up; every cell's first line sits on one baseline (see the figures below) */
.po .sec-title{margin:4mm 0 1.6mm}
table.po-tbl{table-layout:fixed;font-size:7.5pt;line-height:1.36}
.po-tbl .c-no{width:6.5mm}.po-tbl .c-cl{width:25mm}.po-tbl .c-veh{width:26mm}.po-tbl .c-col{width:21.5mm}.po-tbl .c-yr{width:9.5mm}
.po-tbl .c-qty{width:7.5mm}.po-tbl .c-pr{width:17mm}.po-tbl .c-tt{width:21mm}
table.po-tbl thead th{padding:1.8mm 1.3mm;font-size:5.8pt;letter-spacing:.09em;line-height:1.3;white-space:nowrap}
table.po-tbl thead th.num{white-space:normal;overflow-wrap:anywhere}
table.po-tbl tbody td{padding:1.3mm 1.3mm;vertical-align:top;overflow-wrap:anywhere}
table.po-tbl .ctr{text-align:center}
/* numerals: Poppins' figures are not tabular, Cairo's are, so a column of amounts lines up digit under digit.
   An amount that would crowd its column steps down a size (never wraps); a quantity or a year stays whole.
   Cairo's first baseline sits lower in its line than Poppins' does, and a PDF ignores vertical-align:baseline in a
   cell, so the figures' top padding is worked out from their own size to land on the text's baseline. */
table.po-tbl td.fig{font-family:'Cairo','Poppins',sans-serif;font-variant-numeric:tabular-nums;font-size:7.9pt;white-space:nowrap;padding-top:calc(11.17pt - 1.044em)}
table.po-tbl td.fig.xl{font-size:6.8pt}
table.po-tbl td.fig.xxl{font-size:5.6pt}
table.po-tbl td.no{color:var(--muted);font-weight:500}
table.po-tbl tr.blank td{height:9.4mm}
table.po-tbl tr.blank td.no span{opacity:.5}
table.po-tbl td .sub{display:block;margin-top:.5mm;font-size:7.5pt;font-weight:400;line-height:1.3;color:var(--muted)}
table.po-tbl td.cl{font-weight:600;color:var(--ink)}
table.po-tbl td.veh .m{font-weight:600;color:var(--ink)}
table.po-tbl td.veh .tr{display:block;color:var(--text)}
table.po-tbl td.acc{color:var(--text)}
table.po-tbl td.qty{font-weight:600;color:var(--ink)}
table.po-tbl td.tot{font-weight:700;color:var(--ink)}
/* neighbouring cells of a tinted row overlap by a hair, so no light seam shows between them when the page is rasterised */
table.po-tbl tbody tr:nth-child(even) td{box-shadow:-.3mm 0 0 var(--mint-50),.3mm 0 0 var(--mint-50)}
table.po-tbl tbody tr:nth-child(even) td:first-child{box-shadow:.3mm 0 0 var(--mint-50)}
table.po-tbl tbody tr:nth-child(even) td:last-child{box-shadow:-.3mm 0 0 var(--mint-50)}

/* total: the last row of the table, so the final rows and the total always share a page */
table.po-tbl tbody tr.keep{break-after:avoid}
.po table.po-tbl tbody tr.last td{border-bottom:.25mm solid var(--mint-300)}
.po table.po-tbl tbody tr.last td:first-child{border-bottom-left-radius:2.2mm}
.po table.po-tbl tbody tr.last td:last-child{border-bottom-right-radius:2.2mm}
.po table.po-tbl tbody tr.sum td{padding:2.6mm 0 0;border:0;border-radius:0;background:#fff;box-shadow:none}
.po-total{padding:2.8mm 5.4mm}
.po-total .amt{font-size:18pt;line-height:1.1}
.po-total .amt.xl{font-size:13pt}.po-total .amt.xxl{font-size:9pt}
.po-total .cnt{display:block;margin-top:.6mm;font-size:6.8pt;font-weight:500;letter-spacing:.04em;color:var(--mint-200)}

/* terms: payment and notes stacked on the left, delivery beside them; a long note gets a full-width card */
.po-terms{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:3.6mm;margin-top:4mm;break-inside:avoid}
.po-terms .col{display:flex;flex-direction:column;gap:3.6mm;min-width:0}
.po-terms .card{padding:2.8mm 4.2mm 3.2mm}
.po-terms .col .card:last-child{flex:1}
.po-note p{font-size:8.2pt;line-height:1.45;overflow-wrap:anywhere}
.po-note.wide{margin-top:3.6mm}
.po-lines{list-style:none}
.po-lines li{display:flex;font-size:8.2pt;line-height:1.42;color:var(--text)}
.po-lines li>span{min-width:0;overflow-wrap:anywhere}
.po-lines li+li{margin-top:1mm}
/* the bullet is a glyph, so it stays a true circle at any zoom (a CSS box is snapped to whole pixels) */
.po-lines li::before{content:'•';flex:0 0 3.6mm;padding-left:.1mm;font-weight:700;color:var(--green)}
.po-lines .pct{font-weight:700;color:var(--green-deep)}
.po-kv{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2.2mm 5mm}
.po-kv .v{display:block;font-size:8.4pt;line-height:1.35;font-weight:600;color:var(--ink);overflow-wrap:anywhere;min-height:4.2mm}
.po-kv .wide{grid-column:1/-1}
.po-kv .v.plain{font-weight:400;font-size:8pt;line-height:1.45;color:var(--text)}
.po-kv .v.line.alert{border-bottom-color:${RED}}
`;

// ── Pieces ────────────────────────────────────────────────────────────────────
// A value, or the line a hand fills in when there is none. `alert` makes that line red: it is a
// delivery detail the supplier cannot do without. `tel` keeps telephone numbers in one piece.
const value = (v, { alert, tel } = {}) =>
  v ? `<span class="v">${tel ? phones(v) : esc(v)}</span>` : `<span class="v line${alert ? ' alert' : ''}"></span>`;

function heroHtml(m) {
  const meta = (k, v) => `<div class="r"><span class="k">${k}</span><span class="v${v ? '' : ' dim'}">${v ? esc(v) : '—'}</span></div>`;
  return `<section class="po-hero">
  <div>
    <h1 class="po-h1">PURCHASE ORDER</h1>
    ${m.supplier.name ? `<div class="po-bar"></div>
    <div class="po-to">${esc(m.supplier.name)}</div>` : ''}
  </div>
  <div class="card po-meta">
    ${meta('ID', m.id)}${meta('DATE', m.date)}${meta('ISSUER', m.issuer)}${meta('CURRENCY', m.currency)}
  </div>
</section>`;
}

function supplierHtml(m) {
  const f = (k, v, cls, o) => `<div${cls ? ` class="${cls}"` : ''}><span class="k">${k}</span>${value(v, o)}</div>`;
  return `<section class="card po-sup">
  <h4>SUPPLIER DETAILS</h4>
  <div class="g">
    ${f('Name', m.supplier.name)}${f('Contact', m.supplier.contact, '', { tel: true })}${f('Country of Origin', m.supplier.country)}
    ${f('Address', m.supplier.address, 'wide')}
  </div>
</section>`;
}

// A quantity: 2, or 2.5 for the odd half; never 2.00000001.
const qtyText = n => String(Math.round(n * 100) / 100);
// A figure that would crowd its column (seven figures and cents; a quantity of 1,000 or more) steps down a
// size, and again, rather than wrap: past `big` characters it is `xl`, past `huge` it is `xxl`. (The quantity
// column holds up to five digits; an amount, a dozen characters.)
const fig = (cls, text, big = 9, huge = 12) => `<td class="${cls}${text.length > huge ? ' xxl' : text.length > big ? ' xl' : ''}">${esc(text)}</td>`;

function lineRow(l, i, cls) {
  const veh = [l.brand, l.model].filter(Boolean).join(' ');
  return `    <tr${cls ? ` class="${cls}"` : ''}>
      <td class="ctr fig no">${i + 1}</td>
      <td class="t cl">${esc(l.client)}${l.consignee ? `<span class="sub">Consignee: ${esc(l.consignee)}</span>` : ''}</td>
      <td class="t veh">${veh ? `<span class="m">${esc(veh)}</span>` : ''}${l.trim ? `<span class="tr">${esc(l.trim)}</span>` : ''}</td>
      <td class="t">${l.colour.map(esc).join('<br>')}</td>
      <td class="ctr fig">${esc(l.year)}</td>
      <td class="t acc">${esc(l.accessories).replace(/\r?\n/g, '<br>')}</td>
      ${fig('ctr fig qty', qtyText(l.qty), 3, 4)}
      ${fig('num fig', l.price)}
      ${fig('num fig tot', l.total)}
    </tr>`;
}

// A numbered row with nothing in it: the grid is a form, and a short order leaves room to see that.
function blankRow(i, cls) {
  return `    <tr class="blank${cls ? ` ${cls}` : ''}"><td class="ctr fig no"><span>${i + 1}</span></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
}

function tableHtml(m) {
  const cur = esc(m.currency.toUpperCase());
  const n = m.lines.length + m.blanks;
  // The total is the table's last row, and the last KEEP rows are chained to it (break-after:avoid),
  // so a page break can never leave the total alone on a page.
  const cls = i => [i >= n - KEEP ? 'keep' : '', i === n - 1 ? 'last' : ''].filter(Boolean).join(' ');
  const rows = [];
  m.lines.forEach((l, i) => rows.push(lineRow(l, i, cls(i))));
  for (let i = m.lines.length; i < n; i++) rows.push(blankRow(i, cls(i)));
  const count = m.units > 0 ? `<span class="cnt">${esc(qtyText(m.units))} ${m.units === 1 ? 'vehicle' : 'vehicles'}</span>` : '';
  const amt = money(m.total);
  const size = amt.length > 24 ? ' xxl' : amt.length > 16 ? ' xl' : '';   // a sum that would crowd the block steps down a size
  return `<div class="sec-title">ORDER LINES</div>
<table class="tbl po-tbl">
  <colgroup><col class="c-no"><col class="c-cl"><col class="c-veh"><col class="c-col"><col class="c-yr"><col><col class="c-qty"><col class="c-pr"><col class="c-tt"></colgroup>
  <thead><tr><th class="ctr">NO</th><th>CLIENT</th><th>VEHICLE</th><th>COLOR EXT / INT</th><th class="ctr">YEAR</th><th>ACCESSORIES / REMARKS</th><th class="ctr">QTY</th><th class="num">PRICE ${cur}</th><th class="num">TOTAL ${cur}</th></tr></thead>
  <tbody>
${rows.join('\n')}
    <tr class="sum"><td colspan="9"><div class="total po-total"><span><span class="lbl">TOTAL</span>${count}</span><span class="amt${size}">${esc(amt)}<small>${cur}</small></span></div></td></tr>
  </tbody>
</table>`;
}

// Payment and notes stack on the left, delivery sits beside them. A note too long for the narrow column
// (about four lines of it) gets a card of its own across the page, under both.
const WIDE_NOTE = 190;

function termsHtml(m) {
  const dv = m.delivery;
  const wideNote = m.notes.length > WIDE_NOTE || m.notes.split(/\r?\n/).length > 3;
  const note = m.notes ? `<section class="card po-note${wideNote ? ' wide' : ''}"><h4>NOTES</h4><p>${escBr(m.notes)}</p></section>` : '';
  const k = (label, v, o) => `<div><span class="k">${label}</span>${value(v, o)}</div>`;
  return `<div class="po-terms">
  <div class="col">
    <section class="card"><h4>PAYMENT TERMS</h4>
      <ul class="po-lines">
${m.terms.map(t => `        <li><span>${termLine(t)}</span></li>`).join('\n')}
      </ul>
    </section>
    ${wideNote ? '' : note}
  </div>
  <section class="card"><h4>DELIVERY TERMS</h4>
    <div class="po-kv">
      ${k('Incoterm', dv.incoterm)}${k('Delivery Location', dv.location, { alert: true })}
      ${k('Service Provider', dv.provider, { alert: true })}${k('Contact', dv.contact, { alert: true, tel: true })}
      <div class="wide"><span class="k">Documents Required</span><span class="v plain">${redify(dv.documents)}</span></div>
    </div>
  </section>
</div>${wideNote ? `\n${note}` : ''}`;
}

// ── The document ──────────────────────────────────────────────────────────────
function buildPurchaseOrderHtml(po) {
  const m = purchaseOrderModel(po);
  const d = rec(po);
  const body = `<div class="po">
${heroHtml(m)}
${supplierHtml(m)}
${tableHtml(m)}
${termsHtml(m)}
</div>`;
  return shell({
    title: m.id ? `Purchase Order ${m.id}` : 'Purchase Order',
    settings: d.settings,
    header: { ref: { label: 'PURCHASE ORDER', id: m.id } },
    footer: { ref: m.id },
    extraCss: CSS,
    body,
  });
}

module.exports = { buildPurchaseOrderHtml, purchaseOrderModel };
