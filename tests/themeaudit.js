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
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
const { parseSchema, seedTables } = require('./helpers/seed');
const T = require('../public/assets/theme-core.js');

const args = process.argv.slice(2);
const flag = n => (args.find(a => a.startsWith('--' + n + '=')) || '').slice(n.length + 3);
const FULL = args.includes('--full'), LIST = args.includes('--list');
const ONLY = flag('only'), PAGES = flag('pages');

// The matrix the suite runs. The others are the same maths on other colours: --full has them.
const CHECKED = [['black-gold', 'light'], ['moto', 'light'], ['moto', 'dark'], ['cyberpunk', 'dark'], ['cyberpunk', 'light'], ['neon-minimal', 'light']];
const matrix = ONLY ? [ONLY.split(':')]
  : FULL ? T.PRESET_ORDER.flatMap(p => [[p, 'dark'], [p, 'light']])
  : CHECKED;

const ADMIN_PAGES = ['home', 'tasks', 'employees', 'requests', 'hours', 'calendar', 'quotation', 'customers', 'deals', 'suppliers', 'rfqs', 'stock', 'contracts', 'purchaseorders', 'reports', 'accounting', 'automations', 'chat', 'notif'];
const TEAM_PAGES = ['home', 'tasks', 'hours', 'requests', 'leads', 'deals', 'stock', 'suppliers', 'rfq', 'purchaseorders', 'contracts', 'issues', 'calendar', 'accounting', 'reports', 'quotation', 'chat', 'notif'];

// Text that is allowed to fall short, and why. Each entry is matched against the element's
// signature (tag and classes) and must say what makes it exempt.
const ALLOWED = [
  // (none yet)
];

// The tab strips the pages use (a tab that is already showing is not another screen).
const TAB_SELECTOR = '.page.active .tab, .page.active .task-view-tab, .page.active .deal-tab, .page.active .logi-tab, .page.active [role="tab"], .page.active .acct-tab, .page.active .rep-tab';
const TABS = sel => [...document.querySelectorAll(sel)].filter(e => e.checkVisibility() && !e.classList.contains('active')).map(e => (e.textContent || '').trim().slice(0, 18));

// Runs in the page: [{ sig, text, fg, bg, ratio, need }] for everything that shows text.
function auditPage() {
  const parse = c => {
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4])];
    m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(c);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4])];
    return null;
  };
  const over = (top, under) => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map(i => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a);
  };
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  // the colour stops of a (computed) gradient, as the solid colours a text on it could meet
  // (only the topmost layer: with a border-box gradient behind a padding-box one, the content sits on the top one)
  const topLayer = img => { let depth = 0; for (let i = 0; i < img.length; i++) { if (img[i] === '(') depth++; else if (img[i] === ')') depth--; else if (img[i] === ',' && depth === 0) return img.slice(0, i); } return img; };
  const stops = img => [...topLayer(img).matchAll(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g)].map(m => parse(m[0])).filter(Boolean);

  // What an element is drawn on: a list of candidate solid colours (one unless a gradient is
  // involved), worked out from the element's own background up to the first opaque layer.
  const ground = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const solid = parse(cs.backgroundColor) || [0, 0, 0, 0];
      const img = cs.backgroundImage;
      if (img && img !== 'none') {
        if (/url\(/.test(img) && !/gradient/.test(img)) layers.push({ unknown: true });
        else { const s = stops(img); if (s.length) layers.push({ stops: s }); }
      }
      layers.push({ solid });
      if (solid[3] === 1 && !(img && img !== 'none')) break;
    }
    let candidates = [[255, 255, 255, 1]];   // the browser's canvas, if nothing above is opaque
    for (const l of layers.reverse()) {
      if (l.unknown) return null;
      if (l.stops) candidates = candidates.flatMap(u => l.stops.map(s => over(s, u)));
      else candidates = candidates.map(u => over(l.solid, u));
    }
    return candidates;
  };

  const out = [];
  const seen = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'OPTION', 'SVG', 'CANVAS', 'PATH', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OPTGROUP'].includes(el.tagName.toUpperCase())) continue;
    if (el.closest('svg, canvas, iframe')) continue;
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
    text = text.replace(/\s+/g, ' ').trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .disabled')) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const cand = ground(el);
    if (!cand) continue;
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    let worst = 99, worstBg = null;
    for (const bg of cand) {
      const solidBg = bg[3] < 1 ? over(bg, [255, 255, 255, 1]) : bg;
      const text = fg[3] < 1 ? over(fg, solidBg) : fg;
      const rr = ratio(text, solidBg);
      if (rr < worst) { worst = rr; worstBg = solidBg; }
    }
    if (worst >= need) continue;
    const sig = el.localName + (el.getAttribute('class') ? '.' + el.getAttribute('class').trim().split(/\s+/).slice(0, 3).join('.') : '');
    const parent = el.parentElement ? el.parentElement.localName + (el.parentElement.getAttribute('class') ? '.' + el.parentElement.getAttribute('class').trim().split(/\s+/)[0] : '') : '';
    const key = sig + '|' + hex(fg) + '|' + hex(worstBg);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sig, parent, text: text.slice(0, 28), fg: hex(fg), bg: hex(worstBg), ratio: Math.round(worst * 100) / 100, need });
  }
  // Icons: a graphic that carries meaning is held to 3:1 (WCAG 1.4.11), drawn in the colour it inherits.
  for (const el of document.body.querySelectorAll('svg.lucide')) {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .disabled')) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const cand = ground(el);
    if (!cand) continue;
    let worst = 99, worstBg = null;
    for (const bg of cand) {
      const solidBg = bg[3] < 1 ? over(bg, [255, 255, 255, 1]) : bg;
      const ink = fg[3] < 1 ? over(fg, solidBg) : fg;
      const rr = ratio(ink, solidBg);
      if (rr < worst) { worst = rr; worstBg = solidBg; }
    }
    if (worst >= 3) continue;
    const name = (el.getAttribute('class') || '').match(/lucide-([a-z0-9-]+)/);
    const sig = 'icon ' + (name ? name[1] : '?');
    const p = el.parentElement;
    const parent = p ? p.localName + (p.getAttribute('class') ? '.' + p.getAttribute('class').trim().split(/\s+/)[0] : '') : '';
    const key = sig + '|' + parent + '|' + hex(fg) + '|' + hex(worstBg);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sig, parent, text: '', fg: hex(fg), bg: hex(worstBg), ratio: Math.round(worst * 100) / 100, need: 3 });
  }
  return out;
}

