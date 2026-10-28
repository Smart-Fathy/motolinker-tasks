// Turns the stylesheets' hard-coded colours, radii and type into var(--token, <the same
// value>), one kind of change at a time, so the workspace's look can reach them.
//
//   node tools/theme-codemod.js <pass[,pass…]> <file…>            show what would change
//   node tools/theme-codemod.js <pass[,pass…]> <file…> --write    change it
//   node tools/theme-codemod.js <pass[,pass…]> <file…> --check    prove the change was only that
//   node tools/theme-codemod.js list                              the passes
//
// Why a program and not search-and-replace: ~700 sites in two sheets, and each has to be
// found where it is a *value* — not in a selector, a comment, a string, a url(), a custom
// property's own definition, or inside a var() that already has a fallback. The scanner
// below knows the difference.
//
// Why it can be trusted: every replacement keeps the original text as the var()'s
// fallback — rgba(201,163,94,.35) becomes rgba(var(--primary-rgb,201,163,94),.35) — so a
// page that never defines the token paints exactly as before, and a pass only ever
// *inserts* text around what was there. --check holds it to that: the committed file
// must be what the pass makes of the committed file's own text, and must be a
// subsequence of the changed one, so nothing that was there has been altered or removed.
// (tools/theme-golden.js then proves in a browser that every rule still resolves to the
// same colours.) What a pass does not do is a judgment call — those are listed when it
// runs, for a person to decide.
const fs = require('fs');
const { execFileSync } = require('child_process');

