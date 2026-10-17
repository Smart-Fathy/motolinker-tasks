'use strict';
// The quotation PDF — the document a salesperson sends a customer.
//
// data: { id, date, validTo, name, vehicleModel, items:[{name,unit,priceUsd}],
//         logistics:[{label,priceUsd}], currency, exchange, issuer, imageDataUrls:[],
//         customSpecs:[{key,val}], settings:{…quotation_settings}, template }
//
// `template` is ignored: there is one design now.
//
// Layout, top to bottom: a title block (QUOTATION, the vehicle) beside a card with the
// quote's ID / DATE / VALID TO / NAME; a strip of up to five photos (none → no strip at
// all); the pricing and logistics tables, each with its header row repeated if it runs onto
// another page; a dark total block; and two cards, key specs beside payment terms. The
// normal quotation fits one A4 page; a long one flows onto the next with the page furniture
// (shell header/footer, "Page n of N") repeating.
//
// The money maths is money.js — the same two functions the editor's running totals use —
// so the number on the page can never disagree with the number the salesperson saw.
//
// Rules of this document:
//  * Text is text: every value goes through esc(); nothing typed is interpolated as HTML.
//  * A blank never prints "undefined"; a section with nothing to say is left out, not drawn
//    empty (no photos → no strip; no issuer and no specs → no specs card).
//  * A photo is accepted only as an inline data:image URL, so the document can never reach
//    out to the network (render.js refuses it as well, but there is nothing to refuse).

const { shell, esc, escBr, num, company } = require('./brand');
const { calcEgp, fmtNum } = require('./money');

const DEFAULT_TERMS = '50% Down payment operations start\n30% Upon shipping from supplier\n20% Upon Custom clearances';
const MAX_PHOTOS = 5;

// ── Values ────────────────────────────────────────────────────────────────────
const str = v => (v == null || typeof v === 'object' ? '' : String(v)).trim();
const arr = v => (Array.isArray(v) ? v : []);
const rec = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// How one price cell reads. The editor treats an empty price and "free" (any case) as free;
// anything else is a number, and what is not a number (a note such as "TBC") is left as typed
// rather than printed as a price or as "Free".
//   free  → "Free" in both money columns, not in the total
//   money → price and price × units × exchange, in the total
//   text  → the typed words in the price column, a dash in the total column, not in the total
//   none  → a dash in both (a logistics line with no price)
function priced(rawPrice, units, rate, { blank }) {
  const raw = str(rawPrice);
  if (raw.toLowerCase() === 'free') return { kind: 'free' };
  if (raw === '') return { kind: blank };
  const egp = calcEgp(raw, units, rate);
  if (egp === null) return { kind: 'text', usd: raw };
  return { kind: 'money', usd: fmtNum(raw), egp };
}

// "Mazda EZ60 — EV 600 Max" → the title and a grey subtitle. Only a clear separator splits:
// an em dash, a bar, or a line break. Anything else (a hyphen, a space) is part of the name.
function splitVehicle(model) {
  const parts = str(model).split(/\s*(?:—|\||\r?\n)\s*/).map(s => s.trim()).filter(Boolean);
  return { title: parts[0] || '', sub: parts.slice(1).join(' · ') };
}

// "70% Deposit…" → the share and the words. A line that does not start with a percentage
// is kept whole, so nothing a person wrote is lost to the styling.
function termLine(line) {
  const m = /^(\d+(?:[.,]\d+)?\s?%)\s*(.*)$/.exec(line);
  return m && m[2] ? { pct: m[1].replace(/\s+/g, ''), text: m[2] } : { pct: '', text: line };
}

