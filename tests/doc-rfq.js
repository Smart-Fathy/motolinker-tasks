// The RFQ workbook (src/lib/docs/rfq-xlsx.js) and the routes that hand it out.
//
// The RFQ is an Excel file the supplier fills in and sends back, so it is checked the way a
// spreadsheet is used: read back through exceljs (cells, merges, styles, page setup), the raw
// package opened to look at the XML and the picture, and converted by LibreOffice (when it is
// installed) to prove the file is valid and prints as meant. The last part boots the real app
// against a stubbed database and drives the export routes end to end — including who is
// refused, the old /pdf answer, and the client Drive folder.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3985';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');

const brand = require('../src/lib/docs/brand');
const defaults = require('../src/lib/docs/defaults');
const { buildRfqXlsx, XLSX_MIME } = require('../src/lib/docs/rfq-xlsx');
const fx = require('../tools/doc-fixtures/rfq');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const skip = (n, why) => console.log('  SKIP ' + n + '  (' + why + ')');
const VT = ExcelJS.ValueType;

// ── Reading a workbook back ───────────────────────────────────────────────────
async function load(buf) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; }
const sheetOf = wb => wb.getWorksheet('RFQ');
async function build(rfq) { const buf = await buildRfqXlsx(rfq); return { buf, wb: await load(buf) }; }
const textOf = v => v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

// Every cell of a sheet that holds something of its own (a merged range once, at its top-left).
function allCells(ws) {
  const out = [];
  ws.eachRow({ includeEmpty: true }, row => row.eachCell({ includeEmpty: true }, c => { if (c.master === c) out.push(c); }));
  return out;
}
// "AB12" → { col: 28, row: 12 }
const ref = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { col: [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0), row: +m[2] }; };
const mergeOf = (ws, cell) => {
  const m = ws.model.merges.map(r => { const [a, b] = r.split(':'); const p = ref(a), q = ref(b); return { top: p.row, left: p.col, bottom: q.row, right: q.col }; })
    .find(x => cell.row >= x.top && cell.row <= x.bottom && cell.col >= x.left && cell.col <= x.right);
  return m || { top: cell.row, left: cell.col, bottom: cell.row, right: cell.col };
};
// The nth cell whose text is exactly `label`.
function labelCell(ws, label, nth = 0) {
  const hits = allCells(ws).filter(c => c.type === VT.String && c.value === label);
  return hits[nth] || null;
}
// What sits to the right of a label (past the label's own merged width).
function valueAfter(ws, label, nth = 0) {
  const lc = labelCell(ws, label, nth);
  if (!lc) return undefined;
  return ws.getCell(lc.row, mergeOf(ws, lc).right + 1).value;
}
const HEADS = ['#', 'BRAND', 'MODEL', 'TRIM', 'COLOR EXT / INT', 'YEAR', 'ACCESSORIES / REMARKS', 'LEAD TIME', 'FOB PRICE', 'CIF PRICE (RoRo)', 'NOTES'];
// The vehicle grid: its header row, the column of each header, and the lines under it.
function grid(ws) {
  const first = labelCell(ws, 'BRAND');
  const headRow = first.row;
  const col = {};
  for (let c = 1; c <= ws.columnCount; c++) { const v = ws.getCell(headRow, c).value; if (v != null) col[String(v)] = c; }
  const lastCol = Math.max(...Object.values(col));
  const rows = [];
  for (let r = headRow + 1; ; r++) {
    const idx = ws.getCell(r, col['#']).value;
    if (typeof idx !== 'number') break;
    rows.push(r);
  }
  // A cell that is not there reads as an empty one, so a broken grid fails its checks rather than crashing the run.
  const none = { value: undefined, type: VT.Null, numFmt: undefined, fill: { fgColor: {} }, font: { color: {} }, alignment: {},
    border: { top: { color: {} }, bottom: { color: {} }, left: { color: {} }, right: { color: {} } } };
  return { headRow, col, lastCol, rows, at: (i, head) => (rows[i] && col[head]) ? ws.getCell(rows[i], col[head]) : none };
}