// ── Reading a stylesheet ──────────────────────────────────────────────────────
// Every declaration with the offsets of its value, and the text of its rule, so a pass can
// ask "what else does this rule say?". Handles comments, strings, url(), nested at-rules.
const GROUPS = /^@(media|supports|layer|container|document|-moz-document|keyframes|-webkit-keyframes)\b/i;
function parse(css) {
  const decls = [];
  const stack = [];   // { kind: 'group' | 'decl', head, bodyStart, decls: [] }
  let i = 0, headFrom = 0;
  const n = css.length;
  const skipString = (j, q) => { for (j++; j < n && css[j] !== q; j++) if (css[j] === '\\') j++; return j; };
  // end of the value that starts at j: the next ; or } outside parens and strings
  function valueEnd(j) {
    let depth = 0;
    for (; j < n; j++) {
      const c = css[j];
      if (c === '/' && css[j + 1] === '*') { j = css.indexOf('*/', j + 2); if (j < 0) return n; j++; continue; }
      if (c === '"' || c === "'") { j = skipString(j, c); continue; }
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if ((c === ';' || c === '}') && depth === 0) return j;
    }
    return n;
  }
  function readBlock(top) {
    // inside a declaration block: declarations until the matching }
    let j = top.bodyStart;
    while (j < n) {
      while (j < n && /\s|;/.test(css[j])) j++;
      if (css[j] === '/' && css[j + 1] === '*') { j = css.indexOf('*/', j + 2) + 2; continue; }
      if (css[j] === '}' || j >= n) return j;
      const colon = css.indexOf(':', j);
      const stop = (() => { const e = valueEnd(j); return e; })();
      if (colon < 0 || colon > stop) { j = stop + 1; continue; }
      const prop = css.slice(j, colon).trim().toLowerCase();
      const vStart = colon + 1, vEnd = valueEnd(vStart);
      let raw = css.slice(vStart, vEnd);
      const imp = raw.match(/\s*!\s*important\s*$/i);
      const valueEndAt = imp ? vEnd - imp[0].length : vEnd;
      decls.push({ prop, start: j, valueStart: vStart, valueEnd: valueEndAt, important: !!imp, rule: top, end: vEnd });
      top.decls.push(decls[decls.length - 1]);
      j = vEnd;
    }
    return j;
  }
  while (i < n) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { i = css.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (c === '"' || c === "'") { i = skipString(i, c) + 1; continue; }
    if (c === '{') {
      const head = css.slice(headFrom, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const kind = head.startsWith('@') && GROUPS.test(head) ? 'group' : 'decl';
      const blk = { kind, head, bodyStart: i + 1, decls: [], parent: stack[stack.length - 1] || null };
      stack.push(blk);
      if (kind === 'decl') { const close = readBlock(blk); blk.bodyEnd = close; stack.pop(); i = close + 1; headFrom = i; continue; }
      i++; headFrom = i; continue;
    }
    if (c === '}') { stack.pop(); i++; headFrom = i; continue; }
    if (c === ';') { headFrom = i + 1; }
    i++;
  }
  return decls;
}

// Spans of a value that must not be touched: var(...) calls (they have their own fallback
// already), url(...) and strings.
function maskedSpans(v) {
  const spans = [];
  const re = /\b(var|url)\(|"|'/gi;
  let m;
  while ((m = re.exec(v))) {
    if (m[0] === '"' || m[0] === "'") {
      let j = m.index + 1;
      while (j < v.length && v[j] !== m[0]) j += v[j] === '\\' ? 2 : 1;
      spans.push([m.index, j + 1]); re.lastIndex = j + 1; continue;
    }
    let depth = 1, j = m.index + m[0].length;
    for (; j < v.length && depth; j++) {
      if (v[j] === '"' || v[j] === "'") { const q = v[j]; for (j++; j < v.length && v[j] !== q; j++) if (v[j] === '\\') j++; continue; }
      if (v[j] === '(') depth++; else if (v[j] === ')') depth--;
    }
    spans.push([m.index, j]); re.lastIndex = j;
  }
  return spans;
}
const overlaps = (spans, a, b) => spans.some(([x, y]) => a < y && b > x);

// ── The passes ────────────────────────────────────────────────────────────────
// Each pass: `forward(value, decl, ctx)` returns the new value or null. A pass only ever
// inserts text around what was there (a var( before, a fallback and ) after). `review`
// collects what a pass found but would not decide.
// var(--token, <value>) around a value's text, leaving the whitespace outside it as it was
const wrap = (value, token) => value.replace(/^(\s*)([\s\S]*?)(\s*)$/, (m, a, b, c) => a + 'var(' + token + ',' + b + ')' + c);
const TEXT_PROPS = /^(color|fill|stroke|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|text-decoration(-color)?|caret-color|-webkit-text-fill-color)$/;
const H = (hex) => new RegExp('(?<![0-9a-z#_-])' + hex.replace('#', '#') + '(?![0-9a-z_-])', 'gi');
const sub = (value, spans, re, fn) => {
  let out = '', last = 0, changed = false;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(value))) {
    if (overlaps(spans, m.index, m.index + m[0].length)) continue;
    const r = fn(m);
    if (r == null) continue;
    out += value.slice(last, m.index) + r; last = m.index + m[0].length; changed = true;
  }
  return changed ? out + value.slice(last) : null;
};
// A pass made of exact-literal -> token swaps
function swaps(list, { props, textOnly } = {}) {
  return {
    forward(value, d) {
      if (props && !props.includes(d.prop)) return null;
      if (textOnly && !TEXT_PROPS.test(d.prop)) return null;
      const spans = maskedSpans(value);
      let cur = value, any = false;
      for (const [lit, token] of list) {
        const re = H(lit);
        const s2 = sub(cur, maskedSpans(cur), re, m => 'var(' + token + ',' + m[0] + ')');
        if (s2 != null) { cur = s2; any = true; }
      }
      return any ? cur : null;
    },
  };
}
// An rgba() whose rgb is fixed: rgba(R,G,B,A) -> rgba(var(--token,R,G,B),A)
function rgbaSwap(r, g, b, token) {
  const re = new RegExp('rgba\\(\\s*' + r + '\\s*,\\s*' + g + '\\s*,\\s*' + b + '\\s*,', 'gi');
  return {
    forward(value) {
      return sub(value, maskedSpans(value), re, m => 'rgba(var(' + token + ',' + m[0].slice(5, -1) + '),');
    },
  };
}

