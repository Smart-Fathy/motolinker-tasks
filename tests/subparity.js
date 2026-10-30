// The new app's Submissions screen against the classic portals', value by value — the same method as tests/notifparity.js (see
// there): the classic page and the new app opened as the same person, in both portals, both colour modes and two looks, at a
// phone's width, two in-betweens and a desktop, and the computed style of every named part compared, and the words in them.
//
//   table    a list: a lead's chip and a row with none, a phone, a car and a message left empty, a long message with line breaks
//   loading  the server is slow to answer: the table gives way to the loader
//   empty    nothing yet
//   error    the server could not be asked
//
// The error's words are the server's: the classic page prints what the database said, the new one what /api/v1 says (that a
// database that is down is "unavailable"), so those are compared by their look and not by their words.
// Run with --print to see every difference rather than the first few.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, sleep, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');

const ROOT = path.join(__dirname, '..');
const PRINT = process.argv.includes('--print');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// Where the two differ on purpose or by necessity, and why. Each must still differ, or it is stale and fails.
const ACCEPTED = {};

// The part each role names, classic and new. Positions are held relative to the page's own root (`rel`).
const T = '#submissions-table-container ';
const cell = (row, n) => `${T}tbody tr:nth-child(${row}) td:nth-child(${n})`;
const ncell = (row, name) => `[data-part=row]:nth-child(${row}) [data-part=${name}]`;
const common = (root, head) => ({
  root,
  ...head,
  container: part('#submissions-table-container', '[data-part=container]', 'abs', 'root'),
  loading: part('#submissions-table-container .loading', '[data-part=loading]', 'abs', 'root', true),
  spinner: part('#submissions-table-container .spinner', '[data-part=loading] > span', 'abs', 'root'),
  error: part('#submissions-table-container .error-msg', '[data-part=error]', 'abs', 'root'),
  empty: part('#submissions-table-container > div', '[data-part=empty]', 'abs', 'root', true),
  emptyMark: part('#submissions-table-container > div > div:nth-child(1)', '[data-part=empty] > div:nth-child(1)', 'abs', 'root', true),
  emptyTitle: part('#submissions-table-container > div > div:nth-child(2)', '[data-part=empty] > div:nth-child(2)', 'abs', 'root', true),
  emptyHint: part('#submissions-table-container > div > div:nth-child(3)', '[data-part=empty] > div:nth-child(3)', 'abs', 'root', true),
  tableScroll: part('#submissions-table-container .table-scroll', '[data-part=tableScroll]', 'abs', 'root'),
  table: part('#submissions-table-container table', '[data-part=table]', 'abs', 'root'),
  headRow: part(T + 'thead tr', '[data-part=headRow]', 'abs', 'root'),
  thName: part(T + 'thead th:nth-child(1)', '[data-part=th]:nth-child(1)', 'abs', 'root', true),
  thLead: part(T + 'thead th:nth-child(2)', '[data-part=th]:nth-child(2)', 'abs', 'root', true),
  thMessage: part(T + 'thead th:nth-child(6)', '[data-part=th]:nth-child(6)', 'abs', 'root', true),
  thWhen: part(T + 'thead th:nth-child(7)', '[data-part=th]:nth-child(7)', 'abs', 'root', true),
  thEnd: part(T + 'thead th:nth-child(8)', 'thead th:nth-child(8)', 'abs', 'root'),
  row1: part(T + 'tbody tr:nth-child(1)', '[data-part=row]:nth-child(1)', 'abs', 'root'),
  row3: part(T + 'tbody tr:nth-child(3)', '[data-part=row]:nth-child(3)', 'abs', 'root'),
  name1: part(cell(1, 1), ncell(1, 'name'), 'abs', 'root', true),
  lead1: part(cell(1, 2), ncell(1, 'lead'), 'abs', 'root'),
  chip: part(cell(1, 2) + ' span', ncell(1, 'lead') + ' span', 'abs', 'root', true),
  email1: part(cell(1, 3), ncell(1, 'email'), 'abs', 'root'),
  mail: part(cell(1, 3) + ' a', ncell(1, 'email') + ' a', 'abs', 'root', true),
  phone1: part(cell(1, 4), ncell(1, 'phone'), 'abs', 'root', true),
  car1: part(cell(1, 5), ncell(1, 'car'), 'abs', 'root', true),
  message1: part(cell(1, 6), ncell(1, 'message'), 'abs', 'root', true),
  when1: part(cell(1, 7), ncell(1, 'when'), 'abs', 'root', true),
  actions1: part(cell(1, 8), ncell(1, 'actions'), 'abs', 'root'),
  delete1: part(cell(1, 8) + ' button', ncell(1, 'actions') + ' button', 'abs', 'root', true),
  lead2: part(cell(2, 2), ncell(2, 'lead'), 'abs', 'root'),
  none: part(cell(2, 2) + ' span', ncell(2, 'lead') + ' span', 'abs', 'root', true),
  phone2: part(cell(2, 4), ncell(2, 'phone'), 'abs', 'root', true),
  car2: part(cell(2, 5), ncell(2, 'car'), 'abs', 'root', true),
  message2: part(cell(2, 6), ncell(2, 'message'), 'abs', 'root', true),
  message3: part(cell(3, 6), ncell(3, 'message'), 'abs', 'root', true),
});
const ROLES = {
  admin: common(part('#page-submissions', '[data-part=submissionsPage]', 'none'), {
    pageHead: part('#page-submissions .page-header', '[data-part=pageHead]', 'abs', 'root'),
    pageTitle: part('#page-submissions .page-title', '[data-part=pageTitle]', 'abs', 'root', true),
    refresh: part('#page-submissions .page-header .btn', '[data-part=refresh]', 'abs', 'root', true),
    pageBody: part('#page-submissions > div:has(> #submissions-table-container)', '[data-part=pageBody]', 'abs', 'root'),
  }),
  team: common(part('#page-submissions', '[data-part=page]', 'none'), {
    pageBody: part('#page-submissions > div:has(> #submissions-table-container)', '[data-part=submissionsPage]', 'abs', 'root'),
    pageHead: part('#page-submissions > div:has(> #submissions-table-container) > div:first-child', '[data-part=pageHead]', 'abs', 'root'),
    pageTitle: part('#page-submissions .card-title', '[data-part=pageTitle]', 'abs', 'root', true),
    pageHint: part('#page-submissions .card-title + div', '[data-part=pageHint]', 'abs', 'root', true),
    refresh: part('#page-submissions .btn', '[data-part=refresh]', 'abs', 'root', true),
  }),
};
// What a state reads: the parts it shows (a part that is not there on either side is not compared, one that is on one side only is a failure)
const READS = {
  table: ['root', 'pageHead', 'pageTitle', 'pageHint', 'refresh', 'pageBody', 'container', 'tableScroll', 'table', 'headRow', 'thName', 'thLead', 'thMessage', 'thWhen', 'thEnd', 'row1', 'row3', 'name1', 'lead1', 'chip', 'email1', 'mail', 'phone1', 'car1', 'message1', 'when1', 'actions1', 'delete1', 'lead2', 'none', 'phone2', 'car2', 'message2', 'message3'],
  loading: ['root', 'pageHead', 'pageTitle', 'refresh', 'pageBody', 'container', 'loading', 'spinner'],
  empty: ['root', 'pageHead', 'pageTitle', 'refresh', 'pageBody', 'container', 'empty', 'emptyMark', 'emptyTitle', 'emptyHint'],
  error: ['pageHead', 'pageTitle', 'refresh', 'error'],
};
// …and the words that are the server's, not the page's — and so what the length of them decides (how tall the box is)
const NO_WORDS = new Set(['error']);
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

