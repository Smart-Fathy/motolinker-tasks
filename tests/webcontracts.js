// The new app's Contracts screen whole: a real server (the real routes, grants, column settings, the deal that drafts a contract when
// it is won, and the PDF), the built app, a real browser. tests/contractdocs.js holds the server's side (what each route accepts and
// refuses, to whom, and the shape of every answer), apps/web's own tests hold the screen against a script, and tests/ctparity.js
// holds the look to the classic portals'. This is the three working together —
//
//   the list: a contract as a row (number, title, the mark of one a deal drafted, status by the administrator's label, date, the
//     buttons each grant gets), the empty and the failing page
//   a new contract: the starting form the server fills, what is refused, what is kept (the blanks at their places, the payment lines
//     exactly as typed, the contract's own number inside it), and the same through a lead picked in the form
//   an edit: what the form does not show is kept; the older wording's fields and its payment lines; the status
//   a lead's link (?lead=<id>) and the classic Leads page, still framed, handing a lead over
//   a deal that reaches Won: the server drafts a contract, and the list shows it as drafted for itself
//   the PDF: a real PDF in the administrator's preview and in the team's viewer, downloadable under the contract's number
//   what each grant gets, and the column editor over the contract's extra fields
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath, pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();   // (the server renders a contract's PDF in the same browser)
const fx = require('../tools/doc-fixtures/contract');
const { CONTRACT_PAYMENT_WHEN } = require('../packages/contracts').documents;

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-webcontracts-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

