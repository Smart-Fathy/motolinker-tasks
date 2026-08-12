// Every column the app writes must exist in the schema.
//
// The Drive upload wrote sales.client_file_meta to a column that was never
// created: the file reached Drive, then the row update failed and the reference
// was lost. Nothing caught it because the Drive test stubs Supabase as well as
// Google, so the write was never executed against a real shape.
//
// This compares the column names in every .insert/.update/.upsert object literal
// against schema.sql plus the migrations.
const fs = require('fs');
const glob = d => fs.readdirSync(d).map(f => d + '/' + f);

let schema = fs.readFileSync('schema.sql', 'utf8');
for (const f of glob('migrations').filter(f => f.endsWith('.sql'))) schema += fs.readFileSync(f, 'utf8');
schema = schema.toLowerCase();

const sources = ['index.js', ...glob('src/routes').filter(f => f.endsWith('.js'))];
const IGNORE = new Set(['data', 'error', 'count', 'onConflict', 'returning', 'ascending', 'head']);

const bad = [];
for (const f of sources) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /from\('(\w+)'\)\s*\.\s*(?:insert|update|upsert)\(\s*\{([^}]{0,800})/gs;
  let m;
  while ((m = re.exec(s))) {
    const table = m[1];
    for (const km of m[2].matchAll(/(?:^|[{,\s])([a-z_][a-z0-9_]*)\s*:/g)) {
      const col = km[1];
      if (IGNORE.has(col)) continue;
      if (!new RegExp('\\b' + col + '\\b').test(schema)) bad.push(`${table}.${col}  (${f})`);
    }
  }
}
// quotation_settings stores JSON in a `value` column; keys inside that JSON are
// not columns, so the KV writes are checked by name rather than by shape.
const real = bad.filter(b => !/^quotation_settings\.(groups|widgets)\b/.test(b));

if (real.length) {
  console.log('columns written but not defined anywhere:');
  for (const b of [...new Set(real)]) console.log('  ' + b);
  console.log(`\n${new Set(real).size} missing column(s)`);
  process.exit(1);
}
console.log('every written column exists in the schema');