// Everything the page prints, worked out once. Exported so the maths can be tested without
// a browser; buildQuotationHtml only lays it out.
function quotationModel(data) {
  const d = rec(data);
  const s = rec(d.settings);
  const rate = parseFloat(d.exchange) || 1;       // the editor's own fallback, see calcEgp
  let total = 0;

  const items = arr(d.items).map(it => {
    const o = it && typeof it === 'object' ? it : { name: it };
    const name = str(o.name);
    const unit = parseFloat(o.unit) || 1;
    const p = priced(o.priceUsd, unit, rate, { blank: 'free' });
    if (!name && !str(o.priceUsd)) return null;    // an empty line carries nothing
    if (p.kind === 'money') total += p.egp;
    return { name, unit: fmtNum(unit), ...p };
  }).filter(Boolean);

  const logistics = arr(d.logistics).map(it => {
    const o = it && typeof it === 'object' ? it : { label: it };
    const label = str(o.label);
    const p = priced(o.priceUsd, 1, rate, { blank: 'none' });
    if (!label && !str(o.priceUsd)) return null;
    if (p.kind === 'money') total += p.egp;
    return { label, ...p };
  }).filter(Boolean);

  const specs = [];
  if (str(d.issuer)) specs.push({ key: 'Issuer', val: str(d.issuer) });
  for (const sp of arr(d.customSpecs)) {
    const o = sp && typeof sp === 'object' ? sp : { val: sp };
    const key = str(o.key), val = str(o.val);
    if (key || val) specs.push({ key, val });
  }

  const terms = (str(s.payment_terms) || DEFAULT_TERMS).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(termLine);

  return {
    id: str(d.id), date: str(d.date), validTo: str(d.validTo), name: str(d.name),
    vehicle: splitVehicle(d.vehicleModel),
    items, logistics, total,
    specs, terms,
    currency: str(d.currency) || 'EGP',
    exchange: num(rate, 4),
    photos: arr(d.imageDataUrls).map(str).filter(u => /^data:image\//i.test(u)).slice(0, MAX_PHOTOS),
    note: company(s).note,
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const CSS = `
.q{padding-top:.5mm}

/* title block + meta card */
.q-hero{display:grid;grid-template-columns:minmax(0,1fr) 68mm;gap:9mm;align-items:center;break-inside:avoid}
.q-h1{font-size:26pt;font-weight:700;letter-spacing:.02em;line-height:1;color:var(--ink)}
.q-bar{width:12mm;height:1.2mm;border-radius:1mm;background:var(--green);margin:2.8mm 0 2.6mm}
.q-veh{font-size:14pt;font-weight:700;line-height:1.22;color:var(--green);overflow-wrap:anywhere}
.q-veh-sub{font-size:9.5pt;font-weight:500;line-height:1.3;color:var(--muted);margin-top:.8mm;overflow-wrap:anywhere}
.q .q-meta{padding:1.1mm 4.4mm}
.q-meta .r{display:grid;grid-template-columns:19mm minmax(0,1fr);gap:3mm;align-items:baseline;padding:.9mm 0;line-height:1.25;border-bottom:.25mm solid var(--mint-200)}
.q-meta .r:last-child{border-bottom:0}
.q-meta .k{font-size:5.9pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.q-meta .v{font-size:8.8pt;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.q-meta .v.dim{font-weight:500;color:var(--muted)}
/* a name, a vehicle or a spec may be Arabic or mixed: order each by its own first letter, keep the columns left-aligned */
.q-veh,.q-veh-sub,.q-meta .v,table.q-tbl td.name,table.q-tbl td.note,.q-lines li,.q-terms li>span:last-child{unicode-bidi:plaintext;text-align:left}

/* photo strip: equal ~2:1 cells (a mild crop for the usual 3:2 car photo), centred; five shrink to fit */
.q-photos{display:flex;justify-content:center;gap:2.4mm;margin-top:4.2mm;break-inside:avoid}
.q-photos .ph{flex:0 1 43.6mm;min-width:0;height:22mm;border:.25mm solid var(--mint-200);border-radius:2.4mm;overflow:hidden;background:var(--mint-100)}
.q-photos img{width:100%;height:100%;object-fit:cover;object-position:50% 60%}

/* tables: both share one column grid so the money columns line up */
.q .sec-title{margin:4mm 0 1.8mm}
table.q-tbl{table-layout:fixed;font-size:8pt;line-height:1.35}
.q-tbl .c-unit{width:15mm}.q-tbl .c-usd{width:31mm}.q-tbl .c-egp{width:37mm}
table.q-tbl thead th{padding:1.8mm 3mm}
table.q-tbl tbody td{padding:1.1mm 3mm}
table.q-tbl td.name{color:var(--ink);font-weight:500}
table.q-tbl td.usd{color:var(--text)}
table.q-tbl td.egp{color:var(--ink);font-weight:600}
table.q-tbl td.dash{color:var(--muted)}
table.q-tbl td.note{color:var(--muted);font-style:italic}

/* total: the last row of the last table, so the final rows and the total always share a page */
table.q-tbl tbody tr.keep{break-after:avoid}
.q table.q-tbl tbody tr.last td{border-bottom:.25mm solid var(--mint-300)}
.q table.q-tbl tbody tr.last td:first-child{border-bottom-left-radius:2.2mm}
.q table.q-tbl tbody tr.last td:last-child{border-bottom-right-radius:2.2mm}
.q table.q-tbl tbody tr.tot td{padding:2.6mm 0 0;border:0;border-radius:0;background:#fff;box-shadow:none}
.q-total{padding:3.1mm 5.4mm}
.q-total .amt{font-size:19pt;line-height:1.1}
.q-alone{margin-top:4mm}

/* cards */
.q-cards{display:grid;grid-template-columns:minmax(0,1.62fr) minmax(0,1fr);gap:3.6mm;margin-top:4.6mm;align-items:stretch;break-inside:avoid}
.q-cards.solo{grid-template-columns:minmax(0,1fr)}
.q-cards .card{display:flex;flex-direction:column;padding:2.8mm 4.2mm 3mm}
.q-lines{list-style:none}
.q-lines li{position:relative;padding-left:3.6mm;font-size:7.3pt;line-height:1.4;color:var(--text);overflow-wrap:anywhere}
.q-lines li+li{margin-top:.8mm}
.q-lines li::before{content:'';position:absolute;left:.15mm;top:1.45mm;width:1.15mm;height:1.15mm;border-radius:50%;background:var(--green)}
.q-lines b{font-weight:600;color:var(--ink)}
.q-terms{list-style:none}
.q-terms li{display:grid;grid-template-columns:11mm minmax(0,1fr);column-gap:2mm;align-items:baseline;font-size:8.2pt;line-height:1.4;padding:.95mm 0;overflow-wrap:anywhere}
.q-terms .pct{font-weight:700;color:var(--green-deep);font-size:9.2pt}
.q-fx{display:flex;gap:7mm;margin-top:auto;padding-top:2mm;border-top:.25mm solid var(--mint-200);font-size:8.2pt;line-height:1.4}
.q-fx .k{color:var(--muted)}.q-fx b{font-weight:600;color:var(--ink)}
.q-terms+.q-fx,.q-terms-plain+.q-fx{margin-top:2mm}
.q-terms-plain li{font-size:8.2pt;line-height:1.45}
.q-terms-plain li::before{top:1.55mm}
.q-terms-plain .pct{font-weight:700;color:var(--green-deep)}
.q-cards.solo .q-terms{display:grid;grid-template-columns:repeat(auto-fit,minmax(46mm,1fr));gap:1.4mm 8mm;padding:.6mm 0 1.2mm}
.q-cards.solo .q-terms li{grid-template-columns:minmax(0,1fr);row-gap:.3mm;padding:0}
.q-cards.solo .q-terms .pct{font-size:14pt;line-height:1.1}
`;

// ── Pieces ────────────────────────────────────────────────────────────────────
function moneyCells(r, { unit }) {
  const cells = [];
  if (unit) cells.push(`<td class="ctr">${esc(r.unit)}</td>`);
  if (r.kind === 'free') cells.push('<td class="num free">Free</td><td class="num free">Free</td>');
  else if (r.kind === 'money') cells.push(`<td class="num usd">${esc(r.usd)}</td><td class="num egp">${esc(fmtNum(r.egp))}</td>`);
  else if (r.kind === 'text') cells.push(`<td class="num note">${esc(r.usd)}</td><td class="num dash">—</td>`);
  else cells.push('<td class="num dash">—</td><td class="num dash">—</td>');
  return cells.join('');
}

function heroHtml(m) {
  const meta = (k, v) => `<div class="r"><span class="k">${k}</span><span class="v${v ? '' : ' dim'}">${v ? esc(v) : '—'}</span></div>`;
  return `<section class="q-hero">
  <div>
    <h1 class="q-h1">QUOTATION</h1>
    ${m.vehicle.title ? `<div class="q-bar"></div>
    <div class="q-veh">${esc(m.vehicle.title)}</div>${m.vehicle.sub ? `\n    <div class="q-veh-sub">${esc(m.vehicle.sub)}</div>` : ''}` : ''}
  </div>
  <div class="card q-meta">
    ${meta('ID', m.id)}${meta('DATE', m.date)}${meta('VALID TO', m.validTo)}${meta('NAME', m.name)}
  </div>
</section>`;
}

function photosHtml(m) {
  if (!m.photos.length) return '';
  return `<div class="q-photos">${m.photos.map(src => `<div class="ph"><img src="${esc(src)}" alt=""></div>`).join('')}</div>`;
}

const KEEP = 2;   // how many final rows travel with the total

// One data table. `total` (the dark block) goes in as the table's last row, so a page break
// can never leave it alone: the last KEEP rows are chained to it with break-after:avoid.
function tableHtml({ title, head, rows, cells, total }) {
  if (!rows.length) return '';
  const tr = (r, i) => {
    const cls = [];
    if (total && i >= rows.length - KEEP) cls.push('keep');
    if (i === rows.length - 1) cls.push('last');
    return `    <tr${cls.length ? ` class="${cls.join(' ')}"` : ''}>${cells(r)}</tr>`;
  };
  return `<div class="sec-title">${title}</div>
<table class="tbl q-tbl">
  <colgroup><col><col class="c-unit"><col class="c-usd"><col class="c-egp"></colgroup>
  <thead><tr>${head}</tr></thead>
  <tbody>
${rows.map(tr).join('\n')}${total ? `\n    <tr class="tot"><td colspan="4">${total}</td></tr>` : ''}
  </tbody>
</table>`;
}

function totalHtml(m) {
  return `<div class="total q-total"><span class="lbl">TOTAL PRICE BREAKDOWN IN EGP</span><span class="amt">${esc(fmtNum(m.total))}<small>EGP</small></span></div>`;
}

function cardsHtml(m) {
  const specs = m.specs.length ? `<div class="card q-specs"><h4>KEY SPECS</h4>
      <ul class="q-lines">
${m.specs.map(sp => `        <li>${sp.key ? `<b>${esc(sp.key)}:</b> ` : ''}${escBr(sp.val)}</li>`).join('\n')}
      </ul>
    </div>` : '';
  // Every line "70% …" → a schedule (share, then words). Any line without a share and the
  // whole list is plain bullets, with a share kept inline, so the lines never sit out of step.
  const schedule = m.terms.length > 0 && m.terms.every(t => t.pct);
  const termsHtml = schedule
    ? `<ul class="q-terms">
${m.terms.map(t => `        <li><span class="pct">${esc(t.pct)}</span><span>${esc(t.text)}</span></li>`).join('\n')}
      </ul>`
    : `<ul class="q-lines q-terms-plain">
${m.terms.map(t => `        <li>${t.pct ? `<b class="pct">${esc(t.pct)}</b> ` : ''}${esc(t.text)}</li>`).join('\n')}
      </ul>`;
  const pay = `<div class="card q-pay"><h4>PAYMENT TERMS</h4>
      ${termsHtml}
      <div class="q-fx"><span><span class="k">Currency:</span> <b>${esc(m.currency)}</b></span><span><span class="k">Exchange:</span> <b>${esc(m.exchange)}</b></span></div>
    </div>`;
  return `<div class="q-cards${specs ? '' : ' solo'}">
    ${specs}${specs ? '\n    ' : ''}${pay}
  </div>`;
}

// ── The document ──────────────────────────────────────────────────────────────
function buildQuotationHtml(data) {
  const m = quotationModel(data);
  const d = rec(data);
  const validity = m.validTo ? `This quotation is valid until ${m.validTo} | ${m.note}` : m.note;
  // The total is the last row of whichever table comes last; with no table at all it stands alone.
  const total = totalHtml(m);
  const lastIsLogistics = m.logistics.length > 0, lastIsPricing = !lastIsLogistics && m.items.length > 0;
  const body = `<div class="q">
${heroHtml(m)}
${photosHtml(m)}
${tableHtml({
    title: 'PRICING BREAKDOWN', rows: m.items, cells: r => `<td class="name">${esc(r.name)}</td>${moneyCells(r, { unit: true })}`,
    head: '<th>ITEM</th><th class="ctr">UNIT</th><th class="num">PRICE USD</th><th class="num">TOTAL EGP</th>',
    total: lastIsPricing ? total : '',
  })}
${tableHtml({
    title: 'LOGISTICS PRICING BREAKDOWN', rows: m.logistics, cells: r => `<td class="name" colspan="2">${esc(r.label)}</td>${moneyCells(r, { unit: false })}`,
    head: '<th colspan="2">ITEM</th><th class="num">PRICE USD</th><th class="num">TOTAL EGP</th>',
    total: lastIsLogistics ? total : '',
  })}
${lastIsLogistics || lastIsPricing ? '' : `<div class="q-alone">${total}</div>`}
${cardsHtml(m)}
</div>`;
  return shell({
    title: m.id ? `Quotation ${m.id}` : 'Quotation',
    settings: d.settings,
    header: { ref: { label: 'QUOTATION', id: m.id } },
    footer: { note: validity, ref: m.id },
    extraCss: CSS,
    body,
  });
}

module.exports = { buildQuotationHtml, quotationModel };
