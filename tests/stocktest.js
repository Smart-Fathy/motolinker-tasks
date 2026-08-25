// Stock is per-VIN: the cars themselves are the count. Functions are lifted from
// index.js so this exercises the shipped code, not a copy.
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
const src = serverSrc('function stockBuildRow(');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let j = src.indexOf('(', i), d = 0;
  for (; j < src.length; j++) { if (src[j] === '(') d++; else if (src[j] === ')') { d--; if (!d) break; } }
  const b = src.indexOf('{', j); let k = b, dd = 0;
  for (; k < src.length; k++) { if (src[k] === '{') dd++; else if (src[k] === '}') { dd--; if (!dd) break; } }
  return src.slice(i, k + 1);
}
const PO_KEYS = JSON.parse('["send_to_supplier","in_production","in_logistics","in_customs","delivered"]');
// The module reads shared vocabulary off the context, so give it one. The grid
// helpers come from the real ctx rather than a copy: they decide whether a
// configured column survives a save, which is the thing under test.
const realCtx = require('../src/ctx');
const testCtx = { PO_LINE_STATUS_KEYS: PO_KEYS,
  gridExtras: realCtx.gridExtras, hasGridExtras: realCtx.hasGridExtras };
const sandbox = new Function('ctx', 'PO_LINE_STATUS_KEYS',
  [grab('parseStockUnits'), grab('stockBuildRow'), grab('stockUnitGaps')].join('\n')
  + '\nreturn { parseStockUnits, stockBuildRow, stockUnitGaps };')(testCtx, PO_KEYS);
const { stockBuildRow, stockUnitGaps } = sandbox;

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// 1. Cars are the count
{
  const { row } = stockBuildRow({ make: 'BYD', model: 'Seal', units: [
    { vin: 'A1', colour: 'White' }, { vin: 'A2', colour: 'Black' }, { vin: 'A3', colour: 'White' }] });
  c('quantity equals the number of cars listed', row.quantity === 3, 'qty=' + row.quantity);
}
// 2. A typed-in total is ignored — the whole point of the change
{
  const { row } = stockBuildRow({ make: 'BYD', model: 'Seal', quantity: '99', units: [{ vin: 'A1' }] });
  c('a typed-in total cannot inflate the count', row.quantity === 1, 'qty=' + row.quantity);
}
// 3. A model no longer keeps a list of the colours it is offered in. Each car
//    carries its own colour; a "colours offered" list was a second place to say
//    the same thing, and the two disagreed the moment a car arrived in a colour
//    nobody had listed.
{
  const { row } = stockBuildRow({ make: 'BYD', model: 'Seal', colors: 'White:5 | Black:4', units: [] });
  c('colour tallies do not create stock', row.quantity === 0, 'qty=' + row.quantity);
  c('a colours-offered list is not stored at all', row.colors === undefined, JSON.stringify(row.colors));
  const withCars = stockBuildRow({ make: 'BYD', model: 'Seal', units: [{ vin: 'A1', colour: 'White' }] }).row;
  c("…but each car keeps its own colour", withCars.units[0].colour === 'White', JSON.stringify(withCars.units));
}
// 4. legacy_count is a prompt, never stock
{
  const { row } = stockBuildRow({ make: 'BYD', model: 'Seal', units: [], legacy_count: 3 });
  c('a legacy count is kept while there are no cars', row.legacy_count === 3 && row.quantity === 0,
    JSON.stringify({ q: row.quantity, l: row.legacy_count }));
  const { row: row2 } = stockBuildRow({ make: 'BYD', model: 'Seal', units: [{ vin: 'A1' }], legacy_count: 3 });
  c('and is cleared once real cars are entered', row2.legacy_count === null && row2.quantity === 1,
    JSON.stringify({ q: row2.quantity, l: row2.legacy_count }));
}
// 5. Missing VINs are surfaced, not silently accepted
{
  const gaps = stockUnitGaps({ units: [{ vin: 'A1' }, { vin: '' }, { vin: '   ' }] });
  c('cars without a VIN are counted as gaps', gaps.counted === 3 && gaps.missingVin === 2, JSON.stringify(gaps));
  const legacy = stockUnitGaps({ units: [], legacy_count: 4 });
  c('a model with no cars reports its old count', legacy.legacy === 4 && legacy.counted === 0, JSON.stringify(legacy));
}
// 6. CSV no longer carries a total column
c('quantity is gone from the CSV headers',
  !/const STOCK_CSV_HEADERS = \[[^\]]*'quantity'/.test(src),
  (src.match(/const STOCK_CSV_HEADERS = \[[^\]]*\]/) || [''])[0]);

