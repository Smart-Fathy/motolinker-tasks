'use strict';
// The Motolinkers look for every generated document — quotation, contract, purchase
// order and the RFQ workbook. One place for the palette, the typefaces, the logo and
// the page furniture, so a document can't drift from the brand on its own.
//
// Palette: taken from the logo itself (#043627 wordmark, #3A8E0E road mark) and the
// mint tints already used in the company's RFQ sheet (#F5F9F3, #EAF4E5).
// Type:    Poppins (Latin) — the brand typeface — with Cairo behind it for Arabic.
// Pages:   A4. The header and footer are fixed elements Chrome repeats on every page,
//          and the content flows in a table whose empty thead/tfoot reserve their room,
//          so a document of any length is paginated without hand-placed page breaks.
//
// Everything here is pure (no database, no ctx): builders hand it the company settings
// they already loaded.

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

const COLORS = {
  ink:       '#043627',   // brand dark green — headings, table heads, primary text on white
  green:     '#3A8E0E',   // brand green — accents, rules, markers
  greenDeep: '#2C6F09',   // green for small text on tints (contrast)
  lime:      '#7EC842',   // light green for use on the dark ink background
  mint50:    '#F5F9F3',
  mint100:   '#EAF4E5',
  mint200:   '#D8E9CE',
  mint300:   '#BDD9AD',
  text:      '#16271F',
  muted:     '#5C6F64',
  line:      '#DDE9D6',
  paper:     '#FFFFFF',
};

// Defaults for the company block; the `quotation_settings` table overrides each one.
const COMPANY_DEFAULTS = {
  name:    'Motolinkers',
  tagline: 'AUTOMOTIVE • ELECTRIC • MOBILITY',
  address: 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo',
  email:   'info@motolinkers.com',
  website: 'www.motolinkers.com',
  phone:   '+2 010 000 78104',
  taxId:   '773934006',
  regNo:   '282378',
  note:    'Confidential',
};

function company(settings) {
  const s = settings || {};
  const pick = (key, def) => {
    const v = s[key];
    return v != null && String(v).trim() ? String(v).trim() : def;
  };
  return {
    name:    pick('company_name', COMPANY_DEFAULTS.name),
    tagline: pick('company_tagline', COMPANY_DEFAULTS.tagline),
    address: pick('company_address', COMPANY_DEFAULTS.address),
    email:   pick('company_email', COMPANY_DEFAULTS.email),
    website: pick('company_website', COMPANY_DEFAULTS.website),
    phone:   pick('company_phone', COMPANY_DEFAULTS.phone),
    taxId:   pick('company_tax_id', COMPANY_DEFAULTS.taxId),
    regNo:   pick('company_reg_no', COMPANY_DEFAULTS.regNo),
    note:    pick('footer_note', COMPANY_DEFAULTS.note),
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
// Multi-line text → escaped HTML with <br>.
const escBr = v => esc(v).replace(/\r?\n/g, '<br>');
// 1,234,567 — whole numbers print bare, fractions keep up to `max` digits.
const num = (n, max = 2) => {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '').replace(/,/g, ''));
  if (!isFinite(v)) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: max });
};

// ── Assets ────────────────────────────────────────────────────────────────────
const _bin = new Map();
function assetBuffer(rel) {
  if (!_bin.has(rel)) _bin.set(rel, fs.readFileSync(path.join(ASSETS, rel)));
  return _bin.get(rel);
}
const _uri = new Map();
function dataUri(rel, mime) {
  if (!_uri.has(rel)) _uri.set(rel, `data:${mime};base64,${assetBuffer(rel).toString('base64')}`);
  return _uri.get(rel);
}
// variant: 'color' (for white/mint paper) · 'white' · 'reverse' (white wordmark + light
// green mark, made for the dark-green ink background).
const LOGO_VARIANTS = ['color', 'white', 'reverse'];
const logoUri = (variant = 'color') => dataUri(`brand/logo-${LOGO_VARIANTS.includes(variant) ? variant : 'color'}.png`, 'image/png');
const markUri = (variant = 'color') => dataUri(`brand/mark-${variant === 'white' ? 'white' : 'color'}.png`, 'image/png');
// Raw PNG bytes — for the Excel workbook, which embeds images rather than linking them.
const logoBuffer = (variant = 'color') => assetBuffer(`brand/logo-${LOGO_VARIANTS.includes(variant) ? variant : 'color'}.png`);
const markBuffer = (variant = 'color') => assetBuffer(`brand/mark-${variant === 'white' ? 'white' : 'color'}.png`);
// Pixel sizes of the shipped PNGs (width / height), for layouts that need the ratio.
const LOGO_RATIO = 1200 / 227;
const MARK_RATIO = 300 / 248;

