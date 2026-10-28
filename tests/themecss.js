// The stylesheets are well-formed, and a theme can rely on them.
//
// A theme works by redefining custom properties on :root, so it is only as good as the
// sheets it lands on. Two things have gone wrong there before and nothing noticed:
// a rule head lost in an edit left its declarations stranded, and the stray "}" after
// them swallowed the next rule whole (the browser reads "…; } .stock-notes" as one
// selector, finds it invalid, and drops the rule); and a var(--card) with no fallback
// pointed at a token the admin sheet never declared, so those boxes had no background.
//
// No browser here: a scanner that knows comments and strings, over the files as shipped.
const fs = require('fs');
const path = require('path');
const T = require('../public/assets/theme-core.js');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// Comments and the insides of strings blanked out (same length, so offsets still point
// into the original), which is all a brace scan needs to be right.
function blank(css) {
  let out = '', i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop).replace(/[^\n]/g, ' '); i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + (css[j] === c ? c : ''); i = j + 1;
    } else { out += c; i++; }
  }
  return out;
}
const lineOf = (text, at) => text.slice(0, at).split('\n').length;

// Walk the blanked sheet. Reports a "}" with nothing open, a sheet that ends open, and
// a ";" in a rule's selector (a declaration sitting where a selector should be).
function scan(css) {
  const s = blank(css);
  const problems = [];
  let depth = 0, headFrom = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { depth++; headFrom = i + 1; }
    else if (c === '}') {
      if (depth === 0) problems.push(`line ${lineOf(s, i)}: a "}" with nothing open`);
      else depth--;
      headFrom = i + 1;
    } else if (c === ';') {
      // A statement at the top of a block or sheet. Only @import/@charset/@namespace are statements there.
      const head = s.slice(headFrom, i).trim();
      const inRule = isDeclBlock(s, i);
      if (!inRule && !/^@(import|charset|namespace)\b/.test(head)) problems.push(`line ${lineOf(s, i)}: "${head.slice(0, 60)}" is a declaration outside any rule`);
      headFrom = i + 1;
    }
  }
  if (depth !== 0) problems.push(`the sheet ends with ${depth} block(s) open`);
  return problems;
}
// Is the ";" at offset i inside a declaration block, as opposed to the prelude of a rule or at-rule?
// A block is a declaration block when its head is a selector (not @media/@supports/@layer/@keyframes…).
function isDeclBlock(s, i) {
  let d = 0;
  for (let k = i - 1; k >= 0; k--) {
    if (s[k] === '}') d++;
    else if (s[k] === '{') {
      if (d === 0) {
        const from = Math.max(s.lastIndexOf('}', k - 1), s.lastIndexOf('{', k - 1), s.lastIndexOf(';', k - 1)) + 1;
        const head = s.slice(from, k).trim();
        return !/^@(media|supports|layer|container|document|-moz-document|keyframes|-webkit-keyframes)\b/.test(head);
      }
      d--;
    }
  }
  return false;
}

const sheets = { 'dashboard.css': read('public/assets/dashboard.css'), 'employee.css': read('public/assets/employee.css'), 'mobile.css': read('public/assets/mobile.css') };

for (const [name, css] of Object.entries(sheets)) {
  const p = scan(css);
  check(`${name} is well-formed`, p.length === 0, p.slice(0, 3).join('; '));
}