// ── The package itself ────────────────────────────────────────────────────────
// A small zip reader (central directory + inflate), so the XML can be looked at directly.
function unzip(buf) {
  const files = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    files[name] = method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const argb = hex => 'FF' + hex.slice(1).toUpperCase();
const PALETTE = new Set(Object.values(brand.COLORS).map(argb));

(async () => {
  // ═══ The standard RFQ ═══════════════════════════════════════════════════════
  const std = await build(fx.rfq);
  const ws = sheetOf(std.wb);
  const g = grid(ws);

  check('the file is an .xlsx package (a zip) of a sensible size', std.buf.slice(0, 2).toString() === 'PK' && std.buf.length > 20000, `${std.buf.length} bytes`);
  check('XLSX_MIME is the spreadsheet media type', XLSX_MIME === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  check('there is one sheet and it is called RFQ', std.wb.worksheets.length === 1 && ws && ws.name === 'RFQ');
  check('gridlines are off and nothing is frozen',
    ws.views[0].showGridLines === false && !ws.views[0].xSplit && !ws.views[0].ySplit && ws.views[0].state === 'normal');

  // ── Banner ──
  check('the title is "Request for Quotation"', !!labelCell(ws, 'Request for Quotation'));
  check('the instruction line asks for the highlighted cells back', !!labelCell(ws, 'Please fill the highlighted cells and return this file.'));
  check('the ID, date and issuer sit beside their labels',
    valueAfter(ws, 'ID') === 'MT26W216Y26' && valueAfter(ws, 'ISSUER') === 'Mohamed Yasser');
  const dateCell = ws.getCell(labelCell(ws, 'DATE').row, mergeOf(ws, labelCell(ws, 'DATE')).right + 1);
  check('the date is a real date (10 Sep 2026), shown unambiguously',
    dateCell.value instanceof Date && dateCell.value.toISOString().slice(0, 10) === '2026-09-10' && dateCell.numFmt === 'dd mmm yyyy', `${textOf(dateCell.value)} ${dateCell.numFmt}`);
  const titleCell = labelCell(ws, 'Request for Quotation');
  check('the banner is dark green with white type',
    titleCell.fill.fgColor.argb === argb(brand.COLORS.ink) && titleCell.font.color.argb === argb(brand.COLORS.paper) && titleCell.font.bold && titleCell.font.name === 'Poppins');

  // ── Supplier details ──
  check('Supplier Details: name, contact, address and country of origin',
    valueAfter(ws, 'Name') === 'PCH auto' && valueAfter(ws, 'Contact', 0) === 'Yoyo / +8613380783532'
    && /Baofa Company.*Guangdong Province/.test(valueAfter(ws, 'Address')) && valueAfter(ws, 'Country of Origin') === 'China');
  const sec = labelCell(ws, 'SUPPLIER DETAILS');
  check('a section bar is dark green with white capitals',
    sec.fill.fgColor.argb === argb(brand.COLORS.ink) && sec.font.color.argb === argb(brand.COLORS.paper) && sec.font.bold);
  const nameLabel = labelCell(ws, 'Name');
  const nameValue = ws.getCell(nameLabel.row, mergeOf(ws, nameLabel).right + 1);
  check('label cells are mint with dark-green bold type, value cells white',
    nameLabel.fill.fgColor.argb === argb(brand.COLORS.mint100) && nameLabel.font.color.argb === argb(brand.COLORS.ink) && nameLabel.font.bold
    && nameValue.fill.fgColor.argb === argb(brand.COLORS.paper));

  // ── The vehicle grid ──
  check('the grid headers, in order, carry every column of the form (and Notes)',
    JSON.stringify(HEADS.map(h => [h, g.col[h]]).sort((a, b) => a[1] - b[1]).map(x => x[0])) === JSON.stringify(HEADS)
    && HEADS.every((h, i) => g.col[h] === g.col['#'] + i), JSON.stringify(g.col));
  const head = ws.getCell(g.headRow, g.col.BRAND);
  check('the grid head is dark green with white type',
    head.fill.fgColor.argb === argb(brand.COLORS.ink) && head.font.color.argb === argb(brand.COLORS.paper) && head.font.bold);
  const want = fx.rfq.items;
  let cellsRight = true; const wrong = [];
  want.forEach((it, i) => {
    const got = { brand: g.at(i, 'BRAND').value, model: g.at(i, 'MODEL').value, trim: g.at(i, 'TRIM').value, colour: g.at(i, 'COLOR EXT / INT').value, year: g.at(i, 'YEAR').value, acc: g.at(i, 'ACCESSORIES / REMARKS').value };
    const exp = { brand: it.brand, model: it.model, trim: it.trim, colour: it.colour, year: Number(it.year), acc: it.accessories };
    for (const k of Object.keys(exp)) if (got[k] !== exp[k]) { cellsRight = false; wrong.push(`${i + 1}.${k}: ${got[k]} ≠ ${exp[k]}`); }
  });
  check('every line lands in the right columns (brand, model, trim, colour, year, accessories)', cellsRight, wrong.join(' | '));
  check('the year is a number, shown without a thousands separator', g.at(0, 'YEAR').type === VT.Number && g.at(0, 'YEAR').numFmt === '0');
  check('the lines are numbered', g.rows.every((r, i) => ws.getCell(r, g.col['#']).value === i + 1));
  check('there are at least four lines, even for four vehicles or fewer', g.rows.length === 4);
  check('zebra rows: odd lines white, even lines #F5F9F3',
    g.at(0, 'BRAND').fill.fgColor.argb === 'FFFFFFFF' && g.at(1, 'BRAND').fill.fgColor.argb === 'FFF5F9F3' && g.at(2, 'BRAND').fill.fgColor.argb === 'FFFFFFFF');
  const fontsUsed = new Set(allCells(ws).filter(c => c.value != null && c.value !== '').map(c => c.font.name));
  check('everything is set in Poppins (and nothing in a default font)', fontsUsed.size === 1 && fontsUsed.has('Poppins'), [...fontsUsed].join(','));
  check('long text cells wrap, and sit in the middle of their rows',
    ['ACCESSORIES / REMARKS', 'COLOR EXT / INT', 'NOTES'].every(h => g.at(0, h).alignment.wrapText === true && g.at(0, h).alignment.vertical === 'middle'));
  check('thin mint borders (#D8E9CE) on the data cells, no black',
    ['top', 'bottom', 'left', 'right'].every(s => g.at(1, 'MODEL').border[s] && g.at(1, 'MODEL').border[s].style === 'thin' && g.at(1, 'MODEL').border[s].color.argb === 'FFD8E9CE'));

  // ── The cells the supplier fills ──
  const inputs = ['LEAD TIME', 'FOB PRICE', 'CIF PRICE (RoRo)', 'NOTES'];
  check('lead time, FOB, CIF and notes are green-tinted, green-boxed input cells; the others are not',
    inputs.every(h => g.rows.every((_, i) => g.at(i, h).fill.fgColor.argb === argb(brand.COLORS.mint100) && g.at(i, h).border.left.color.argb === argb(brand.COLORS.green)))
    && ['BRAND', 'MODEL', 'TRIM', 'ACCESSORIES / REMARKS'].every(h => g.at(0, h).border.left.color.argb !== argb(brand.COLORS.green)));
  check('the price cells carry #,##0.00 and are right-aligned (blank until quoted)',
    ['FOB PRICE', 'CIF PRICE (RoRo)'].every(h => g.rows.every((_, i) => g.at(i, h).numFmt === '#,##0.00' && g.at(i, h).alignment.horizontal === 'right' && g.at(i, h).value == null)));
  check('an unquoted price stays empty (a 0 from the app is not printed as 0.00)', g.at(0, 'FOB PRICE').value == null && g.at(0, 'LEAD TIME').value == null);
  check('the header over the input cells names who fills them', !!labelCell(ws, 'TO BE COMPLETED BY THE SUPPLIER'));
  check('the cursor starts in the first cell to fill', ws.views[0].activeCell === `${ws.getColumn(g.col['LEAD TIME']).letter}${g.rows[0]}`, ws.views[0].activeCell);

  // ── Terms ──
  const answered = await build(fx.rfqAnswered);
  const wa = sheetOf(answered.wb), ga = grid(wa);
  const quoted = fx.rfqAnswered.items.every((it, i) => ga.at(i, 'FOB PRICE').value === it.fob_price && ga.at(i, 'CIF PRICE (RoRo)').value === it.cif_price
    && ga.at(i, 'LEAD TIME').value === it.lead_time && ga.at(i, 'FOB PRICE').type === VT.Number);
  check('an answered RFQ shows lead time as text and FOB / CIF as numbers', quoted);
  check('a note from the sheet comes through', ga.at(2, 'NOTES').value === 'Price valid until 30 Oct 2026');
  const payCell = allCells(wa).find(c => c.value === fx.rfqAnswered.payment_terms);
  check('Payment Terms keep the text as written, across the whole width, wrapped',
    !!payCell && mergeOf(wa, payCell).left === 2 && mergeOf(wa, payCell).right === ga.lastCol && payCell.alignment.wrapText === true);
  check('Delivery Terms: Incoterm "FOB or CIF", and the location, provider and contact filled in',
    valueAfter(wa, 'Incoterm') === 'FOB or CIF' && valueAfter(wa, 'Delivery Location') === 'Alexandria Port'
    && valueAfter(wa, 'Service Provider') === 'Sino Trans Logistics' && valueAfter(wa, 'Contact', 1) === 'Ahmed Ali / +20 100 555 0199');
  check('Documents Required keeps its text', valueAfter(wa, 'Documents Required') === fx.rfqAnswered.documents_required);

  // ── Blank and default wording ──
  const blank = await build(fx.rfqBlank);
  const wbk = sheetOf(blank.wb), gb = grid(wbk);
  check('a blank RFQ opens: four empty lines ready to be filled', gb.rows.length === 4 && gb.rows.every((_, i) => ['BRAND', 'MODEL', 'TRIM', 'ACCESSORIES / REMARKS', 'LEAD TIME', 'FOB PRICE'].every(h => gb.at(i, h).value == null)));
  check('blank payment terms and documents fall back to the standard wording',
    allCells(wbk).some(c => c.value === defaults.DOC_DEFAULT_PAYMENT_TERMS) && valueAfter(wbk, 'Documents Required') === defaults.DOC_DEFAULT_DOCUMENTS);
  check('the blank supplier fields are empty cells, not text like "undefined"',
    valueAfter(wbk, 'Name') == null && valueAfter(wbk, 'Address') == null && !allCells(wbk).some(c => /undefined|null|NaN/.test(textOf(c.value))));
  check('a line with no accessories gets the standard accessories text',
    (await build({ items: [{ brand: 'BYD', model: 'Seal' }] }).then(r => grid(sheetOf(r.wb)).at(0, 'ACCESSORIES / REMARKS').value)) === defaults.DOC_DEFAULT_ACCESSORIES);
  check('the standard wording comes from defaults.js, not a copy', /30% deposit/.test(defaults.DOC_DEFAULT_PAYMENT_TERMS) && /MSDS/.test(defaults.DOC_DEFAULT_DOCUMENTS));

  // ── Line counts ──
  const seven = await build({ items: Array.from({ length: 7 }, (_, i) => ({ brand: 'B' + i, model: 'M' })) });
  check('seven vehicles give seven lines — no padding beyond the four minimum', grid(sheetOf(seven.wb)).rows.length === 7);
  const none = await build({ items: [] });
  check('no vehicles at all still gives four lines', grid(sheetOf(none.wb)).rows.length === 4);
  const one = await build({ items: [{ brand: 'Kia', model: 'EV6' }] });
  const g1 = grid(sheetOf(one.wb));
  check('one vehicle fills the first line and leaves three blank', g1.at(0, 'BRAND').value === 'Kia' && g1.at(1, 'BRAND').value == null && g1.rows.length === 4);

  // ── Numbers and years ──
  const nums = await build({ items: [
    { brand: 'a', fob_price: '17,800.5', cif_price: 'TBD', year: '2026/2027' },
    { brand: 'b', fob_price: 0, cif_price: '  2500 ', year: 'MY27' },
    { brand: 'c', fob_price: -5, cif_price: null, year: 1999 },
    { brand: 'd', year: '2027' }] });
  const gn = grid(sheetOf(nums.wb));
  check('a price typed as "17,800.5" becomes the number 17800.5; words like "TBD" stay as typed',
    gn.at(0, 'FOB PRICE').value === 17800.5 && gn.at(0, 'CIF PRICE (RoRo)').value === 'TBD' && gn.at(1, 'CIF PRICE (RoRo)').value === 2500);
  check('a 0 or blank price is an empty cell', gn.at(1, 'FOB PRICE').value == null && gn.at(2, 'CIF PRICE (RoRo)').value == null);
  check('a year is a number when it is a year and text when it is not',
    gn.at(0, 'YEAR').value === '2026/2027' && gn.at(1, 'YEAR').value === 'MY27' && gn.at(2, 'YEAR').value === 1999 && gn.at(3, 'YEAR').value === 2027);
  check('the text year is not cut in half: its column is as wide as it needs', sheetOf(nums.wb).getColumn(gn.col.YEAR).width * 7 >= 64);

  // ── Extra columns, document fields and settings ──
  const ex = await build(fx.rfqExtras);
  const wx = sheetOf(ex.wb), gx = grid(wx);
  const afterNotes = Object.keys(gx.col).filter(h => gx.col[h] > gx.col.NOTES).sort((a, b) => gx.col[a] - gx.col[b]);
  check('the admin\'s columns follow Notes, headed by their configured names, retired ones left out',
    JSON.stringify(afterNotes) === JSON.stringify(['BATTERY (KWH)', 'STEERING', 'SPEC SHEET']), JSON.stringify(afterNotes));
  check('their values come through: a number is numeric, a dropdown shows its label, a link is text',
    gx.at(0, 'BATTERY (KWH)').value === 82.5 && gx.at(0, 'BATTERY (KWH)').type === VT.Number && gx.at(0, 'STEERING').value === 'Left-hand drive'
    && gx.at(1, 'STEERING').value === 'Right-hand drive' && gx.at(0, 'SPEC SHEET').value === 'https://example.com/specs/s07.pdf' && gx.at(0, 'SPEC SHEET').type === VT.String);
  check('a hidden column\'s data does not leak into the sheet', !allCells(wx).some(c => c.value === 'not shown'));
  const bare = await build({ items: [{ brand: 'Kia', cf_insurance_status: 'Pending', cf_battery_2: '60' }], settings: {} });
  const gbare = grid(sheetOf(bare.wb));
  check('with no configuration, an extra key is headed by its name made readable',
    gbare.col['INSURANCE STATUS'] > gbare.col.NOTES && gbare.col['BATTERY 2'] > gbare.col['INSURANCE STATUS'] && gbare.at(0, 'INSURANCE STATUS').value === 'Pending');
  const configured = await build({ items: [{ brand: 'Kia' }], settings: { 'columns_config:rfq_items': JSON.stringify([{ key: 'cf_colour_code', label: 'Paint code', type: 'text', builtin: false, visible: true }]) } });
  check('a visible configured column appears even before it has data (the grid on screen shows it)', grid(sheetOf(configured.wb)).col['PAINT CODE'] > 0);
  check('a configured column that is switched off does not',
    !(await build({ items: [{ brand: 'Kia', cf_x: 'y' }], settings: { 'columns_config:rfq_items': JSON.stringify([{ key: 'cf_x', label: 'X', type: 'text', builtin: false, visible: false }]) } }).then(r => grid(sheetOf(r.wb)).col.X)));
  check('the banner and bars still span the form when columns are added',
    mergeOf(wx, labelCell(wx, 'SUPPLIER DETAILS')).right === gx.lastCol && mergeOf(wx, labelCell(wx, 'ADDITIONAL DETAILS')).right === gx.lastCol);
  check('document-level fields come under Additional Details with their configured labels and option names',
    valueAfter(wx, 'Priority') === 'Urgent — reply within 48 h' && valueAfter(wx, 'Project') === 'Q4 fleet order' && valueAfter(wx, 'Removed') === 'kept as text');
  check('there is no Additional Details block when there are no extra fields', !labelCell(ws, 'ADDITIONAL DETAILS'));
  const typed = await build({
    items: [{ brand: 'Kia', cf_insured: true, cf_start: '2026-11-03', cf_seats: '7', cf_notes_link: 'https://x.example/a' }],
    custom_fields: { cf_urgent: 'true', cf_due: '2026-12-01', cf_budget: '250000.5', cf_off: false,
      cf_long: 'x' },
    settings: {
      'columns_config:rfq_items': JSON.stringify([
        { key: 'cf_insured', label: 'Insured', type: 'checkbox', builtin: false, visible: true },
        { key: 'cf_start', label: 'Start', type: 'date', builtin: false, visible: true },
        { key: 'cf_seats', label: 'Seats', type: 'number', builtin: false, visible: true }]),
      'columns_config:rfq_doc': JSON.stringify([
        { key: 'cf_urgent', label: 'Urgent', type: 'checkbox', builtin: false, visible: true },
        { key: 'cf_due', label: 'Due', type: 'date', builtin: false, visible: true },
        { key: 'cf_budget', label: 'Budget', type: 'number', builtin: false, visible: true },
        { key: 'cf_off', label: 'Off', type: 'checkbox', builtin: false, visible: true },
        { key: 'cf_long', label: 'Estimated delivery window after the order is confirmed by both sides and the deposit has cleared', type: 'text', builtin: false, visible: true }]),
    } });
  const wt = sheetOf(typed.wb), gt = grid(wt);
  check('item fields keep their type: a checkbox reads Yes, a date is a date, a number is a number',
    gt.at(0, 'INSURED').value === 'Yes' && gt.at(0, 'START').value instanceof Date && gt.at(0, 'START').numFmt === 'dd mmm yyyy' && gt.at(0, 'SEATS').value === 7 && gt.at(0, 'SEATS').alignment.horizontal === 'right');
  check('document fields too (a switched-off checkbox is left out)',
    valueAfter(wt, 'Urgent') === 'Yes' && valueAfter(wt, 'Due') instanceof Date && valueAfter(wt, 'Budget') === 250000.5 && !labelCell(wt, 'Off'));
  const longLabelCell = labelCell(wt, 'Estimated delivery window after the order is confirmed by both sides and the deposit has cleared');
  check('a long field label is given a row tall enough to wrap in', !!longLabelCell && wt.getRow(longLabelCell.row).height >= 40, longLabelCell && String(wt.getRow(longLabelCell.row).height));
  check('a long column title wraps in its header instead of being cut',
    (await build({ items: [{ brand: 'x', cf_w: '1' }], settings: { 'columns_config:rfq_items': JSON.stringify([{ key: 'cf_w', label: 'Warranty period offered by the manufacturer in months', type: 'text', builtin: false, visible: true }]) } })
      .then(r => { const w = sheetOf(r.wb), gg = grid(w); return w.getRow(gg.headRow).height >= 38; })));
  const footerText = allCells(wx).map(c => textOf(c.value)).join('\n');
  check('the company details come from settings: address, e-mail, website, phone, tax id, registration',
    ['Unit 12, Nile Business Park, New Cairo', 'rfq@motolinkers.example', 'www.motolinkers.example', '+20 2 555 0100', '111222333', '98765'].every(t => footerText.includes(t))
    && !/Heliopolis|info@motolinkers\.com|773934006/.test(footerText));
  const stdText = allCells(ws).map(c => textOf(c.value)).join('\n');
  check('without settings the footer carries the registered details',
    /Heliopolis/.test(stdText) && /info@motolinkers\.com/.test(stdText) && /www\.motolinkers\.com/.test(stdText) && /773934006/.test(stdText) && /282378/.test(stdText) && /\+2 010 000 78104/.test(stdText));
  check('the company name and note from settings reach the printed footer',
    /Motolinkers Trading/.test(wx.headerFooter.oddFooter) && /Prices are confidential/.test(wx.headerFooter.oddFooter));
  check('properties: the title carries the RFQ number and the creator is the company',
    ex.wb.title === 'Request for Quotation MT42W318Y26' && ex.wb.creator === 'Motolinkers Trading' && ex.wb.company === 'Motolinkers Trading'
    && std.wb.title === 'Request for Quotation MT26W216Y26' && std.wb.creator === 'Motolinkers');

  // ═══ Text is data ═══════════════════════════════════════════════════════════
  const hostile = await build(fx.rfqHostile);
  const wh = sheetOf(hostile.wb), gh = grid(wh);
  const looksLike = [
    ['=HYPERLINK("http://evil.example","click")', valueAfter(wh, 'Contact', 0)], ['+SUM(1,1)', gh.at(0, 'BRAND').value], ['@cmd', gh.at(0, 'MODEL').value],
    ['-2+3', gh.at(0, 'TRIM').value], ['=1+1', gh.at(0, 'COLOR EXT / INT').value], ['<b>Zone 5</b>, "Free" Zone & Port', valueAfter(wh, 'Address')],
  ];
  check('text that looks like a formula or markup comes back exactly as typed',
    looksLike.every(([a, b]) => a === b), looksLike.filter(([a, b]) => a !== b).map(([a, b]) => `${a} → ${b}`).join(' | '));
  const nonText = allCells(wh).filter(c => c.type === VT.Formula || (c.value && typeof c.value === 'object' && !(c.value instanceof Date)));
  check('no cell in the workbook is a formula (or any other object)', nonText.length === 0, nonText.map(c => c.address).join(','));
  const hostileParts = unzip(hostile.buf);
  const sheetXml = hostileParts['xl/worksheets/sheet1.xml'].toString('utf8');
  check('the raw sheet XML has no <f> formula element and no formula-typed cell', !/<f[ >]/.test(sheetXml) && !/ t="str"/.test(sheetXml));
  const shared = hostileParts['xl/sharedStrings.xml'].toString('utf8');
  check('the hostile text is stored as escaped text (shared strings), not as markup',
    shared.includes('=HYPERLINK(&quot;http://evil.example&quot;,&quot;click&quot;)') && shared.includes('&lt;b&gt;Zone 5&lt;/b&gt;') && !/<b>Zone/.test(shared));

  const arabic = 'شركة النيل للسيارات';
  check('an Arabic supplier name is stored as UTF-8 and reads back intact', valueAfter(wh, 'Name') === arabic && shared.includes(arabic));
  const valueCellOf = (w, label) => w.getCell(labelCell(w, label).row, mergeOf(w, labelCell(w, label)).right + 1);
  const arCell = valueCellOf(wh, 'Name');
  check('…its cell reads right-to-left and uses the Arabic typeface', arCell.alignment.readingOrder === 'rtl' && arCell.font.name === 'Cairo', JSON.stringify(arCell.alignment));
  check('…while English cells keep the default direction and Poppins',
    valueCellOf(wh, 'Country of Origin').alignment.readingOrder === undefined && valueCellOf(wh, 'Country of Origin').font.name === 'Poppins');
  const mixed = await build({ supplier_name: 'Nile Motors — شركة النيل', items: [] });
  const mixedCell = valueCellOf(sheetOf(mixed.wb), 'Name');
  check('a name that starts in English and has some Arabic in it reads left-to-right', mixedCell.alignment.readingOrder === 'ltr' && mixedCell.value === 'Nile Motors — شركة النيل');
  check('hostile text sits in the ordinary, mint-bordered cells (nothing is lost, nothing is cut off)', gh.rows.length === 4 && /Zone 5/.test(valueAfter(wh, 'Address')));

  const nasty = await build({ supplier_name: 'A\u0000B\u0008C\u001fD\uFFFEE\uFFFF', supplier_address: 'x'.repeat(40000), supplier_contact: 'l1\r\nl2\rl3', items: [{ brand: 'Z'.repeat(300), model: '\u202eRTL override', accessories: 'word '.repeat(2000) }] });
  const wn = sheetOf(nasty.wb), gnst = grid(wn);
  check('control characters and XML non-characters are removed (they would make the file unreadable)', valueAfter(wn, 'Name') === 'ABCDE');
  check('a 40,000-character value is cut to what a cell can hold', textOf(valueAfter(wn, 'Address')).length <= 32767 && textOf(valueAfter(wn, 'Address')).length > 30000);
  check('line breaks are normalised to \\n', valueAfter(wn, 'Contact', 0) === 'l1\nl2\nl3');
  let tallest = 0; wn.eachRow(r => { tallest = Math.max(tallest, r.height || 0); });
  check('even absurd text never asks for a row taller than Excel\'s 409.5-point limit', tallest > 0 && tallest <= 409.5, String(tallest));
  check('a very long unbroken word still fits the cell it is in (the row is made tall enough, not clipped)', wn.getRow(gnst.rows[0]).height > 60);

  // ── Robustness ──
  const odd = [undefined, null, {}, { items: 'nope' }, { items: [null, 5, 'x', {}] }, { settings: null }, { settings: 'x' }, { custom_fields: 'x' }, { rfq_date: 'not a date', items: [{ year: {}, brand: [] }] }];
  let oddOk = true; let oddWhy = '';
  for (const o of odd) { try { const b = await buildRfqXlsx(o); const w = await load(b); if (!sheetOf(w)) throw new Error('no sheet'); } catch (e) { oddOk = false; oddWhy += ` ${JSON.stringify(o)} → ${e.message}`; } }
  check('missing, null and malformed input still produces a workbook', oddOk, oddWhy);
  const badCfg = await build({ items: [{ brand: 'x', cf_a: '1' }], settings: { 'columns_config:rfq_items': '{not json', 'columns_config:rfq_doc': '[1,null,"x"]' } });
  check('a broken column configuration is ignored, not fatal', grid(sheetOf(badCfg.wb)).col['A'] > 0);
  const dated = await build({ rfq_date: '2026-09-10T22:30:00.000Z', items: [] });
  check('a timestamp keeps its date part, not a day earlier or later',
    textOf(valueAfter(sheetOf(dated.wb), 'DATE')) === '2026-09-10');
  const badDate = await build({ rfq_date: '31/02/2026', items: [] });
  check('a date that is not a date stays as typed', valueAfter(sheetOf(badDate.wb), 'DATE') === '31/02/2026');
  // The server's time zone must not move a date by a day.
  const tz0 = process.env.TZ;
  const slid = [];
  for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Kolkata']) {
    process.env.TZ = tz;
    const d = await build({ rfq_date: '2026-09-10', items: [] });
    const got = valueAfter(sheetOf(d.wb), 'DATE');
    if (!(got instanceof Date) || got.getTime() !== Date.UTC(2026, 8, 10)) slid.push(`${tz}: ${textOf(got)}`);
  }
  if (tz0 === undefined) delete process.env.TZ; else process.env.TZ = tz0;
  check('the date is the same day whatever time zone the server runs in', slid.length === 0, slid.join(' | '));

  // ═══ The look: colours, picture, heights ════════════════════════════════════
  const styles = unzip(std.buf)['xl/styles.xml'].toString('utf8');
  const used = new Set((styles.match(/rgb="[0-9A-Fa-f]{8}"/g) || []).map(s => s.slice(5, 13).toUpperCase()));
  const strangers = [...used].filter(c => !PALETTE.has(c));
  check('every colour in the file is from the brand palette (no yellow, gold, navy or black)', used.size >= 6 && strangers.length === 0, strangers.join(',') || `${used.size} colours`);
  const exStyles = unzip(ex.buf)['xl/styles.xml'].toString('utf8');
  check('…also with extra columns and a configuration', [...new Set((exStyles.match(/rgb="[0-9A-Fa-f]{8}"/g) || []).map(s => s.slice(5, 13).toUpperCase()))].every(c => PALETTE.has(c)));

  const parts = unzip(std.buf);
  const media = Object.keys(parts).filter(n => n.startsWith('xl/media/') && !n.endsWith('/'));
  check('the logo is embedded exactly once', media.length === 1 && ws.getImages().length === 1, media.join(','));
  check('…and it is the reverse logo (white wordmark, light-green mark), byte for byte', media.length === 1 && parts[media[0]].equals(brand.logoBuffer('reverse')));
  const drawing = parts['xl/drawings/drawing1.xml'].toString('utf8');
  const ext = /<xdr:ext cx="(\d+)" cy="(\d+)"/.exec(drawing);
  check('the picture is anchored to a cell and sized in pixels, so it cannot stretch with the cells',
    /<xdr:oneCellAnchor/.test(drawing) && !/<xdr:twoCellAnchor/.test(drawing) && !!ext && (drawing.match(/<xdr:pic>/g) || []).length === 1);
  check('…and it keeps the logo\'s proportions (' + brand.LOGO_RATIO.toFixed(3) + ':1)', !!ext && Math.abs(ext[1] / ext[2] / brand.LOGO_RATIO - 1) < 0.005, ext && (ext[1] / ext[2]).toFixed(3));
  check('…at a size that sits inside the banner (under 300px wide, 40–60px tall)', !!ext && ext[1] / 9525 <= 300 && ext[2] / 9525 >= 40 && ext[2] / 9525 <= 60, ext && `${ext[1] / 9525}×${(ext[2] / 9525).toFixed(1)}px`);
  const img = ws.getImages()[0];
  const bannerTop = labelCell(ws, 'Request for Quotation').row;
  check('…starting inside the banner (left of the title, over the dark band)', img.range.tl.nativeCol === 1 && img.range.tl.nativeRow >= 1 && img.range.tl.nativeRow <= bannerTop);
  const heightsOk = (() => { let ok = true; ws.eachRow({ includeEmpty: true }, (r, n) => { if (!(r.height > 0)) ok = false; }); return ok; })();
  check('every row has an explicit height (Excel does not size wrapped rows written by a library)', heightsOk);
  const accRow = ws.getRow(g.rows[0]).height, blankRow = wbk.getRow(gb.rows[0]).height;
  check('a line whose accessories wrap to two lines is taller than an empty one', accRow > blankRow && blankRow >= 30, `${accRow} vs ${blankRow}`);
  // The accessories text must wrap in two or three lines at its column width — that is what the width was chosen for.
  const accW = ws.getColumn(g.col['ACCESSORIES / REMARKS']).width * 7;
  check('the accessories column is wide enough for the standard text in two or three lines', accW >= 260 && accW <= 340, `${accW}px`);
  check('a long list gets taller rows only where text needs them (blank lines stay compact)',
    gb.rows.every(r => wbk.getRow(r).height <= 36), gb.rows.map(r => wbk.getRow(r).height).join(','));

  // ═══ Printing ═══════════════════════════════════════════════════════════════
  const ps = ws.pageSetup;
  check('page setup: A4, landscape, one page wide (as many tall as needed), centred',
    ps.paperSize === 9 && ps.orientation === 'landscape' && ps.fitToPage === true && ps.fitToWidth === 1 && ps.fitToHeight === 0 && ps.horizontalCentered === true,
    JSON.stringify({ p: ps.paperSize, o: ps.orientation, f: ps.fitToPage, w: ps.fitToWidth, h: ps.fitToHeight }));
  const lastRow = Math.max(...allCells(ws).map(c => c.row));
  check('the print area covers the whole form, gutters included', ps.printArea === `A1:${ws.getColumn(ws.columnCount + 1).letter}${lastRow + 1}`, ps.printArea);
  check('the grid\'s bar and header row repeat on every printed page', ps.printTitlesRow === `${g.headRow - 1}:${g.headRow}`, ps.printTitlesRow);
  check('sensible margins: a half-inch or less at the sides, room for the footer below',
    ps.margins.left <= 0.5 && ps.margins.right <= 0.5 && ps.margins.bottom >= ps.margins.footer + 0.2 && ps.margins.top >= 0.3);
  check('the printed footer has the page number, the company and the RFQ number',
    /Page &P of &N/.test(ws.headerFooter.oddFooter) && /Motolinkers/.test(ws.headerFooter.oddFooter) && /MT26W216Y26/.test(ws.headerFooter.oddFooter));
  const amp = await build({ rfq_no: 'A&B-1', settings: { company_name: 'Smith & Sons' } });
  check('an & in the footer text is escaped, as header/footer codes need', /Smith && Sons/.test(sheetOf(amp.wb).headerFooter.oddFooter) && /A&&B-1/.test(sheetOf(amp.wb).headerFooter.oddFooter));
  check('the footer string stays under Excel\'s 255-character limit even with long names',
    (await build({ rfq_no: 'N'.repeat(200), settings: { company_name: 'C'.repeat(200), footer_note: 'F'.repeat(200) } }).then(r => sheetOf(r.wb).headerFooter.oddFooter.length)) < 255);
  const longList = await build({ ...fx.rfqLong, items: Array.from({ length: 60 }, (_, i) => ({ brand: 'B' + i, model: 'M' + i, trim: 'T', year: '2027' })) });
  const wl = sheetOf(longList.wb), gl = grid(wl);
  check('a 60-line list keeps the repeating header and a print area that reaches the last line',
    wl.pageSetup.printTitlesRow === `${gl.headRow - 1}:${gl.headRow}` && gl.rows.length === 60 && /\d+$/.exec(wl.pageSetup.printArea)[0] > gl.rows[59]);
  const rawNames = unzip(std.buf)['xl/workbook.xml'].toString('utf8');
  check('the package names the print titles and the print area', /_xlnm\.Print_Titles/.test(rawNames) && /_xlnm\.Print_Area/.test(rawNames));
  const price = unzip(std.buf)['xl/worksheets/sheet1.xml'].toString('utf8');
  check('a price typed as words gets a warning (a decimal ≥ 0 rule on the price cells), not a wall',
    /<dataValidation type="decimal" operator="greaterThanOrEqual"[^>]*errorStyle="warning"[^>]*sqref="[A-Z]+\d+:[A-Z]+\d+"/.test(price));

  // ═══ LibreOffice: a valid file that prints the way it is meant to ═══════════
  const soffice = spawnSync('which', ['soffice']).status === 0;
  if (!soffice) {
    skip('LibreOffice opens and prints the workbooks (validity, page count, repeated header)', 'soffice is not installed — install LibreOffice to run this check');
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-lo-'));
    const files = { rfq: fx.rfq, rfqAnswered: fx.rfqAnswered, rfqLong: fx.rfqLong, rfqBlank: fx.rfqBlank, rfqHostile: fx.rfqHostile, rfqExtras: fx.rfqExtras };
    for (const [n, d] of Object.entries(files)) fs.writeFileSync(path.join(tmp, n + '.xlsx'), await buildRfqXlsx(d));
    const r = spawnSync('soffice', ['--headless', `-env:UserInstallation=file://${tmp}/profile`, '--convert-to', 'pdf', '--outdir', tmp,
      ...Object.keys(files).map(n => path.join(tmp, n + '.xlsx'))], { encoding: 'utf8', timeout: 180000 });
    const pdfs = Object.fromEntries(Object.keys(files).map(n => [n, path.join(tmp, n + '.pdf')]));
    const made = Object.entries(pdfs).filter(([, p]) => fs.existsSync(p) && fs.readFileSync(p).slice(0, 5).toString() === '%PDF-').map(([n]) => n);
    check('LibreOffice converts every sample workbook to a PDF without error', r.status === 0 && made.length === Object.keys(files).length, `${made.length}/${Object.keys(files).length} ${(r.stderr || '').trim().slice(0, 120)}`);
    const pagesOf = p => { const m = /Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [p], { encoding: 'utf8' }).stdout || ''); return m ? +m[1] : (fs.readFileSync(p).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; };
    if (made.includes('rfq')) {
      check('a four-vehicle RFQ prints on one A4 landscape page', pagesOf(pdfs.rfq) === 1 && pagesOf(pdfs.rfqAnswered) === 1 && pagesOf(pdfs.rfqBlank) === 1, `${pagesOf(pdfs.rfq)} page(s)`);
      const info = spawnSync('pdfinfo', [pdfs.rfq], { encoding: 'utf8' }).stdout || '';
      const sz = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
      check('…which is A4 landscape (842 × 595 pt)', !sz || (Math.round(sz[1]) === 842 && Math.round(sz[2]) === 595), sz ? `${sz[1]} × ${sz[2]}` : 'no pdfinfo');
    }
    if (made.includes('rfqLong')) {
      const n = pagesOf(pdfs.rfqLong);
      check('a 24-vehicle RFQ runs onto a second page', n >= 2, `${n} pages`);
      if (spawnSync('which', ['pdftotext']).status === 0) {
        const page = k => (spawnSync('pdftotext', ['-f', String(k), '-l', String(k), '-layout', pdfs.rfqLong, '-'], { encoding: 'utf8' }).stdout || '');
        const p1 = page(1), p2 = page(2);
        check('…and the grid header repeats at the top of that page', /CIF PRICE/.test(p1) && /CIF PRICE/.test(p2) && /BRAND/.test(p2) && /LEAD TIME/.test(p2));
        check('…while the terms and the company bar follow the last line', /PAYMENT TERMS/.test(p2) && /REGISTRATION/.test(p2) && !/PAYMENT TERMS/.test(p1));
        check('the printed footer shows "Page 1 of 2" and the RFQ number', /Page 1 of 2/.test(p1) && /Page 2 of 2/.test(p2) && /MT26W216Y26/.test(p1));
      } else skip('page text checks of the long list', 'pdftotext is not installed');
    }
    if (made.includes('rfqHostile') && spawnSync('which', ['pdftotext']).status === 0) {
      const t = spawnSync('pdftotext', ['-layout', pdfs.rfqHostile, '-'], { encoding: 'utf8' }).stdout || '';
      check('LibreOffice prints the formula-looking text as text', t.includes('=HYPERLINK') && t.includes('+SUM(1,1)') && t.includes('@cmd') && t.includes('<b>Zone 5</b>'));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ═══ The routes, end to end, against the real app ═══════════════════════════
  await routes();

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// ─────────────────────────────────────────────────────────────────────────────
// A stubbed Supabase: just the tables the RFQ routes touch. Everything else answers
// with an empty list, which is all the boot sequence needs.
const SAVED = {
  id: 7, rfq_no: 'MT30W777Y26', rfq_date: '2026-08-20', issuer: 'Sara', status: 'sent', customer_id: 5,
  supplier_name: 'Saved Supplier Co', supplier_contact: 'Li / +86 21 555', supplier_address: 'Pudong, Shanghai', supplier_country: 'China',
  items: [{ brand: 'Zeekr', model: '001', trim: 'You', colour: 'EXT: Grey INT: Black', year: '2027', accessories: 'Floor mats', lead_time: '20 days', fob_price: 31000, cif_price: 32500, cf_battery_kwh: '100' }],
  payment_terms: 'Saved terms: 30% now', delivery_location: 'Sokhna', service_provider: 'Maersk', contact: 'Omar', documents_required: 'B/L', custom_fields: {},
};
const SETTINGS_ROWS = [{ key: 'company_email', value: 'stubbed@motolinkers.example' }, { key: 'company_reg_no', value: '555000' },
  { key: 'columns_config:rfq_items', value: JSON.stringify([{ key: 'cf_battery_kwh', label: 'Battery (kWh)', type: 'number', builtin: false, visible: true }]) }];
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
      if (table === 'rfqs') {
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

  const { token: admin } = await (await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();
  const mint = (token, permissions) => {
    ctx.employeeSessions.set(token, { id: 7, name: 'Test', username: 'test', job_title: 'Sales', permissions: normEmpPerms(permissions) });
    return token;
  };
  const exporter = mint('rfq-can-export', { rfq: true, rfqActions: { view: true, create: true, edit: true, delete: false, export: true } });
  const viewer = mint('rfq-no-export', { rfq: true, rfqActions: { view: true, create: true, edit: true, delete: false, export: false } });
  const nobody = mint('rfq-nothing', {});
  const call = async (method, p, token, body) => {
    const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; const text = await r.text(); try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text };
  };
  const decode = async r => load(Buffer.from(r.json.xlsx, 'base64'));

  // ── POST …/rfqs/xlsx with a payload (the unsaved form) ──
  const payload = { rfq_no: 'MT99W001Y26', rfq_date: '2026-10-01', issuer: 'Admin', supplier_name: 'شركة النيل', supplier_country: 'Egypt',
    items: [{ brand: 'BYD', model: 'Seal', trim: 'Design', year: '2027', fob_price: '17,800', cif_price: 19000, lead_time: '30 days', cf_battery_kwh: '82' },
            { brand: '', model: '', trim: '' }, { brand: 'Kia', model: 'EV9', accessories: '' }] };
  const r1 = await call('POST', '/api/dashboard/rfqs/xlsx', admin, payload);
  check('POST /api/dashboard/rfqs/xlsx answers {xlsx, name} with the RFQ number', r1.status === 200 && typeof r1.json.xlsx === 'string' && r1.json.name === 'MT99W001Y26', `${r1.status} ${r1.text.slice(0, 80)}`);
  if (r1.status === 200) {
    const w1 = await decode(r1), s1 = sheetOf(w1), g1 = grid(s1);
    check('…the reply decodes to a real workbook with the form\'s cells', s1 && valueAfter(s1, 'ID') === 'MT99W001Y26' && valueAfter(s1, 'Name') === 'شركة النيل' && g1.at(0, 'BRAND').value === 'BYD' && g1.at(0, 'FOB PRICE').value === 17800 && g1.at(0, 'CIF PRICE (RoRo)').value === 19000, JSON.stringify(g1.col));
    check('…the route dropped the blank line the form carried and kept the other two', g1.at(1, 'BRAND').value === 'Kia' && g1.at(2, 'BRAND').value == null);
    check('…a blank accessories box got the standard text on the way in', g1.at(1, 'ACCESSORIES / REMARKS').value === defaults.DOC_DEFAULT_ACCESSORIES);
    check('…the company settings were read from the database (e-mail, registration)',
      allCells(s1).some(c => /stubbed@motolinkers\.example/.test(textOf(c.value))) && allCells(s1).some(c => /555000/.test(textOf(c.value))));
    check('…and the admin\'s extra column rode along under its configured name', g1.at(0, 'BATTERY (KWH)').value === 82, JSON.stringify(Object.keys(g1.col)));
  }
  const r1b = await call('POST', '/api/dashboard/rfqs/xlsx', admin, {});
  check('an empty form still exports (a generated number, four empty lines)', r1b.status === 200 && /^MT\d\dW\d{3}Y\d\d$/.test(r1b.json.name || ''), `${r1b.status} ${r1b.json && r1b.json.name}`);

  // ── POST …/rfqs/:id/xlsx (a saved RFQ) ──
  const r2 = await call('POST', '/api/dashboard/rfqs/7/xlsx', admin);
  check('POST /api/dashboard/rfqs/:id/xlsx exports the saved record', r2.status === 200 && r2.json.name === 'MT30W777Y26', `${r2.status} ${r2.text.slice(0, 80)}`);
  if (r2.status === 200) {
    const w2 = await decode(r2), s2 = sheetOf(w2), g2 = grid(s2);
    check('…the saved supplier, line, quote and terms are in the cells',
      valueAfter(s2, 'Name') === 'Saved Supplier Co' && g2.at(0, 'BRAND').value === 'Zeekr' && g2.at(0, 'FOB PRICE').value === 31000 && g2.at(0, 'CIF PRICE (RoRo)').value === 32500
      && g2.at(0, 'LEAD TIME').value === '20 days' && valueAfter(s2, 'Delivery Location') === 'Sokhna' && valueAfter(s2, 'Documents Required') === 'B/L'
      && allCells(s2).some(c => c.value === 'Saved terms: 30% now'));
    check('…and its extra column is headed by the configured label', g2.at(0, 'BATTERY (KWH)').value === 100);
  }
  const r3 = await call('POST', '/api/dashboard/rfqs/999/xlsx', admin);
  check('an RFQ that does not exist is a 404, not a broken file', r3.status === 404 && /not found/i.test((r3.json || {}).error || ''), `${r3.status} ${r3.text.slice(0, 80)}`);
  const r3b = await call('POST', '/api/employee/rfqs/7/xlsx', exporter);
  check('the team portal exports a saved RFQ too', r3b.status === 200 && r3b.json.name === 'MT30W777Y26', String(r3b.status));
  const r3c = await call('POST', '/api/employee/rfqs/xlsx', exporter, payload);
  check('…and an unsaved one', r3c.status === 200 && r3c.json.name === 'MT99W001Y26', String(r3c.status));

  // ── Who may export ──
  const refused = r => r.status === 403 && /Not permitted/.test(r.text);
  const d1 = await call('POST', '/api/employee/rfqs/xlsx', viewer, payload);
  const d2 = await call('POST', '/api/employee/rfqs/7/xlsx', viewer);
  check('an employee without the RFQ export permission is refused (unsaved form)', refused(d1), `${d1.status} ${d1.text.slice(0, 60)}`);
  check('…and refused for a saved RFQ', refused(d2), `${d2.status} ${d2.text.slice(0, 60)}`);
  const d3 = await call('POST', '/api/employee/rfqs/xlsx', nobody, payload);
  check('an employee with no RFQ access at all is refused too', refused(d3), String(d3.status));
  const d4 = await call('GET', '/api/employee/rfqs/7', viewer);
  check('…while the same employee may still open the RFQ (view is a separate permission)', d4.status === 200 && d4.json.rfq_no === 'MT30W777Y26', String(d4.status));
  const d5 = await call('POST', '/api/dashboard/rfqs/xlsx', null, payload);
  const d6 = await call('POST', '/api/dashboard/rfqs/xlsx', 'wrong-token', payload);
  const d7 = await call('POST', '/api/dashboard/rfqs/xlsx', 'rfq-can-export', payload);
  check('no login, a wrong token, or an employee token on the admin route are all 401', d5.status === 401 && d6.status === 401 && d7.status === 401, `${d5.status}/${d6.status}/${d7.status}`);

  // ── The old PDF routes ──
  const MSG = 'RFQs are exported as Excel now. Refresh the page and use Export Excel.';
  const p1 = await call('POST', '/api/dashboard/rfqs/pdf', admin, payload);
  const p2 = await call('POST', '/api/dashboard/rfqs/7/pdf', admin);
  const p3 = await call('POST', '/api/employee/rfqs/pdf', exporter, payload);
  const p4 = await call('POST', '/api/employee/rfqs/7/pdf', exporter);
  check('the legacy POST …/rfqs/pdf answers 410 Gone with the message to use Export Excel',
    p1.status === 410 && p1.json.error === MSG, `${p1.status} ${p1.text.slice(0, 80)}`);
  check('…and so does …/rfqs/:id/pdf, on both portals', p2.status === 410 && p2.json.error === MSG && p3.status === 410 && p4.status === 410 && p3.json.error === MSG);
  const p5 = await call('POST', '/api/employee/rfqs/pdf', viewer, payload);
  check('…but the permission is still checked first (no export right, no answer at all)', refused(p5), String(p5.status));
  check('the 410 reply carries no PDF', !('pdf' in p1.json) && !('xlsx' in p1.json));

  // ── The client's Drive folder files the RFQ as .xlsx ──
  const uploads = [];
  ctx.driveAdminToken = async () => 'token';
  ctx.driveEnsureFolder = async () => 'root-folder';
  ctx.driveFindOrCreateFolder = async () => 'client-folder';
  ctx.driveUploadFile = async (_t, f) => { uploads.push(f); return { id: 'file-' + uploads.length, webViewLink: 'https://drive.example/' + uploads.length }; };
  const f1 = await call('POST', '/api/dashboard/customers/5/folder', admin, {});
  const up = uploads.find(u => /^RFQ /.test(u.name));
  check('syncing a client\'s folder files the RFQ as an Excel workbook',
    f1.status === 200 && !!up && up.name === 'RFQ MT30W777Y26.xlsx' && up.mimeType === XLSX_MIME && up.folderId === 'client-folder', `${f1.status} ${uploads.map(u => u.name).join(',')} ${f1.text.slice(0, 120)}`);
  if (up) {
    const wf = await load(Buffer.from(up.buffer)), sf = sheetOf(wf);
    check('…the filed file is the real workbook, built from the saved record and the settings',
      !!sf && valueAfter(sf, 'Name') === 'Saved Supplier Co' && allCells(sf).some(c => /stubbed@motolinkers\.example/.test(textOf(c.value))));
  }
  check('…and it is reported among the documents added', f1.status === 200 && (f1.json.added || []).includes('RFQ MT30W777Y26.xlsx') && !(f1.json.failed || []).length, JSON.stringify(f1.json && f1.json.added));
  const cf = fs.readFileSync(path.join(__dirname, '../src/routes/client-folder.js'), 'utf8');
  check('the folder module\'s RFQ entry is a file builder returning {buffer, ext: \'xlsx\', mimeType} — not a PDF',
    /rfq: \{[\s\S]{0,400}file: async \(r, settings\) => \(\{\s*buffer: await ctx\.buildRfqXlsx\(\{ \.\.\.r, settings \}\), ext: 'xlsx', mimeType: ctx\.XLSX_MIME/.test(cf));
  check('the context hands the folder module the workbook builder and the media type',
    ctx.buildRfqXlsx === buildRfqXlsx && ctx.XLSX_MIME === XLSX_MIME);
  const routeSrc = fs.readFileSync(path.join(__dirname, '../src/routes/rfq.js'), 'utf8');
  check('the RFQ routes are mounted on both portals and guarded by the export permission',
    /requirePerm\('rfq', 'export'\)/.test(routeSrc) && (routeSrc.match(/requirePerm\('rfq', 'export'\)/g) || []).length === 4
    && /mountRfqRoutes\('\/api\/dashboard\/rfqs', requireAuth\)/.test(routeSrc) && /mountRfqRoutes\('\/api\/employee\/rfqs', requireEmployeeAuth\)/.test(routeSrc));
}
