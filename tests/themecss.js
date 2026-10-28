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
  const have = new Set([...declared(sheets[own]), ...declared(sheets['mobile.css']), ...runtime]);
  const missing = new Map();
  const sources = [['public/assets/' + own, sheets[own]], ['public/assets/mobile.css', sheets['mobile.css']], ...pageSources(html).map(f => [f, read(f)])];
  for (const [f, text] of sources) {
    const body = f.endsWith('.css') ? blank(text) : text;
    for (const m of body.matchAll(/var\(\s*(--[a-z][\w-]*)\s*\)/g)) if (!have.has(m[1])) missing.set(m[1], (missing.get(m[1]) || []).concat(path.basename(f) + ':' + lineOf(body, m.index)));
  }
  check(`${portal}: every var(--x) without a fallback has a token behind it`, missing.size === 0, [...missing].map(([k, v]) => `${k} (${v.slice(0, 3).join(', ')})`).join('; '));
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
