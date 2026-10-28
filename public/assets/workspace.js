// The workspace's name, picture and look — shared by both portals.
//
// The name and picture used to be fixed: "MotoLinker" written into the markup, the round
// mark a stylesheet background. The admin sets them now (Workspace, in the admin sidebar),
// and this puts them everywhere they show — anything marked data-ws-name, the page title,
// the round mark (both stylesheets draw it from --ws-logo, falling back to the default),
// and the tab's icon.
//
// The look — colours, type, shape, the wording on the sign-in pages — is written into the
// page by the server before it is sent (src/lib/shell.js), so nothing flashes. What happens
// here is the rest of its life: a change made while a page is open arrives over its
// notification stream ('workspace') and is applied at once, by the same code that wrote it
// the first time (assets/theme-core.js); the last profile seen is kept, so a page served from
// the service worker's cache while offline still wears the look it last had, and a stale one
// never overwrites a newer; and each person's own choice of dark, light or automatic is
// applied, remembered, and sent to the server so it follows them to another device.
//
// A page opened with ?safe=1 wears the original look whatever is saved, and nothing here
// changes that: it is the way back in if a look ever makes the screen hard to use.
const WS_DEFAULT_NAME = 'MotoLinker';
const WS_SAFE = /[?&]safe=1(?:&|$)/.test(location.search);
let _ws = { name: WS_DEFAULT_NAME, logo_url: '' };
let _wsLook = null;      // the look being worn: theme-core's normalised profile
let _wsStamp = '';       // the updated_at of the profile it came from
let _wsTitle = null;     // this page's title with the name lifted out, e.g. "{ws} · Admin Dashboard"
let _wsFavicon = null;   // the page's own tab icon, put back when the picture is removed

function wsName() { return _ws.name || WS_DEFAULT_NAME; }
function wsCurrent() { return { ..._ws }; }
function wsLook() { return _wsLook; }

