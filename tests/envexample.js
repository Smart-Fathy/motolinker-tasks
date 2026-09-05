// .env.example has to stay honest.
//
// README step 3 says "add all environment variables from .env.example". The file
// did not exist until now, so the answer to "where do I put this key" lived in
// chat messages and nowhere in the repo — and the six tracking variables added
// this month were invisible to anyone deploying.
//
// A documentation file drifts the moment somebody adds a variable and forgets,
// and a stale one is worse than none because it is trusted. So it is checked
// both ways: nothing the code reads may be missing, and nothing may be listed
// that the code no longer reads.
const fs = require('fs');

const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const sources = ['index.js', ...fs.readdirSync('src/routes').filter(f => f.endsWith('.js')).map(f => 'src/routes/' + f)];
const used = new Set();
for (const f of sources) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) used.add(m[1]);
}

c('.env.example exists', fs.existsSync('.env.example'));
const ex = fs.readFileSync('.env.example', 'utf8');
const documented = new Set([...ex.matchAll(/^([A-Z0-9_]+)=/gm)].map(m => m[1]));

const missing = [...used].filter(k => !documented.has(k)).sort();
const extra = [...documented].filter(k => !used.has(k)).sort();
c('every variable the code reads is documented', missing.length === 0, missing.join(', '));
c('nothing is documented that the code no longer reads', extra.length === 0, extra.join(', '));

// A secret committed to an example file is a secret published to the repo. Every
// value here must be blank or an obvious placeholder.
const SAFE_VALUE = /^$|^(3000|587|false|true|admin|safecube|vehicles)$|^https:\/\/(xxx|your-)/;
const leaked = [...ex.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)]
  .filter(([, , v]) => !SAFE_VALUE.test(v.trim()))
  .map(([, k]) => k);
c('no real value is committed in the example', leaked.length === 0, leaked.join(', '));

// The README points at it, and that pointer is the reason the file has to exist.
c('the README still points at it', /\.env\.example/.test(fs.readFileSync('README.md', 'utf8')));

// The tracking settings are the ones people are actively pasting keys into, so
// they are named explicitly rather than left to the count above.
for (const k of ['CONTAINER_TRACKING_PROVIDER', 'CONTAINER_TRACKING_KEY',
  'TRACKING_WEBHOOK_SECRET', 'AIS_TRACKING_URL', 'SAFECUBE_SEALINE', 'SAFECUBE_ENDPOINT_ID']) {
  c(`${k} is documented`, documented.has(k));
}
// And the file has to say which provider names are valid, or the one setting
// that silently disables tracking on a typo is undiscoverable.
c('the valid provider names are listed', /safecube[\s\S]{0,400}terminal49[\s\S]{0,400}generic/.test(ex));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
