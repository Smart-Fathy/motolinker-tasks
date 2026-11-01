// The new app's My Drive and My Sheets against the classic portals', value by value — the same method as tests/stparity.js (see there):
// the classic page and the new app opened as the same person, in one portal, both colour modes and two looks, at a phone's width, two
// in-betweens and a desktop, and the computed style of every named part compared, and the words in them.
//
//   loading       the answer about the account has not come
//   unconfigured  there is no Google project on this server        unlinked   there is, and no account is linked
//   linked        an account and its files (a folder-less mix: sheet, document, PDF, picture, a file with no link, a plain one)
//   old           …a link made before uploads were asked for (the admin's page tells it to make the link again)
//   empty         an account with nothing in it
//   viewer        a file opened in the viewer over the page
// …each on My Drive, and on My Sheets (the same page over a shorter list: loading and old are the same page and are read on Drive).
//
// What Google says is the server's, and is the same on both sides: both ask the same routes the same questions. The routes are
// answered here (the suite does not talk to Google); a state that cannot be put in a real server is a state the answer is made.
// Run with --print to see every difference rather than the first few; --portal=admin (or team) for a half; --only=original/dark
// for a look and a mode; --states=a,b for a few.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { PROPS_MORE, STILL, part, openPage, settle, readRoles, diff, launch } = require('./helpers/parity');

const ROOT = path.join(__dirname, '..');
const PRINT = process.argv.includes('--print');
const ABSENT = process.argv.includes('--absent');
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const PORTAL = arg('portal');
const ONLY = arg('only');
const STATE_FILTER = arg('states').split(',').filter(Boolean);
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// Where the two differ on purpose or by necessity, and why, by portal. Each must still differ, or it is stale and fails.
const ACCEPTED_BY = { admin: {}, team: {} };

// The classic team page builds its Disconnect button with the icon's markup inside an attribute that is quoted with the same quotes
// (onclick="disconnectDrive('…','<i data-lucide="hard-drive" …>')"): the attribute ends in the middle of the icon, the rest of it
// becomes the button's label, ')">Disconnect, and the button, when pressed, runs a script that does not parse. The new app's button says
// Disconnect and lets go of the account. The longer label would only move the width at which the account line wraps — and where that is
// depends on the fonts of the machine the suite runs on (it wrapped at 390px on CI's and not on the machine this was written on, and so
// moved everything under the account line by 44px) — so the label is mended in the classic page before it is read, and what it was is
// checked at the end: the classic button is still broken, and this is where that is written down.
const mended = new Set();