const PASSES = {
  // color-scheme: dark -> follows the mode
  'scheme': {
    about: 'color-scheme: dark → var(--color-scheme, dark)',
    forward(value, d) { return d.prop === 'color-scheme' && /^\s*dark\s*$/i.test(value) ? value.replace(/dark/i, m => 'var(--color-scheme,' + m + ')') : null; },
  },
  // translucent white (the page's overlays) -> overlays made of the mode's ink
  'ov': Object.assign({ about: 'rgba(255,255,255,a) → rgba(var(--ov,255,255,255),a)' }, rgbaSwap(255, 255, 255, '--ov')),
  // translucent gold (the accent's tints)
  'primary-rgb': Object.assign({ about: 'rgba(201,163,94,a) → rgba(var(--primary-rgb,201,163,94),a)' }, rgbaSwap(201, 163, 94, '--primary-rgb')),
  // the alpha-0 end of a gradient that fades a surface out
  'surface-rgb': Object.assign({ about: 'rgba(20,20,22,a) → rgba(var(--surface-rgb,20,20,22),a)' }, rgbaSwap(20, 20, 22, '--surface-rgb')),
  // the accent's shades, written out
  'gold': Object.assign({ about: '#c9a35e #d9bd7f #a07e3f #e8cd93 #8a6a30 → --gold --gold-soft --gold-deep --gold-lite --gold-dim' },
    swaps([['#c9a35e', '--gold'], ['#d9bd7f', '--gold-soft'], ['#a07e3f', '--gold-deep'], ['#e8cd93', '--gold-lite'], ['#8a6a30', '--gold-dim']])),
  // the neutrals as text
  'text': Object.assign({ about: '#f3efe7 #b9b3a4 #8d897f → --text --text-2 --muted' },
    swaps([['#f3efe7', '--text'], ['#b9b3a4', '--text-2'], ['#8d897f', '--muted']])),
};
// The dark fills. The rgba() ones need their own matcher: H() is for #hex literals.
PASSES.fills = (() => {
  const hexes = [['#0e0e10', '--field-bg'], ['#101013', '--field-bg-2'], ['#101012', '--thead-bg'], ['#141416', '--option-bg'], ['#0f0f12', '--sidebar'],
    ['#18181b', '--card'], ['#15130e', '--auth-bg-1'], ['#0b0b0c', '--auth-bg-2'], ['#1c1a14', '--avatar-bg-1']];
  const rgbas = [['rgba(12,12,14,.85)', '--header-bg'], ['rgba(12,12,14,.9)', '--topbar-bg']];
  const hex = swaps(hexes);
  const rg = {
    forward(value) {
      let cur = value, any = false;
      for (const [lit, token] of rgbas) {
        const re = new RegExp(lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,/g, '\\s*,\\s*'), 'gi');
        const s2 = sub(cur, maskedSpans(cur), re, m => 'var(' + token + ',' + m[0] + ')');
        if (s2 != null) { cur = s2; any = true; }
      }
      return any ? cur : null;
    },
  };
  return { about: 'the dark fills (fields, table heads, options, bars, the header glass) → tokens', forward: (v, d, c) => { let cur = v, any = false; for (const p of [hex, rg]) { const r = p.forward(cur, d, c); if (r != null) { cur = r; any = true; } } return any ? cur : null; } };
})();

// The older purple the sheets still tint some places with (focus rings, a reply quote, the
// sign-in glow). Left undefined in the sheets, so each keeps its own shade; a workspace's
// look defines it as the second colour, and they follow.
for (const [r, g, b] of [[90, 103, 216], [99, 102, 241], [124, 106, 255]]) {
  PASSES['alt:' + r] = Object.assign({ about: `rgba(${r},${g},${b},a) → rgba(var(--alt-rgb,${r},${g},${b}),a)` }, rgbaSwap(r, g, b, '--alt-rgb'));
}
PASSES['alt'] = { about: 'the older purple tints → the second colour', forward: (v, d, c) => { let cur = v, any = false; for (const k of ['alt:90', 'alt:99', 'alt:124']) { const r = PASSES[k].forward(cur, d, c); if (r != null) { cur = r; any = true; } } return any ? cur : null; } };

// Status hues used as text, icons and rules go through the tokens that a light page
// sinks to a readable shade. Fills (backgrounds) keep the vivid hue.
PASSES['status'] = Object.assign({ about: 'status hues as text/rules → --success --warning --danger --st-todo --info … (a light page sinks them)' }, swaps([
  ['#10b981', '--success'], ['#f59e0b', '--warning'], ['#ef4444', '--danger'], ['#94a3b8', '--st-todo'], ['#9fb0bd', '--info'], ['#6dd8a4', '--w-mint'],
  ['#f87171', '--danger-text'], ['#e69650', '--stage-negotiating'], ['#60a5fa', '--cal-task'], ['#8ec0ff', '--cal-task-text'],
  ['#e9c98a', '--notice-text'], ['#f8dfae', '--notice-strong'], ['#a5a29a', '--muted-2'], ['#6f6b63', '--placeholder'],
  ['#fbbf24', '--warning-soft'], ['#34d399', '--success-soft'], ['#9fb59a', '--success-text'], ['#f88', '--error-text'],
], { props: null, textOnly: true }));