(async () => {
  const db = createFakeSupabase(seedTables(parseSchema()));
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3965 });
  const ctx = require(path.join(__dirname, '..', 'src', 'ctx'));
  const { normEmpPerms, PERM_ACTIONS } = require(path.join(__dirname, '..', 'src', 'routes', 'employee-portal.js'));
  const allOn = {};
  for (const [k, v] of Object.entries(normEmpPerms({}))) if (typeof v === 'boolean') allOn[k] = true;
  for (const [section, actions] of Object.entries(PERM_ACTIONS || {})) allOn[section + 'Actions'] = Object.fromEntries(actions.map(a => [a, true]));
  const ADMIN = 'audit-admin', EMP = 'audit-employee';
  ctx.sessions.set(ADMIN, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(EMP, { id: 1, name: 'Admin Person', username: 'smoke', job_title: 'Chief Technical Officer', permissions: normEmpPerms(allOn), createdAt: Date.now() });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });

  const portals = [
    { who: 'admin', route: '/dashboard', key: 'ml_admin_token', token: ADMIN, pages: ADMIN_PAGES },
    { who: 'team', route: '/employee', key: 'ml_emp_token', token: EMP, pages: TEAM_PAGES },
  ];
  const all = [];   // { look, who, page, ...failure }
  let screens = 0;
  for (const [preset, mode] of matrix) {
    // The admin saves the look; the page then arrives with it already in.
    const saved = await fetch(base + '/api/dashboard/workspace/theme', { method: 'PUT', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(preset === 'black-gold' ? { reset: true } : { theme: { preset } }) });
    if (!saved.ok) throw new Error('could not save ' + preset + ': ' + await saved.text());
    for (const p of portals) for (const signedIn of [false, true]) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on('request', req => { if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' }); req.continue(); });
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
      const look = preset + ':' + mode;
      const measure = async label => {
        await page.evaluate(() => document.getAnimations().forEach(a => a.cancel()));
        screens++;
        for (const f of await page.evaluate(auditPage)) all.push({ look, who: p.who, page: label, ...f });
      };
      // The sign-in screen is the first thing anyone sees; it has nothing to navigate to.
      if (!signedIn) { if (!PAGES) await measure('sign-in'); await page.close(); continue; }
      for (const pg of (PAGES ? PAGES.split(',') : p.pages)) {
        await page.evaluate(n => { try { navigate(n); } catch (e) {} }, pg);
        await sleep(450);
        await measure(pg);
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
  const allowed = f => ALLOWED.some(a => a.test.test(f.sig));
  const bad = [...groups.values()].filter(g => !allowed(g)).sort((a, b) => b.pages.size - a.pages.size);
  console.log(`${matrix.length} look(s) × ${screens / matrix.length} screens: ${all.length} short of contrast, in ${groups.size} kinds of element`);
  for (const g of bad.slice(0, LIST ? 1e9 : 40)) {
    console.log(`  ${String(g.ratio).padStart(5)}:1 (needs ${g.need})  ${g.parent} > ${g.sig}  "${g.text}"  ${g.fg} on ${g.bg}   [${[...g.looks].join(' ')}]  ${[...g.pages].slice(0, 3).join(' ')}${g.pages.size > 3 ? ' +' + (g.pages.size - 3) : ''}`);
  }
  if (bad.length > 40 && !LIST) console.log(`  … and ${bad.length - 40} more (--list shows all)`);
  console.log(bad.length ? `${bad.length} kind(s) of text are too faint` : 'every look is readable on every screen');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
