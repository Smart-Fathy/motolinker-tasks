// The workspace's look: presets, fonts, shape, and the maths that turns a handful of
// chosen colours into every colour the app paints with.
//
// One module, three places that run it: the server builds the page's first paint from
// it (so a themed workspace never flashes the default on load), the Workspace page
// previews with it as the admin edits, and every open tab re-applies it when the admin
// saves. Because they are the same code, what the preview shows is what people get.
//
// Nothing here ever produces CSS other than custom properties. The stylesheets read
// them — var(--primary, #c9a35e) — and keep the original colour as the fallback, so a
// workspace that has chosen nothing, and a page that never loaded this file, look
// exactly as they always did. A profile is data (a preset id, hex colours, ids from an
// allow-list, small integers); no string from it reaches a stylesheet unchecked.
//
// Colours are derived rather than listed: the admin picks an accent and five neutrals
// per mode and the rest — hover, soft and deep shades, the accent as text, the ink on a
// button, the sidebar's own text — is worked out so the result stays readable. A pick
// that cannot be made readable is refused (problems()), not painted.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ThemeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Colour maths ────────────────────────────────────────────────────────────
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const HEX6 = /^#[0-9a-f]{6}$/;
  const isHex = s => typeof s === 'string' && HEX6.test(s);
  // '#ABC', '#aabbcc' → '#aabbcc'; anything else → null
  function normHex(s) {
    if (typeof s !== 'string') return null;
    const t = s.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(t)) return '#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    return HEX6.test(t) ? t : null;
  }
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const triplet = h => rgb(h).join(',');
  const rgba = (h, a) => { const [r, g, b] = rgb(h); return 'rgba(' + r + ',' + g + ',' + b + ',' + String(a).replace(/^0\./, '.') + ')'; };
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  function luminance(h) { const [r, g, b] = rgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // a toward b by t (0..1), in sRGB — what a designer expects "20% lighter" to mean
  function mix(a, b, t) {
    const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
    return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
  }
  // fg painted at `alpha` over bg
  const over = (fg, bg, alpha) => mix(bg, fg, alpha);
  function toHsl(h) {
    const [r, g, b] = rgb(h).map(v => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(hue * 60 + 360) % 360, s, l];
  }
  function fromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  // The nearest colour to `fg` — same hue and saturation, only lightness moved, away from
  // the background — that reaches `min` contrast against it. A colour that already does is
  // returned as it is; one that cannot reaches pure black or white.
  // `toward` ('lighter' | 'darker') says which way to move when the caller knows better than
  // the ground does: a wash of the colour itself is mid-toned, and the text on it is always
  // being sunk on a light page whatever the wash's own lightness comes out as.
  function ensure(fg, bg, min, toward) {
    if (contrast(fg, bg) >= min) return fg;
    const [h, s, l] = toHsl(fg);
    const lighter = toward ? toward === 'lighter' : luminance(bg) < 0.4;   // dark ground: lift the colour; light ground: sink it
    for (let i = 1; i <= 100; i++) {
      const cand = fromHsl(h, s, clamp(l + (lighter ? i : -i) * 0.01, 0, 1));
      if (contrast(cand, bg) >= min) return cand;
    }
    return lighter ? '#ffffff' : '#000000';
  }
  // `c` lightened toward white by up to `t`, but never so far that `ink` stops reading on it:
  // the primary button is a gradient from this to the accent, with the ink over both ends.
  function lift(c, t, ink) {
    if (contrast(ink, mix(c, '#ffffff', t)) >= 4.5) return mix(c, '#ffffff', t);
    let lo = 0, hi = t;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (contrast(ink, mix(c, '#ffffff', mid)) >= 4.5) lo = mid; else hi = mid; }
    return mix(c, '#ffffff', lo);
  }
  // The ink for a filled button: near-black or white, whichever reads better on it.
  const INK = '#0c0c0e';
  const onFill = fill => (contrast(INK, fill) >= contrast('#ffffff', fill) ? INK : '#ffffff');

  // ── Presets ─────────────────────────────────────────────────────────────────
  // Per mode: bg (the page), panel (cards and panels), sidebar, text, muted, accent and
  // accent2 (the second colour — decoration only, never text). Everything else is derived,
  // unless a preset gives it outright (card, field, thead … — only Black & Gold's dark does).
  // The numbers are checked, not eyeballed: tests/themecore.js holds every one to
  // body text ≥ 14:1, muted text ≥ 5:1 and the accent readable as a fill and as text.
  const PRESETS = {
    'black-gold': {
      name: 'Black & Gold', blurb: 'The original: ink black, warm ivory text, brushed gold.',
      font: { heading: 'cormorant', body: 'manrope' }, shape: { radius: 2, density: 1 }, glow: 'off', mode: 'dark',
      // The dark one is the sheets' own palette, shade for shade: choosing this preset and only
      // changing the accent must not move any neutral.
      dark:  { bg: '#0c0c0e', panel: '#141416', sidebar: '#0f0f12', text: '#f3efe7', text2: '#b9b3a4', muted: '#8d897f', accent: '#c9a35e', accent2: '#e8cd93',
               card: '#18181b', field: '#0e0e10', field2: '#101013', thead: '#101012', auth1: '#15130e', auth2: '#0b0b0c', avatar1: '#1c1a14', ink2: '#1b1608',
               soft: '#d9bd7f', deep: '#a07e3f', lite: '#e8cd93', dim: '#8a6a30', muted2: '#a5a29a', placeholder: '#6f6b63' },
      light: { bg: '#f7f4ee', panel: '#ffffff', sidebar: '#ffffff', text: '#1f1c17', muted: '#655f54', accent: '#a8802f', accent2: '#b78c3d' },
    },
    'moto': {
      name: 'Moto Palette', blurb: 'The MotoLinker brand: forest green, road green and lime.',
      font: { heading: 'poppins', body: 'poppins' }, shape: { radius: 3, density: 1 }, glow: 'off', mode: 'light',
      dark:  { bg: '#04140e', panel: '#0a231a', sidebar: '#04140e', text: '#eaf4e5', muted: '#8fb09a', accent: '#7ec842', accent2: '#3a8e0e', hover: '#5fa52f' },
      light: { bg: '#f5f9f3', panel: '#ffffff', sidebar: '#043627', text: '#16271f', muted: '#56675d', accent: '#328008', accent2: '#3a8e0e' },
    },
    'cyberpunk': {
      name: 'Cyberpunk Tech', blurb: 'Night-city blue-black with electric cyan and hot magenta.',
      font: { heading: 'space-grotesk', body: 'inter' }, shape: { radius: 0, density: 1 }, glow: 'strong', mode: 'dark',
      dark:  { bg: '#0a0a12', panel: '#11111d', sidebar: '#08080f', text: '#e8f4ff', muted: '#8a93b0', accent: '#00e5ff', accent2: '#ff2bd6' },
      light: { bg: '#eef2fb', panel: '#ffffff', sidebar: '#0f1226', text: '#10142a', muted: '#555d7e', accent: '#0095ab', accent2: '#d4009f' },
    },
    'neon-minimal': {
      name: 'Neon Minimalist', blurb: 'Almost nothing but black, white and one acid-lime line.',
      font: { heading: 'inter', body: 'inter' }, shape: { radius: 1, density: 1 }, glow: 'subtle', mode: 'dark',
      dark:  { bg: '#050505', panel: '#0d0d0d', sidebar: '#050505', text: '#f2f2f2', muted: '#8f8f8f', accent: '#c6ff3d', accent2: '#ffffff' },
      light: { bg: '#f6f6f4', panel: '#ffffff', sidebar: '#ffffff', text: '#0a0a0a', muted: '#5e5e5e', accent: '#5f8500', accent2: '#0a0a0a' },
    },
    'synthwave': {
      name: 'Synthwave', blurb: 'Purple dusk, pink neon, a sunset-grid mood.',
      font: { heading: 'syne', body: 'dm-sans' }, shape: { radius: 3, density: 1 }, glow: 'strong', mode: 'dark',
      dark:  { bg: '#120a24', panel: '#1c1236', sidebar: '#0e071c', text: '#f4eaff', muted: '#a592c8', accent: '#ff4fd8', accent2: '#7c5cff' },
      light: { bg: '#f8f1ff', panel: '#ffffff', sidebar: '#2a1650', text: '#24103f', muted: '#695889', accent: '#b0148f', accent2: '#7c5cff' },
    },
    'matrix': {
      name: 'Matrix', blurb: 'Terminal green on black, set in a monospace.',
      font: { heading: 'jetbrains-mono', body: 'jetbrains-mono' }, shape: { radius: 0, density: 0 }, glow: 'subtle', mode: 'dark',
      dark:  { bg: '#020a05', panel: '#07160c', sidebar: '#010603', text: '#d6ffe4', muted: '#6fae86', accent: '#00ff6a', accent2: '#00b34a' },
      light: { bg: '#f1fbf4', panel: '#ffffff', sidebar: '#062313', text: '#0b2415', muted: '#4b6957', accent: '#007a36', accent2: '#00a946' },
    },
    'deep-ocean': {
      name: 'Deep Ocean', blurb: 'Navy depths, sky-blue light.',
      font: { heading: 'plus-jakarta', body: 'plus-jakarta' }, shape: { radius: 3, density: 1 }, glow: 'off', mode: 'dark',
      dark:  { bg: '#07111f', panel: '#0d1b2f', sidebar: '#050d19', text: '#e6f1ff', muted: '#8ba5c4', accent: '#38bdf8', accent2: '#818cf8' },
      light: { bg: '#f2f7fc', panel: '#ffffff', sidebar: '#0b2545', text: '#0d2038', muted: '#4d647f', accent: '#0369a1', accent2: '#6366f1' },
    },
    'ember': {
      name: 'Ember', blurb: 'Warm charcoal lit by orange coals.',
      font: { heading: 'playfair', body: 'manrope' }, shape: { radius: 2, density: 1 }, glow: 'subtle', mode: 'dark',
      dark:  { bg: '#0f0b0a', panel: '#1a1311', sidebar: '#0b0706', text: '#fbeee7', muted: '#b39a8d', accent: '#ff6a3d', accent2: '#ffb020' },
      light: { bg: '#fff6f1', panel: '#ffffff', sidebar: '#2b1510', text: '#2a1510', muted: '#7a5d52', accent: '#c2410c', accent2: '#d97706' },
    },
  };
  const PRESET_ORDER = ['black-gold', 'moto', 'cyberpunk', 'neon-minimal', 'synthwave', 'matrix', 'deep-ocean', 'ember'];
  const DEFAULT_PRESET = 'black-gold';
  // How much of itself an accent may be washed with behind its own text: on a dark page the
  // wash is dim and the accent bright, so 14% (the active nav row) is the hard case; on a light
  // page the sheets put up to 30% behind it (a badge, a calendar cell) and it has to be dark.
  const accentTint = dark => (dark ? 0.14 : 0.3);
  // The alpha of the hairlines (borders, grid gaps) the sheets draw in the ink colour.
  const hairAlpha = dark => (dark ? 0.09 : 0.14);

  // ── Fonts ───────────────────────────────────────────────────────────────────
  // An allow-list: the id is what is stored, the family and stack are what reach the page.
  // Weights are per family because Google's css2 endpoint refuses the whole request if
  // even one asked-for weight does not exist. `scale` shrinks a face that is wide at the
  // same size (so a 46px statistic does not spill out of its card); `tracking` is the
  // letter-spacing it looks best with. Cairo is here for Arabic.
  const FONTS = {
    'cormorant':      { name: 'Cormorant Garamond', family: 'Cormorant Garamond', weights: '400;500;600;700', stack: "'Cormorant Garamond',serif", roles: ['head'], scale: 1, tracking: '' },
    'manrope':        { name: 'Manrope', family: 'Manrope', weights: '400;500;600;700;800', stack: "'Manrope',sans-serif", roles: ['head', 'body'], scale: 1, tracking: '' },
    'poppins':        { name: 'Poppins', family: 'Poppins', weights: '400;500;600;700;800', stack: "'Poppins',sans-serif", roles: ['head', 'body'], scale: 0.97, tracking: '' },
    'inter':          { name: 'Inter', family: 'Inter', weights: '400;500;600;700;800', stack: "'Inter',sans-serif", roles: ['head', 'body'], scale: 1, tracking: '' },
    'dm-sans':        { name: 'DM Sans', family: 'DM Sans', weights: '400;500;600;700', stack: "'DM Sans',sans-serif", roles: ['head', 'body'], scale: 1, tracking: '' },
    'plus-jakarta':   { name: 'Plus Jakarta Sans', family: 'Plus Jakarta Sans', weights: '400;500;600;700;800', stack: "'Plus Jakarta Sans',sans-serif", roles: ['head', 'body'], scale: 0.98, tracking: '' },
    'space-grotesk':  { name: 'Space Grotesk', family: 'Space Grotesk', weights: '400;500;600;700', stack: "'Space Grotesk',sans-serif", roles: ['head', 'body'], scale: 0.97, tracking: '' },
    'rajdhani':       { name: 'Rajdhani', family: 'Rajdhani', weights: '400;500;600;700', stack: "'Rajdhani',sans-serif", roles: ['head', 'body'], scale: 1.08, tracking: '.01em' },
    'orbitron':       { name: 'Orbitron', family: 'Orbitron', weights: '400;500;600;700;800', stack: "'Orbitron',sans-serif", roles: ['head'], scale: 0.82, tracking: '.04em' },
    'syne':           { name: 'Syne', family: 'Syne', weights: '400;500;600;700;800', stack: "'Syne',sans-serif", roles: ['head'], scale: 0.88, tracking: '' },
    'playfair':       { name: 'Playfair Display', family: 'Playfair Display', weights: '400;500;600;700', stack: "'Playfair Display',serif", roles: ['head'], scale: 0.94, tracking: '' },
    'jetbrains-mono': { name: 'JetBrains Mono', family: 'JetBrains Mono', weights: '400;500;600;700', stack: "'JetBrains Mono',monospace", roles: ['head', 'body'], scale: 0.9, tracking: '' },
    'cairo':          { name: 'Cairo (Arabic)', family: 'Cairo', weights: '400;500;600;700;800', stack: "'Cairo',sans-serif", roles: ['head', 'body'], scale: 0.98, tracking: '' },
  };
  const FONT_ORDER = ['cormorant', 'manrope', 'poppins', 'inter', 'dm-sans', 'plus-jakarta', 'space-grotesk', 'rajdhani', 'orbitron', 'syne', 'playfair', 'jetbrains-mono', 'cairo'];
  const DEFAULT_FONTS = { heading: 'cormorant', body: 'manrope' };

  // Roundness and density are steps, not free numbers: the sheets multiply every radius
  // and the page's own spacing by these, so five and three stops cover the useful range.
  const RADIUS_K = [0, 0.5, 1, 1.5, 2];     // index 2 is how the app has always looked
  const DENSITY_K = [0.88, 1, 1.12];        // index 1 likewise
  const DEFAULT_SHAPE = { radius: 2, density: 1 };

  const GLOWS = ['off', 'subtle', 'strong'];
  const MODES = ['dark', 'light', 'auto'];
  const NEUTRAL_KEYS = ['bg', 'panel', 'sidebar', 'text', 'muted'];

  // The sign-in and portal wording an admin may replace, and how long each may be.
  const TEXT_KEYS = { admin_title: 60, admin_sub: 120, admin_badge: 24, admin_role: 40, team_title: 60, team_sub: 120, team_role: 40 };

  // ── Normalising ─────────────────────────────────────────────────────────────
  const plain = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
  const stepOf = (v, n, dflt) => (Number.isInteger(v) && v >= 0 && v < n ? v : dflt);

  // The profile as stored → the profile as used. Never throws, and always returns every
  // field in a valid state, so a hand-edited row or an old version cannot break a page.
  function normalize(raw) {
    const r = plain(raw);
    const t = plain(r.theme), ty = plain(r.typography), sh = plain(r.shape), tx = plain(r.texts);
    const theme = {
      preset: oneOf(t.preset, PRESET_ORDER, DEFAULT_PRESET),
      glow: oneOf(t.glow, GLOWS, null),                       // null = whatever the preset suggests
      default_mode: oneOf(t.default_mode, MODES, null),       // likewise
      allow_user_mode: t.allow_user_mode === false ? false : true,
    };
    const accent = normHex(t.accent), accent2 = normHex(t.accent2);
    if (accent) theme.accent = accent;
    if (accent2) theme.accent2 = accent2;
    const neutrals = {};
    for (const mode of ['dark', 'light']) {
      const src = plain(plain(t.neutrals)[mode]), out = {};
      for (const k of NEUTRAL_KEYS) { const h = normHex(src[k]); if (h) out[k] = h; }
      if (Object.keys(out).length) neutrals[mode] = out;
    }
    if (Object.keys(neutrals).length) theme.neutrals = neutrals;
    if (theme.glow === null) delete theme.glow;
    if (theme.default_mode === null) delete theme.default_mode;

    const typography = {
      heading: FONTS[ty.heading] && FONTS[ty.heading].roles.includes('head') ? ty.heading : null,
      body: FONTS[ty.body] && FONTS[ty.body].roles.includes('body') ? ty.body : null,
    };
    if (!typography.heading) delete typography.heading;
    if (!typography.body) delete typography.body;

    const shape = {};
    if (Number.isInteger(sh.radius) && sh.radius >= 0 && sh.radius < RADIUS_K.length) shape.radius = sh.radius;
    if (Number.isInteger(sh.density) && sh.density >= 0 && sh.density < DENSITY_K.length) shape.density = sh.density;

    const texts = {};
    for (const [k, max] of Object.entries(TEXT_KEYS)) {
      if (typeof tx[k] !== 'string') continue;
      // Plain text: no control characters, no markup brackets, one line.
      const s = tx[k].replace(/[\u0000-\u001f\u007f\u2028\u2029<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
      if (s) texts[k] = s;
    }
    // Marked, so that handing a result back in does not normalise it twice (and a raw
    // object that merely has a "theme" key is never mistaken for one).
    return Object.defineProperty({ theme, typography, shape, texts }, '__normal', { value: true });
  }
  const norm = p => (p && p.__normal === true ? p : normalize(p));

  // The same, but for a request: says what is wrong instead of quietly mending it.
  function validate(raw) {
    const errors = [];
    const r = plain(raw);
    const bad = (path, why) => errors.push(path + ' ' + why);
    const t = plain(r.theme), ty = plain(r.typography), sh = plain(r.shape), tx = plain(r.texts);
    if (r.theme !== undefined && (r.theme === null || typeof r.theme !== 'object' || Array.isArray(r.theme))) bad('theme', 'must be an object');
    if (t.preset !== undefined && !PRESETS[t.preset]) bad('theme.preset', 'is not a known preset');
    for (const k of ['accent', 'accent2']) if (t[k] !== undefined && t[k] !== null && t[k] !== '' && !normHex(t[k])) bad('theme.' + k, 'must be a colour like #c9a35e');
    if (t.glow !== undefined && t.glow !== null && !GLOWS.includes(t.glow)) bad('theme.glow', 'must be off, subtle or strong');
    if (t.default_mode !== undefined && t.default_mode !== null && !MODES.includes(t.default_mode)) bad('theme.default_mode', 'must be dark, light or auto');
    if (t.allow_user_mode !== undefined && typeof t.allow_user_mode !== 'boolean') bad('theme.allow_user_mode', 'must be true or false');
    if (t.neutrals !== undefined && t.neutrals !== null) {
      if (typeof t.neutrals !== 'object' || Array.isArray(t.neutrals)) bad('theme.neutrals', 'must be an object');
      else for (const [mode, set] of Object.entries(t.neutrals)) {
        if (mode !== 'dark' && mode !== 'light') { bad('theme.neutrals.' + mode, 'is not a mode'); continue; }
        if (set === null || typeof set !== 'object' || Array.isArray(set)) { bad('theme.neutrals.' + mode, 'must be an object'); continue; }
        for (const [k, v] of Object.entries(set)) {
          if (!NEUTRAL_KEYS.includes(k)) bad('theme.neutrals.' + mode + '.' + k, 'is not a colour you can set');
          else if (v !== null && v !== '' && !normHex(v)) bad('theme.neutrals.' + mode + '.' + k, 'must be a colour like #0c0c0e');
        }
      }
    }
    for (const k of ['heading', 'body']) {
      if (ty[k] === undefined || ty[k] === null) continue;
      if (!FONTS[ty[k]]) bad('typography.' + k, 'is not an available font');
      else if (!FONTS[ty[k]].roles.includes(k === 'heading' ? 'head' : 'body')) bad('typography.' + k, 'is a display font, not one for ' + (k === 'heading' ? 'headings' : 'body text'));
    }
    if (sh.radius !== undefined && !(Number.isInteger(sh.radius) && sh.radius >= 0 && sh.radius < RADIUS_K.length)) bad('shape.radius', 'must be a whole number 0 to ' + (RADIUS_K.length - 1));
    if (sh.density !== undefined && !(Number.isInteger(sh.density) && sh.density >= 0 && sh.density < DENSITY_K.length)) bad('shape.density', 'must be a whole number 0 to ' + (DENSITY_K.length - 1));
    for (const [k, v] of Object.entries(tx)) {
      if (!(k in TEXT_KEYS)) bad('texts.' + k, 'is not a line you can change');
      else if (typeof v !== 'string') bad('texts.' + k, 'must be text');
      else if (v.length > TEXT_KEYS[k]) bad('texts.' + k, 'is longer than ' + TEXT_KEYS[k] + ' characters');
    }
    return { value: normalize(raw), errors };
  }

  // ── Palettes ────────────────────────────────────────────────────────────────
  // What the admin chose, resolved against the preset: the nine colours of one mode.
  function inputs(profile, mode) {
    const n = norm(profile);
    const base = PRESETS[n.theme.preset][mode];
    const over = plain(plain(n.theme.neutrals)[mode]);
    const p = Object.assign({}, base);
    for (const k of NEUTRAL_KEYS) if (over[k]) p[k] = over[k];
    // A chosen accent brings its own shades; the preset's were cut for its own.
    if (n.theme.accent) { p.accent = n.theme.accent; for (const k of ['hover', 'deep', 'soft', 'lite', 'dim']) delete p[k]; }
    if (n.theme.accent2) p.accent2 = n.theme.accent2;
    return p;
  }

  // Every colour a mode paints with, as hex (and, where the page wants one, an rgb triplet).
  function palette(profile, mode) {
    const n = norm(profile);
    const P = inputs(n, mode);
    const dark = mode === 'dark';
    const preset = PRESETS[n.theme.preset];

    // The accent as a fill — a button, a border, a chip — is held to 3:1 on a panel (so it shows
    // up) and carries its own ink (onAccent). As text it must do more: it is read on the washes
    // of itself the sheets put behind it (a badge, a calendar cell, the active nav row), so it
    // gets a darker (or, on a dark page, a lighter) twin held to 4.5:1 there. On a dark page
    // the twin is the accent itself. (The wash is made of the accent, so as the twin moves the
    // wash moves with it: settle.)
    const fill = ensure(P.accent, P.panel, 3);
    const ink = dark ? '#ffffff' : P.text;          // what translucent overlays are made of
    // A wash sits on a panel or on the page itself, which on a light look is a little darker.
    // A coloured text is sunk until it reads on a wash of itself over each. (On a dark page the
    // panel is the case that matters, and the dark look is pinned to what it has always been.)
    const grounds = dark ? [P.panel] : [P.panel, P.bg];
    const way = dark ? 'lighter' : 'darker';
    const sink = (hex, tint) => {
      let t = hex;
      for (let i = 0; i < 8; i++) {
        let next = t;
        for (const g of grounds) next = ensure(next, over(next, g, tint), 4.5, way);
        if (next === t) break;
        t = next;
      }
      return t;
    };
    const text = sink(fill, accentTint(dark));
    const fill2 = ensure(P.accent2 || fill, P.panel, 3);

    // The sidebar is its own surface: a forest-green one beside a white page, a white one
    // beside a dark page. It picks its own text (the preset's own colours first, so it
    // stays in the family) and its own accent, starting from the vivid one.
    const sbCandidates = [preset.dark.text, preset.light.text, '#f4f1ea', '#15171c'];
    const sbText = sbCandidates.find(c => contrast(c, P.sidebar) >= 7) || sbCandidates.slice().sort((a, b) => contrast(b, P.sidebar) - contrast(a, P.sidebar))[0];
    const sbField = mix(P.sidebar, sbText, 0.08);   // the search box and other inset things, a step off the rail
    const sbMuted = ensure(ensure(mix(sbText, P.sidebar, 0.42), P.sidebar, 4.5), sbField, 4.5);
    const sbText2 = ensure(mix(sbText, P.sidebar, 0.2), P.sidebar, 7);
    // A hue the rail draws an icon chip in: held to 4.5:1 on a wash of itself over the rail
    const sbHue = hex => ensure(hex, over(hex, P.sidebar, 0.15), 4.5, luminance(P.sidebar) < 0.4 ? 'lighter' : 'darker');
    const sbBase = n.theme.accent || preset.dark.accent, sbTint = accentTint(luminance(P.sidebar) < 0.4);
    let sbAccent = sbBase;
    for (let i = 0; i < 6; i++) {
      const next = ensure(sbAccent, over(sbAccent, P.sidebar, sbTint), 4.5);
      if (next === sbAccent) break;
      sbAccent = next;
    }

    const text2 = P.text2 || mix(P.text, P.muted, 0.5);
    const field = P.field || (dark ? mix(P.bg, P.panel, 0.45) : P.panel);
    return {
      mode, dark,
      bg: P.bg, panel: P.panel, sidebar: P.sidebar, text: P.text, text2, muted: P.muted,
      card: P.card || (dark ? mix(P.panel, '#ffffff', 0.02) : P.panel),
      field, field2: P.field2 || field,
      muted2: P.muted2 || (dark ? mix(P.muted, P.text, 0.28) : mix(P.muted, P.text, 0.18)),
      placeholder: P.placeholder || ensure(mix(P.muted, field, 0.3), field, dark ? 3 : 3.2),
      thead: P.thead || (dark ? mix(P.bg, P.panel, 0.6) : mix(P.panel, P.bg, 0.6)),
      auth1: P.auth1 || (dark ? mix(P.bg, fill, 0.05) : mix(P.bg, P.panel, 0.4)),
      auth2: P.auth2 || (dark ? mix(P.bg, '#000000', 0.2) : P.bg),
      avatar1: P.avatar1 || (dark ? mix(P.panel, fill, 0.1) : mix(P.panel, fill, 0.12)),
      ink,
      accent: fill, accentText: text, accent2: fill2,
      onAccent: onFill(fill),
      onAccent2: P.ink2 && contrast(P.ink2, fill) >= 4.5 ? P.ink2 : onFill(fill),
      deep: P.deep || P.hover || mix(fill, '#000000', dark ? 0.25 : 0.18),
      soft: P.soft || lift(fill, dark ? 0.28 : 0.35, onFill(fill)),
      lite: P.lite || lift(fill, dark ? 0.5 : 0.55, onFill(fill)),
      dim: P.dim || mix(fill, '#000000', dark ? 0.4 : 0.32),
      sbText, sbText2, sbMuted, sbAccent, sbField, sbHue, sink,
    };
  }

  // The hues the app uses to say "done", "late", "blocked": fixed, not themed. On a dark
  // page they are what the sheets already say; on a light one the same hue is sunk until
  // it can be read (the values that suit black are 2–4:1 on white).
  const STATUS = {
    '--success': '#10b981', '--warning': '#f59e0b', '--danger': '#ef4444', '--info': '#9fb0bd', '--orange': '#c98b5e',
    '--st-todo': '#94a3b8', '--st-progress': '#f59e0b', '--st-done': '#10b981',
    '--pri-high': '#ef4444', '--pri-med': '#f59e0b', '--pri-low': '#10b981',
    '--stage-inquiry': '#7c6aff', '--stage-quoted': '#5a78c8', '--stage-negotiating': '#e69650',
    '--stage-won': '#64b478', '--stage-lost': '#ef4444', '--stage-quoted-text': '#8aa4e0',
    '--stock-in': '#10b981', '--stock-transit': '#5a78c8', '--stock-reserved': '#f59e0b', '--stock-sold': '#8d897f',
    '--lead-cold': '#b9b3a4', '--lead-warm': '#e69650', '--lead-hot': '#f87171', '--lead-immediate': '#6dd8a4',
    '--lead-notinterested': '#888888', '--lead-blacklist': '#dc2626',
    '--w-mint': '#6dd8a4', '--w-blue': '#9fb0bd', '--w-slate': '#94a3b8', '--w-amber': '#f59e0b', '--w-orange': '#c98b5e',
    '--w-muted': '#8d897f', '--w-red': '#ef4444', '--w-green': '#10b981',
    // text colours the sheets spell out for particular places (a badge, the calendar key, a notice)
    '--danger-text': '#f87171', '--cal-task': '#60a5fa', '--cal-task-text': '#8ec0ff', '--notice-text': '#e9c98a', '--notice-strong': '#f8dfae',
    '--warning-soft': '#fbbf24', '--success-soft': '#34d399', '--success-text': '#9fb59a', '--error-text': '#ff8888',
  };

  // The hues the scripts and sheets spell out as hex — a KPI tile, a pill, a chip's text — each
  // read as text on a wash of itself. Every one has a token, --h-<hex>, and every use is
  // var(--h-<hex>,<hex>): on a dark page the token is simply not defined and the hex is what
  // paints; on a light page it is the same hue sunk until it reads. OLD_ACCENT is the colour the
  // app was first drawn in: wherever a script still says it, it follows the workspace's accent.
  const OLD_ACCENT = '#c9a35e';
  const HUES = ['#6dd8a4', '#e57373', '#e6a850', '#9fb0bd', '#a78bfa', '#c98b5e', '#8a9a86', '#f59e0b', '#ef4444', '#10b981',
    '#38bdf8', '#f87171', '#f472b6', '#e69650', '#5ab478', '#7fce9a', '#7cc4ff', '#7c6aff', '#5a78c8', '#64b478', '#8aa4e0', '#94a3b8',
    '#d4af37', '#b9bcc2', '#c58a4a'];   // (the last three are the leaderboard's gold, silver and bronze)
  // The hues the rail colours its group icons with. The rail is its own surface, so it gets its own
  // copy of each (--sb-h-<hex>), sunk or lifted for the rail's colour rather than the page's.
  const NAV_HUES = ['#6dd8a4', '#9fb0bd', '#94a3b8', '#f59e0b', '#c98b5e', '#a78bfa'];
  const hueToken = hex => '--h-' + hex.slice(1);
  // Tokens the stylesheets leave undefined (each use carries its own fallback) and a look may define.
  const LIGHT_ONLY = ['--success-fill', '--warning-fill', '--danger-fill', '--on-primary-w', '--alt-rgb', '--t-dim', '--t-soft', '--glow', '--chev-select', '--cal-today', '--sh-k'].concat(HUES.concat(OLD_ACCENT).map(hueToken));

  const STATUS_FILLS = ['--success', '--warning', '--danger'];

  // ── What the sheets already say ─────────────────────────────────────────────
  // The new tokens' values as the stylesheets carry them today — written into both :root
  // blocks, and the fallback of every var() that reads them — so a page that never hears
  // from a workspace paints exactly as it always did. tests/themecss.js checks the sheets
  // against this table; the values are Black & Gold's dark, shade for shade.
  const BASE = {
    '--primary-rgb': '201,163,94', '--primary-text': '#c9a35e', '--on-primary': '#0c0c0e', '--on-primary-2': '#1b1608',
    '--ov': '255,255,255', '--surface-rgb': '20,20,22', '--text-2': '#b9b3a4',
    '--gold-lite': '#e8cd93', '--gold-dim': '#8a6a30', '--accent-2': '#e8cd93', '--accent-2-rgb': '232,205,147',
    '--field-bg': '#0e0e10', '--field-bg-2': '#101013', '--thead-bg': '#101012', '--option-bg': '#141416',
    '--header-bg': 'rgba(12,12,14,.85)', '--topbar-bg': 'rgba(12,12,14,.9)',
    '--auth-bg-1': '#15130e', '--auth-bg-2': '#0b0b0c', '--avatar-bg-1': '#1c1a14',
    '--color-scheme': 'dark', '--strong': '#fff',
    '--danger-text': '#f87171', '--cal-task': '#60a5fa', '--cal-task-text': '#8ec0ff', '--notice-text': '#e9c98a', '--notice-strong': '#f8dfae',
    '--warning-soft': '#fbbf24', '--success-soft': '#34d399', '--success-text': '#9fb59a', '--error-text': '#f88',
    '--muted-2': '#a5a29a', '--placeholder': '#6f6b63',
  };

  // The least opacity at which `ink` is readable on `ground`, to the hundredth.
  function inkAlpha(ink, ground, min) {
    for (let a = 0.3; a < 1; a += 0.01) if (contrast(over(ink, ground, a), ground) >= min) return Math.round(a * 100) / 100;
    return 1;
  }

  // ── Variables ───────────────────────────────────────────────────────────────
  // Ordered: what is emitted is deterministic, so two renders of one profile compare equal.
  function deriveVars(profile, mode) {
    const n = norm(profile);
    const c = palette(n, mode);
    const preset = PRESETS[n.theme.preset];
    const glow = n.theme.glow || preset.glow;
    const ovA = hairAlpha(c.dark);
    const v = {};
    // Surfaces and text
    v['--bg'] = c.bg;
    v['--surface'] = c.panel;
    v['--panel'] = c.panel;
    v['--card'] = c.card;
    v['--text'] = c.text;
    v['--text-2'] = c.text2;
    v['--muted'] = c.muted;
    v['--muted-2'] = c.muted2;
    v['--placeholder'] = c.placeholder;
    v['--strong'] = c.dark ? '#ffffff' : c.text;
    v['--ov'] = triplet(c.ink);
    v['--surface-rgb'] = triplet(c.panel);
    v['--border'] = rgba(c.ink, ovA);
    v['--hair'] = rgba(c.ink, ovA);
    v['--glass'] = rgba(c.bg, 0.85);
    v['--glass-border'] = rgba(c.ink, c.dark ? 0.07 : 0.1);
    v['--header-bg'] = rgba(c.bg, 0.85);
    v['--topbar-bg'] = rgba(c.bg, 0.9);
    v['--field-bg'] = c.field;
    v['--field-bg-2'] = c.field2;
    v['--thead-bg'] = c.thead;
    v['--option-bg'] = c.panel;
    v['--auth-bg-1'] = c.auth1;
    v['--auth-bg-2'] = c.auth2;
    v['--avatar-bg-1'] = c.avatar1;
    v['--sidebar'] = c.sidebar;
    // The accent
    v['--primary'] = c.accent;
    v['--primary-h'] = c.deep;
    v['--primary-rgb'] = triplet(c.accent);
    v['--primary-text'] = c.accentText;
    v['--primary-glow'] = rgba(c.accent, 0.15);
    v['--primary-glow-strong'] = rgba(c.accent, 0.25);
    v['--on-primary'] = c.onAccent;
    v['--on-primary-2'] = c.onAccent2;
    v['--on-primary-w'] = c.onAccent;   // the older spots that wrote white on the accent: the ink that reads on it
    v['--gold'] = c.accent;
    v['--gold-soft'] = c.soft;
    v['--gold-deep'] = c.deep;
    v['--gold-lite'] = c.dark ? c.lite : c.accentText;   // it is only ever a text colour (an active chip), so on a light page it is the accent's text shade
    v['--gold-dim'] = c.dim;
    v['--hair-gold'] = rgba(c.accent, c.dark ? 0.22 : 0.3);
    v['--accent-2'] = c.accent2;
    v['--accent-2-rgb'] = triplet(c.accent2);
    // Tints the sheets still write in an older purple: they follow the second colour
    v['--alt-rgb'] = triplet(c.accent2);
    // The widgets and the pipeline's first stage wear the accent
    v['--w-gold'] = c.accentText;
    v['--stage-lead'] = c.accentText;
    // The sidebar's own: the sheets put these in place of the page's inside .sidebar
    v['--sb-text'] = c.sbText;
    v['--sb-text-2'] = c.sbText2;
    v['--sb-muted'] = c.sbMuted;
    v['--sb-field'] = c.sbField;
    v['--sb-ov'] = triplet(c.sbText);
    v['--sb-strong'] = contrast('#ffffff', c.sidebar) >= 7 ? '#ffffff' : c.sbText;
    v['--sb-accent'] = c.sbAccent;
    v['--sb-accent-rgb'] = triplet(c.sbAccent);
    v['--sb-hair'] = rgba(c.sbText, 0.09);
    v['--sb-hair-gold'] = rgba(c.sbAccent, 0.22);
    v['--sb-glass-border'] = rgba(c.sbText, 0.07);
    for (const h of NAV_HUES) v['--sb-h-' + h.slice(1)] = c.sbHue(h);
    // Secondary text the sheets write as the ink at 30-65% — a caption, a hint, a muted label.
    // The sheets keep each one's own opacity until a look is chosen; then a caption is the
    // least that reads, and a softer label a little more.
    const dimOn = (ink, grounds) => Math.max(...grounds.map(g => inkAlpha(ink, g, 4.5)));
    const dim = dimOn(c.ink, [c.bg, c.panel, c.card, c.field]), sbDim = dimOn(c.sbText, [c.sidebar]);
    v['--t-dim'] = String(dim);
    v['--t-soft'] = String(Math.min(0.9, Math.round((dim + 0.12) * 100) / 100));
    v['--sb-t-dim'] = String(sbDim);
    v['--sb-t-soft'] = String(Math.min(0.9, Math.round((sbDim + 0.12) * 100) / 100));
    // Effects
    v['--glow'] = glow === 'off' ? '0 0 #0000'
      : glow === 'subtle' ? '0 0 ' + (c.dark ? '12px ' + rgba(c.accent, 0.28) : '10px ' + rgba(c.accent, 0.18))
      : '0 0 ' + (c.dark ? '20px ' + rgba(c.accent, 0.5) + ',0 0 3px ' + rgba(c.accent, 0.7) : '16px ' + rgba(c.accent, 0.32));
    v['--chev-select'] = 'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23' + c.accent.slice(1) + '\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")';
    v['--color-scheme'] = c.dark ? 'dark' : 'light';
    // A status hue is read as text on a wash of itself (a badge is the hue at 12-25% behind the
    // hue), which is darker than the panel: sink it until it reads there.
    for (const [k, hex] of Object.entries(STATUS)) v[k] = c.sink(hex, 0.25);
    // ...and one that carries white text (a Delete button, a count badge) is a fill: the hue,
    // darkened until the white reads.
    for (const k of STATUS_FILLS) v[k + '-fill'] = ensure(c.dark ? STATUS[k] : v[k], '#ffffff', 4.5, 'darker');
    // A calendar's today-cell is a wash of the accent that the grid shows through. On a dark page
    // that lightens it; on a light one it would be muddier than its neighbours, so it is solid.
    if (!c.dark) v['--cal-today'] = over(c.accent, c.bg, 0.1);
    // Shadows are black at some opacity, drawn for a dark page; on a light one they are softened.
    if (!c.dark) v['--sh-k'] = '0.4';
    v[hueToken(OLD_ACCENT)] = c.accentText;
    if (!c.dark) for (const h of HUES) v[hueToken(h)] = c.sink(h, 0.25);
    return v;
  }

  // What has been changed from the original, which decides what has to be said on a page
  // at all: a workspace that has chosen nothing needs no dark block and no font link.
  // "Colours" means the dark look differs from the sheets' own; the light look is always
  // written, because the sheets have none.
  function custom(profile) {
    const n = norm(profile);
    const t = n.theme;
    const glow = t.glow || PRESETS[t.preset].glow;
    const colors = !(t.preset === DEFAULT_PRESET && !t.accent && !t.accent2 && !(t.neutrals && t.neutrals.dark) && glow === 'off');
    const fonts = (n.typography.heading && n.typography.heading !== DEFAULT_FONTS.heading) || (n.typography.body && n.typography.body !== DEFAULT_FONTS.body);
    const shape = (n.shape.radius !== undefined && n.shape.radius !== DEFAULT_SHAPE.radius) || (n.shape.density !== undefined && n.shape.density !== DEFAULT_SHAPE.density);
    return { colors, fonts: !!fonts, shape: !!shape };
  }

  function fontVars(n) {
    const head = FONTS[n.typography.heading || DEFAULT_FONTS.heading], body = FONTS[n.typography.body || DEFAULT_FONTS.body];
    return {
      '--font-head': head.stack, '--font-body': body.stack,
      '--head-scale': String(head.scale), '--body-scale': String(body.scale),
      '--head-tracking': head.tracking || 'normal',
    };
  }
  function shapeVars(n) {
    return {
      '--r-k': String(RADIUS_K[n.shape.radius !== undefined ? n.shape.radius : DEFAULT_SHAPE.radius]),
      '--d-k': String(DENSITY_K[n.shape.density !== undefined ? n.shape.density : DEFAULT_SHAPE.density]),
    };
  }

  const decl = vars => Object.keys(vars).map(k => k + ':' + vars[k]).join(';');

  // The stylesheet text for a workspace. Custom properties and nothing else — which is
  // what lets a value from a profile be put into a page without it being able to do
  // anything but recolour. Dark is the sheets' own default, so it is only written when
  // something differs; light is always written, so every workspace can switch to it.
  function renderThemeCss(profile) {
    const n = norm(profile);
    const cu = custom(n);
    const extra = Object.assign({}, cu.fonts ? fontVars(n) : {}, cu.shape ? shapeVars(n) : {});
    let css = '';
    const root = Object.assign({}, cu.colors ? deriveVars(n, 'dark') : {}, extra);
    if (Object.keys(root).length) css += ':root{' + decl(root) + '}';
    // Parts of the page that are always dark (the huddle widget, toasts) put the dark
    // values back for themselves, so a light page does not turn them pale. The sheets already
    // declare most tokens on .on-dark; the ones a light page defines and the sheets do not
    // (they are "not defined" until a look says so) would be inherited from <html>, so they
    // are put back to not-defined here, which sends every var() to its own fallback.
    const reset = {};
    for (const k of LIGHT_ONLY) reset[k] = 'initial';
    if (cu.colors) css += '.on-dark{' + decl(Object.assign(reset, deriveVars(n, 'dark'))) + '}';
    css += 'html[data-mode="light"]{' + decl(Object.assign({ 'color-scheme': 'light' }, deriveVars(n, 'light'), extra)) + '}';
    // (a workspace that keeps the original dark look has no .on-dark block to say it in, and
    // needs none until the page is light)
    if (!cu.colors) css += 'html[data-mode="light"] .on-dark{' + decl(reset) + '}';
    return css;
  }

  // The Google Fonts stylesheet for the chosen faces. The default pair reproduces the
  // address the pages have always carried, so choosing nothing changes nothing.
  function fontsHref(profile) {
    const n = norm(profile);
    const ids = [n.typography.heading || DEFAULT_FONTS.heading, n.typography.body || DEFAULT_FONTS.body];
    const seen = [];
    for (const id of ids) if (!seen.includes(id)) seen.push(id);
    return 'https://fonts.googleapis.com/css2?' + seen.map(id => 'family=' + FONTS[id].family.replace(/ /g, '+') + ':wght@' + FONTS[id].weights).join('&') + '&display=swap';
  }

  // ── Mode ────────────────────────────────────────────────────────────────────
  // Runs in <head>, before the page paints: the person's own choice if they may make
  // one, else the workspace's. Only ever sets data-mode to "dark" or "light".
  function bootScript(profile) {
    const n = norm(profile);
    const dflt = n.theme.default_mode || PRESETS[n.theme.preset].mode;
    const allow = n.theme.allow_user_mode !== false;
    return '(function(){var d=document.documentElement,m=' + JSON.stringify(dflt) + ';'
      + (allow ? 'try{var s=localStorage.getItem("ml_mode");if(s==="dark"||s==="light"||s==="auto")m=s}catch(e){}' : '')
      + 'if(m==="auto")m=(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark";'
      + 'd.setAttribute("data-mode",m)})();';
  }
  function defaultMode(profile) {
    const n = norm(profile);
    return n.theme.default_mode || PRESETS[n.theme.preset].mode;
  }

  // The browser-bar and installed-app colours: the page background of the mode people
  // will open in (auto opens in the system's, which the server cannot know — dark).
  function themeColor(profile, mode) {
    const n = norm(profile);
    return palette(n, mode || (defaultMode(n) === 'light' ? 'light' : 'dark')).bg;
  }

  // ── Guarding ────────────────────────────────────────────────────────────────
  // Every pair of colours that carry reading, with the lowest contrast we let through.
  // The derived colours (accent as text, the ink on a button, the sidebar's text) are
  // made to pass; what can fail is only what the admin chose.
  const PAIRS = [
    { id: 'text-bg', fg: 'text', bg: 'bg', min: 4.5, label: 'Text on the page' },
    { id: 'text-panel', fg: 'text', bg: 'panel', min: 4.5, label: 'Text on panels' },
    { id: 'muted-panel', fg: 'muted', bg: 'panel', min: 3, warn: 4.5, label: 'Secondary text on panels' },
    { id: 'muted-bg', fg: 'muted', bg: 'bg', min: 3, warn: 4.5, label: 'Secondary text on the page' },
    { id: 'accent-panel', fg: 'accent', bg: 'panel', min: 3, label: 'Accent on panels' },
    { id: 'accent-text', fg: 'accentText', bg: 'tint', min: 4.5, label: 'Accent used as text' },
    { id: 'on-accent', fg: 'onAccent', bg: 'accent', min: 4.5, label: 'Button text' },
    { id: 'sidebar-text', fg: 'sbText', bg: 'sidebar', min: 4.5, label: 'Sidebar text' },
  ];
  function report(profile) {
    const n = norm(profile);
    const rows = [];
    for (const mode of ['dark', 'light']) {
      const c = palette(n, mode);
      c.tint = over(c.accentText, c.panel, accentTint(c.dark));
      for (const p of PAIRS) {
        const ratio = contrast(c[p.fg], c[p.bg]);
        const level = ratio < p.min ? 'error' : p.warn && ratio < p.warn ? 'warn' : 'ok';
        rows.push({ mode, id: p.id, label: p.label, fg: c[p.fg], bg: c[p.bg], ratio: Math.round(ratio * 100) / 100, min: p.min, level });
      }
    }
    return rows;
  }
  function problems(profile) {
    return report(profile).filter(r => r.level !== 'ok').map(r => Object.assign({}, r, {
      message: r.label + ' (' + r.mode + '): ' + r.ratio + ':1 — needs ' + (r.level === 'error' ? r.min : PAIRS.find(p => p.id === r.id).warn) + ':1',
    }));
  }

  return {
    VERSION: 1,
    PRESETS, PRESET_ORDER, DEFAULT_PRESET, FONTS, FONT_ORDER, DEFAULT_FONTS, DEFAULT_SHAPE, RADIUS_K, DENSITY_K, GLOWS, MODES, NEUTRAL_KEYS, TEXT_KEYS, STATUS, BASE,
    HUES, NAV_HUES, OLD_ACCENT, hueToken, normalize, validate, custom, inputs, palette, deriveVars, fontVars, shapeVars, renderThemeCss, fontsHref, bootScript, defaultMode, themeColor, report, problems,
    color: { isHex, normHex, rgb, toHex, triplet, rgba, luminance, contrast, mix, over, toHsl, fromHsl, ensure, onFill },
  };
});
