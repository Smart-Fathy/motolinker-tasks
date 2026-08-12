// Supplier purchase rollups. The numbers are checked against a figure computed by
// hand from the fixture, not against whatever the function happens to return.
const fs = require('fs');
// The server is split across index.js and src/routes/*; find whichever file holds
// the code under test so these stay valid as things move.
function serverSrc(marker) {
  const fs = require('fs');
  const files = ['index.js', ...fs.readdirSync('src/routes').map(f => 'src/routes/' + f)];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    if (s.includes(marker)) return s;
  }
  throw new Error('marker not found in any server file: ' + marker);
}
const src = serverSrc('async function supplierPurchases(');
const i = src.indexOf('async function supplierPurchases(');
let j = src.indexOf('{', src.indexOf(')', i)), d = 0, k = j;
for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; } }
const FN = src.slice(i, k + 1);

// Two suppliers so attribution can actually be wrong if the code is sloppy.
const STOCK = [
  { id: 1, make: 'BYD', model: 'Seal', trim: 'Max', units: [
    { vin: 'V1', colour: 'White', supplier_id: 7, discounted: 30000, price_list: 32000 },
    { vin: 'V2', colour: 'Black', supplier_id: 7, price_list: 34000 },
    { vin: 'V3', colour: 'Red',   supplier: 'Yu Motors', discounted: 26000 },   // name-matched, no id
    { vin: 'V4', colour: 'Blue',  supplier_id: 9, discounted: 99999 },          // a different supplier
    { vin: 'V5', colour: 'Grey',  supplier: 'Someone Else', discounted: 12345 },
  ] },
  { id: 2, make: 'BYD', model: 'Atto', trim: '', units: [
    { vin: 'V6', supplier_id: 7 },                                              // no price
  ] },
];
const POS = [
  { id: 11, po_number: 'PO-1', po_date: '2026-07-01', supplier_id: 7, currency: 'USD',
    items: [{ brand: 'BYD', model: 'Seal', qty: 2, fob_price: '31,000', lead_time: '6 weeks' },
            { brand: 'BYD', model: 'Atto', qty: 3, fob_price: '20000',  lead_time: '4 weeks' }] },
  { id: 12, po_number: 'PO-2', supplier: 'Yu Motors', currency: 'USD',
    items: [{ brand: 'BYD', model: 'Dolphin', qty: 1, price: '18000', lead_time: '6 weeks' }] },
  { id: 13, po_number: 'PO-3', supplier_id: 9, items: [{ brand: 'X', model: 'Y', qty: 5, fob_price: '1' }] },
];
const SUPPLIERS = { 7: { id: 7, name: 'Yu Motors' }, 9: { id: 9, name: 'Uniland' } };
// The stub honours .eq('id', …) — an earlier version returned the same supplier for
// every id, which made an unknown supplier inherit Yu Motors' name-matched rows.
const supabase = { from: t => ({
  select: () => {
    const rows = t === 'stock_vehicles' ? STOCK : t === 'purchase_orders' ? POS : null;
    let wanted = null;
    const api = {
      data: rows,
      eq: (_col, v) => { wanted = v; return api; },
      single: async () => ({ data: SUPPLIERS[wanted] || null }),
    };
    return Object.assign(Promise.resolve({ data: rows }), api);
  } }) };

const supplierPurchases = new Function('supabase', FN + '\nreturn supplierPurchases;')(supabase);

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

(async () => {
  const p = await supplierPurchases(7);
  const vins = p.units.map(u => u.vin).sort();

  // By hand: V1, V2, V6 by supplier_id; V3 by name. V4 (id 9) and V5 (other name) must not appear.
  c('cars are attributed by id, and by name only where no id was matched',
    vins.join() === 'V1,V2,V3,V6', JSON.stringify(vins));
  c('another supplier\'s cars are excluded', !vins.includes('V4') && !vins.includes('V5'), JSON.stringify(vins));
  c('the count matches', p.totals.vehicles === 4, 'got=' + p.totals.vehicles);

  // discounted wins over list: V1 30000, V2 34000 (list only), V3 26000, V6 no price → excluded
  // (30000 + 34000 + 26000) / 3 = 30000
  c('average price paid uses discounted over list, and skips priceless cars',
    p.totals.avg_unit_price === 30000, 'got=' + p.totals.avg_unit_price);

  // PO-1 (id 7) two lines, PO-2 (name match) one line. PO-3 is supplier 9.
  c('purchase-order lines follow the same attribution',
    p.poLines.map(l => l.po_number).join() === 'PO-1,PO-1,PO-2', JSON.stringify(p.poLines.map(l => l.po_number)));
  c('quantities are summed across lines, not counted as rows',
    p.totals.ordered === 6, 'got=' + p.totals.ordered);   // 2 + 3 + 1

  // "31,000" must parse; (31000 + 20000 + 18000) / 3 = 23000
  c('prices with thousands separators parse correctly',
    p.totals.avg_po_price === 23000, 'got=' + p.totals.avg_po_price);
  c('quoted lead times are collected without duplicates',
    p.totals.lead_times.sort().join() === '4 weeks,6 weeks', JSON.stringify(p.totals.lead_times));

  // A supplier with nothing must return zeros, not NaN
  const empty = await supplierPurchases(999);
  c('a supplier with no history returns zeros rather than NaN',
    empty.totals.vehicles === 0 && empty.totals.avg_unit_price === 0 && !Number.isNaN(empty.totals.avg_po_price),
    JSON.stringify(empty.totals));

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
