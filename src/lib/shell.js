// The two portals' pages and install manifests, with the workspace written into them.
//
// The pages are static files, so a theme applied by a script would show the original
// look for a moment on every load — the first thing a person sees, every time, is the
// thing the admin changed. So the server writes the workspace into the page before it
// is sent: its name, its picture, a <style> that redefines the colour and type tokens,
// the font link, the browser-bar colour, the wording an admin replaced, and a few lines
// that choose dark or light before anything paints. A workspace that has chosen nothing
// gets the page it always had plus the light-mode tokens and those few lines.
//
// Pure functions of (file text, profile): src/routes/shell.js does the serving, and
// every piece of text that comes from a profile is either escaped here or was already
// reduced to data by theme-core (hex colours, ids from allow-lists).
const ThemeCore = require('../../public/assets/theme-core.js');

const DEFAULT_NAME = 'MotoLinker';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// What a page is told to start from when it is opened in "safe mode" (?safe=1): the
// original look, whatever is saved. The way back in if a look ever makes the screen
// hard to use, since the Workspace page that changes it is on that screen.
const ORIGINAL_LOOK = ThemeCore.normalize({});

function renderShell(html, ws, { safe = false } = {}) {
  const look = safe ? ORIGINAL_LOOK : ThemeCore.normalize(ws);
  const cu = ThemeCore.custom(look);
  const mode = ThemeCore.defaultMode(look);
  const name = ws.custom_name ? ws.name : DEFAULT_NAME;
  let out = html;

  // ── Who: the name, wherever the page says it ──────────────────────────────────
  if (ws.custom_name && name !== DEFAULT_NAME) {
    // <title>…MotoLinker…</title>, with the original kept as the template a later rename starts from
    out = out.replace(/<title>([^<]*)<\/title>/i, (m, t) => {
      if (!t.includes(DEFAULT_NAME)) return m;
      return '<title data-ws-title="' + esc(t.replace(DEFAULT_NAME, '{ws}')) + '">' + esc(t.replace(DEFAULT_NAME, name)) + '</title>';
    });
    // <span data-ws-name>MotoLinker</span> — plain text only, which is all those elements hold
    out = out.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bdata-ws-name\b[^>]*>)([^<]*)(<\/\2>)/gi, (m, open, _tag, _inner, close) => open + esc(name) + close);
  }

  // ── The picture: the round mark and the tab's icon ────────────────────────────
  // (and the stamp of the profile this page was written from, which is how a page tells a
  // newer profile — one it keeps for offline use, say — from an older one)
  const stamp = !safe && ws.updated_at && !ws.degraded ? ' data-ws-stamp="' + esc(ws.updated_at) + '"' : '';
  const logo = ws.logo_url ? ' class="ws-custom-logo" style="--ws-logo:url(&quot;' + esc(ws.logo_url) + '&quot;)"' : '';
  if (stamp || logo) out = out.replace(/<html\b([^>]*)>/i, (m, attrs) => '<html' + attrs + stamp + logo + '>');
  if (ws.logo_url) {
    out = out.replace(/<link rel="icon"([^>]*?)href="([^"]*)"([^>]*)>/i, (m, a, href, b) => '<link rel="icon"' + a + 'href="' + esc(ws.logo_url) + '" data-default-href="' + esc(href) + '"' + b + '>');
  }

  // ── The look ──────────────────────────────────────────────────────────────────
  const css = ThemeCore.renderThemeCss(look);
  if (/</.test(css)) throw new Error('theme css contains a tag opener');   // cannot happen; refuse to find out
  if (cu.fonts) out = out.replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/i, '<link href="' + ThemeCore.fontsHref(look) + '" rel="stylesheet">');
  if (cu.colors || mode === 'light') out = out.replace(/<meta name="theme-color" content="[^"]*">/i, '<meta name="theme-color" content="' + ThemeCore.themeColor(look) + '">');
  // A light page under a translucent dark status bar is unreadable on a phone.
  if (mode === 'light') out = out.replace(/<meta name="apple-mobile-web-app-status-bar-style" content="[^"]*">/i, '<meta name="apple-mobile-web-app-status-bar-style" content="default">');

  // ── The wording an admin replaced (and a default that names the workspace) ────
  // A line whose own wording has {ws} in it (the team sign-in's subtitle) says the workspace's name
  // even when nobody has replaced it, so a renamed workspace never shows the old one there.
  const decode = t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  if (Object.keys(look.texts).length || (ws.custom_name && /data-ws-text-default="[^"]*\{ws\}/.test(out))) {
    out = out.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bdata-ws-text="(\w+)"[^>]*>)([^<]*)(<\/\2>)/gi, (m, open, _tag, key, inner, close) => {
      let t = look.texts[key];
      const given = /\bdata-ws-text-default="([^"]*)"/.exec(open);
      if (!t && ws.custom_name && given && decode(given[1]).includes('{ws}')) t = decode(given[1]);
      if (!t) return m;
      // the wording the page has by default is kept beside it, so putting it back needs no memory of it
      return (given ? open : open.replace(/>$/, ' data-ws-text-default="' + esc(inner) + '">')) + esc(t.replace(/\{ws\}/g, name)) + close;
    });
  }

  // ── Mode first, then the tokens ───────────────────────────────────────────────
  // The script goes in as early as it can, so data-mode is set before anything is drawn;
  // the <style> goes last in <head>, after the sheets, because its dark tokens are
  // :root rules like theirs and must come later to win.
  const script = '<script>' + ThemeCore.bootScript(look) + '</script>';
  out = /<meta charset="UTF-8">/i.test(out) ? out.replace(/<meta charset="UTF-8">/i, m => m + '\n' + script) : out.replace(/<head>/i, m => m + '\n' + script);
  out = out.replace(/<\/head>/i, '<style id="ws-theme">' + css + '</style>\n</head>');
  return out;
}

// The wording an admin replaced, as data. The classic pages are dressed by markers in their HTML (above); the new
// app draws its text by script, out of the markers' reach, so it is told the wording instead, from the same place
// and with the same rule for safe mode: the original look has the original wording.
function wordingOf(ws, { safe = false } = {}) {
  return { ...(safe ? ORIGINAL_LOOK : ThemeCore.normalize(ws)).texts };
}

// The install manifest. The workspace's name and, if it has chosen colours, its page
// colour; everything else (icons, scope, start page) is the file as it ships.
function renderManifest(base, ws, kind, { safe = false } = {}) {
  const look = safe ? ORIGINAL_LOOK : ThemeCore.normalize(ws);
  const cu = ThemeCore.custom(look);
  const mode = ThemeCore.defaultMode(look);
  const m = JSON.parse(JSON.stringify(base));
  if (ws.custom_name && ws.name !== DEFAULT_NAME) {
    const name = ws.name;
    const clip = (s, n) => [...s].slice(0, n).join('');
    m.name = clip(name + ' — ' + (kind === 'admin' ? 'Admin' : 'Team Portal'), 45);
    m.short_name = kind === 'admin' ? clip([...name].length <= 8 ? name + ' Admin' : name, 12) : clip(name, 12);
    if (typeof m.description === 'string') m.description = m.description.replace(DEFAULT_NAME, name);
  }
  if (cu.colors || mode === 'light') m.background_color = m.theme_color = ThemeCore.themeColor(look);
  return m;
}

module.exports = { renderShell, renderManifest, wordingOf, esc, DEFAULT_NAME };