// White text on the sidebar and on page surfaces, where it has to follow the surface. White on a saturated
// fill (a red button, a live badge) stays white, so only the places listed here change.
const STRONG_SITES = new Set(['.sidebar-logo-text', '.sidebar-collapse-btn:hover', '.chat-action-btn:hover']);
PASSES['strong'] = {
  about: 'white text on the sidebar and the chat bar → var(--strong,#fff)',
  forward(value, d, ctx) {
    if (d.prop !== 'color' || !/^\s*#fff\s*$/i.test(value) || !STRONG_SITES.has(d.rule.head.replace(/\s+/g, ' '))) return null;
    return wrap(value, '--strong');
  },
};

// Dark ink on the accent. Text colour only; the sites are listed so each can be looked at.
PASSES['ink'] = {
  about: '#0c0c0e / #1b1608 as text → --on-primary / --on-primary-2',
  forward(value, d, ctx) {
    if (!['color', '-webkit-text-fill-color'].includes(d.prop)) return null;
    const m = /^\s*(#0c0c0e|#1b1608)\s*$/i.exec(value);
    if (!m) return null;
    const token = m[1].toLowerCase() === '#0c0c0e' ? '--on-primary' : '--on-primary-2';
    ctx.review.push(`${ctx.file}:${ctx.line}  ${ctx.selector}  { color: ${m[1]} }`);
    return value.replace(m[1], 'var(' + token + ',' + m[1] + ')');
  },
};

// Radii scale with the workspace's roundness.
const RADIUS_PROPS = /^(border(-(top|bottom)-(left|right))?-radius|border-(start|end)-(start|end)-radius)$/;
PASSES['radius'] = {
  about: 'border-radius: Npx (4–24) → calc(Npx * var(--r-k,1))',
  forward(value, d) {
    if (!RADIUS_PROPS.test(d.prop)) return null;
    return sub(value, maskedSpans(value), /(?<![\w.-])(\d+(?:\.\d+)?)px(?![\w-])/g, m => {
      const px = parseFloat(m[1]);
      return px >= 4 && px <= 24 ? 'calc(' + m[0] + ' * var(--r-k,1))' : null;
    });
  },
};
// ...and so do the tokens the rest of the sheet reads them through.
const RADIUS_TOKENS = ['--radius', '--radius-sm', '--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl'];
PASSES['radius-tokens'] = {
  about: '--radius and the --r-* scale → calc(Npx * var(--r-k,1))',
  custom: true,
  forward(value, d) {
    if (!RADIUS_TOKENS.includes(d.prop)) return null;
    const m = /^\s*(\d+(?:\.\d+)?px)\s*$/.exec(value);
    return m ? value.replace(m[1], 'calc(' + m[1] + ' * var(--r-k,1))') : null;
  },
};

// Type: the two families the sheets name
const FAMILIES = [
  [/^\s*'Cormorant Garamond'\s*,\s*serif\s*$/i, '--font-head'],
  [/^\s*'Manrope'\s*,\s*sans-serif\s*$/i, '--font-body'],
];
PASSES['fonts'] = {
  about: "'Cormorant Garamond',serif → --font-head; 'Manrope',sans-serif → --font-body",
  forward(value, d) {
    if (d.prop !== 'font-family') return null;
    for (const [re, token] of FAMILIES) if (re.test(value)) return wrap(value, token);
    return null;
  },
};
// The tokens that name a family also follow the workspace's choice.
PASSES['font-tokens'] = {
  about: '--font and --font-num → follow --font-body',
  custom: true,
  forward(value, d) {
    if (d.prop === '--font' && /^\s*'Manrope'\s*,\s*system-ui\s*,\s*sans-serif\s*$/.test(value)) return wrap(value, '--font-body');
    if (d.prop === '--font-num' && /^\s*'Manrope'\s*,\s*system-ui\s*,\s*-apple-system\s*,\s*sans-serif\s*$/.test(value)) return wrap(value, '--font-body');
    return null;
  },
};

// The select arrow, drawn in the accent
PASSES['chevron'] = {
  about: 'the gold select arrow → var(--chev-select, <the same arrow>)',
  forward(value, d) {
    if (d.prop !== 'background-image') return null;
    return /^\s*url\("data:image\/svg\+xml;charset=utf-8,[^"]*%23c9a35e[^"]*"\)\s*$/.test(value) ? value.replace(/(url\([\s\S]*\))/, 'var(--chev-select,$1)') : null;
  },
};

// ── Running ───────────────────────────────────────────────────────────────────
function apply(css, passNames, file) {
  const review = [];
  const report = {};
  let out = css;
  for (const name of passNames) {
    const pass = PASSES[name];
    if (!pass) throw new Error('no such pass: ' + name);
    const decls = parse(out).filter(d => pass.custom ? d.prop.startsWith('--') : !d.prop.startsWith('--'));
    // apply from the end so earlier offsets stay valid
    let count = 0;
    for (const d of decls.reverse()) {
      const value = out.slice(d.valueStart, d.valueEnd);
      const ctx = { file, line: out.slice(0, d.start).split('\n').length, selector: d.rule.head.replace(/\s+/g, ' ').slice(0, 80), review };
      const next = pass.forward(value, d, ctx);
      if (next != null && next !== value) { out = out.slice(0, d.valueStart) + next + out.slice(d.valueEnd); count++; }
    }
    report[name] = count;
  }
  return { out, report, review };
}
// Is every character of `small` in `big`, in order? A pass that only inserts leaves the
// original a subsequence of the result; one that altered or removed anything does not.
function isSubsequence(small, big) {
  let i = 0;
  for (let j = 0; j < big.length && i < small.length; j++) if (big[j] === small[i]) i++;
  return i === small.length;
}

if (require.main === module) {
  const [, , passArg, ...rest] = process.argv;
  if (passArg === 'list' || !passArg) { for (const [k, v] of Object.entries(PASSES)) console.log(k.padEnd(14), v.about); process.exit(0); }
  const files = rest.filter(a => !a.startsWith('--'));
  const mode = rest.includes('--write') ? 'write' : rest.includes('--check') ? 'check' : 'dry';
  const names = passArg === 'all' ? Object.keys(PASSES) : passArg.split(',');
  let bad = 0;
  for (const file of files) {
    const css = fs.readFileSync(file, 'utf8');
    if (mode === 'check') {
      let committed;
      try { committed = execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8', maxBuffer: 1 << 26 }); } catch (e) { console.log(`${file}: not committed yet`); bad++; continue; }
      // 1. the file is exactly what the pass makes of the committed file — nothing else was touched
      const expected = apply(committed, names, file).out;
      if (expected !== css) {
        bad++;
        const a = css.split('\n'), b = expected.split('\n');
        const at = a.findIndex((l, i) => l !== b[i]);
        console.log(`${file}: NOT what ${names.join('+')} makes of the committed file — first difference at line ${at + 1}:\n  now:      ${(a[at] || '').slice(0, 160)}\n  expected: ${(b[at] || '').slice(0, 160)}`);
        continue;
      }
      // 2. …and the committed file is inside it, in order: the pass only inserted
      if (!isSubsequence(committed, css)) { bad++; console.log(`${file}: the pass altered or removed something that was there`); continue; }
      const cl = committed.split('\n'), nl = css.split('\n');
      const changed = nl.filter((l, i) => l !== cl[i]).length;
      console.log(`${file}: ${changed} line(s) changed by ${names.join('+')}; the committed text is intact inside them (insertions only)`);
      continue;
    }
    const { out, report, review } = apply(css, names, file);
    const total = Object.values(report).reduce((a, b) => a + b, 0);
    console.log(`${file}: ${Object.entries(report).map(([k, v]) => k + ' ' + v).join(', ')}${total ? '' : ' (nothing to change)'}`);
    if (review.length) console.log('  to look at:\n    ' + review.join('\n    '));
    if (mode === 'write' && out !== css) fs.writeFileSync(file, out);
  }
  process.exit(bad ? 1 : 0);
}

module.exports = { parse, apply, PASSES, maskedSpans };
