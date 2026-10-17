'use strict';
// The RFQ — Request for Quotation — as an Excel workbook. Suppliers fill the price,
// lead-time and notes columns in and send it back, so it is a spreadsheet, not a PDF.
//
// rfq: the rfqs row (+ settings) — see rfqBuildRow in src/routes/rfq.js for the fields:
//   rfq_no, rfq_date, issuer, supplier_name/contact/address/country, items[], payment_terms,
//   delivery_location, service_provider, contact, documents_required, custom_fields,
//   settings (quotation_settings key/values: company_* details and the column configs).
// Resolves to a Buffer holding the .xlsx file.
//
// What it looks like (Excel, Google Sheets and on paper):
//   * gridlines off; a dark-green banner with the reverse logo, the title and the
//     ID / Date / Issuer block; section bars in dark green; mint label cells, white value
//     cells; the vehicle grid with a dark head, zebra rows and thin mint borders;
//   * the cells the supplier fills (lead time, FOB, CIF, notes) are green-tinted, boxed in
//     brand green and numeric where they should be, so they are obvious;
//   * printed on A4 landscape, one page wide, the grid head repeating on every page.
//
// Rules this file keeps:
//   * Cell text is data, never code. Every user value is written as a plain string or a
//     number; nothing is ever written as a formula, however it begins.
//   * Excel does not auto-fit the height of a wrapped row written by a library, so every
//     height is worked out here from the text and the column width (see measure below).
//   * No colour outside brand.js's palette.

const ExcelJS = require('exceljs');
const brand = require('./brand');
const defaults = require('./defaults');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── Palette (brand.js) as Excel ARGB ──────────────────────────────────────────
const argb = hex => 'FF' + String(hex).replace('#', '').toUpperCase();
const K = Object.fromEntries(Object.entries(brand.COLORS).map(([k, v]) => [k, argb(v)]));

const FONT = 'Poppins';       // Latin text — Excel substitutes it where it is not installed
const FONT_AR = 'Cairo';      // Arabic text (the brand's Arabic typeface)

// ── Text measurement ──────────────────────────────────────────────────────────
// Advance widths of Poppins Regular and Bold (1000 units per em) for U+0020..U+007E,
// read from the bundled font files. They let us count how many lines a wrapped cell needs.
const W_REG = [267, 298, 292, 840, 622, 759, 739, 159, 454, 454, 486, 683, 198, 551, 210, 476, 628, 320, 575, 589, 629, 628, 635, 546, 631, 630, 213, 264, 555, 723, 539, 524, 1013, 674, 613, 772, 707, 513, 504, 778, 692, 246, 530, 599, 432, 861, 703, 786, 579, 788, 608, 587, 541, 675, 676, 976, 621, 584, 541, 423, 658, 423, 629, 733, 257, 676, 676, 607, 676, 620, 329, 676, 640, 246, 248, 515, 246, 1030, 640, 640, 676, 676, 373, 522, 364, 640, 561, 820, 479, 563, 455, 462, 291, 462, 519];
const W_BOLD = [212, 392, 411, 904, 658, 870, 798, 221, 477, 477, 534, 628, 287, 580, 282, 453, 652, 376, 571, 605, 677, 650, 637, 535, 648, 615, 284, 347, 551, 696, 541, 538, 1080, 737, 659, 762, 727, 541, 547, 762, 731, 295, 578, 697, 477, 918, 752, 786, 624, 788, 652, 615, 591, 705, 730, 1052, 715, 671, 596, 510, 802, 510, 709, 780, 291, 679, 679, 605, 679, 616, 360, 679, 674, 295, 294, 618, 295, 1059, 674, 637, 679, 679, 428, 558, 406, 674, 626, 866, 588, 632, 496, 499, 291, 499, 636];

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u0870-\u089F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RE = /[A-Za-z\u00C0-\u024F]/;

function charUnits(ch, bold) {
  const cp = ch.codePointAt(0);
  if (cp >= 32 && cp <= 126) return (bold ? W_BOLD : W_REG)[cp - 32];
  if (ARABIC_RE.test(ch)) return 600;
  if (cp >= 0x2E80) return 1000;                       // CJK and other full-width scripts
  if (cp >= 0xC0 && cp <= 0x24F) return 650;           // accented Latin
  if (cp < 32) return 0;
  return 620;
}
function textUnits(s, bold) { let u = 0; for (const ch of s) u += charUnits(ch, bold); return u; }

