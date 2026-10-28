// Every server module must declare what it uses.
//
// Three production failures in one report — "taskCtx is not defined" on creating
// a task, "BRAND_LOGO_URL is not defined" on every quotation PDF — were the same
// bug wearing different names. Code moved out of index.js into src/routes/* kept
// calling helpers that used to be in scope and now are not. Nothing catches that:
// it parses, it boots, the route registers, and the ReferenceError waits until a
// person clicks the thing.
//
// So this walks the server files and, for every name any module exports, asks
// whether a file that USES it also declares it — as its own definition, a
// destructure from ctx.need(), or a lazy `(...a) => ctx.name(...a)` binding.
// A miss here is a crash on somebody's screen later.
const fs = require('fs');
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const FILES = ['index.js', ...fs.readdirSync('src/routes').filter(f => f.endsWith('.js')).map(f => 'src/routes/' + f)];

// Every name the server hands around between modules.
const shared = new Set();
for (const f of [...FILES, 'src/lib/constants.js']) {
  const m = fs.readFileSync(f, 'utf8').match(/module\.exports\s*=\s*\{([^}]*)\}/s);
  if (m) m[1].split(',').map(x => x.split(':')[0].trim()).filter(Boolean).forEach(n => shared.add(n));
}
check('the exported surface is discovered from the modules themselves',
  shared.size > 20 && shared.has('taskCtx') && shared.has('BRAND_LOGO_URL'), String(shared.size));

// Comments are stripped so a name mentioned in prose does not count as a use.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*/, '')).join('\n');

const unbound = [];
for (const f of FILES) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  for (const name of shared) {
    // `ctx.name(...)` is always fine — that is the context, reached explicitly.
    const body = src.replace(new RegExp(`ctx\\.${name}`, 'g'), '');
    // A dot in front means a property (obj.name), unless it is the last dot of a
    // spread: `...requestCtx(data)` is a use, and is how one of these slipped past.
    // So is indexing — `LEADS_ENUM_DEFAULTS[field]` was the other.
    if (!new RegExp(`(?<![\\w'"\`])(?<![^.]\\.)${name}\\s*[(,)\\.\\}\\s\\[\\];]`).test(body)) continue;
    const declared = new RegExp(
      `(const|let|var|function|class)\\s+${name}\\b`     // its own definition, or a binding
      + `|\\b${name}\\s*[,}][^=]*\\}\\s*=`               // …destructured, mid-list
      + `|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`            // …destructured, anywhere
    ).test(src);
    if (!declared) unbound.push(`${f} → ${name}`);
  }
}
check('no server module calls a helper it never bound',
  unbound.length === 0, unbound.join('  |  '));

// The three the user actually hit, named so a regression is unambiguous.
const RFQ = fs.readFileSync('src/routes/rfq.js', 'utf8');
const EMP = fs.readFileSync('src/routes/employee-portal.js', 'utf8');
const CTR = fs.readFileSync('src/routes/contracts.js', 'utf8');
const PO  = fs.readFileSync('src/routes/purchase-orders.js', 'utf8');
// The documents used to read BRAND_LOGO_URL as a bare global, which threw the moment a
// PDF was rendered. They now take the logo (and the fonts, and the colours) from one
// module that embeds them, so the thing to guard is that every builder goes through it
// and no route module reaches for the old global.
const DOCS = ['quotation', 'purchase-order', 'contract', 'rfq-xlsx']
  .map(n => [n, fs.readFileSync(`src/lib/docs/${n}.js`, 'utf8')]);
check('every document builder takes its look from the shared brand module',
  DOCS.every(([, src]) => /require\('\.\/brand'\)/.test(src)), DOCS.filter(([, src]) => !/require\('\.\/brand'\)/.test(src)).map(([n]) => n).join(', '));
check('the brand module ships the logo it embeds',
  ['logo-color', 'logo-white', 'logo-reverse', 'mark-color', 'mark-white'].every(n => fs.existsSync(`src/assets/brand/${n}.png`))
  && ['poppins-latin-400', 'poppins-latin-700', 'cairo-arabic-wght'].every(n => fs.existsSync(`src/assets/fonts/${n}.woff2`)));
check('no route module reads a bare BRAND_LOGO_URL',
  [RFQ, CTR, PO].every(src => !/BRAND_LOGO_URL/.test(src)));
check('the RFQ routes build the Excel workbook',
  /buildRfqXlsx/.test(RFQ) && /\/xlsx`/.test(RFQ));
check('the team portal can build its automation payloads',
  ['taskCtx', 'leadCtx', 'dealCtx'].every(n => new RegExp(`const ${n} = \\(\\.\\.\\.a\\) => ctx\\.${n}`).test(EMP))
  && /const autoCreateContractForWonDeal = \(\.\.\.a\) => ctx\.autoCreateContractForWonDeal/.test(EMP));

// A lazy binding is required for anything another FEATURE module provides:
// captured at require time it would be undefined, because load order between
// feature modules is not fixed. ctx.need() is for what index.js built first.
check('cross-module helpers are bound lazily, not captured at require time',
  !/const taskCtx = ctx\.taskCtx\b/.test(EMP) && !/const docChromeCss = ctx\.docChromeCss\b/.test(RFQ));

console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
process.exit(results.every(Boolean) ? 0 : 1);
