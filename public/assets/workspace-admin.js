// The Workspace page — the admin's editor for the workspace's name, picture and look: colours
// (a preset gallery, an accent, a second colour, the neutrals of each mode, a neon glow), the
// faces, the roundness and density, the wording on the sign-in pages, and who may pick dark or
// light for themselves. Everything is a draft until it is saved; a live preview follows every
// change, "Try it on this page" puts the draft on the real screen for a minute, and nothing the
// editor sends can be anything but data: the server (and assets/theme-core.js, which both of
// them run) checks every field, and a combination nobody could read is refused with the pair
// that fails. Admin only; the portals themselves are drawn by assets/workspace.js.
const WSA_TABS = [['identity', 'Identity'], ['colours', 'Colours'], ['type', 'Type & shape'], ['behaviour', 'Behaviour']];
const WSA_TEXTS = [
  ['admin_title', 'Admin sign-in: heading', 'The big line on the admin sign-in card.'],
  ['admin_sub', 'Admin sign-in: line under it', ''],
  ['admin_badge', 'Admin header: badge', 'The small label beside the name in the admin header.'],
  ['admin_role', 'Admin sidebar: role', 'Under the name in the admin sidebar.'],
  ['team_title', 'Team sign-in: heading', 'The big line on the team portal\'s sign-in card.'],
  ['team_sub', 'Team sign-in: line under it', '{ws} stands for the workspace\'s name.'],
  ['team_role', 'Team sidebar: role', 'Under the name in the team portal\'s sidebar.'],
];
const WSA_NEUTRALS = [['bg', 'Page'], ['panel', 'Panels'], ['sidebar', 'Sidebar'], ['text', 'Text'], ['muted', 'Secondary text']];
const WSA_RADIUS = ['Sharp', 'Slight', 'Standard', 'Soft', 'Round'];
const WSA_DENSITY = ['Compact', 'Comfortable', 'Roomy'];
let _wsa = null;      // { saved, draft, tab, advMode, pvMode, suggest, try }

const wsaT = () => window.ThemeCore;
const wsaClone = o => JSON.parse(JSON.stringify(o));
const wsaHex = v => (wsaT().color.normHex(String(v == null ? '' : v)));

// What is stored, as a draft: the four sections of the look and the name. From a profile the
// server has just answered with if there is one — a page in safe mode wears the original look
// whatever is saved, so what it is wearing is not what the editor must start from.
function wsaFromProfile(p) {
  const T = wsaT();
  const look = T.normalize(p || wsLook() || {});
  return wsaClone({ name: (p && p.name) || wsName(), theme: look.theme, typography: look.typography, shape: look.shape, texts: look.texts });
}
// The body the server wants: only the four sections, and only what is set.
function wsaPayload(d) {
  d = d || _wsa.draft;
  const theme = wsaClone(d.theme);
  for (const m of ['dark', 'light']) if (theme.neutrals && theme.neutrals[m] && !Object.keys(theme.neutrals[m]).length) delete theme.neutrals[m];
  if (theme.neutrals && !Object.keys(theme.neutrals).length) delete theme.neutrals;
  return { theme, typography: wsaClone(d.typography), shape: wsaClone(d.shape), texts: wsaClone(d.texts) };
}
const wsaNorm = d => wsaT().normalize(wsaPayload(d));
// (compared as the normalised look, so a value set and then put back is not a change)
const wsaSig = d => JSON.stringify(wsaNorm(d)) + '|' + String(d.name || '').trim();
const wsaDirty = () => !!_wsa && wsaSig(_wsa.draft) !== wsaSig(_wsa.saved);

