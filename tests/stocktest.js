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
// The module reads shared vocabulary off the context, so give it one
const sandbox = new Function('ctx', 'PO_LINE_STATUS_KEYS',
  [grab('parseStockColors'), grab('parseStockUnits'), grab('stockBuildRow'), grab('stockUnitGaps')].join('\n')
  + '\nreturn { parseStockColors, parseStockUnits, stockBuildRow, stockUnitGaps };')(
    { PO_LINE_STATUS_KEYS: PO_KEYS }, PO_KEYS);
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
// 3. Colour tallies no longer count either
{
  const { row } = stockBuildRow({ make: 'BYD', model: 'Seal', colors: 'White:5 | Black:4', units: [] });
  c('colour tallies do not create stock', row.quantity === 0, 'qty=' + row.quantity);
  c('but the colours are still recorded for the spec card',
    row.colors.map(x => x.name).join() === 'White,Black', JSON.stringify(row.colors));
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
console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
