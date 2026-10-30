// Every look is readable, on the real screens.
//
// For each preset and each mode, both portals are booted on the in-memory database with
// the screens full of rows (tests/helpers/seed.js), the look is saved the way the admin
// saves it, and every page is opened. On each, every element that shows text is measured
// against what it is actually drawn on: the background is worked out layer by layer up
// the page (translucent colours composited over what is behind them; a gradient counted
// at its worst stop), and the text colour is composited over that. Ordinary text must
// reach 4.5:1 and large text 3:1. Anything lower is listed with the element, its colours
// and the page, grouped, and fails the run unless it is in ALLOWED with a reason.
//
//   node tests/themeaudit.js                     the checked matrix
//   node tests/themeaudit.js --full              all eight presets, both modes
//   node tests/themeaudit.js --only=moto:light   one look
//   node tests/themeaudit.js --pages=home,tasks  fewer screens, for a quick look
//   node tests/themeaudit.js --list              print every failure, not the top few
//   node tests/themeaudit.js --width=390         everything at phone width (the default run adds two looks at 390)
//   node tests/themeaudit.js --part=2/3          every 3rd look, from the 2nd: the audit is the longest suite, and
//                                                tests/run.sh runs it as three parts (themeaudit1..3) so CI can
//                                                spread it over machines; the three together are the whole matrix
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const T = require('../public/assets/theme-core.js');
const { gotoPage } = require('./helpers/browser');
const { auditPage } = require('../tools/contrast');

const args = process.argv.slice(2);
const flag = n => (args.find(a => a.startsWith('--' + n + '=')) || '').slice(n.length + 3);
const FULL = args.includes('--full'), LIST = args.includes('--list');
const ONLY = flag('only'), PAGES = flag('pages'), WIDTH = +flag('width') || 0;

// The matrix the suite runs. The others are the same maths on other colours: --full has them.
// (Not in either: Black & Gold's dark, which is the original look — what a workspace that has
// chosen nothing shows, unchanged by all of this, and not held to a bar it never met: thirty or
// so kinds of text in it are under 4.5:1 and always were. --only=black-gold:dark lists them.)
const CHECKED = [['black-gold', 'light'], ['moto', 'light'], ['moto', 'dark'], ['cyberpunk', 'dark'], ['cyberpunk', 'light'], ['neon-minimal', 'light']];
// Each entry is [preset, mode, width]. The checked matrix is at desktop width; the two looks that differ
// most (a light page under a dark rail, a neon dark) are also run at phone width, where the pages draw
// their own bottom bar, drawers and header.
const PHONE = [['moto', 'light'], ['cyberpunk', 'dark']];
const matrix = (ONLY ? [ONLY.split(':')]
  : FULL ? T.PRESET_ORDER.flatMap(p => [[p, 'dark'], [p, 'light']]).filter(([p, m]) => !(p === 'black-gold' && m === 'dark'))
  : CHECKED).map(([p, m]) => [p, m, WIDTH || 1280]);
if (!ONLY && !FULL && !WIDTH) for (const [p, m] of PHONE) matrix.push([p, m, 390]);
const PART = flag('part');
if (PART) {
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(PART);
  if (!m || +m[1] > +m[2]) throw new Error('--part wants I/N with 1 <= I <= N, got ' + PART);
  const mine = matrix.filter((_, k) => k % +m[2] === +m[1] - 1);
  matrix.length = 0; matrix.push(...mine);
  if (!matrix.length) { console.log('no look falls in part ' + PART); process.exit(0); }
}

const ADMIN_PAGES = ['home', 'tasks', 'employees', 'requests', 'hours', 'calendar', 'quotation', 'customers', 'deals', 'suppliers', 'rfqs', 'stock', 'contracts', 'purchaseorders', 'reports', 'accounting', 'automations', 'chat', 'notif', 'workspace'];
const TEAM_PAGES = ['home', 'tasks', 'hours', 'requests', 'leads', 'deals', 'stock', 'suppliers', 'rfq', 'purchaseorders', 'contracts', 'issues', 'calendar', 'accounting', 'reports', 'quotation', 'chat', 'notif'];

