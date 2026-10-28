// The theme maths (public/assets/theme-core.js), with no browser: every preset is
// readable in both modes, a profile can never put anything but a colour-ish custom
// property into a page, and the little script that picks dark or light before first
// paint does what the Workspace page says it does.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('../public/assets/theme-core.js');

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const C = T.color;
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;

// ── Colour maths ──────────────────────────────────────────────────────────────
check('black on white is 21:1', near(C.contrast('#000000', '#ffffff'), 21, 0.001));
check('the same colour is 1:1', C.contrast('#c9a35e', '#c9a35e') === 1);
check('#777 on white is just under 4.5 (4.48)', near(C.contrast('#777777', '#ffffff'), 4.48, 0.01));
check('#767676 on white clears 4.5 (4.54)', C.contrast('#767676', '#ffffff') >= 4.5);
check('contrast does not depend on which colour comes first', C.contrast('#123456', '#fedcba') === C.contrast('#fedcba', '#123456'));
check('mix goes a to b', C.mix('#000000', '#ffffff', 0.5) === '#808080' && C.mix('#102030', '#ffffff', 0) === '#102030' && C.mix('#102030', '#ffffff', 1) === '#ffffff');
check('hex in HSL and back loses nothing visible', ['#c9a35e', '#00e5ff', '#ff4fd8', '#0c0c0e', '#f3efe7'].every(h => {
  const [r1, g1, b1] = C.rgb(h), [r2, g2, b2] = C.rgb(C.fromHsl(...C.toHsl(h)));
  return Math.abs(r1 - r2) <= 1 && Math.abs(g1 - g2) <= 1 && Math.abs(b1 - b2) <= 1;
}));
check('normHex takes #abc, #AABBCC and refuses the rest',
  C.normHex('#ABC') === '#aabbcc' && C.normHex(' #AABBCC ') === '#aabbcc' && !C.normHex('red') && !C.normHex('#12345') && !C.normHex('#1234567') && !C.normHex('rgb(0,0,0)') && !C.normHex(null) && !C.normHex({}));
{
  // ensure() never makes a colour worse, keeps its hue, and gets there
  let ok = true, detail = '';
  const grounds = ['#ffffff', '#f7f4ee', '#0c0c0e', '#141416', '#1c1236', '#8d897f'];
  for (const fg of ['#c9a35e', '#00e5ff', '#ff4fd8', '#c6ff3d', '#7c6aff', '#10b981', '#f59e0b', '#ef4444', '#94a3b8']) {
    for (const bg of grounds) for (const min of [3, 4.5, 7]) {
      const out = C.ensure(fg, bg, min);
      if (C.contrast(fg, bg) >= min && out !== fg) { ok = false; detail = `${fg} on ${bg} already passes ${min} but changed`; }
      if (C.contrast(out, bg) < min && out !== '#ffffff' && out !== '#000000') { ok = false; detail = `${fg} on ${bg} for ${min} gave ${out}`; }
      const [h0] = C.toHsl(fg), [h1, s1] = C.toHsl(out);
      if (s1 > 0.12 && C.toHsl(fg)[1] > 0.12 && Math.min(Math.abs(h0 - h1), 360 - Math.abs(h0 - h1)) > 8 && out !== '#ffffff' && out !== '#000000') { ok = false; detail = `${fg} on ${bg} shifted hue ${h0}→${h1}`; }
    }
  }
  check('ensure() moves lightness only, and only when it has to', ok, detail);
}
check('a button on a fill gets whichever of black and white reads better',
  C.onFill('#c6ff3d') === '#0c0c0e' && C.onFill('#1d4ed8') === '#ffffff' && C.onFill('#c9a35e') === '#0c0c0e');

