// The new app's bell, its panel, its toasts, the Notification Center and the rail's badge against the classic portals', value by
// value — the same method as tests/shellparity.js (see there), applied to what that suite cannot see because it only exists
// once something has happened to the page:
//
//   closed   the bell with its count (the person has an unread notification)
//   open     the bell has been pressed: the panel, its head and its buttons, a notification of each kind (opening reads them all)
//   live     a notification arrives while the panel is open: an unread row at its head, the toast
//   page     "View all": the Notification Center, its heading, its button, its rows (read and unread) and the rail's badge
//   narrowed the rail narrowed to its icons, which has no room for the count (the badge alone, drawn or not)
//
// Each is read at a phone's width, two in-betweens and a desktop, in both modes and two looks, for both portals. The words are
// compared too (the parts marked `text`). Run with --print to see every difference rather than the first few.
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
const ACCEPTED = {
  'bellWrap._x': 'the classic header also carries the refresh countdown, help and a Refresh button around the bell; they come with their screens',
  'navItem._y': 'the classic rail has a search box and a row of shortcuts above its list, which come with Cmd+K and the favourites',
};

// The part each role names, classic and new. Positions inside the panel and the page are held relative to the panel / the page
// (`rel`): the header around the bell, and the page around the list, are what shellparity compares.
const row = (read, scope) => ({ cls: read ? ':not(.unread)' : '.unread', nxt: `[data-unread=${read ? 'false' : 'true'}]`, scope });
const common = pageWrap => {
  const unread = row(false), read = row(true);
  const roles = {
    bellWrap: part('.notif-wrap', '[data-part=bellWrap]'),
    bell: part('#notif-bell', '[data-part=bell]', 'abs', 'bellWrap'),
    bellIcon: part('#notif-bell svg', '[data-part=bell] svg', 'abs', 'bellWrap'),
    bellBadge: part('#notif-badge', '[data-part=bellBadge]', 'abs', 'bellWrap', true),
    panel: part('#notif-panel', '[data-part=panel]', 'abs', 'bellWrap'),
    panelHead: part('.notif-panel-head', '[data-part=panelHead]', 'abs', 'panel'),
    panelTitle: part('.notif-panel-head > span', '[data-part=panelHead] > span', 'abs', 'panel', true),
    panelActions: part('.notif-panel-head > div', '[data-part=panelHead] > div', 'abs', 'panel'),
    viewAll: part('.notif-panel-head .notif-readall:not(#notif-readall)', '[data-part=viewAll]', 'abs', 'panel', true),
    readAll: part('#notif-readall', '[data-part=readAll]', 'abs', 'panel', true),
    panelList: part('#notif-list', '[data-part=panelList]', 'abs', 'panel'),
    itemUnread: part(`#notif-list .notif-item${unread.cls}`, `[data-part=panel] [data-part=item]${unread.nxt}`, 'abs', 'panel'),
    itemRead: part(`#notif-list .notif-item${read.cls}`, `[data-part=panel] [data-part=item]${read.nxt}`, 'abs', 'panel'),
    itemIcon: part(`#notif-list .notif-item${read.cls} .notif-type-icon`, `[data-part=panel] [data-part=item]${read.nxt} [data-part=typeIcon]`, 'abs', 'panel'),
    itemIconSvg: part(`#notif-list .notif-item${read.cls} .notif-type-icon svg`, `[data-part=panel] [data-part=item]${read.nxt} [data-part=typeIcon] svg`, 'abs', 'panel'),
    itemBody: part(`#notif-list .notif-item${read.cls} .notif-body`, `[data-part=panel] [data-part=item]${read.nxt} [data-part=body]`, 'abs', 'panel'),
    itemTitle: part(`#notif-list .notif-item${read.cls} .notif-title`, `[data-part=panel] [data-part=item]${read.nxt} [data-part=title]`, 'abs', 'panel', true),
    itemText: part(`#notif-list .notif-item${read.cls} .notif-text`, `[data-part=panel] [data-part=item]${read.nxt} [data-part=text]`, 'abs', 'panel', true),
    itemTime: part(`#notif-list .notif-item${read.cls} .notif-time`, `[data-part=panel] [data-part=item]${read.nxt} [data-part=time]`, 'abs', 'panel', true),
    unreadTitle: part(`#notif-list .notif-item${unread.cls} .notif-title`, `[data-part=panel] [data-part=item]${unread.nxt} [data-part=title]`, 'abs', 'panel', true),
    pageWrap: pageWrap,
    pageHead: part(pageWrap.classic + ' > div:first-child', '[data-part=notificationsPage] > div:first-child', 'abs', 'pageWrap'),
    pageTitle: part('#page-notif div[style*="font-size:18px"]', '[data-part=pageTitle]', 'abs', 'pageWrap', true),
    pageHint: part('#page-notif div[style*="font-size:13px"]', '[data-part=pageHint]', 'abs', 'pageWrap', true),
    markAll: part('#page-notif .btn', '[data-part=markAll]', 'abs', 'pageWrap', true),
    pageList: part('#notif-center-list', '[data-part=notificationsList]', 'abs', 'pageWrap'),
    centerUnread: part(`#notif-center-list .notif-center-item${unread.cls}`, `[data-part=centerItem]${unread.nxt}`, 'abs', 'pageWrap'),
    centerRead: part(`#notif-center-list .notif-center-item${read.cls}`, `[data-part=centerItem]${read.nxt}`, 'abs', 'pageWrap'),
    marker: part(`#notif-center-list .notif-center-item${unread.cls} .notif-unread-marker`, `[data-part=centerItem]${unread.nxt} [data-part=marker]`, 'abs', 'pageWrap'),
    centerIcon: part(`#notif-center-list .notif-center-item${read.cls} .notif-type-icon`, `[data-part=centerItem]${read.nxt} [data-part=typeIcon]`, 'abs', 'pageWrap'),
    centerIconSvg: part(`#notif-center-list .notif-center-item${read.cls} .notif-type-icon svg`, `[data-part=centerItem]${read.nxt} [data-part=typeIcon] svg`, 'abs', 'pageWrap'),
    centerBody: part(`#notif-center-list .notif-center-item${read.cls} > div:nth-child(2)`, `[data-part=centerItem]${read.nxt} [data-part=body]`, 'abs', 'pageWrap'),
    centerTitle: part(`#notif-center-list .notif-center-item${read.cls} .notif-title`, `[data-part=centerItem]${read.nxt} [data-part=title]`, 'abs', 'pageWrap', true),
    centerText: part(`#notif-center-list .notif-center-item${read.cls} .notif-text`, `[data-part=centerItem]${read.nxt} [data-part=text]`, 'abs', 'pageWrap', true),
    centerTime: part(`#notif-center-list .notif-center-item${read.cls} .notif-time`, `[data-part=centerItem]${read.nxt} [data-part=time]`, 'abs', 'pageWrap', true),
    centerDate: part(`#notif-center-list .notif-center-item${read.cls} > div:last-child`, `[data-part=centerItem]${read.nxt} [data-part=date]`, 'abs', 'pageWrap', true),
    navItem: part('#nav-notif', '[data-screen=notifications]', 'abs'),
    navBadge: part('#notif-nav-badge', '[data-screen=notifications] [data-part=navBadge]', 'abs', 'navItem', true),
  };
  return roles;
};
const ROLES = {
  admin: { ...common(part('#page-notif .page-body', '[data-part=notificationsPage]')), toast: part('body > div[style*="9999"]', '[data-part=toast]', 'abs', null, true) },
  team: { ...common(part('#page-notif > div', '[data-part=notificationsPage]')), toast: part('.emp-toast', '[data-part=toast]', 'abs', null, true) },
};
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

