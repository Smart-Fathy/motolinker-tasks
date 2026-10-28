// A before/after record of how the stylesheets resolve, for changes that must not
// move a pixel.
//
// Turning hard-coded colours into var(--token, <the same colour>) is meant to be a
// no-op until a workspace picks a theme, and "meant to" is not a proof. This is the
// proof: it opens each stylesheet in a real browser, and for every rule in it
// (media blocks, keyframes and all) applies the rule's declarations to a fresh
// element and records what the browser resolves each one to. Do that before the
// change and after it, and compare.
//
//   node tools/theme-golden.js record out.json     record the stylesheets as they are now
//   node tools/theme-golden.js check  out.json     compare the stylesheets as they are now
//   … check out.json --ignore-class=on-dark       leave a class out of every element's signature, for a
//                                                  change that only adds it
//   … check out.json --effective                   compare what each selector resolves to, not
//                                                  which rule says it: for a change that adds
//                                                  or reorders rules (a new token block, say)
//
// To compare a branch against its base, record on the base checkout and check on the
// branch. Not part of tests/run.sh: any intended style change moves the record, and a
// test that fails on every stylesheet edit is a tax, not a guard. What stays in the
// suite is tests/themecss.js (the sheets are well-formed) and tests/themeaudit.js
// (every theme is readable).
//
// The same is done for real pages: both portals are booted against the in-memory
// database, every page is opened, and the computed colours, radii, spacing and type of
// every element on it are recorded under a signature made of the element's own and its
// ancestors' tags and classes. That catches what a rule-by-rule record cannot — the
// cascade, inheritance, inline styles and anything a script paints.
//
// A rule is keyed by its sheet, its @media/@supports context and its selector; a
// selector that appears twice gets #2, #3 … by order. Properties are the longhands
// the browser expands the rule to, so a shorthand holding a var() is covered.
const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer');
const { createFakeSupabase, bootApp } = require('../tests/helpers/fake-supabase');

const ROOT = path.join(__dirname, '..', 'public');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHEETS = {
  admin: ['/assets/dashboard.css', '/assets/mobile.css'],
  team: ['/assets/employee.css', '/assets/mobile.css'],
};