// Tokens: every var(--x) with no fallback must have somewhere to come from — the
// portal's own :root, any rule in its sheets (a component's own scope), or a script
// that sets it on an element. The sheets are not the only place that reads them: the
// pages and the scripts they load paint with inline styles too.
const pageSources = html => [html, ...[...read(html).matchAll(/<script[^>]+src="\/([^"?]+)/g)].map(m => 'public/' + m[1])];
const runtime = new Set();
for (const html of ['public/dashboard.html', 'public/employee.html']) {
  for (const f of pageSources(html)) {
    const t = read(f);
    for (const m of t.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) runtime.add(m[1]);
    // style="--c:#fff": a token a script hands one element
    for (const m of t.matchAll(/style\s*=\s*["'`][^"'`]*?(--[\w-]+)\s*:/g)) runtime.add(m[1]);
  }
}
const declared = css => { const set = new Set(); for (const m of blank(css).matchAll(/(--[\w-]+)\s*:/g)) set.add(m[1]); return set; };
for (const [portal, html, own] of [['admin', 'public/dashboard.html', 'dashboard.css'], ['team', 'public/employee.html', 'employee.css']]) {
  // (plus what a workspace's look writes: --sb-t-dim and the like, which the sheets leave undefined on purpose)
  const have = new Set([...declared(sheets[own]), ...declared(sheets['mobile.css']), ...runtime, ...Object.keys(T.deriveVars({}, 'light'))]);
  const missing = new Map();
  const sources = [['public/assets/' + own, sheets[own]], ['public/assets/mobile.css', sheets['mobile.css']], ...pageSources(html).map(f => [f, read(f)])];
  for (const [f, text] of sources) {
    const body = f.endsWith('.css') ? blank(text) : text;
    for (const m of body.matchAll(/var\(\s*(--[a-z][\w-]*)\s*\)/g)) if (!have.has(m[1])) missing.set(m[1], (missing.get(m[1]) || []).concat(path.basename(f) + ':' + lineOf(body, m.index)));
  }
  check(`${portal}: every var(--x) without a fallback has a token behind it`, missing.size === 0, [...missing].map(([k, v]) => `${k} (${v.slice(0, 3).join(', ')})`).join('; '));
}

// ── The sheets and theme-core agree ───────────────────────────────────────────
// Every value the workspace can redefine has a default in the sheet; they must be the
// ones theme-core says (BASE) and, for Black & Gold's dark, the ones it derives. Otherwise
// "a workspace that has chosen nothing looks as it always did" quietly stops being true.
const norm = v => String(v).replace(/\s+/g, '').replace(/\b0\./g, '.').replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/gi, '#$1$1$2$2$3$3').toLowerCase();
// name -> value, across every :root rule of a sheet (later wins, as in the cascade)
function rootTokens(css) {
  const out = {};
  const s = blank(css);
  for (const m of s.matchAll(/(?:^|[}\s])(:root\s*,\s*\.on-dark|:root)\s*\{([^{}]*)\}/g)) {
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out[d[1]] = norm(d[2]);
  }
  return out;
}
const roots = { admin: rootTokens(sheets['dashboard.css']), team: rootTokens(sheets['employee.css']) };
for (const [portal, tokens] of Object.entries(roots)) {
  const wrong = Object.entries(T.BASE).filter(([k, v]) => tokens[k] !== norm(v)).map(([k, v]) => `${k}: sheet ${tokens[k]} vs ${norm(v)}`);
  check(`${portal}: every default theme-core knows is in the sheet, unchanged`, wrong.length === 0, wrong.slice(0, 3).join('; '));
}
{
  const derived = T.deriveVars({}, 'dark');
  // The portals differ on a few neutrals (their own page and panel shades); the rest must match.
  const own = new Set(['--bg', '--surface', '--sidebar', '--glass']);
  const wrong = [];
  for (const [k, v] of Object.entries(derived)) {
    // (the fixed hues are lifted in a chosen dark look so they read; the table they start from is checked below)
    if (own.has(k) || !(k in roots.admin) || k.startsWith('--sb-') || k in T.STATUS) continue;
    if (roots.admin[k] !== norm(v)) wrong.push(`${k}: sheet ${roots.admin[k]} vs theme-core ${norm(v)}`);
  }
  check('the admin sheet\'s tokens are Black & Gold\'s dark, as theme-core derives it', wrong.length === 0, wrong.slice(0, 4).join('; '));
  check('…and so is the team portal\'s, on the tokens it shares with it', Object.entries(derived).every(([k, v]) => own.has(k) || !(k in roots.team) || k.startsWith('--sb-') || k in T.STATUS || roots.team[k] === norm(v)),
    Object.entries(derived).filter(([k, v]) => !own.has(k) && (k in roots.team) && !k.startsWith('--sb-') && !(k in T.STATUS) && roots.team[k] !== norm(v)).map(([k, v]) => `${k}: ${roots.team[k]} vs ${norm(v)}`).join('; '));
  // The fixed hues: the sheets say what theme-core's table says (a chosen look moves them from there).
  for (const [portal, tokens] of Object.entries(roots)) {
    const drift = Object.entries(T.STATUS).filter(([k, x]) => k in tokens && !['--success', '--warning', '--danger'].includes(k) && tokens[k] !== norm(x)).map(([k, x]) => `${k}: sheet ${tokens[k]} vs table ${norm(x)}`);
    check(`${portal}: the fixed hues in the sheet are the ones theme-core starts from`, drift.length === 0, drift.slice(0, 4).join('; '));
  }
}
// .sidebar puts the page's tokens back to the sidebar's own; with no --sb-* in play it must
// put back exactly what the page had.
for (const [portal, file] of [['admin', 'dashboard.css'], ['team', 'employee.css']]) {
  const m = blank(sheets[file]).match(/\n\s*\.sidebar\s*\{([^{}]*--ov[^{}]*)\}/);
  const wrong = [];
  const found = [];
  let ownColour = false;
  if (m) for (const decl of m[1].split(';').map(x => x.trim()).filter(Boolean)) {
    // What the sidebar draws without naming a colour is its own text, not the page's (colour is
    // inherited as a value, so the remapped --text has to be read here, once, to take effect).
    if (/^color\s*:/.test(decl)) {
      const c = decl.match(/^color\s*:\s*var\(\s*--text\s*,([\s\S]*)\)$/);
      if (!c) wrong.push(`${decl} is not var(--text, <the page's text>)`);
      else if (norm(c[1]) !== roots[portal]['--text']) wrong.push(`color falls back to ${norm(c[1])}, page text is ${roots[portal]['--text']}`);
      ownColour = true;
      continue;
    }
    // --t-dim: var(--sb-t-dim) has no fallback because the page has no default for it either: the
    // sheets keep each caption's own opacity until a look defines them.
    const bare = decl.match(/^(--[\w-]+)\s*:\s*var\(\s*(--sb-[\w-]+)\s*\)$/);
    if (bare) {
      found.push(bare[1]);
      if (bare[1] in roots[portal]) wrong.push(`${bare[1]} has a page default but the sidebar remap has no fallback`);
      if (!(bare[2] in T.deriveVars({}, 'dark'))) wrong.push(`${bare[2]} is not a token theme-core writes`);
      continue;
    }
    const d = decl.match(/^(--[\w-]+)\s*:\s*var\(\s*(--sb-[\w-]+)\s*,([\s\S]*)\)$/);
    if (!d) { wrong.push(`${decl} is not a --sb-* lookup`); continue; }
    found.push(d[1]);
    const want = roots[portal][d[1]];
    if (norm(d[3]) !== want) wrong.push(`${d[1]}: falls back to ${norm(d[3])}, page has ${want}`);
    if (!(d[2] in T.deriveVars({}, 'dark'))) wrong.push(`${d[2]} is not a token theme-core writes`);
  }
  check(`${portal}: the sidebar scope exists and falls back to the page\'s own values`, !!m && found.length >= 8 && ownColour && wrong.length === 0, wrong.concat(m ? [] : ['no .sidebar scope']).concat(ownColour ? [] : ['the scope does not set its own colour']).slice(0, 4).join('; '));
}

// A theme overrides tokens by being later in the cascade; an !important on one would
// make it impossible to change from the Workspace page.
for (const [name, css] of Object.entries(sheets)) {
  const bad = [...blank(css).matchAll(/(--[\w-]+)\s*:[^;{}]*!important/g)].map(m => m[1]);
  check(`${name} declares no custom property as !important`, bad.length === 0, bad.slice(0, 4).join(', '));
}

// tests/hdtest.js and hdextras.js lift the huddle styles out of the real sheet by this
// comment and the first 640px media block after it.
{
  const css = sheets['dashboard.css'];
  const marker = '/* ── Huddles, group panel & status chips ── */';
  const at = css.indexOf(marker);
  check('the huddle styles keep the marker the huddle tests slice by', at >= 0 && css.indexOf(marker, at + 1) < 0);
  check('…and a 640px media block follows it', css.indexOf('@media (max-width:640px) {', at) > at);
}

console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