// ── Presets ───────────────────────────────────────────────────────────────────
check('eight presets, each with a dark and a light', T.PRESET_ORDER.length === 8 && T.PRESET_ORDER.every(id => T.PRESETS[id] && T.PRESETS[id].dark && T.PRESETS[id].light && T.PRESETS[id].name));
check('Black & Gold is the default, and Moto Palette is among them', T.DEFAULT_PRESET === 'black-gold' && T.PRESETS['moto'].name === 'Moto Palette');
{
  const bad = [];
  for (const id of T.PRESET_ORDER) for (const mode of ['dark', 'light']) {
    const P = T.PRESETS[id][mode];
    for (const k of ['bg', 'panel', 'sidebar', 'text', 'muted', 'accent', 'accent2']) if (!C.isHex(P[k])) bad.push(`${id}/${mode}.${k}`);
    const c = T.palette({ theme: { preset: id } }, mode);
    const rows = [
      ['text/bg ≥14', C.contrast(c.text, c.bg) >= 14], ['text/panel ≥14', C.contrast(c.text, c.panel) >= 14],
      ['muted/bg ≥5', C.contrast(c.muted, c.bg) >= 5], ['muted/panel ≥5', C.contrast(c.muted, c.panel) >= 5],
      ['accent/panel ≥3', C.contrast(c.accent, c.panel) >= 3], ['accent2/panel ≥3', C.contrast(c.accent2, c.panel) >= 3],
      ['accent as text ≥4.5', C.contrast(c.accentText, C.over(c.accentText, c.panel, mode === 'dark' ? 0.14 : 0.3)) >= 4.5],
      ['the preset\'s accent is already a good fill', c.accent === T.PRESETS[id][mode].accent],
      ['on a dark page the text twin is the accent, or a lighter shade of it where a wash of the accent would swallow it', mode === 'light' || c.accentText === c.accent || (C.luminance(c.accentText) > C.luminance(c.accent) && C.contrast(c.accentText, C.over(c.accentText, c.panel, 0.25)) >= 4.5)],
      ['sidebar accent ≥4.5', C.contrast(c.sbAccent, c.sidebar) >= 4.5],
      ['button ink ≥4.5', C.contrast(c.onAccent, c.accent) >= 4.5],
      ['the darker end of the accent gradient (a lead\'s initials) carries the same ink ≥4.5 (Black & Gold\'s dark keeps the shade it has always had)', (id === 'black-gold' && mode === 'dark') || C.contrast(c.onAccent, c.dim) >= 4.5],
      ['sidebar text ≥7', C.contrast(c.sbText, c.sidebar) >= 7], ['sidebar muted ≥4.5', C.contrast(c.sbMuted, c.sidebar) >= 4.5],
    ];
    for (const [what, ok] of rows) if (!ok) bad.push(`${id}/${mode}: ${what}`);
  }
  check('every preset, both modes: colours are hex and every reading pair is readable', bad.length === 0, bad.slice(0, 5).join('; '));
}
check('no preset trips the guard as shipped', T.PRESET_ORDER.every(id => T.problems({ theme: { preset: id } }).length === 0),
  T.PRESET_ORDER.map(id => T.problems({ theme: { preset: id } }).map(p => id + ': ' + p.message)).flat().slice(0, 3).join('; '));
check('Moto Palette in light has the forest sidebar with light text on it', (() => {
  const c = T.palette({ theme: { preset: 'moto' } }, 'light');
  return c.sidebar === '#043627' && C.luminance(c.sbText) > 0.6 && C.luminance(c.bg) > 0.9;
})());
check('Moto Palette in light fills with a nudged brand green (the exact one is 4.15:1 under white ink), and its text twin is darker',
  T.PRESETS['moto'].light.accent === '#328008' && C.contrast('#328008', '#ffffff') >= 4.5 && C.contrast('#3a8e0e', '#ffffff') < 4.5 && T.PRESETS['moto'].light.accent2 === '#3a8e0e'
  && C.luminance(T.palette({ theme: { preset: 'moto' } }, 'light').accentText) < C.luminance('#328008'));
check('…and its sidebar accent is the lime, not that green, which would vanish on forest', (() => {
  const c = T.palette({ theme: { preset: 'moto' } }, 'light');
  return C.contrast(c.sbAccent, c.sidebar) >= 4.5 && C.luminance(c.sbAccent) > 0.3;
})());

