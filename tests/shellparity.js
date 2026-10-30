// The new app's frame against the classic portals', value by value.
//
// "Same look first" holds the whole move: a person switched to the new app must see what they saw. For the frame every
// screen sits in — the rail, the top bar, the phone's bottom bar — that is checked here rather than by eye. The classic
// portal and the new app are both opened in a real browser, signed in as the same person, in both modes and two looks (the
// original and a loud one, so a colour that was written down instead of read from the workspace's look is caught), at a
// phone's width, two in-betweens and a desktop; the computed style of every named part is read — size and position,
// spacing, colours, type, borders, shadows — and any property that differs is a failure, except the few named in ACCEPTED,
// each with its reason.
//
// Run with --print to see every difference rather than the first few; --only=<portal>/<look>/<mode>/<width> narrows it.
// The classic pages are what this holds the new app to, so it goes when they do (Run P4), and the suite with it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { bootDemo } = require('./helpers/demo-data');
const { chromePath } = require('./helpers/browser');

const ROOT = path.join(__dirname, '..');
const PRINT = process.argv.includes('--print');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-web-'));
const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', dist, '--emptyOutDir'], { cwd: path.join(ROOT, 'apps', 'web'), encoding: 'utf8' });
if (build.status !== 0) { console.log(build.stdout, build.stderr); console.log(' FAIL the web app builds'); process.exit(1); }

// What is compared. Position and size come from the box (_rect): the computed width and height of an inline element are "auto".
const PROPS = ['display', 'position', 'boxSizing', 'top', 'left', 'right', 'bottom', 'zIndex', 'overflowX', 'overflowY', 'transform',
  'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flexGrow', 'flexShrink', 'flexBasis', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRightWidth', 'borderRightStyle', 'borderRightColor',
  'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor', 'borderLeftWidth', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'color', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'textTransform', 'textAlign', 'textDecorationLine', 'textOverflow', 'whiteSpace',
  'boxShadow', 'opacity', 'gap', 'alignItems', 'alignSelf', 'justifyContent', 'flexDirection', 'cursor', 'filter', 'backdropFilter', 'userSelect', 'visibility'];

// Where the two differ on purpose or by necessity, and why. Each must still differ, or it is stale and fails.
const ACCEPTED = {
  'nav._h': 'the classic rail has a search box and a row of shortcuts above the list, which come with Cmd+K and the favourites; the list is taller here',
  'footer._h': 'the classic footer also holds Arrange sections and the workspace settings, which are not in the new app yet',
  'content._h': 'what is under the header is the screen itself, and the classic Home is a page of widgets',
  'title._w': 'at a phone\'s width the classic header\'s right-hand cluster (refresh, help, bell, Refresh) leaves its name six pixels to be squeezed into',
  'modeToggle._x': 'the classic header also carries the refresh countdown, help, the notification bell and a Refresh button to its right; they come with their screens',
};

