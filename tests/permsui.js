// The access editor, driven for real against the shipped bundle.
//
// Twenty-two sections with up to eight actions each used to render as one long
// wall of checkboxes: nothing summarized, nothing searchable, and a new starter
// set up one tick at a time. This is the redesign — a row per section that says
// what it grants, actions on demand, search, group counts and presets — checked
// on the two properties that matter beyond looks:
//
//   1. It still SAVES the same thing. The switches and chips are styled real
//      checkboxes, so empBuildPerms() reads exactly what it always read; a
//      redesign that quietly changed a saved permission would be a disaster.
//   2. The catalogue and the presets come from the server, so a section added
//      to PERM_ACTIONS shows up here without this file being touched.
const fs = require('fs'), path = require('path'), http = require('http'), puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// The real catalogue, straight out of the server module — no fixture to drift.
const empSrc = fs.readFileSync('src/routes/employee-portal.js', 'utf8');
// Lift the declarations by name — a slice by line numbers would rot the first
// time somebody reorders the file.
function lift(decl) {
  const i = empSrc.indexOf(decl);
  if (i < 0) throw new Error('not found in employee-portal.js: ' + decl);
  const open = empSrc.indexOf(decl.endsWith('(') ? '{' : (empSrc[empSrc.indexOf('=', i) + 2] === '[' ? '[' : '{'), i);
  const closer = { '{': '}', '[': ']' }[empSrc[open]];
  let d = 0;
  for (let j = open; j < empSrc.length; j++) {
    if (empSrc[j] === empSrc[open]) d++;
    else if (empSrc[j] === closer && !--d) return empSrc.slice(i, j + 1) + (decl.endsWith('(') ? '' : ';');
  }
  throw new Error('unbalanced: ' + decl);
}
const CATALOGUE = (() => {
  const src = [
    'const PERM_ACTIONS =', 'const PERM_GROUPS =', 'const PERM_SECTION_LABELS =',
    'const PERM_ACTION_LABELS =', 'const PERM_READISH =', 'const PERM_PRESETS =',
    'function permPresetPerms(', 'function permCatalogue(',
  ].map(lift).join('\n');
  // Only `defaultOn` reads DEFAULT_PERMISSIONS, and a fresh employee defaults
  // every section off, so an empty object is the honest stand-in.
  const body = `${src}\nreturn { groups: permCatalogue(), presets: PERM_PRESETS.map(p => ({ key:p.key, label:p.label, hint:p.hint, permissions: permPresetPerms(p) })) };`;
  return new Function('DEFAULT_PERMISSIONS', body)({});
})();

const EMPLOYEES = [
  { id: 2, name: 'Sara Ahmed', username: 'sara', email: '', job_title: 'Sales',
    permissions: { leads: true, leadsActions: { view: true, create: true, edit: false, delete: false, import: false, export: false },
                   chat: true, chatActions: { view: true, send: true } } },
  { id: 3, name: 'Omar Nabil', username: 'omar', email: '', job_title: 'Ops', permissions: {} },
];
let saved = [];
function api(pathname, method, body) {
  if (/permissions\/catalogue$/.test(pathname)) return { ...CATALOGUE, stages: ['lead', 'won'] };
  if (method === 'PUT' && /employees\/\d+$/.test(pathname)) { saved.push(JSON.parse(body)); return { ok: true }; }
  if (/employees\/permissions\/bulk$/.test(pathname)) { saved.push(JSON.parse(body)); return { ok: true, updated: 2 }; }
  if (/dashboard\/employees$/.test(pathname)) return EMPLOYEES;
  if (/auth\/check$/.test(pathname)) return { ok: true };
  return [];
}