// Black & Gold's dark is what the stylesheets already say. Choosing the preset and
// changing only the accent must not move a neutral.
{
  const v = T.deriveVars({}, 'dark');
  const norm = x => String(x).replace(/\b0\./g, '.').replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/gi, '#$1$1$2$2$3$3').toLowerCase();
  const want = {
    '--bg': '#0c0c0e', '--surface': '#141416', '--panel': '#141416', '--card': '#18181b', '--text': '#f3efe7', '--muted': '#8d897f',
    '--border': 'rgba(255,255,255,.09)', '--hair': 'rgba(255,255,255,.09)', '--hair-gold': 'rgba(201,163,94,.22)',
    '--glass': 'rgba(12,12,14,.85)', '--glass-border': 'rgba(255,255,255,.07)',
    '--primary': '#c9a35e', '--primary-h': '#a07e3f', '--primary-glow': 'rgba(201,163,94,.15)', '--primary-glow-strong': 'rgba(201,163,94,.25)',
    '--gold': '#c9a35e', '--gold-soft': '#d9bd7f', '--gold-deep': '#a07e3f', '--sidebar': '#0f0f12',
  };
  const wrong = Object.entries(want).filter(([k, x]) => norm(v[k]) !== x).map(([k, x]) => `${k}: ${v[k]} (sheets say ${x})`);
  check('Black & Gold dark carries the sheets\' own values', wrong.length === 0, wrong.join('; '));
  // Every token in BASE is either derived (and then agrees) or a fixed hue the theme only touches in light.
  const wrongBase = Object.entries(T.BASE).filter(([k, x]) => !(k in T.STATUS) && (k in v ? norm(v[k]) !== norm(x) : true)).map(([k, x]) => `${k}: ${v[k]} (BASE ${x})`);
  check('…and so does every token in BASE, the table the stylesheets are checked against (the fixed hues apart)', wrongBase.length === 0, wrongBase.join('; '));
  // The fixed hues (status, priority, stage…): the table is what the sheets say; a chosen dark look
  // lifts each until it reads on a wash of itself and a light one sinks it — the same hue, only
  // its lightness moves, and only in the direction that helps.
  const hsl = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return [0, 0, (mx + mn) / 2]; let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(hue * 60 + 360) % 360, 0, (mx + mn) / 2]; };
  const dv = T.deriveVars({ theme: { preset: 'moto' } }, 'dark'), lv = T.deriveVars({ theme: { preset: 'moto' } }, 'light');
  const hueOff = (a, b) => { const d = Math.abs(hsl(a)[0] - hsl(b)[0]); return Math.min(d, 360 - d); };
  const lum = h => T.color.luminance(h);
  const badFixed = [];
  for (const [k, x] of Object.entries(T.STATUS)) {
    if (k in T.BASE && norm(T.BASE[k]) !== norm(x)) badFixed.push(`${k}: STATUS ${x} but BASE ${T.BASE[k]}`);
    if (!(k in dv) || !(k in lv)) { badFixed.push(`${k}: not written in both modes`); continue; }
    if (lum(dv[k]) < lum(x) - 1e-9) badFixed.push(`${k}: darker in dark (${x} → ${dv[k]})`);
    if (lum(lv[k]) > lum(x) + 1e-9) badFixed.push(`${k}: lighter in light (${x} → ${lv[k]})`);
    if (hsl(x)[2] > 0.02 && hsl(x)[2] < 0.98 && (hueOff(x, dv[k]) > 3 || hueOff(x, lv[k]) > 3) && x.slice(1, 3) !== x.slice(3, 5)) badFixed.push(`${k}: the hue moved (${x} → ${dv[k]} / ${lv[k]})`);
  }
  check('a fixed hue is what the sheets say; a chosen dark look lifts it and a light one sinks it, same hue', badFixed.length === 0, badFixed.slice(0, 4).join('; '));
}

