'use strict';
// Contracts. A contract's `data.template` says which wording it was drawn up on:
//   'sale-v2'  the car-sale (import) contract — "عقد بيع سيارة استيراد", built here, in the
//              current look; the words are in ./contract-sale-text.js
//   anything else  the original agency-style contract, rendered by ./contract-legacy.js
// so a contract saved before the switch re-exports with exactly the words it was signed on.
//
// data (the contract's payload, see contractDefaults in src/routes/contracts.js):
//   template, contractNo, contractDate { day, d, m, y },
//   company { name, commercialReg, taxId, address, repIn },
//   rep { name, nationalId, idDate, nationality, religion, address, role },
//   buyer { name, nationalId, idDate, nationality, religion, address },
//   vehicle { make, model, color, year, notes }, total, totalWords,
//   payments [{ amount, when, label }], settings (quotation_settings map; optional)
//
// Rules of this document:
//  * It FLOWS. Nothing is placed by hand and nothing is clipped, so a long value pushes the
//    text down instead of cutting it off. Clauses may break across pages, a heading never
//    ends a page, and the vehicle table, the payment list and the signature block never split;
//    the last clause travels with the signature block, so a signature is never alone on a page.
//  * A value that is empty prints as a dotted line, so a printed contract can still be filled
//    in by hand. A filled value prints in its place, emphasised, inside its own bidi isolate
//    (<bdi>), so an ID number, a date, an English name or an amount can never reorder the
//    Arabic around it. Blanks are drawn with CSS, not typed as dots, for the same reason.
//  * Text is text: every value goes through esc().

const { shell, esc } = require('./brand');
const { buildLegacyContractHtml } = require('./contract-legacy');
const T = require('./contract-sale-text');

const SALE_TEMPLATE = 'sale-v2';

// ── Values ────────────────────────────────────────────────────────────────────
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = v => (v == null || typeof v === 'object' ? '' : String(v)).trim();
// 1915050 → 1,915,050. Only a plain whole number is regrouped: words, ranges and anything
// the person typed with their own punctuation print as typed.
const money = v => { const t = str(v); return /^\d{4,}$/.test(t) ? t.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : t; };

// token → [where it lives in the data, how wide its blank is when left empty]
// widths: xs (day/month) · s · m · l · xl (a whole address or an amount in words)
const FIELDS = {
  day: ['contractDate', 'day', 's'], d: ['contractDate', 'd', 'xs'], m: ['contractDate', 'm', 'xs'], y: ['contractDate', 'y', 's'],
  'co.name': ['company', 'name', 'l'], 'co.commercialReg': ['company', 'commercialReg', 'm'], 'co.taxId': ['company', 'taxId', 'm'],
  'co.address': ['company', 'address', 'xl'], 'co.repIn': ['company', 'repIn', 'l'],
  'rep.name': ['rep', 'name', 'l'], 'rep.nationalId': ['rep', 'nationalId', 'm'], 'rep.idDate': ['rep', 'idDate', 'm'],
  'rep.nationality': ['rep', 'nationality', 's'], 'rep.religion': ['rep', 'religion', 's'], 'rep.address': ['rep', 'address', 'xl'], 'rep.role': ['rep', 'role', 'm'],
  'buyer.name': ['buyer', 'name', 'l'], 'buyer.nationalId': ['buyer', 'nationalId', 'm'], 'buyer.idDate': ['buyer', 'idDate', 'm'],
  'buyer.nationality': ['buyer', 'nationality', 's'], 'buyer.religion': ['buyer', 'religion', 's'], 'buyer.address': ['buyer', 'address', 'xl'],
  total: [null, 'total', 'm'], totalWords: [null, 'totalWords', 'xl'],
  amount: ['@pay', 'amount', 'm'], when: ['@pay', 'when', 'l'],
};
// The company's representative is one person who is named in two blanks; either one stands in for the other.
const SAME_PERSON = { 'co.repIn': 'rep.name', 'rep.name': 'co.repIn' };