// Where a line may break, as Excel (UAX #14) allows it: after white space, and after a hyphen
// or a slash unless a digit follows — so "Mercedes-Benz" and "Purple/White" can wrap but
// "2026/2027" and "2025-2026" stay whole.
function breakTokens(para) {
  const chars = [...para];
  const out = [];
  let cur = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], next = chars[i + 1];
    cur += ch;
    if (next === undefined) break;
    const space = /\s/.test(ch);
    if (space ? !/\s/.test(next) : (/[-\u2010-\u2014/]/.test(ch) && !/[\d\s]/.test(next))) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}
const pxOf = (pt) => pt * 4 / 3 * 1.05;                // 5% safety: Excel's hinting runs wide
const CELL_PAD = 14;                                   // cell padding + indent, px
const bare = (tok, bold, pt) => textUnits(tok.replace(/\s+$/, ''), bold) / 1000 * pxOf(pt);
// Width of the widest unbreakable run in `text`: the narrowest a column may be before a
// word has to be cut in half.
function tokenPx(text, pt, bold) {
  let w = 0;
  for (const para of String(text == null ? '' : text).split('\n')) {
    for (const tok of breakTokens(para)) w = Math.max(w, bare(tok, bold, pt));
  }
  return w;
}
// How many lines `text` takes in a cell `widthPx` wide, wrapped the way Excel wraps: at the
// break opportunities above, and mid-word only when one word is wider than a line.
function countLines(text, widthPx, pt, bold) {
  const usable = Math.max(24, widthPx - CELL_PAD);
  let lines = 0;
  for (const para of String(text == null ? '' : text).split('\n')) {
    let used = 0, n = 1;
    for (const tok of breakTokens(para)) {
      const w = textUnits(tok, bold) / 1000 * pxOf(pt);
      const b = bare(tok, bold, pt);
      if (used > 0 && used + b > usable) { n++; used = 0; }
      if (b > usable) {                                // one word wider than the whole line
        const chars = [...tok].length, per = b / Math.max(1, chars);
        const fit = Math.max(1, Math.floor(usable / per));
        n += Math.ceil(chars / fit) - 1;
        used = (chars % fit || fit) * per;
      } else used += w;
    }
    lines += n;
  }
  return lines;
}
// Height in points of `lines` lines of `pt` text plus the cell's own padding. Poppins has
// tall Windows line metrics (up to 1.76 em), so lines are costed at 1.65 em plus the cell's
// own padding — generous by design.
// Cairo (the Arabic face) is taller still, 1.87 em, so a cell with Arabic in it gets 2.
const LINE = 1.65, LINE_AR = 2.0;
const textHeight = (lines, pt, pad = 8, ar = false) => lines * pt * (ar ? LINE_AR : LINE) + pad;

// ── Values: plain strings and numbers, never code ─────────────────────────────
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g;
const MAX_TEXT = 32000;                                // Excel's cell limit is 32,767
function text(v) {
  if (v == null || typeof v === 'object') return '';
  let s = typeof v === 'string' ? v : String(v);
  s = s.replace(/\r\n?/g, '\n').replace(CTRL, '').trim();
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + '…' : s;
}
// A price: a number when it is one ("17,800.5" too), nothing when it is blank or 0, the
// text itself when it is words ("TBD") so nothing a person typed is lost.
function price(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0 ? v : null;
  const s = text(v);
  if (!s) return null;
  const n = Number(s.replace(/[,\s]/g, ''));
  if (/^-?\d+(\.\d+)?$/.test(s.replace(/[,\s]/g, '')) && Number.isFinite(n)) return n === 0 ? null : n;
  return s;
}
// A year is a number when it is a plain year, text when it is "2026/2027" or "MY27".
function year(v) {
  const s = text(v);
  return /^(19|20)\d{2}$/.test(s) ? Number(s) : s;
}
// ISO dates become real Excel dates (shown "10 Sep 2026", unambiguous for any reader);
// anything else stays as typed.
function dateValue(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const s = text(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) return d;
  }
  return s;
}
const DATE_FMT = 'dd mmm yyyy';
const PRICE_FMT = '#,##0.00';