// ── Choosing: overrides and the guard ─────────────────────────────────────────
{
  const p = { theme: { preset: 'black-gold', accent: '#00aaff', neutrals: { dark: { bg: '#101820' }, light: { text: '#202020' } } } };
  const dark = T.palette(p, 'dark'), light = T.palette(p, 'light');
  check('a chosen accent replaces the preset\'s in both modes, adjusted per mode',
    C.contrast(dark.accent, dark.panel) >= 3 && C.contrast(light.accent, light.panel) >= 3 && dark.accent !== light.accent);
  check('a chosen accent brings its own shades, not the preset\'s', T.palette({ theme: { accent: '#3366ff' } }, 'dark').soft !== '#d9bd7f' && T.palette({}, 'dark').soft === '#d9bd7f');
  check('chosen neutrals apply to their mode only', dark.bg === '#101820' && light.bg === T.PRESETS['black-gold'].light.bg && light.text === '#202020');
}
{
  const unreadable = { theme: { neutrals: { dark: { text: '#555555' } } } };   // dark grey text on near-black
  const ps = T.problems(unreadable);
  check('unreadable text is an error that names the pair and the mode', ps.some(p => p.level === 'error' && p.mode === 'dark' && p.id === 'text-bg'), JSON.stringify(ps.map(p => p.message)));
  const faint = T.problems({ theme: { neutrals: { light: { muted: '#9a9a9a' } } } });
  check('faint secondary text is an error under 3:1', faint.some(p => p.level === 'error' && p.id === 'muted-panel' && p.mode === 'light'));
  const middling = T.problems({ theme: { neutrals: { light: { muted: '#848484' } } } });   // ~3.7:1 on white
  check('…and only a warning between 3:1 and 4.5:1', middling.some(p => p.level === 'warn' && p.id === 'muted-panel') && !middling.some(p => p.level === 'error' && p.id === 'muted-panel'));
  check('a pick the maths can repair is repaired, not refused: any accent on any panel is readable',
    ['#000000', '#ffffff', '#808080', '#c6ff3d', '#0000ff'].every(a => T.problems({ theme: { accent: a } }).filter(p => ['accent-panel', 'accent-text', 'on-accent'].includes(p.id)).length === 0));
}