// ── Entry points ─────────────────────────────────────────────────────────────
function wsAdminLoad() {
  const root = document.getElementById('wsa-root');
  if (!root) return;
  if (!window.ThemeCore) { root.innerHTML = '<div class="error-msg">The look editor could not load (theme-core.js).</div>'; return; }
  const begin = p => {
    const d = wsaFromProfile(p);
    _wsa = { saved: wsaClone(d), draft: d, tab: 'identity', advMode: 'dark', pvMode: mlEffectiveMode(), suggest: true, trying: null };
    wsaFonts();
    wsaRender();
  };
  const fresh = () => fetch('/api/workspace', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (WS_SAFE) {
    // Safe mode wears the original look, so the saved one has to be asked for.
    if (!_wsa) root.innerHTML = '<div class="loading"><div class="spinner"></div> Loading the saved look…</div>';
    fresh().then(p => { if (p && !p.degraded) begin(p); else root.innerHTML = '<div class="error-msg">Could not read the saved look. Try again in a moment.</div>'; });
    return;
  }
  if (!_wsa) begin();
  else {
    // the page's own name and picture may have changed since (another admin, another tab)
    if (!wsaDirty()) { const d = wsaFromProfile(); _wsa.saved = wsaClone(d); _wsa.draft = d; }
    wsaFonts();
    wsaRender();
  }
  // A fresh read, in case this page's copy is behind (the first one it has is whatever it was told).
  fresh().then(p => {
    if (p && !p.degraded && !wsaDirty() && _wsa && document.getElementById('page-workspace').classList.contains('active')) {
      const d = wsaFromProfile(p);
      if (wsaSig(d) !== wsaSig(_wsa.saved)) { _wsa.saved = wsaClone(d); _wsa.draft = d; wsaRender(); }
    }
  });
}
// The old entry points: the sidebar's footer shortcut and the tests that pin it open the editor.
function openWorkspaceSettings() {
  if (typeof hideModal === 'function') { try { hideModal(); } catch (_) {} }
  navigate('workspace');
}
function wsAdminLeave() { wsaTryStop(false); wsaFonts(true); }

// ── Drawing ──────────────────────────────────────────────────────────────────
function wsaRender() {
  const root = document.getElementById('wsa-root');
  if (!root || !_wsa) return;
  const T = wsaT(), d = _wsa.draft, tab = _wsa.tab;
  const tabs = WSA_TABS.map(([id, label]) => `<button class="wsa-tab${tab === id ? ' on' : ''}" type="button" data-act="tab" data-id="${id}">${label}</button>`).join('');
  root.innerHTML = `
    <div class="wsa-head">
      <div>
        <div class="wsa-title">Workspace</div>
        <div class="wsa-sub">How everyone sees ${esc(d.name || wsName())}: its name and picture, colours, type and shape. Nothing changes for anyone until you save.</div>
      </div>
      <div class="wsa-actions">
        <button class="btn btn-outline btn-sm" type="button" data-act="try" id="wsa-try-btn"><i data-lucide="eye" style="width:14px;height:14px"></i> Try it on this page</button>
        <button class="btn btn-outline btn-sm" type="button" data-act="discard" id="wsa-discard-btn">Discard changes</button>
        <button class="btn btn-primary btn-sm" type="button" data-act="save" id="ws-save-btn">Save</button>
      </div>
    </div>
    <div id="wsa-problems"></div>
    <div class="wsa-grid">
      <div class="wsa-col">
        <div class="wsa-tabs" role="tablist">${tabs}</div>
        <div id="wsa-tab">${wsaTabHtml()}</div>
      </div>
      <aside class="wsa-col wsa-side">
        <div class="wsa-card wsa-pv-card">
          <div class="wsa-pv-head">
            <span>Preview</span>
            <span class="wsa-seg" id="wsa-pv-modes">
              <button type="button" data-act="pvmode" data-id="dark" class="${_wsa.pvMode === 'dark' ? 'on' : ''}">Dark</button>
              <button type="button" data-act="pvmode" data-id="light" class="${_wsa.pvMode === 'light' ? 'on' : ''}">Light</button>
            </span>
          </div>
          <div id="wsa-pv">${wsaPreviewHtml()}</div>
          <div class="wsa-hint">The preview wears your draft. The real screens change only when you save.</div>
        </div>
        <div class="wsa-card" id="wsa-contrast"></div>
      </aside>
    </div>`;
  wsaBind(root);
  wsaPaint();
  if (typeof lucide !== 'undefined') requestAnimationFrame(() => lucide.createIcons());
}

function wsaTabHtml() {
  switch (_wsa.tab) {
    case 'colours': return wsaColoursHtml();
    case 'type': return wsaTypeHtml();
    case 'behaviour': return wsaBehaviourHtml();
    default: return wsaIdentityHtml();
  }
}

function wsaIdentityHtml() {
  const d = _wsa.draft, ws = wsCurrent();
  const fields = WSA_TEXTS.map(([key, label, hint]) => {
    const T = wsaT();
    return `<div class="form-group">
      <label class="form-label" for="wsa-text-${key}">${label}</label>
      <input class="form-control wsa-text" id="wsa-text-${key}" data-text="${key}" maxlength="${T.TEXT_KEYS[key]}" placeholder="${esc(T.TEXT_DEFAULTS[key])}" value="${esc(d.texts[key] || '')}">
      ${hint ? `<div class="wsa-hint">${esc(hint)}</div>` : ''}
    </div>`;
  }).join('');
  return `
    <div class="wsa-card">
      <h3>Name and picture</h3>
      <div class="ws-edit-pic">
        <div class="logo ws-edit-face" aria-hidden="true"></div>
        <div style="min-width:0">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" type="button" onclick="document.getElementById('ws-logo-input').click()">
              <i data-lucide="image-up" style="width:13px;height:13px"></i> ${ws.logo_url ? 'Change picture' : 'Upload a picture'}</button>
            ${ws.logo_url ? `<button class="btn btn-outline btn-sm" type="button" onclick="wsRemoveLogo()">Use the default</button>` : ''}
          </div>
          <div class="ws-edit-hint">The workspace's profile picture, saved as soon as you choose it. A square image works best — PNG, JPEG, WebP or GIF, up to 5 MB.</div>
          <input type="file" id="ws-logo-input" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" onchange="wsUploadLogo(this)">
        </div>
      </div>
      <div class="form-group" style="margin-top:16px">
        <label class="form-label" for="ws-name">Workspace name</label>
        <input class="form-control" id="ws-name" maxlength="60" value="${esc(d.name)}">
        <div class="ws-edit-hint">Shown in the sidebar and header of both portals, the team's sign-in page and the browser tab.</div>
      </div>
    </div>
    <div class="wsa-card">
      <h3>Wording</h3>
      <div class="wsa-hint" style="margin-bottom:12px">Change what the sign-in pages and the portals' headers say. Leave a line empty to keep the original.</div>
      ${fields}
    </div>`;
}

// A colour with a picker, its hex, and (when it can be left to the preset) a way back to "automatic".
function wsaColour(label, path, effective, { clearable = true } = {}) {
  const set = wsaGet(path);
  const shown = set || effective;
  return `<div class="wsa-colour">
    <label>${label}</label>
    <input type="color" class="wsa-pick" data-path="${path}" value="${esc(shown)}" aria-label="${esc(label)}">
    <input type="text" class="wsa-hexin" data-path="${path}" value="${esc(set || '')}" placeholder="${esc(effective)}" maxlength="7" spellcheck="false" aria-label="${esc(label)} as hex">
    ${clearable ? `<button class="wsa-x" type="button" data-act="clear" data-path="${path}" title="Back to the preset's colour" ${set ? '' : 'disabled'}>↺</button>` : ''}
  </div>`;
}

function wsaColoursHtml() {
  const T = wsaT(), d = _wsa.draft, n = wsaNorm(d);
  const dark = T.palette(n, 'dark'), light = T.palette(n, 'light');
  const gallery = T.PRESET_ORDER.map(id => {
    const P = T.PRESETS[id], pd = T.palette({ theme: { preset: id } }, 'dark'), pl = T.palette({ theme: { preset: id } }, 'light');
    const sw = (c, cls) => `<span class="wsa-sw ${cls}" style="background:${c.bg}"><i style="background:${c.panel}"></i><b style="background:${c.accent}"></b><u style="background:${c.sidebar}"></u></span>`;
    return `<button class="wsa-preset${d.theme.preset === id ? ' on' : ''}" type="button" data-act="preset" data-id="${id}" aria-pressed="${d.theme.preset === id}">
      <span class="wsa-sws">${sw(pd, 'd')}${sw(pl, 'l')}</span>
      <span class="wsa-pname">${esc(P.name)}</span><span class="wsa-pblurb">${esc(P.blurb || '')}</span>
    </button>`;
  }).join('');
  const am = _wsa.advMode, pal = am === 'dark' ? dark : light;
  const neutrals = WSA_NEUTRALS.map(([k, label]) => wsaColour(label, `theme.neutrals.${am}.${k}`, pal[k])).join('');
  const glow = d.theme.glow || T.PRESETS[d.theme.preset].glow;
  return `
    <div class="wsa-card">
      <h3>Preset</h3>
      <div class="wsa-gallery">${gallery}</div>
      <label class="wsa-check"><input type="checkbox" id="wsa-suggest" ${_wsa.suggest ? 'checked' : ''}> Also use the preset's suggested fonts, roundness and default mode</label>
    </div>
    <div class="wsa-card">
      <h3>Accent</h3>
      <div class="wsa-hint" style="margin-bottom:10px">The colour of buttons, the active item and highlights. Each mode gets the shade of it that reads: lighter on a dark page, deeper on a light one.</div>
      ${wsaColour('Accent', 'theme.accent', dark.accent)}
      ${wsaColour('Second colour', 'theme.accent2', dark.accent2)}
      <div class="wsa-row" style="margin-top:12px">
        <span class="wsa-lbl">Neon glow</span>
        <span class="wsa-seg" id="wsa-glow">${['off', 'subtle', 'strong'].map(g => `<button type="button" data-act="glow" data-id="${g}" class="${glow === g ? 'on' : ''}">${g[0].toUpperCase() + g.slice(1)}</button>`).join('')}</span>
      </div>
      <div class="wsa-hint">On the primary button, the active item and the focus ring.</div>
    </div>
    <details class="wsa-card wsa-adv" ${(d.theme.neutrals && Object.keys(d.theme.neutrals).length) ? 'open' : ''}>
      <summary><h3 style="display:inline">Advanced: backgrounds and text</h3></summary>
      <div class="wsa-hint" style="margin:8px 0 10px">Set any of these for a mode; the rest follow the preset. A pair nobody could read is refused when you save.</div>
      <span class="wsa-seg" id="wsa-adv-modes" style="margin-bottom:10px">
        <button type="button" data-act="advmode" data-id="dark" class="${am === 'dark' ? 'on' : ''}">Dark</button>
        <button type="button" data-act="advmode" data-id="light" class="${am === 'light' ? 'on' : ''}">Light</button>
      </span>
      ${neutrals}
    </details>`;
}

function wsaTypeHtml() {
  const T = wsaT(), d = _wsa.draft;
  const opts = (role, cur) => T.FONT_ORDER.filter(id => T.FONTS[id].roles.includes(role)).map(id => `<option value="${id}" ${cur === id ? 'selected' : ''}>${esc(T.FONTS[id].name)}</option>`).join('');
  const head = d.typography.heading || T.DEFAULT_FONTS.heading, body = d.typography.body || T.DEFAULT_FONTS.body;
  const radius = d.shape.radius !== undefined ? d.shape.radius : T.DEFAULT_SHAPE.radius;
  const density = d.shape.density !== undefined ? d.shape.density : T.DEFAULT_SHAPE.density;
  return `
    <div class="wsa-card">
      <h3>Fonts</h3>
      <div class="form-group"><label class="form-label" for="wsa-font-head">Headings</label>
        <select class="form-control" id="wsa-font-head" data-act-change="font" data-role="heading">${opts('head', head)}</select></div>
      <div class="form-group"><label class="form-label" for="wsa-font-body">Body text</label>
        <select class="form-control" id="wsa-font-body" data-act-change="font" data-role="body">${opts('body', body)}</select>
        <div class="wsa-hint">Cairo reads Arabic. Display faces such as Orbitron are for headings only.</div></div>
    </div>
    <div class="wsa-card">
      <h3>Shape</h3>
      <div class="wsa-row"><span class="wsa-lbl">Roundness</span>
        <input type="range" min="0" max="${WSA_RADIUS.length - 1}" step="1" value="${radius}" id="wsa-radius" class="wsa-range" aria-label="Roundness">
        <span class="wsa-val" id="wsa-radius-v">${WSA_RADIUS[radius]}</span></div>
      <div class="wsa-row"><span class="wsa-lbl">Density</span>
        <input type="range" min="0" max="${WSA_DENSITY.length - 1}" step="1" value="${density}" id="wsa-density" class="wsa-range" aria-label="Density">
        <span class="wsa-val" id="wsa-density-v">${WSA_DENSITY[density]}</span></div>
      <div class="wsa-hint">Roundness changes every corner at once; density changes the spacing of pages, cards and tables. Touch screens keep comfortable tap targets either way.</div>
    </div>`;
}

function wsaBehaviourHtml() {
  const T = wsaT(), d = _wsa.draft;
  const dm = d.theme.default_mode || T.PRESETS[d.theme.preset].mode;
  const exported = JSON.stringify(Object.assign({ format: 'motolinker-look', version: 1 }, wsaPayload()), null, 2);
  const safe = location.pathname.replace(/\/?$/, '') + '?safe=1';
  return `
    <div class="wsa-card">
      <h3>Dark or light</h3>
      <div class="wsa-radios" id="wsa-defmode">
        ${[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Follow the device']].map(([id, label]) => `<label class="wsa-radio"><input type="radio" name="wsa-defmode" value="${id}" ${dm === id ? 'checked' : ''}> ${label}</label>`).join('')}
      </div>
      <div class="wsa-hint">What a person sees until they choose for themselves.</div>
      <label class="wsa-check" style="margin-top:12px"><input type="checkbox" id="wsa-allow" ${d.theme.allow_user_mode === false ? '' : 'checked'}> Let people switch between dark and light for themselves (the sun / moon button in the header)</label>
    </div>
    <div class="wsa-card">
      <h3>Share or back up a look</h3>
      <textarea class="form-control wsa-json" id="wsa-json" rows="9" spellcheck="false">${esc(exported)}</textarea>
      <div class="wsa-row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
        <button class="btn btn-outline btn-sm" type="button" data-act="copy">Copy</button>
        <button class="btn btn-outline btn-sm" type="button" data-act="download">Download</button>
        <button class="btn btn-outline btn-sm" type="button" data-act="import">Load this text into the editor</button>
        <button class="btn btn-outline btn-sm" type="button" data-act="importfile">Load a file…</button>
        <input type="file" id="wsa-file" accept="application/json,.json" style="display:none">
      </div>
      <div class="wsa-hint">The text above is the look you are editing. Paste another in and load it; nothing changes for anyone until you save.</div>
    </div>
    <div class="wsa-card">
      <h3>If a look is ever hard to read</h3>
      <div class="wsa-hint" style="margin-bottom:10px">Add <code>?safe=1</code> to the address of a page and it opens in the original look whatever is saved, so you can always get back here.</div>
      <div class="wsa-row" style="gap:6px;flex-wrap:wrap">
        <a class="btn btn-outline btn-sm" href="${esc(safe)}#workspace" target="_blank" rel="noopener">Open this page in safe mode</a>
        <button class="btn btn-outline btn-sm" type="button" data-act="reset" style="color:var(--danger-text,var(--danger))">Put the original look back</button>
      </div>
    </div>`;
}

// ── The preview: a small app that wears the draft ────────────────────────────
function wsaPreviewHtml() {
  const name = esc(_wsa.draft.name || 'MotoLinker');
  const T = wsaT();
  const text = k => esc((_wsa.draft.texts[k] || T.TEXT_DEFAULTS[k]).replace(/\{ws\}/g, _wsa.draft.name || 'MotoLinker'));
  return `<div class="wsa-pv" id="wsa-pv-root">
    <div class="wsa-pv-app">
      <div class="wsa-pv-rail">
        <div class="wsa-pv-brand"><span class="wsa-pv-dot"></span><div><b>${name}</b><small>${text('admin_role')}</small></div></div>
        <div class="wsa-pv-search">Jump to…</div>
        <div class="wsa-pv-nav on"><i></i>Home</div>
        <div class="wsa-pv-nav"><i></i>Tasks</div>
        <div class="wsa-pv-nav"><i></i>Leads</div>
        <div class="wsa-pv-nav"><i></i>Reports</div>
      </div>
      <div class="wsa-pv-main">
        <div class="wsa-pv-top"><b>${name}</b><span class="wsa-pv-badge">${text('admin_badge')}</span></div>
        <div class="wsa-pv-title">Home</div>
        <div class="wsa-pv-stats">
          <div class="wsa-pv-stat"><em>12</em><span>Open tasks</span></div>
          <div class="wsa-pv-stat"><em>EGP 4.2M</em><span>Pipeline</span></div>
          <div class="wsa-pv-stat late"><em>2</em><span>Overdue</span></div>
        </div>
        <div class="wsa-pv-table">
          <div class="wsa-pv-row h"><span>Lead</span><span>Status</span><span>Budget</span></div>
          <div class="wsa-pv-row"><span>Sample customer</span><span class="wsa-pv-chip a">Quoted</span><span>EGP 300</span></div>
          <div class="wsa-pv-row"><span>Another lead</span><span class="wsa-pv-chip g">Won</span><span>EGP 200</span></div>
          <div class="wsa-pv-row"><span>Third lead</span><span class="wsa-pv-chip r">Lost</span><span>EGP 100</span></div>
        </div>
        <div class="wsa-pv-actions">
          <span class="wsa-pv-btn">Add lead</span><span class="wsa-pv-btn o">Export</span><span class="wsa-pv-input">Search…</span>
        </div>
      </div>
    </div>
    <div class="wsa-pv-auth">
      <div class="wsa-pv-card"><span class="wsa-pv-logo"></span><b>${text('admin_title')}</b><small>${text('admin_sub')}</small>
        <span class="wsa-pv-input">Username</span><span class="wsa-pv-btn full">Sign In</span></div>
      <div class="wsa-pv-card"><span class="wsa-pv-logo"></span><b>${text('team_title')}</b><small>${text('team_sub')}</small>
        <span class="wsa-pv-input">Your username</span><span class="wsa-pv-btn full">Sign In</span></div>
    </div>
  </div>`;
}

// Puts the draft's tokens on the preview (and its fonts), then repaints what depends on the draft.
function wsaPaint() {
  const T = wsaT();
  if (!_wsa) return;
  const n = wsaNorm(_wsa.draft);
  const pv = document.getElementById('wsa-pv-root');
  if (pv) {
    const vars = Object.assign({}, T.deriveVars(n, _wsa.pvMode), T.fontVars(n), T.shapeVars(n));
    pv.removeAttribute('style');
    for (const [k, v] of Object.entries(vars)) pv.style.setProperty(k, v);
    pv.style.setProperty('color-scheme', _wsa.pvMode);
    pv.setAttribute('data-pv-mode', _wsa.pvMode);
  }
  wsaFonts();
  // the guard: every reading pair, both modes
  const rows = T.report(n);
  const bad = rows.filter(r => r.level === 'error');
  const warn = rows.filter(r => r.level === 'warn');
  const box = document.getElementById('wsa-contrast');
  if (box) {
    box.innerHTML = `<h3>Readability</h3><div class="wsa-ct">${rows.map(r => `
      <div class="wsa-ct-row ${r.level}">
        <span class="wsa-ct-aa" style="background:${r.bg};color:${r.fg}">Aa</span>
        <span class="wsa-ct-l">${esc(r.label)} <small>${r.mode}</small></span>
        <span class="wsa-ct-r">${r.ratio.toFixed(1)}:1</span>
        <span class="wsa-ct-s">${r.level === 'error' ? 'Too faint' : r.level === 'warn' ? 'Low' : 'Good'}</span>
      </div>`).join('')}</div>
      <div class="wsa-hint">Accents and button text are adjusted for you in each mode; what can fall short is only the backgrounds and text you set yourself.</div>`;
  }
  const pb = document.getElementById('wsa-problems');
  if (pb) pb.innerHTML = bad.length
    ? `<div class="wsa-alert err"><b>This look can't be saved yet.</b> ${bad.slice(0, 3).map(r => esc(r.label + ' (' + r.mode + '): ' + r.ratio.toFixed(1) + ':1, needs ' + r.min + ':1')).join(' · ')}</div>`
    : warn.length ? `<div class="wsa-alert warn">${warn.slice(0, 2).map(r => esc(r.label + ' (' + r.mode + ') is a little low: ' + r.ratio.toFixed(1) + ':1')).join(' · ')}</div>` : '';
  const save = document.getElementById('ws-save-btn');
  if (save) { save.disabled = bad.length > 0; save.title = bad.length ? 'Fix the colours that are too faint first' : ''; }
  const dis = document.getElementById('wsa-discard-btn');
  if (dis) dis.disabled = !wsaDirty();
}

// The faces the draft names, loaded for the preview while this page is open.
function wsaFonts(off) {
  const T = wsaT();
  let link = document.getElementById('wsa-fonts');
  if (off || !_wsa) { if (link) link.remove(); return; }
  const href = T.fontsHref(wsaNorm(_wsa.draft));
  if (!link) { link = document.createElement('link'); link.id = 'wsa-fonts'; link.rel = 'stylesheet'; document.head.appendChild(link); }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

// ── The draft ────────────────────────────────────────────────────────────────
function wsaGet(path) { return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), _wsa.draft); }
function wsaSet(path, value) {
  const keys = path.split('.');
  let o = _wsa.draft;
  for (let i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  const last = keys[keys.length - 1];
  if (value === undefined || value === '') delete o[last]; else o[last] = value;
}
function wsaChanged() { wsaPaint(); }

// One listener for the whole page.
function wsaBind(root) {
  if (root._wsaBound) return;
  root._wsaBound = true;
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !_wsa) return;
    const act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    const T = wsaT(), d = _wsa.draft;
    if (act === 'tab') { wsaReadIdentity(); _wsa.tab = id; document.getElementById('wsa-tab').innerHTML = wsaTabHtml(); root.querySelectorAll('.wsa-tab').forEach(t => t.classList.toggle('on', t.getAttribute('data-id') === id)); if (typeof lucide !== 'undefined') lucide.createIcons(); }
    else if (act === 'preset') {
      // choosing a preset starts from it: its colours (not the old overrides), and, if asked, its type, shape, glow and mode
      const P = T.PRESETS[id];
      d.theme = { preset: id, allow_user_mode: d.theme.allow_user_mode };
      if (_wsa.suggest) { d.typography = { heading: P.font.heading, body: P.font.body }; d.shape = { radius: P.shape.radius, density: P.shape.density }; d.theme.glow = P.glow; d.theme.default_mode = P.mode; }
      document.getElementById('wsa-tab').innerHTML = wsaTabHtml(); wsaChanged();
    }
    else if (act === 'glow') { d.theme.glow = id; document.querySelectorAll('#wsa-glow button').forEach(x => x.classList.toggle('on', x.getAttribute('data-id') === id)); wsaChanged(); }
    else if (act === 'advmode') { _wsa.advMode = id; document.getElementById('wsa-tab').innerHTML = wsaTabHtml(); document.querySelector('.wsa-adv').open = true; }
    else if (act === 'pvmode') { _wsa.pvMode = id; document.querySelectorAll('#wsa-pv-modes button').forEach(x => x.classList.toggle('on', x.getAttribute('data-id') === id)); wsaPaint(); }
    else if (act === 'clear') { wsaSet(b.getAttribute('data-path'), undefined); document.getElementById('wsa-tab').innerHTML = wsaTabHtml(); wsaChanged(); }
    else if (act === 'save') wsaSave();
    else if (act === 'discard') { _wsa.draft = wsaClone(_wsa.saved); wsaRender(); }
    else if (act === 'try') wsaTry();
    else if (act === 'reset') wsaReset();
    else if (act === 'copy') { const t = document.getElementById('wsa-json'); try { navigator.clipboard.writeText(t.value); showAdminToast('Copied.'); } catch (_) { t.select(); } }
    else if (act === 'download') wsaDownload();
    else if (act === 'import') wsaImport(document.getElementById('wsa-json').value);
    else if (act === 'importfile') document.getElementById('wsa-file').click();
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if (!_wsa) return;
    if (t.matches('input.wsa-pick')) { const p = t.getAttribute('data-path'); wsaSet(p, wsaHex(t.value)); const hx = root.querySelector(`input.wsa-hexin[data-path="${p}"]`); if (hx) hx.value = t.value; root.querySelector(`.wsa-x[data-path="${p}"]`)?.removeAttribute('disabled'); wsaChanged(); }
    else if (t.matches('input.wsa-hexin')) {
      const p = t.getAttribute('data-path'), v = t.value.trim();
      if (v === '') { wsaSet(p, undefined); wsaChanged(); return; }
      const h = wsaHex(v.startsWith('#') ? v : '#' + v);
      t.classList.toggle('bad', !h);
      if (h) { wsaSet(p, h); const pk = root.querySelector(`input.wsa-pick[data-path="${p}"]`); if (pk) pk.value = h; root.querySelector(`.wsa-x[data-path="${p}"]`)?.removeAttribute('disabled'); wsaChanged(); }
    }
    else if (t.id === 'wsa-radius') { _wsa.draft.shape.radius = +t.value; document.getElementById('wsa-radius-v').textContent = WSA_RADIUS[+t.value]; wsaChanged(); }
    else if (t.id === 'wsa-density') { _wsa.draft.shape.density = +t.value; document.getElementById('wsa-density-v').textContent = WSA_DENSITY[+t.value]; wsaChanged(); }
    else if (t.matches('input.wsa-text')) { const k = t.getAttribute('data-text'), v = t.value.trim(); if (v) _wsa.draft.texts[k] = v; else delete _wsa.draft.texts[k]; document.getElementById('wsa-pv').innerHTML = wsaPreviewHtml(); wsaChanged(); }
    else if (t.id === 'ws-name') { _wsa.draft.name = t.value; document.getElementById('wsa-pv').innerHTML = wsaPreviewHtml(); wsaChanged(); }
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (!_wsa) return;
    if (t.matches('[data-act-change="font"]')) { _wsa.draft.typography[t.getAttribute('data-role')] = t.value; wsaChanged(); }
    else if (t.id === 'wsa-suggest') _wsa.suggest = t.checked;
    else if (t.name === 'wsa-defmode') { _wsa.draft.theme.default_mode = t.value; wsaChanged(); }
    else if (t.id === 'wsa-allow') { _wsa.draft.theme.allow_user_mode = t.checked; wsaChanged(); }
    else if (t.id === 'wsa-file') { const f = t.files && t.files[0]; t.value = ''; if (f) f.text().then(wsaImport); }
  });
}

