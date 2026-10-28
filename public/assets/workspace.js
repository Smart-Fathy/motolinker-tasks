// The workspace's name and picture — shared by both portals.
//
// Both used to be fixed: "MotoLinker" written into the markup, the round mark a
// stylesheet background. The admin sets them now (Workspace, in the admin sidebar),
// and this puts them everywhere they show — anything marked data-ws-name, the page
// title, the round mark (both stylesheets draw it from --ws-logo, falling back to the
// default), and the tab's icon. The last one seen is remembered, so a renamed
// workspace doesn't flash its old name on every load, and a change made while a page
// is open arrives over its notification stream ('workspace') and applies at once.
const WS_DEFAULT_NAME = 'MotoLinker';
let _ws = { name: WS_DEFAULT_NAME, logo_url: '' };
let _wsTitle = null;     // this page's title with the name lifted out, e.g. "{ws} · Admin Dashboard"
let _wsFavicon = null;   // the page's own tab icon, put back when the picture is removed

function wsName() { return _ws.name || WS_DEFAULT_NAME; }
function wsCurrent() { return { ..._ws }; }

function wsApply(p) {
  // A degraded answer is the server saying it has not heard from its database: it
  // describes nothing, and must not overwrite what this page already knows.
  if (!p || typeof p !== 'object' || p.degraded) return;
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
  try { localStorage.setItem('ml_workspace', JSON.stringify(_ws)); } catch (_) {}
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
  try {
    const seen = JSON.parse(localStorage.getItem('ml_workspace') || 'null');
    if (seen) wsApply(seen);
  } catch (_) {}
  // This runs where its script tag sits, before the end of the page is parsed: once
  // it is, the name goes on whatever came after too (an install banner, say), even if
  // the server never answers.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => wsApply(_ws));
  wsLoad();
})();
