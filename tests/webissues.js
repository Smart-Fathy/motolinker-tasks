// The new app's Issues centre, whole: a real server (the real routes, uploads and notifications, an in-memory database), the built
// app, a real browser. tests/issues.js holds the server's side (what each route answers, to whom, and what it tells); apps/web's own
// tests hold the screen against a script; tests/issparity.js holds the look to the classic team page's. This is the three working
// together —
//
//   the CTO by title, granted nothing, has the centre in her rail: the queue, a ticket, its conversation
//   a reply is stored under her name and the reporter is told; closing a ticket and reopening it are stored, the reporter told once
//   a team member who is not in the centre reports a ticket with a screenshot, from the foot of the rail and from the account menu:
//     the file is stored, the ticket kept, every CTO told — and the form says what is wrong before it asks
//   a reader may answer but not close, and the server refuses when the button is not there
//   the admin has the centre too (the classic admin portal never did): the same page, replies and closing under "Admin"
//   a server that cannot read the tickets says so; the classic routes see what the app did (one service)
//   a link to #issues, as the notifications carry, opens the centre
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath } = require('./helpers/browser');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-issues-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// A picture one pixel across: a file the browser can attach.
const PNG = path.join(dist, 'shot.png');
fs.writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

(async () => {
  const at = d => new Date(Date.UTC(2026, 8, d, 9, 30)).toISOString();
  const db = createFakeSupabase(seedTables(parseSchema()), {
    serial: { issues: 100, issue_comments: 100 },
    defaults: {
      notifications: () => ({ read: false }),
      issues: () => ({ status: 'open', file_url: '', description: '', resolved_at: null, resolved_by: '' }),
      issue_comments: () => ({ file_url: '', file_name: '', file_type: '', file_size: null }),
    },
  });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3967, env: { ML_WEB_DIST: dist } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));

  // ── the people ───────────────────────────────────────────────────────────────────────────
  //   Ana    reports tickets; is in no centre             Cleo  the Chief Technical Officer, by title, granted nothing
  //   Dan    manages the centre by permission             Eli   may read it, not close
  const RAW = { 71: {}, 72: {}, 73: { issues: true, issuesActions: { view: true, resolve: true } }, 74: { issues: true, issuesActions: { view: true } } };
  const person = (id, name, title) => ({ ...db.tables.employees[0], id, name, username: name.toLowerCase(), job_title: title, permissions: RAW[id], email: name.toLowerCase() + '@example.com' });
  db.tables.employees = db.tables.employees.filter(e => !RAW[e.id]).concat([person(71, 'Ana', 'Sales'), person(72, 'Cleo', 'Chief Technical Officer'), person(73, 'Dan', 'Support'), person(74, 'Eli', 'Support')]);
  const PEOPLE = {
    admin: { portal: 'admin', token: 'wi-admin', key: 'ml_admin_token', route: '/dashboard' },
    ana: { portal: 'team', token: 'wi-ana', key: 'ml_emp_token', route: '/employee', id: 71, name: 'Ana' },
    cleo: { portal: 'team', token: 'wi-cleo', key: 'ml_emp_token', route: '/employee', id: 72, name: 'Cleo' },
    dan: { portal: 'team', token: 'wi-dan', key: 'ml_emp_token', route: '/employee', id: 73, name: 'Dan' },
    eli: { portal: 'team', token: 'wi-eli', key: 'ml_emp_token', route: '/employee', id: 74, name: 'Eli' },
  };
  ctx.sessions.set(PEOPLE.admin.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const p of Object.values(PEOPLE)) if (p.id) {
    const e = db.tables.employees.find(x => x.id === p.id);
    ctx.employeeSessions.set(p.token, { id: e.id, name: e.name, username: e.username, job_title: e.job_title, permissions: normEmpPerms(RAW[e.id]), createdAt: Date.now() });
  }

  const seed = () => {
    db.tables.issues.splice(0, db.tables.issues.length,
      { id: 1, title: 'Barcode scanner is dead', description: 'It beeps twice and stops.', file_url: '', reporter_id: 71, reporter_name: 'Ana', status: 'open', created_at: at(1), resolved_at: null, resolved_by: '' },
      { id: 2, title: 'Sheet export', description: '', file_url: '', reporter_id: 71, reporter_name: 'Ana', status: 'resolved', created_at: at(2), resolved_at: at(5), resolved_by: 'Cleo' },
      { id: 3, title: 'Printer jammed', description: 'Paper stuck in tray 2.', file_url: '', reporter_id: 74, reporter_name: 'Eli', status: 'open', created_at: at(3), resolved_at: null, resolved_by: '' });
    db.tables.issue_comments.splice(0, db.tables.issue_comments.length,
      { id: 1, issue_id: 1, author_key: 'employee_72', author_name: 'Cleo', body: 'Swap the cable.', file_url: '', file_name: '', file_size: null, file_type: '', created_at: at(10) },
      { id: 2, issue_id: 1, author_key: 'employee_71', author_name: 'Ana', body: 'Done, still dead.', file_url: '', file_name: '', file_size: null, file_type: '', created_at: at(11) });
    db.tables.notifications.splice(0);
    db.storage.clear();
    db.failing.clear(); db.latency = 0;
  };
  seed();
  const issue = id => db.tables.issues.find(i => i.id === id);
  const told = member => db.tables.notifications.filter(n => n.member_key === member);
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };

  // ── the browser ──────────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, url) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const requests = [];
    page.on('request', r => { if (/\/api\/v1\/issues/.test(r.url())) requests.push({ method: r.method(), url: r.url().replace(base, ''), type: r.headers()['content-type'] || '' }); });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; }; });
    await page.evaluateOnNewDocument((key, token) => { localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 800 });
    await page.goto(base + p.route + (url || '/home'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { requests, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel);
  const where = page => page.evaluate(() => location.pathname);
  const screens = page => page.evaluate(() => [...document.querySelectorAll('[data-part=item],[data-part=itemActive]')].map(e => e.dataset.screen));
  const toasts = page => page.evaluate(() => [...document.querySelectorAll('[data-part=toast]')].map(e => e.textContent.trim()));
  const titles = page => page.evaluate(() => [...document.querySelectorAll('[data-part=card] [data-part=cardTitle]')].map(e => e.textContent.trim()));
  const card = (page, title) => page.evaluate(t => { const c = [...document.querySelectorAll('[data-part=card]')].find(e => e.textContent.includes(t)); if (!c) return false; c.click(); return true; }, title);
  const buttons = page => page.evaluate(() => [...document.querySelectorAll('[data-part=detail] button')].map(b => b.textContent.trim()));
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const type = async (page, sel, words) => { await page.click(sel); await page.keyboard.type(words); };
  const api = async (method, urlPath, token, body) => {
    const r = await fetch(base + urlPath, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const raw = await r.text();
    let json = null; try { json = JSON.parse(raw); } catch (_) { /* not JSON */ }
    return { status: r.status, body: json };
  };

  // ═══ 1. the CTO, by title: the centre, a reply, closing and reopening ════════════════════
  {
    seed();
    const page = await open(PEOPLE.cleo);
    check('the CTO by title, granted nothing, has Issues in her rail, beside Notifications', (await screens(page)).join().endsWith('notifications,issues'), (await screens(page)).join());
    await press(page, '[data-screen=issues]');
    check('…and it opens the centre: three tickets, newest first, and how many are still open', await until(page, () => document.querySelectorAll('[data-part=card]').length === 3) && (await titles(page)).join('|') === 'Printer jammed|Sheet export|Barcode scanner is dead' && await text(page, '[data-part=sub]') === '2 still open' && await where(page) === '/employee/issues', (await titles(page)).join('|'));
    check('the queue was asked of /api/v1 once', page.requests.filter(r => r.method === 'GET' && r.url === '/api/v1/issues').length === 1, JSON.stringify(page.requests));
    check('no ticket is picked until one is', (await text(page, '[data-part=paneEmpty]')) === 'Pick a ticket to read it and reply.');

    await card(page, 'Barcode scanner is dead');
    check('a ticket shows who reported it and what they said, and its conversation, oldest first', await until(page, () => document.querySelectorAll('[data-part=msg]').length === 2) && (await text(page, '[data-part=dBody]')) === 'It beeps twice and stops.' && await page.evaluate(() => [...document.querySelectorAll('[data-part=msgBody]')].map(e => e.textContent).join('|')) === 'Swap the cable.|Done, still dead.');
    check('…and the buttons: Send and Mark solved', (await buttons(page)).join('|') === 'Send|Mark solved', (await buttons(page)).join('|'));

    await type(page, '[data-part=reply] textarea', 'On it — a new unit is on its way.');
    await press(page, '[data-part=send]');
    check('a reply is stored under her name, and appears in the conversation', await waitFor(() => db.tables.issue_comments.some(c => c.issue_id === 1 && c.body === 'On it — a new unit is on its way.' && c.author_key === 'employee_72' && c.author_name === 'Cleo')) && await until(page, () => document.querySelectorAll('[data-part=msg]').length === 3));
    check('…the box is empty again', (await page.evaluate(() => document.querySelector('[data-part=reply] textarea').value)) === '');
    check('…and the reporter is told (Ana), not Cleo herself', told('employee_71').some(n => /Cleo commented on: Barcode scanner is dead/.test(n.title) && n.url === '/employee#issues') && told('employee_72').length === 0, JSON.stringify(db.tables.notifications.map(n => [n.member_key, n.title])));

    await press(page, '[data-part=toggle]');
    check('Mark solved is stored with who closed it, and the reporter is told once', await waitFor(() => issue(1).status === 'resolved' && issue(1).resolved_by === 'Cleo' && !!issue(1).resolved_at) && await waitFor(() => told('employee_71').filter(n => /^Solved: Barcode scanner is dead/.test(n.title)).length === 1));
    check('…the person is told so, and the card, the count and the button follow', await until(page, () => /Marked solved/.test(document.querySelector('[data-part=toast]')?.textContent || '')) && await text(page, '[data-part=sub]') === '1 still open' && (await buttons(page)).join('|') === 'Send|Reopen');
    check('…and says who solved it, and when', /^Solved by Cleo · /.test(await text(page, '[data-part=dSolved]') || ''));

    await press(page, '[data-part=toggle]');
    check('Reopen is stored, with nobody recorded as having closed it', await waitFor(() => issue(1).status === 'open' && issue(1).resolved_by === '' && issue(1).resolved_at === null) && await until(page, () => /Reopened/.test([...document.querySelectorAll('[data-part=toast]')].map(e => e.textContent).join())));
    await press(page, '[data-part=toggle]');
    await waitFor(() => issue(1).status === 'resolved');
    check('closing it again tells nobody again…', told('employee_71').filter(n => /^Solved: Barcode scanner is dead/.test(n.title)).length === 2, 'it was reopened and closed, so a second notice is right');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=card]', { timeout: 20000 });
    check('after a reload the queue is what the server holds', (await text(page, '[data-part=sub]')) === '1 still open' && (await titles(page)).length === 3);
    await page.shut();
  }

  // ═══ 2. a team member reports a ticket ═══════════════════════════════════════════════════
  {
    seed();
    const page = await open(PEOPLE.ana);
    check('a team member who is not in the centre has no Issues in the rail', !(await screens(page)).includes('issues'), (await screens(page)).join());
    await page.goto(base + '/employee/issues', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    await sleep(500);
    check('…and the address of the centre does not open it for her', !(await page.$('[data-part=issuesPage]')) && !page.requests.some(r => r.method === 'GET' && r.url === '/api/v1/issues'), JSON.stringify(page.requests));

    await press(page, '[data-part=reportIssue]');
    check('"Report an Issue" at the foot of the rail opens the form, which says who it goes to', await until(page, () => !!document.querySelector('[role=dialog]')) && /Chief Technical Officer/.test(await text(page, '[role=dialog] [data-part=hint]') || ''));
    await press(page, '[data-part=submit]');
    check('an empty form says what is wrong and sends nothing', await until(page, () => /Please describe the issue/.test([...document.querySelectorAll('[data-part=toast]')].map(e => e.textContent).join())) && page.requests.filter(r => r.method === 'POST').length === 0);

    await type(page, '[data-part=summary]', 'Cannot log hours');
    await type(page, '[data-part=details]', 'The button does nothing.');
    await (await page.$('[data-part=dialog] input[type=file]')).uploadFile(PNG);
    check('a chosen file is named under the paperclip', await until(page, () => /shot\.png/.test(document.querySelector('[data-part=fileHint]')?.textContent || '')));
    await press(page, '[data-part=submit]');
    check('sending stores the ticket under her name, with the file in the store', await waitFor(() => db.tables.issues.some(i => i.title === 'Cannot log hours' && i.reporter_id === 71 && i.reporter_name === 'Ana' && i.status === 'open' && /\/storage\/v1\/object\/public\/chat-files\/issues\/\d+_shot\.png$/.test(i.file_url))), JSON.stringify(db.tables.issues.map(i => [i.id, i.title, i.file_url])));
    check('…the file went to the chat-files bucket under issues/, as an image', [...db.storage.entries()].some(([k, v]) => /^chat-files\/issues\/\d+_shot\.png$/.test(k) && v.contentType === 'image/png'), [...db.storage.keys()].join());
    check('…the request was a form (the browser wrote its boundary), not JSON', page.requests.some(r => r.method === 'POST' && r.url === '/api/v1/issues' && /^multipart\/form-data; boundary=/.test(r.type)), JSON.stringify(page.requests));
    check('…every CTO is told, with the link to the centre, and the reporter is not', told('employee_72').some(n => n.type === 'issue' && /^Issue reported by Ana: Cannot log hours/.test(n.title) && n.url === '/employee#issues') && told('employee_71').length === 0, JSON.stringify(db.tables.notifications.map(n => [n.member_key, n.title])));
    check('…she is thanked, and the form has gone', await until(page, () => /Ticket sent to the CTO — thank you!/.test([...document.querySelectorAll('[data-part=toast]')].map(e => e.textContent).join())) && !(await page.$('[role=dialog]')));

    await press(page, '[data-part=profileBtn]');
    await page.evaluate(() => [...document.querySelectorAll('[data-part=profileMenu] button')].find(b => /Report an issue/.test(b.textContent)).click());
    check('"Report an issue" in her account menu opens the same form, empty, and the menu closes behind it', await until(page, () => !!document.querySelector('[role=dialog]')) && (await page.evaluate(() => document.querySelector('[data-part=summary]').value)) === '' && !(await page.$('[data-part=profileMenu]')));
    await page.keyboard.press('Escape');
    check('Escape closes it', await until(page, () => !document.querySelector('[role=dialog]')));
    await page.shut();
  }

  // ═══ 3. who may close a ticket ═══════════════════════════════════════════════════════════
  {
    seed();
    const eli = await open(PEOPLE.eli, '/issues');
    await eli.waitForSelector('[data-part=card]', { timeout: 20000 });
    await card(eli, 'Barcode scanner is dead');
    await until(eli, () => document.querySelectorAll('[data-part=msg]').length === 2);
    check('a reader may answer a ticket but is not offered Mark solved', (await buttons(eli)).join('|') === 'Send', (await buttons(eli)).join('|'));
    const refused = await api('PATCH', '/api/v1/issues/1', PEOPLE.eli.token, { status: 'resolved' });
    check('…and the server refuses when it is asked anyway, leaving the ticket open', refused.status === 403 && issue(1).status === 'open', JSON.stringify(refused));
    await type(eli, '[data-part=reply] textarea', 'Same here.');
    await press(eli, '[data-part=send]');
    check('…a reader\'s reply is stored under the reader\'s name', await waitFor(() => db.tables.issue_comments.some(c => c.body === 'Same here.' && c.author_key === 'employee_74')));
    await eli.shut();

    const dan = await open(PEOPLE.dan, '/issues');
    await dan.waitForSelector('[data-part=card]', { timeout: 20000 });
    await card(dan, 'Printer jammed');
    await until(dan, () => !!document.querySelector('[data-part=toggle]'));
    await press(dan, '[data-part=toggle]');
    check('somebody granted the centre closes a ticket by permission, and the reporter (Eli) is told', await waitFor(() => issue(3).status === 'resolved' && issue(3).resolved_by === 'Dan') && await waitFor(() => told('employee_74').some(n => /^Solved: Printer jammed/.test(n.title))));
    await dan.shut();

    const ana = await api('GET', '/api/v1/issues', PEOPLE.ana.token);
    check('and a team member in no centre cannot read the queue, whatever the address says', ana.status === 403, JSON.stringify(ana));
  }

  // ═══ 4. the admin: the centre the classic admin portal never had ═════════════════════════
  {
    seed();
    const page = await open(PEOPLE.admin, '/issues');
    await page.waitForSelector('[data-part=card]', { timeout: 20000 });
    check('the admin has Issues in the System section, between Notifications and Workspace', await page.evaluate(() => [...document.querySelectorAll('[data-group=system] [data-screen]')].map(e => e.dataset.screen).join()) === 'notifications,issues,workspace');
    check('…and has no "Report an Issue" button: the admin portal never had one', !(await page.$('[data-part=reportIssue]')));
    await card(page, 'Barcode scanner is dead');
    await until(page, () => document.querySelectorAll('[data-part=msg]').length === 2);
    await type(page, '[data-part=reply] textarea', 'Admin here.');
    await press(page, '[data-part=send]');
    check('an admin\'s reply is stored as "Admin", and the reporter is told', await waitFor(() => db.tables.issue_comments.some(c => c.body === 'Admin here.' && c.author_key === 'admin' && c.author_name === 'Admin')) && await waitFor(() => told('employee_71').some(n => /^Admin commented on:/.test(n.title))));
    await press(page, '[data-part=toggle]');
    check('closing a ticket records "Admin" as who did', await waitFor(() => issue(1).status === 'resolved' && issue(1).resolved_by === 'Admin') && await waitFor(() => told('employee_71').some(n => /^Solved: Barcode scanner is dead/.test(n.title) && /Admin marked the issue/.test(n.body))));
    await page.shut();
  }

  // ═══ 5. a server that cannot read the tickets; one service for both portals ══════════════
  {
    seed();
    db.failing.add('issues');
    const page = await open(PEOPLE.cleo, '/issues');
    check('says so in the queue, in the server\'s words, rather than "all clear", which would be untrue', await until(page, () => /unavailable right now/.test(document.querySelector('[data-part=list]')?.textContent || ''), null, 30000));
    check('…and the page keeps its own line under the title', await text(page, '[data-part=sub]') === 'Tickets the team raised from “Report an issue”');
    db.failing.delete('issues');
    await page.reload({ waitUntil: 'domcontentloaded' });
    check('…and has the tickets once the server can read them', await until(page, () => document.querySelectorAll('[data-part=card]').length === 3, null, 20000));
    await card(page, 'Barcode scanner is dead');
    await until(page, () => document.querySelectorAll('[data-part=msg]').length === 2);
    await type(page, '[data-part=reply] textarea', 'Seen from both sides.');
    await press(page, '[data-part=send]');
    await waitFor(() => db.tables.issue_comments.some(c => c.body === 'Seen from both sides.'));
    const classic = await api('GET', '/api/employee/issues/1/comments', PEOPLE.cleo.token);
    check('the classic route sees what the app did (one service)', classic.status === 200 && classic.body.some(c => c.body === 'Seen from both sides.' && c.author_name === 'Cleo'), JSON.stringify(classic));
    await page.shut();
  }

  // ═══ 6. a link to #issues ════════════════════════════════════════════════════════════════
  {
    seed();
    const page = await open(PEOPLE.cleo, '');
    await page.goto(base + '/employee#issues', { waitUntil: 'domcontentloaded' });
    check('a link to #issues, as the notifications carry, opens the centre', await until(page, () => location.pathname === '/employee/issues' && !!document.querySelector('[data-part=issuesPage]')), await where(page));
    await page.shut();
  }

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