// ── One filled blank, or one empty one ──────────────────────────────────────────
function blank(width) { return `<span class="b b-${width}"></span>`; }
// A short value (a name, an ID, a date) is never split across two lines. A long one with no Arabic
// letter in it (an English address) stays in one block of its own, so the reader's eye is not made to
// jump the other way in the middle of an Arabic sentence; a long Arabic one just wraps.
function value(text) {
  const kind = text.length <= 36 ? ' v--nw' : /[\u0600-\u06FF]/.test(text) ? '' : ' v--ltr';
  return `<bdi class="v${kind}">${esc(text)}</bdi>`;
}

function makeFill(d) {
  const root = { contractDate: obj(d.contractDate), company: obj(d.company), rep: obj(d.rep), buyer: obj(d.buyer) };
  const read = (name, pay) => {
    const spec = FIELDS[name];
    if (!spec) return '';
    const [where, key] = spec;
    const src = where === '@pay' ? pay : where ? root[where] : d;
    let v = str(obj(src)[key]);
    if (!v && SAME_PERSON[name]) { const [w2, k2] = FIELDS[SAME_PERSON[name]]; v = str(root[w2][k2]); }
    if (name === 'total' || name === 'amount') v = money(v);
    return v;
  };
  // text with {tokens} → HTML; `pay` is the payment line a {amount}/{when} belongs to
  return function fill(text, pay) {
    const t = String(text).replace('{d} / {m} / {y}', '{date}');
    return t.split(/(\{[^}]+\})/).map(part => {
      const m = /^\{([^}]+)\}$/.exec(part);
      if (!m) return esc(part);
      if (m[1] === 'date') {
        // day / month / year read left to right as one unit, however Arabic the sentence around them is
        return `<bdi class="dt" dir="ltr">${['d', 'm', 'y'].map(k => { const v = read(k); return v ? value(v) : blank(FIELDS[k][2]); }).join(' / ')}</bdi>`;
      }
      const v = read(m[1], pay);
      return v ? value(v) : blank((FIELDS[m[1]] || [])[2] || 'm');
    }).join('');
  };
}

// ── Pieces ────────────────────────────────────────────────────────────────────
function titleBlock(d) {
  const cd = obj(d.contractDate);
  const no = str(d.contractNo);
  // the date is only worth a line of its own when it is complete; the first sentence of the contract has the blanks
  const dateParts = [str(cd.d), str(cd.m), str(cd.y)];
  const date = dateParts.every(Boolean)
    ? `${str(cd.day) ? `${esc(str(cd.day))} ` : ''}<bdi dir="ltr">${dateParts.map(esc).join(' / ')}</bdi>`
    : '';
  const meta = [no ? `عقد رقم <bdi class="mono">${esc(no)}</bdi>` : '', date ? `بتاريخ ${date}` : ''].filter(Boolean);
  return `<header class="title">
  <div><span class="eyebrow" dir="ltr" lang="en">Imported car sale contract</span></div>
  <h1 class="h-title">${esc(T.TITLE)}</h1>
  ${meta.length ? `<div class="meta-line">${meta.map(m => `<span>${m}</span>`).join('<i></i>')}</div>` : ''}
</header>`;
}

function partyCards(fill) {
  const first = T.FIRST_PARTY, second = T.SECOND_PARTY;
  return `<p class="date-line">${fill(T.DATE_LINE)}</p>
<section class="card party">
  <p><b class="lead">${esc(first.lead)}</b> ${fill(first.company)}</p>
  <p>${fill(first.person)}</p>
  <p class="ref">${esc(first.ref)}</p>
</section>
<section class="card party">
  <p><b class="lead">${esc(second.lead)}</b> ${fill(second.person)}</p>
  <p class="ref">${esc(second.ref)}</p>
</section>
<p class="accept">${esc(T.ACCEPT)}</p>`;
}

function heading(text, n) {
  return `<h2 class="cl-h"><span class="cl-n${n ? '' : ' cl-n--o'}">${n ? n : ''}</span><span class="cl-t">${esc(text)}</span></h2>`;
}

function vehicleTable(d) {
  const ve = obj(d.vehicle);
  return `<table class="veh">${T.VEHICLE_ROWS.map(([label, key]) => {
    const v = str(ve[key]);
    return `<tr><th>${esc(label)}</th><td>${v ? value(v) : blank('fill')}</td></tr>`;
  }).join('')}</table>`;
}