// What the person has: an unread notification with words long enough to be clamped, and read ones of the other kinds. Times are in
// the middle of their step ("30m ago", "2h ago", "1d ago", a date), so they read the same in the two pages opened a while apart.
const LONG = 'Quote the Hilux for the customer who called this morning about the white pickup, and send the numbers by noon today.';
const seed = (key, tail) => {
  const ago = ms => new Date(Date.now() - ms).toISOString();
  return [
    { id: 1, member_key: key, type: 'task', title: '📋 New task assigned', body: LONG, url: tail + '#tasks', read: false, created_at: ago(30 * 60e3) },
    { id: 2, member_key: key, type: 'request', title: 'Request approved', body: 'Your leave request was approved', url: tail + '#requests', read: true, created_at: ago(2.5 * 3600e3) },
    { id: 3, member_key: key, type: 'lead', title: 'New lead', body: '', url: '', read: true, created_at: ago(36 * 3600e3) },
    { id: 4, member_key: key, type: 'security', title: 'New sign-in', body: 'From a new device', url: tail + '#security', read: true, created_at: ago(9 * 86400e3) },
  ];
};

(async () => {
  process.env.ML_WEB_DIST = dist;
  const { base, db, portals } = await bootDemo({ port: process.env.PORT || 3996 });
  const ctx = require(process.cwd() + '/src/ctx');
  const browser = await launch();
  const adminToken = portals.find(p => p.who === 'admin').token;

  // Each side, in order: the steps of the scenario, and a reading of every named part at every width after each.
  const scenario = async (p, mode, side, key) => {
    const next = side === 'next';
    const roles = ROLES[p.who];
    const memberKey = p.who === 'admin' ? 'admin' : 'employee_1';
    db.tables.notifications = seed(memberKey, p.who === 'admin' ? '/dashboard' : '/employee');
    const page = await openPage(browser, base, p, mode, next);
    await page.waitForSelector(next ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
    await page.addStyleTag({ content: STILL });
    const got = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
    if (got !== mode) throw new Error(`${p.who}/${side}: the page is in ${got}, not ${mode}`);
    const sel = (classic, nxt) => (next ? nxt : classic);
    const until = (fn, arg) => page.waitForFunction(fn, { timeout: 15000, polling: 50 }, arg);
    const reading = async (state, which = roles) => {
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const at = `${p.who}/${key}/${state}/${width}`;
        (observed[at] = observed[at] || {})[side] = await readRoles(page, which, side, PROPS_MORE);
      }
      await page.setViewport({ width: 1100, height: 800 });
      await settle(page);
    };

    // The rail's section that holds the item is open, on both sides: a closed section squeezes its items, and where the classic
    // page starts with its sections is not what is compared here.
    await page.evaluate(next => {
      const group = document.querySelector(next ? '[data-part=group][data-group=system]' : '.nav-group[data-group=system]');
      const head = group.querySelector(next ? '[data-part=groupHead]' : '.nav-group-head');
      const open = next ? head.getAttribute('aria-expanded') === 'true' : group.classList.contains('open');
      if (!open) head.click();
    }, next);

    // closed: the count on the bell
    await until(s => { const b = document.querySelector(s); return b && getComputedStyle(b).display !== 'none' && b.textContent === '1'; }, sel('#notif-badge', '[data-part=bellBadge]'));
    await reading('closed');

    // narrowed: the rail, narrowed to its icons (at a width where it can be; narrower, nothing changes)
    const narrow = () => page.evaluate(next => document.querySelector(next ? '[data-part=collapse]' : '.sidebar-collapse-btn').click(), next);
    await narrow();
    await reading('narrowed', { navBadge: part('#notif-nav-badge', '[data-screen=notifications] [data-part=navBadge]', 'none', null, true) });
    await narrow();

    // open: the panel (pressing the bell reads them all)
    await page.click(sel('#notif-bell', '[data-part=bell]'));
    await until(s => document.querySelectorAll(s).length === 4, sel('#notif-list .notif-item', '[data-part=panel] [data-part=item]'));
    await reading('open');

    // live: one arrives while the panel is open
    await ctx.createNotification(memberKey, { type: 'request', title: '⚠️ Live one', body: 'Arrived while the panel was open', url: (p.who === 'admin' ? '/dashboard' : '/employee') + '#requests' }, false);
    await until(s => document.querySelectorAll(s).length === 1, sel('#notif-list .notif-item.unread', '[data-part=panel] [data-part=item][data-unread=true]'));
    await until(s => { const t = document.querySelector(s); return t && getComputedStyle(t).opacity === '1'; }, sel(p.who === 'admin' ? 'body > div[style*="9999"]' : '.emp-toast.show', '[data-part=toast]'));
    await reading('live');

    // page: "View all"
    await page.click(sel('.notif-panel-head .notif-readall:not(#notif-readall)', '[data-part=viewAll]'));
    await until(s => document.querySelectorAll(s).length === 5, sel('#notif-center-list .notif-center-item', '[data-part=centerItem]'));
    await reading('page');
    await page.shut();
  };

  const observed = {};   // `${portal}/${look}/${mode}/${state}/${width}` -> side -> role -> style
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
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 40000, String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