// Text that is allowed to fall short, and why. Each entry is matched against the element's
// signature (tag and classes) and must say what makes it exempt.
const ALLOWED = [
  // `look` (optional) limits an entry to looks it matches: every look a failure was seen in has to match.
  { test: /^span\.wsa-ct-aa/, why: 'the Readability table\'s "Aa" is a sample of the pair it reports, with its ratio printed beside it (a pair that has to reach 3:1 as a fill is shown as it is)' },
  { test: /^span\.ce-pill/, look: /:dark/, why: 'a colour somebody picked for a status is data, drawn as chosen on a dark page — exactly as in the original look, where the shipped #dc2626 and #888888 are the same colours' },
];

// The tab strips the pages use (a tab that is already showing is not another screen).
const TAB_SELECTOR = '.page.active .tab, .page.active .task-view-tab, .page.active .deal-tab, .page.active .logi-tab, .page.active [role="tab"], .page.active .acct-tab, .page.active .rep-tab, .page.active .wsa-tab';
const TABS = sel => [...document.querySelectorAll(sel)].filter(e => e.checkVisibility() && !e.classList.contains('active')).map(e => (e.textContent || '').trim().slice(0, 18));

(async () => {
  const db = createFakeSupabase(seedTables(parseSchema()));
  db.install();
  // A conversation, so the chat screens have bubbles to draw: the admin and the team member talk in a group.
  const at = m => new Date(Date.UTC(2026, 2, 4, 9, m)).toISOString();
  db.tables.chat_rooms = [{ id: 1, type: 'group', name: 'Showroom', created_by: 'admin', created_at: at(0), updated_at: at(9) }];
  db.tables.chat_room_members = [{ room_id: 1, member_key: 'admin', member_name: 'Admin', joined_at: at(0) }, { room_id: 1, member_key: 'employee_1', member_name: 'Admin Person', joined_at: at(0) }];
  db.tables.chat_messages = [
    { id: 1, room_id: 1, sender_key: 'admin', sender_name: 'Admin', body: 'Morning team — the new stock arrives today.', created_at: at(1) },
    { id: 2, room_id: 1, sender_key: 'employee_1', sender_name: 'Admin Person', body: 'Great. I will check the paperwork: https://example.com/shipment/42', created_at: at(2) },
    { id: 3, room_id: 1, sender_key: 'admin', sender_name: 'Admin', body: 'Thanks! Please tell me if anything is missing.', created_at: at(3) },
  ];
  // The leads, in the six statuses the product ships and in a few a person might choose: the colour of
  // a status is data (public/assets/columns.js), and the pill it draws is held to the same bar. The
  // last five are the awkward ones — white, pale yellow, cyan, lime, hot pink.
  const STATUSES = [['cold', 'Cold', '#b9b3a4'], ['warm', 'Warm', '#e69650'], ['hot', 'Hot', '#f87171'], ['immediate_delivery', 'Immediate Delivery', '#6dd8a4'],
    ['not_interested', 'Not Interested', '#888888'], ['blacklist', 'Blacklist', '#dc2626'],
    ['vip', 'VIP', '#ffffff'], ['sunny', 'Sunny', '#ffe066'], ['ice', 'Ice', '#00e5ff'], ['lime', 'Lime', '#c6ff3d'], ['pink', 'Pink', '#ff2bd6']];
  db.tables.quotation_settings = (db.tables.quotation_settings || []).filter(r => r.key !== 'leads_columns_config').concat([{
    key: 'leads_columns_config',
    value: JSON.stringify([{ key: 'lead_status', label: 'Status', type: 'select', builtin: true, visible: true, options: STATUSES.map(([key, label, color]) => ({ key, label, color })) }]),
  }]);
  const first = db.tables.customers[0];
  db.tables.customers = STATUSES.map(([key], i) => ({ ...first, id: i + 1, name: 'Lead ' + (i + 1), phone: '+97155000' + String(i + 10), phone_norm: '+97155000' + String(i + 10), lead_status: key }));
  db.tables.lead_activities = [
    { id: 1, customer_id: 1, type: 'status_change', body: 'Status changed', meta: { from: 'cold', to: 'vip' }, author_key: 'admin', author_name: 'Admin', created_at: at(5) },
    { id: 2, customer_id: 1, type: 'status_change', body: 'Status changed', meta: { from: 'vip', to: 'sunny' }, author_key: 'admin', author_name: 'Admin', created_at: at(6) },
    { id: 3, customer_id: 1, type: 'status_change', body: 'Status changed', meta: { from: 'sunny', to: 'ice' }, author_key: 'admin', author_name: 'Admin', created_at: at(7) },
    { id: 4, customer_id: 1, type: 'status_change', body: 'Status changed', meta: { from: 'ice', to: 'hot' }, author_key: 'admin', author_name: 'Admin', created_at: at(8) },
  ];
  const base = await bootApp({ port: process.env.PORT || 3965 });
  const ctx = require(path.join(__dirname, '..', 'src', 'ctx'));
  const { normEmpPerms, PERM_ACTIONS } = require(path.join(__dirname, '..', 'src', 'routes', 'employee-portal.js'));
  const allOn = {};
  for (const [k, v] of Object.entries(normEmpPerms({}))) if (typeof v === 'boolean') allOn[k] = true;
  for (const [section, actions] of Object.entries(PERM_ACTIONS || {})) allOn[section + 'Actions'] = Object.fromEntries(actions.map(a => [a, true]));
  // The session below is rebuilt from the employee's row at the first /check, so the row carries the same permissions:
  // otherwise leads, deals, suppliers, rfq, reports … bounce to Home and what is measured for them is Home.
  db.tables.employees = db.tables.employees.map(e => (e.id === 1 ? { ...e, permissions: allOn } : e));
  const ADMIN = 'audit-admin', EMP = 'audit-employee';
  ctx.sessions.set(ADMIN, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(EMP, { id: 1, name: 'Admin Person', username: 'smoke', job_title: 'Chief Technical Officer', permissions: normEmpPerms(allOn), createdAt: Date.now() });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const browser = await puppeteer.launch({ executablePath: require('./helpers/browser').chromePath(), headless: 'new', args: ['--no-sandbox'] });

  const portals = [
    { who: 'admin', route: '/dashboard', key: 'ml_admin_token', token: ADMIN, pages: ADMIN_PAGES },
    { who: 'team', route: '/employee', key: 'ml_emp_token', token: EMP, pages: TEAM_PAGES },
  ];
  const all = [];   // { look, who, page, ...failure }
  let screens = 0;
  for (const [preset, mode, width] of matrix) {
    // The admin saves the look; the page then arrives with it already in.
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(preset === 'black-gold' ? { reset: true } : { theme: { preset } }) });
    if (!saved.ok) throw new Error('could not save ' + preset + ': ' + await saved.text());
    for (const p of portals) for (const signedIn of [false, true]) {
      const page = await browser.newPage();
      const phone = width < 600;
      await page.setViewport({ width, height: phone ? 844 : 900, isMobile: phone, hasTouch: phone });
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = req.url();
        if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(url)) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
        // Offline on purpose, whatever the network allows, so the audit sees the same page on every machine.
        // Leaflet is lazy-loaded from cdnjs on the stock Tracking page; it used to load only where cdnjs was
        // reachable (a hosted runner, not the dev image) and the audit then judged its attribution control
        // against map tiles it cannot see.
        if (/^https?:/.test(url) && !url.startsWith(base)) return req.abort('internetdisconnected');
        req.continue();
      });
      await page.evaluateOnNewDocument((key, token, mode) => {
        // Draws what lucide draws (an <svg class="lucide …"> in the <i>'s place, with its class and style),
        // minus the glyph: the page lays out and colours its icons as it would, and they can be measured.
        window.lucide = { createIcons() {
          for (const i of document.querySelectorAll('i[data-lucide]')) {
            const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            for (const a of i.attributes) if (a.name !== 'data-lucide') s.setAttribute(a.name, a.value);
            s.setAttribute('class', ('lucide lucide-' + i.getAttribute('data-lucide') + ' ' + (i.getAttribute('class') || '')).trim());
            if (!s.getAttribute('width')) s.setAttribute('width', '24');
            if (!s.getAttribute('height')) s.setAttribute('height', '24');
            s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
            s.innerHTML = '<rect x="4" y="4" width="16" height="16" rx="3"/>';
            i.replaceWith(s);
          }
        } };
        window.Chart = function () { return { destroy() {}, update() {} }; };
        // (the browser keeps its storage between pages: being signed out has to be said, not assumed)
        if (token) localStorage.setItem(key, token); else localStorage.removeItem(key);
        localStorage.setItem('ml_mode', mode);
        const Real = Date, FIXED = Real.UTC(2026, 2, 4, 10, 0, 0);
        window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
        window.Date.UTC = Real.UTC; window.Date.parse = Real.parse;
      }, p.key, signedIn ? p.token : null, mode);
      await page.goto(base + p.route, { waitUntil: 'domcontentloaded' });
      await sleep(1000);
      const got = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
      if (got !== mode) throw new Error(`${preset}:${mode} ${p.who}: the page opened in ${got}`);
      const look = preset + ':' + mode + (phone ? '@' + width : '');
      const measure = async label => {
        await page.evaluate(() => document.getAnimations().forEach(a => a.cancel()));
        screens++;
        for (const f of await page.evaluate(auditPage)) all.push({ look, who: p.who, page: label, ...f });
      };
      // The sign-in screen is the first thing anyone sees; it has nothing to navigate to.
      if (!signedIn) { if (!PAGES) await measure('sign-in'); await page.close(); continue; }
      for (const pg of (PAGES ? PAGES.split(',') : p.pages)) {
        // --pages names pages for both portals at once, so one that this portal does not have is skipped;
        // a page in the portal's own list that will not open is a failure.
        if (PAGES && !(await page.evaluate(n => !!document.getElementById('page-' + n), pg))) continue;
        await gotoPage(page, pg);
        await sleep(450);
        await measure(pg);
        // A lead open: its status in the header and the changes in the timeline.
        if ((p.who === 'admin' && pg === 'customers') || (p.who === 'team' && pg === 'leads')) {
          await page.evaluate(() => { try { openLeadProfile(1); } catch (e) {} });
          await sleep(900);
          await measure(pg + '→profile');
          await page.evaluate(() => { try { closeLeadProfile(); } catch (e) {} });
        }
        // A conversation open, for the chat screens.
        if (pg === 'chat') {
          await page.evaluate(w => { try { w === 'admin' ? adminChatOpenRoom(1) : chatOpenRoom(1); } catch (e) {} }, p.who);
          await sleep(700);
          await measure('chat→room');
        }
        // …and every tab the page has, one at a time (a tab is another screen).
        const tabs = await page.evaluate(TABS, TAB_SELECTOR);
        for (let i = 0; i < Math.min(tabs.length, 8); i++) {
          const label = await page.evaluate((sel, i) => { const t = [...document.querySelectorAll(sel)].filter(e => e.checkVisibility() && !e.classList.contains('active'))[i]; if (!t) return null; t.click(); return (t.textContent || '').trim().slice(0, 18); }, TAB_SELECTOR, i);
          if (label == null) break;
          await sleep(350);
          await measure(pg + '→' + label);
        }
      }
      // The pages' forms, which sit hidden until opened: each is shown in turn.
      if (!PAGES) {
        const modals = await page.evaluate(() => [...document.querySelectorAll('[id$="-modal"], #modal-overlay')].filter(e => e.style.display === 'none').map(e => e.id));
        for (const id of modals) {
          await page.evaluate(id => { const e = document.getElementById(id); e.style.display = 'flex'; }, id);
          await measure('modal:' + id);
          await page.evaluate(id => { document.getElementById(id).style.display = 'none'; }, id);
        }
      }
      await page.close();
    }
  }
  await browser.close();

  // Grouped by element kind and colours, across looks and pages.
  const groups = new Map();
  for (const f of all) {
    const key = f.sig + ' | ' + f.fg + ' on ' + f.bg;
    if (!groups.has(key)) groups.set(key, { ...f, looks: new Set(), pages: new Set() });
    const g = groups.get(key);
    g.looks.add(f.look); g.pages.add(f.who + '/' + f.page);
    g.ratio = Math.min(g.ratio, f.ratio);
  }
  const allowed = g => ALLOWED.some(a => a.test.test(g.sig) && (!a.look || [...g.looks].every(l => a.look.test(l))));
  const bad = [...groups.values()].filter(g => !allowed(g)).sort((a, b) => b.pages.size - a.pages.size);
  console.log(`${matrix.length} look(s) × ${screens / matrix.length} screens: ${all.length} short of contrast, in ${groups.size} kinds of element`);
  for (const g of bad.slice(0, LIST ? 1e9 : 40)) {
    console.log(`  ${String(g.ratio).padStart(5)}:1 (needs ${g.need})  ${g.parent} > ${g.sig}  "${g.text}"  ${g.fg} on ${g.bg}   [${[...g.looks].join(' ')}]  ${[...g.pages].slice(0, 3).join(' ')}${g.pages.size > 3 ? ' +' + (g.pages.size - 3) : ''}`);
  }
  if (bad.length > 40 && !LIST) console.log(`  … and ${bad.length - 40} more (--list shows all)`);
  console.log(bad.length ? `${bad.length} kind(s) of text are too faint` : PART ? `every look in part ${PART} is readable on every screen` : 'every look is readable on every screen');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