// 7. The migration must not invent cars
{
  const m = fs.readFileSync('migrations/005_stock_vin.sql', 'utf8');
  c('the migration never writes to units', !/UPDATE stock_vehicles[\s\S]*?SET[\s\S]*?\bunits\b\s*=/.test(m));
  c('it snapshots the old count into legacy_count', /legacy_count\s*=\s*GREATEST/.test(m));
  c('and recomputes quantity from units', /quantity = COALESCE\(jsonb_array_length/.test(m));
}
// 8. Columns the admin added survive the round trip
// Reported from production: someone added a "Vehicle file" column, pasted a link
// into it, saved, reopened the vehicle and found it empty. parseStockUnits
// rebuilt every unit from eight hardcoded keys, so the value never reached the
// database — and the row filter tested four of those eight, so a unit whose only
// content was the new column was dropped whole.
{
  const [u] = sandbox.parseStockUnits([{ vin: 'JT123', vehicle_file: 'https://drive.google.com/file/d/abc' }]);
  c('a configured column survives the save', !!u && u.vehicle_file === 'https://drive.google.com/file/d/abc',
    JSON.stringify(u));
  c('…and the builtins still come through', !!u && u.vin === 'JT123' && u.status === 'send_to_supplier');

  const only = sandbox.parseStockUnits([{ vehicle_file: 'https://drive/x' }]);
  c('a unit whose only content is that column is kept', only.length === 1, JSON.stringify(only));

  const blank = sandbox.parseStockUnits([{ vin: '', colour: '', consignee: '', supplier: '' }]);
  c('a genuinely empty row is still dropped', blank.length === 0, JSON.stringify(blank));

  // The value is whatever someone typed, so it is sanitised rather than trusted.
  const [s2] = sandbox.parseStockUnits([{ vin: 'A', nested: { a: 1 }, 'bad key': 'x', big: 'z'.repeat(5000) }]);
  c('objects and malformed keys are refused', !!s2 && !('nested' in s2) && !('bad key' in s2), JSON.stringify(s2));
  // Read defensively: on the code this guards, `big` is not there at all, and a
  // test that throws reports nothing about the assertions after it.
  c('…and a long value is capped', String(s2 && s2.big || '').length === 2000, s2 && s2.big && s2.big.length);

  // colour/color are one field under two spellings; the alias must not double up.
  const [s3] = sandbox.parseStockUnits([{ color: 'White' }]);
  c('the colour alias is consumed, not duplicated', !!s3 && s3.colour === 'White' && !('color' in s3),
    JSON.stringify(s3));

  // quantity is derived from the units that survive
  const built = sandbox.stockBuildRow({ make: 'Toyota', model: 'Corolla',
    units: [{ vehicle_file: 'https://drive/x' }, { vin: 'B' }] });
  c('both count towards quantity', !!built.row && built.row.quantity === 2, JSON.stringify(built.row && built.row.quantity));
}

// 9. The client must not re-filter the rows before they are sent
{
  const proc = fs.readFileSync('public/assets/procurement.js', 'utf8');
  c('saveStock sends every unit row and lets the server decide',
    /const units = procGridCollect\('\.stk-unit-row', '\.stk-u'\);/.test(proc)
    && !/procGridCollect\('\.stk-unit-row'[\s\S]{0,120}\.filter\(u => u\.vin/.test(proc));
}

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