// Right-to-left cells: the paragraph direction follows the first strong letter (like
// dir="auto"), so an Arabic name reads right-to-left and an English name with one Arabic
// word in it does not flip. Returns null for text with no Arabic in it at all.
function textDir(s) {
  if (typeof s !== 'string' || !ARABIC_RE.test(s)) return null;
  for (const ch of s) {
    if (ARABIC_RE.test(ch)) return 'rtl';
    if (LATIN_RE.test(ch)) return 'ltr';
  }
  return 'rtl';
}

// ── Column configuration (the admin's grid editor, see src/routes/columns.js) ──
function readConfig(settings, key) {
  try {
    const raw = settings && settings[key];
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.filter(c => c && typeof c.key === 'string' && c.key) : [];
  } catch (_) { return []; }
}
// "cf_insurance_status" → "Insurance status". The editor names a field's key cf_<its label>.
function humanise(key) {
  const s = String(key).replace(/^cf_/, '').replace(/[_\-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(key);
}
const hasValue = v => v != null && v !== '' && v !== false && typeof v !== 'object';

// What a configured field's value reads as: a select's label, a checkbox's Yes, a date, a number.
function fieldValue(raw, col) {
  if (!hasValue(raw)) return null;
  const type = col && col.type;
  if (type === 'checkbox') return raw === true || raw === 'true' || raw === 1 || raw === '1' ? 'Yes' : null;
  if (raw === true) return 'Yes';
  if ((type === 'select' || type === 'radio') && Array.isArray(col.options)) {
    const o = col.options.find(x => x && String(x.key) === String(raw));
    if (o && o.label) return text(o.label);
  }
  if (type === 'number') { const p = price(raw); return typeof p === 'number' ? p : text(raw); }
  if (type === 'date') return dateValue(raw);
  return text(raw);
}

// ── The vehicle grid's columns ────────────────────────────────────────────────
// px are screen pixels; Excel's column width unit is one pixel / 7 at the default font.
const CORE_COLS = [
  { key: 'no',          head: '#',                     px: 32,  align: 'center', kind: 'index' },
  { key: 'brand',       head: 'BRAND',                 px: 84,  align: 'left',   kind: 'text', bold: true },
  { key: 'model',       head: 'MODEL',                 px: 84,  align: 'left',   kind: 'text' },
  { key: 'trim',        head: 'TRIM',                  px: 118, align: 'left',   kind: 'text' },
  { key: 'colour',      head: 'COLOR EXT / INT',       px: 150, align: 'left',   kind: 'text' },
  { key: 'year',        head: 'YEAR',                  px: 54,  align: 'center', kind: 'year' },
  { key: 'accessories', head: 'ACCESSORIES / REMARKS', px: 300, align: 'left',   kind: 'text' },
  { key: 'lead_time',   head: 'LEAD TIME',             px: 90,  align: 'center', kind: 'text',  input: true },
  { key: 'fob_price',   head: 'FOB PRICE',             px: 98,  align: 'right',  kind: 'price', input: true, headAlign: 'center' },
  { key: 'cif_price',   head: 'CIF PRICE (RoRo)',      px: 116, align: 'right',  kind: 'price', input: true, headAlign: 'center' },
  { key: 'notes',       head: 'NOTES',                 px: 150, align: 'left',   kind: 'text',  input: true },
];
// Keys on an item that are one of those columns; anything else an admin added rides after Notes.
const BUILTIN_KEYS = new Set(['brand', 'model', 'trim', 'colour', 'color', 'year', 'accessories',
  'lead_time', 'fob_price', 'cif_price', 'notes']);

// The admin-added columns for these items, in the order the admin arranged them.
function extraColumns(items, settings) {
  const cfg = readConfig(settings, 'columns_config:rfq_items');
  const byKey = new Map(cfg.map(c => [c.key, c]));
  const shown = c => !c || (c.visible !== false && c.deleted !== true);
  const keys = [];
  const add = k => { if (!keys.includes(k)) keys.push(k); };
  // The grid on screen shows every visible configured field, filled or not: so does this.
  for (const c of cfg) if (c.builtin !== true && !BUILTIN_KEYS.has(c.key) && shown(c)) add(c.key);
  // Anything on a line that no configuration explains still travels with it.
  for (const it of items) {
    for (const k of Object.keys(it)) {
      if (BUILTIN_KEYS.has(k) || keys.includes(k) || !hasValue(it[k])) continue;
      if (shown(byKey.get(k))) add(k);
    }
  }
  return keys.map(k => {
    const c = byKey.get(k) || null;
    const w = c && parseInt(c.width, 10);
    return {
      key: k, extra: true, cfg: c, kind: 'extra',
      head: text((c && c.label) || humanise(k)).toUpperCase(),
      px: w >= 40 ? Math.min(240, Math.max(84, Math.round(w * 0.9))) : 120,
      align: c && c.type === 'number' ? 'right' : 'left',
    };
  });
}

// What a vehicle line puts in one grid column — a string, a number, a Date or '' — and the
// number format that goes with it.
function cellOf(it, c, i) {
  let v = '';
  if (c.kind === 'index') v = i + 1;
  else if (it) {
    if (c.key === 'accessories') v = text(it.accessories) || defaults.DOC_DEFAULT_ACCESSORIES;
    else if (c.key === 'colour') v = text(it.colour != null && it.colour !== '' ? it.colour : it.color);
    else if (c.kind === 'year') v = year(it.year);
    else if (c.kind === 'price') { const p = price(it[c.key]); v = p == null ? '' : p; }
    else if (c.kind === 'extra') { v = fieldValue(it[c.key], c.cfg); if (v == null) v = ''; }
    else v = text(it[c.key]);
  }
  let fmt;
  if (c.kind === 'price') fmt = PRICE_FMT;
  else if (c.kind === 'year' && typeof v === 'number') fmt = '0';
  else if (v instanceof Date) fmt = DATE_FMT;
  return { v, fmt };
}
// The text a number or date is shown as, for measuring it.
const shown = ({ v, fmt }) =>
  typeof v === 'number' ? (fmt === PRICE_FMT ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v))
    : v instanceof Date ? '30 Sep 2026' : String(v);
// Widen a column only as far as it takes for no word to be cut in half and no number to turn
// into "#####": the header's longest word, the longest unbreakable run in its cells, and
// numbers whole. Everything else wraps, and row heights are worked out from that.
function fitColumns(cols, cells) {
  cols.forEach((c, j) => {
    const pt = c.kind === 'price' ? 9.5 : (c.pt || 9);
    const bold = !!c.bold || (!!c.input && c.kind === 'price');
    let widest = tokenPx(c.head, 8.5, true);
    for (const row of cells) {
      const cell = row[j];
      widest = Math.max(widest, typeof cell.v === 'number' || cell.v instanceof Date
        ? bare(shown(cell), bold, pt) : tokenPx(cell.v, pt, bold));
    }
    const want = Math.ceil(widest + CELL_PAD + 4);
    if (want > c.px) c.px = Math.min(want, c.kind === 'extra' || c.kind === 'price' ? 320 : Math.round(c.px * 1.8));
  });
}

// ── The workbook ──────────────────────────────────────────────────────────────
const MIN_ITEM_ROWS = 4;
const GUTTER = 14;                                     // px, left and right of the form
const pt2px = pt => pt / 0.75;
const MAX_ROW_PT = 409;                                // Excel's row height limit is 409.5

// Vertical rhythm, in points.
const GAP = 6, BAR_PT = 20, KV_MIN = 22, ROW_MIN = 32, HEAD_MIN = 24;
const BANNER_ROWS = 3, BANNER_PT = 24;
const LOGO_W = 288, LOGO_PAD = 14;

async function buildRfqXlsx(rfq) {
  const r = rfq || {};
  const settings = r.settings && typeof r.settings === 'object' ? r.settings : {};
  const co = brand.company(settings);
  const items = (Array.isArray(r.items) ? r.items : []).filter(it => it && typeof it === 'object');
  const rfqNo = text(r.rfq_no);

  const cols = [...CORE_COLS, ...extraColumns(items, settings)];
  const FIRST = 2;                                     // column B; A is the gutter
  const LAST = FIRST + cols.length - 1;
  const colPx = c => (c < FIRST || c > LAST) ? GUTTER : cols[c - FIRST].px;
  const span = (c1, c2) => { let w = 0; for (let c = c1; c <= c2; c++) w += colPx(c); return w; };
  const colAt = key => FIRST + cols.findIndex(c => c.key === key);

  const nRows = Math.max(MIN_ITEM_ROWS, items.length);
  const cells = Array.from({ length: nRows }, (_, i) => cols.map(c => cellOf(items[i] || null, c, i)));
  fitColumns(cols, cells);

  const wb = new ExcelJS.Workbook();
  wb.creator = co.name;
  wb.lastModifiedBy = co.name;
  wb.company = co.name;
  wb.title = `Request for Quotation ${rfqNo}`.trim();
  wb.subject = text(r.supplier_name) ? `Request for Quotation — ${text(r.supplier_name)}` : 'Request for Quotation';
  wb.description = `Request for Quotation sent by ${co.name}. Please fill the highlighted cells and return this file.`;
  wb.category = 'RFQ';
  wb.created = wb.modified = new Date();

  const ws = wb.addWorksheet('RFQ', {
    views: [{ state: 'normal', showGridLines: false, zoomScale: 100 }],
    properties: { tabColor: { argb: K.green }, defaultRowHeight: 18 },
  });
  ws.getColumn(1).width = GUTTER / 7;
  cols.forEach((c, i) => { ws.getColumn(FIRST + i).width = Math.round(c.px / 7 * 100) / 100; });
  ws.getColumn(LAST + 1).width = GUTTER / 7;

  // ── helpers ──
  const heights = {};                                  // row → points
  const setH = (rr, pt) => { heights[rr] = Math.min(MAX_ROW_PT, Math.max(heights[rr] || 0, pt)); };
  const solid = a => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: a } });
  const line = (style, a) => ({ style, color: { argb: a } });
  // Paint a rectangle of cells (merged when it spans more than one) as one box: fill on
  // every cell, the outline only on the edge cells — which is how Excel, LibreOffice and
  // Google Sheets all agree to draw a merged cell's border.
  function box(r1, c1, r2, c2, o) {
    if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
    for (let rr = r1; rr <= r2; rr++) {
      for (let cc = c1; cc <= c2; cc++) {
        const cell = ws.getCell(rr, cc);
        if (o.fill) cell.fill = solid(o.fill);
        if (o.border) {
          const b = {};
          if (rr === r1) b.top = o.border;
          if (rr === r2) b.bottom = o.border;
          if (cc === c1) b.left = o.border;
          if (cc === c2) b.right = o.border;
          cell.border = b;
        }
      }
    }
    const m = ws.getCell(r1, c1);
    if (o.value !== undefined) m.value = o.value === '' ? null : o.value;      // blank stays truly empty
    if (o.numFmt) m.numFmt = o.numFmt;
    const dir = textDir(typeof o.value === 'string' ? o.value : '');
    m.font = { name: dir ? FONT_AR : FONT, size: o.pt || 9, bold: !!o.bold, color: { argb: o.color || K.text } };
    m.alignment = {
      horizontal: o.align || 'left', vertical: o.valign || 'middle', wrapText: o.wrap !== false && !o.shrink,
      ...(o.shrink ? { shrinkToFit: true } : {}),
      ...(o.indent ? { indent: o.indent } : {}),
      ...(dir ? { readingOrder: dir } : {}),
    };
    return m;
  }
  const need = (v, widthPx, pt, bold, pad = 6) =>
    typeof v === 'string' && v ? textHeight(countLines(v, widthPx, pt, bold), pt, pad, ARABIC_RE.test(v)) : 0;

  let row = 1;
  setH(row++, 4);                                      // top margin

  // ── Banner: reverse logo, title, ID / Date / Issuer ────────────────────────
  const bannerTop = row;
  for (let i = 0; i < BANNER_ROWS; i++) setH(row + i, BANNER_PT);
  const idLabel = LAST - 2;                            // label column of the ID block
  const idValue1 = LAST - 1;
  let titleFrom = FIRST;                               // first column clear of the logo
  for (let x = 0; titleFrom < idLabel - 1 && x < LOGO_PAD + LOGO_W + 14; titleFrom++) x += colPx(titleFrom);
  const titleTo = idLabel - 1;
  box(bannerTop, FIRST, bannerTop + 2, titleFrom - 1, { fill: K.ink });            // behind the logo
  box(bannerTop, titleFrom, bannerTop + 1, titleTo, {
    fill: K.ink, value: 'Request for Quotation', pt: 20, bold: true, color: K.paper, align: 'center', wrap: false });
  box(bannerTop + 2, titleFrom, bannerTop + 2, titleTo, {
    fill: K.ink, value: 'Please fill the highlighted cells and return this file.', pt: 9, color: K.lime, align: 'center', wrap: false });
  [['ID', rfqNo, null],
   ['DATE', r.rfq_date ? dateValue(r.rfq_date) : '', DATE_FMT],
   ['ISSUER', text(r.issuer), null]].forEach(([label, value, fmt], i) => {
    const rr = bannerTop + i;
    box(rr, idLabel, rr, idLabel, { fill: K.ink, value: label, pt: 8, bold: true, color: K.lime, indent: 1, wrap: false });
    box(rr, idValue1, rr, LAST, { fill: K.ink, value, numFmt: fmt || undefined, pt: 10, bold: true, color: K.paper, indent: 1, shrink: true });
  });
  row += BANNER_ROWS;
  setH(row, 4);                                        // brand-green rule under the banner
  box(row, FIRST, row, LAST, { fill: K.green });
  row++;
  setH(row++, GAP);

  // ── Section bars and label / value pairs ───────────────────────────────────
  const sectionBar = (title) => {
    setH(row, BAR_PT);
    box(row, FIRST, row, FIRST, { fill: K.green });
    box(row, FIRST + 1, row, LAST, { fill: K.ink, value: title, pt: 9.5, bold: true, color: K.paper, indent: 1, wrap: false });
    row++;
  };
  // A block of fields is two label/value pairs per line: the wide pair on the left (B–D
  // label, E–H value) and a narrower one on the right (I–J label, K… value).
  const L = { l1: FIRST, l2: FIRST + 2, v1: FIRST + 3, v2: colAt('accessories') };
  const R = { l1: colAt('lead_time'), l2: colAt('fob_price'), v1: colAt('fob_price') + 1, v2: LAST };
  const labelBox = (rr, c1, c2, label) =>
    box(rr, c1, rr, c2, { fill: K.mint100, border: line('thin', K.mint200), value: label, pt: 9, bold: true, color: K.ink, indent: 1 });
  const valueBox = (rr, c1, c2, v) => {
    box(rr, c1, rr, c2, { fill: K.paper, border: line('thin', K.mint200), value: v === '' ? null : v,
      numFmt: v instanceof Date ? DATE_FMT : undefined, pt: 10, indent: 1 });
    return need(v, span(c1, c2), 10, false, 8);
  };
  // fields: [[label, value], ...] — paired two to a line; an odd last one runs the full width.
  const fieldBlock = (fields, o = {}) => {
    for (let i = 0; i < fields.length; i += 2) {
      const a = fields[i], b = fields[i + 1];
      const rr = row++;
      let h = o.min || KV_MIN;
      labelBox(rr, L.l1, L.l2, a[0]);
      h = Math.max(h, need(a[0], span(L.l1, L.l2), 9, true, 8));          // a long label wraps too
      if (b) {
        h = Math.max(h, valueBox(rr, L.v1, L.v2, a[1]));
        labelBox(rr, R.l1, R.l2, b[0]);
        h = Math.max(h, need(b[0], span(R.l1, R.l2), 9, true, 8), valueBox(rr, R.v1, R.v2, b[1]));
      } else {
        h = Math.max(h, valueBox(rr, L.v1, LAST, a[1]));
      }
      setH(rr, h);
    }
  };

  sectionBar('SUPPLIER DETAILS');
  fieldBlock([
    ['Name', text(r.supplier_name)], ['Contact', text(r.supplier_contact)],
    ['Address', text(r.supplier_address)], ['Country of Origin', text(r.supplier_country)],
  ]);
  setH(row++, GAP);

  // ── The vehicle grid ───────────────────────────────────────────────────────
  const gridBar = row++;
  const firstInput = colAt('lead_time');
  const lastInput = colAt('notes');
  setH(gridBar, BAR_PT);
  box(gridBar, FIRST, gridBar, FIRST, { fill: K.green });
  box(gridBar, FIRST + 1, gridBar, firstInput - 1, { fill: K.ink, value: 'REQUESTED VEHICLES', pt: 9.5, bold: true, color: K.paper, indent: 1, wrap: false });
  box(gridBar, firstInput, gridBar, lastInput, { fill: K.greenDeep, value: 'TO BE COMPLETED BY THE SUPPLIER', pt: 9.5, bold: true, color: K.paper, align: 'center', wrap: false });
  if (LAST > lastInput) box(gridBar, lastInput + 1, gridBar, LAST, { fill: K.ink });

  const head = row++;
  let headNeed = HEAD_MIN;
  cols.forEach((c, i) => {
    box(head, FIRST + i, head, FIRST + i, { fill: K.ink, border: line('thin', K.ink), value: c.head, pt: 8.5, bold: true, color: K.paper, align: c.headAlign || c.align, indent: (c.headAlign || c.align) === 'center' ? 0 : 1 });
    headNeed = Math.max(headNeed, need(c.head, c.px, 8.5, true) + 4);
  });
  setH(head, headNeed);

  const gridFirst = row;
  for (let i = 0; i < nRows; i++, row++) {
    const zebra = i % 2 === 1;
    let h = ROW_MIN;
    cols.forEach((c, j) => {
      const pt = c.pt || 9;
      const { v, fmt } = cells[i][j];
      box(row, FIRST + j, row, FIRST + j, {
        fill: c.input ? K.mint100 : zebra ? K.mint50 : K.paper,
        border: line('thin', c.input ? K.green : K.mint200),
        value: v === '' ? null : v, numFmt: fmt, pt: c.kind === 'price' ? 9.5 : pt,
        bold: c.bold || (c.input && c.kind === 'price'),
        color: c.kind === 'index' ? K.muted : (c.bold || c.input) ? K.ink : K.text,
        align: c.align, indent: c.align === 'center' ? 0 : 1,
      });
      h = Math.max(h, need(v, c.px, pt, !!c.bold));
    });
    setH(row, h);
  }
  // Prices are numbers: a warning (not a wall) if somebody types words into the price cells.
  ws.dataValidations.add(`${ws.getColumn(colAt('fob_price')).letter}${gridFirst}:${ws.getColumn(colAt('cif_price')).letter}${row - 1}`, {
    type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
    showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Price',
    error: 'Please enter the price as a number, for example 17800. Words can go in Notes.',
  });
  setH(row++, GAP);

  // ── Payment terms ──────────────────────────────────────────────────────────
  sectionBar('PAYMENT TERMS');
  {
    const s = text(r.payment_terms) || defaults.DOC_DEFAULT_PAYMENT_TERMS;
    box(row, FIRST, row, LAST, { fill: K.mint50, border: line('thin', K.mint200), value: s, pt: 10, color: K.ink, indent: 1 });
    setH(row, Math.max(34, need(s, span(FIRST, LAST), 10, false, 8)));
    row++;
  }
  setH(row++, GAP);

  // ── Delivery terms ─────────────────────────────────────────────────────────
  sectionBar('DELIVERY TERMS');
  fieldBlock([
    ['Incoterm', text(r.incoterm) || 'FOB or CIF'], ['Delivery Location', text(r.delivery_location)],
    ['Service Provider', text(r.service_provider)], ['Contact', text(r.contact)],
  ]);
  fieldBlock([['Documents Required', text(r.documents_required) || defaults.DOC_DEFAULT_DOCUMENTS]], { min: 34 });

  // ── Document-level fields the admin added (the rfq_doc configuration) ──────
  {
    const cfg = readConfig(settings, 'columns_config:rfq_doc');
    const byKey = new Map(cfg.map(c => [c.key, c]));
    const hidden = k => { const c = byKey.get(k); return !!c && (c.visible === false || c.deleted === true); };
    const cf = r.custom_fields && typeof r.custom_fields === 'object' ? r.custom_fields : {};
    const keys = [];
    for (const c of cfg) if (c.builtin !== true && c.key !== 'status' && !hidden(c.key)) keys.push(c.key);
    for (const k of Object.keys(cf)) if (!keys.includes(k) && k !== 'status' && !hidden(k)) keys.push(k);
    const fields = keys
      .map(k => [text((byKey.get(k) || {}).label) || humanise(k), fieldValue(cf[k], byKey.get(k))])
      .filter(([, v]) => v != null && v !== '');
    if (fields.length) {
      setH(row++, GAP);
      sectionBar('ADDITIONAL DETAILS');
      fieldBlock(fields);
    }
  }
  setH(row++, GAP);

  // ── Company footer bar ─────────────────────────────────────────────────────
  {
    // Three blocks (office · contact · registration), cut at the nearest column edges.
    const total = span(FIRST, LAST);
    const cut = frac => {
      let best = FIRST, bestD = Infinity;
      for (let c = FIRST; c < LAST; c++) {
        const d = Math.abs(span(FIRST, c) - total * frac);
        if (d < bestD) { best = c; bestD = d; }
      }
      return best;
    };
    const a = cut(0.40), b = Math.max(a + 1, cut(0.72));
    const blocks = [
      [FIRST, a, 'OFFICE', co.address],
      [a + 1, b, 'CONTACT', [co.email, [co.website, co.phone].filter(Boolean).join('   ·   ')].filter(Boolean).join('\n')],
      [b + 1, LAST, 'REGISTRATION', `Tax ID  ${co.taxId}\nRegistration No  ${co.regNo}`],
    ];
    const labelRow = row, valueRow = row + 1;
    setH(labelRow, 17);
    let h = 26;
    for (const [c1, c2, label, body] of blocks) {
      box(labelRow, c1, labelRow, c2, { fill: K.ink, value: label, pt: 7.5, bold: true, color: K.lime, indent: 1, valign: 'bottom', wrap: false });
      box(valueRow, c1, valueRow, c2, { fill: K.ink, value: body, pt: 8.5, color: K.paper, indent: 1, valign: 'top' });
      h = Math.max(h, need(body, span(c1, c2), 8.5, false) + 4);
    }
    setH(valueRow, h);
    row += 2;
  }
  const lastRow = row - 1;
  setH(row++, 4);

  // ── Heights, the logo, page setup ──────────────────────────────────────────
  for (const [rr, pt] of Object.entries(heights)) ws.getRow(+rr).height = Math.round(pt * 4) / 4;

  // The logo is anchored to a cell with an offset and given an explicit size, so it keeps
  // its proportions (brand.LOGO_RATIO) whatever the viewer does to rows and columns.
  const logoH = Math.round(LOGO_W / brand.LOGO_RATIO * 100) / 100;
  const bannerPx = pt2px(BANNER_PT * BANNER_ROWS);
  const anchor = (xPx, yPx) => {
    let c = 1, x = xPx;
    while (c <= LAST + 1 && x >= colPx(c)) { x -= colPx(c); c++; }
    let rr = 1, y = yPx;
    while (rr < lastRow && y >= pt2px(heights[rr] || 18)) { y -= pt2px(heights[rr] || 18); rr++; }
    return { nativeCol: c - 1, nativeColOff: Math.round(x * 9525), nativeRow: rr - 1, nativeRowOff: Math.round(y * 9525) };
  };
  const imageId = wb.addImage({ buffer: brand.logoBuffer('reverse'), extension: 'png' });
  ws.addImage(imageId, {
    tl: anchor(GUTTER + LOGO_PAD, pt2px(heights[1]) + Math.max(0, (bannerPx - logoH) / 2)),
    ext: { width: LOGO_W, height: logoH }, editAs: 'oneCell',
  });

  // Print: A4 landscape, one page wide, the grid's bar and head on every page, page numbers.
  // (& is the header/footer escape character, and the whole string may not pass 255 characters.)
  const esc = (t, n) => String(t).slice(0, n).replace(/&/g, '&&');
  const FOOT = '&"Poppins,Regular"&8&K5C6F64';
  ws.headerFooter.oddFooter =
    `&L${FOOT}${esc(co.name, 36)}  ·  Request for Quotation${rfqNo ? ' ' + esc(rfqNo, 28) : ''}` +
    `&C${FOOT}${esc(co.note, 40)}` +
    `&R${FOOT}Page &P of &N`;
  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true, verticalCentered: false,
    margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.5, header: 0.25, footer: 0.25 },
    printArea: `A1:${ws.getColumn(LAST + 1).letter}${lastRow + 1}`,
    printTitlesRow: `${gridBar}:${head}`,
  };
  // The cursor starts in the first cell the supplier has to fill.
  ws.views = [{ state: 'normal', showGridLines: false, zoomScale: 100, activeCell: `${ws.getColumn(firstInput).letter}${gridFirst}` }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { XLSX_MIME, buildRfqXlsx };