// What the website sent. Times are far from "now" so they read the same in two pages opened a while apart.
const rows = () => {
  const at = d => new Date(Date.UTC(2026, 8, d, 10, 30)).toISOString();
  return [
    { id: 3, name: 'Layla Hassan', email: 'layla@example.com', phone: '+20 100 555 0101', message: 'Looking for a white Hilux, diesel, for delivery in Cairo next month.', car_interest: 'Hilux', source: 'website', customer_id: 1, customers: { name: 'Layla Hassan' }, created_at: at(21) },
    { id: 2, name: 'Omar', email: 'omar@example.com', phone: '', message: '', car_interest: '', source: 'website', customer_id: null, created_at: at(14) },
    { id: 1, name: 'Mona El-Sayed', email: 'mona@example.com', phone: '+20 122 555 0199', message: 'First line.\nSecond line, which is rather a long one, to see the message column wrap inside its two hundred and forty pixels.\n\nA third, after a blank one.', car_interest: 'Land Cruiser 300', source: 'website', customer_id: 2, customers: { name: 'Mona' }, created_at: at(3) },
  ];
};

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 3966 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const roles = ROLES[p.who];
    db.tables.form_submissions = rows();
    db.failing.clear(); db.latency = 0;
    const page = await openPage(browser, base, p, mode, next);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    // (the classic pages carry the assistant's card at the top of the page; the assistant moves into the new app with its own batch,
    // and the card is not a part of this page)
    await page.addStyleTag({ content: STILL + (next ? '' : '.ai-card{display:none!important}') });
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(e => { throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]}`); });
    const reading = async state => {
      const which = Object.fromEntries(READS[state].map(r => [r, roles[r]]).filter(([, d]) => d));
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const at = `${p.who}/${key}/${state}/${width}`;
        const got = await readRoles(page, which, side, PROPS_MORE);
        if (NO_WORDS.has(state)) for (const [name, r] of Object.entries(got)) if (r) { delete r._text; if (name === 'error') delete r._h; }
        (observed[at] = observed[at] || {})[side] = got;
      }
      await page.setViewport({ width: 1100, height: 800 });
      await settle(page);
    };
    const open = () => page.evaluate(next => {
      if (!next) return window.navigate('submissions');
      document.querySelector('[data-screen=submissions]').click();
    }, next);
    const refresh = () => page.evaluate(next => document.querySelector(next ? '[data-part=refresh]' : '#page-submissions .btn').click(), next);

    // table — and, on the way, loading: the server is slow, the page is opened, the loader is read before the answer comes
    db.latency = 1500;
    await open();
    await until(s => !!document.querySelector(s), next ? '[data-part=loading]' : '#submissions-table-container .loading', 'the loader');
    await reading('loading');
    db.latency = 0;
    await until(s => document.querySelectorAll(s).length === 3, next ? '[data-part=row]' : '#submissions-table-container tbody tr', 'three rows');
    await reading('table');

    // empty
    db.tables.form_submissions = [];
    await refresh();
    await until(s => { const c = document.querySelector(s); return !!c && c.textContent.includes('No submissions yet'); }, next ? '[data-part=container]' : '#submissions-table-container', 'the empty page');
    await reading('empty');

    // error
    db.failing.add('form_submissions');
    await refresh();
    await until(s => !!document.querySelector(s), next ? '[data-part=error]' : '#submissions-table-container .error-msg', 'the error');
    await reading('error');
    await page.shut();
  };

  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const p of portals) for (const mode of MODES) for (const side of ['classic', 'next']) {
      if (ONLY && !`${p.who}/${look}/${mode}`.startsWith(ONLY.split('/').slice(0, 3).join('/'))) continue;
      await scenario(p, mode, side, `${look}/${mode}`);
    }
  }
  await browser.close();

  const stale = new Set(Object.keys(ACCEPTED));
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const { n, bad } = diff(classic, next, ACCEPTED, stale, PROPS_MORE);
    compared += n;
    check(`${key}: ${n} values are the classic page's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (!ONLY) {
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 30000, String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