const free = (c, x, text = false) => part(c, x, 'abs', null, text);
const SHEET = 'application/vnd.google-apps.spreadsheet';
const FILES = [
  { id: 'f1', name: 'Price list.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-09-20T09:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/f1/view' },
  { id: 'f2', name: 'Stock count', mimeType: SHEET, modifiedTime: '2026-09-19T09:00:00.000Z', webViewLink: 'https://docs.google.com/spreadsheets/d/f2/edit' },
  { id: 'f3', name: 'Shared with nobody', mimeType: 'application/pdf', modifiedTime: '2026-09-18T09:00:00.000Z' },
  { id: 'f4', name: 'Showroom photo', mimeType: 'image/jpeg', modifiedTime: '2026-09-17T09:00:00.000Z', webViewLink: 'https://drive.google.com/file/d/f4/view' },
  { id: 'f5', name: 'Quarterly review', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://docs.google.com/document/d/f5/edit' },
];
const SHEETS = [FILES[1], { id: 'f6', name: 'Margins', mimeType: SHEET, modifiedTime: '2026-09-10T09:00:00.000Z', webViewLink: 'https://docs.google.com/spreadsheets/d/f6/edit' }];
const LINKED = { configured: true, connected: true, email: 'ana@motolinker.test', name: 'Ana A.', canUpload: true };
const STATES = {
  unconfigured: { configured: false },
  unlinked: { configured: true, connected: false },
  linked: LINKED,
  old: { ...LINKED, canUpload: false },
};

// The parts of a page, by portal: a name, its place in the classic markup and in the new app's.
const rolesFor = (who, kind) => {
  const A = who === 'admin';
  const id = kind === 'drive' ? '#drive-content' : '#sheets-content';
  const N = '[data-part=googlePage]';
  const page = { page: free(id, N) };
  const loading = {
    loading: free(`${id} .loading`, `${N} [data-part=loading]`, true),
    spinner: free(`${id} .loading .spinner`, `${N} [data-part=spinner]`),
  };
  const card = {
    card: free(`${id} ${A ? '.email-connect-card' : '> div'}`, `${N} [data-part=connectCard]`),
    cardIcon: free(`${id} ${A ? '.email-icon' : '> div > div:nth-child(1)'}`, `${N} [data-part=connectIcon]`, true),
    cardIconSvg: free(`${id} ${A ? '.email-icon svg' : '> div > div:nth-child(1) svg'}`, `${N} [data-part=connectIcon] svg`),
    cardTitle: free(`${id} ${A ? '.email-title' : '> div > div:nth-child(2)'}`, `${N} [data-part=connectTitle]`, true),
    cardSub: free(`${id} ${A ? '.email-sub' : '> div > div:nth-child(3)'}`, `${N} [data-part=connectSub]`, true),
  };
  const button = { connect: free(`${id} ${A ? '.email-connect-card .btn' : '> div > .btn'}`, `${N} [data-part=connectBtn]`, true) };
  const body = A ? { body: free(`${id} .page-body`, `${N} [data-part=pageBody]`) } : {};
  const R = A ? `${id} .page-body` : id;
  const NB = A ? `${N} [data-part=pageBody]` : N;
  const account = {
    account: free(`${R} > div:nth-child(1)`, `${NB} [data-part=account]`),
    who: free(`${R} > div:nth-child(1) > div:nth-child(1)`, `${NB} [data-part=who]`),
    avatar: free(`${R} > div:nth-child(1) > div:nth-child(1) > div:nth-child(1)`, `${NB} [data-part=accountAvatar]`, true),
    name: free(`${R} > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1)`, `${NB} [data-part=accountName]`, true),
    email: free(`${R} > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div:nth-child(2)`, `${NB} [data-part=accountEmail]`, true),
    disconnect: free(`${R} > div:nth-child(1) > button`, `${NB} [data-part=disconnect]`, true),
  };
  const notice = A ? {
    notice: free(`${R} > .error-msg`, `${NB} [data-part=reconnectNotice]`, true),
    reconnect: free(`${R} > .error-msg a`, `${NB} [data-part=reconnect]`, true),
  } : {};
  const T = A ? `${R} .table-card` : `${R} > .card`;
  const NT = `${NB} [data-part=tableCard]`;
  const row = n => `tbody tr:nth-child(${n})`;
  const list = {
    tableCard: free(T, NT),
    tableHeader: free(A ? `${T} .table-header` : `${T} > div:nth-child(1)`, `${NT} [data-part=tableHeader]`),
    tableTitle: free(A ? `${T} .table-title` : `${T} > div:nth-child(1) > span:nth-child(1)`, `${NT} [data-part=tableTitle]`, true),
    tableIcon: free(A ? `${T} .table-title svg` : `${T} > div:nth-child(1) > span:nth-child(1) svg`, `${NT} [data-part=tableTitle] svg`),
    count: free(A ? `${T} .table-header > span:nth-child(2)` : `${T} > div:nth-child(1) > span:nth-child(2)`, `${NT} [data-part=fileCount]`, true),
    scroll: A ? null : free(`${T} .table-scroll`, `${NT} [data-part=tableScroll]`),
    table: free(`${T} table`, `${NT} [data-part=table]`),
    th1: free(`${T} thead th:nth-child(1)`, `${NT} thead th:nth-child(1)`, true),
    th2: free(`${T} thead th:nth-child(2)`, `${NT} thead th:nth-child(2)`, true),
    th3: free(`${T} thead th:nth-child(3)`, `${NT} thead th:nth-child(3)`),
    row1: free(`${T} ${row(1)}`, `${NT} [data-part=fileRow]:nth-child(1)`),
    name1: free(`${T} ${row(1)} td:nth-child(1)`, `${NT} [data-part=fileRow]:nth-child(1) [data-part=cellName]`, true),
    glyph1: free(`${T} ${row(1)} td:nth-child(1) svg`, `${NT} [data-part=fileRow]:nth-child(1) [data-part=fileGlyph]`),
    date1: free(`${T} ${row(1)} td:nth-child(2)`, `${NT} [data-part=fileRow]:nth-child(1) [data-part=cellDate]`, true),
    actions1: free(`${T} ${row(1)} td:nth-child(3)`, `${NT} [data-part=fileRow]:nth-child(1) [data-part=cellActions]`),
    view1: free(`${T} ${row(1)} td:nth-child(3) button`, `${NT} [data-part=fileRow]:nth-child(1) [data-part=view]`, true),
    open1: free(`${T} ${row(1)} td:nth-child(3) a`, `${NT} [data-part=fileRow]:nth-child(1) [data-part=open]`, true),
    row2: free(`${T} ${row(2)}`, `${NT} [data-part=fileRow]:nth-child(2)`),
    name2: free(`${T} ${row(2)} td:nth-child(1)`, `${NT} [data-part=fileRow]:nth-child(2) [data-part=cellName]`, true),
    glyph2: free(`${T} ${row(2)} td:nth-child(1) svg`, `${NT} [data-part=fileRow]:nth-child(2) [data-part=fileGlyph]`),
    date2: free(`${T} ${row(2)} td:nth-child(2)`, `${NT} [data-part=fileRow]:nth-child(2) [data-part=cellDate]`, true),
    glyph3: free(`${T} ${row(3)} td:nth-child(1) svg`, `${NT} [data-part=fileRow]:nth-child(3) [data-part=fileGlyph]`),
    date3: free(`${T} ${row(3)} td:nth-child(2)`, `${NT} [data-part=fileRow]:nth-child(3) [data-part=cellDate]`, true),
    actions3: free(`${T} ${row(3)} td:nth-child(3)`, `${NT} [data-part=fileRow]:nth-child(3) [data-part=cellActions]`),
    view3: free(`${T} ${row(3)} td:nth-child(3) button`, `${NT} [data-part=fileRow]:nth-child(3) [data-part=view]`, true),
    open3: free(`${T} ${row(3)} td:nth-child(3) a`, `${NT} [data-part=fileRow]:nth-child(3) [data-part=open]`),
    glyph4: free(`${T} ${row(4)} td:nth-child(1) svg`, `${NT} [data-part=fileRow]:nth-child(4) [data-part=fileGlyph]`),
    glyph5: free(`${T} ${row(5)} td:nth-child(1) svg`, `${NT} [data-part=fileRow]:nth-child(5) [data-part=fileGlyph]`),
  };
  if (!list.scroll) delete list.scroll;
  const empty = { empty: free(`${T} > div:nth-child(2)`, `${NT} [data-part=empty]`, true) };
  const V = A ? '#admin-drive-viewer' : '#drive-viewer';
  const viewer = {
    viewer: free(`${V}-overlay`, '[data-part=viewer]'),
    viewerBar: free(`${V}-overlay > div:nth-child(1)`, '[data-part=viewerBar]'),
    viewerTitle: free(`${V}-title`, '[data-part=viewerTitle]', true),
    viewerOpen: free(`${V}-ext-link`, '[data-part=viewerOpen]', true),
    viewerClose: free(`${V}-overlay > div:nth-child(1) > button`, '[data-part=viewerClose]', true),
    viewerFrame: free(`${V}-frame`, '[data-part=viewerFrame]'),
  };
  return { page, loading, card, button, body, account, notice, list, empty, viewer };
};

// What each state reads
const READS = {
  loading: ['page', 'loading'],
  unconfigured: ['page', 'card'],
  unlinked: ['page', 'card', 'button'],
  linked: ['page', 'body', 'account', 'list'],
  old: ['page', 'body', 'account', 'notice', 'list'],
  empty: ['page', 'body', 'account', 'list', 'empty'],
  viewer: ['viewer'],
};
// …and which of them are read on My Sheets as well
const ON_SHEETS = new Set(['unconfigured', 'unlinked', 'linked', 'empty']);
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = arg('widths') ? arg('widths').split(',').map(Number) : [390, 670, 800, 1100];

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, portals } = await bootDemo({ port: process.env.PORT || 4023 });
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;
  // What the server is made to say about the Google account, on both sides alike
  const world = { status: STATES.linked, files: FILES, sheets: SHEETS, hold: null };
  const stub = (u, m) => {
    const url = new URL(u);
    const m2 = /^\/api\/(?:employee\/)?drive\/(status|files|sheets)$/.exec(url.pathname);
    if (!m2 || m !== 'GET') return null;
    const answer = () => ({ status: 200, body: m2[1] === 'status' ? world.status : m2[1] === 'files' ? world.files : world.sheets });
    return m2[1] === 'status' && world.hold ? world.hold.then(answer) : answer();
  };

  const observed = {};   // `${portal}/${look}/${mode}/${screen}/${state}/${width}` -> side -> role -> style
  const absent = new Set();

  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const states = Object.keys(READS).filter(s => !STATE_FILTER.length || STATE_FILTER.includes(s));
    Object.assign(world, { status: STATES.linked, files: FILES, sheets: SHEETS, hold: null });
    const page = await openPage(browser, base, p, mode, next, stub);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL + (next ? '' : '.ai-card{display:none!important}') });
    const pick = (classic, now) => next ? now : classic;
    const until = (fn, arg, what) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg).catch(async e => {
      const seen = await page.evaluate(() => (document.querySelector('[data-part=googlePage], #drive-content, #sheets-content') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
      throw new Error(`${p.who}/${side}/${key}: waiting for ${what}: ${e.message.split('\n')[0]} — the page says: "${seen}"`);
    });
    const go = to => page.evaluate((next, to) => {
      if (!next) return window.navigate(to);
      document.querySelector(`[data-screen=${to}]`).click();
    }, next, to);
    const content = kind => pick(kind === 'drive' ? '#drive-content' : '#sheets-content', '[data-part=googlePage]');
    // (the page has finished when the loader has gone and something stands where it was)
    const ready = async (kind, what) => {
      await until(s => { const c = document.querySelector(s); return !!c && !c.querySelector('.loading, [data-part=loading]') && c.children.length > 0; }, content(kind), what);
      // (the classic admin page draws its file icons when something next asks lucide to redraw the page, which it does not do by itself:
      // here it is asked, as the next unrelated redraw in a real session would)
      if (!next) await page.evaluate(() => window.lucide && window.lucide.createIcons());
    };
    const reading = async (screen, state, kind) => {
      if (!next && p.who === 'team') {
        const was = await page.evaluate(sel => {
          const b = document.querySelector(sel);
          if (!b) return null;
          const label = b.textContent;
          if (label !== 'Disconnect') b.textContent = 'Disconnect';
          return label;
        }, `${kind === 'drive' ? '#drive-content' : '#sheets-content'} > div:nth-child(1) > button`);
        if (was !== null && was !== 'Disconnect') mended.add(was);
      }
      const ROLES = rolesFor(p.who, kind);
      const which = {};
      for (const g of READS[state]) Object.assign(which, ROLES[g]);
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const at = `${p.who}/${key}/${screen}/${state}/${width}`;
        const got = await readRoles(page, which, side, PROPS_MORE);
        (observed[at] = observed[at] || {})[side] = got;
        if (ABSENT && next) for (const [r, v] of Object.entries(got)) if (v === null) absent.add(`${screen}/${state}/${r}`);
      }
      await page.setViewport({ width: 1100, height: 800 });
      await settle(page);
    };
    // open a screen with the server saying what a state calls for, and read it
    const visit = async (kind, state, status, files) => {
      world.status = status;
      if (files) { world.files = files; world.sheets = files; }
      await go(kind);
      await ready(kind, `${kind} to be drawn (${state})`);
      await reading(kind, state, kind);
      await go('home');
      await until(s => !document.querySelector(s), pick(kind === 'drive' ? '#page-drive.active' : '#page-sheets.active', content(kind)), 'the page to be left');
    };
    for (const kind of ['drive', 'sheets']) {
      const on = s => states.includes(s) && (kind === 'drive' || ON_SHEETS.has(s));
      const shown = kind === 'drive' ? FILES : SHEETS;
      // the loader: the answer about the account is held back
      if (on('loading')) {
        let release; world.hold = new Promise(r => { release = r; });
        world.status = STATES.linked;
        await go(kind);
        await until(s => !!document.querySelector(s), pick(`${content(kind)} .loading`, '[data-part=loading]'), 'the loader');
        await reading(kind, 'loading', kind);
        release(); world.hold = null;
        await ready(kind, 'the page after the loader');
        await go('home');
        await until(s => !document.querySelector(s), pick(kind === 'drive' ? '#page-drive.active' : '#page-sheets.active', content(kind)), 'the page to be left');
      }
      if (on('unconfigured')) await visit(kind, 'unconfigured', STATES.unconfigured);
      if (on('unlinked')) await visit(kind, 'unlinked', STATES.unlinked);
      if (on('linked')) await visit(kind, 'linked', STATES.linked, shown);
      if (on('old')) await visit(kind, 'old', STATES.old, shown);
      if (on('empty')) await visit(kind, 'empty', STATES.linked, []);
      if (on('viewer')) {
        world.status = STATES.linked; world.files = FILES; world.sheets = SHEETS;
        await go(kind);
        await ready(kind, 'the files');
        // the second file: a Google spreadsheet, which has a link of its own
        await page.evaluate((s) => document.querySelector(s).click(), pick(`${content(kind)} tbody tr:nth-child(2) td:nth-child(3) button`, '[data-part=fileRow]:nth-child(2) [data-part=view]'));
        await until(s => { const e = document.querySelector(s); return !!e && e.checkVisibility(); }, pick(`${p.who === 'admin' ? '#admin-drive-viewer' : '#drive-viewer'}-overlay`, '[data-part=viewer]'), 'the viewer');
        await reading(kind, 'viewer', kind);
        await page.evaluate((next, admin) => {
          if (next) document.querySelector('[data-part=viewerClose]').click();
          else (admin ? window.adminCloseDriveViewer : window.closeDriveViewer)();
        }, next, p.who === 'admin');
        await go('home');
        await until(s => !document.querySelector(s), pick(kind === 'drive' ? '#page-drive.active' : '#page-sheets.active', content(kind)), 'the page to be left');
      }
    }
    await page.shut();
  };

  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const mode of MODES) for (const p of portals) for (const side of ['classic', 'next']) {
      if (PORTAL && p.who !== PORTAL) continue;
      if (ONLY && !`${look}/${mode}`.startsWith(ONLY)) continue;
      await scenario(p, mode, side, `${look}/${mode}`);
    }
  }
  await browser.close();

  const staleBy = { admin: new Set(Object.keys(ACCEPTED_BY.admin)), team: new Set(Object.keys(ACCEPTED_BY.team)) };
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const who = key.split('/')[0];
    const { n, bad } = diff(classic, next, ACCEPTED_BY[who], staleBy[who], PROPS_MORE);
    compared += n;
    check(`${key}: ${n} values are the classic page's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (ABSENT) console.log('parts found on neither side or only one:', [...absent].sort().join(', '));
  if (!ONLY && !STATE_FILTER.length) {
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > (PORTAL ? 20000 : 40000), String(compared));
    const stale = Object.entries(staleBy).filter(([who]) => !PORTAL || PORTAL === who).flatMap(([who, set]) => [...set].map(k => `${who}:${k}`));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.length === 0, stale.join(', '));
    if (PORTAL !== 'admin') check('the classic team page\'s Disconnect button is still broken: its label is the rest of the icon\'s markup (it is mended before the page is read)', [...mended].join('|') === '\')">Disconnect', JSON.stringify([...mended]));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