// ── Fonts ─────────────────────────────────────────────────────────────────────
const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const ARABIC_RANGE = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
let _fontCss = null;
function fontCss() {
  if (_fontCss) return _fontCss;
  const face = (family, weight, file, range) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;` +
    `src:url(${dataUri('fonts/' + file, 'font/woff2')}) format('woff2');unicode-range:${range}}`;
  _fontCss = [400, 500, 600, 700].map(w => face('Poppins', w, `poppins-latin-${w}.woff2`, LATIN_RANGE)).join('\n') + '\n'
    + face('Cairo', '200 1000', 'cairo-arabic-wght.woff2', ARABIC_RANGE) + '\n'
    + face('Cairo', '200 1000', 'cairo-latin-wght.woff2', LATIN_RANGE);
  return _fontCss;
}
const FONT_STACK = "'Poppins','Cairo',sans-serif";
const FONT_STACK_AR = "'Cairo','Poppins',sans-serif";

// ── Base stylesheet ───────────────────────────────────────────────────────────
// Components every document draws from; a document adds its own rules after these.
function baseCss(o) {
  const opts = o || {};
  const rtl = opts.dir === 'rtl';
  const headH = opts.headH || '32mm';
  const footH = opts.footH || '26mm';
  const pageNumbers = opts.pageNumbers !== false;
  const pageLabel = opts.pageLabel || (rtl ? '"صفحة " counter(page) " من " counter(pages)' : '"Page " counter(page) " of " counter(pages)');
  const numBox = rtl ? '@bottom-left' : '@bottom-right';
  return `
:root{--ink:${COLORS.ink};--green:${COLORS.green};--green-deep:${COLORS.greenDeep};--lime:${COLORS.lime};
  --mint-50:${COLORS.mint50};--mint-100:${COLORS.mint100};--mint-200:${COLORS.mint200};--mint-300:${COLORS.mint300};
  --text:${COLORS.text};--muted:${COLORS.muted};--line:${COLORS.line};--head-h:${headH};--foot-h:${footH};--gutter:14mm}