// The part of the page each role names, in the classic page and in the new app. `y` says how the box's top is held: 'abs' the
// page's own, 'nav' relative to the rail's list (the classic rail has a search and a shortcuts row above it that this run does
// not carry yet), 'none' not at all.
const part = (classic, next, y = 'abs') => ({ classic, next, y });
const ROLES = {
  admin: {
    sidebar: part('#sidebar', '[data-part=sidebar]'),
    brand: part('.sidebar-logo', '[data-part=brand]'),
    mark: part('.sidebar-logo-icon', '[data-part=mark]'),
    brandName: part('.sidebar-logo-text', '[data-part=brandName]'),
    brandSub: part('.sidebar-logo-sub', '[data-part=brandSub]'),
    collapse: part('.sidebar-collapse-btn', '[data-part=collapse]'),
    close: part('.sidebar-close-btn', '[data-part=close]'),
    nav: part('.sidebar-nav', '[data-part=nav]', 'none'),
    group: part('.nav-group[data-group=management]', '[data-part=group][data-group=management]', 'nav'),
    groupHead: part('.nav-group[data-group=management] .nav-group-head', '[data-group=management] [data-part=groupHead]', 'nav'),
    groupLabel: part('.nav-group[data-group=management] .nav-group-label', '[data-group=management] [data-part=groupLabel]', 'nav'),
    groupCount: part('.nav-group[data-group=management] .nav-group-count', '[data-group=management] [data-part=groupCount]', 'nav'),
    chevron: part('.nav-group[data-group=management] .nav-group-chevron', '[data-group=management] svg[class*=chevron]', 'nav'),
    itemActive: part('#nav-home', '[data-part=itemActive]', 'nav'),
    item: part('#nav-tasks', '[data-group=management] [data-part=item]', 'nav'),
    icon: part('#nav-tasks .nav-icon', '[data-group=management] [data-part=item] [data-part=icon]', 'nav'),
    iconSvg: part('#nav-tasks .nav-icon svg', '[data-group=management] [data-part=item] [data-part=icon] svg', 'nav'),
    footer: part('.sidebar-footer', '[data-part=footer]', 'none'),
    signOut: part('.sidebar-footer .logout-btn:last-child', '[data-part=signOut]', 'none'),
    content: part('.app-content', '[data-part=content]'),
    header: part('.app-content > .header', '[data-part=header]'),
    hamburger: part('#hamburger-btn', '[data-part=hamburger]'),
    logo: part('.header .logo', '[data-part=logo]'),
    title: part('.header h1', '[data-part=title]'),
    badge: part('.header .header-badge', '[data-part=badge]'),
    modeToggle: part('#ml-mode-toggle', '[data-part=modeToggle]'),
    bottomNav: part('#bottom-nav', '[data-part=bottomNav]'),
    bottomActive: part('#bnav-home', '[data-part=bottomActive]'),
    bottomItem: part('#bnav-tasks', '[data-part=bottomItem]'),
  },
  team: {
    sidebar: part('#sidebar', '[data-part=sidebar]'),
    brand: part('.sidebar-brand', '[data-part=brand]'),
    mark: part('.sidebar-icon', '[data-part=mark]'),
    brandName: part('.sidebar-brand-name', '[data-part=brandName]'),
    brandSub: part('.sidebar-brand-sub', '[data-part=brandSub]'),
    collapse: part('.sidebar-collapse-btn', '[data-part=collapse]'),
    close: part('.sidebar-close-btn', '[data-part=close]'),
    nav: part('.sidebar-nav', '[data-part=nav]', 'none'),
    group: part('.nav-group[data-group=management]', '[data-part=group][data-group=management]', 'nav'),
    groupHead: part('.nav-group[data-group=management] .nav-group-head', '[data-group=management] [data-part=groupHead]', 'nav'),
    groupLabel: part('.nav-group[data-group=management] .nav-group-label', '[data-group=management] [data-part=groupLabel]', 'nav'),
    chevron: part('.nav-group[data-group=management] .nav-group-chevron', '[data-group=management] svg[class*=chevron]', 'nav'),
    itemActive: part('#nav-home', '[data-part=itemActive]', 'nav'),
    item: part('#nav-tasks', '[data-group=management] [data-part=item]', 'nav'),
    icon: part('#nav-tasks .nav-icon', '[data-group=management] [data-part=item] [data-part=icon]', 'nav'),
    iconSvg: part('#nav-tasks .nav-icon svg', '[data-group=management] [data-part=item] [data-part=icon] svg', 'nav'),
    content: part('.content', '[data-part=content]'),
    header: part('.content > .topbar', '[data-part=header]'),
    hamburger: part('#hamburger-btn', '[data-part=hamburger]'),
    title: part('#topbar-title', '[data-part=title]'),
    modeToggle: part('#ml-mode-toggle', '[data-part=modeToggle]'),
    profileBtn: part('#profile-btn', '[data-part=profileBtn]'),
    avatar: part('#profile-btn .user-avatar', '[data-part=profileBtn] [data-part=avatar]'),
    bottomNav: part('#bottom-nav', '[data-part=bottomNav]'),
    bottomActive: part('#bnav-home', '[data-part=bottomActive]'),
    bottomItem: part('#bnav-tasks', '[data-part=bottomItem]'),
  },
};
const LOOKS = { original: { reset: true }, loud: { theme: { preset: 'cyberpunk' } } };
const MODES = ['dark', 'light'];
const WIDTHS = [390, 670, 800, 1100];

const STILL = '*,*::before,*::after{transition:none!important;animation:none!important}';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const readRoles = (page, which) => page.evaluate((roles, which, props) => {
  const out = {};
  const navTop = (() => { const n = document.querySelector(roles.nav[which]); return n ? n.getBoundingClientRect().y : 0; })();
  for (const [role, sel] of Object.entries(roles)) {
    const el = document.querySelector(sel[which]);
    if (!el) { out[role] = null; continue; }
    // A part that is not drawn at this width has no look to compare, only the fact that it is not drawn.
    if (!el.checkVisibility()) { out[role] = { _hidden: true }; continue; }
    const cs = getComputedStyle(el), o = {};
    for (const p of props) o[p] = cs[p];
    const r = el.getBoundingClientRect();
    const y = sel.y === 'abs' ? r.y : sel.y === 'nav' ? r.y - navTop : 0;
    const half = n => Math.round(n * 2) / 2;
    Object.assign(o, { _x: half(r.x), _y: half(y), _w: half(r.width), _h: half(r.height) });
    out[role] = o;
  }
  return out;
}, Object.fromEntries(Object.entries(ROLES[page.portal]).map(([k, v]) => [k, v])), which, PROPS);