function paymentList(d, fill) {
  const pays = (Array.isArray(d.payments) ? d.payments : []).filter(p => p && typeof p === 'object');
  const lines = pays.length ? pays : [{}];
  return `<ol class="pay">${lines.map(p => {
    const when = str(p.when) || T.DEFAULT_PAYMENT_WHEN;
    const label = str(p.label);
    const text = fill(T.PAYMENT_LINE, { amount: p.amount, when });
    // the sentence ends with a full stop, unless the wording the person typed already did
    const stop = label || !/[.،:؛]$/.test(when) ? '.' : '';
    return `<li><span class="pay-t">${text}${label ? ` ( ${esc(label)} )` : ''}${stop}</span></li>`;
  }).join('')}</ol>`;
}

function clauseBlocks(cl, d, fill) {
  return cl.blocks.map((b, i) => {
    if (b.t === 'p') {
      // a paragraph that introduces a table or a list ("… على النحو التالي :") stays with it
      const next = cl.blocks[i + 1];
      const classes = ['p', /\{/.test(b.text) || /\{/.test(b.lead || '') ? 'p--fill' : '', next && next.t !== 'p' ? 'p--keep' : ''].filter(Boolean).join(' ');
      return `<p class="${classes}">${b.lead ? `<b class="em">${fill(b.lead)}</b> ` : ''}${fill(b.text)}</p>`;
    }
    if (b.t === 'sub') return `<h3 class="sub">${esc(b.text)}</h3>`;
    if (b.t === 'ol') return `<ol class="num">${b.items.map(it => `<li${it.strong ? ' class="em"' : ''}>${esc(it.text)}</li>`).join('')}</ol>`;
    if (b.t === 'vehicle') return vehicleTable(d);
    if (b.t === 'payments') return paymentList(d, fill);
    return '';
  }).join('\n');
}

function signatureBlock(d, fill) {
  const L = T.SIGNATURE.labels;
  const box = (who) => `<div class="sig">
    <h3>${esc(who.title)}</h3>
    <div class="row"><span class="k">${esc(L.name)}</span><span class="val">${fill(who.name)}</span></div>
    <div class="row"><span class="k">${esc(L.nationalId)}</span><span class="val">${fill(who.nationalId)}</span></div>
    <div class="row row--sign"><span class="k">${esc(L.signature)}</span><span class="val"></span></div>
  </div>`;
  return `<div class="sign">${box(T.SIGNATURE.first)}${box(T.SIGNATURE.second)}</div>`;
}

// ── The document ──────────────────────────────────────────────────────────────
const CSS = `
/* The page counter is drawn in the page margin, where only fonts already in use are available:
   in an Arabic document Poppins is not, so the counter would stay invisible. */
@page{@bottom-left{font-family:'Cairo','Poppins',sans-serif}}
.doc{font-size:10.6pt;line-height:1.95;color:var(--text)}
.doc p,.doc h1,.doc h2,.doc h3{margin:0}
.doc bdi{unicode-bidi:isolate}

/* title block */
.title{padding-top:1.5mm;margin-bottom:5.5mm}
.title .h-title{font-size:23pt;line-height:1.4;letter-spacing:0;margin-top:1.2mm}
.meta-line{display:flex;align-items:center;gap:3.2mm;margin-top:1.4mm;font-size:8.6pt;line-height:1.6;color:var(--muted)}
.meta-line i{display:block;width:1.1mm;height:1.1mm;border-radius:50%;background:var(--green)}
.meta-line .mono,.meta-line bdi{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
/* the contract number in the page header: an Arabic label, then the number, and no letter-spacing on Arabic */
.dh-ref{direction:rtl;letter-spacing:0}

/* values and blanks */
.v{font-weight:600;color:var(--ink);text-decoration:underline;text-decoration-color:var(--green);text-decoration-thickness:.22mm;text-underline-offset:1.15mm;text-decoration-skip-ink:none;overflow-wrap:anywhere}
.v--nw{white-space:nowrap}
.v--ltr{display:inline-block;max-width:100%;vertical-align:baseline}
.b{display:inline-block;height:1em;min-width:var(--w,30mm);margin:0 .6mm;border-bottom:.3mm dotted var(--muted);vertical-align:-.28em}
.b-xs{--w:11mm}.b-s{--w:20mm}.b-m{--w:34mm}.b-l{--w:52mm}.b-xl{--w:78mm}
.b-fill{display:block;width:100%;min-width:0;margin:0;height:1.3em}

/* the parties */
.date-line{margin-bottom:3.4mm}
.party{margin:0 0 4mm;padding:3.6mm 5mm 3.4mm}
.party p{text-align:start}
.party p+p{margin-top:1.2mm}
.party .lead{font-weight:700;color:var(--green-deep)}
.party .ref{margin-top:2.4mm;padding:.6mm 3mm;border-radius:2mm;background:var(--mint-100);color:var(--ink);font-weight:600;font-size:9.4pt;line-height:1.8;text-align:center}
.accept{margin:1mm 0 0;font-weight:600;color:var(--ink)}

/* clauses */
.cl{margin-top:6.2mm}
.cl-h{display:flex;align-items:center;gap:3mm;margin-bottom:2.2mm;break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}
.cl-h::after{content:'';flex:1;height:.25mm;background:var(--line)}
.cl-n{flex:none;display:flex;align-items:center;justify-content:center;width:6.4mm;height:6.4mm;border-radius:50%;background:var(--green);color:#fff;font:700 8.6pt/1 'Poppins','Cairo',sans-serif}
.cl-n--o{background:var(--mint-100);box-shadow:inset 0 0 0 .5mm var(--green)}
.cl-n--o::after{content:'';width:1.9mm;height:1.9mm;border-radius:50%;background:var(--green)}
.cl-t{font-size:11.6pt;font-weight:700;line-height:1.5;color:var(--ink)}
.p{margin-bottom:1.8mm;text-align:justify;text-wrap:pretty;orphans:2;widows:2}
.p--fill{text-align:start}
.p--keep{break-after:avoid;page-break-after:avoid}
.em{font-weight:700;color:var(--ink)}
.sub{margin:2.6mm 0 1.6mm;font-size:10.4pt;font-weight:700;color:var(--green-deep);break-inside:avoid;break-after:avoid;page-break-after:avoid}

/* the vehicle table */
table.veh{width:100%;border-collapse:separate;border-spacing:0;margin:2.4mm 0 3.4mm;font-size:10pt;line-height:1.7;break-inside:avoid;page-break-inside:avoid}
table.veh th,table.veh td{padding:1.5mm 4mm;text-align:start;vertical-align:middle;border-bottom:.25mm solid var(--line)}
table.veh th{width:30%;background:var(--mint-100);color:var(--ink);font-weight:600;border-inline-start:.25mm solid var(--mint-200);border-bottom-color:var(--mint-200)}
table.veh td{border-inline-end:.25mm solid var(--line)}
table.veh tr:first-child th{border-top:.25mm solid var(--mint-200);border-start-start-radius:2.4mm}
table.veh tr:first-child td{border-top:.25mm solid var(--line);border-start-end-radius:2.4mm}
table.veh tr:last-child th{border-end-start-radius:2.4mm;border-bottom-color:var(--mint-300)}
table.veh tr:last-child td{border-end-end-radius:2.4mm;border-bottom-color:var(--mint-300)}
table.veh td .v{text-decoration:none}

/* lists */
ol.num,ol.pay{list-style:none;counter-reset:i;padding:0;margin:0 0 2.4mm}
ol.num li{counter-increment:i;position:relative;padding-inline-start:8mm;margin-bottom:1.6mm;text-align:justify;text-wrap:pretty;orphans:2;widows:2;break-inside:avoid;page-break-inside:avoid}
ol.num li::before{content:counter(i);position:absolute;inset-inline-start:0;top:.52em;display:flex;align-items:center;justify-content:center;width:5.2mm;height:5.2mm;border-radius:50%;background:var(--mint-100);color:var(--green-deep);font:700 7.6pt/1 'Poppins','Cairo',sans-serif}
ol.pay{margin:2.2mm 0 2.6mm;break-inside:avoid;page-break-inside:avoid}
ol.pay li{counter-increment:i;display:grid;grid-template-columns:5.6mm 1fr;gap:3.4mm;align-items:start;margin-bottom:1.6mm;padding:1.9mm 4.2mm;border:.25mm solid var(--mint-200);border-radius:2.4mm;background:var(--mint-50)}
ol.pay li::before{content:counter(i);display:flex;align-items:center;justify-content:center;width:5.6mm;height:5.6mm;margin-top:.55em;border-radius:50%;background:var(--ink);color:#fff;font:700 7.6pt/1 'Poppins','Cairo',sans-serif}
.pay-t{text-align:start}

/* the last clause and the signatures stay together */
.closing{break-inside:avoid;page-break-inside:avoid}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:7mm;margin-top:7mm;break-inside:avoid;page-break-inside:avoid}
.sig{display:flex;flex-direction:column;padding:3.6mm 5mm 4mm;border:.3mm solid var(--mint-300);border-radius:3mm;background:#fff}
.sig h3{break-inside:avoid;display:flex;align-items:center;gap:2.2mm;margin-bottom:2mm;font-size:10.4pt;font-weight:700;color:var(--ink)}
.sig h3::before{content:'';flex:none;width:5mm;height:1.1mm;border-radius:1mm;background:var(--green)}
.sig .row{display:flex;align-items:baseline;gap:2.6mm;min-height:8.4mm;border-bottom:.25mm dotted var(--muted)}
.sig .k{flex:none;font-size:8.4pt;line-height:1.9;color:var(--muted)}
.sig .val{flex:1;min-width:0;line-height:1.7;padding-bottom:.4mm;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.sig .val .v{text-decoration:none}
.sig .val .b{display:none}
.sig .row--sign{margin-top:auto;min-height:30mm;border-bottom:.3mm solid var(--ink)}
`;

function buildSaleContractHtml(data) {
  const d = obj(data);
  const co = obj(d.company);
  const fill = makeFill(d);
  const no = str(d.contractNo);

  // The footer carries the registered details; the contract's own company block, when filled,
  // is what the parties signed, so it wins over the stored defaults (as in the old contract).
  const settings = { ...obj(d.settings) };
  // The footer has three narrow columns: a value with no space in it for 24 characters or more (only ever a slip
  // of the keyboard) is given places to wrap, so it cannot push the other columns aside.
  const soft = t => str(t).replace(/(\S{24})(?=\S)/g, '$1\u200B');
  if (str(co.taxId)) settings.company_tax_id = soft(co.taxId);
  if (str(co.commercialReg)) settings.company_reg_no = soft(co.commercialReg);
  if (str(co.address)) settings.company_address = soft(co.address);

  // the footer grows with a long address: keep the room it needs, so it can never run into the text
  const addrLines = Math.ceil(str(settings.company_address).length / 48);
  const footH = `${26 + Math.max(0, addrLines - 2) * 3.8}mm`;

  const clauses = T.CLAUSES.map((cl, i) => `<section class="cl">${heading(cl.heading, i + 1)}\n${clauseBlocks(cl, d, fill)}</section>`);
  const last = clauses.pop();   // the ninth clause: it goes with the signatures

  const body = `<div class="doc">
${titleBlock(d)}
${partyCards(fill)}
<section class="cl">${heading(T.PREAMBLE.heading, 0)}<p class="p">${esc(T.PREAMBLE.text)}</p></section>
${clauses.join('\n')}
<div class="closing">${last}${signatureBlock(d, fill)}</div>
</div>`;

  return shell({
    title: no ? `${T.TITLE} — ${no}` : T.TITLE,
    dir: 'rtl',
    settings,
    header: no ? { ref: { label: 'عقد رقم', id: no.replace(/(\S{24})(?=\S)/g, '$1\u200B') } } : {},
    footH,
    body,
    extraCss: CSS,
  });
}

function buildContractHtml(data) {
  const d = data || {};
  return d.template === SALE_TEMPLATE ? buildSaleContractHtml(d) : buildLegacyContractHtml(d);
}

module.exports = { SALE_TEMPLATE, buildContractHtml, buildSaleContractHtml };