@page{size:A4;margin:0 0 10mm 0;${pageNumbers ? `${numBox}{content:${pageLabel};font:500 6.6pt/1 'Poppins','Cairo',sans-serif;color:${COLORS.muted};padding:0 14mm 4mm;vertical-align:top}` : ''}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:${rtl ? FONT_STACK_AR : FONT_STACK};font-size:9pt;line-height:1.5;color:var(--text);background:#fff;font-variant-numeric:tabular-nums}
img{display:block}

/* ── Page furniture: repeats on every page ── */
.doc-header{position:fixed;top:0;left:0;right:0;padding:9mm var(--gutter) 0;background:#fff}
.dh-row{display:flex;align-items:center;justify-content:space-between;gap:8mm}
.dh-logo{height:11.5mm;width:auto}
.dh-side{text-align:${rtl ? 'left' : 'right'};direction:ltr;line-height:1.5}
.dh-tag{display:block;font-size:6.2pt;font-weight:600;letter-spacing:.24em;color:var(--green);white-space:nowrap}
.dh-ref{display:block;font-size:6.8pt;font-weight:600;letter-spacing:.06em;color:var(--ink);margin-top:.8mm}
.dh-ref span{color:var(--muted);font-weight:500}
.rule{display:flex;height:1.5mm;border-radius:1mm;overflow:hidden}
.rule i{display:block}.rule i:first-child{flex:0 0 74%;background:var(--ink)}.rule i:last-child{flex:1;background:var(--green)}
.dh-rule{margin-top:3.6mm}

.doc-footer{position:fixed;bottom:0;left:0;right:0;padding:0 var(--gutter) 2.4mm;background:#fff;direction:ltr}
.df-rule{height:.35mm;background:linear-gradient(90deg,var(--ink) 0 74%,var(--green) 74% 100%)}
.df-grid{display:grid;grid-template-columns:1.45fr 1.25fr 1fr;gap:6mm;padding-top:2.6mm;font-size:6.5pt;line-height:1.6;color:var(--muted)}
.df-grid b{color:var(--ink);font-weight:600}
.df-grid .r{text-align:right}
.df-note{margin-top:1.8mm;text-align:center;font-size:6.2pt;letter-spacing:.03em;color:var(--muted)}

.flow{width:100%;border-collapse:collapse}
.flow>thead>tr>td{height:var(--head-h);padding:0}
.flow>tfoot>tr>td{height:var(--foot-h);padding:0}
.flow>tbody>tr>td{padding:0 var(--gutter);vertical-align:top}

/* ── Type ── */
.eyebrow{font-size:6.6pt;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:var(--green)}
.h-title{font-size:23pt;font-weight:700;line-height:1.1;letter-spacing:-.012em;color:var(--ink)}
.h-sub{font-size:10.5pt;font-weight:500;color:var(--muted);margin-top:1mm}
.muted{color:var(--muted)}
.sec-title{display:flex;align-items:center;gap:2.2mm;margin:6.5mm 0 2.6mm;font-size:7.2pt;font-weight:700;letter-spacing:.17em;text-transform:uppercase;color:var(--ink);break-after:avoid}
.sec-title::before{content:'';flex:0 0 5.5mm;height:1.1mm;border-radius:1mm;background:var(--green)}

/* ── Cards, key/value, tables ── */
.card{background:var(--mint-50);border:.25mm solid var(--mint-200);border-radius:3mm;padding:3.4mm 4.2mm;break-inside:avoid}
.card h4{font-size:6.6pt;font-weight:700;letter-spacing:.17em;text-transform:uppercase;color:var(--green-deep);margin-bottom:1.8mm}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:2.4mm 6mm}
.meta .k{display:block;font-size:5.9pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.meta .v{display:block;font-size:9pt;font-weight:600;color:var(--ink);word-break:break-word}

table.kv{width:100%;border-collapse:separate;border-spacing:0;font-size:8.2pt;break-inside:avoid}
table.kv th,table.kv td{padding:2.1mm 3.2mm;text-align:left;vertical-align:top;border-bottom:.25mm solid var(--line)}
table.kv th{width:27%;background:var(--mint-100);color:var(--ink);font-weight:600;border-right:.25mm solid var(--mint-200)}
table.kv tr:first-child th{border-top-left-radius:2mm}table.kv tr:last-child th{border-bottom-left-radius:2mm}
table.kv tr:first-child td{border-top:.25mm solid var(--line)}
table.kv tr:first-child th{border-top:.25mm solid var(--mint-200)}
table.kv td{border-right:.25mm solid var(--line)}
table.kv th{border-left:.25mm solid var(--mint-200)}
table.kv tr:last-child td{border-bottom-right-radius:2mm}
table.kv tr:last-child th,table.kv tr:last-child td{border-bottom-color:var(--mint-300)}

table.tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:8pt;line-height:1.4}
table.tbl thead{display:table-header-group}
table.tbl thead th{background:var(--ink);color:#fff;font-weight:600;font-size:6.3pt;letter-spacing:.12em;text-transform:uppercase;text-align:left;padding:2.4mm 3mm;vertical-align:middle;box-shadow:0 0 0 .14mm var(--ink)}
table.tbl thead th:first-child{border-top-left-radius:2.2mm}table.tbl thead th:last-child{border-top-right-radius:2.2mm}
table.tbl tbody td{padding:2.2mm 3mm;border-bottom:.25mm solid var(--line);vertical-align:middle;word-wrap:break-word}
table.tbl tbody td:first-child{border-left:.25mm solid var(--mint-200)}table.tbl tbody td:last-child{border-right:.25mm solid var(--mint-200)}
table.tbl tbody tr:nth-child(even) td{background:var(--mint-50);box-shadow:0 0 0 .1mm var(--mint-50)}
table.tbl tbody tr:last-child td{border-bottom:.25mm solid var(--mint-300)}
table.tbl tbody tr:last-child td:first-child{border-bottom-left-radius:2.2mm}table.tbl tbody tr:last-child td:last-child{border-bottom-right-radius:2.2mm}
table.tbl tr{break-inside:avoid}
table.tbl .num{text-align:right;white-space:nowrap}table.tbl .ctr{text-align:center}
table.tbl td.strong{font-weight:600;color:var(--ink)}
table.tbl td.free{color:var(--green-deep);font-weight:600}

.total{display:flex;align-items:center;justify-content:space-between;gap:6mm;margin-top:3mm;padding:3.6mm 5mm;border-radius:2.6mm;background:var(--ink);color:#fff;break-inside:avoid}
.total .lbl{font-size:6.8pt;font-weight:600;letter-spacing:.17em;text-transform:uppercase;color:var(--lime)}
.total .amt{font-size:17pt;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.total .amt small{font-size:7.5pt;font-weight:600;letter-spacing:.16em;color:var(--lime);margin-left:1.6mm}

.pill{display:inline-block;padding:.7mm 2.4mm;border-radius:5mm;background:var(--mint-100);color:var(--green-deep);font-size:6.6pt;font-weight:600;letter-spacing:.05em}
.avoid{break-inside:avoid}
${opts.extra || ''}`;
}

// ── Page furniture ────────────────────────────────────────────────────────────
// opts.ref: { label, id } shows a small "QUOTATION  MT28W88Y26" under the tagline.
function headerHtml(settings, opts) {
  const c = company(settings);
  const o = opts || {};
  const ref = o.ref && (o.ref.label || o.ref.id)
    ? `<span class="dh-ref">${esc(o.ref.label || '')}${o.ref.id ? ` <span>${esc(o.ref.id)}</span>` : ''}</span>` : '';
  return `<div class="doc-header">
  <div class="dh-row">
    <img class="dh-logo" alt="${esc(c.name)}" src="${logoUri('color')}">
    <div class="dh-side"><span class="dh-tag">${esc(c.tagline)}</span>${ref}</div>
  </div>
  <div class="rule dh-rule"><i></i><i></i></div>
</div>`;
}

// opts.note: centred line under the contact columns; opts.ref: right-hand reference.
function footerHtml(settings, opts) {
  const c = company(settings);
  const o = opts || {};
  const note = o.note != null ? o.note : c.note;
  return `<div class="doc-footer">
  <div class="df-rule"></div>
  <div class="df-grid">
    <div><b>Office</b><br>${esc(c.address)}</div>
    <div><b>${esc(c.email)}</b><br>${esc(c.website)} &nbsp;·&nbsp; ${esc(c.phone)}</div>
    <div class="r"><b>Tax ID</b> ${esc(c.taxId)}<br><b>Registration No</b> ${esc(c.regNo)}${o.ref ? `<br>${esc(o.ref)}` : ''}</div>
  </div>
  ${note ? `<div class="df-note">${esc(note)}</div>` : ''}
</div>`;
}

// A complete document: fonts + base CSS + repeating header/footer + the flowing body.
//   body      HTML of the content (goes inside the flow cell)
//   settings  quotation_settings map (company name/address/…); optional
//   header    { ref: {label,id} }       footer  { note, ref }
//   dir/lang  'rtl'/'ar' for the Arabic contract
//   extraCss  document-specific rules appended after the base stylesheet
//   headH/footH  override the reserved heights (mm strings) when a header grows
function shell(o) {
  const opts = o || {};
  const rtl = opts.dir === 'rtl';
  return `<!DOCTYPE html>
<html lang="${esc(opts.lang || (rtl ? 'ar' : 'en'))}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="UTF-8">
<title>${esc(opts.title || 'Motolinkers')}</title>
<style>${fontCss()}</style>
<style>${baseCss({ dir: opts.dir, headH: opts.headH, footH: opts.footH, pageNumbers: opts.pageNumbers, pageLabel: opts.pageLabel, extra: opts.extraCss })}</style>
</head><body>
${headerHtml(opts.settings, opts.header)}
${footerHtml(opts.settings, opts.footer)}
<table class="flow"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot>
<tbody><tr><td>
${opts.body || ''}
</td></tr></tbody></table>
</body></html>`;
}

module.exports = {
  COLORS, COMPANY_DEFAULTS, FONT_STACK, FONT_STACK_AR, LOGO_RATIO, MARK_RATIO,
  company, esc, escBr, num,
  logoUri, markUri, logoBuffer, markBuffer,
  fontCss, baseCss, headerHtml, footerHtml, shell,
};