function wsApply(p) {
  // A degraded answer is the server saying it has not heard from its database: it
  // describes nothing, and must not overwrite what this page already knows.
  if (!p || typeof p !== 'object' || p.degraded) return;
  // A profile older than the one being worn (a slow answer overtaken by a push, a copy kept
  // for offline use) is not worn. (ISO timestamps compare as text.)
  const stamp = String(p.updated_at || '');
  if (_wsStamp && stamp && stamp < _wsStamp) return;
  const name = String(p.name || '').trim() || WS_DEFAULT_NAME;
  const logo = typeof p.logo_url === 'string' && /^https?:\/\//i.test(p.logo_url) ? p.logo_url : '';
  _ws = { name, logo_url: logo };
  document.querySelectorAll('[data-ws-name]').forEach(el => { if (el.textContent !== name) el.textContent = name; });
  if (_wsTitle === null) {
    // The server writes the name into the page it sends and keeps the template beside it.
    const t = document.querySelector('title');
    _wsTitle = t && t.dataset.wsTitle ? t.dataset.wsTitle : document.title.includes(WS_DEFAULT_NAME) ? document.title.replace(WS_DEFAULT_NAME, '{ws}') : '';
  }
  if (_wsTitle) document.title = _wsTitle.replace('{ws}', name);
  const root = document.documentElement;
  // Quoted, with the three characters that could end the url("…") encoded.
  if (logo) root.style.setProperty('--ws-logo', 'url("' + logo.replace(/["\\\n\r]/g, c => encodeURIComponent(c)) + '")');
  else root.style.removeProperty('--ws-logo');
  root.classList.toggle('ws-custom-logo', !!logo);
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) {
    if (_wsFavicon === null) _wsFavicon = icon.getAttribute('data-default-href') || icon.getAttribute('href') || '';
    const want = logo || _wsFavicon;
    if (icon.getAttribute('href') !== want) icon.setAttribute('href', want);
  }
  wsApplyLook(p);
  try { localStorage.setItem('ml_workspace', JSON.stringify(Object.assign({}, p, { name, logo_url: logo }))); } catch (_) {}
}

// ── The look ────────────────────────────────────────────────────────────────
function wsApplyLook(p) {
  const T = window.ThemeCore;
  if (!T || WS_SAFE) return;
  if (!('theme' in p || 'typography' in p || 'shape' in p || 'texts' in p)) return;   // an older answer: nothing to wear
  if (p.updated_at) _wsStamp = String(p.updated_at);
  _wsLook = T.normalize(p);
  // The tokens: the same <style> the server wrote, rewritten. It goes last in <head>, after
  // the sheets, because its dark tokens are :root rules like theirs and have to win.
  let st = document.getElementById('ws-theme');
  if (!st) { st = document.createElement('style'); st.id = 'ws-theme'; document.head.appendChild(st); }
  const css = T.renderThemeCss(_wsLook);
  if (st.textContent !== css) st.textContent = css;
  // The faces. (The default pair is the link the page has always carried.)
  const link = document.querySelector('link[href^="https://fonts.googleapis.com/css2?"]');
  if (link) { const want = T.fontsHref(_wsLook); if (link.getAttribute('href') !== want) link.setAttribute('href', want); }
  wsApplyTexts();
  mlApplyMode();
  try { window.dispatchEvent(new CustomEvent('ml:look', { detail: { look: _wsLook } })); } catch (_) {}
}

// The sign-in and portal wording an admin has replaced. The page's own wording is kept
// beside each line (the server writes it when it replaces one), so putting it back needs
// no memory of it; {ws} stands for the workspace's name.
function wsApplyTexts() {
  const texts = (_wsLook && _wsLook.texts) || {};
  document.querySelectorAll('[data-ws-text]').forEach(el => {
    if (el.getAttribute('data-ws-text-default') === null) el.setAttribute('data-ws-text-default', el.textContent);
    const t = texts[el.getAttribute('data-ws-text')];
    const want = t ? t.replace(/\{ws\}/g, wsName()) : el.getAttribute('data-ws-text-default');
    if (el.textContent !== want) el.textContent = want;
  });
}

// ── Dark, light or automatic ────────────────────────────────────────────────
// A person's own choice (ml_mode, in this browser, shared by both portals) wins when the
// workspace lets people choose; otherwise the workspace's default does. "Automatic" follows
// the device. The page is already in the right mode when it paints (a few lines in <head>
// do it before anything is drawn); this keeps it right afterwards.
const ML_MODES = ['dark', 'light', 'auto'];
const ML_ICONS = {
  dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  auto: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>',
};
const ML_NAMES = { dark: 'Dark', light: 'Light', auto: 'Automatic' };
const ML_NEXT = { dark: 'light', light: 'auto', auto: 'dark' };

function mlStored() { try { const m = localStorage.getItem('ml_mode'); return ML_MODES.includes(m) ? m : null; } catch (_) { return null; } }
function mlAllowed() { return !(_wsLook && _wsLook.theme && _wsLook.theme.allow_user_mode === false); }
// What the page is set to: a person's own choice if they may make one, else the workspace's.
function mlMode() {
  const own = mlAllowed() ? mlStored() : null;
  if (own) return own;
  return window.ThemeCore && _wsLook ? window.ThemeCore.defaultMode(_wsLook) : (document.documentElement.getAttribute('data-mode') || 'dark');
}
function mlEffectiveMode() {
  const m = mlMode();
  return m === 'auto' ? (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : m;
}

function mlApplyMode() {
  const T = window.ThemeCore;
  if (!T || !_wsLook) return;   // not heard from the workspace yet: what the page opened in stays
  const eff = mlEffectiveMode();
  const root = document.documentElement;
  if (root.getAttribute('data-mode') !== eff) root.setAttribute('data-mode', eff);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', T.themeColor(_wsLook, eff));
  // A translucent dark status bar over a light page is unreadable on a phone.
  const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (bar) {
    if (!bar.getAttribute('data-default')) bar.setAttribute('data-default', bar.getAttribute('content') || 'default');
    bar.setAttribute('content', eff === 'light' ? 'default' : bar.getAttribute('data-default'));
  }
  mlPaintToggle();
  mlChartDefaults();
  try { window.dispatchEvent(new CustomEvent('ml:mode', { detail: { mode: mlMode(), effective: eff } })); } catch (_) {}
}

// The sun / moon / half-moon button in each portal's header.
function mlPaintToggle() {
  const b = document.getElementById('ml-mode-toggle');
  if (!b) return;
  const m = mlMode();
  b.style.display = mlAllowed() ? '' : 'none';
  b.innerHTML = ML_ICONS[m];
  const label = 'Colour mode: ' + ML_NAMES[m] + ' (click for ' + ML_NAMES[ML_NEXT[m]] + ')';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.setAttribute('data-mode-pref', m);
}

function mlSetMode(m) {
  if (!ML_MODES.includes(m) || !mlAllowed()) return;
  try { localStorage.setItem('ml_mode', m); } catch (_) {}
  mlApplyMode();
  mlPushPrefs(m);
}
function mlCycleMode() { mlSetMode(ML_NEXT[mlMode()]); }

// The charts draw their own axes and gridlines in Chart.js's defaults (a mid grey), which a
// light page or a chosen look would leave faint or wrong; on those they read the page's own
// secondary text and hairline instead. The original look keeps Chart.js's defaults.
let _mlChartOwn = null;
function mlChartDefaults() {
  if (!window.Chart || !window.Chart.defaults) return;
  const D = window.Chart.defaults;
  if (_mlChartOwn === null) _mlChartOwn = { color: D.color, borderColor: D.borderColor };
  const T = window.ThemeCore;
  const themed = document.documentElement.getAttribute('data-mode') === 'light' || (T && _wsLook && T.custom(_wsLook).colors);
  if (themed) {
    const cs = getComputedStyle(document.documentElement);
    D.color = cs.getPropertyValue('--muted').trim() || _mlChartOwn.color;
    D.borderColor = cs.getPropertyValue('--border').trim() || _mlChartOwn.borderColor;
  } else { D.color = _mlChartOwn.color; D.borderColor = _mlChartOwn.borderColor; }
  try { Object.values(window.Chart.instances || {}).forEach(c => c.update('none')); } catch (_) {}
}

// A person's choice follows them: the browser's copy is applied first (it is what the page
// opened with), the server's is what another device left. Whichever device chose last is
// right, so a copy only travels when this browser has one the server does not.
function mlAuthed(path, opts) {
  if (typeof apiFetch === 'function') return apiFetch(path, opts);
  if (typeof ef === 'function') return ef(path, opts);
  return null;
}
function mlPrefsPath() { return (location.pathname.indexOf('/employee') === 0 ? '/api/employee' : '/api/dashboard') + '/ui-prefs'; }
function mlPushPrefs(m) {
  try {
    const r = mlAuthed(mlPrefsPath(), { method: 'PUT', body: JSON.stringify({ mode: m }) });
    if (r && r.catch) r.catch(() => {});
  } catch (_) {}
}
async function mlSyncPrefs() {
  try {
    const r = await mlAuthed(mlPrefsPath());
    if (!r || !r.ok) return;
    const p = await r.json();
    const own = mlStored();
    if (p.mode && !own) { try { localStorage.setItem('ml_mode', p.mode); } catch (_) {} mlApplyMode(); }
    else if (own && p.mode !== own && mlAllowed()) mlPushPrefs(own);
  } catch (_) {}
}

// The notification stream's 'workspace' event — the admin just changed it.
function wsOnStreamEvent(e) {
  try { wsApply(JSON.parse(e.data)); } catch (_) {}
}

async function wsLoad() {
  try {
    const r = await fetch('/api/workspace', { cache: 'no-store' });
    if (r.ok) wsApply(await r.json());
  } catch (_) { /* offline: the remembered one stays */ }
}

(function wsBoot() {
  // The stamp of the profile the server wrote this page from: anything older that was kept
  // in this browser is not worn over it.
  _wsStamp = document.documentElement.getAttribute('data-ws-stamp') || '';
  try {
    const seen = JSON.parse(localStorage.getItem('ml_workspace') || 'null');
    if (seen) wsApply(seen);
  } catch (_) {}
  // This runs where its script tag sits, before the end of the page is parsed: once it is,
  // the name (and the wording, and the colour-mode button) goes on whatever came after too
  // (an install banner, say), even if the server never answers.
  const late = () => { wsApply(Object.assign({}, _ws, _wsLook ? { theme: _wsLook.theme, typography: _wsLook.typography, shape: _wsLook.shape, texts: _wsLook.texts, updated_at: _wsStamp } : {})); mlPaintToggle(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', late); else mlPaintToggle();
  // Automatic follows the device while the page is open.
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (mlMode() === 'auto') mlApplyMode(); }); } catch (_) {}
  // Another tab of this browser changed the colour mode: this one follows.
  window.addEventListener('storage', e => { if (e.key === 'ml_mode') mlApplyMode(); });
  wsLoad();
})();