(async () => {
  const now = () => new Date().toISOString();
  const db = createFakeSupabase({ ...seedTables(parseSchema()) }, { serial: { contracts: 100, lead_activities: 100, notifications: 100 }, defaults: {
    contracts: () => ({ created_at: now(), updated_at: now(), title: '' }),
  } });
  db.install();
  const base = await bootApp({ port: process.env.PORT || 4009, env: { ML_WEB_DIST: dist } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));
  const T = db.tables;

  // who is asking: the administrator, and team members with different grants
  const grants = on => ({ view: false, create: false, edit: false, delete: false, export: false, ...on });
  const member = (id, name, perms) => ({ ...T.employees[0], id, name, username: name.toLowerCase(), job_title: 'Ops', permissions: perms, email: name.toLowerCase() + '@example.com', password_hash: ctx.hashPassword('pw-' + name.toLowerCase()) });
  const only = on => ({ contracts: true, contractsActions: grants(on) });
  const perms = {
    ana: { ...only({ view: true, create: true, edit: true, delete: true, export: true }), leads: true, leadsActions: grants({ view: true }) },
    ben: only({ view: true }),
    dee: only({ view: true, export: true }),
    eli: only({ view: true, create: true }),
  };
  T.employees = T.employees.filter(e => ![81, 82, 83, 84].includes(e.id)).concat([member(81, 'Ana', perms.ana), member(82, 'Ben', perms.ben), member(83, 'Dee', perms.dee), member(84, 'Eli', perms.eli)]);
  const sessionOf = (id, p) => ({ id, name: T.employees.find(e => e.id === id).name, username: T.employees.find(e => e.id === id).username, job_title: 'Ops', permissions: normEmpPerms(p), createdAt: Date.now() });
  const ADMIN = { who: 'admin', token: 'wct-admin', key: 'ml_admin_token', route: '/dashboard' };
  const member_ = (token, id, p) => ({ who: 'team', token, key: 'ml_emp_token', route: '/employee', id, p });
  const ANA = member_('wct-ana', 81, perms.ana), BEN = member_('wct-ben', 82, perms.ben), DEE = member_('wct-dee', 83, perms.dee), ELI = member_('wct-eli', 84, perms.eli);
  ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const m of [ANA, BEN, DEE, ELI]) ctx.employeeSessions.set(m.token, sessionOf(m.id, m.p));

  // what the screen holds
  const config = (key, cols) => { T.quotation_settings = T.quotation_settings.filter(r => r.key !== 'columns_config:' + key); T.quotation_settings.push({ key: 'columns_config:' + key, value: JSON.stringify(cols) }); };
  const savedConfig = key => { const r = T.quotation_settings.find(x => x.key === 'columns_config:' + key); return r ? JSON.parse(r.value) : null; };
  const SALE = (over = {}) => ({ ...fx.contract, ...over });
  const row = (id, no, over) => ({ id, contract_no: no, title: '', status: 'draft', customer_id: null, deal_id: null, created_by: 'admin', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', ...over });
  const reset = () => {
    T.contracts = [
      row(1, 'MC2610-1111', { title: 'عقد — عمر حسن محمود', status: 'signed', customer_id: 7, data: SALE({ contractNo: 'MC2610-1111', secretNote: 'keep me', custom_fields: { cf_ref: 'R-1', cf_secret: 'keep this' } }) }),
      row(2, 'MC2610-2222', { title: 'عقد — Mona Saleh', deal_id: 3, created_by: 'auto_won', created_at: '2026-10-03T10:00:00Z', customer_id: 7, data: SALE({ contractNo: 'MC2610-2222', buyer: { name: 'Mona Saleh' }, custom_fields: {} }) }),
      row(3, 'MC2610-3333', { title: 'عقد — قديم', status: 'cancelled', created_at: '2026-09-01T10:00:00Z', data: fx.contractLegacy }),
    ];
    T.customers = [
      { id: 7, name: 'Mona Saleh', phone: '010', address: 'Nasr City', car_in_question: 'BYD Seal Max', custom_fields: { cf_color: 'White / Black', cf_year: '2026', cf_national_id: '29001011234567' }, assigned_to: 81 },
      { id: 8, name: 'Ali Hassan', phone: '011', address: '', car_in_question: '', custom_fields: {}, assigned_to: 81 },
    ];
    T.deals = [{ id: 5, customer_id: 7, stage: 'negotiating', title: 'Seal deal', vehicle: 'BYD Seal Max', budget_egp: 1500000 }];
    T.lead_activities = [];
    const status = pairs => ({ key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: pairs.map(([key, label, color]) => ({ key, label, color })) });
    config('contracts', [status([['draft', 'Draft', '#b9b3a4'], ['signed', 'Signed', '#10b981'], ['cancelled', 'Cancelled', '#dc2626']]),
      { key: 'cf_ref', label: 'Reference', type: 'text', builtin: false, visible: true }, { key: 'cf_urgent', label: 'Urgent', type: 'checkbox', builtin: false, visible: true },
      { key: 'cf_secret', label: 'Internal', type: 'text', builtin: false, visible: false }]);
    db.failing.clear();
  };
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };
  const api = async (method, p, token, body) => {
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  // ── the browser ────────────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, screen) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failures = [];
    const asked = [];
    page.on('response', r => { if (r.status() === 401) failures.push(r.url()); });
    page.on('request', r => { if (/\/api\//.test(r.url())) asked.push(new URL(r.url()).pathname); });
    page.questions = [];
    // the page's own questions: confirm is answered yes (and kept), an alert is kept
    page.on('dialog', d => { page.questions.push(d.message()); return d.accept(); });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => {
      window.lucide = { createIcons() {} };
      window.Chart = function () { return { destroy() {}, update() {} }; };
      // a file handed to the browser is written down, not saved: its name and its address
      window.__downloads = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push({ download: this.download, href: this.href }); else click.call(this); };
    });
    await page.evaluateOnNewDocument((key, token) => { localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto(base + p.route + '/' + screen, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { failures, asked, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const part = name => `[data-part=${name}]`;
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim().replace(/\s+/g, ' ') : null; }, sel);
  const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const pressText = (page, scope, label) => page.evaluate((s, l) => { const b = [...document.querySelectorAll(s + ' button')].find(x => x.textContent.trim().startsWith(l)); if (!b) return false; b.click(); return true; }, scope, label);
  const type = async (page, sel, words) => { await page.waitForSelector(sel, { timeout: 15000 }); await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); if (words) await page.keyboard.type(words); };
  const value = (page, sel) => page.$eval(sel, e => e.value);
  const choose = async (page, trigger, label) => { await press(page, trigger); await until(page, () => !!document.querySelector('[role=option]'), null); await page.evaluate(l => [...document.querySelectorAll('[role=option]')].find(o => o.textContent.trim().startsWith(l)).click(), label); };
  const toast = (page, what) => until(page, w => [...document.querySelectorAll('[data-part=toast]')].some(e => e.textContent.includes(w)), what);
  const ready = page => until(page, () => !!document.querySelector('[data-part=list] [data-part=headRow], [data-part=list] [data-part=none], [data-part=list] [data-part=error]'), null);
  const rows = page => page.evaluate(() => [...document.querySelectorAll('[data-part=list] [data-part=row]')].map(r => [...r.children].map(c => c.textContent.trim().replace(/\s+/g, ' '))));
  const formOpen = page => until(page, () => !!document.querySelector('[data-part=dialog] [data-part=docForm] #ct-buyer-name'), null);
  const sheetGone = page => until(page, () => !document.querySelector('[data-part=dialog]'), null);
  const rowButton = (n, which) => `${part('list')} ${part('row')}:nth-child(${n}) ${part(which)}`;
  const downloads = page => page.evaluate(() => window.__downloads.slice());
  const headOf = (page, href) => page.evaluate(async h => { const r = await fetch(h); const b = new Uint8Array(await r.arrayBuffer()); return { start: String.fromCharCode(...b.slice(0, 4)), size: b.length }; }, href);
  const payAmounts = page => page.$$eval('[data-part=payRow] [data-pay=amount]', els => els.map(e => e.value));
  const dateOf = (page, iso) => page.evaluate(i => new Date(i).toLocaleDateString(), iso);

  // ═══ 1. the lists ════════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    const list = await rows(page);
    check('the contracts are drawn newest first: number, title (with the mark of the one a deal drafted), status by the label the administrator gave it, date, and the three buttons',
      JSON.stringify(list.map(r => [r[0], r[1], r[2], r[4]])) === JSON.stringify([
        ['MC2610-2222', 'عقد — Mona Saleh auto', 'Draft', 'Edit PDF Delete'], ['MC2610-1111', 'عقد — عمر حسن محمود', 'Signed', 'Edit PDF Delete'], ['MC2610-3333', 'عقد — قديم', 'Cancelled', 'Edit PDF Delete']]),
      JSON.stringify(list));
    check('…with the date each was made', list[0][3] === await dateOf(page, '2026-10-03T10:00:00Z') && list[2][3] === await dateOf(page, '2026-09-01T10:00:00Z'), JSON.stringify(list.map(r => r[3])));
    check('the page says what it is for, and offers a new contract', (await text(page, part('pageTitle'))) === 'Contracts' && /Arabic vehicle import contract/.test(await text(page, part('pageHint'))) && /Won\.$/.test(await text(page, part('pageHint'))) && !!(await page.$(part('add'))));
    check('none of it needed the app to ask for what it had no right to (no 401)', page.failures.length === 0, page.failures.join());
    await page.shut();

    const team = await open(ANA, 'contracts');
    await ready(team);
    const mine = await rows(team);
    check('the team reads the same contracts', mine.length === 3 && mine[0][0] === 'MC2610-2222' && mine.every(r => r[4] === 'Edit PDF Delete'), JSON.stringify(mine));
    check('…asking only the team\'s own routes, never the administrator\'s', team.asked.includes('/api/employee/contracts') && !team.asked.some(p => p.startsWith('/api/dashboard/')), JSON.stringify([...new Set(team.asked)]));
    await team.shut();
  }

  // ═══ 2. a new contract ═══════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    await press(page, part('add'));
    check('New contract opens a form the server filled: today\'s year, the company, one payment line with the standing wording',
      await formOpen(page) && /^20\d\d$/.test(await value(page, '#ct-contractDate-y')) && (await value(page, '#ct-company-name')) === 'MotoLinkers'
      && (await count(page, part('payRow'))) === 1 && (await value(page, '[data-part=payRow] [data-pay=when]')) === CONTRACT_PAYMENT_WHEN, await value(page, '#ct-contractDate-y'));
    await press(page, part('save'));
    check('a form with no buyer is turned away in the classic page\'s words, and nothing is sent', await until(page, () => /^Buyer name is required\.$/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null) && T.contracts.length === 3);
    await type(page, '#ct-buyer-name', ' Sara Adel ');
    await type(page, '#ct-buyer-nationalId', '29801011234567');
    await type(page, '#ct-vehicle-make', 'BYD');
    await type(page, '#ct-vehicle-model', 'Seal');
    await type(page, '#ct-total', '900000');
    await type(page, '[data-part=payRow]:nth-child(1) [data-pay=amount]', '300000');
    await press(page, part('addPay'));
    await until(page, () => document.querySelectorAll('[data-part=payRow]').length === 2, null);
    await type(page, '[data-part=payRow]:nth-child(2) [data-pay=amount]', '600000');
    await type(page, '[data-part=payRow]:nth-child(2) [data-pay=when]', 'on delivery');
    await press(page, part('save'));
    check('Save keeps the contract on the server — the blanks at their places, trimmed, the payment lines exactly as typed, its own number inside it, filed under the administrator, a draft',
      await waitFor(() => T.contracts.length === 4), String(T.contracts.length));
    const made = T.contracts.find(r => r.id > 3) || {};
    check('…the title is after the buyer, the data is the car-sale contract', made.title === 'عقد — Sara Adel' && made.status === 'draft' && made.created_by === 'admin' && made.customer_id === null && made.data.template === 'sale-v2'
      && made.data.buyer.name === 'Sara Adel' && made.data.buyer.nationalId === '29801011234567' && made.data.vehicle.make === 'BYD' && made.data.vehicle.model === 'Seal' && made.data.total === '900000', JSON.stringify(made));
    check('…the payment lines are the rows on screen, and the number it is printed under is in it', JSON.stringify(made.data.payments) === JSON.stringify([{ amount: '300000', when: CONTRACT_PAYMENT_WHEN, label: '' }, { amount: '600000', when: 'on delivery', label: '' }])
      && /^MC\d{4}-\d{4}$/.test(made.contract_no) && made.data.contractNo === made.contract_no, JSON.stringify(made.data.payments));
    check('the sheet goes and the list has it first', await sheetGone(page) && await until(page, n => document.querySelector('[data-part=list] [data-part=row]').children[1].textContent.includes('Sara Adel'), null) && (await rows(page)).length === 4);
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 3. an edit ══════════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    await press(page, rowButton(2, 'rowEdit'));
    check('Edit opens the record under its number, every blank where it was, its payment lines, its lead and its status by name',
      await formOpen(page) && (await text(page, '[data-part=dialog] [data-part=title]')) === 'Contract MC2610-1111' && (await value(page, '#ct-buyer-name')) === fx.contract.buyer.name && (await value(page, '#ct-total')) === fx.contract.total
      && (await count(page, part('payRow'))) === fx.contract.payments.length && (await value(page, '#ct-cf-cf_ref')) === 'R-1' && /Signed/.test(await text(page, '#ct-status')) && /Mona Saleh · 010/.test(await text(page, '#ct-customer-id')),
      await text(page, '#ct-customer-id'));
    await type(page, '#ct-buyer-name', 'عمر حسن');
    await choose(page, '#ct-status', 'Draft');
    await press(page, part('save'));
    const saved = () => T.contracts.find(r => r.id === 1);
    check('saving re-titles it after the buyer, changes the status, and never changes the number', await waitFor(() => saved().title === 'عقد — عمر حسن') && saved().status === 'draft' && saved().contract_no === 'MC2610-1111' && saved().data.contractNo === 'MC2610-1111', JSON.stringify(saved()).slice(0, 300));
    check('…and keeps what the form does not show: a field of the contract no row names, and the hidden extra field\'s words', saved().data.secretNote === 'keep me' && saved().data.custom_fields.cf_secret === 'keep this' && saved().data.custom_fields.cf_ref === 'R-1' && saved().customer_id === 7, JSON.stringify(saved().data.custom_fields));
    check('…and the payment lines as they were', JSON.stringify(saved().data.payments) === JSON.stringify(fx.contract.payments), JSON.stringify(saved().data.payments));
    check('the sheet goes', await sheetGone(page));

    // the older wording
    await press(page, rowButton(3, 'rowEdit'));
    const legacy = fx.contractLegacy;
    check('a contract on the older wording is offered the fields that wording had besides, and its payment lines as they are (no line to add or take away)',
      await formOpen(page) && (await value(page, '#ct-importCountry')) === String(legacy.importCountry) && (await value(page, '#ct-lateFee')) === String(legacy.lateFee) && (await count(page, part('payFixed'))) === legacy.payments.length
      && (await count(page, part('payRow'))) === 0 && !(await page.$(part('addPay'))), String(legacy.importCountry));
    await type(page, '[data-part=payFixed]:nth-child(1) input', '12345');
    await press(page, part('save'));
    const older = () => T.contracts.find(r => r.id === 3);
    check('saving changes only the amount, and writes no template and no number into it', await waitFor(() => older().data.payments[0].amount === '12345') && older().data.payments[0].when === legacy.payments[0].when && older().data.importCountry === legacy.importCountry && !('template' in older().data) && !('contractNo' in older().data), JSON.stringify(older().data.payments));
    await sheetGone(page);
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 4. a lead, picked in the form ═══════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    await press(page, part('add'));
    await formOpen(page);
    await choose(page, '#ct-customer-id', 'Mona Saleh');
    check('picking a lead fills the buyer — their name, ID and address — and the car they asked about, split into make and model',
      (await value(page, '#ct-buyer-name')) === 'Mona Saleh' && (await value(page, '#ct-buyer-nationalId')) === '29001011234567' && (await value(page, '#ct-buyer-address')) === 'Nasr City'
      && (await value(page, '#ct-vehicle-make')) === 'BYD' && (await value(page, '#ct-vehicle-model')) === 'Seal Max', await value(page, '#ct-buyer-name'));
    await press(page, part('save'));
    const made = () => T.contracts.find(r => r.id > 3);
    check('saved, the contract is attached to the lead, and the lead\'s history says a contract was made', await waitFor(() => !!made()) && made().customer_id === 7
      && await waitFor(() => T.lead_activities.some(a => a.customer_id === 7 && /Contract generated/.test(a.body))), JSON.stringify(T.lead_activities.map(a => a.body)));
    await page.shut();
  }

  // ═══ 5. a lead's link ════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts?lead=7');
    check('a contract made for a lead opens at once, filled from the lead (their name, ID, car), and the address is cleaned',
      await formOpen(page) && (await value(page, '#ct-buyer-name')) === 'Mona Saleh' && (await value(page, '#ct-vehicle-make')) === 'BYD' && (await value(page, '#ct-vehicle-model')) === 'Seal Max' && await until(page, () => !location.search, null), page.url());
    await press(page, part('save'));
    check('…and is attached to the lead when it is saved', await waitFor(() => T.contracts.some(r => r.id > 3 && r.customer_id === 7)), JSON.stringify(T.contracts.map(r => r.customer_id)));
    await page.shut();

    // …and from the classic Leads page, still framed: the button of a lead's drawer hands the lead over to the new screen
    const framed = await open(ADMIN, 'leads');
    await until(framed, () => (document.querySelector('iframe') || {}).dataset && document.querySelector('iframe').dataset.state === 'ready', null, 30000);
    const inside = framed.frames().find(f => /\/legacy\/dashboard/.test(f.url()));
    await inside.evaluate(() => { _ldProfile = { customer: { id: 7 } }; window.ldGenerateContract(); });
    check('the lead drawer\'s Contract button, in the framed classic Leads page, takes the person to the new screen with the form made for that lead',
      await until(framed, () => /\/dashboard\/contracts/.test(location.pathname) && !!document.querySelector('[data-part=dialog] [data-part=docForm] #ct-buyer-name') && !document.querySelector('iframe'), null, 30000)
      && (await value(framed, '#ct-buyer-name')) === 'Mona Saleh' && await until(framed, () => !location.search, null), framed.url());
    await framed.shut();
  }

  // ═══ 6. a deal that reaches Won ══════════════════════════════════════════════════════════
  reset();
  {
    const moved = await api('PUT', '/api/dashboard/deals/5', ADMIN.token, { stage: 'won' });
    const auto = () => T.contracts.find(r => r.deal_id === 5);
    check('a deal moved to Won drafts a contract for itself, filed under the system', moved.status === 200 && await waitFor(() => !!auto()) && auto().created_by === 'auto_won' && auto().customer_id === 7 && auto().status === 'draft', JSON.stringify(auto()));
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    const list = await rows(page);
    check('the list shows it as drafted for itself, the lead as its buyer', list.some(r => r[0] === auto().contract_no && /auto$/.test(r[1]) && /Mona Saleh/.test(r[1])) && (await count(page, part('auto'))) === 2, JSON.stringify(list.map(r => r[1])));
    const at = list.findIndex(r => r[0] === auto().contract_no) + 1;
    await press(page, rowButton(at, 'rowEdit'));
    check('…and it opens as a contract made of the deal: the buyer, the car and the budget', await formOpen(page) && (await value(page, '#ct-buyer-name')) === 'Mona Saleh' && (await value(page, '#ct-vehicle-make')) === 'BYD' && (await value(page, '#ct-total')) === String(auto().data.total) && String(auto().data.total) !== '', await value(page, '#ct-total'));
    await page.shut();
  }

  // ═══ 7. the PDF ══════════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    await press(page, rowButton(2, 'rowExport'));
    check('PDF on a row opens the administrator\'s preview at once and fills it with that contract\'s PDF', await until(page, () => !!document.querySelector('[data-part=docCard]'), null) && await until(page, () => !!document.querySelector('[data-part=docFrame]'), null) && (await text(page, part('docTitleText'))) === 'Contract Preview');
    const src = await page.$eval(part('docFrame'), f => f.getAttribute('src'));
    const head = await headOf(page, src);
    check('…a real PDF', /^blob:/.test(src) && head.start === '%PDF' && head.size > 500, JSON.stringify(head));
    await press(page, part('docDownload'));
    check('Download PDF hands the browser the PDF under the contract\'s number', await until(page, () => window.__downloads.length === 1, null) && (await downloads(page))[0].download === 'Contract_MC2610-1111.pdf', JSON.stringify(await downloads(page)));
    await press(page, part('docClose'));
    check('Close puts the preview away', await until(page, () => !document.querySelector('[data-part=docCard]'), null));
    await press(page, rowButton(3, 'rowExport'));
    check('a contract on the older wording is made into a PDF too', await until(page, () => !!document.querySelector('[data-part=docFrame]'), null));
    await page.keyboard.press('Escape');
    check('Escape closes it', await until(page, () => !document.querySelector('[data-part=docCard]'), null));
    await press(page, rowButton(1, 'rowEdit'));
    await formOpen(page);
    await type(page, '#ct-buyer-name', 'Mona Said');
    await press(page, part('savePreview'));
    check('Save & preview PDF saves the contract, puts the form away and shows the PDF of what was saved', await waitFor(() => T.contracts.find(r => r.id === 2).title === 'عقد — Mona Said') && await sheetGone(page) && await until(page, () => !!document.querySelector('[data-part=docFrame]'), null) && (await text(page, part('docTitleText'))) === 'Contract Preview');
    check('none of it signed anybody out', page.failures.length === 0, page.failures.join());
    await page.shut();

    const team = await open(ANA, 'contracts');
    await ready(team);
    await press(team, rowButton(2, 'rowExport'));
    check('the team\'s PDF is in the viewer the team has for every document, titled with the contract\'s number',
      await until(team, () => !!document.querySelector('[data-part=docFrame]'), null) && (await text(team, part('docTitleText'))) === 'Contract MC2610-1111' && (await text(team, part('docDownload'))) === 'Download');
    const tsrc = await team.$eval(part('docFrame'), f => f.getAttribute('src'));
    check('…a real PDF, downloadable under the number', (await headOf(team, tsrc)).start === '%PDF');
    await press(team, part('docDownload'));
    check('…', await until(team, () => window.__downloads.length === 1, null) && (await downloads(team))[0].download === 'Contract_MC2610-1111.pdf', JSON.stringify(await downloads(team)));
    check('none of it signed anybody out', team.failures.length === 0, team.failures.join());
    await team.shut();
  }

  // ═══ 8. deleting ═════════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    await press(page, rowButton(3, 'rowDelete'));
    check('Delete asks (by number) and then it is gone from the server and the list', await waitFor(() => !T.contracts.some(r => r.contract_no === 'MC2610-3333')) && await until(page, () => document.querySelectorAll('[data-part=list] [data-part=row]').length === 2, null) && page.questions.includes('Delete contract MC2610-3333?'), JSON.stringify(page.questions));
    db.failing.add('contracts');
    await press(page, rowButton(1, 'rowDelete'));
    check('a delete the server refuses says so, in its words, in a notice', await toast(page, 'simulated database failure') && T.contracts.length === 2);
    db.failing.clear();
    await page.shut();
  }

  // ═══ 9. what each grant gets ═════════════════════════════════════════════════════════════
  reset();
  {
    const ben = await open(BEN, 'contracts');
    await ready(ben);
    check('a member who may only view reads the contracts and is offered no button: no New contract, no Edit, no PDF, no Delete', (await rows(ben)).length === 3 && (await rows(ben)).every(r => r[4] === '') && !(await ben.$(part('add'))));
    check('…and asked only the team\'s own routes', ben.asked.includes('/api/employee/contracts') && !ben.asked.some(p => p.startsWith('/api/dashboard/')), JSON.stringify([...new Set(ben.asked)]));
    await ben.shut();
    const dee = await open(DEE, 'contracts');
    await ready(dee);
    check('a member who may only export is offered the PDF and nothing else', (await rows(dee)).every(r => r[4] === 'PDF') && !(await dee.$(part('add'))));
    await press(dee, rowButton(2, 'rowExport'));
    check('…and the PDF is made for her (the export grant is the one it needs, not the view)', await until(dee, () => !!document.querySelector('[data-part=docFrame]'), null) && (await text(dee, part('docTitleText'))) === 'Contract MC2610-1111');
    await dee.shut();
    const eli = await open(ELI, 'contracts');
    await ready(eli);
    check('a member who may only create is offered New contract and no row button', !!(await eli.$(part('add'))) && (await rows(eli)).every(r => r[4] === ''));
    await press(eli, part('add'));
    check('…and her form is made from the starting form, which is hers to ask for', await formOpen(eli));
    await eli.shut();
    const ana = await open(ANA, 'contracts');
    await ready(ana);
    check('a member who may do it all has all three buttons and New', (await rows(ana)).every(r => r[4] === 'Edit PDF Delete') && !!(await ana.$(part('add'))));
    await press(ana, part('add'));
    await formOpen(ana);
    check('…but the controls over the columns are the administrator\'s: she has no Columns, no + Field', (await count(ana, `${part('dialog')} ${part('colsButton')}`)) === 0 && (await count(ana, `${part('dialog')} ${part('fieldButton')}`)) === 0);
    await choose(ana, '#ct-customer-id', 'Mona Saleh');
    check('…her lead list is her own: the leads assigned to her, from the team\'s route', (await value(ana, '#ct-buyer-name')) === 'Mona Saleh' && ana.asked.includes('/api/employee/leads') && !ana.asked.includes('/api/dashboard/customers'), JSON.stringify([...new Set(ana.asked)]));
    check('none of it asked for what is not hers (no 401)', ana.failures.length === 0, ana.failures.join());
    await ana.shut();
  }

  // ═══ 10. the column editor, over a contract ══════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    await press(page, part('add'));
    await formOpen(page);
    check('the administrator is offered Columns and + Field over the contract\'s extra fields', (await count(page, `${part('dialog')} ${part('colsButton')}`)) === 1 && (await count(page, `${part('dialog')} ${part('fieldButton')}`)) === 1 && (await text(page, part('extrasHead'))).startsWith('Additional fields'));
    await press(page, `${part('dialog')} ${part('fieldButton')}`);
    await until(page, () => !!document.querySelector('[data-part=ceDialog]'), null);
    await type(page, part('ceName'), 'Customs code');
    await page.click(part('ceRequired'));
    await pressText(page, part('ceFoot'), 'Add column');
    check('+ Field adds a required field to every contract: it is kept on the server and drawn in the form', await waitFor(() => (savedConfig('contracts') || []).some(c => c.key === 'cf_customs_code' && c.required === true)) && await until(page, () => !!document.querySelector('#ct-cf-cf_customs_code'), null));
    await page.keyboard.press('Escape');
    await sheetGone(page);
    await page.shut();

    const ana = await open(ANA, 'contracts');
    await ready(ana);
    await press(ana, part('add'));
    await formOpen(ana);
    check('the team reads it: the field is in her form, marked as required', await until(ana, () => !!document.querySelector('#ct-cf-cf_customs_code'), null) && /Customs code \*/.test(await text(ana, part('extras'))), await text(ana, part('extras')));
    await type(ana, '#ct-buyer-name', 'Sara Adel');
    await press(ana, part('save'));
    check('she cannot save without it: the form says which, by name', await until(ana, () => /^Required: Customs code$/.test((document.querySelector('[data-part=formError]') || {}).textContent || ''), null) && T.contracts.length === 3);
    await type(ana, '#ct-cf-cf_customs_code', '8703');
    await press(ana, part('save'));
    check('with it filled, the contract is kept with the field\'s words — made by her, for the team to see', await waitFor(() => T.contracts.some(r => r.id > 3 && r.data.custom_fields && r.data.custom_fields.cf_customs_code === '8703' && /81|Ana/.test(r.created_by))), JSON.stringify(T.contracts.map(r => [r.id, r.created_by])));
    check('none of it signed anybody out', ana.failures.length === 0, ana.failures.join());
    await ana.shut();
  }

  // ═══ 11. when the list cannot be had ═════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN, 'contracts');
    await ready(page);
    db.failing.add('contracts');
    await page.evaluate(() => document.querySelector('[data-screen=home]').click());
    await until(page, () => !document.querySelector('[data-part=docPage]'), null);
    await page.evaluate(() => document.querySelector('[data-screen=contracts]').click());
    check('a database that does not answer is said, in its words, with where to look for a table that was never made', await until(page, () => !!document.querySelector('[data-part=error]'), null) && /simulated database failure/.test(await text(page, part('error'))) && /migrations\/001_stock_specs_colors_contracts\.sql/.test(await text(page, part('error'))), await text(page, part('error')));
    db.failing.clear();
    T.contracts = [];
    await page.evaluate(() => document.querySelector('[data-screen=home]').click());
    await until(page, () => !document.querySelector('[data-part=docPage]'), null);
    await page.evaluate(() => document.querySelector('[data-screen=contracts]').click());
    check('no contracts yet says so, tells how one is made, and keeps the way to make one', await until(page, () => !!document.querySelector('[data-part=none]'), null) && /^No contracts yet\./.test(await text(page, part('none'))) && /move a deal to Won/.test(await text(page, part('none'))) && !!(await page.$(part('add'))));
    await page.shut();
  }

  await browser.close();
  fs.rmSync(dist, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