(async () => {
  const puppeteer = require('puppeteer');
  process.env.ML_WEB_DIST = dist;   // where the server finds the new app's build
  const { base, portals } = await bootDemo({ port: process.env.PORT || 3999 });
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
  const adminToken = portals.find(p => p.who === 'admin').token;

  const open = async (p, mode, next) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.portal = p.who;
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(u)) return r.respond({ status: 200, contentType: 'text/plain', body: '' });
      if (/^https?:/.test(u) && !u.startsWith(base)) return r.abort('internetdisconnected');
      r.continue();
    });
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument((key, token, mode) => {
      // Draws what lucide draws (an <svg class="lucide …"> in the <i>'s place), minus the glyph: icons are laid out and coloured as
      // they would be, and can be measured.
      window.lucide = { createIcons() {
        for (const i of document.querySelectorAll('i[data-lucide]')) {
          const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          for (const a of i.attributes) if (a.name !== 'data-lucide') s.setAttribute(a.name, a.value);
          s.setAttribute('class', ('lucide lucide-' + i.getAttribute('data-lucide') + ' ' + (i.getAttribute('class') || '')).trim());
          if (!s.getAttribute('width')) s.setAttribute('width', '24');
          if (!s.getAttribute('height')) s.setAttribute('height', '24');
          s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
          i.replaceWith(s);
        }
      } };
      window.Chart = function () { return { destroy() {}, update() {} }; };
      localStorage.setItem(key, token);
      localStorage.setItem('ml_mode', mode);
    }, p.key, p.token, mode);
    if (next) await page.setCookie({ name: 'ml_ui', value: 'next', url: base });
    await page.setViewport({ width: 1100, height: 800 });
    await page.goto(base + (next ? p.route : p.route === '/dashboard' ? '/legacy/dashboard' : '/legacy/employee'), { waitUntil: 'domcontentloaded' });
    page.shut = async () => { await page.close(); await context.close(); };
    return page;
  };
  const settle = page => page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); document.getAnimations().forEach(a => a.cancel()); }).then(() => page.mouse.move(0, 0)).then(() => sleep(80));

  const observed = {};   // `${portal}/${look}/${mode}/${width}` -> side -> role -> style
  for (const [look, body] of Object.entries(LOOKS)) {
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error('could not save the look: ' + await saved.text());
    for (const p of portals) for (const mode of MODES) for (const side of ['classic', 'next']) {
      if (ONLY && !`${p.who}/${look}/${mode}`.startsWith(ONLY.split('/').slice(0, 3).join('/'))) continue;
      const page = await open(p, mode, side === 'next');
      await page.waitForSelector(side === 'next' ? '[data-part=sidebar]' : '#nav-home.active', { timeout: 20000 });
      await sleep(900);
      await page.addStyleTag({ content: STILL });
      const got = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
      if (got !== mode) throw new Error(`${p.who}/${look}/${side}: the page is in ${got}, not ${mode}`);
      for (const width of WIDTHS) {
        await page.setViewport({ width, height: 800 });
        await settle(page);
        const key = `${p.who}/${look}/${mode}/${width}`;
        (observed[key] = observed[key] || {})[side] = await readRoles(page, side);
      }
      await page.shut();
    }
  }
  await browser.close();

  // ── compare ──
  // (0 0 and 0% 0% are the same place: a minifier writes the one for the other when a background is `none`)
  const origin = v => (v === '0px 0px' ? '0% 0%' : v);
  const near = (a, b, p) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.5 : p === 'backgroundPosition' ? origin(a) === origin(b) : a === b;
  const stale = new Set(Object.keys(ACCEPTED));
  let compared = 0;
  for (const [key, sides] of Object.entries(observed)) {
    const { classic, next } = sides;
    if (!classic || !next) continue;
    const bad = [];
    let n = 0;
    for (const role of Object.keys(classic)) {
      const c = classic[role], x = next[role];
      if (!c && !x) continue;   // (the part is not drawn at this width, in either)
      if (!c || !x) { bad.push(`${role}: ${c ? 'missing from the new app' : 'missing from the classic page'}`); continue; }
      if (c._hidden || x._hidden) {
        n++; compared++;
        if (!!c._hidden !== !!x._hidden) bad.push(`${role}: ${c._hidden ? 'not drawn in the classic page, drawn in the new app' : 'drawn in the classic page, not in the new app'}`);
        continue;
      }
      for (const p of [...PROPS, '_x', '_y', '_w', '_h']) {
        n++; compared++;
        if (near(c[p], x[p], p)) continue;
        if (ACCEPTED[`${role}.${p}`]) { stale.delete(`${role}.${p}`); continue; }
        bad.push(`${role}.${p}: classic ${JSON.stringify(c[p])} vs new ${JSON.stringify(x[p])}`);
      }
    }
    check(`${key}: ${n} values are the classic page's`, bad.length === 0, PRINT ? '\n      ' + bad.join('\n      ') : bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ` … and ${bad.length - 4} more` : ''));
  }
  if (!ONLY) {
    check('it compared a real number of values (a comparison that found nothing would pass everything)', compared > 9000, String(compared));
    check('every accepted difference still differs, so the list is not hiding anything that got fixed', stale.size === 0, [...stale].join(', '));
  }
  fs.rmSync(dist, { recursive: true, force: true });
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); fs.rmSync(dist, { recursive: true, force: true }); process.exit(1); });