function serve() {
  const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/__harness') {
        const which = new URL(req.url, 'http://x').searchParams.get('w');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><html><head><meta charset="utf-8">${SHEETS[which].map(s => `<link rel="stylesheet" href="${s}">`).join('')}</head><body><div id="stage" style="width:900px;font:16px/1.4 sans-serif"></div></body></html>`);
      }
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Every rule of a sheet, as the text of its declarations and where it sits. The same reader
// tools/theme-codemod.js uses to find what to change.
function readRules(css) {
  const { parse } = require('./theme-codemod');
  const seen = new Set(), out = [];
  for (const d of parse(css)) {
    const r = d.rule;
    if (seen.has(r)) continue;
    seen.add(r);
    const ctx = [];
    for (let g = r.parent; g; g = g.parent) ctx.unshift(g.head.replace(/\s+/g, ' '));
    out.push({ head: r.head.replace(/\s+/g, ' '), ctx: ctx.join(' >> '), block: css.slice(r.bodyStart, r.bodyEnd) });
  }
  return out;
}

// Runs in the page. Each rule's declarations are written into a stylesheet under the
// name of a probe element, and what the browser resolves every property of the rule to
// is read back from that element: { property: resolved value }.
function dumpAll(rules) {
  const stage = document.getElementById('stage');
  const style = document.createElement('style');
  style.textContent = rules.map((r, i) => `golden-probe[data-k="${i}"]{${r.block}}`).join('\n');
  document.head.appendChild(style);
  // A shorthand names several properties; setting it to "inherit" (valid for all of them)
  // is the way to ask which.
  const t = document.createElement('div');
  const longhands = new Map();
  const expand = name => {
    if (longhands.has(name)) return longhands.get(name);
    t.style.cssText = '';
    t.style.setProperty(name, name.startsWith('--') ? '0' : 'inherit');
    const list = [...t.style];
    longhands.set(name, list);
    return list;
  };
  const out = {};
  rules.forEach((r, i) => {
    const el = document.createElement('golden-probe');
    el.setAttribute('data-k', i);
    stage.appendChild(el);
    el.getAnimations().forEach(a => a.cancel());
    const cs = getComputedStyle(el);
    const d = {};
    for (const m of r.block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{}\s])(-{0,2}[a-zA-Z][\w-]*)\s*:/g)) for (const name of expand(m[1].toLowerCase())) d[name] = cs.getPropertyValue(name);
    el.remove();
    out[r.key] = d;
  });
  style.remove();
  return out;
}

async function recordRules(browser, origin) {
  const result = {};
  for (const which of Object.keys(SHEETS)) {
    const rules = [];
    const seen = new Map();
    for (const sheet of SHEETS[which]) {
      for (const r of readRules(fs.readFileSync(path.join(ROOT, sheet), 'utf8'))) {
        const k0 = path.basename(sheet) + ' | ' + r.ctx + ' | ' + r.head;
        const n = (seen.get(k0) || 0) + 1; seen.set(k0, n);
        rules.push({ key: n > 1 ? k0 + ' #' + n : k0, block: r.block });
      }
    }
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`${origin}/__harness?w=${which}`, { waitUntil: 'load' });
    result[which] = await page.evaluate(dumpAll, rules);
    await page.close();
  }
  return result;
}

// What every selector ends up with once its rules are merged in order (later wins, as in the
// cascade): a property the old sheet gave a selector must resolve the same in the new one.
// Rules are otherwise keyed by selector and occurrence, which shifts when a rule with the
// same selector is inserted above; the merged map does not. ":root, .on-dark" counts as :root.
function diffRulesEffective(a, b) {
  const lines = [];
  const norm = k => { const parts = k.split(' | '); const sel = parts[parts.length - 1].replace(/ #\d+$/, '').replace(/^:root, \.on-dark$/, ':root'); return parts.slice(0, -1).join(' | ') + ' | ' + sel; };
  const merged = rules => { const m = new Map(); for (const [k, d] of Object.entries(rules)) { const key = norm(k); if (!m.has(key)) m.set(key, {}); Object.assign(m.get(key), d); } return m; };
  let added = 0;
  for (const which of Object.keys(a)) {
    const A = merged(a[which]), B = merged(b[which] || {});
    for (const [k, d] of A) {
      const e = B.get(k);
      if (!e) { lines.push(`- [${which}] selector gone: ${k}`); continue; }
      for (const p of Object.keys(d)) if (d[p] !== e[p]) lines.push(`~ [${which}] ${k}\n    ${p}: ${JSON.stringify(d[p])} -> ${JSON.stringify(e[p])}`);
      added += Object.keys(e).filter(p => !(p in d)).length;
    }
  }
  diffRulesEffective.added = added;
  return lines;
}

function diffRules(a, b) {
  const lines = [];
  for (const which of Object.keys(a)) {
    const A = a[which], B = b[which] || {};
    for (const k of Object.keys(A)) {
      if (!(k in B)) { lines.push(`- [${which}] rule gone: ${k}`); continue; }
      for (const p of new Set([...Object.keys(A[k]), ...Object.keys(B[k])])) {
        if (A[k][p] !== B[k][p]) lines.push(`~ [${which}] ${k}\n    ${p}: ${JSON.stringify(A[k][p])} -> ${JSON.stringify(B[k][p])}`);
      }
    }
    for (const k of Object.keys(B)) if (!(k in A)) lines.push(`+ [${which}] new rule: ${k}`);
  }
  return lines;
}

// ── Pages ─────────────────────────────────────────────────────────────────────

// The tables the app reads, with a few rows each, made from schema.sql: every column
// gets a value of its type, and a column with CHECK (x IN (...)) cycles through the
// allowed words so each status, priority and stage gets drawn.
function parseSchema() {
  const files = [path.join(__dirname, '..', 'schema.sql'), ...fs.readdirSync(path.join(__dirname, '..', 'migrations')).sort().map(f => path.join(__dirname, '..', 'migrations', f))];
  const tables = {};
  const splitTop = body => { const out = []; let d = 0, cur = ''; for (const ch of body) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out; };
  const colOf = text => {
    const m = text.trim().match(/^"?(\w+)"?\s+([A-Za-z_]+(?:\s*\([^)]*\))?(?:\[\])?)([\s\S]*)$/);
    if (!m || /^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|CHECK)$/i.test(m[1])) return null;
    const rest = m[3];
    const enums = [];
    for (const c of rest.matchAll(/CHECK\s*\(\s*"?\w+"?\s+IN\s*\(([^)]*)\)/gi)) for (const w of c[1].matchAll(/'([^']*)'/g)) enums.push(w[1]);
    const def = (rest.match(/DEFAULT\s+(.+?)(?:\s+(?:NOT|NULL|CHECK|REFERENCES|PRIMARY|UNIQUE)\b|$)/is) || [])[1] || '';
    return { name: m[1], type: m[2].toLowerCase(), enums, def: def.trim() };
  };
  for (const f of files) {
    const sql = fs.readFileSync(f, 'utf8').replace(/--.*$/gm, '');
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
      const t = tables[m[1]] = tables[m[1]] || { cols: [] };
      for (const item of splitTop(m[2])) {
        const c = colOf(item); if (!c) continue;
        if (!t.cols.some(x => x.name === c.name)) t.cols.push(c);
        else if (c.enums.length) t.cols.find(x => x.name === c.name).enums = c.enums;
        for (const k of item.matchAll(/CHECK\s*\(\s*"?(\w+)"?\s+IN\s*\(([^)]*)\)/gi)) {
          const col = t.cols.find(x => x.name === k[1]); if (col && !col.enums.length) col.enums = [...k[2].matchAll(/'([^']*)'/g)].map(w => w[1]);
        }
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE(?: IF EXISTS)?\s+(?:public\.)?(\w+)\s+([\s\S]*?);/gi)) {
      const t = tables[m[1]]; if (!t) continue;
      for (const a of m[2].matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+([\s\S]*?)(?=,\s*ADD COLUMN|$)/gi)) {
        const c = colOf(a[1]); if (c && !t.cols.some(x => x.name === c.name)) t.cols.push(c);
      }
    }
  }
  return tables;
}

function sampleValue(table, col, i) {
  const n = col.name, t = col.type;
  if (n === 'id') return i + 1;
  if (col.enums.length) return col.enums[i % col.enums.length];
  if (/\[\]$/.test(t)) return [];
  if (/^jsonb?$/.test(t)) {
    if (/'\s*\[/.test(col.def)) return [];
    const o = col.def.match(/'(\{[\s\S]*\})'/);
    if (o) { try { return JSON.parse(o[1]); } catch (_) {} }
    return {};
  }
  if (/^bool/.test(t)) return i === 1;
  if (/^date$/.test(t)) return `2026-03-0${i + 2}`;
  if (/^timestamp/.test(t)) return `2026-03-0${i + 2}T09:00:00.000Z`;
  if (/^(big)?(int|serial)|^smallint|^numeric|^decimal|^real|^double/.test(t)) return /(_id|^id)$/.test(n) ? (i % 3) + 1 : (i + 1) * 100;
  if (/_id$/.test(n)) return String((i % 3) + 1);
  if (/email/.test(n)) return `person${i + 1}@example.com`;
  if (/phone|mobile|whatsapp/.test(n)) return `+97155000000${i}`;
  if (/url$|^avatar|^photo|^logo|^image|^icon$/.test(n)) return '';
  if (/(name|title|subject|label)$/.test(n)) return `Sample ${table} ${i + 1}`;
  return `Sample ${n} ${i + 1}`;
}

function seedTables(schema) {
  const out = {};
  for (const [name, { cols }] of Object.entries(schema)) {
    out[name] = [0, 1, 2].map(i => Object.fromEntries(cols.map(c => [c.name, sampleValue(name, c, i)])));
  }
  // The few that must agree with one another to draw anything.
  out.employees = [
    { id: 1, name: 'Admin Person', username: 'smoke', email: 'a@example.com', password_hash: 'x', job_title: 'Chief Technical Officer', permissions: {}, avatar_url: '', status_text: '', status_emoji: '', created_at: '2026-03-01T09:00:00.000Z' },
    { id: 2, name: 'Sara', username: 'sara', email: 's@example.com', password_hash: 'x', job_title: 'Sales', permissions: {}, avatar_url: '', status_text: 'In a meeting', status_emoji: '📅', created_at: '2026-03-01T09:00:00.000Z' },
    { id: 3, name: 'Omar', username: 'omar', email: 'o@example.com', password_hash: 'x', job_title: 'Logistics', permissions: {}, avatar_url: '', status_text: '', status_emoji: '', created_at: '2026-03-01T09:00:00.000Z' },
  ];
  for (const t of ['sessions', 'push_subscriptions', 'google_tokens', 'quotation_settings', 'login_events', 'account_security', 'password_reset_tokens', 'link_previews']) out[t] = [];
  return out;
}

// Runs in the page. { signature: [ [values…], … ] } for everything drawn.
const PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'box-shadow', 'text-shadow', 'fill', 'stroke', 'caret-color', 'accent-color', 'text-decoration-color', 'color-scheme',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'row-gap', 'column-gap',
  'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height', 'opacity', 'display', 'visibility'];
function collectPage(PROPS) {
  // A pulsing dot or a fading toast is caught at a different moment every run; what is
  // recorded is the style underneath.
  document.getAnimations().forEach(a => a.cancel());
  const out = {};
  const label = el => {
    const c = (el.getAttribute && el.getAttribute('class')) || '';
    const attrs = ['type', 'disabled', 'checked', 'hidden', 'role', 'aria-selected', 'aria-pressed', 'aria-expanded', 'aria-current', 'data-state', 'data-status', 'data-kind', 'data-tone']
      .filter(a => el.hasAttribute && el.hasAttribute(a)).map(a => a + '=' + el.getAttribute(a)).join(',');
    // (Not the inline style: what it does shows in the computed look, and a change to how it is
    // written must not make the same element a different kind.)
    return el.localName + (c ? '.' + c.trim().split(/\s+/).sort().join('.') : '') + (attrs ? '[' + attrs + ']' : '');
  };
  const add = (sig, cs) => {
    const row = PROPS.map(p => cs.getPropertyValue(p));
    const key = row.join('\u0001');
    (out[sig] = out[sig] || new Map()).set(key, row);
  };
  const skip = new Set(['script', 'style', 'link', 'meta', 'title', 'head', 'noscript', 'template']);
  const all = document.documentElement.querySelectorAll('*');
  const labels = new WeakMap();
  const lab = el => { let l = labels.get(el); if (l === undefined) { l = label(el); labels.set(el, l); } return l; };
  for (const el of [document.documentElement, ...all]) {
    if (skip.has(el.localName) || (el.closest && el.closest('head'))) continue;
    const chain = []; let a = el;
    for (let d = 0; a && d < 4; d++, a = a.parentElement) chain.unshift(lab(a));
    const sig = chain.join(' > ');
    const cs = getComputedStyle(el);
    add(sig, cs);
    for (const pseudo of ['::before', '::after']) {
      const pc = getComputedStyle(el, pseudo);
      if (pc.content && pc.content !== 'none' && pc.content !== 'normal') add(sig + pseudo, pc);
    }
  }
  const plain = {};
  for (const [sig, m] of Object.entries(out)) plain[sig] = [...m.values()];
  return plain;
}

async function recordPages() {
  const schema = parseSchema();
  const db = createFakeSupabase(seedTables(schema));
  db.install();
  const base = await bootApp({ port: process.env.PORT || 3961 });
  const ctx = require(path.join(__dirname, '..', 'src', 'ctx'));
  const { normEmpPerms, PERM_ACTIONS } = require(path.join(__dirname, '..', 'src', 'routes', 'employee-portal.js'));
  const allOn = {};
  for (const [k, v] of Object.entries(normEmpPerms({}))) if (typeof v === 'boolean') allOn[k] = true;
  for (const [section, actions] of Object.entries(PERM_ACTIONS || {})) allOn[section + 'Actions'] = Object.fromEntries(actions.map(a => [a, true]));
  const ADMIN = 'golden-admin', EMP = 'golden-employee';
  ctx.sessions.set(ADMIN, { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  ctx.employeeSessions.set(EMP, { id: 1, name: 'Admin Person', username: 'smoke', job_title: 'Chief Technical Officer', permissions: normEmpPerms(allOn), createdAt: Date.now() });

  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const portals = {
    admin: { route: '/dashboard', key: 'ml_admin_token', token: ADMIN, pages: ['home', 'tasks', 'employees', 'requests', 'submissions', 'deletions', 'hours', 'email', 'drive', 'sheets', 'calendar', 'meet', 'quotation', 'customers', 'deals', 'suppliers', 'rfqs', 'stock', 'contracts', 'purchaseorders', 'reports', 'accounting', 'automations', 'whatsapp', 'gchat', 'chat', 'notif'] },
    team: { route: '/employee', key: 'ml_emp_token', token: EMP, pages: ['home', 'tasks', 'hours', 'requests', 'drive', 'sheets', 'leads', 'deals', 'stock', 'suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions', 'notif', 'issues', 'email', 'calendar', 'meet', 'accounting', 'reports', 'quotation', 'gchat', 'chat'] },
  };
  const result = {};
  const problems = [];
  for (const [who, cfg] of Object.entries(portals)) {
    for (const [vpName, vp] of Object.entries({ desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } })) {
      const page = await browser.newPage();
      await page.setViewport(vp);
      await page.setBypassServiceWorker(true);
      page.on('pageerror', e => problems.push(`${who}/${vpName}: ${String(e).split('\n')[0]}`));
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (/unpkg|jsdelivr|fonts\.g|gstatic/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
        req.continue();
      });
      await page.evaluateOnNewDocument((key, token) => {
        window.lucide = { createIcons() {} };
        window.Chart = function () { return { destroy() {}, update() {} }; };
        localStorage.setItem(key, token);
        // The same instant every run, so "today", "overdue" and "3 days ago" draw the same.
        const Real = Date, FIXED = Real.UTC(2026, 2, 4, 10, 0, 0);
        window.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } };
        window.Date.UTC = Real.UTC; window.Date.parse = Real.parse;
      }, cfg.key, cfg.token);
      await page.goto(base + cfg.route, { waitUntil: 'domcontentloaded' });
      await sleep(1200);
      const merged = {};
      const take = async () => {
        const got = await page.evaluate(collectPage, PROPS);
        for (const [sig, rows] of Object.entries(got)) {
          const seen = merged[sig] = merged[sig] || new Map();
          for (const r of rows) seen.set(r.join('\u0001'), r);
        }
      };
      await take();
      for (const p of cfg.pages) {
        await page.evaluate(p => { try { navigate(p); } catch (e) { window.__navErr = String(e); } }, p);
        await sleep(450);
        await take();
      }
      result[`${who}/${vpName}`] = Object.fromEntries(Object.entries(merged).map(([sig, m]) => [sig, [...m.values()].sort((a, b) => (a.join() < b.join() ? -1 : 1))]));
      await page.close();
    }
  }
  await browser.close();
  return { pages: result, problems };
}

function diffPages(a, b, ignore = []) {
  const lines = [];
  if (ignore.length) {
    // Two signatures that differ only by the ignored class become one: their looks are pooled.
    const bare = sig => ignore.reduce((t, c) => t.replace(new RegExp('\\.' + c.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![\\w-])', 'g'), ''), sig);
    const strip = o => Object.fromEntries(Object.entries(o).map(([scene, kinds]) => {
      const out = {};
      for (const [sig, rows] of Object.entries(kinds)) {
        const k = bare(sig);
        const seen = new Map((out[k] || []).map(r => [r.join('\u0001'), r]));
        for (const r of rows) seen.set(r.join('\u0001'), r);
        out[k] = [...seen.values()];
      }
      return [scene, out];
    }));
    a = strip(a); b = strip(b);
  }
  for (const scene of Object.keys(a)) {
    const A = a[scene], B = b[scene] || {};
    const sigs = new Set([...Object.keys(A), ...Object.keys(B)]);
    for (const sig of sigs) {
      const ra = new Map((A[sig] || []).map(r => [r.join('\u0001'), r]));
      const rb = new Map((B[sig] || []).map(r => [r.join('\u0001'), r]));
      const gone = [...ra.keys()].filter(k => !rb.has(k)), fresh = [...rb.keys()].filter(k => !ra.has(k));
      if (!gone.length && !fresh.length) continue;
      if (!A[sig]) { lines.push(`+ [${scene}] new element kind: ${sig}`); continue; }
      if (!B[sig]) { lines.push(`- [${scene}] element kind gone: ${sig}`); continue; }
      // Pair each vanished row with the new row it differs from least, and say which properties moved.
      for (const k of gone) {
        const was = ra.get(k);
        let best = null, bd = 1e9;
        for (const f of fresh) { const now = rb.get(f); const d = was.reduce((n, v, i) => n + (v !== now[i] ? 1 : 0), 0); if (d < bd) { bd = d; best = now; } }
        if (!best) { lines.push(`- [${scene}] ${sig}\n    a look it had is gone`); continue; }
        const moved = PROPS.map((p, i) => was[i] !== best[i] ? `${p}: ${JSON.stringify(was[i])} -> ${JSON.stringify(best[i])}` : null).filter(Boolean);
        lines.push(`~ [${scene}] ${sig}\n    ${moved.join('\n    ')}`);
      }
      if (fresh.length > gone.length) lines.push(`+ [${scene}] ${sig}\n    ${fresh.length - gone.length} new look(s)`);
    }
  }
  return lines;
}

(async () => {
  const args = process.argv.slice(2);
  const [mode, file] = args.filter(a => !a.startsWith('--'));
  const only = (args.find(a => a.startsWith('--only=')) || '').slice(7);   // rules | pages
  if (!['record', 'check'].includes(mode) || !file) { console.error('usage: node tools/theme-golden.js record|check <file.json> [--only=rules|pages]'); process.exit(2); }
  const now = {};
  if (only !== 'pages') {
    const srv = await serve();
    const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
    try { now.rules = await recordRules(browser, 'http://127.0.0.1:' + srv.address().port); } finally { await browser.close(); srv.close(); }
  }
  if (only !== 'rules') {
    const { pages, problems } = await recordPages();
    now.pages = pages;
    if (problems.length) console.log(`(${problems.length} script errors while drawing pages; first: ${problems[0]})`);
  }
  const nRules = now.rules ? Object.values(now.rules).reduce((n, s) => n + Object.keys(s).length, 0) : 0;
  const nLooks = now.pages ? Object.values(now.pages).reduce((n, s) => n + Object.values(s).reduce((m, r) => m + r.length, 0), 0) : 0;
  const nKinds = now.pages ? Object.values(now.pages).reduce((n, s) => n + Object.keys(s).length, 0) : 0;
  if (mode === 'record') {
    fs.writeFileSync(file, JSON.stringify(now));
    console.log(`recorded ${nRules} rules, ${nKinds} kinds of element (${nLooks} looks) -> ${file}`);
  } else {
    const was = JSON.parse(fs.readFileSync(file, 'utf8'));
    const effective = args.includes('--effective');
    const diff = [...(now.rules && was.rules ? (effective ? diffRulesEffective : diffRules)(was.rules, now.rules) : []), ...(now.pages && was.pages ? diffPages(was.pages, now.pages, ((args.find(a => a.startsWith('--ignore-class=')) || '').slice(15) || '').split(',').filter(Boolean)) : [])];
    if (diff.length) { console.log(diff.slice(0, 80).join('\n')); console.log(`${diff.length} difference(s)`); process.exitCode = 1; }
    else console.log(`identical: ${nRules} rules and ${nKinds} kinds of element (${nLooks} looks) resolve exactly as recorded` + (effective ? `; ${diffRulesEffective.added} property(ies) added` : ''));
  }
  process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