(async () => {
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify(api(u.pathname, req.method(), req.postData())) });
    }
    if (u.pathname === '/dashboard') return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync('public/dashboard.html', 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(() => localStorage.setItem('ml_admin_token', 't'));
  await page.goto(`http://127.0.0.1:${port}/dashboard`, { waitUntil: 'networkidle2' });
  await sleep(600);
  await page.evaluate(() => navigate('employees'));
  await sleep(500);

  // ── The list's Permissions column ───────────────────────────────────────────
  // It named eight sections out of twenty-two and printed all eight for every
  // employee, greyed when off — including viewAllRequests, which has not been a
  // section for a long time. It should say how much access, then which.
  {
    const cell = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#employees-table-container tbody tr')];
      const cells = rows.map(r => [...r.querySelectorAll('td')][6]);
      return cells.map(c => ({ text: c.textContent.replace(/\s+/g, ' ').trim(),
                               badges: c.querySelectorAll('.perm-badge').length }));
    });
    check('the list says how much access, then which sections',
      /2 of 22/.test(cell[0].text) && /Leads/.test(cell[0].text) && /Team chat/.test(cell[0].text),
      JSON.stringify(cell[0]));
    check('an employee with nothing granted reads as no access',
      /No access/.test(cell[1].text), JSON.stringify(cell[1]));
    check('the column no longer prints a fixed row of stale section names',
      !/View All Requests/.test(cell[0].text + cell[1].text) && cell[0].badges <= 6,
      JSON.stringify(cell.map(c => c.badges)));
  }

  // ── The shape of the thing ──────────────────────────────────────────────────
  const shape = await page.evaluate(async () => {
    await openEmpModal(2);
    await new Promise(r => setTimeout(r, 300));
    const rows = document.querySelectorAll('.perm-row');
    const visibleChips = [...document.querySelectorAll('.perm-chips')]
      .filter(c => c.offsetParent !== null && c.closest('.perm-acts')).length;
    return {
      rows: rows.length,
      groups: document.querySelectorAll('[data-perm-group-box]').length,
      openActs: visibleChips,
      tally: (document.getElementById('perm-tally') || {}).textContent || '',
      presets: [...document.querySelectorAll('.perm-preset')].map(b => b.textContent.trim()),
      search: !!document.getElementById('perm-search'),
      // The rows a section is ON must look on.
      leadsOn: document.querySelector('[data-perm-section="leads"]').classList.contains('on'),
      leadsSum: document.querySelector('#perm-leads-sum').textContent.trim(),
      dealsSum: document.querySelector('#perm-deals-sum').textContent.trim(),
      chatSum: document.querySelector('#perm-chat-sum').textContent.trim(),
    };
  });
  check('every section renders as one row, grouped', shape.rows >= 20 && shape.groups >= 7,
    JSON.stringify({ rows: shape.rows, groups: shape.groups }));
  check('the actions stay closed until asked for — no wall of checkboxes',
    shape.openActs === 0, String(shape.openActs));
  check('each row says what it grants without being opened',
    /View, Create/.test(shape.leadsSum) && /No access/.test(shape.dealsSum)
    && /Full access|View, Send/.test(shape.chatSum),
    JSON.stringify([shape.leadsSum, shape.dealsSum, shape.chatSum]));
  check('a granted section reads as granted at a glance', shape.leadsOn === true);
  check('the header tallies sections and actions',
    /\d+ of \d+ sections/.test(shape.tally) && /actions/.test(shape.tally), shape.tally);
  check('there is a search box and a preset for common jobs',
    shape.search && shape.presets.includes('Sales rep') && shape.presets.includes('Full access')
    && shape.presets.includes('No access'), JSON.stringify(shape.presets));

  // ── Search: matches a section OR an action name ─────────────────────────────
  const search = await page.evaluate(async () => {
    const shown = () => [...document.querySelectorAll('[data-perm-section]')]
      .filter(r => r.style.display !== 'none').map(r => r.dataset.permSection);
    empPermSearch('huddle');            // an ACTION name, not a section name
    const byAction = shown();
    empPermSearch('supplier');
    const bySection = shown();
    const groupsShown = [...document.querySelectorAll('[data-perm-group-box]')]
      .filter(b => b.style.display !== 'none').length;
    empPermSearch('');
    return { byAction, bySection, groupsShown, restored: shown().length };
  });
  check('search finds a section by one of its ACTION names',
    search.byAction.includes('chat') && search.byAction.length <= 2, JSON.stringify(search.byAction));
  check('search narrows to the matching sections and hides empty groups',
    search.bySection.includes('suppliers') && search.groupsShown <= 2,
    JSON.stringify({ s: search.bySection, g: search.groupsShown }));
  check('clearing the search brings everything back', search.restored === shape.rows, String(search.restored));

  // ── It still saves what it always saved ─────────────────────────────────────
  saved = [];
  const roundTrip = await page.evaluate(async () => {
    // Open one section, grant an action through the chip, flip a section off.
    empPermExpand('leads');
    const chip = document.querySelector('.perm-act[data-section="leads"][data-action="export"]');
    chip.checked = true; chip.dispatchEvent(new Event('change'));
    const chatMaster = document.getElementById('perm-chat');
    chatMaster.checked = false; chatMaster.dispatchEvent(new Event('change'));
    const sumAfter = document.getElementById('perm-chat-sum').textContent.trim();
    const tallyAfter = document.getElementById('perm-tally').textContent;
    await saveEmployee(2);
    await new Promise(r => setTimeout(r, 250));
    return { sumAfter, tallyAfter };
  });
  check('turning a section off updates its summary immediately',
    /No access/.test(roundTrip.sumAfter), roundTrip.sumAfter);
  check('the tally follows every change', /\d+ of \d+ sections/.test(roundTrip.tallyAfter), roundTrip.tallyAfter);
  const body = saved[0] || {};
  check('the save carries the section map the server has always expected',
    body.permissions && body.permissions.leads === true && body.permissions.chat === false
    && body.permissions.leadsActions && body.permissions.leadsActions.export === true
    && body.permissions.leadsActions.create === true && body.permissions.leadsActions.delete === false,
    JSON.stringify(body.permissions && body.permissions.leadsActions));
  check('the save still carries the data scope',
    body.permissions && body.permissions.scope && Array.isArray(body.permissions.scope.dealStages),
    JSON.stringify(body.permissions && body.permissions.scope));

  // ── Presets: a starting point, expanded by the server ───────────────────────
  saved = [];
  const preset = await page.evaluate(async () => {
    await openEmpModal(3);
    await new Promise(r => setTimeout(r, 300));
    empApplyPreset('sales');
    await new Promise(r => setTimeout(r, 120));
    const on = k => document.getElementById('perm-' + k).checked;
    const act = (k, a) => document.querySelector(`.perm-act[data-section="${k}"][data-action="${a}"]`).checked;
    const salesShape = { leads: on('leads'), suppliers: on('suppliers'), stockView: act('stock', 'view'),
                         stockAll: on('stock'), leadsDelete: act('leads', 'delete') };
    empApplyPreset('none');
    await new Promise(r => setTimeout(r, 120));
    const noneOn = [...document.querySelectorAll('[data-perm-section]')]
      .filter(r => document.getElementById('perm-' + r.dataset.permSection).checked).length;
    empApplyPreset('everything');
    await new Promise(r => setTimeout(r, 120));
    const allOff = [...document.querySelectorAll('.perm-act')].filter(c => !c.checked).length;
    await saveEmployee(3);
    await new Promise(r => setTimeout(r, 250));
    return { salesShape, noneOn, allOff };
  });
  check('a preset grants the sections that job needs and not the others',
    preset.salesShape.leads === true && preset.salesShape.suppliers === false
    && preset.salesShape.leadsDelete === true, JSON.stringify(preset.salesShape));
  check('a preset can grant a section read-only',
    preset.salesShape.stockAll === true && preset.salesShape.stockView === true,
    JSON.stringify(preset.salesShape));
  check('"No access" clears every section', preset.noneOn === 0, String(preset.noneOn));
  check('"Full access" ticks every action', preset.allOff === 0, String(preset.allOff));
  check('a preset saves as a normal permission set',
    saved[0] && saved[0].permissions && saved[0].permissions.leads === true
    && saved[0].permissions.leadsActions.delete === true,
    JSON.stringify(saved[0] && saved[0].permissions && saved[0].permissions.leads));

  // ── The bulk editor is the same editor ──────────────────────────────────────
  saved = [];
  const bulk = await page.evaluate(async () => {
    PROCFG.closeModal();
    await openBulkPermsModal();
    await new Promise(r => setTimeout(r, 350));
    const hasToolbar = !!document.getElementById('perm-search') && !!document.getElementById('perm-tally');
    const rows = document.querySelectorAll('.perm-row').length;
    empApplyPreset('readonly');
    await new Promise(r => setTimeout(r, 120));
    const leadsEdit = document.querySelector('.perm-act[data-section="leads"][data-action="edit"]').checked;
    const leadsView = document.querySelector('.perm-act[data-section="leads"][data-action="view"]').checked;
    await applyBulkPerms();
    await new Promise(r => setTimeout(r, 250));
    return { hasToolbar, rows, leadsEdit, leadsView };
  });
  check('the bulk editor renders the same redesigned form',
    bulk.hasToolbar === true && bulk.rows === shape.rows, JSON.stringify(bulk));
  check('read-only really is read-only', bulk.leadsView === true && bulk.leadsEdit === false, JSON.stringify(bulk));
  check('applying in bulk posts the built permission set',
    saved[0] && saved[0].permissions && saved[0].permissions.leads === true
    && saved[0].permissions.leadsActions.edit === false, JSON.stringify(saved[0] && saved[0].employee_ids));

  check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));

  // ── Styling lives in the stylesheet, not in a thousand inline attributes ────
  {
    const css = fs.readFileSync('public/assets/dashboard.css', 'utf8');
    const js = fs.readFileSync('public/assets/dashboard.js', 'utf8');
    check('the editor is styled by classes in dashboard.css',
      /\.perm-row\b/.test(css) && /\.perm-switch\b/.test(css) && /\.perm-chip\b/.test(css)
      && /\.perm-toolbar\b/.test(css));
    check('the switch and the chips are real checkboxes, not stand-ins',
      /id="perm-\$\{sec\.key\}"/.test(js) && /class="perm-act"/.test(js));
    check('it collapses sensibly on a phone', /@media \(max-width:640px\)[\s\S]{0,400}\.perm-row-sum/.test(css));
    const srv = fs.readFileSync('src/routes/employee-portal.js', 'utf8');
    check('presets are expanded server-side from PERM_ACTIONS, not hardcoded in the page',
      /function permPresetPerms/.test(srv) && /presets: PERM_PRESETS\.map/.test(srv)
      && !/PERM_PRESETS/.test(js));
  }

  await browser.close();
  srv.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
