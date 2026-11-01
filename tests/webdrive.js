// The new app's My Drive and My Sheets whole: a real server (the real routes, grants, the OAuth round trip and the token table), the
// built app, a real browser. tests/driveroutes.js holds the server's side (who may ask what, what Google is asked and what is kept),
// apps/web's own tests hold the screens against a script, and tests/gdparity.js holds the look to the classic portals'. This is the
// three working together, in both portals —
//
//   linking an account: the button, the trip to Google and back (Google is stood in for: its consent screen answers at once, the
//     server trades the code for tokens and asks who the person is of a stand-in too), and the screen the person comes back to
//   the files: a row for each, the picture of each kind, the count, the viewer over the page and what it is pointed at, the spreadsheets
//   letting go: the row emptied in the table, the screen asking again, and the answer still there after a reload
//   what each grant gets in the team's page: see the files, link an account, read spreadsheets without the Drive status
//   what Google refusing looks like, and a server with no Google project set up (a second process: the project is read when it starts)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const { chromePath, pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();

const UNCONFIGURED = process.argv.includes('--unconfigured');
const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-webdrive-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

const SHEET = 'application/vnd.google-apps.spreadsheet';
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const LISTING = [
  { id: 'f1', name: 'Price list.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-09-20T09:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/f1/view' },
  { id: 'f2', name: 'Stock count', mimeType: SHEET, modifiedTime: '2026-09-19T09:00:00.000Z', webViewLink: 'https://docs.google.com/spreadsheets/d/f2/edit' },
  { id: 'f3', name: 'Shared with nobody', mimeType: 'application/pdf', modifiedTime: '2026-09-18T09:00:00.000Z' },
  { id: 'f4', name: 'Quarterly review', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://docs.google.com/document/d/f4/edit' },
];

const ids = { ana: 91, ben: 92, cy: 93, eve: 94 };
const link = (access, email, name, over = {}) => ({ access_token: access, refresh_token: access + '-refresh', expiry_date: Date.now() + 86400000, email, name, scope: SCOPES, ...over });

(async () => {
  const now = () => new Date().toISOString();
  // (the server reads the table once, as it starts: Ben and Cy have an account linked already; the others have none)
  const db = createFakeSupabase({
    ...seedTables(parseSchema()),
    google_tokens: [
      { user_key: `${ids.ben}_drive`, tokens: link('ben-at', 'ben@motolinker.test', 'Ben B.'), updated_at: now() },
      { user_key: `${ids.cy}_drive`, tokens: link('cy-at', 'cy@motolinker.test', 'Cy C.'), updated_at: now() },
    ],
  }, { defaults: { google_tokens: () => ({ updated_at: now() }) } });
  db.install();

  // Google, stood in for (the server is in this process, so its calls to Google are answered here)
  const google = { token: [], files: [], reply: {} };
  const reset = () => { google.token.length = 0; google.files.length = 0; google.reply = {}; };
  const jsonReply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const body = JSON.parse(init.body); google.token.push(body);
      return jsonReply({ access_token: 'granted-at', refresh_token: 'granted-rt', expires_in: 3600, scope: SCOPES, token_type: 'Bearer' });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) return jsonReply({ email: 'granted@motolinker.test', name: 'Granted G.' });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files')) {
      const u = new URL(url);
      google.files.push({ q: u.searchParams.get('q'), auth: (init.headers || {}).Authorization });
      if (google.reply.files) return google.reply.files();
      const q = u.searchParams.get('q') || '';
      return jsonReply({ files: q.includes(SHEET) ? LISTING.filter(f => f.mimeType === SHEET) : LISTING });
    }
    return realFetch(input, init);
  };

  const base = await bootApp({ port: process.env.PORT || (UNCONFIGURED ? 4015 : 4014), env: { ML_WEB_DIST: dist, GOOGLE_CLIENT_ID: UNCONFIGURED ? '' : 'client-123', GOOGLE_CLIENT_SECRET: UNCONFIGURED ? '' : 'secret-456' } });
  const ctx = require(path.join(ROOT, 'src', 'ctx'));
  const { normEmpPerms } = require(path.join(ROOT, 'src', 'routes', 'employee-portal.js'));
  const T = db.tables;

  // who is asking: the administrator, and team members with different grants
  const drive = (view, connect) => ({ drive: true, driveActions: { view, connect }, sheets: true, sheetsActions: { view: true } });
  const perms = {
    ana: drive(true, true),
    ben: drive(true, false),
    eve: drive(true, false),
    cy: { drive: false, sheets: true, driveActions: { view: false, connect: false }, sheetsActions: { view: true } },
  };
  const member = (id, name, p) => ({ ...T.employees[0], id, name, username: name.toLowerCase(), job_title: 'Ops', permissions: p, email: name.toLowerCase() + '@example.com', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), avatar_url: '', status_text: '', status_emoji: '' });
  T.employees = T.employees.filter(e => !Object.values(ids).includes(e.id)).concat(Object.entries(ids).map(([n, id]) => member(id, n[0].toUpperCase() + n.slice(1), perms[n])));
  const sessionOf = (id, p) => ({ id, name: T.employees.find(e => e.id === id).name, username: T.employees.find(e => e.id === id).username, job_title: 'Ops', permissions: normEmpPerms(p), createdAt: Date.now() });
  const ADMIN = { who: 'admin', token: 'wd-admin', key: 'ml_admin_token', route: '/dashboard' };
  const team = (token, n) => ({ who: 'team', token, key: 'ml_emp_token', route: '/employee', id: ids[n], p: perms[n] });
  const ANA = team('wd-ana', 'ana'), BEN = team('wd-ben', 'ben'), CY = team('wd-cy', 'cy'), EVE = team('wd-eve', 'eve');
  ctx.sessions.set(ADMIN.token, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  for (const m of [ANA, BEN, CY, EVE]) ctx.employeeSessions.set(m.token, sessionOf(m.id, m.p));

  const linked = key => { const r = T.google_tokens.find(x => x.user_key === key); return !!(r && r.tokens && r.tokens.access_token); };
  const tokensOf = key => { const r = T.google_tokens.find(x => x.user_key === key); return r ? r.tokens : undefined; };
  const waitFor = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await sleep(50); } return false; };

  // ── the browser ──────────────────────────────────────────────────────────────
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const open = async (p, screen = 'drive') => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const failures = [];
    const asked = [];
    const consent = [];
    page.on('response', r => { if (r.status() === 401) failures.push(r.url()); });
    page.on('request', r => { if (/\/api\//.test(r.url())) asked.push(r.method() + ' ' + new URL(r.url()).pathname); });
    // Google's consent screen is answered at once, as a person who says yes would: back to the way the server gave, with a code and the state it handed out
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith('https://accounts.google.com/')) {
        const q = new URL(u).searchParams;
        consent.push({ url: u, scope: q.get('scope'), redirect: q.get('redirect_uri') });
        return r.respond({ status: 302, headers: { location: `${q.get('redirect_uri')}?code=the-code&state=${q.get('state')}` } });
      }
      if (!u.startsWith(base)) return r.abort('internetdisconnected');
      r.continue();
    });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => { window.lucide = { createIcons() {} }; window.Chart = function () { return { destroy() {}, update() {} }; }; });
    await page.evaluateOnNewDocument((key, token) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, token); localStorage.setItem('ml_mode', 'dark'); } catch (_) {} }, p.key, p.token);
    await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 900 });
    await page.goto(base + p.route + '/' + screen, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    return Object.assign(page, { failures, asked, consent, shut: async () => { await page.close(); await context.close(); } });
  };
  const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 50 }, arg).then(() => true, () => false);
  const part = name => `[data-part=${name}]`;
  const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.textContent.trim().replace(/\s+/g, ' ') : null; }, sel);
  const texts = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].map(el => el.textContent.trim().replace(/\s+/g, ' ')), sel);
  const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
  const has = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
  const press = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
  const attr = (page, sel, a) => page.evaluate((s, a) => { const el = document.querySelector(s); return el ? el.getAttribute(a) : null; }, sel, a);
  const settled = page => until(page, () => { const g = document.querySelector('[data-part=googlePage]'); return !!g && !g.querySelector('[data-part=loading]') && g.children.length > 0; }, null);
  const goTo = async (page, screen) => { await press(page, `[data-screen=${screen}]`); await until(page, () => !!document.querySelector('[data-part=googlePage]'), null); return settled(page); };

  if (UNCONFIGURED) {
    // a server with no Google project: the screens say so, in each portal's words, and offer nothing
    const a = await open(ADMIN);
    await settled(a);
    check('with no Google project, the administrator\'s page says what to add and where, and offers no button',
      (await text(a, part('connectTitle'))) === 'Connect Google Drive' && /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/.test(await text(a, part('connectSub')) || '') && !(await has(a, part('connectBtn'))));
    await a.shut();
    const t = await open(ANA);
    await settled(t);
    check('…and the team\'s page says to ask the administrator', (await text(t, part('connectSub'))) === 'Google Drive integration not configured. Contact your admin.' && !(await has(t, part('connectBtn'))));
    await t.shut();
    await browser.close();
    fs.rmSync(dist, { recursive: true, force: true });
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }

  // ═══ 1. the administrator links an account, and browses it ═════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await settled(page);
    check('with no account linked, the page offers to link one under its own name', (await text(page, part('connectTitle'))) === 'My Drive' && (await text(page, part('connectBtn'))) === 'Connect Google Drive' && !(await has(page, part('fileRow'))));
    await press(page, part('connectBtn'));
    // (the page is left for Google and comes back: the consent screen answered, the server traded the code and sent the browser home)
    check('the button goes to Google and comes back to the Drive screen, linked as the account Google named',
      await until(page, () => !!document.querySelector('[data-part=accountName]'), null) && (await text(page, part('accountName'))) === 'Granted G.' && (await text(page, part('accountEmail'))) === 'granted@motolinker.test',
      `${page.url()} ${await text(page, part('googlePage'))}`);
    check('…the consent screen was asked for the right things, and the way back is the one callback Google has been told about',
      page.consent.length === 1 && page.consent[0].scope === SCOPES && page.consent[0].redirect === `${base}/api/email/callback`, JSON.stringify(page.consent));
    check('…the server traded the code with the project\'s id and secret, and kept the link in the table where a restart finds it',
      google.token.length === 1 && google.token[0].code === 'the-code' && google.token[0].client_id === 'client-123' && linked('admin_drive') && tokensOf('admin_drive').email === 'granted@motolinker.test', JSON.stringify(google.token));
    check('…and the address is the screen\'s own, not the callback\'s', /\/dashboard\/drive$/.test(page.url()), page.url());

    check('the files are a row for each, as Drive listed them, with the count over them',
      (await count(page, part('fileRow'))) === 4 && (await text(page, part('fileCount'))) === '4 files' && (await texts(page, part('cellName'))).join('|') === 'Price list.xlsx|Stock count|Shared with nobody|Quarterly review', await text(page, part('table')));
    check('…each with the picture its kind has',
      (await page.evaluate(() => [...document.querySelectorAll('[data-part=fileGlyph]')].map(g => g.getAttribute('data-glyph')))).join() === 'paperclip,sheet,file-type,file-text');
    check('…asked of Google as the account the person linked: what is not in the bin', google.files.length >= 1 && google.files.every(f => f.auth === 'Bearer granted-at') && google.files[0].q === 'trashed=false', JSON.stringify(google.files));
    check('Open goes to Google in a new tab, for the files Drive gave a link for', (await count(page, part('open'))) === 3 && (await attr(page, part('open'), 'target')) === '_blank' && (await attr(page, part('open'), 'rel')) === 'noopener');

    await page.evaluate(() => document.querySelectorAll('[data-part=view]')[1].click());
    check('View opens the file in the viewer over the page, pointed at Google\'s own preview of it',
      await until(page, () => !!document.querySelector('[data-part=viewer]'), null) && (await attr(page, part('viewerFrame'), 'src')) === 'https://docs.google.com/spreadsheets/d/f2/preview' && (await text(page, part('viewerTitle'))) === 'Stock count');
    check('…with the way to open it in Google and the way to put it away', (await attr(page, part('viewerOpen'), 'href')) === 'https://docs.google.com/spreadsheets/d/f2/edit' && !!(await has(page, part('viewerClose'))));
    await page.keyboard.press('Escape');
    check('Escape puts it away', await until(page, () => !document.querySelector('[data-part=viewer]'), null));

    // the spreadsheets
    await goTo(page, 'sheets');
    check('My Sheets asks Google for the spreadsheets, and shows the ones it gave',
      (await texts(page, part('cellName'))).join('|') === 'Stock count' && (await text(page, part('fileCount'))) === '1 file' && google.files.some(f => f.q === `mimeType='${SHEET}' and trashed=false`), JSON.stringify(google.files.map(f => f.q)));
    check('…under its own title, and the same account', (await text(page, part('tableTitle'))) === 'Sheets My Sheets' && (await text(page, part('accountName'))) === 'Granted G.');

    // letting go
    await press(page, part('disconnect'));
    check('Disconnect empties the link in the table and the page asks again, and offers to link one',
      await until(page, () => !!document.querySelector('[data-part=connectBtn]'), null) && !linked('admin_drive') && tokensOf('admin_drive') === null, JSON.stringify(tokensOf('admin_drive')));
    await goTo(page, 'drive');
    check('…and My Drive, which is the same account, is as unlinked', !!(await has(page, part('connectBtn'))) && !(await has(page, part('fileRow'))));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    await settled(page);
    check('…after a reload as well', !!(await has(page, part('connectBtn'))) && !(await has(page, part('account'))));
    check('none of it needed the app to ask for what it had no right to (no 401), or to go to the classic portal\'s routes',
      page.failures.length === 0 && !page.asked.some(p => p.startsWith('GET /api/dashboard/drive')), page.failures.join());
    await page.shut();
  }

  // ═══ 2. a team member links an account ═════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ANA);
    await settled(page);
    check('the team\'s page says the same in its own words, and offers to link an account', (await text(page, part('connectSub'))) === 'Connect your Google account to access your files.' && (await text(page, part('connectBtn'))) === 'Connect Google Drive');
    await press(page, part('connectBtn'));
    check('the button asks the session is good, goes to Google and comes back to the team portal\'s Drive, linked',
      await until(page, () => !!document.querySelector('[data-part=accountName]'), null) && (await text(page, part('accountName'))) === 'Granted G.' && page.asked.includes('GET /api/employee/check'), `${page.url()} ${page.asked.join()}`);
    check('…the link is the member\'s own row in the table (their id), and the administrator\'s is untouched',
      linked(`${ANA.id}_drive`) && !linked('admin_drive'), JSON.stringify(T.google_tokens.map(r => r.user_key)));
    check('…and the files came through the team\'s own routes', (await count(page, part('fileRow'))) === 4 && page.asked.includes('GET /api/employee/drive/files') && !page.asked.some(p => p.startsWith('GET /api/drive')), page.asked.join());
    check('the table scrolls on its own and is not narrower than a table should be', await page.evaluate(() => { const t = document.querySelector('[data-part=table]'); return !!t && getComputedStyle(t).minWidth === '460px'; }));
    await goTo(page, 'sheets');
    check('My Sheets shows the spreadsheets of the same account', (await texts(page, part('cellName'))).join('|') === 'Stock count');
    await press(page, part('disconnect'));
    check('Disconnect lets go of the member\'s account, and the screen offers to link one',
      await until(page, () => !!document.querySelector('[data-part=connectBtn]'), null) && !linked(`${ANA.id}_drive`) && tokensOf(`${ANA.id}_drive`) === null);
    check('none of it asked for what the team has no right to (no 401)', page.failures.length === 0, page.failures.join());
    await page.shut();
  }

  // ═══ 3. what each grant gets ═══════════════════════════════════════════════════════════════
  reset();
  {
    // Ben: may see the files and may not link an account (his is linked already)
    const ben = await open(BEN);
    await settled(ben);
    check('a member who may see the files and not link an account sees the account and the files, and no way to let go of it',
      (await text(ben, part('accountName'))) === 'Ben B.' && (await count(ben, part('fileRow'))) === 4 && !(await has(ben, part('disconnect'))), await text(ben, part('googlePage')));
    check('…the files were asked of Google as his account, not another\'s', google.files.length >= 1 && google.files.every(f => f.auth === 'Bearer ben-at'), JSON.stringify(google.files));
    await ben.shut();
    // Eve: the same grants, and no account linked
    const eve = await open(EVE);
    await settled(eve);
    check('…and with no account linked is told to ask, and shown no button',
      (await text(eve, part('connectSub'))) === 'No Google account is linked. Ask your admin to link one for you.' && !(await has(eve, part('connectBtn'))), await text(eve, part('googlePage')));
    await eve.shut();
    // Cy: may read spreadsheets, and not the Drive status that says whose account it is
    const cy = await open(CY, 'sheets');
    await settled(cy);
    check('a member with Sheets and without the Drive grant is told Drive is not switched on, and is not told it is not set up',
      (await text(cy, part('connectSub'))) === 'Google Drive is not switched on for you. Ask your admin.' && !(await has(cy, part('connectBtn'))) && !(await has(cy, part('error'))), await text(cy, part('googlePage')));
    check('…and has no My Drive in the menu', !(await has(cy, '[data-screen=drive]')) && !!(await has(cy, '[data-screen=sheets]')));
    await cy.shut();
  }

  // ═══ 4. Google says no ═════════════════════════════════════════════════════════════════════
  reset();
  {
    const page = await open(ADMIN);
    await settled(page);
    await press(page, part('connectBtn'));
    await until(page, () => !!document.querySelector('[data-part=accountName]'), null);
    google.reply.files = () => jsonReply({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-part=sidebar]', { timeout: 20000 });
    const said = await until(page, () => !!document.querySelector('[data-part=error]'), null);
    check('when Google would not list the files, the page says so in Google\'s words, in place of the list', said && /Request had insufficient authentication scopes\./.test(await text(page, part('error')) || ''), await text(page, part('googlePage')));
    check('…and keeps the account and the way to let go of it', (await text(page, part('accountName'))) === 'Granted G.' && !!(await has(page, part('disconnect'))) && !(await has(page, part('table'))));
    await press(page, part('disconnect'));
    check('…which works', await until(page, () => !!document.querySelector('[data-part=connectBtn]'), null) && !linked('admin_drive'));
    await page.shut();
  }

  await browser.close();
  // the project is read when the server starts: a second process has none
  const un = spawnSync(process.execPath, [__filename, '--unconfigured'], { encoding: 'utf8', env: { ...process.env, PORT: '' } });
  console.log(un.stdout.trim());
  if (un.status !== 0) console.log(un.stderr.slice(-800));
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) && un.status === 0 ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