// ── Normalising and validating ────────────────────────────────────────────────
{
  const junk = [null, undefined, 0, 1, 'x', [], [1, 2], {}, { theme: 'x' }, { theme: [] }, { theme: { preset: {} } }, { theme: { accent: 12 } }, { typography: 5 }, { shape: [] }, { texts: 'a' },
    JSON.parse('{"__proto__":{"polluted":1},"theme":{"__proto__":{"x":1},"preset":"moto"}}'), { theme: { neutrals: { dark: 'x', light: [] } } }, { theme: { neutrals: { dark: { bg: 'javascript:alert(1)' } } } }];
  let ok = true, why = '';
  for (const j of junk) {
    try {
      const n = T.normalize(j);
      if (!T.PRESETS[n.theme.preset] || typeof n.theme.allow_user_mode !== 'boolean') { ok = false; why = 'bad theme for ' + JSON.stringify(j); }
      if (n.theme.neutrals && JSON.stringify(n.theme.neutrals).match(/[^#a-z0-9{}":,]/)) { ok = false; why = 'odd neutral for ' + JSON.stringify(j); }
      if (({}).polluted || ({}).x) { ok = false; why = 'prototype polluted'; }
      T.renderThemeCss(n);
    } catch (e) { ok = false; why = String(e) + ' for ' + JSON.stringify(j); }
  }
  check('normalize() takes anything, returns a usable profile, and never pollutes', ok, why);
}
check('normalize() keeps what is good and drops what is not', (() => {
  const n = T.normalize({ theme: { preset: 'ember', accent: '#ABCDEF', accent2: 'nope', glow: 'strong', default_mode: 'auto', allow_user_mode: false }, typography: { heading: 'orbitron', body: 'orbitron' }, shape: { radius: 4, density: 9 }, texts: { admin_title: '  Hello <b>there</b>\n now  ', evil: 'x' } });
  return n.theme.preset === 'ember' && n.theme.accent === '#abcdef' && !n.theme.accent2 && n.theme.glow === 'strong' && n.theme.default_mode === 'auto' && n.theme.allow_user_mode === false
    && n.typography.heading === 'orbitron' && !n.typography.body && n.shape.radius === 4 && n.shape.density === undefined
    && n.texts.admin_title === 'Hello b there /b now' && !('evil' in n.texts);
})(), JSON.stringify(T.normalize({ texts: { admin_title: '  Hello <b>there</b>\n now  ' } }).texts));
{
  const v = (raw) => T.validate(raw).errors;
  check('validate(): an empty or partial body is fine', v({}).length === 0 && v({ theme: { preset: 'moto' } }).length === 0 && v({ shape: { radius: 0 } }).length === 0);
  check('validate(): names each thing that is wrong', (() => {
    const e = v({ theme: { preset: 'nope', accent: 'red', glow: 'blinding', default_mode: 'night', allow_user_mode: 'yes', neutrals: { dark: { bg: '#12', fg: '#000000' }, dusk: {} } },
      typography: { heading: 'comic', body: 'orbitron' }, shape: { radius: 9, density: 1.5 }, texts: { admin_title: 'x'.repeat(200), nope: 'x', team_sub: 5 } });
    const need = ['theme.preset', 'theme.accent', 'theme.glow', 'theme.default_mode', 'theme.allow_user_mode', 'theme.neutrals.dark.bg', 'theme.neutrals.dark.fg', 'theme.neutrals.dusk', 'typography.heading', 'typography.body', 'shape.radius', 'shape.density', 'texts.admin_title', 'texts.nope', 'texts.team_sub'];
    return need.every(n => e.some(x => x.startsWith(n + ' '))) && e.length === need.length;
  })(), JSON.stringify(v({ theme: { neutrals: { dark: { bg: '#12' } } } })));
  check('validate(): a colour may be cleared with null or an empty string', v({ theme: { accent: null, accent2: '', neutrals: { dark: { bg: '' } } } }).length === 0);
}

// ── What gets written into a page ─────────────────────────────────────────────
// Only `selector{--name:value;…}` and `color-scheme`, values free of anything that could
// close a block, a string or a tag — the one quoted thing allowed is the select chevron.
function lint(css) {
  const bad = [];
  if (/[<>\\@]|\/\*|expression|javascript:|@import/i.test(css)) bad.push('a character or word that has no business in a theme');
  let rest = css;
  const blocks = [];
  while (rest.length) {
    const m = rest.match(/^(:root|\.on-dark|html\[data-mode="light"\] \.on-dark|html\[data-mode="light"\])\{/);
    if (!m) { bad.push('unexpected selector at: ' + rest.slice(0, 40)); break; }
    let i = m[0].length, inStr = false, body = '';
    for (; i < rest.length; i++) { const ch = rest[i]; if (ch === '"') inStr = !inStr; if (ch === '}' && !inStr) break; body += ch; }
    if (rest[i] !== '}') { bad.push('block not closed'); break; }
    blocks.push([m[1], body]);
    rest = rest.slice(i + 1);
  }
  for (const [sel, body] of blocks) {
    let i = 0;
    while (i < body.length) {
      const colon = body.indexOf(':', i);
      const prop = body.slice(i, colon);
      if (!/^(--[a-z0-9-]+|color-scheme)$/.test(prop)) { bad.push(sel + ': property "' + prop + '"'); break; }
      let j = colon + 1, inStr = false;
      for (; j < body.length; j++) { const ch = body[j]; if (ch === '"') inStr = !inStr; if (ch === ';' && !inStr) break; }
      const val = body.slice(colon + 1, j);
      if (/url\(/.test(val) && !(prop === '--chev-select' && /^url\("data:image\/svg\+xml;charset=utf-8,[%A-Za-z0-9 '=\/.:+\-_,]+"\)$/.test(val))) bad.push(sel + ': url() in ' + prop);
      if (/^--font-(head|body)$/.test(prop)) { if (!/^'[A-Za-z ]+',(serif|sans-serif|monospace)$/.test(val)) bad.push(sel + ': ' + prop + ' is not a plain font stack: ' + val); }
      else if (!/url\(/.test(val) && /[{};"'`]/.test(val)) bad.push(sel + ': odd character in ' + prop + ': ' + val);
      i = j + 1;
    }
  }
  return { bad, blocks };
}
{
  const def = T.renderThemeCss({});
  const l = lint(def);
  check('a workspace that has chosen nothing gets only the light block (and what the always-dark parts put back in it)', l.bad.length === 0 && l.blocks.length === 2 && l.blocks[0][0] === 'html[data-mode="light"]' && l.blocks[1][0] === 'html[data-mode="light"] .on-dark', l.bad.join('; ') + ' | ' + l.blocks.map(b => b[0]));
  check('…which sets color-scheme to light', /^color-scheme:light;/.test(l.blocks[0][1]));
  check('…and what the always-dark parts put back is only "not defined", for tokens the light block defines and the sheets do not', (() => {
    const reset = l.blocks[1][1].split(';').filter(Boolean).map(x => x.split(':'));
    const light = new Set(l.blocks[0][1].split(/;(?=--|color-scheme)/).map(x => x.split(':')[0]));
    return reset.length > 20 && reset.every(([k, v]) => v === 'initial' && light.has(k));
  })());
}
{
  const cust = T.renderThemeCss({ theme: { preset: 'cyberpunk' }, typography: { heading: 'orbitron' }, shape: { radius: 4, density: 0 } });
  const l = lint(cust);
  const sel = l.blocks.map(b => b[0]);
  check('a chosen look gets a dark block, an .on-dark block and a light block, in that order', l.bad.length === 0 && sel.join() === ':root,.on-dark,html[data-mode="light"]', l.bad.join('; ') + ' | ' + sel);
  const keys = body => new Set(body.split(/;(?=--|color-scheme)/).map(s => s.split(':')[0]));
  const dark = keys(l.blocks[0][1]), light = keys(l.blocks[2][1]);
  const missing = [...dark].filter(k => !light.has(k));
  check('the light block sets every custom property the dark one does — nothing leaks from one mode into the other', missing.length === 0, missing.join(', '));
  check('shape and fonts reach both blocks, so switching mode keeps them', /--r-k:2;--d-k:0\.88/.test(l.blocks[0][1]) && /--r-k:2/.test(l.blocks[2][1]) && /--font-head:'Orbitron'/.test(l.blocks[2][1]));
}
check('saying "off" for the glow, or choosing the original preset again, is still choosing nothing',
  !T.custom({ theme: { preset: 'black-gold', glow: 'off' } }).colors && !T.custom({ theme: { default_mode: 'light' } }).colors && T.custom({ theme: { glow: 'subtle' } }).colors
  && !T.custom({ theme: { neutrals: { light: { bg: '#fafafa' } } } }).colors && T.custom({ theme: { neutrals: { dark: { bg: '#101010' } } } }).colors);
{
  const only = T.renderThemeCss({ typography: { body: 'poppins' } });
  const l = lint(only);
  check('choosing only a font does not restate the colours', l.blocks[0][0] === ':root' && !/--primary:/.test(l.blocks[0][1]) && /--font-body:'Poppins'/.test(l.blocks[0][1]) && !l.blocks.some(b => b[0] === '.on-dark'));
}
{
  // Fuzz: random profiles, valid and not. Whatever goes in, only well-formed theme CSS comes out.
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const hex = () => '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
  const evil = ['}body{display:none}', '</style><script>alert(1)</script>', 'red;background:url(//x)', '"; } * { x: y', '\\', 'expression(1)', "'", '#12345', '#GGGGGG', '@import "x"', '{', 'url(javascript:1)'];
  const val = () => (rnd() < 0.5 ? hex() : pick(evil));
  let bad = 0, firstBad = '';
  for (let i = 0; i < 400; i++) {
    const raw = {
      theme: { preset: rnd() < 0.8 ? pick(T.PRESET_ORDER) : pick(evil), accent: val(), accent2: val(), glow: rnd() < 0.7 ? pick(T.GLOWS) : pick(evil), default_mode: pick(T.MODES.concat(evil)),
        neutrals: { dark: { bg: val(), panel: val(), sidebar: val(), text: val(), muted: val() }, light: { bg: val(), panel: val(), sidebar: val(), text: val(), muted: val() } } },
      typography: { heading: pick(T.FONT_ORDER.concat(evil)), body: pick(T.FONT_ORDER.concat(evil)) },
      shape: { radius: pick([0, 1, 2, 3, 4, 5, -1, 1.5, 'x']), density: pick([0, 1, 2, 3, -1, 'x']) },
      texts: { admin_title: pick(evil) },
    };
    const css = T.renderThemeCss(raw);
    const l = lint(css);
    if (l.bad.length) { bad++; firstBad = firstBad || l.bad[0] + ' ← ' + JSON.stringify(raw).slice(0, 160); }
    const href = T.fontsHref(raw);
    if (!/^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z+]+:wght@[0-9;]+(&family=[A-Za-z+]+:wght@[0-9;]+)?&display=swap$/.test(href)) { bad++; firstBad = firstBad || 'font href ' + href; }
    const script = T.bootScript(raw);
    if (/[<>]/.test(script) || !/^\(function\(\)\{/.test(script)) { bad++; firstBad = firstBad || 'boot script ' + script.slice(0, 80); }
  }
  check('400 random profiles, half of them hostile: only well-formed theme CSS, font links and boot scripts come out', bad === 0, firstBad);
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  const team = fs.readFileSync(path.join(__dirname, '..', 'public', 'employee.html'), 'utf8');
  const link = h => (h.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/) || [])[1];
  check('the default pair reproduces the link both pages carry today — choosing nothing changes nothing', T.fontsHref({}) === link(html) && T.fontsHref({}) === link(team), T.fontsHref({}));
  const bad = [];
  for (const id of T.FONT_ORDER) {
    const f = T.FONTS[id];
    if (!/^[A-Za-z ]+$/.test(f.family) || !/^(\d{3};)*\d{3}$/.test(f.weights) || !f.roles.length) bad.push(id);
    if (!f.stack.startsWith("'" + f.family + "'")) bad.push(id + ' stack');
    if (!(f.scale >= 0.8 && f.scale <= 1.1)) bad.push(id + ' scale');
  }
  check('every font has a clean family, a weight list css2 will accept, a stack that leads with it and a sane scale', bad.length === 0, bad.join(', '));
  check('two choices make two families; the same twice makes one',
    (T.fontsHref({ typography: { heading: 'orbitron', body: 'inter' } }).match(/family=/g) || []).length === 2 && (T.fontsHref({ typography: { heading: 'inter', body: 'inter' } }).match(/family=/g) || []).length === 1);
  check('a display face cannot be the body font, and Cairo can be either', !T.validate({ typography: { body: 'orbitron' } }).errors.length === false && T.validate({ typography: { heading: 'cairo', body: 'cairo' } }).errors.length === 0);
}

// ── Mode before first paint ───────────────────────────────────────────────────
function boot(profile, { stored, systemLight, throwing } = {}) {
  const attrs = {};
  const sandbox = {
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    localStorage: { getItem: k => { if (throwing) throw new Error('blocked'); return k === 'ml_mode' ? (stored === undefined ? null : stored) : null; } },
    window: {}, matchMedia: q => ({ matches: /light/.test(q) ? !!systemLight : !systemLight }),
  };
  sandbox.window.matchMedia = sandbox.matchMedia;
  vm.runInNewContext(T.bootScript(profile), sandbox);
  return attrs['data-mode'];
}
check('nothing chosen: dark, as it always was', boot({}) === 'dark');
check('a workspace that opens light opens light', boot({ theme: { default_mode: 'light' } }) === 'light' && boot({ theme: { preset: 'moto' } }) === 'light');
check('a person\'s own choice wins when the workspace allows one', boot({ theme: { default_mode: 'light' } }, { stored: 'dark' }) === 'dark' && boot({}, { stored: 'light' }) === 'light');
check('…and does not when it does not', boot({ theme: { default_mode: 'light', allow_user_mode: false } }, { stored: 'dark' }) === 'light');
check('auto follows the system', boot({}, { stored: 'auto', systemLight: true }) === 'light' && boot({}, { stored: 'auto', systemLight: false }) === 'dark' && boot({ theme: { default_mode: 'auto' } }, { systemLight: true }) === 'light');
check('a stored value that is not a mode is ignored', ['', 'Light', 'blue', '<script>', 'null'].every(s => boot({}, { stored: s }) === 'dark'));
check('storage that throws (private windows) falls back to the workspace default', boot({ theme: { default_mode: 'light' } }, { throwing: true }) === 'light');
check('the browser-bar colour is the page colour of the opening mode', T.themeColor({}) === '#0c0c0e' && T.themeColor({ theme: { preset: 'moto' } }) === '#f5f9f3' && T.themeColor({ theme: { preset: 'moto' } }, 'dark') === '#04140e');

console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
