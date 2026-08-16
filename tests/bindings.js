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
    if (!new RegExp(`(?<![\\w.'"\`])${name}\\s*[(,)\\.\\}\\s]`).test(body)) continue;
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
check('the quotation/RFQ renderer has the brand logo in scope',
  /ctx\.need\('BRAND_LOGO_URL'\)/.test(RFQ) && /ctx\.need\('BRAND_LOGO_URL'\)/.test(CTR)
  && /ctx\.need\('BRAND_LOGO_URL'\)/.test(PO));
check('the RFQ renderer has the shared document chrome in scope',
  ['docChromeCss', 'docFooterHtml', 'docSupplierBlock', 'docTermsHtml']
    .every(n => new RegExp(`const ${n} = \\(\\.\\.\\.a\\) => ctx\\.${n}`).test(RFQ)));
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