// The inputs that did not get to say so (a field filled in without an input event) are read before anything is sent.
function wsaReadIdentity() {
  if (!_wsa) return;
  const name = document.getElementById('ws-name');
  if (name) _wsa.draft.name = name.value;
  document.querySelectorAll('input.wsa-text').forEach(i => { const k = i.getAttribute('data-text'), v = i.value.trim(); if (v) _wsa.draft.texts[k] = v; else delete _wsa.draft.texts[k]; });
}

// ── Saving ───────────────────────────────────────────────────────────────────
async function wsaSave() {
  if (!_wsa) return;
  wsaReadIdentity();
  const T = wsaT(), d = _wsa.draft;
  const name = (d.name || '').trim();
  if (!name) { showAdminToast('Give the workspace a name.'); return; }
  const body = wsaPayload();
  const { errors } = T.validate(body);
  if (errors.length) { showAdminToast(errors[0]); return; }
  const bad = T.report(T.normalize(body)).filter(r => r.level === 'error');
  if (bad.length) { showAdminToast('Fix the colours that are too faint first.'); return; }
  const btn = document.getElementById('ws-save-btn');
  if (btn) btn.disabled = true;
  try {
    let profile = null;
    if (name !== _wsa.saved.name) {
      const r = await apiFetch('/api/dashboard/workspace', { method: 'PUT', body: JSON.stringify({ name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showAdminToast(j.error || 'Could not rename the workspace.'); return; }
      profile = j; wsApply(j);
    }
    if (JSON.stringify(wsaNorm(_wsa.draft)) !== JSON.stringify(wsaNorm(_wsa.saved)) || !profile) {
      const r = await apiFetch('/api/dashboard/workspace/theme', { method: 'PUT', body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showAdminToast(j.error || 'Could not save the look.'); return; }
      profile = j; wsApply(j);
    }
    wsaTryStop(true);
    const f = wsaFromProfile(profile);
    _wsa.saved = wsaClone(f); _wsa.draft = f;
    showAdminToast('Saved. Everyone who has the portal open sees it now.');
    wsaRender();
  } catch (e) { showAdminToast('Could not save: ' + e.message); }
  finally { const b = document.getElementById('ws-save-btn'); if (b) b.disabled = false; wsaPaint(); }
}
// The old modal's "Save name", still what the tests and the keyboard shortcut call.
function wsSaveName() { return wsaSave(); }

async function wsaReset() {
  if (!confirm('Put the colours, fonts, shape and wording back to the original look? The name and picture stay.')) return;
  const r = await apiFetch('/api/dashboard/workspace/theme', { method: 'PUT', body: JSON.stringify({ reset: true }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { showAdminToast(j.error || 'Could not reset the look.'); return; }
  wsApply(j); wsaTryStop(true);
  const f = wsaFromProfile(j); _wsa.saved = wsaClone(f); _wsa.draft = f;
  showAdminToast('The original look is back.');
  wsaRender();
}

// ── The picture (saved as soon as it is chosen) ──────────────────────────────
async function wsUploadLogo(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type || '')) { showAdminToast('Choose a PNG, JPEG, WebP or GIF picture.'); return; }
  if (f.size > 5 * 1024 * 1024) { showAdminToast('The picture must be under 5 MB.'); return; }
  const pic = await chatSquarePicture(f, 512);
  const fd = new FormData();
  fd.append('file', pic.blob, pic.name);
  const r = await apiFetch('/api/dashboard/workspace/logo', { method: 'POST', body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { showAdminToast(d.error || 'Could not set the picture.'); return; }
  wsApply(d);
  showAdminToast('Workspace picture updated.');
  wsaRefreshPicture();
}
async function wsRemoveLogo() {
  const r = await apiFetch('/api/dashboard/workspace/logo', { method: 'DELETE' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { showAdminToast(d.error || 'Could not remove the picture.'); return; }
  wsApply(d);
  showAdminToast('Back to the default picture.');
  wsaRefreshPicture();
}
// Only the picture's own buttons change: the draft the admin is in the middle of stays as it is.
function wsaRefreshPicture() {
  if (!_wsa || _wsa.tab !== 'identity' || !document.getElementById('wsa-tab')) return;
  wsaReadIdentity();
  document.getElementById('wsa-tab').innerHTML = wsaTabHtml();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Try it on this page ──────────────────────────────────────────────────────
function wsaTry() {
  const T = wsaT();
  wsaReadIdentity();
  const n = wsaNorm(_wsa.draft);
  wsaTryStop(false);
  const st = document.createElement('style');
  st.id = 'ws-theme-draft';
  st.textContent = T.renderThemeCss(n);
  const base = document.getElementById('ws-theme');
  if (base && base.nextSibling) base.parentNode.insertBefore(st, base.nextSibling); else document.head.appendChild(st);
  const link = document.querySelector('link[href^="https://fonts.googleapis.com/css2?"]:not(#wsa-fonts)');
  const own = link ? link.getAttribute('href') : null, tried = T.fontsHref(n);
  if (link) link.setAttribute('href', tried);
  let left = 60;
  const bar = document.createElement('div');
  bar.id = 'wsa-try-bar';
  bar.innerHTML = `<span><b>Trying your look</b> on this page — <span id="wsa-try-left">60</span>s</span>
    <button class="btn btn-primary btn-sm" type="button" id="wsa-try-keep">Keep it</button>
    <button class="btn btn-outline btn-sm" type="button" id="wsa-try-drop">Put it back</button>`;
  document.body.appendChild(bar);
  const timer = setInterval(() => { left--; const e = document.getElementById('wsa-try-left'); if (e) e.textContent = left; if (left <= 0) wsaTryStop(false); }, 1000);
  _wsa.trying = { st, bar, timer, link, own, tried };
  document.getElementById('wsa-try-keep').onclick = () => wsaSave();
  document.getElementById('wsa-try-drop').onclick = () => wsaTryStop(false);
}
// (A try that ends in a save has already had the saved look's faces put on the page by the save;
// only one that is dropped hands the page its old faces back — and only if nothing else has
// changed them since, a save from another admin's tab, say.)
function wsaTryStop(afterSave) {
  const t = _wsa && _wsa.trying;
  if (!t) return;
  clearInterval(t.timer);
  t.st.remove(); t.bar.remove();
  if (!afterSave && t.link && t.own && t.link.getAttribute('href') === t.tried) t.link.setAttribute('href', t.own);
  _wsa.trying = null;
}

// ── Sharing a look ───────────────────────────────────────────────────────────
function wsaDownload() {
  const text = document.getElementById('wsa-json').value;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = 'motolinker-look.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function wsaImport(text) {
  let j;
  try { j = JSON.parse(text); } catch (_) { showAdminToast('That is not valid JSON.'); return; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) { showAdminToast('That is not a look.'); return; }
  const pick = {};
  for (const k of ['theme', 'typography', 'shape', 'texts']) if (j[k] !== undefined) pick[k] = j[k];
  if (!Object.keys(pick).length) { showAdminToast('That file has no look in it.'); return; }
  const { value, errors } = wsaT().validate(pick);
  if (errors.length) { showAdminToast('Not loaded: ' + errors[0]); return; }
  // (a section the file does not have stays as the editor has it)
  const d = _wsa.draft, take = k => (pick[k] !== undefined ? wsaClone(value[k]) : d[k]);
  _wsa.draft = { name: d.name, theme: take('theme'), typography: take('typography'), shape: take('shape'), texts: take('texts') };
  showAdminToast('Loaded into the editor. Save to apply it.');
  wsaRender();
}
