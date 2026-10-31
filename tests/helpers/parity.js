// What the suites that hold the new app to the classic portals, value by value, have in common: the properties compared, a page
// opened in a real browser as one or the other (signed in, with the two CDN libraries the classic pages stop without stood in),
// and the reading and comparing of the computed style of the named parts of a page.
//
// A part is named once for both sides — `part(classicSelector, newSelector)` — and read by role. Where a part sits is held as:
//   y = 'abs'   the box's own place on the page (the default)
//   y = 'nav'   relative to the rail's list (`roles.nav`), which the classic rail pads with a search box and shortcuts
//   y = 'none'  not at all
//   rel = role  the box's place relative to another named part's, where the page around it is not what is being compared
//   text = true the words in it are compared too
const { chromePath } = require('./browser');

// What is compared. Position and size come from the box (_rect): the computed width and height of an inline element are "auto".
const PROPS = ['display', 'position', 'boxSizing', 'top', 'left', 'right', 'bottom', 'zIndex', 'overflowX', 'overflowY', 'transform',
  'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flexGrow', 'flexShrink', 'flexBasis', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRightWidth', 'borderRightStyle', 'borderRightColor',
  'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor', 'borderLeftWidth', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'color', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'textTransform', 'textAlign', 'textDecorationLine', 'textOverflow', 'whiteSpace',
  'boxShadow', 'opacity', 'gap', 'alignItems', 'alignSelf', 'justifyContent', 'flexDirection', 'cursor', 'filter', 'backdropFilter', 'userSelect', 'visibility'];
// …and for parts that clamp their text or let the pointer through (a notification's words, a toast)
const PROPS_MORE = [...PROPS, 'webkitLineClamp', 'webkitBoxOrient', 'pointerEvents'];
const EXTRA = ['_x', '_y', '_w', '_h', '_text'];

const part = (classic, next, y = 'abs', rel = null, text = false) => ({ classic, next, y, rel, text });

const STILL = '*,*::before,*::after{transition:none!important;animation:none!important}';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The page, in a context of its own (pages in one context leak font state into each other), signed in, in a colour mode.
// `next` opens the new app (the ml_ui cookie), otherwise the classic page at /legacy/<portal>. `stub` is described where it is used.
async function openPage(browser, base, p, mode, next, stub) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.portal = p.who;
  await page.setRequestInterception(true);
  page.on('request', async r => {
    const u = r.url();
    // What the server would say, said instead where a suite needs a state a real one cannot be put in:
    // `stub(url, method)` answers { status, body } or nothing (the request goes to the server).
    const said = stub && u.startsWith(base) ? await stub(u, r.method()) : null;
    if (said) return r.respond({ status: said.status || 200, contentType: 'application/json', body: JSON.stringify(said.body) });
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
}

// Nothing is moving, nothing has the pointer or the focus: a hover or focus transition is not read half-way.
const settle = page => page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); document.getAnimations().forEach(a => a.cancel()); }).then(() => page.mouse.move(0, 0)).then(() => sleep(80));

// The computed style of every named part, on one side ('classic' or 'next').
const readRoles = (page, roles, which, props = PROPS) => page.evaluate((roles, which, props) => {
  const out = {};
  const half = n => Math.round(n * 2) / 2;
  const navEl = roles.nav && document.querySelector(roles.nav[which]);
  const navTop = navEl ? navEl.getBoundingClientRect().y : 0;
  for (const [role, def] of Object.entries(roles)) {
    const el = document.querySelector(def[which]);
    if (!el) { out[role] = null; continue; }
    // A part that is not drawn at this width has no look to compare, only the fact that it is not drawn.
    if (!el.checkVisibility()) { out[role] = { _hidden: true }; continue; }
    const cs = getComputedStyle(el), o = {};
    for (const p of props) o[p] = cs[p];
    const r = el.getBoundingClientRect();
    let x = r.x, y = def.y === 'abs' ? r.y : def.y === 'nav' ? r.y - navTop : 0;
    if (def.rel) {
      const of = roles[def.rel] && document.querySelector(roles[def.rel][which]);
      const b = of && of.checkVisibility() ? of.getBoundingClientRect() : null;
      x = b ? r.x - b.x : NaN; y = b ? r.y - b.y : NaN;
    }
    Object.assign(o, { _x: half(x), _y: half(y), _w: half(r.width), _h: half(r.height) });
    if (def.text) o._text = (el.innerText || '').replace(/\s+/g, ' ').trim();
    out[role] = o;
  }
  return out;
}, roles, which, props);

// (0 0 and 0% 0% are the same place: a minifier writes the one for the other when a background is `none`)
const origin = v => (v === '0px 0px' ? '0% 0%' : v);
const near = (a, b, p) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.5 : p === 'backgroundPosition' ? origin(a) === origin(b) : a === b;

// How the classic reading and the new one differ: how many values were compared, and the differences that nobody accepted.
// `accepted` is { 'role.prop': why }; `stale` collects the ones that did NOT differ, so a fixed difference cannot hide in the list.
function diff(classic, next, accepted, stale, props = PROPS) {
  const bad = [];
  let n = 0;
  for (const role of Object.keys(classic)) {
    // (a part that is hidden and one that is not there are the same thing to a person)
    const c = classic[role] || { _hidden: true }, x = next[role] || { _hidden: true };
    if (c._hidden && x._hidden) { if (classic[role] && next[role]) n++; continue; }
    if (c._hidden || x._hidden) {
      n++;
      bad.push(`${role}: ${c._hidden ? 'not drawn in the classic page, drawn in the new app' : 'drawn in the classic page, not in the new app'}`);
      continue;
    }
    for (const p of [...props, ...EXTRA]) {
      if (p === '_text' && c._text === undefined && x._text === undefined) continue;
      n++;
      if (near(c[p], x[p], p)) continue;
      if (accepted[`${role}.${p}`]) { stale.delete(`${role}.${p}`); continue; }
      bad.push(`${role}.${p}: classic ${JSON.stringify(c[p])} vs new ${JSON.stringify(x[p])}`);
    }
  }
  return { n, bad };
}

const launch = () => require('puppeteer').launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });

module.exports = { PROPS, PROPS_MORE, STILL, sleep, part, openPage, settle, readRoles, diff, near, launch };
