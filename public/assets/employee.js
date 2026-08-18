let empToken  = localStorage.getItem('ml_emp_token');
let empInfo   = null;
let taskMode  = 'select';
let myTasks   = [];
let myHours   = [];
let totalHrs  = 0;
let activeTab = 'current';

/* ── API helper ── */

/* One gate in front of every Google-connect navigation. These are top-level
   browser navigations carrying the session in the query string — if the session
   died (server restart), the browser used to render the raw {"error":
   "Unauthorized"} body. Ping the session first; ef() bounces a dead one to
   login, and we only navigate when the server still knows us. */
async function empConnectNav(url) {
  try {
    const r = await ef('/api/employee/check');
    if (!r.ok) return;   // ef() already sent the user to the login screen
  } catch (_) { showToast('Cannot reach the server — try again in a moment.'); return; }
  window.location.href = url + (url.includes('?') ? '&' : '?') + '_t=' + encodeURIComponent(empToken || '');
}

async function ef(path, opts = {}) {
  const h = { ...(opts.headers || {}) };
  // FormData sets its own multipart boundary; forcing JSON here would corrupt it.
  if (!(opts.body instanceof FormData)) h['Content-Type'] = h['Content-Type'] || 'application/json';
  if (empToken) h['Authorization'] = 'Bearer ' + empToken;
  const r = await fetch(path, { ...opts, headers: h });
  // A server restart wipes the in-memory session while localStorage keeps the
  // token. Without this, every 401 body was parsed as data and each page invented
  // its own wrong explanation ("not configured", "contact your admin") instead of
  // sending the user back to log in.
  if (r.status === 401 && empToken) {
    localStorage.removeItem('ml_emp_token');
    empToken = null;
    showLogin();
  }
  return r;
}

/* ── Auth ── */
async function submitLogin() {
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('auth-err');
  err.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/api/employee/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: document.getElementById('login-user').value.trim(), password: document.getElementById('login-pass').value }),
    });
    const d = await r.json();
    if (d.error) { err.textContent = d.error; err.style.display = 'block'; return; }
    empToken = d.token; empInfo = d;
    localStorage.setItem('ml_emp_token', empToken);
    showApp();
  } catch (e) { err.textContent = 'Connection error'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Sign In'; }
}

async function checkAuth() {
  if (!empToken) return showLogin();
  try {
    const r = await ef('/api/employee/check');
    if (!r.ok) { localStorage.removeItem('ml_emp_token'); empToken = null; return showLogin(); }
    empInfo = await r.json();
    showApp();
  } catch { showLogin(); }
}

function showLogin() {
  document.getElementById('auth-wrap').style.display = 'flex';
  document.getElementById('layout').style.display = 'none';
}

// Sections the admin can switch on or off. One entry per nav item that has a
// master permission — the ones missing from this list (Home, Notifications, Help)
// are the ones nobody should ever be locked out of.
//
// `log` and `hours` are two nav items over one section: filing your own hours and
// reading the team's log are separate actions, so they map to hours.log and
// hours.view rather than to a master switch each.
const PERM_SECTIONS = [
  'requests', 'tasks', 'hours',
  'drive', 'sheets', 'email', 'calendar', 'meet', 'gchat',
  'chat', 'quotation', 'leads', 'deals', 'reports', 'issues',
  'suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions',
];
// Nav items whose visibility is an action rather than a whole section.
// stock is the same story: every employee has the section (the vehicle picker
// needs it), but the Inventory page is stock.browse.
const PERM_NAV_ACTIONS = { log: ['hours', 'log'], hours: ['hours', 'view'], stock: ['stock', 'browse'] };

// Normalized permissions of the logged-in employee (rich shape from the server).
let empPerms = {};
// Can the employee perform <action> in <section>? Master on AND the action allowed.
function empCan(section, action) {
  const p = empPerms || {};
  // Mirrors the server: the Issues centre is the CTO's by job title, permission or
  // not, so the nav must agree with what /api/employee/issues will actually answer.
  if (section === 'issues' && isCtoUser()) return true;
  if (p[section] !== true) return false;
  const a = p[section + 'Actions'];
  // No actions object means a permission shape from before this section had
  // actions. The server's normEmpPerms reads that as "master on ⇒ every action",
  // and the client has to agree or the portal hides buttons the endpoint would
  // happily serve. The one exception is the same one the server carves out.
  if (!a) return !PERM_LEGACY_OFF.includes(section + '.' + action);
  return a[action] === true;
}
// Actions a master switch must never imply — mirrors PERM_LEGACY on the server.
const PERM_LEGACY_OFF = ['requests.viewAll', 'leads.clientFolder', 'stock.browse'];
// Whether a whole section is on, honouring the same CTO rule.
function empHas(section) {
  return section === 'issues' ? (empPerms.issues === true || isCtoUser()) : empPerms[section] === true;
}
// Hide any element tagged data-perm="section.action" the employee can't do.
function applyActionPerms() {
  document.querySelectorAll('[data-perm]').forEach(el => {
    const [section, action] = (el.dataset.perm || '').split('.');
    el.style.display = empCan(section, action) ? '' : 'none';
  });
}
// The client-side defaults have to match DEFAULT_PERMISSIONS on the server, or a
// section is shown here and refused there — or worse, hidden here while the
// endpoint happily answers. The server normalizes every login response, so this
// only covers a cached shape from before a section existed.
const PERM_DEFAULTS = {
  requests:true, tasks:true, hours:true, availability:true,
  drive:true, sheets:true, calendar:true, meet:true, email:false, gchat:false,
  chat:true, stock:true, quotation:false, leads:false, deals:false, reports:false, issues:false,
  suppliers:false, rfq:false, purchaseorders:false, contracts:false, submissions:false,
};
function applyPermissions(permissions) {
  const p = { ...PERM_DEFAULTS, ...(permissions || {}) };
  empPerms = p;
  const show = (id, on) => {
    const navEl  = document.getElementById('nav-' + id);
    const bnavEl = document.getElementById('bnav-' + id);
    const pageEl = document.getElementById('page-' + id);
    if (navEl)  navEl.style.display  = on ? '' : 'none';
    if (bnavEl) bnavEl.style.display = on ? '' : 'none';
    if (pageEl) pageEl.dataset.permitted = on ? '1' : '0';
  };
  PERM_SECTIONS.forEach(section => show(section, empHas(section)));
  // Nav items that are an action rather than a section of their own.
  for (const [id, [section, action]] of Object.entries(PERM_NAV_ACTIONS)) show(id, empCan(section, action));
  applyActionPerms();
  // A group heading with nothing under it is a dead label, so each one follows its
  // own items rather than being hardcoded on.
  const groupOn = (sel, on) => {
    const el = typeof sel === 'string' ? document.getElementById(sel) : sel;
    if (!el) return;
    el.style.display = on ? '' : 'none';
    if (on) el.closest('.nav-group')?.classList.add('open');
  };
  groupOn('nav-label-tools', empHas('quotation'));
  groupOn('nav-label-crm', empHas('leads') || empHas('deals') || empHas('reports'));
  groupOn('nav-label-ops', ['suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions'].some(empHas)
    || empCan('stock', 'browse'));
  // Google and Chat groups have no id, so they are found by their data-group.
  const anyGoogle = ['drive', 'sheets', 'email', 'calendar', 'meet', 'gchat'].some(empHas);
  const gGoogle = document.querySelector('.nav-group[data-group="google"]');
  if (gGoogle) gGoogle.style.display = anyGoogle ? '' : 'none';
  const gChat = document.querySelector('.nav-group[data-group="chat"]');
  if (gChat) gChat.style.display = empHas('chat') ? '' : 'none';
  // Reports is only reachable if at least one individual report is granted
  gchatInitNav();   // Google Chat nav appears only when it's configured server-side
  loadNavConfig();  // apply the admin's shared section order + names
  const anyReport = empCan('reports', 'leads') || empCan('reports', 'sales');
  const repNav = document.getElementById('nav-reports');
  const repPage = document.getElementById('page-reports');
  if (repNav) repNav.style.display = anyReport ? '' : 'none';
  if (repPage) repPage.dataset.permitted = anyReport ? '1' : '0';
}

/* ── Issues center (CTO only) ── */
let _issues = [];
function isCtoUser() { return /chief technical officer/i.test(empInfo?.job_title || ''); }

async function loadIssues() {
  const list = document.getElementById('issues-list');
  list.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
  try {
    const r = await ef('/api/employee/issues');
    const d = await r.json();
    if (!r.ok) { list.innerHTML = `<div class="empty">${esc(d.error || 'Not permitted')}</div>`; return; }
    _issues = d;
    renderIssues();
  } catch (e) { list.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
}

function renderIssues() {
  const list = document.getElementById('issues-list');
  if (!list) return;
  const filter = document.getElementById('issues-filter')?.value || '';
  const rows = filter ? _issues.filter(i => i.status === filter) : _issues;
  if (!rows.length) { list.innerHTML = '<div class="empty">No issues here — all clear! 🎉</div>'; return; }
  list.innerHTML = rows.map(i => {
    const open = i.status !== 'resolved';
    return `<div class="card" style="margin-bottom:12px;padding:16px 18px;${open ? '' : 'opacity:.65'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:14px;font-weight:700">${esc(i.title || 'System issue')}</span>
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${open ? 'rgba(201,125,110,.15)' : 'rgba(138,154,134,.15)'};color:${open ? 'var(--danger)' : 'var(--success)'}">${open ? 'OPEN' : 'RESOLVED'}</span>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-top:3px">Reported by <strong>${esc(i.reporter_name || '—')}</strong> · ${new Date(i.created_at).toLocaleString()}</div>
          ${i.description ? `<div style="font-size:13px;margin-top:8px;white-space:pre-wrap;word-break:break-word">${esc(i.description)}</div>` : ''}
          ${i.file_url ? `<a href="${esc(i.file_url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--primary);margin-top:8px;text-decoration:none"><i data-lucide="paperclip" style="width:12px;height:12px"></i> View attachment</a>` : ''}
        </div>
        <button class="btn btn-sm ${open ? 'btn-primary' : 'btn-outline'}" onclick="toggleIssueStatus(${i.id}, '${open ? 'resolved' : 'open'}')">${open ? 'Mark Resolved' : 'Reopen'}</button>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => lucide.createIcons());
}

async function toggleIssueStatus(id, status) {
  try {
    const r = await ef(`/api/employee/issues/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    const d = await r.json();
    if (!r.ok || d.error) return showToast(d.error || 'Failed');
    const idx = _issues.findIndex(i => i.id === id);
    if (idx >= 0) _issues[idx] = d;
    renderIssues();
  } catch (e) { showToast('Error: ' + e.message); }
}

/* ── Profile: avatar, status, username ── */
function renderProfile() {
  // Issues is the CTO's by title or anyone's by permission; empHas knows both.
  // renderProfile runs after the profile loads, which is when job_title arrives.
  const issuesNav = document.getElementById('nav-issues');
  if (issuesNav) issuesNav.style.display = empHas('issues') ? '' : 'none';
  const name = empInfo?.name || empInfo?.username || '?';
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.firstChild.textContent = name + ' ';
  const av = document.getElementById('user-avatar');
  if (av) {
    if (empInfo?.avatar_url) av.innerHTML = `<img src="${esc(empInfo.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    else av.textContent = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }
  const role = document.getElementById('user-role');
  if (role) role.textContent = empInfo?.job_title || 'Employee';
  const st = document.getElementById('user-status');
  if (st) {
    const has = empInfo?.status_text || empInfo?.status_emoji;
    st.textContent = has ? `${empInfo.status_emoji || ''} ${empInfo.status_text || ''}`.trim() : '＋ Set status';
    st.style.color = has ? 'var(--primary)' : 'var(--muted)';
  }
}

async function uploadAvatar(input) {
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) return showToast('Please choose an image');
  if (f.size > 5 * 1024 * 1024) return showToast('Image must be under 5 MB');
  const fd = new FormData();
  fd.append('file', f);
  try {
    const r = await fetch('/api/employee/avatar', { method: 'POST', headers: { Authorization: 'Bearer ' + empToken }, body: fd });
    const d = await r.json();
    if (d.error) return showToast('Upload failed: ' + d.error);
    empInfo.avatar_url = d.avatar_url;
    renderProfile();
    showToast('Profile picture updated');
  } catch (e) { showToast('Upload failed: ' + e.message); }
}

function openStatusModal() {
  document.getElementById('st-emoji').value = empInfo?.status_emoji || '';
  document.getElementById('st-text').value = empInfo?.status_text || '';
  document.getElementById('status-modal').style.display = 'flex';
}
function stPreset(emoji, text) {
  document.getElementById('st-emoji').value = emoji;
  document.getElementById('st-text').value = text;
}
async function saveStatus(clear) {
  const emoji = clear ? '' : document.getElementById('st-emoji').value.trim();
  const text  = clear ? '' : document.getElementById('st-text').value.trim();
  try {
    const r = await ef('/api/employee/status', { method: 'PUT', body: JSON.stringify({ emoji, text }) });
    const d = await r.json();
    if (d.error) return showToast(d.error);
    empInfo.status_emoji = d.status_emoji; empInfo.status_text = d.status_text;
    renderProfile();
    document.getElementById('status-modal').style.display = 'none';
    showToast(clear ? 'Status cleared' : 'Status updated');
  } catch (e) { showToast('Error: ' + e.message); }
}

function openUsernameModal() {
  document.getElementById('un-input').value = empInfo?.username || '';
  document.getElementById('un-err').style.display = 'none';
  document.getElementById('username-modal').style.display = 'flex';
}
async function saveUsername() {
  const username = document.getElementById('un-input').value.trim();
  const err = document.getElementById('un-err');
  try {
    const r = await ef('/api/employee/username', { method: 'PUT', body: JSON.stringify({ username }) });
    const d = await r.json();
    if (!r.ok || d.error) { err.textContent = d.error || 'Failed'; err.style.display = 'block'; return; }
    empInfo.username = d.username;
    document.getElementById('username-modal').style.display = 'none';
    showToast('Username changed to ' + d.username);
  } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
}

/* ── Report an Issue ── */
function openIssueModal() {
  document.getElementById('iss-title').value = '';
  document.getElementById('iss-desc').value = '';
  document.getElementById('iss-file').value = '';
  issFileHint(document.getElementById('iss-file'));
  document.getElementById('issue-modal').style.display = 'flex';
}
function issFileHint(input) {
  const f = input.files?.[0];
  const t = document.getElementById('iss-file-text');
  if (!t) return;
  if (f) { t.textContent = f.name + ' · ' + (f.size / 1024 / 1024).toFixed(1) + ' MB'; t.style.color = 'var(--text)'; }
  else { t.textContent = 'Click to attach a screenshot or file'; t.style.color = 'var(--muted)'; }
}
async function submitIssue() {
  const title = document.getElementById('iss-title').value.trim();
  const desc  = document.getElementById('iss-desc').value.trim();
  const file  = document.getElementById('iss-file').files?.[0];
  if (!title && !desc) return showToast('Please describe the issue');
  if (file && file.size > 10 * 1024 * 1024) return showToast('File must be under 10 MB');
  const btn = document.getElementById('iss-submit');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', desc);
    if (file) fd.append('file', file);
    const r = await fetch('/api/employee/report-issue', { method: 'POST', headers: { Authorization: 'Bearer ' + empToken }, body: fd });
    const d = await r.json();
    if (!r.ok || d.error) return showToast('Error: ' + (d.error || r.status));
    document.getElementById('issue-modal').style.display = 'none';
    showToast('Ticket sent to the CTO — thank you!');
  } catch (e) { showToast('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Submit Ticket'; }
}

/* ── Task comments (with @mentions) ── */
let _empcTaskId = null, _coworkers = null, _empcKind = 'task';
function _empcBase() { return _empcKind === 'request' ? 'requests' : 'tasks'; }
async function loadCoworkers() {
  if (_coworkers) return;
  try { _coworkers = await ef('/api/employee/coworkers').then(r => r.json()); } catch (_) { _coworkers = []; }
}
async function openEmpTaskComments(id) {
  _empcKind = 'task'; _empcTaskId = id;
  await loadCoworkers();
  const t = (myTasks || []).find(x => x.id === id);
  document.getElementById('empc-title').textContent = 'Comments — ' + (t ? t.title : '#' + id);
  document.getElementById('empc-list').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  document.getElementById('empc-input').value = '';
  empcRemoveAttach();
  document.getElementById('emp-comments-modal').style.display = 'flex';
  empcLoad();
}
async function openEmpReqComments(id) {
  _empcKind = 'request'; _empcTaskId = id;
  await loadCoworkers();
  const r = (_myRequests || []).find(x => x.id === id);
  document.getElementById('empc-title').textContent = 'Comments — ' + (r ? r.title : '#' + id);
  document.getElementById('empc-list').innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  document.getElementById('empc-input').value = '';
  empcRemoveAttach();
  document.getElementById('emp-comments-modal').style.display = 'flex';
  empcLoad();
}
async function empcLoad() {
  const rows = await ef(`/api/employee/${_empcBase()}/${_empcTaskId}/comments`).then(r => r.json()).catch(() => []);
  const list = document.getElementById('empc-list');
  list.innerHTML = (Array.isArray(rows) && rows.length) ? rows.map(c => `
    <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:8px 12px">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);margin-bottom:3px"><strong style="color:var(--text)">${esc(c.author_name || '—')}</strong><span>${new Date(c.created_at).toLocaleString()}</span></div>
      ${c.body ? `<div style="font-size:13px;white-space:pre-wrap;word-break:break-word">${empcRenderBody(c.body)}</div>` : ''}
      ${commentAttachHtml(c)}${googleUnfurl(c.body)}
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px;text-align:center;padding:14px">No comments yet — be the first.</div>';
  list.scrollTop = list.scrollHeight;
}
function commentAttachHtml(c) {
  if (!c.file_url) return '';
  const u = esc(c.file_url), t = c.file_type || '';
  if (t.startsWith('image/')) return `<img src="${u}" class="chat-img-thumb" onclick="window.open('${u}','_blank')" loading="lazy">`;
  if (t.startsWith('audio/')) return `<div class="chat-voice-msg"><audio controls src="${u}" preload="none"></audio></div>`;
  return `<div class="chat-file-attach"><i data-lucide="paperclip" style="width:13px;height:13px"></i> <a href="${u}" target="_blank" rel="noopener">${esc(c.file_name || 'File')}</a><span style="color:var(--muted);margin-left:auto">${c.file_size ? (c.file_size / 1024 / 1024).toFixed(1) + 'MB' : ''}</span></div>`;
}
// Turn any Google Drive/Docs/Sheets/Slides links in the text into rich preview cards.
function googleUnfurl(text) {
  const matches = String(text || '').match(/https?:\/\/(?:docs|drive)\.google\.com\/[^\s<>"')]+/g) || [];
  const seen = new Set(); let out = '';
  for (const url of matches) { if (seen.has(url)) continue; seen.add(url); out += gLinkCard(url); }
  return out;
}
function gLinkCard(url) {
  let kind = '', id = '', m;
  if ((m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/))) { kind = 'sheet'; id = m[1]; }
  else if ((m = url.match(/document\/d\/([a-zA-Z0-9_-]+)/))) { kind = 'doc'; id = m[1]; }
  else if ((m = url.match(/presentation\/d\/([a-zA-Z0-9_-]+)/))) { kind = 'slides'; id = m[1]; }
  else if ((m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/))) { kind = 'file'; id = m[1]; }
  else if ((m = url.match(/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/))) { kind = 'folder'; id = m[1]; }
  else return '';
  const meta = { sheet:{label:'Google Sheets',color:'#0f9d58',glyph:'table'}, doc:{label:'Google Docs',color:'#4285f4',glyph:'file-text'}, slides:{label:'Google Slides',color:'#f4b400',glyph:'presentation'}, file:{label:'Google Drive file',color:'#5f6368',glyph:'file'}, folder:{label:'Drive folder',color:'#5f6368',glyph:'folder'} }[kind];
  const u = esc(url);
  const thumb = kind !== 'folder' ? `<img class="gcard-thumb" src="https://drive.google.com/thumbnail?id=${esc(id)}&sz=w400" onerror="this.style.display='none'" loading="lazy">` : '';
  return `<a class="gcard" href="${u}" target="_blank" rel="noopener"><span class="gcard-badge" style="background:${meta.color}"><i data-lucide="${meta.glyph}" style="width:14px;height:14px"></i></span><span class="gcard-meta"><span class="gcard-title">${meta.label}</span><span class="gcard-sub">Google · click to open</span></span><span class="gcard-open">Open ↗</span>${thumb}</a>`;
}
function empcRenderBody(b) {
  let h = esc(b || '');
  (_coworkers || []).forEach(e => {
    if (e.name) h = h.split('@' + esc(e.name)).join(`<span style="color:var(--primary);font-weight:700">@${esc(e.name)}</span>`);
  });
  return h;
}
function empcMentionHint(ta) {
  const box = document.getElementById('empc-mention-box');
  const m = ta.value.slice(0, ta.selectionStart).match(/@([a-zA-Z ]{0,30})$/);
  if (!m) { box.style.display = 'none'; return; }
  const q = m[1].toLowerCase();
  const hits = (_coworkers || []).filter(e => (e.name || '').toLowerCase().startsWith(q)).slice(0, 6);
  if (!hits.length) { box.style.display = 'none'; return; }
  box.innerHTML = hits.map(e => `<button type="button" onclick="empcInsertMention('${esc(e.name)}')" style="display:block;width:100%;text-align:left;background:none;border:none;color:var(--text);font-size:12.5px;padding:7px 10px;border-radius:6px;cursor:pointer" onmouseover="this.style.background='rgba(255,255,255,.06)'" onmouseout="this.style.background='none'">@ ${esc(e.name)}</button>`).join('');
  box.style.display = 'block';
}
function empcInsertMention(name) {
  const ta = document.getElementById('empc-input');
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos).replace(/@[a-zA-Z ]{0,30}$/, '@' + name + ' ') + ta.value.slice(pos);
  document.getElementById('empc-mention-box').style.display = 'none';
  ta.focus();
}
let empcPendingFile = null;
async function empcFileSelected(input) {
  const file = input.files?.[0]; if (!file) return; input.value = '';
  if (file.size > 10 * 1024 * 1024) return showToast('File must be under 10 MB');
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/employee/chat/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + empToken }, body: fd });
    const d = await r.json();
    if (!r.ok || d.error) return showToast('Upload failed: ' + (d.error || r.status));
    empcPendingFile = d;
    document.getElementById('empc-attach-name').textContent = d.name;
    document.getElementById('empc-attach-preview').style.display = 'flex';
  } catch (e) { showToast('Upload failed: ' + e.message); }
}
function empcRemoveAttach() {
  empcPendingFile = null;
  const p = document.getElementById('empc-attach-preview');
  if (p) p.style.display = 'none';
}
async function empcPost() {
  const ta = document.getElementById('empc-input');
  const body = ta.value.trim();
  if (!body && !empcPendingFile) return;
  const payload = { body };
  if (empcPendingFile) { payload.file_url = empcPendingFile.url; payload.file_name = empcPendingFile.name; payload.file_size = empcPendingFile.size; payload.file_type = empcPendingFile.type; }
  const r = await ef(`/api/employee/${_empcBase()}/${_empcTaskId}/comments`, { method: 'POST', body: JSON.stringify(payload) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return showToast('Error: ' + (e.error || r.status)); }
  ta.value = ''; empcRemoveAttach();
  empcLoad();
}

async function showApp() {
  document.getElementById('auth-wrap').style.display = 'none';
  document.getElementById('layout').style.display = 'flex';
  renderProfile();
  document.getElementById('h-date').value = new Date().toISOString().split('T')[0];
  initSidebarState();
  applyPermissions(empInfo?.permissions);
  startPresenceHeartbeat();
  // Re-subscribe push so authenticated POST reaches the server after login
  if (_swReg) chatSubscribePush(_swReg);
  else navigator.serviceWorker?.ready.then(reg => chatSubscribePush(reg)).catch(() => {});
  // Notification center: load history + open persistent stream
  loadNotifs();
  openNotifStream();
  // After applyPermissions(), so a gated section falls back instead of erroring
  // A huddle that was running when this page last unloaded is still running;
  // offer it back rather than leaving people to guess.
  if (typeof hdBootLive === 'function') hdBootLive();
  navigate(lastPage('home'));
  await Promise.all([loadDropdownTasks(), loadMyTasks(), loadMyHours()]);
  requestAnimationFrame(() => lucide.createIcons());
}

async function logout() {
  closeChatSse();
  closeNotifStream();
  try { await ef('/api/employee/logout', { method: 'POST' }); } catch (_) {}
  localStorage.removeItem('ml_emp_token'); empToken = null; showLogin();
}

/* ── Navigation ── */
const pageTitles = { home: 'Home', chat: 'Chat', log: 'Log Hours', tasks: 'My Tasks', hours: 'Hours Log', requests: 'Requests', drive: 'My Drive', sheets: 'My Sheets', email: 'My Email', quotation: 'Quotation', calendar: 'Calendar', meet: 'Meet', leads: 'Leads', deals: 'Deals', reports: 'Reports', gchat: 'Google Chat', notif: 'Notifications', issues: 'Issues',
  suppliers: 'Suppliers', rfq: 'RFQ', purchaseorders: 'Purchase Orders',
  contracts: 'Contracts', submissions: 'Website Submissions', stock: 'Inventory' };
const pageLoaders = { calendar: () => loadCalendar(), home: loadHome, requests: loadMyRequests, drive: loadDrive, sheets: loadSheets, email: loadEmail, quotation: () => initQuotationPage(), leads: loadEmpLeads, deals: loadEmpDeals, reports: loadEmpReports, gchat: loadGChat, notif: loadNotifPage, issues: loadIssues,
  // Operations: the renderers live in the shared procurement.js, which both
  // portals load, so these are the same functions the dashboard calls.
  suppliers: () => loadSuppliers(), rfq: () => loadRfqs(), purchaseorders: () => loadPurchaseOrders(),
  contracts: () => loadContracts(), submissions: () => loadSubmissions(), meet: () => loadMeetings(),
  stock: () => loadStock() };
let _currentEmpPage = 'log';
function navigate(page) {
  if (_currentEmpPage === 'chat' && page !== 'chat') closeChatSse();
  if (_currentEmpPage === 'gchat' && page !== 'gchat') gchatStopPoll();
  _currentEmpPage = page;
  // Block navigation to sections the employee doesn't have permission for.
  // Home, not Log Hours: Log Hours is itself gated now (hours.log), so bouncing
  // there called navigate again, which bounced again — a stack overflow the
  // moment an employee without it opened any other forbidden page. Home is the
  // one page nobody can be locked out of, which is what makes it a safe floor.
  const pageEl = document.getElementById('page-' + page);
  if (pageEl && pageEl.dataset.permitted === '0' && page !== 'home') return navigate('home');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  (pageEl || document.getElementById('page-log')).classList.add('active');
  const sideNav = document.getElementById('nav-' + page);
  if (sideNav) sideNav.classList.add('active');
  openGroupForPage(page); // reveal the group containing the active item
  const bottomNav = document.getElementById('bnav-' + page);
  if (bottomNav) bottomNav.classList.add('active');
  document.getElementById('topbar-title').textContent = pageTitles[page] || 'MotoLinker';
  rememberPage(page);
  if (pageLoaders[page]) pageLoaders[page]();
  if (page === 'hours' && typeof renderAvailabilityBoard === 'function') renderAvailabilityBoard('availability-board');
  closeSidebar();
  // Re-init lucide icons after content change
  requestAnimationFrame(() => lucide.createIcons());
}

// Startup already read location.hash, but nothing ever wrote it — so a refresh
// always found it empty and fell back to the default page. replaceState rather
// than pushState, or Back turns into a crawl through every section visited.
function rememberPage(page) {
  try {
    history.replaceState(null, '', '#' + page);
    localStorage.setItem('ml_emp_page', page);
  } catch (_) { /* private mode; the hash alone still works */ }
}
function lastPage(fallback) {
  const hash = (location.hash || '').replace('#', '');
  const ok = p => p && pageTitles[p] &&
    (document.getElementById('page-' + p) || {}).dataset?.permitted !== '0';
  if (ok(hash)) return hash;
  let saved = null;
  try { saved = localStorage.getItem('ml_emp_page'); } catch (_) {}
  return ok(saved) ? saved : fallback;
}

/* ── Mobile Sidebar ── */
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const isOpen = sb.classList.toggle('open');
  ov.classList.toggle('visible', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
  document.body.style.overflow = '';
}

/* ── Sidebar collapse (rail) + collapsible section groups ── */
function toggleSidebarCollapse() {
  const collapsed = document.getElementById('sidebar').classList.toggle('collapsed');
  try { localStorage.setItem('ml_emp_sidebar', collapsed ? 'collapsed' : 'expanded'); } catch (_) {}
}
function toggleNavGroup(head) {
  const group = head.closest('.nav-group');
  if (!group) return;
  group.classList.toggle('open');
  try {
    const open = [...document.querySelectorAll('.nav-group.open')].map(g => g.dataset.group);
    localStorage.setItem('ml_emp_navgroups', JSON.stringify(open));
  } catch (_) {}
}
function openGroupForPage(page) {
  const nav = document.getElementById('nav-' + page);
  const group = nav && nav.closest('.nav-group');
  if (group) group.classList.add('open');
}
function initSidebarState() {
  const sb = document.getElementById('sidebar');
  try { if (localStorage.getItem('ml_emp_sidebar') === 'collapsed') sb.classList.add('collapsed'); } catch (_) {}
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('ml_emp_navgroups') || 'null'); } catch (_) {}
  const groups = [...document.querySelectorAll('.nav-group')];
  if (Array.isArray(saved)) groups.forEach(g => g.classList.toggle('open', saved.includes(g.dataset.group)));
  else openGroupForPage(_currentEmpPage); // default: only active section open
}

/* ── Task mode toggle ── */
function setTaskMode(mode) {
  taskMode = mode;
  document.getElementById('toggle-select').classList.toggle('active', mode === 'select');
  document.getElementById('toggle-type').classList.toggle('active', mode === 'type');
  document.getElementById('task-select-wrap').style.display = mode === 'select' ? '' : 'none';
  document.getElementById('task-type-wrap').style.display   = mode === 'type'   ? '' : 'none';
}

/* ── Tab switch (My Tasks) ── */
function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tab-current').classList.toggle('active', tab === 'current');
  document.getElementById('tab-completed').classList.toggle('active', tab === 'completed');
  renderTasksList();
}

/* ── Load dropdown tasks ── */
async function loadDropdownTasks() {
  try {
    const r = await ef('/api/employee/tasks');
    const tasks = await r.json();
    const sel = document.getElementById('h-task-select');
    sel.innerHTML = '<option value="">— No specific task —</option>' +
      tasks.map(t => `<option value="${t.id}">[${t.status.replace('_',' ')}] #${t.id} — ${t.title.substring(0,60)}${t.title.length>60?'…':''}</option>`).join('');
  } catch (e) { console.error('loadDropdownTasks:', e); }
}

/* ── Load My Tasks ── */
async function loadMyTasks() {
  document.getElementById('tasks-container').innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  try {
    const r = await ef('/api/employee/my-tasks');
    myTasks = await r.json();
    renderTasksStats();
    renderTasksList();
  } catch (e) {
    document.getElementById('tasks-container').innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
  loadEmpCalendar();   // shows the 'add tasks to my calendar' control
}

function renderTasksStats() {
  const current   = myTasks.filter(t => t.status !== 'done');
  const completed = myTasks.filter(t => t.status === 'done');
  const overdue   = current.filter(t => t.due_date < new Date().toISOString().split('T')[0]);
  document.getElementById('tasks-stats').innerHTML = `
    <div class="stat-box"><div class="stat-val" style="color:var(--info)">${myTasks.length}</div><div class="stat-lbl">Total Tasks</div></div>
    <div class="stat-box"><div class="stat-val" style="color:var(--warning)">${current.length}</div><div class="stat-lbl">Active</div></div>
    <div class="stat-box"><div class="stat-val" style="color:var(--success)">${completed.length}</div><div class="stat-lbl">Completed</div></div>
    <div class="stat-box"><div class="stat-val" style="color:var(--danger)">${overdue.length}</div><div class="stat-lbl">Overdue</div></div>`;
}

function priorityIcon(p) {
  const icons = { high:'<i data-lucide="circle-alert" style="width:12px;height:12px;color:var(--danger)"></i>', medium:'<i data-lucide="circle-minus" style="width:12px;height:12px;color:var(--warning)"></i>', low:'<i data-lucide="circle-check" style="width:12px;height:12px;color:var(--success)"></i>' };
  return icons[p] || '<i data-lucide="circle" style="width:12px;height:12px;color:var(--muted)"></i>';
}

function renderTasksList() {
  const today = new Date().toISOString().split('T')[0];
  const list  = activeTab === 'current'
    ? myTasks.filter(t => t.status !== 'done')
    : myTasks.filter(t => t.status === 'done');

  const c = document.getElementById('tasks-container');
  if (!list.length) {
    c.innerHTML = `<div class="empty">${activeTab === 'current' ? 'No active tasks — all caught up!' : 'No completed tasks yet.'}</div>`;
    return;
  }

  c.innerHTML = list.map(t => {
    const isOverdue = t.due_date < today && t.status !== 'done';
    const completedDate = t.completed_at
      ? `<span class="complete-date"><i data-lucide="check-circle-2" style="width:12px;height:12px"></i> Completed ${new Date(t.completed_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</span>` : '';
    return `<div class="task-item" id="task-item-${t.id}">
      <div class="task-dot ${t.status}"></div>
      <div class="task-info">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div class="task-name${t.status==='done'?' done':''}">${t.title}</div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-outline btn-sm" onclick="openEmpTaskComments(${t.id})" title="Comments"><i data-lucide="message-square" style="width:14px;height:14px"></i></button>
            ${activeTab === 'current' ? `<button class="btn btn-primary btn-sm" onclick="markTaskDone(${t.id})"><i data-lucide="check" style="width:14px;height:14px"></i> Done</button>` : ''}
          </div>
        </div>
        ${t.description ? `<div class="task-desc" id="task-desc-${t.id}">${esc(t.description)}</div>
          <button class="task-desc-more" onclick="empTaskDescToggle(${t.id})">Show more</button>` : ''}
        <div class="task-meta">
          <span>${t.channel_name}</span>
          <span>Due ${t.due_date}</span>
          ${isOverdue ? '<span class="overdue-tag"><i data-lucide="alert-triangle" style="width:11px;height:11px"></i> Overdue</span>' : ''}
          ${completedDate}
        </div>
        <div class="task-badges">
          <span class="badge badge-${t.status}">${t.status.replace('_',' ')}</span>
          <span class="badge badge-${t.priority}">${priorityIcon(t.priority)} ${t.priority}</span>
          ${t.milestone ? `<span class="badge" style="background:rgba(96,165,250,.08);color:var(--info)"><i data-lucide="flag" style="width:10px;height:10px"></i> ${t.milestone}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => {
    lucide.createIcons();
    // Only offer "Show more" where the text is actually clipped.
    document.querySelectorAll('.task-desc').forEach(el => {
      const more = el.nextElementSibling;
      if (more && more.classList.contains('task-desc-more') && el.scrollHeight <= el.clientHeight + 2) more.remove();
    });
  });
}
// The brief the task was created with — the team could not read it at all: the
// card showed the title, the due date and the badges, and dropped the body.
function empTaskDescToggle(id) {
  const el = document.getElementById('task-desc-' + id);
  if (!el) return;
  const open = el.classList.toggle('open');
  const btn = el.nextElementSibling;
  if (btn && btn.classList.contains('task-desc-more')) btn.textContent = open ? 'Show less' : 'Show more';
}

/* ── Log Hours ── */
async function logHours() {
  const btn  = document.getElementById('log-btn');
  const succ = document.getElementById('log-success');
  succ.style.display = 'none';
  const hours    = document.getElementById('h-hours').value;
  const date     = document.getElementById('h-date').value;
  const note     = document.getElementById('h-note').value.trim();
  const taskId   = taskMode === 'select' ? document.getElementById('h-task-select').value : '';
  const taskText = taskMode === 'type'   ? document.getElementById('h-task-text').value.trim() : '';

  if (!hours || parseFloat(hours) <= 0) { alert('Please enter valid hours'); return; }
  if (!date) { alert('Please select a date'); return; }
  if (taskMode === 'type' && !taskText) { alert('Please type a task name'); return; }

  btn.disabled = true; btn.textContent = 'Logging…';
  try {
    const body = { hours, log_date: date, description: note };
    if (taskId)   body.task_id          = parseInt(taskId);
    if (taskText) body.task_description = taskText;
    const r = await ef('/api/employee/hours', { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) { alert('Error: ' + d.error); return; }
    document.getElementById('h-hours').value = '';
    document.getElementById('h-note').value  = '';
    document.getElementById('h-task-text').value = '';
    document.getElementById('h-task-select').value = '';
    succ.style.display = 'block';
    setTimeout(() => { succ.style.display = 'none'; }, 4000);
    await loadMyHours(); // refresh hours log + badge
  } catch (e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Log Hours'; }
}

/* ── Load My Hours ── */
async function loadMyHours() {
  const c = document.getElementById('hours-table-container');
  try {
    const r = await ef('/api/employee/hours');
    myHours = await r.json();
    totalHrs = myHours.reduce((s, h) => s + parseFloat(h.hours || 0), 0);

    // Update persistent badge
    document.getElementById('total-hours-badge').innerHTML = `<i data-lucide="timer" style="width:15px;height:15px"></i> ${totalHrs.toFixed(1)}h logged`;
    lucide.createIcons({nodes: [document.getElementById('total-hours-badge')]});

    // Stats
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
    const thisWeek = myHours.filter(h => (h.log_date||'') >= weekAgo).reduce((s,h) => s+parseFloat(h.hours||0), 0);
    document.getElementById('hours-stats').innerHTML = `
      <div class="stat-box"><div class="stat-val" style="color:var(--primary)">${totalHrs.toFixed(1)}h</div><div class="stat-lbl">Total Logged</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--info)">${myHours.length}</div><div class="stat-lbl">Entries</div></div>
      <div class="stat-box"><div class="stat-val" style="color:var(--success)">${thisWeek.toFixed(1)}h</div><div class="stat-lbl">This Week</div></div>`;

    if (!myHours.length) { c.innerHTML = '<div class="empty">No hours logged yet.</div>'; return; }
    c.innerHTML = `<div class="table-scroll"><table>
      <thead><tr><th>Date</th><th>Task</th><th>Hours</th><th>Notes</th></tr></thead>
      <tbody>${myHours.map(h => {
        const taskName = h.tasks?.title || h.task_description || '—';
        const channel  = h.tasks?.channel_name ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">${h.tasks.channel_name}</div>` : '';
        return `<tr>
          <td style="white-space:nowrap;color:var(--muted);font-size:12px">${h.log_date || new Date(h.logged_at).toLocaleDateString()}</td>
          <td><div>${taskName}</div>${channel}</td>
          <td><strong style="color:var(--primary)">${parseFloat(h.hours).toFixed(1)}h</strong></td>
          <td style="font-size:12px;color:var(--muted)">${h.description || '—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  } catch (e) { c.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

/* ── New Task Modal ── */
async function openNewTaskModal() {
  document.getElementById('nt-title').value     = '';
  document.getElementById('nt-desc').value      = '';
  document.getElementById('nt-milestone').value = '';
  document.getElementById('nt-due').value       = '';
  document.getElementById('nt-priority').value  = 'medium';
  document.getElementById('task-modal-err').style.display = 'none';
  document.getElementById('task-modal-overlay').style.display = 'flex';
}

function closeTaskModal() {
  document.getElementById('task-modal-overlay').style.display = 'none';
}

async function submitNewTask() {
  const btn = document.getElementById('nt-submit-btn');
  const err = document.getElementById('task-modal-err');
  err.style.display = 'none';
  const title    = document.getElementById('nt-title').value.trim();
  const due_date = document.getElementById('nt-due').value;
  if (!title)    { err.textContent = 'Title is required'; err.style.display = 'block'; return; }
  if (!due_date) { err.textContent = 'Due date is required'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const r = await ef('/api/employee/my-tasks', { method: 'POST', body: JSON.stringify({
      title,
      description: document.getElementById('nt-desc').value.trim(),
      due_date,
      priority:  document.getElementById('nt-priority').value,
      milestone: document.getElementById('nt-milestone').value.trim(),
    })});
    const d = await r.json();
    if (d.error) { err.textContent = d.error; err.style.display = 'block'; return; }
    closeTaskModal();
    await loadMyTasks();
    await loadDropdownTasks();
  } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Create Task'; }
}

/* ── Mark task done ── */
async function markTaskDone(taskId) {
  const btn = document.querySelector(`#task-item-${taskId} button`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await ef(`/api/employee/my-tasks/${taskId}`, { method: 'PUT' });
    const d = await r.json();
    if (d.error) { alert('Error: ' + d.error); if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px"></i> Done'; lucide.createIcons({nodes:[btn]}); } return; }
    await loadMyTasks();     // refresh task list + stats
    await loadDropdownTasks(); // remove from log hours dropdown
  } catch (e) { alert('Error: ' + e.message); if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px"></i> Done'; lucide.createIcons({nodes:[btn]}); } }
}

/* ── Requests ── */
const reqStatusLabel = { pending: 'Pending', in_review: 'In Review', approved: 'Approved', rejected: 'Rejected' };
const reqStatusClass = { pending: 'badge-todo', in_review: 'badge-in_progress', approved: 'badge-done', rejected: 'badge-high' };
const reqPriorityClass = { low: 'badge-low', medium: 'badge-medium', high: 'badge-high' };

let _myRequests = [];
function reqPartyName(usernameOrNull, assigneeId) {
  // creator side (username) vs assignee side (id) resolved via _coworkers
  if (assigneeId != null) {
    if (String(assigneeId) === String(empInfo?.id)) return 'You';
    const e = (_coworkers || []).find(x => String(x.id) === String(assigneeId));
    return e ? e.name : 'Admin';
  }
  if (!usernameOrNull || usernameOrNull === 'dashboard') return 'Admin';
  if (usernameOrNull === empInfo?.username) return 'You';
  const e = (_coworkers || []).find(x => x.username === usernameOrNull);
  return e ? e.name : usernameOrNull;
}

async function loadMyRequests() {
  const list = document.getElementById('my-requests-list');
  if (!list) return;
  list.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
  const canViewAll = empInfo?.permissions?.viewAllRequests === true;
  const badge = document.getElementById('req-scope-badge');
  if (badge) badge.style.display = canViewAll ? '' : 'none';
  await loadCoworkers();
  // Populate the "Send to" picker (colleagues, excluding self)
  const pick = document.getElementById('req-assignee');
  if (pick && pick.options.length <= 1) {
    pick.innerHTML = '<option value="">— Admin —</option>' +
      (_coworkers || []).filter(e => String(e.id) !== String(empInfo?.id)).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    if (pick._bTrigger) enhanceBrandSelects?.(); // resync brand dropdown label if present
  }
  try {
    _myRequests = await ef('/api/employee/requests').then(r => r.json());
    if (!_myRequests.length) {
      list.innerHTML = '<div class="empty" style="padding:32px">No requests yet — submit your first one above.</div>';
      return;
    }
    list.innerHTML = `<table>
      <thead><tr>
        <th>Title</th><th>Category</th><th>Priority</th><th>Status</th><th>From → To</th>
        <th>Submitted</th><th></th>
      </tr></thead>
      <tbody>${_myRequests.map(r => {
        const from = reqPartyName(r.created_by, null);
        const to = reqPartyName(null, r.assignee_id);
        return `<tr>
        <td style="max-width:220px">
          <div style="font-weight:500;font-size:13px">${esc(r.title)}</div>
          ${r.description ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${esc(r.description)}</div>` : ''}
        </td>
        <td><span style="font-size:12px;color:var(--muted)">${esc(r.category||'—')}</span></td>
        <td><span class="badge ${reqPriorityClass[r.priority]||'badge-medium'}">${r.priority||'medium'}</span></td>
        <td><span class="badge ${reqStatusClass[r.status]||'badge-todo'}">${reqStatusLabel[r.status]||r.status}</span></td>
        <td style="font-size:12px;color:var(--muted);white-space:nowrap">${esc(from)} <span style="color:var(--primary)">→</span> ${esc(to)}</td>
        <td style="font-size:12px;color:var(--muted);white-space:nowrap">${new Date(r.created_at).toLocaleDateString()}</td>
        <td><button class="btn btn-outline btn-sm" onclick="openEmpReqComments(${r.id})" title="Comments"><i data-lucide="message-square" style="width:14px;height:14px"></i></button></td>
      </tr>`; }).join('')}
      </tbody>
    </table>`;
    requestAnimationFrame(() => lucide.createIcons());
  } catch (e) { list.innerHTML = `<div style="padding:20px;color:var(--danger);font-size:13px">${esc(e.message)}</div>`; }
}

async function submitRequest() {
  const btn   = document.getElementById('req-submit-btn');
  const title = document.getElementById('req-title').value.trim();
  const desc  = document.getElementById('req-description').value.trim();
  const cat   = document.getElementById('req-category').value;
  const prio  = document.getElementById('req-priority').value;
  const assignee = document.getElementById('req-assignee')?.value || null;
  if (!title) { document.getElementById('req-title').focus(); return; }
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const r = await ef('/api/employee/requests', { method: 'POST', body: JSON.stringify({ title, description: desc, category: cat, priority: prio, assignee_id: assignee }) });
    const d = await r.json();
    if (d.error) { alert('Error: ' + d.error); return; }
    document.getElementById('req-title').value = '';
    document.getElementById('req-description').value = '';
    document.getElementById('req-category').value = '';
    document.getElementById('req-priority').value = 'medium';
    if (document.getElementById('req-assignee')) document.getElementById('req-assignee').value = '';
    const success = document.getElementById('req-success');
    success.style.display = 'block';
    setTimeout(() => success.style.display = 'none', 3000);
    loadMyRequests();
  } catch (e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Submit Request'; }
}

/* ── Drive / Sheets ── */
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function driveIcon(m) {
  if (!m) return '<i data-lucide="paperclip" style="width:16px;height:16px;vertical-align:middle"></i>';
  if (m === 'application/vnd.google-apps.folder') return '<i data-lucide="folder" style="width:16px;height:16px;vertical-align:middle"></i>';
  if (m === 'application/vnd.google-apps.spreadsheet') return '<i data-lucide="sheet" style="width:16px;height:16px;vertical-align:middle;color:var(--success)"></i>';
  if (m === 'application/vnd.google-apps.document') return '<i data-lucide="file-text" style="width:16px;height:16px;vertical-align:middle;color:var(--info)"></i>';
  if (m === 'application/vnd.google-apps.presentation') return '<i data-lucide="presentation" style="width:16px;height:16px;vertical-align:middle;color:var(--warning)"></i>';
  if (m === 'application/pdf') return '<i data-lucide="file-type" style="width:16px;height:16px;vertical-align:middle;color:var(--danger)"></i>';
  if (m.startsWith('image/')) return '<i data-lucide="image" style="width:16px;height:16px;vertical-align:middle;color:var(--primary)"></i>';
  if (m.startsWith('video/')) return '<i data-lucide="video" style="width:16px;height:16px;vertical-align:middle;color:var(--warning)"></i>';
  return '<i data-lucide="paperclip" style="width:16px;height:16px;vertical-align:middle"></i>';
}

async function loadDriveSection(statusUrl, filesUrl, connectUrl, disconnectUrl, contentId, title, icon) {
  const c = document.getElementById(contentId);
  c.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
  try {
    const status = await ef(statusUrl).then(r => r.json());
    if (!status.configured) {
      c.innerHTML = `<div style="text-align:center;padding:60px 20px">
        <div style="font-size:40px;margin-bottom:12px">${icon}</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px">${title}</div>
        <div style="font-size:13px;color:var(--muted)">Google Drive integration not configured. Contact your admin.</div>
      </div>`; return;
    }
    if (!status.connected) {
      c.innerHTML = `<div style="text-align:center;padding:60px 20px">
        <div style="font-size:40px;margin-bottom:12px">${icon}</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px">${title}</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:20px">Connect your Google account to access your files.</div>
        <a href="#" onclick="empConnectNav('${connectUrl}');return false" class="btn btn-primary" style="text-decoration:none">Connect Google Drive</a>
      </div>`; return;
    }
    const files = await ef(filesUrl).then(r => r.json());
    _driveViewFiles = files;
    c.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff">${esc(status.name?.[0]||'?')}</div>
          <div><div style="font-weight:600;font-size:14px">${esc(status.name)}</div><div style="font-size:12px;color:var(--muted)">${esc(status.email)}</div></div>
        </div>
        <button class="btn btn-outline" style="font-size:12px" onclick="disconnectDrive('${disconnectUrl}','${contentId}','${title}','${icon}')">Disconnect</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:14px;font-weight:600">${icon} ${title}</span>
          <span style="font-size:12px;color:var(--muted)">${files.length} file${files.length!==1?'s':''}</span>
        </div>
        ${files.length ? `<div class="table-scroll"><table class="wide-table wide-table-sm" style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="padding:9px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Name</th>
            <th style="padding:9px 16px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border)">Modified</th>
            <th style="padding:9px 16px;border-bottom:1px solid var(--border)"></th>
          </tr></thead>
          <tbody>${files.map((f, i) => `<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
            <td style="padding:11px 16px;font-size:13px">${driveIcon(f.mimeType)} ${esc(f.name)}</td>
            <td style="padding:11px 16px;font-size:12px;color:var(--muted);white-space:nowrap">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—'}</td>
            <td style="padding:11px 16px;text-align:right;white-space:nowrap">
              <button onclick="openDriveViewer(${i})" class="btn btn-primary" style="font-size:11px;padding:4px 10px;margin-right:5px">View</button>
              ${f.webViewLink ? `<a href="${esc(f.webViewLink)}" target="_blank" rel="noopener" class="btn btn-outline" style="font-size:11px;padding:4px 10px;text-decoration:none">Open ↗</a>` : ''}
            </td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No files found</div>'}
      </div>`;
    requestAnimationFrame(() => lucide.createIcons());
  } catch (e) { c.innerHTML = `<div style="padding:20px;color:var(--danger);font-size:13px">${esc(e.message)}</div>`; }
}

async function disconnectDrive(url, contentId, title, icon) {
  await ef(url, { method: 'POST' });
  const c = document.getElementById(contentId);
  c.innerHTML = '';
  const isSheets = contentId === 'sheets-content';
  loadDriveSection(
    '/api/employee/drive/status',
    isSheets ? '/api/employee/drive/sheets' : '/api/employee/drive/files',
    '/api/employee/drive/connect', url, contentId, title, icon
  );
}

function loadDrive()  { loadDriveSection('/api/employee/drive/status', '/api/employee/drive/files',  '/api/employee/drive/connect', '/api/employee/drive/disconnect', 'drive-content',  'My Drive',  '<i data-lucide="hard-drive" style="width:20px;height:20px"></i>'); }
function loadSheets() { loadDriveSection('/api/employee/drive/status', '/api/employee/drive/sheets', '/api/employee/drive/connect', '/api/employee/drive/disconnect', 'sheets-content', 'My Sheets', '<i data-lucide="table" style="width:20px;height:20px"></i>'); }

let _driveViewFiles = [];
function driveEmbedUrl(f) {
  if (!f?.id) return '';
  if (f.mimeType === 'application/vnd.google-apps.spreadsheet')  return `https://docs.google.com/spreadsheets/d/${f.id}/preview`;
  if (f.mimeType === 'application/vnd.google-apps.document')     return `https://docs.google.com/document/d/${f.id}/preview`;
  if (f.mimeType === 'application/vnd.google-apps.presentation') return `https://docs.google.com/presentation/d/${f.id}/preview`;
  return `https://drive.google.com/file/d/${f.id}/preview`;
}
function openDriveViewer(idx) {
  const f = _driveViewFiles[idx];
  if (!f) return;
  const url = driveEmbedUrl(f);
  if (!url) return;
  document.getElementById('drive-viewer-title').textContent = f.name;
  document.getElementById('drive-viewer-frame').src = url;
  document.getElementById('drive-viewer-ext-link').href = f.webViewLink || '#';
  document.getElementById('drive-viewer-overlay').style.display = 'flex';
}
function closeDriveViewer() {
  document.getElementById('drive-viewer-overlay').style.display = 'none';
  document.getElementById('drive-viewer-frame').src = 'about:blank';
}

/* ── CRM: Leads (actionable) ── */
const EMP_LEAD_STATUS_LABELS = { cold:'Cold', warm:'Warm', hot:'Hot', immediate_delivery:'Immediate Delivery', not_interested:'Not Interested', blacklist:'Blacklist' };
const EMP_LEAD_STATUS_BG     = { cold:'rgba(255,255,255,.06)', warm:'rgba(230,150,80,.18)', hot:'rgba(239,68,68,.14)', immediate_delivery:'rgba(100,180,120,.14)', not_interested:'rgba(150,150,150,.1)', blacklist:'rgba(120,0,0,.35)' };
const EMP_LEAD_STATUS_FG     = { cold:'#b9b3a4', warm:'#e6a850', hot:'#f87171', immediate_delivery:'#6dd8a4', not_interested:'#888', blacklist:'#f87171' };
const EMP_ORIGIN_LABELS      = { fb_ad:'FB Ad.', whatsapp:'Whatsapp', messenger:'Messenger', direct_call:'Direct Call', ig_ads:'IG ads', website:'Website', walk_in:'Walk-in', marketplace:'Marketplace' };
const EMP_NEXT_ACTION_LABELS = { followed_by_sales:'Followed By Sales', need_follow_up:'Need Follow Up', closed:'Closed', no_answer:'No Answer' };
const EMP_LEAD_STATUS_OPTS   = [['cold','Cold'],['warm','Warm'],['hot','Hot'],['immediate_delivery','Immediate Delivery'],['not_interested','Not Interested'],['blacklist','Blacklist']];
let _empLeads = [];
let _empLeadOptions = [];   // slim list for the deal modal's lead picker
let _empCoworkers = null;
// Sort state (persisted): { key, dir:'asc'|'desc' }
let _leadSort = (() => { try { return JSON.parse(localStorage.getItem('ml_emp_leads_sort')) || { key: null, dir: 'asc' }; } catch (_) { return { key: null, dir: 'asc' }; } })();

async function loadEmpCoworkers() { if (_empCoworkers) return _empCoworkers; try { _empCoworkers = await ef('/api/employee/coworkers').then(r => r.json()); } catch (_) { _empCoworkers = []; } return _empCoworkers; }
function empEmpName(id) { return (_empCoworkers || []).find(e => String(e.id) === String(id))?.name || ''; }
// Budget: accept a number or a range → {min,max}; render as a range.
function empBudgetPart(s) { s = String(s == null ? '' : s).trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '').replace(/egp|le|£|\$/g, ''); if (!s) return null; let mult = 1; if (/[km]$/.test(s)) { mult = s.endsWith('m') ? 1e6 : 1e3; s = s.slice(0, -1); } const n = parseFloat(s); return isFinite(n) ? Math.round(n * mult) : null; }
function empParseBudget(raw) { const str = String(raw == null ? '' : raw).trim(); if (!str) return { min: null, max: null }; const parts = str.split(/\s*(?:-|–|—|to|:|\/)\s*/i).map(p => p.trim()).filter(Boolean); if (parts.length >= 2) { let a = empBudgetPart(parts[0]), b = empBudgetPart(parts[parts.length - 1]); if (a != null && b != null && a > b) { const t = a; a = b; b = t; } return { min: a != null ? a : b, max: (a != null && b != null) ? b : null }; } return { min: empBudgetPart(str), max: null }; }
function empFmtBudget(min, max) { const f = n => Number(n).toLocaleString(); if (min != null && min !== '' && max != null && max !== '') return f(min) + ' – ' + f(max) + ' EGP'; if (min != null && min !== '') return f(min) + ' EGP'; return '—'; }

async function loadEmpLeads() {
  const ps = document.getElementById('leads-pagesize'); if (ps) ps.value = String(leadsPageSize());
  const tbody = document.getElementById('emp-leads-tbody');
  try {
    await loadLeadCols();
    renderLeadHead();
    await loadEmpCoworkers();
    const [leads, followups] = await Promise.all([
      ef('/api/employee/leads').then(r => r.json()),
      ef('/api/employee/followups/pending').then(r => r.json()).catch(() => []),
    ]);
    if (leads.error) throw new Error(leads.error);
    _empLeads = leads;
    _pendingFollowups = {};
    (Array.isArray(followups) ? followups : []).forEach(f => { if (!_pendingFollowups[f.customer_id]) _pendingFollowups[f.customer_id] = f.due_at; });
    empFilterLeads();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="20" style="text-align:center;color:var(--danger);padding:24px">${esc(e.message)}</td></tr>`;
  }
}

// ── Sort by any column ────────────────────────────────────────────────────────
function leadSortValue(c, col) {
  const key = col.key;
  if (key === 'next_followup') { const d = _pendingFollowups[c.id]; return d ? new Date(d).getTime() : null; }
  if (key === 'owner') { if (!c.assigned_to) return null; return (empEmpName(c.assigned_to) || ('#' + c.assigned_to)) || null; }
  if (key === 'budget_lead') { const n = Number(c.budget_lead); return c.budget_lead != null && c.budget_lead !== '' && isFinite(n) ? n : null; }
  const raw = col.builtin ? c[key] : (c.custom_fields || {})[key];
  if (key === 'lead_date' || col.type === 'date') { if (!raw) return null; const t = new Date(raw).getTime(); return isNaN(t) ? null : t; }
  if (col.type === 'checkbox') return isChecked(raw) ? 1 : 0;
  if (col.type === 'select' || col.type === 'radio') { const m = colOptMap(col); const k = normKey(raw, m); return (m[k] || raw || '') || null; }
  if (col.type === 'number') { const n = Number(raw); return raw != null && raw !== '' && isFinite(n) ? n : null; }
  const s = (raw == null ? '' : String(raw)).trim();
  return s || null;
}
function applyLeadSort(list) {
  if (!_leadSort || !_leadSort.key) return list;
  const col = leadCol(_leadSort.key);
  if (!col || col.deleted || col.visible === false) return list; // don't sort by a hidden/removed column
  const dir = _leadSort.dir === 'desc' ? -1 : 1;
  const isEmpty = v => v === null || v === undefined || v === '';
  return [...list].sort((a, b) => {
    const va = leadSortValue(a, col), vb = leadSortValue(b, col);
    const ea = isEmpty(va), eb = isEmpty(vb);
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    let r;
    if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
    else r = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    return r * dir;
  });
}
function setLeadSort(key, dir) {
  closeLeadMenu();
  _leadSort = key ? { key, dir: dir || 'asc' } : { key: null, dir: 'asc' };
  try { localStorage.setItem('ml_emp_leads_sort', JSON.stringify(_leadSort)); } catch (_) {}
  renderLeadHead();
  empFilterLeads();
}
// Header click cycles the column: asc → desc → cleared.
function toggleLeadSort(key) {
  if (!_leadSort || _leadSort.key !== key) return setLeadSort(key, 'asc');
  if (_leadSort.dir === 'asc') return setLeadSort(key, 'desc');
  return setLeadSort(null);
}
function leadHeaderClick(e, key) {
  if (_leadColDidDrag) { _leadColDidDrag = false; return; }
  toggleLeadSort(key);
}
function leadSortArrow(key) {
  if (!_leadSort || _leadSort.key !== key) return '';
  return `<span class="lead-sort-arrow" style="color:var(--primary);margin-left:3px;font-size:10px">${_leadSort.dir === 'desc' ? '▼' : '▲'}</span>`;
}

// Filter engine shared with the admin dashboard — public/assets/lead-filters.js.
// Only the portal-specific bindings live here.
lfInit({
  storageKey: 'ml_emp_lead_filters',      // separate from the admin's saved filters
  chipsId: 'emp-lead-filter-chips',
  inputClass: 'form-control',
  inputIds: ['emp-lead-search', 'emp-lead-date-from', 'emp-lead-date-to'],
  owners: () => _empCoworkers,
  apply: () => empFilterLeads(),
  showPicker: body => {
    document.getElementById('emp-lf-body').innerHTML = body;
    document.getElementById('emp-lead-filter-modal').style.display = 'flex';
  },
  hidePicker: () => { document.getElementById('emp-lead-filter-modal').style.display = 'none'; },
  warn: msg => showToast(msg),
});

function empFilterLeads() {
  _leadsShown = leadsPageSize();            // a new result set starts from the top
  const q = (document.getElementById('emp-lead-search')?.value || '').toLowerCase();
  const from = document.getElementById('emp-lead-date-from')?.value || '';
  const to   = document.getElementById('emp-lead-date-to')?.value || '';
  let list = _empLeads;
  if (q) list = list.filter(c => (c.name||'').toLowerCase().includes(q) || (c.phone||'').includes(q) || (c.car_in_question||'').toLowerCase().includes(q));
  if (from) list = list.filter(c => c.lead_date && c.lead_date >= from);
  if (to)   list = list.filter(c => c.lead_date && c.lead_date <= to);
  empRenderLeads(applyLeadSort(lfApply(list)));
}

let _lastRenderedLeads = []; // filtered+sorted list currently on screen (feeds Export)

// Plain-text value of a lead cell (mirrors leadCellHtml display rules).
function leadCellText(c, col) {
  const raw = col.builtin ? c[col.key] : (c.custom_fields || {})[col.key];
  if (col.key === 'next_followup') { const d = _pendingFollowups[c.id]; return d ? new Date(d).toLocaleString() : ''; }
  if (col.key === 'owner') { return c.assigned_to ? (empEmpName(c.assigned_to) || ('#' + c.assigned_to)) : ''; }
  if (col.key === 'budget_lead') { return c.budget_lead != null && c.budget_lead !== '' ? (c.budget_max ? `${c.budget_lead} - ${c.budget_max}` : String(c.budget_lead)) : ''; }
  if (col.type === 'checkbox') return isChecked(raw) ? 'Yes' : 'No';
  if (col.type === 'select' || col.type === 'radio') { const m = colOptMap(col); const k = normKey(raw, m); return m[k] || (raw == null ? '' : String(raw)); }
  return raw == null ? '' : String(raw);
}
// Export the table exactly as shown: visible columns only, current search + sort.
function exportLeadsTable() {
  const vis = visibleLeadCols();
  const list = _lastRenderedLeads || [];
  if (!list.length) { showToast('No leads to export.'); return; }
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [vis.map(c => cell(c.label)).join(',')];
  for (const c of list) lines.push(vis.map(col => cell(leadCellText(c, col))).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }); // BOM: Arabic-safe in Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `motolinker-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// Only the rendering is capped; filters and sort still see every lead. See the same
// note in dashboard.js — a full list is thousands of controls, and far worse as cards.
const LEADS_PAGE = 50;
// The user picks the page size (25/50/100/500/1000) and it sticks per browser.
// Search, filters, sort and export still run over EVERY lead — the choice caps
// rendering only, so nothing else changes with it.
function leadsPageSize() {
  const n = parseInt(localStorage.getItem('ml_emp_leads_pagesize'));
  return [25, 50, 100, 500, 1000].includes(n) ? n : LEADS_PAGE;
}
function setLeadsPageSize(v) {
  try { localStorage.setItem('ml_emp_leads_pagesize', String(parseInt(v) || LEADS_PAGE)); } catch (_) {}
  _leadsShown = leadsPageSize();
  empRenderLeads(_lastRenderedLeads);
}
let _leadsShown = leadsPageSize();
function leadsShowMore() { _leadsShown += leadsPageSize(); empRenderLeads(_lastRenderedLeads); }

function empRenderLeads(list) {
  if (typeof mlTopScrollbar === 'function') mlTopScrollbar('leads-scroll');
  _lastRenderedLeads = list;
  const tbody = document.getElementById('emp-leads-tbody');
  const vis = visibleLeadCols();
  const span = vis.length + 2; // add-column + actions
  if (!list.length) { tbody.innerHTML = `<tr><td colspan="${span}" style="text-align:center;color:var(--muted);padding:28px">No leads found.</td></tr>`; return; }
  const shown = list.slice(0, _leadsShown);
  tbody.innerHTML = shown.map(c => `<tr data-id="${c.id}" style="border-bottom:1px solid rgba(255,255,255,.04)">
      ${vis.map(col => leadCellHtml(c, col)).join('')}
      <td></td>
      <td style="padding:10px 14px;white-space:nowrap;text-align:right">
        ${empCan('leads','edit') ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openEmpLeadModal(${c.id})" title="Edit" style="padding:4px 8px"><i data-lucide="pencil" style="width:13px;height:13px"></i></button>` : ''}
        ${empCan('leads','delete') ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();empRequestDeleteLead(${c.id})" title="Request deletion" style="padding:4px 8px;color:var(--danger);border-color:var(--danger)"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>` : ''}
      </td>
    </tr>`).join('')
    + (list.length > shown.length ? `<tr><td colspan="${span}" style="text-align:center;padding:14px">
        <button class="btn btn-outline" onclick="leadsShowMore()">Load more · ${shown.length} of ${list.length}</button>
      </td></tr>` : '');
  requestAnimationFrame(() => lucide.createIcons());
}

// ── Leads: ClickUp-style configurable columns ─────────────────────────────────
// The editor lives in the shared columns.js now (one engine, both portals —
// the ~260-line copy that used to sit here is gone). This bundle keeps only its
// own renderLeadHead and the thin lookups the row renderers use.
let _leadCols = null;
let _editingLeadCell = false;
let _pendingFollowups = {}; // customer_id -> earliest pending due_at (ISO)
function leadCol(key) { return CE('leads') ? CE('leads').col(key) : null; }
function colOptMap(col) { return CE('leads') ? CE('leads').optMap(col) : {}; }
function leadOptColor(col, key) { return CE('leads') ? CE('leads').optionColor(col, key) : null; }
function isChecked(raw) { return raw === true || raw === 'true' || raw === 1 || raw === '1'; }

// Rebuild a built-in select from the live column config. The Add Lead form used to
// carry its Status, Origin and Next Action options hardcoded in the HTML while the
// table read them from the config, so renaming or adding an option left the two
// disagreeing. Same function the admin portal has always used.
function fillLeadSelect(id, colKey, emptyLabel, rawValue) {
  const sel = document.getElementById(id);
  const col = leadCol(colKey);
  if (!sel || !col) return;
  sel.innerHTML = (emptyLabel != null ? `<option value="">${esc(emptyLabel)}</option>` : '') +
    (col.options || []).map(o => `<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('');
  const k = normKey(rawValue, colOptMap(col));
  sel.value = [...sel.options].some(o => o.value === k) ? k : (emptyLabel != null ? '' : (col.options?.[0]?.key || ''));
}

// Canonicalize a stored value (key OR human label, any casing) to its option key.
function normKey(v, labels) {
  if (v == null || v === '') return '';
  const low = String(v).trim().toLowerCase();
  if (labels[low]) return low;
  const snake = low.replace(/\s+/g, '_');
  if (labels[snake]) return snake;
  for (const k in labels) if (labels[k].toLowerCase() === low) return k;
  return snake;
}

function fmtBudget(min, max) { return empFmtBudget(min, max); }
// Canonicalize a stored value (key OR human label, any casing) to its option key.
function normKey(v, labels) {
  if (v == null || v === '') return '';
  const low = String(v).trim().toLowerCase();
  if (labels[low]) return low;
  const snake = low.replace(/\s+/g, '_');
  if (labels[snake]) return snake;
  for (const k in labels) if (labels[k].toLowerCase() === low) return k;
  return snake;
}

async function loadLeadCols() {
  const eng = CE('leads') || ColumnsEngine('leads', {
    base: '/api/employee',
    fetch: (url, opts) => ef(url, opts),
    builtins: LEADS_BUILTIN_COLS,
    fixedKeys: ['name', 'budget_lead', 'lead_date'],
    // Arranging columns is the leads.edit action, same as the server enforces.
    canEdit: () => empCan('leads', 'edit'),
    sort: { get: () => _leadSort, set: (k, d) => setLeadSort(k, d) },
    onChange: () => { renderLeadHead(); empFilterLeads(); },
  });
  _leadCols = await eng.load();
}
function saveLeadCols() { CE('leads').save(); }

function renderLeadHead() {
  const tr = document.getElementById('emp-leads-head');
  if (!tr || !_leadCols) return;
  const thStyle = 'padding:9px 14px;font-size:11px;color:var(--muted);text-align:left;font-weight:600;text-transform:uppercase;border-bottom:1px solid var(--border);white-space:nowrap';
  const ths = visibleLeadCols().map(c => `
    <th class="lead-col" draggable="true" data-colkey="${esc(c.key)}" style="${thStyle}"
        ondragstart="leadColDragStart(event)" ondragover="leadColDragOver(event)" ondragleave="this.classList.remove('drag-over')"
        ondrop="leadColDrop(event)" ondragend="leadColDragEnd()"
        onclick="leadHeaderClick(event,'${esc(c.key)}')" title="Click to sort">${esc(c.label)}${leadSortArrow(c.key)} <span class="col-chev-btn" onclick="event.stopPropagation();openLeadColMenu(event,'${esc(c.key)}')" title="Column options" style="cursor:pointer;display:inline-flex;align-items:center;padding:0 2px;border-radius:4px"><i data-lucide="chevron-down" style="width:11px;height:11px;display:inline-block;vertical-align:middle"></i></span></th>`).join('');
  tr.innerHTML = ths +
    `<th style="${thStyle};width:34px;text-align:center"><button onclick="openAddLeadColModal()" title="Add column" style="background:none;border:1px dashed var(--border);border-radius:6px;color:var(--muted);cursor:pointer;width:24px;height:24px;font-size:15px;line-height:1">+</button></th>` +
    `<th style="${thStyle};text-align:right">Actions</th>`;
  requestAnimationFrame(() => lucide.createIcons());
}

// ── Inline cell editing (click a cell to edit, ClickUp-style) ──
function leadCellClick(e, id, key) {
  e.stopPropagation();
  if (_editingLeadCell) return;
  // See dashboard.js: on a phone every field is under a thumb, so a tap opens the
  // record rather than starting an edit nobody meant to start.
  if (typeof mlIsMobile === 'function' && mlIsMobile()) return openLeadProfile(id);
  const col = leadCol(key);
  const c = _empLeads.find(x => x.id === id);
  if (!col || !c) return;
  if (col.key === 'name' || col.key === 'next_followup') return openLeadProfile(id);
  if (col.key === 'owner') {
    const cur = c.assigned_to ? String(c.assigned_to) : '';
    brandMenu(e.currentTarget, [{ key: '', label: '— Unassigned —', selected: !cur },
      ...(_empCoworkers || []).map(emp => ({ key: String(emp.id), label: emp.name, selected: cur === String(emp.id) }))],
      val => saveLeadOwner(id, val));
    return;
  }
  const raw = col.builtin ? c[key] : (c.custom_fields || {})[key];
  if (col.type === 'checkbox') return saveLeadCell(id, col, !isChecked(raw));
  const td = e.currentTarget;
  if (td.querySelector('input,select')) return;
  const cur = raw == null ? '' : String(raw);
  if (col.type === 'select' || col.type === 'radio') {
    const m = colOptMap(col); const curKey = normKey(cur, m);
    brandMenu(td, [{ key: '', label: '—', selected: !curKey }, ...(col.options || []).map(o => ({ key: o.key, label: o.label, selected: curKey === o.key }))],
      val => saveLeadCell(id, col, val));
    return;
  }
  _editingLeadCell = true;
  const t = col.key === 'budget_lead' ? 'text' : col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : key === 'lead_time' ? 'time' : 'text';
  const inputVal = col.key === 'budget_lead'
    ? (c.budget_max != null && c.budget_max !== '' ? `${c.budget_lead}-${c.budget_max}` : (c.budget_lead != null ? String(c.budget_lead) : ''))
    : cur;
  td.innerHTML = `<input class="form-control" type="${t}" value="${esc(inputVal)}" placeholder="${col.key === 'budget_lead' ? 'e.g. 1700000 or 1.7M - 2M' : ''}" style="font-size:12px;padding:4px 6px;min-width:90px;max-width:180px">`;
  const el = td.firstElementChild; el.focus();
  if (el.select) try { el.select(); } catch (_) {}
  let done = false;
  const finish = commit => { if (done) return; done = true; _editingLeadCell = false; if (commit) saveLeadCell(id, col, el.value); else empFilterLeads(); };
  el.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') finish(false); });
  el.addEventListener('blur', () => finish(true));
}
async function saveLeadOwner(id, val) {
  try {
    const updated = await ef(`/api/employee/leads/${id}`, { method:'PUT', body: JSON.stringify({ assigned_to: val ? parseInt(val) : null }) }).then(r => r.json());
    if (updated?.error) throw new Error(updated.error);
    const i = _empLeads.findIndex(x => x.id === id); if (i >= 0) _empLeads[i] = updated;
  } catch (e) { showToast('Save failed: ' + e.message); }
  empFilterLeads();
}
async function saveLeadCell(id, col, val) {
  const c = _empLeads.find(x => x.id === id); if (!c) return;
  let payload;
  if (col.builtin) {
    if (col.key === 'budget_lead') { const b = empParseBudget(val); payload = { budget_lead: b.min, budget_max: b.max }; }
    else {
      let v = val;
      if (col.type === 'checkbox') v = !!val;
      else if (col.key === 'lead_date') v = val || null;
      if (col.key === 'name' && !String(v || '').trim()) { empFilterLeads(); return showToast('Name is required.'); }
      payload = { [col.key]: v };
    }
  } else {
    let v = val;
    if (col.type === 'checkbox') v = !!val;
    else if (col.type === 'number') v = val === '' ? null : Number(val);
    payload = { custom_fields: { ...(c.custom_fields || {}), [col.key]: v } };
  }
  try {
    const updated = await ef(`/api/employee/leads/${id}`, { method:'PUT', body: JSON.stringify(payload) }).then(r => r.json());
    if (updated?.error) throw new Error(updated.error);
    const i = _empLeads.findIndex(x => x.id === id); if (i >= 0) _empLeads[i] = updated;
  } catch (e) { showToast('Save failed: ' + e.message); }
  empFilterLeads();
}
// Render one data cell for a lead row according to its column definition
function leadCellHtml(c, col) {
  const raw = col.builtin ? c[col.key] : (c.custom_fields || {})[col.key];
  const base = 'padding:10px 14px;font-size:12px';
  const attrs = `class="lead-cell" style="${base}" onclick="leadCellClick(event, ${c.id}, '${esc(col.key)}')"`;
  if (col.key === 'name') return `<td class="lead-cell" style="${base};font-size:13px" onclick="leadCellClick(event, ${c.id}, 'name')" title="Open profile"><strong style="color:var(--primary);cursor:pointer">${esc(raw || '—')}</strong></td>`;
  if (col.key === 'next_followup') {
    const due = _pendingFollowups[c.id];
    if (!due) return `<td class="lead-cell" style="${base};color:var(--muted)" onclick="leadCellClick(event, ${c.id}, 'next_followup')">—</td>`;
    const overdue = new Date(due) < new Date();
    const label = new Date(due).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<td class="lead-cell" style="${base};white-space:nowrap;color:${overdue ? 'var(--danger)' : 'var(--primary)'};font-weight:600" onclick="leadCellClick(event, ${c.id}, 'next_followup')">⏰ ${label}${overdue ? ' · overdue' : ''}</td>`;
  }
  if (col.key === 'owner') {
    const nm = c.assigned_to ? (empEmpName(c.assigned_to) || ('#' + c.assigned_to)) : '';
    return `<td ${attrs} style="${base};white-space:nowrap" title="Click to assign">${nm ? esc(nm) : '<span style="color:var(--muted)">—</span>'}</td>`;
  }
  if (col.key === 'lead_status') {
    const m = colOptMap(col); const k = normKey(raw || 'cold', m);
    return `<td ${attrs}>${CE('leads').badgeHtml(col, k, m[k] || raw || k)}</td>`;
  }
  if (col.key === 'budget_lead') return `<td ${attrs} style="${base};white-space:nowrap">${empFmtBudget(c.budget_lead, c.budget_max)}</td>`;
  if (col.type === 'checkbox') return `<td class="lead-cell" style="${base};text-align:center;font-size:15px" onclick="leadCellClick(event, ${c.id}, '${esc(col.key)}')">${isChecked(raw) ? '<i data-lucide="check-square" style="width:15px;height:15px"></i>' : '<i data-lucide="square" style="width:15px;height:15px"></i>'}</td>`;
  if (col.type === 'select' || col.type === 'radio') {
    const m = colOptMap(col); const k = normKey(raw, m);
    if (CE('leads').optionColor(col, k)) return `<td ${attrs}>${CE('leads').badgeHtml(col, k, m[k] || raw || '—')}</td>`;
    return `<td ${attrs} style="${base};white-space:nowrap">${esc(m[k] || raw || '—')}</td>`;
  }
  if (['notes', 'car_in_question', 'sales_feedback', 'inquiry'].includes(col.key)) return `<td ${attrs} style="${base};max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(raw || '')}">${esc(raw || '—')}</td>`;
  if (col.type === 'number') return `<td ${attrs} style="${base};white-space:nowrap">${raw != null && raw !== '' ? Number(raw).toLocaleString() : '—'}</td>`;
  return `<td ${attrs} style="${base};white-space:nowrap">${esc(raw || '—')}</td>`;
}

// ── CSV / Google-Sheets import ──
function openEmpCsvModal() {
  document.getElementById('emp-csv-file').value = '';
  document.getElementById('emp-csv-url').value = '';
  document.getElementById('emp-csv-modal').style.display = 'flex';
}
async function empImportCsv() {
  const fileInput = document.getElementById('emp-csv-file');
  const sheetUrl = document.getElementById('emp-csv-url').value.trim();
  const updateExisting = document.getElementById('emp-csv-update-existing')?.checked ? 'true' : 'false';
  if (!fileInput.files[0] && !sheetUrl) return showToast('Choose a CSV file or paste a Sheets URL.');
  try {
    let result;
    if (fileInput.files[0]) {
      const fd = new FormData(); fd.append('file', fileInput.files[0]); fd.append('updateExisting', updateExisting);
      // Raw fetch (not ef) so the multipart boundary is preserved — ef forces JSON content-type.
      result = await fetch('/api/employee/customers/import', { method:'POST', headers: empToken ? { Authorization: 'Bearer ' + empToken } : {}, body: fd }).then(r => r.json());
    } else {
      result = await ef('/api/employee/customers/import', { method:'POST', body: JSON.stringify({ sheetUrl, updateExisting: updateExisting === 'true' }) }).then(r => r.json());
    }
    if (result.error) return showToast('Import error: ' + result.error);
    document.getElementById('emp-csv-modal').style.display = 'none';
    let msg = `Imported ${result.count} new lead(s)${result.updated ? ` · ${result.updated} updated` : ''}${result.skipped ? ` · ${result.skipped} skipped` : ''}${result.deals ? ` · ${result.deals} deal(s) created` : ''}.`;
    if (result.unmatchedHeaders && result.unmatchedHeaders.length) msg += ` Not in your table (add them, then re-import): ${result.unmatchedHeaders.join(', ')}.`;
    showToast(msg);
    loadEmpLeads();
  } catch (e) { showToast('Import error: ' + e.message); }
}

// ── Lead 360° profile drawer ──
let _ldProfile = null; // { customer, activities, followups, quotations, deals }
const LD_ACT_ICONS = { note: 'sticky-note', call: 'phone', whatsapp: 'message-circle', meeting: 'users', status_change: 'refresh-ccw', quote: 'file-badge', deal: 'kanban-square', follow_up: 'alarm-clock', system: 'info' };
async function openLeadProfile(id) {
  // The drawer reads the lead's columns; the pipeline and the submissions page
  // never load them, which left the info grid blank exactly there.
  if (!_leadCols) { try { await loadLeadCols(); } catch (_) {} }
  document.getElementById('lead-drawer-overlay').classList.add('open');
  document.getElementById('lead-drawer').classList.add('open');
  document.getElementById('lead-drawer-body').innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
  try {
    const p = await ef(`/api/employee/customers/${id}/profile`).then(r => r.json());
    if (p.error) throw new Error(p.error);
    _ldProfile = p; renderLeadDrawer();
  } catch (e) {
    document.getElementById('lead-drawer-body').innerHTML = `<div style="color:var(--danger);padding:16px">${esc(e.message)}</div>`;
  }
}
function closeLeadProfile() {
  document.getElementById('lead-drawer-overlay').classList.remove('open');
  document.getElementById('lead-drawer').classList.remove('open');
}
async function refreshLeadProfile() {
  if (!_ldProfile) return;
  try {
    const p = await ef(`/api/employee/customers/${_ldProfile.customer.id}/profile`).then(r => r.json());
    if (!p.error) { _ldProfile = p; renderLeadDrawer(); }
  } catch (_) {}
}
function ldWaDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '2' + d;
  else if (d.startsWith('1') && d.length === 10) d = '20' + d;
  return d;
}
function renderLeadDrawer() {
  const c = _ldProfile.customer;
  const stCol = leadCol('lead_status'); const stMap = colOptMap(stCol);
  const stKey = normKey(c.lead_status || 'cold', stMap);
  document.getElementById('ld-avatar').textContent = (c.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('ld-name').textContent = c.name || '—';
  const badge = document.getElementById('ld-status');
  badge.textContent = (stMap[stKey] || c.lead_status || 'Cold') + ' ▾';
  const stHex = leadOptColor(leadCol('lead_status'), stKey);
  badge.style.background = stHex ? hexA(stHex, 0.16) : 'rgba(255,255,255,.06)';
  badge.style.color = stHex || '#b9b3a4';
  document.getElementById('ld-phone').textContent = c.phone || '';
  document.getElementById('ld-call').href = c.phone ? 'tel:' + c.phone : '#';
  document.getElementById('ld-wa').href = c.phone ? 'https://wa.me/' + ldWaDigits(c.phone) : '#';

  const skip = new Set(['name', 'phone', 'lead_status', 'next_followup']);
  const infoItems = (_leadCols || []).filter(col => !skip.has(col.key) && col.type !== 'virtual' && !col.deleted).map(col => {
    const raw = col.builtin ? c[col.key] : (c.custom_fields || {})[col.key];
    let val;
    if (col.key === 'budget_lead') val = fmtBudget(c.budget_lead, c.budget_max);
    else if (col.type === 'select' || col.type === 'radio') { const m = colOptMap(col); val = m[normKey(raw, m)] || raw || '—'; }
    else if (col.type === 'checkbox') val = isChecked(raw) ? '<i data-lucide="check" style="width:12px;height:12px"></i> Yes' : '—';
    else if (col.type === 'number') val = raw ? Number(raw).toLocaleString() : '—';
    else val = raw || '—';
    return `<div class="ld-info-item"><div class="ld-info-label">${esc(col.label)}</div><div class="ld-info-value" title="${esc(String(raw ?? ''))}">${esc(String(val))}</div></div>`;
  }).join('');

  const pending = (_ldProfile.followups || []).filter(f => f.status === 'pending');
  const fuCards = pending.map(f => {
    const overdue = new Date(f.due_at) < new Date();
    const assignee = (_empCoworkers || []).find(e => String(e.id) === String(f.assigned_to));
    return `<div class="ld-fu-card${overdue ? ' overdue' : ''}">
      <i data-lucide="alarm-clock" style="width:18px;height:18px;color:${overdue ? 'var(--danger)' : 'var(--primary)'};flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:${overdue ? 'var(--danger)' : 'var(--text)'}">${new Date(f.due_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${overdue ? ' — overdue' : ''}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(f.note || 'Follow up with the lead')}${assignee ? ` · ${esc(assignee.name)}` : ''}</div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="ldFollowupStatus(${f.id},'done')">Done</button>
      <button class="btn btn-sm btn-outline" onclick="ldFollowupStatus(${f.id},'cancelled')" title="Cancel"><i data-lucide="x" style="width:12px;height:12px"></i></button>
    </div>`;
  }).join('');
  const empOpts = (_empCoworkers || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');

  const acts = _ldProfile.activities || [];
  const tl = acts.length ? acts.map(a => {
    let bodyHtml = esc(a.body || '');
    if (a.type === 'status_change' && a.meta?.to) {
      const fk = normKey(a.meta.from, stMap), tk = normKey(a.meta.to, stMap);
      const pill = k => { const h = leadOptColor(leadCol('lead_status'), k); return `background:${h ? hexA(h, 0.16) : 'rgba(255,255,255,.06)'};color:${h || '#b9b3a4'}`; };
      bodyHtml = `Status: <span class="ld-stage-pill" style="${pill(fk)}">${esc(stMap[fk] || a.meta.from || '—')}</span> → <span class="ld-stage-pill" style="${pill(tk)}">${esc(stMap[tk] || a.meta.to)}</span>`;
    }
    return `<div class="ld-tl-item">
      <div class="ld-tl-icon"><i data-lucide="${LD_ACT_ICONS[a.type] || 'circle'}"></i></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;line-height:1.5;word-break:break-word">${bodyHtml}</div>
        <div class="ld-tl-meta">${esc(a.author_name || '—')} · ${esc(notifRelTime(a.created_at))}</div>
      </div>
    </div>`;
  }).join('') : '<div style="color:var(--muted);font-size:12px;padding:10px 0">No activity yet — log the first touch below.</div>';

  const quotes = _ldProfile.quotations || [];
  const quotesHtml = quotes.length ? quotes.map(q => `
    <div class="ld-quote-row">
      <div style="min-width:0">
        <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.title)}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:2px"><code>${esc(q.quote_id)}</code> · ${new Date(q.created_at).toLocaleDateString()} · ${esc(q.created_by)}</div>
      </div>
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px">No quotations yet — use "Generate Quotation" above.</div>';

  const deals = _ldProfile.deals || [];
  const dealsHtml = deals.length ? deals.map(d => `
    <div class="ld-quote-row">
      <div style="min-width:0">
        <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title)}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-top:2px">${d.budget_egp ? Number(d.budget_egp).toLocaleString() + ' EGP · ' : ''}${new Date(d.created_at).toLocaleDateString()}</div>
      </div>
      <span class="ld-stage-pill">${esc(EMP_DEAL_STAGE_LABELS[d.stage] || d.stage)}</span>
    </div>`).join('') : '<div style="color:var(--muted);font-size:12px">No deals yet.</div>';

  document.getElementById('lead-drawer-body').innerHTML = `
    <div class="ld-section"><div class="ld-info-grid">${infoItems}</div></div>
    <div class="ld-section">
      <div class="ld-section-title">Follow-ups</div>
      ${fuCards}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:${pending.length ? '10px' : '0'}">
        <input class="form-control" id="ld-fu-when" type="datetime-local" style="max-width:190px;font-size:12px;padding:8px 10px">
        <input class="form-control" id="ld-fu-note" placeholder="What to do…" style="flex:1;min-width:130px;font-size:12px;padding:8px 10px">
        <select class="form-control" id="ld-fu-who" style="max-width:150px;font-size:12px"><option value="">Remind me</option>${empOpts}</select>
        <button class="btn btn-sm btn-primary" onclick="ldScheduleFollowup()">Schedule</button>
      </div>
    </div>
    ${clientFolderSection(c.id)}
    <div class="ld-section">
      <div class="ld-section-title">Quotations <span style="font-weight:400;text-transform:none;letter-spacing:0">${quotes.length || ''}</span></div>
      ${quotesHtml}
    </div>
    <div class="ld-section">
      <div class="ld-section-title">Deals</div>
      ${dealsHtml}
    </div>
    <div class="ld-section">
      <div class="ld-section-title">Activity</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <select class="form-control" id="ld-act-type" style="max-width:120px;font-size:12px">
          <option value="note">Note</option><option value="call">Call</option>
          <option value="whatsapp">WhatsApp</option><option value="meeting">Meeting</option>
        </select>
        <input class="form-control" id="ld-act-body" placeholder="Log a call, note, meeting…" style="flex:1;font-size:12px" onkeydown="if(event.key==='Enter')ldLogActivity()">
        <button class="btn btn-sm btn-primary" onclick="ldLogActivity()">Log</button>
      </div>
      <div id="ld-timeline">${tl}</div>
    </div>`;
  requestAnimationFrame(() => lucide.createIcons());
}
function ldStatusMenu(e) {
  e.stopPropagation();
  if (!_ldProfile) return;
  const col = leadCol('lead_status'); const m = colOptMap(col);
  const cur = normKey(_ldProfile.customer.lead_status || 'cold', m);
  brandMenu(e.currentTarget, (col.options || []).map(o => ({ key: o.key, label: o.label, selected: o.key === cur })), async key => {
    try {
      const updated = await ef(`/api/employee/leads/${_ldProfile.customer.id}`, { method: 'PUT', body: JSON.stringify({ lead_status: key }) }).then(r => r.json());
      if (updated.error) throw new Error(updated.error);
      const i = _empLeads.findIndex(x => x.id === updated.id); if (i >= 0) _empLeads[i] = updated;
      empFilterLeads(); refreshLeadProfile();
    } catch (err) { showToast('Status change failed: ' + err.message); }
  });
}
async function ldScheduleFollowup() {
  const when = document.getElementById('ld-fu-when').value;
  if (!when) return showToast('Pick a date & time for the follow-up');
  const body = { due_at: new Date(when).toISOString(), note: document.getElementById('ld-fu-note').value.trim(), assigned_to: document.getElementById('ld-fu-who').value || null };
  const r = await ef(`/api/employee/customers/${_ldProfile.customer.id}/followups`, { method: 'POST', body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok || d.error) return showToast('Error: ' + (d.error || r.status));
  showToast('Follow-up scheduled — a reminder will fire when it\'s due');
  _pendingFollowups[_ldProfile.customer.id] = _pendingFollowups[_ldProfile.customer.id] && new Date(_pendingFollowups[_ldProfile.customer.id]) < new Date(d.due_at) ? _pendingFollowups[_ldProfile.customer.id] : d.due_at;
  empFilterLeads(); refreshLeadProfile();
}
async function ldFollowupStatus(id, status) {
  const r = await ef(`/api/employee/followups/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
  const d = await r.json();
  if (!r.ok || d.error) return showToast('Error: ' + (d.error || r.status));
  delete _pendingFollowups[d.customer_id];
  const rest = (_ldProfile.followups || []).filter(f => f.status === 'pending' && f.id !== id).sort((a, b) => a.due_at.localeCompare(b.due_at));
  if (rest[0]) _pendingFollowups[d.customer_id] = rest[0].due_at;
  empFilterLeads(); refreshLeadProfile();
}
async function ldLogActivity() {
  const input = document.getElementById('ld-act-body');
  const body = input.value.trim(); if (!body) return;
  const type = document.getElementById('ld-act-type').value;
  const r = await ef(`/api/employee/customers/${_ldProfile.customer.id}/activities`, { method: 'POST', body: JSON.stringify({ type, body }) });
  const d = await r.json();
  if (!r.ok || d.error) return showToast('Error: ' + (d.error || r.status));
  input.value = ''; refreshLeadProfile();
}
function ldEdit() { if (_ldProfile) openEmpLeadModal(_ldProfile.customer.id); }
function ldGenerateQuote() {
  if (!_ldProfile) return;
  const c = _ldProfile.customer;
  closeLeadProfile();
  navigate('quotation');
  // The quotation is the shared sheet now — open it with the lead prefilled.
  openQuoteForm(null, { lead: c });
}

// Is this lead column the "vehicle offered" field — the one wired to the inventory
// search? "Vehicle Requested" is what the customer asked for and stays free text.
function isVehicleField(col) {
  const key = col?.key || '';
  if (key === 'cf_vehicle_offered') return true;
  const lbl = (col?.label || '').trim().toLowerCase();
  return lbl === 'vehicle offered' || lbl === 'car offered' || lbl === 'offered vehicle';
}
// Vehicle inventory combobox for the employee lead modal (uses ef()).
function empAttachVehicleSearch(inputId = 'eml-car', priceId = 'eml-car-price', resultsId = 'eml-car-results', hintId = 'eml-car-hint', imagesId = 'eml-car-images') {
  const input = document.getElementById(inputId), results = document.getElementById(resultsId);
  const priceEl = document.getElementById(priceId), hint = document.getElementById(hintId);
  const imagesEl = imagesId && document.getElementById(imagesId);
  if (!input || !results || input._vehBound) return;
  input._vehBound = true;
  let t = null, lastReq = 0;
  const hide = () => { results.style.display = 'none'; };
  const money = n => (Number(n) || 0).toLocaleString() + ' EGP';
  const run = async () => {
    const q = input.value.trim();
    if (priceEl) priceEl.value = '';
    if (imagesEl) imagesEl.value = '';
    if (q.length < 1) { hide(); return; }
    const reqId = ++lastReq;
    try {
      const r = await ef(`/api/employee/inventory/search?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (reqId !== lastReq) return;
      if (d.configured === false) { if (hint) hint.textContent = '(inventory not connected)'; hide(); return; }
      if (hint) hint.textContent = '';
      const items = d.items || [];
      if (!items.length) { hide(); return; }
      results.innerHTML = items.map((it, i) => `
        <div class="veh-opt" data-i="${i}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);display:flex;justify-content:space-between;gap:10px;align-items:center"
             onmouseover="this.style.background='rgba(201,163,94,.12)'" onmouseout="this.style.background='none'">
          <div style="min-width:0"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.name)}</div>${it.subtitle ? `<div style="font-size:11px;color:var(--muted)">${esc(it.subtitle)}</div>` : ''}</div>
          ${it.price ? `<div style="font-size:12px;color:var(--primary);white-space:nowrap;font-weight:600">${money(it.price)}</div>` : ''}
        </div>`).join('');
      results._items = items;
      [...results.querySelectorAll('.veh-opt')].forEach(el => el.addEventListener('mousedown', ev => {
        ev.preventDefault();
        const it = results._items[+el.dataset.i];
        input.value = it.name;
        if (priceEl) priceEl.value = it.price != null ? it.price : '';
        if (imagesEl) imagesEl.value = JSON.stringify(Array.isArray(it.images) ? it.images : (it.image ? [it.image] : []));
        hide();
      }));
      results.style.display = 'block';
    } catch (_) { hide(); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
  input.addEventListener('focus', () => { if (input.value.trim()) run(); });
  input.addEventListener('blur', () => setTimeout(hide, 200));
}
function openEmpLeadModal(id) {
  const c = id ? _empLeads.find(x => x.id === id) : null;
  document.getElementById('eml-title').textContent = c ? 'Edit Lead' : 'Add Lead';
  document.getElementById('eml-id').value = c?.id || '';
  const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v; };
  set('eml-name', c?.name || ''); set('eml-phone', c?.phone || ''); set('eml-date', c?.lead_date || ''); set('eml-time', c?.lead_time || '');
  set('eml-car', c?.car_in_question || '');
  // Built from the column config, not from the markup — see fillLeadSelect.
  fillLeadSelect('eml-status', 'lead_status', null, c?.lead_status || 'cold');
  fillLeadSelect('eml-source', 'source', '— Unknown —', c?.source);
  set('eml-budget', (c?.budget_max != null && c?.budget_max !== '') ? `${c.budget_lead}-${c.budget_max}` : (c?.budget_lead || ''));
  fillLeadSelect('eml-next-action', 'next_action', '— None —', c?.next_action);
  set('eml-notes', c?.notes || ''); set('eml-sales-feedback', c?.sales_feedback || ''); set('eml-inquiry', c?.inquiry || '');
  document.getElementById('eml-contacted').checked = !!c?.been_contacted;
  const owner = document.getElementById('eml-owner');
  owner.innerHTML = '<option value="">— Unassigned —</option>' + (_empCoworkers || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  owner.value = c?.assigned_to ? String(c.assigned_to) : '';
  // Custom columns → dynamic inputs (ids eml-cf-<key>)
  const cwrap = document.getElementById('eml-custom-fields');
  const custom = (_leadCols || []).filter(x => !x.builtin);
  cwrap.innerHTML = custom.map(col => {
    const v = (c?.custom_fields || {})[col.key];
    if (col.type === 'checkbox') {
      return `<div><label class="form-label">${esc(col.label)}</label>
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#0e0e10;border:1px solid var(--border);border-radius:8px">
          <input type="checkbox" id="eml-cf-${esc(col.key)}" ${v ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--primary)">
          <label for="eml-cf-${esc(col.key)}" style="font-size:13px;cursor:pointer">Yes</label>
        </div></div>`;
    }
    if (col.type === 'select' || col.type === 'radio') {
      const m = colOptMap(col); const k = normKey(v, m);
      return `<div><label class="form-label">${esc(col.label)}</label>
        <select class="form-control" id="eml-cf-${esc(col.key)}"><option value="">— None —</option>
          ${(col.options || []).map(o => `<option value="${esc(o.key)}"${k === o.key ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></div>`;
    }
    if (isVehicleField(col)) {
      return `<div style="position:relative"><label class="form-label">${esc(col.label)} <span id="eml-cf-${esc(col.key)}-hint" style="color:var(--muted);font-weight:400;font-size:11px"></span></label>
        <input class="form-control" id="eml-cf-${esc(col.key)}" value="${esc(v ?? '')}" placeholder="Search inventory or type a vehicle…" autocomplete="off">
        <input type="hidden" id="eml-cf-${esc(col.key)}-price"><input type="hidden" id="eml-cf-${esc(col.key)}-images">
        <div id="eml-cf-${esc(col.key)}-results" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:60;background:var(--card,#18181b);border:1px solid var(--border);border-radius:8px;margin-top:4px;max-height:240px;overflow:auto;box-shadow:0 10px 28px rgba(0,0,0,.45)"></div></div>`;
    }
    const t = col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text';
    return `<div><label class="form-label">${esc(col.label)}</label>
      <input class="form-control" id="eml-cf-${esc(col.key)}" type="${t}" value="${esc(v ?? '')}"></div>`;
  }).join('');
  document.getElementById('eml-car-price').value = (c?.custom_fields && c.custom_fields.cf_vehicle_price) || '';
  document.getElementById('eml-car-images').value = (c?.custom_fields && Array.isArray(c.custom_fields.cf_vehicle_images)) ? JSON.stringify(c.custom_fields.cf_vehicle_images) : '';
  // 'Vehicle Requested' (eml-car) is free text — the picker lives on 'Vehicle Offered'.
  custom.filter(isVehicleField).forEach(col => {
    const pe = document.getElementById('eml-cf-' + col.key + '-price'); if (pe) pe.value = (c?.custom_fields && c.custom_fields.cf_vehicle_price) || '';
    const ie = document.getElementById('eml-cf-' + col.key + '-images'); if (ie) ie.value = (c?.custom_fields && Array.isArray(c.custom_fields.cf_vehicle_images)) ? JSON.stringify(c.custom_fields.cf_vehicle_images) : '';
    empAttachVehicleSearch('eml-cf-' + col.key, 'eml-cf-' + col.key + '-price', 'eml-cf-' + col.key + '-results', 'eml-cf-' + col.key + '-hint', 'eml-cf-' + col.key + '-images');
  });
  const carCol = (_leadCols || []).find(x => x.key === 'car_in_question');
  const carWrap = document.getElementById('eml-car')?.closest('div');
  if (carWrap) carWrap.style.display = (carCol && (carCol.deleted || carCol.visible === false)) ? 'none' : '';
  document.getElementById('emp-lead-modal').style.display = 'flex';
}
async function saveEmpLead() {
  const id = document.getElementById('eml-id').value;
  const g = k => document.getElementById(k).value;
  const bud = empParseBudget(g('eml-budget'));
  const payload = {
    name: g('eml-name').trim(), phone: g('eml-phone').trim(), lead_date: g('eml-date') || null, lead_time: g('eml-time') || null,
    lead_status: g('eml-status'), source: g('eml-source'), car_in_question: g('eml-car').trim(),
    budget_lead: bud.min, budget_max: bud.max, next_action: g('eml-next-action'),
    been_contacted: document.getElementById('eml-contacted').checked, notes: g('eml-notes').trim(),
    sales_feedback: g('eml-sales-feedback').trim(), inquiry: g('eml-inquiry').trim(),
    assigned_to: g('eml-owner') ? parseInt(g('eml-owner')) : null,
  };
  const customCols = (_leadCols || []).filter(x => !x.builtin);
  const existingCf = id ? (_empLeads.find(x => String(x.id) === String(id))?.custom_fields || {}) : {};
  const cf = { ...existingCf };
  customCols.forEach(col => {
    const el = document.getElementById('eml-cf-' + col.key); if (!el) return;
    cf[col.key] = col.type === 'checkbox' ? el.checked
      : col.type === 'number' ? (el.value === '' ? null : Number(el.value))
      : el.value;
  });
  const vpEl = [...document.querySelectorAll('#emp-lead-modal input[type=hidden][id$="-price"]')].find(el => el.value);
  if (vpEl) cf.cf_vehicle_price = Number(vpEl.value); else delete cf.cf_vehicle_price;
  const viEl = [...document.querySelectorAll('#emp-lead-modal input[type=hidden][id$="-images"]')].find(el => el.value);
  if (viEl) { try { const arr = JSON.parse(viEl.value); if (Array.isArray(arr) && arr.length) cf.cf_vehicle_images = arr; else delete cf.cf_vehicle_images; } catch (_) { delete cf.cf_vehicle_images; } } else delete cf.cf_vehicle_images;
  if (Object.keys(cf).length || customCols.length) payload.custom_fields = cf;
  if (!payload.name) return showToast('Name is required.');
  try {
    const url = id ? `/api/employee/leads/${id}` : '/api/employee/leads';
    const method = id ? 'PUT' : 'POST';
    let r = await ef(url, { method, body: JSON.stringify(payload) });
    if (r.status === 409) {
      const { existing } = await r.json();
      if (!confirm(`A lead with this phone already exists: "${existing?.name || 'Unknown'}".\n\nOK = create anyway · Cancel = abort.`)) return;
      r = await ef(url, { method, body: JSON.stringify({ ...payload, force: true }) });
    }
    if (!r.ok) { const e = await r.json().catch(() => ({})); return showToast('Error: ' + (e.error || r.status)); }
    document.getElementById('emp-lead-modal').style.display = 'none';
    loadEmpLeads();
  } catch (e) { showToast('Error: ' + e.message); }
}
async function empRequestDeleteLead(id) {
  const c = _empLeads.find(x => x.id === id);
  const reason = prompt(`Request deletion of lead "${c?.name || ('#' + id)}"?\nAn admin must approve before it is deleted.\n\nOptional reason:`);
  if (reason === null) return;
  try {
    const r = await ef('/api/employee/deletion-requests', { method: 'POST', body: JSON.stringify({ entity_type: 'lead', entity_id: id, reason }) });
    const d = await r.json();
    if (!r.ok) return showToast('Error: ' + (d.error || r.status));
    showToast(d.duplicate ? 'A deletion request is already pending.' : 'Deletion request sent to admin.');
  } catch (e) { showToast('Error: ' + e.message); }
}

/* ── CRM: Deals (actionable kanban) ── */
const EMP_DEAL_STAGES = ['lead','inquiry','quoted','negotiating','won','lost'];
// The Deals page tabs. Pipeline is deals.view (the page itself); the Sales tab
// is its own grant, deals.sales, and renders through the shared procurement.js.
let _empDealsTab = 'pipeline';
function empDealsTab(tab) {
  if (tab === 'sales' && !empCan('deals', 'sales')) tab = 'pipeline';
  _empDealsTab = tab;
  document.querySelectorAll('#page-deals .deal-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['pipeline', 'sales'].forEach(t => {
    const el = document.getElementById('deals-pane-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'sales') loadSales();
  requestAnimationFrame(() => lucide.createIcons());
}

const EMP_DEAL_STAGE_LABELS = { lead:'Lead', inquiry:'Inquiry', quoted:'Quoted', negotiating:'Negotiating', won:'Won', lost:'Lost' };
let _empDeals = [];
let _empDragDealId = null;

// ── Google Chat panel (real spaces + messages) ──────────────────────────────────
// Capability comes from the scopes Google actually granted, so a partial consent
// renders a read-only or send-only panel instead of failing. Every failure paints
// a state inside this panel and never touches the rest of the page.
let _gchat = { status: null, space: null, spaces: [], timer: null };
const GCHAT_BASE = '/api/employee/gchat';

function gchatFetch(path, opts) { return ef(GCHAT_BASE + path, opts); }

function gchatStateCard(icon, title, body, btn) {
  return `<div class="chat-empty-state" style="text-align:center;padding:32px">
    <i data-lucide="${icon}" style="width:40px;height:40px;opacity:.3"></i>
    <div style="font-weight:600;margin-top:4px">${esc(title)}</div>
    <div style="font-size:12.5px;color:var(--muted);max-width:320px;line-height:1.6">${body}</div>
    ${btn || ''}</div>`;
}
function gchatConnectBtn(label) {
  return `<button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="gchatConnect()">${esc(label)}</button>`;
}
function gchatConnect() {
  empConnectNav(GCHAT_BASE + '/connect');
}
async function gchatDisconnect() {
  if (!confirm('Disconnect Google Chat?')) return;
  await gchatFetch('/disconnect', { method: 'POST' });
  loadGChat();
}

async function loadGChat() {
  const list = document.getElementById('gchat-space-list');
  const main = document.getElementById('gchat-main');
  if (!list || !main) return;
  // A failed connect redirects back with ?gchat_error=… — show it once.
  const qErr = new URLSearchParams(location.search).get('gchat_error');
  if (qErr) {
    history.replaceState(null, '', location.pathname + '#gchat');
    list.innerHTML = '';
    main.innerHTML = gchatStateCard('alert-triangle', "Couldn't connect Google Chat", esc(qErr), gchatConnectBtn('Try again'));
    requestAnimationFrame(() => lucide.createIcons());
    return;
  }
  try { _gchat.status = await gchatFetch('/status').then(r => r.json()); }
  catch (_) { _gchat.status = { configured: false }; }
  const st = _gchat.status;

  if (!st.configured) {
    list.innerHTML = '';
    main.innerHTML = gchatStateCard('plug', 'Google Chat is not set up',
      'Ask an administrator to enable it (<code>GOOGLE_CHAT_ENABLED=1</code>). Google Chat requires a Google&nbsp;Workspace account.');
  } else if (st.reconnect) {
    list.innerHTML = '';
    main.innerHTML = gchatStateCard('rotate-ccw', 'Reconnect Google Chat',
      'Your Google session expired. Unverified apps in testing mode lose access every 7 days.', gchatConnectBtn('Reconnect'));
  } else if (!st.connected) {
    list.innerHTML = '';
    main.innerHTML = gchatStateCard('message-square', 'Connect Google Chat',
      'See your spaces and messages here, and reply without leaving the app.', gchatConnectBtn('Connect Google Chat'));
  } else {
    await gchatLoadSpaces();
  }
  requestAnimationFrame(() => lucide.createIcons());
}

async function gchatLoadSpaces() {
  const list = document.getElementById('gchat-space-list');
  const main = document.getElementById('gchat-main');
  if (!list) return;
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  let d;
  try { d = await gchatFetch('/spaces').then(r => r.json()); } catch (_) { d = { spaces: [], error: 'failed' }; }
  if (d.error) {
    list.innerHTML = '';
    const msg = d.error === 'forbidden'
      ? 'Google Chat isn\'t available for your organization. A Workspace admin needs to allow this app.'
      : d.error === 'reconnect' ? 'Your Google session expired.'
      : 'Could not reach Google Chat.';
    main.innerHTML = gchatStateCard('alert-circle', 'Google Chat unavailable', esc(msg),
      d.error === 'reconnect' ? gchatConnectBtn('Reconnect') : '');
    requestAnimationFrame(() => lucide.createIcons());
    return;
  }
  _gchat.spaces = d.spaces || [];
  if (!_gchat.spaces.length) {
    list.innerHTML = '<div style="padding:18px;color:var(--muted);font-size:12.5px;line-height:1.6">No spaces yet.<br>Group chats and DMs only appear here once they have at least one message.</div>';
    return;
  }
  list.innerHTML = _gchat.spaces.map(sp => {
    const init = (sp.title || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="chat-room-item${_gchat.space === sp.name ? ' active' : ''}" onclick="gchatOpen('${sp.name}')">
      <div class="chat-room-avatar-wrap"><div class="chat-room-avatar${sp.type === 'SPACE' ? ' grp' : ''}">${esc(init)}</div></div>
      <div class="chat-room-info"><div class="chat-room-name">${esc(sp.title)}</div>
        <div class="chat-room-preview">${esc(sp.type === 'DIRECT_MESSAGE' ? 'Direct message' : 'Space')}</div></div>
    </div>`;
  }).join('');
  if (_gchat.space) gchatOpen(_gchat.space, true);
}

async function gchatOpen(space, keepPoll) {
  _gchat.space = space;
  document.querySelectorAll('#gchat-space-list .chat-room-item').forEach(el => el.classList.remove('active'));
  const caps = (_gchat.status && _gchat.status.caps) || {};
  const sp = _gchat.spaces.find(x => x.name === space);
  const main = document.getElementById('gchat-main');
  main.innerHTML = `
    <div class="chat-header"><div class="chat-header-name">${esc(sp ? sp.title : 'Space')}</div></div>
    <div class="chat-messages" id="gchat-messages"><div class="loading"><div class="spinner"></div></div></div>
    ${caps.send && empCan('gchat', 'send') ? `<div class="chat-composer">
        <textarea class="chat-input" id="gchat-input" rows="1" placeholder="Message ${esc(sp ? sp.title : '')}… (sent as you)" onkeydown="gchatKey(event)"></textarea>
        <button class="chat-send-btn" id="gchat-send" onclick="gchatSend()" title="Send"><i data-lucide="send" style="width:15px;height:15px"></i></button>
      </div>`
      : `<div class="chat-composer" style="justify-content:center;color:var(--muted);font-size:12px">
          ${empCan('gchat', 'send') ? `Read-only — you didn't grant permission to send. <a href="#" onclick="gchatConnect();return false" style="color:var(--primary);margin-left:4px">Reconnect</a>` : 'Read-only — your admin has not granted sending.'}
        </div>`}`;
  await gchatLoadMessages();
  if (!keepPoll) gchatStartPoll();
  requestAnimationFrame(() => lucide.createIcons());
}

async function gchatLoadMessages() {
  const box = document.getElementById('gchat-messages');
  if (!box || !_gchat.space) return;
  const caps = (_gchat.status && _gchat.status.caps) || {};
  if (!caps.read) {
    box.innerHTML = gchatStateCard('eye-off', 'Message history not shared',
      'You didn\'t grant permission to read messages. You can still send.', gchatConnectBtn('Grant read access'));
    requestAnimationFrame(() => lucide.createIcons());
    return;
  }
  let d;
  try { d = await gchatFetch('/messages?space=' + encodeURIComponent(_gchat.space)).then(r => r.json()); }
  catch (_) { d = { messages: [], error: 'failed' }; }
  if (d.error) {
    box.innerHTML = gchatStateCard('alert-circle', 'Could not load messages', esc(d.detail || d.error),
      d.error === 'reconnect' ? gchatConnectBtn('Reconnect') : '');
    requestAnimationFrame(() => lucide.createIcons());
    return;
  }
  const msgs = d.messages || [];
  if (!msgs.length) { box.innerHTML = '<div class="chat-empty-state" style="padding:28px"><div>No messages in this space yet.</div></div>'; return; }
  const me = (_gchat.status && _gchat.status.email) || '';
  box.innerHTML = msgs.map(m => {
    const mine = me && m.senderName && _gchat.status.name === m.senderName;
    const t = m.createTime ? new Date(m.createTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}">
      ${!mine ? `<div class="chat-msg-sender">${esc(m.senderName || 'Unknown')}</div>` : ''}
      <div class="chat-msg-bubble">${esc(m.text)}</div>
      <div class="chat-msg-time">${t}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function gchatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gchatSend(); } }
async function gchatSend() {
  const input = document.getElementById('gchat-input');
  const btn = document.getElementById('gchat-send');
  if (!input || !_gchat.space) return;
  const text = input.value.trim();
  if (!text) return;
  if (btn) btn.disabled = true;
  try {
    const r = await gchatFetch('/messages', { method: 'POST', body: JSON.stringify({ space: _gchat.space, text }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.detail || d.error || 'Send failed');
    input.value = '';            // only clear once Google accepted it
    await gchatLoadMessages();
  } catch (e) {
    alert('Could not send: ' + e.message);
  } finally { if (btn) btn.disabled = false; }
}

// Chat has no realtime push without extra Workspace infrastructure, so poll —
// only the open space, and never while the tab is hidden.
function gchatStartPoll() {
  gchatStopPoll();
  _gchat.timer = setInterval(() => {
    if (document.hidden || !_gchat.space) return;
    gchatLoadMessages().catch(() => {});
  }, 20000);
}
function gchatStopPoll() { if (_gchat.timer) { clearInterval(_gchat.timer); _gchat.timer = null; } }

// Hide the nav entry entirely until Chat is configured — never show a dead page.
async function gchatInitNav() {
  const nav = document.getElementById('nav-gchat');
  if (!nav) return;
  // Two conditions, both required: Google Chat configured on the deployment, and
  // this employee permitted to use it. /status now 403s without the permission,
  // so the catch below is also the permission path.
  if (!empHas('gchat')) { nav.style.display = 'none'; return; }
  try {
    const st = await gchatFetch('/status').then(r => r.json());
    nav.style.display = st.configured ? '' : 'none';
  } catch (_) { nav.style.display = 'none'; }
}

/* ── Shared sidebar layout (arranged by the admin in the dashboard) ── */
// Read-only here: the admin arranges once and both portals follow. Items the
// employee has no permission for stay hidden — this runs after applyPermissions.
// The two portals name the Leads item differently, so alias it.
const NAV_ID_ALIAS = { 'nav-customers': 'nav-leads', 'nav-leads': 'nav-customers' };
function navItemEl(id) {
  return document.getElementById(id) || document.getElementById(NAV_ID_ALIAS[id] || '');
}
function navSetItemLabel(el, text) {
  const span = el.querySelector('.nav-item-label');
  if (span) { span.textContent = text; return; }
  const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
  if (t.length) { t[0].textContent = ' ' + text; t.slice(1).forEach(n => { n.textContent = ''; }); }
  else el.appendChild(document.createTextNode(' ' + text));
}
function applyNavConfig(cfg) {
  const groups = (cfg && Array.isArray(cfg.groups)) ? cfg.groups : [];
  if (!groups.length) return;
  const nav = document.querySelector('#sidebar .sidebar-nav') || document.querySelector('#sidebar');
  if (!nav) return;
  const allGroups = () => [...document.querySelectorAll('#sidebar .nav-group')];
  const byKey = new Map(allGroups().map(g => [g.dataset.group, g]));
  const placedGroups = new Set();
  groups.forEach(g => {
    const el = byKey.get(g.key);
    if (!el) return;                       // section this portal doesn't have (e.g. logistics)
    placedGroups.add(g.key);
    const wrap = el.querySelector('.nav-group-items');
    // Adopt the admin's group NAME only when the two portals agree on what the
    // group contains. The admin's "chat" group also holds WhatsApp; renaming it
    // "MRK & REACH" there used to retitle the portal's Chat group for anyone
    // whose permissions showed it — "some employees see sections others don't",
    // when the section never existed here at all, only the borrowed heading.
    const portalIds = wrap ? new Set([...wrap.querySelectorAll('.nav-item')].map(i => i.id)) : new Set();
    const sameShape = (g.items || []).every(it => {
      const iel = navItemEl(it.id);
      return iel && portalIds.has(iel.id);
    });
    const lbl = el.querySelector('.nav-group-label');
    if (g.label && lbl && sameShape) lbl.textContent = g.label;
    nav.appendChild(el);
    if (!wrap) return;
    const placedItems = new Set();
    (g.items || []).forEach(it => {
      const iel = navItemEl(it.id);
      if (!iel || !iel.classList.contains('nav-item')) return;
      // Only reorder within the item's OWN portal group. The admin files
      // Contracts under Tools, but here Tools is gated on the quotation
      // permission — moving the item across groups parked it under a heading
      // its own permission doesn't govern, visible or hidden by someone else's
      // grant. Ordering is shared; group membership is the portal's.
      if (!portalIds.has(iel.id)) return;
      // Never override the permission gate — only reorder/rename what's visible.
      if (it.label) navSetItemLabel(iel, it.label);
      // The admin's hidden flag may only NARROW what shows: display is written
      // solely for hidden===true, so an unhidden item keeps whatever
      // applyPermissions decided and this can never resurrect a gated section.
      if (it.hidden === true) iel.style.display = 'none';
      wrap.appendChild(iel);
      placedItems.add(iel.id);
    });
    if (g.hidden === true) el.style.display = 'none';
    // An item that shipped after this arrangement was saved isn't in the config,
    // so the appends above leave it sitting at the top of its group. Push it to
    // the end instead — new entries join the list, they don't jump the queue.
    if (placedItems.size) {
      [...wrap.querySelectorAll('.nav-item')]
        .filter(i => !placedItems.has(i.id))
        .forEach(i => wrap.appendChild(i));
    }
  });
  // Same for a whole section added since the save.
  allGroups().forEach(g => { if (!placedGroups.has(g.dataset.group)) nav.appendChild(g); });
}
async function loadNavConfig() {
  try {
    const cfg = await ef('/api/employee/nav-config').then(r => r.json());
    applyNavConfig(cfg);
  } catch (_) {}
}

/* ── My Google Calendar (tasks assigned to me land on it directly) ── */
let _empCal = { configured: false, connected: false };
async function loadEmpCalendar() {
  const badge = document.getElementById('emp-cal-status');
  const btn = document.getElementById('emp-cal-btn');
  if (!badge || !btn) return;
  try { _empCal = await ef('/api/employee/calendar/status').then(r => r.json()); }
  catch (_) { _empCal = { configured: false, connected: false }; }
  if (!_empCal.configured) { badge.textContent = ''; btn.style.display = 'none'; return; }
  btn.style.display = '';
  if (_empCal.connected) {
    badge.textContent = `Tasks sync to ${_empCal.email || 'your calendar'}`;
    btn.textContent = 'Disconnect calendar';
  } else {
    badge.textContent = 'Tasks are not on your calendar yet';
    btn.textContent = 'Add tasks to my Google Calendar';
  }
}
async function empCalendarToggle() {
  if (_empCal.connected) {
    if (!confirm('Stop adding your tasks to Google Calendar? Events already created stay put.')) return;
    await ef('/api/employee/calendar/disconnect', { method: 'POST' });
    loadEmpCalendar();
    return;
  }
  empConnectNav('/api/employee/calendar/connect');
}

/* ── Reports (only the ones this employee is granted) ── */
function empRepEgp(n) { return (Number(n) || 0).toLocaleString() + ' EGP'; }
function empRepTile(label, value, sub) {
  return `<div style="flex:1;min-width:140px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
    <div style="font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)">${esc(label)}</div>
    <div style="font-size:19px;font-weight:700;margin-top:3px">${esc(value)}</div>
    ${sub ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(sub)}</div>` : ''}
  </div>`;
}

async function loadEmpReports() {
  const anyReport = empCan('reports', 'leads') || empCan('reports', 'sales');
  document.getElementById('emp-rep-empty').style.display = anyReport ? 'none' : 'block';
  if (empCan('reports', 'leads')) await empLoadLeadsReport();
  if (empCan('reports', 'sales')) await empLoadSalesReport();
  requestAnimationFrame(() => lucide.createIcons());
}

async function empLoadLeadsReport() {
  if (!empCan('reports', 'leads')) return;
  const tbl = document.getElementById('emp-rep-leads-table');
  const kpi = document.getElementById('emp-rep-leads-kpis');
  tbl.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
  const qs = new URLSearchParams({ groupBy: document.getElementById('emp-rep-groupby').value });
  const from = document.getElementById('emp-rep-from').value;
  const to = document.getElementById('emp-rep-to').value;
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  try {
    const r = await ef('/api/employee/reports/leads?' + qs.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    kpi.innerHTML = empRepTile('My Leads', (d.totals?.count || 0).toLocaleString(),
        (d.range && (d.range.from || d.range.to)) ? `${d.range.from || '…'} → ${d.range.to || '…'}` : 'All time')
      + empRepTile('Hot Leads', (d.hotCount || 0).toLocaleString(),
        d.totals?.count ? Math.round(d.hotCount / d.totals.count * 100) + '% of leads' : '0%')
      + empRepTile('Avg Budget', empRepEgp(d.totals?.avg), 'Per lead');
    const rows = d.rows || [];
    const max = Math.max(1, ...rows.map(x => x.count || 0));
    tbl.innerHTML = rows.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          <th style="padding:7px 8px">Group</th><th style="padding:7px 8px;text-align:right">Leads</th>
          <th style="padding:7px 8px;text-align:right">% of total</th></tr></thead>
        <tbody>${rows.map(x => `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:7px 8px">${esc(x.label)}
            <div style="height:3px;border-radius:2px;background:var(--primary);opacity:.5;margin-top:4px;width:${Math.round((x.count || 0) / max * 100)}%"></div></td>
          <td style="padding:7px 8px;text-align:right;font-weight:600">${(x.count || 0).toLocaleString()}</td>
          <td style="padding:7px 8px;text-align:right;color:var(--muted)">${d.totals?.count ? Math.round(x.count / d.totals.count * 100) : 0}%</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div style="color:var(--muted);font-size:13px;padding:16px;text-align:center">No leads in range.</div>';
  } catch (e) {
    tbl.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:12px">${esc(e.message)}</div>`;
  }
}

async function empLoadSalesReport() {
  if (!empCan('reports', 'sales')) return;
  const tbl = document.getElementById('emp-rep-sales-table');
  const kpi = document.getElementById('emp-rep-sales-kpis');
  tbl.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
  try {
    const r = await ef('/api/employee/reports/summary');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    kpi.innerHTML = empRepTile('Open pipeline', empRepEgp(d.totalPipeline))
      + empRepTile('Revenue won', empRepEgp(d.revenueWon), `${d.wonCount || 0} deal(s)`)
      + empRepTile('Win rate', (d.winRate || 0) + '%')
      + empRepTile('Avg deal', empRepEgp(d.avgDeal));
    const stages = d.pipelineByStage || [];
    tbl.innerHTML = stages.length ? `
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border)">
          <th style="padding:7px 8px">Stage</th><th style="padding:7px 8px;text-align:right">Deals</th>
          <th style="padding:7px 8px;text-align:right">Value</th></tr></thead>
        <tbody>${stages.map(s => `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:7px 8px;text-transform:capitalize">${esc(s.stage)}</td>
          <td style="padding:7px 8px;text-align:right;font-weight:600">${(s.count || 0).toLocaleString()}</td>
          <td style="padding:7px 8px;text-align:right">${empRepEgp(s.value)}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div style="color:var(--muted);font-size:13px;padding:16px;text-align:center">No deals yet.</div>';
  } catch (e) {
    tbl.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:12px">${esc(e.message)}</div>`;
  }
}

async function empExportLeadsReport() {
  if (!(empCan('reports', 'leads') && empCan('reports', 'export'))) return;
  const qs = new URLSearchParams({ groupBy: document.getElementById('emp-rep-groupby').value });
  const from = document.getElementById('emp-rep-from').value;
  const to = document.getElementById('emp-rep-to').value;
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  try {
    const r = await ef('/api/employee/reports/leads-export.csv?' + qs.toString());
    if (!r.ok) throw new Error('Export failed');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'leads-report.csv'; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert(e.message); }
}

async function loadEmpDeals() {
  await loadEmpCoworkers();
  // Best-effort: load the slim scoped lead list so the deal modal's lead picker is populated
  // (works for deal-creators even without full Leads access).
  // Its own array, not _empLeads. This used to overwrite the Leads table's rows with
  // the slim {id,name,phone} picker list, so coming back from Deals rendered — and now
  // would filter — against rows with no status, car or dates until the refetch landed.
  try { const L = await ef('/api/employee/lead-options').then(r => r.json()); if (Array.isArray(L)) _empLeadOptions = L; } catch (_) {}
  const kanban = document.getElementById('emp-deals-kanban');
  try {
    _empDeals = await ef('/api/employee/deals').then(r => r.json());
    if (_empDeals.error) throw new Error(_empDeals.error);
    empRenderDeals();
  } catch (e) {
    kanban.innerHTML = `<div style="color:var(--danger);padding:20px;font-size:13px">${esc(e.message)}</div>`;
  }
}

function empRenderDeals() {
  const kanban = document.getElementById('emp-deals-kanban');
  kanban.innerHTML = EMP_DEAL_STAGES.map(stage => {
    const stageDeals = _empDeals.filter(d => d.stage === stage);
    return `<div class="emp-deal-col" data-stage="${stage}" ondragover="empDealDragOver(event)" ondragleave="empDealDragLeave(event)" ondrop="empDealDrop(event,'${stage}')" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;min-height:160px;transition:outline .1s">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">${EMP_DEAL_STAGE_LABELS[stage]}</div>
        <div style="background:rgba(255,255,255,.07);border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700">${stageDeals.length}</div>
      </div>
      ${stageDeals.map(d => empDealCard(d)).join('')}
    </div>`;
  }).join('');
  requestAnimationFrame(() => lucide.createIcons());
}

function empDealCard(d) {
  const cust = d.customers;
  return `<div class="emp-deal-card" draggable="true" ondragstart="empDealDragStart(event,${d.id})" ondragend="empDealDragEnd(event)" style="background:var(--card,#18181b);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;cursor:grab">
    <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start">
      <div style="font-size:13px;font-weight:600;line-height:1.3">${esc(d.title)}</div>
      <div style="display:flex;gap:2px;flex-shrink:0">
        ${empCan('deals','edit') ? `<button onclick="event.stopPropagation();openEmpDealModal(${d.id})" title="Edit" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 4px"><i data-lucide="pencil" style="width:13px;height:13px"></i></button>` : ''}
        ${empCan('deals','delete') ? `<button onclick="event.stopPropagation();empRequestDeleteDeal(${d.id})" title="Request deletion" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:2px 4px"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>` : ''}
      </div>
    </div>
    ${cust ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">${esc(cust.name)}</div>` : ''}
    ${d.car_model ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(d.car_model)}</div>` : ''}
    ${d.budget_egp ? `<div style="font-size:12px;font-weight:700;color:var(--primary);margin-top:4px">${Number(d.budget_egp).toLocaleString()} EGP</div>` : ''}
  </div>`;
}

function empDealDragStart(e, id) { _empDragDealId = id; e.dataTransfer.effectAllowed = 'move'; }
function empDealDragEnd() { _empDragDealId = null; document.querySelectorAll('.emp-deal-col').forEach(c => c.style.outline = ''); }
function empDealDragOver(e) { e.preventDefault(); e.currentTarget.style.outline = '2px dashed var(--primary)'; e.currentTarget.style.outlineOffset = '-2px'; }
function empDealDragLeave(e) { e.currentTarget.style.outline = ''; }
async function empDealDrop(e, stage) {
  e.preventDefault(); e.currentTarget.style.outline = '';
  const id = _empDragDealId; _empDragDealId = null;
  if (!id) return;
  const d = _empDeals.find(x => x.id === id);
  if (!d || d.stage === stage) return;
  try {
    const updated = await ef(`/api/employee/deals/${id}`, { method: 'PUT', body: JSON.stringify({ stage }) }).then(r => r.json());
    if (updated?.error) throw new Error(updated.error);
    const i = _empDeals.findIndex(x => x.id === id); if (i >= 0) _empDeals[i] = updated;
    empRenderDeals();
  } catch (err) { showToast('Move failed: ' + err.message); }
}

function openEmpDealModal(id) {
  const d = id ? _empDeals.find(x => x.id === id) : null;
  document.getElementById('emd-title').textContent = d ? 'Edit Deal' : 'Add Deal';
  document.getElementById('emd-id').value = d?.id || '';
  const pick = document.getElementById('emd-customer');
  const pickFrom = (_empLeadOptions && _empLeadOptions.length) ? _empLeadOptions : (_empLeads || []);
  pick.innerHTML = '<option value="">— Select lead —</option>' + [...pickFrom].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(l => `<option value="${l.id}">${esc(l.name)}${l.phone ? ' · ' + esc(l.phone) : ''}</option>`).join('');
  if (d?.customer_id && !pick.querySelector(`option[value="${d.customer_id}"]`)) pick.insertAdjacentHTML('beforeend', `<option value="${d.customer_id}">${esc(d.customers?.name || ('#' + d.customer_id))}</option>`);
  pick.value = d?.customer_id ? String(d.customer_id) : '';
  document.getElementById('emd-title-input').value = d?.title || '';
  document.getElementById('emd-car').value = d?.car_model || '';
  document.getElementById('emd-budget').value = d?.budget_egp || '';
  document.getElementById('emd-stage').value = d?.stage || 'lead';
  document.getElementById('emd-notes').value = d?.notes || '';
  const asg = document.getElementById('emd-assignee');
  asg.innerHTML = '<option value="">— Unassigned —</option>' + (_empCoworkers || []).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
  asg.value = d?.assigned_to ? String(d.assigned_to) : '';
  document.getElementById('emp-deal-modal').style.display = 'flex';
}
async function saveEmpDeal() {
  const id = document.getElementById('emd-id').value;
  const payload = {
    customer_id: document.getElementById('emd-customer').value ? parseInt(document.getElementById('emd-customer').value) : null,
    title: document.getElementById('emd-title-input').value.trim(),
    car_model: document.getElementById('emd-car').value.trim(),
    budget_egp: document.getElementById('emd-budget').value ? parseInt(document.getElementById('emd-budget').value) : null,
    stage: document.getElementById('emd-stage').value,
    notes: document.getElementById('emd-notes').value.trim(),
    assigned_to: document.getElementById('emd-assignee').value || '',
  };
  if (!payload.customer_id) return showToast('Please select a lead.');
  if (!payload.title) return showToast('Title is required.');
  try {
    const url = id ? `/api/employee/deals/${id}` : '/api/employee/deals';
    const r = await ef(url, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); return showToast('Error: ' + (e.error || r.status)); }
    document.getElementById('emp-deal-modal').style.display = 'none';
    loadEmpDeals();
  } catch (e) { showToast('Error: ' + e.message); }
}
async function empRequestDeleteDeal(id) {
  const d = _empDeals.find(x => x.id === id);
  const reason = prompt(`Request deletion of deal "${d?.title || ('#' + id)}"?\nAn admin must approve before it is deleted.\n\nOptional reason:`);
  if (reason === null) return;
  try {
    const r = await ef('/api/employee/deletion-requests', { method: 'POST', body: JSON.stringify({ entity_type: 'deal', entity_id: id, reason }) });
    const dd = await r.json();
    if (!r.ok) return showToast('Error: ' + (dd.error || r.status));
    showToast(dd.duplicate ? 'A deletion request is already pending.' : 'Deletion request sent to admin.');
  } catch (e) { showToast('Error: ' + e.message); }
}

/* ── Email ── */
let emailMessages  = [];
let activeEmailId  = null;
let emailConnected = false;

async function loadEmail() {
  const c = document.getElementById('email-content');
  if (!c) return;
  c.innerHTML = '<div class="loading"><span class="spinner"></span> Loading email…</div>';
  try {
    const status = await ef('/api/employee/email/status').then(r => r.json());
    if (!status.configured) {
      c.innerHTML = `<div style="text-align:center;padding:60px 20px">
        <i data-lucide="mail" style="width:40px;height:40px;color:var(--muted);margin-bottom:12px"></i>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px">Email not configured</div>
        <div style="font-size:13px;color:var(--muted)">Google OAuth is not set up. Contact your admin.</div>
      </div>`;
      requestAnimationFrame(() => lucide.createIcons());
      return;
    }
    if (!status.connected) {
      c.innerHTML = `<div style="text-align:center;padding:60px 20px">
        <i data-lucide="mail" style="width:40px;height:40px;color:var(--muted);margin-bottom:12px"></i>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px">Connect Your Gmail</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:20px">Connect your Google account to access your personal inbox.</div>
        <a href="#" onclick="empConnectNav('/api/employee/email/connect');return false" class="btn btn-primary" style="text-decoration:none">
          <i data-lucide="mail" style="width:15px;height:15px"></i> Connect Gmail
        </a>
      </div>`;
      requestAnimationFrame(() => lucide.createIcons());
      return;
    }
    emailConnected = true;
    await renderEmailInbox(status);
  } catch (e) { c.innerHTML = `<div style="padding:20px;color:var(--danger);font-size:13px">${esc(e.message)}</div>`; }
}

async function renderEmailInbox(status) {
  const c = document.getElementById('email-content');
  c.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:34px;height:34px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff">${esc(status.name?.[0]||'?')}</div>
        <div><div style="font-weight:600;font-size:14px">${esc(status.name)}</div><div style="font-size:12px;color:var(--muted)">${esc(status.email)}</div></div>
      </div>
      <button class="btn btn-outline" style="font-size:12px" onclick="empEmailDisconnect()">Disconnect</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-size:14px;font-weight:600">Inbox</div>
      <div id="email-inbox-list"><div class="loading" style="padding:28px"><span class="spinner"></span> Loading messages…</div></div>
    </div>
    <!-- Email detail -->
    <div id="email-detail-panel" style="display:none;margin-top:16px">
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
          <button class="btn btn-outline btn-sm" onclick="emailCloseDetail()"><i data-lucide="arrow-left" style="width:14px;height:14px"></i> Back</button>
          <div id="email-detail-subject" style="font-size:15px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
        </div>
        <div id="email-detail-meta" style="font-size:12px;color:var(--muted);margin-bottom:16px;line-height:1.8"></div>
        <div id="email-detail-body" style="font-size:13px;line-height:1.7;overflow-x:auto;max-width:100%"></div>
        <!-- Reply -->
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
          <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Reply</div>
          <textarea id="email-reply-body" class="form-control" rows="4" placeholder="Write your reply…" style="resize:vertical;margin-bottom:10px"></textarea>
          <button class="btn btn-primary btn-sm" id="email-reply-btn" onclick="empSendReply()">
            <i data-lucide="send" style="width:14px;height:14px"></i> Send Reply
          </button>
        </div>
      </div>
    </div>`;
  requestAnimationFrame(() => lucide.createIcons());
  // Load messages
  try {
    emailMessages = await ef('/api/employee/email/messages').then(r => r.json());
    if (emailMessages.error) throw new Error(emailMessages.error);
    renderEmailList();
  } catch (e) { document.getElementById('email-inbox-list').innerHTML = `<div style="padding:20px;color:var(--danger);font-size:13px">${esc(e.message)}</div>`; }
}

function renderEmailList() {
  const list = document.getElementById('email-inbox-list');
  if (!list) return;
  if (!emailMessages.length) { list.innerHTML = '<div class="empty" style="padding:32px">No messages in inbox</div>'; return; }
  list.innerHTML = emailMessages.map(m => `
    <div onclick="openEmail('${m.id}')" style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;transition:background .15s;${activeEmailId===m.id?'background:var(--primary-glow);':''}" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background='${activeEmailId===m.id?'var(--primary-glow)':''}'" >
      <div style="display:flex;align-items:flex-start;gap:10px">
        ${m.unread ? '<div style="width:7px;height:7px;border-radius:50%;background:var(--primary);flex-shrink:0;margin-top:5px"></div>' : '<div style="width:7px;height:7px;flex-shrink:0;margin-top:5px"></div>'}
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px">
            <div style="font-size:13px;font-weight:${m.unread?700:500};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.from.replace(/<.*>/,'').trim()||m.from)}</div>
            <div style="font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0">${new Date(m.date).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</div>
          </div>
          <div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px">${esc(m.subject)}</div>
          <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.snippet)}</div>
        </div>
      </div>
    </div>`).join('');
}

async function openEmail(id) {
  activeEmailId = id;
  renderEmailList();
  const panel = document.getElementById('email-detail-panel');
  const body  = document.getElementById('email-detail-body');
  const subj  = document.getElementById('email-detail-subject');
  const meta  = document.getElementById('email-detail-meta');
  if (!panel) return;
  panel.style.display = '';
  body.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
  subj.textContent = '';
  meta.innerHTML = '';
  try {
    const msg = await ef(`/api/employee/email/messages/${id}`).then(r => r.json());
    if (msg.error) throw new Error(msg.error);
    subj.textContent = msg.subject;
    meta.innerHTML = `<div><strong>From:</strong> ${esc(msg.from)}</div><div><strong>To:</strong> ${esc(msg.to)}</div><div><strong>Date:</strong> ${esc(msg.date)}</div>`;
    if (msg.isHtml) {
      body.innerHTML = `<iframe srcdoc="${msg.body.replace(/"/g,'&quot;')}" style="width:100%;min-height:400px;border:none;border-radius:6px;background:#fff" sandbox="allow-same-origin"></iframe>`;
    } else {
      body.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;font-family:var(--font);color:var(--text)">${esc(msg.body)}</pre>`;
    }
    // store for reply
    panel.dataset.threadId   = msg.threadId || '';
    panel.dataset.messageId  = msg.messageId || '';
    panel.dataset.replyTo    = msg.from || '';
    requestAnimationFrame(() => lucide.createIcons());
  } catch (e) { body.innerHTML = `<div style="color:var(--danger);font-size:13px">${esc(e.message)}</div>`; }
}

function emailCloseDetail() {
  activeEmailId = null;
  const panel = document.getElementById('email-detail-panel');
  if (panel) panel.style.display = 'none';
  renderEmailList();
}

async function empSendReply() {
  const panel   = document.getElementById('email-detail-panel');
  const bodyTxt = document.getElementById('email-reply-body').value.trim();
  const btn     = document.getElementById('email-reply-btn');
  if (!bodyTxt) return;
  const to       = panel.dataset.replyTo;
  const threadId = panel.dataset.threadId;
  const inReplyTo = panel.dataset.messageId;
  const subjEl   = document.getElementById('email-detail-subject');
  const subject  = 'Re: ' + (subjEl?.textContent || '');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    const r = await ef('/api/employee/email/send', { method: 'POST', body: JSON.stringify({ to, subject, body: bodyTxt, threadId, inReplyTo }) });
    const d = await r.json();
    if (d.error) { alert('Error: ' + d.error); return; }
    document.getElementById('email-reply-body').value = '';
    btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px"></i> Sent!';
    lucide.createIcons({ nodes: [btn] });
    setTimeout(() => { btn.innerHTML = '<i data-lucide="send" style="width:14px;height:14px"></i> Send Reply'; lucide.createIcons({ nodes: [btn] }); }, 3000);
  } catch (e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; }
}

async function empEmailDisconnect() {
  await ef('/api/employee/email/disconnect', { method: 'POST' });
  emailConnected = false;
  loadEmail();
}

/* ── Quotation Draft ── */
// ── Quotation ─────────────────────────────────────────────────────────────────
// The whole builder lives in the shared quote.js now (one sheet, both portals,
// the PO/RFQ idiom). The ~450-line duplicate that sat here is gone; this
// binding provides the three portal-specific lists the sheet needs.
const MEETCFG = {
  people: async () => {
    const r = await ef('/api/employee/coworkers');
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  },
};
const QTCFG = {
  issuers: async () => [empInfo && empInfo.name].filter(Boolean),
  leads: async () => {
    const r = await ef('/api/employee/lead-options');
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  },
  people: async () => {
    const r = await ef('/api/employee/coworkers');
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  },
};


function addCustomSpecRow(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'qt-custom-spec-row';
  row.style.cssText = 'display:grid;grid-template-columns:1fr 36px;gap:8px;margin-bottom:8px;align-items:center';
  row.innerHTML = `
    <input class="form-input" placeholder="e.g. Incoterms: CIF">
    <button onclick="this.closest('.qt-custom-spec-row').remove()"
      style="background:rgba(248,113,113,.12);border:none;border-radius:6px;color:var(--danger);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i data-lucide="x" style="width:13px;height:13px"></i>
    </button>`;
  container.appendChild(row);
  requestAnimationFrame(() => lucide.createIcons());
}

/* ── PDF Scraper ── */
let empScrapeData = null;

async function empScrapeUrl() {
  const url  = document.getElementById('emp-scrape-url').value.trim();
  const btn  = document.getElementById('emp-scrape-btn');
  const stat = document.getElementById('emp-scrape-status');
  const res  = document.getElementById('emp-scrape-results');
  if (!url) { alert('Please enter a URL'); return; }
  res.style.display  = 'none';
  stat.style.display = 'block';
  stat.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:rgba(124,106,255,.08);border:1px solid rgba(124,106,255,.2);color:var(--primary)';
  stat.textContent   = 'Scraping… this may take 20–30 seconds';
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Scraping…';
  try {
    const data = await ef('/api/employee/pdf-scraper/scrape-url', { method: 'POST', body: JSON.stringify({ url }) }).then(r => r.json());
    if (data.error) throw new Error(data.error);
    empScrapeData = data;
    stat.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.2);color:var(--success)';
    stat.textContent   = `Done — ${data.trims?.length || 0} trim(s), ${data.specs?.length || 0} spec rows`;
    renderScrapeResults(data);
  } catch (e) {
    stat.style.cssText = 'display:block;padding:12px 16px;border-radius:8px;font-size:13px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);color:var(--danger)';
    stat.textContent = 'Error: ' + e.message;
  } finally { btn.disabled = false; btn.innerHTML = '<i data-lucide="search" style="width:15px;height:15px"></i> Scrape'; lucide.createIcons({ nodes: [btn] }); }
}

function renderScrapeResults(data) {
  const res = document.getElementById('emp-scrape-results');
  document.getElementById('emp-scrape-series').textContent = data.series_name || '';
  const trimsEl = document.getElementById('emp-scrape-trims');
  trimsEl.innerHTML = (data.trims || []).map(t =>
    `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:600">${esc(t.name)} <span style="color:var(--muted);font-weight:400">${t.price ? '¥' + t.price : ''}</span></div>`
  ).join('');
  const specs  = data.specs  || [];
  const trims  = data.trims  || [];
  const thead  = document.getElementById('emp-scrape-thead');
  const tbody  = document.getElementById('emp-scrape-tbody');
  thead.innerHTML = `<tr style="background:rgba(255,255,255,.03)"><th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--muted);font-weight:600;border-bottom:1px solid var(--border)">Spec</th>${trims.map(t => `<th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--muted);font-weight:600;border-bottom:1px solid var(--border)">${esc(t.name)}</th>`).join('')}</tr>`;
  tbody.innerHTML = specs.map(s =>
    `<tr style="border-bottom:1px solid rgba(255,255,255,.04)">
      <td style="padding:9px 12px;font-size:12px;font-weight:500">${esc(s.name)}</td>
      ${(s.values || []).map(v => `<td style="padding:9px 12px;font-size:12px;color:var(--muted)">${esc(v||'—')}</td>`).join('')}
    </tr>`
  ).join('');
  res.style.display = '';
  requestAnimationFrame(() => lucide.createIcons());
}

function empDownloadCsv() {
  if (!empScrapeData) return;
  const trims = empScrapeData.trims || [];
  const specs = empScrapeData.specs || [];
  const rows  = [['Spec', ...trims.map(t => t.name)], ...specs.map(s => [s.name, ...(s.values || [])])];
  const csv   = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob  = new Blob([csv], { type: 'text/csv' });
  const a     = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (empScrapeData.series_name || 'scrape') + '.csv';
  a.click();
}

// ── Auth helpers: forgot / reset password, Google login handling ───────────────
function showForgotPassword() {
  document.getElementById('login-form-panel').style.display = 'none';
  document.getElementById('forgot-form-panel').style.display = '';
  document.getElementById('reset-form-panel').style.display = 'none';
  document.getElementById('auth-err').style.display = 'none';
}
function showLoginForm() {
  document.getElementById('login-form-panel').style.display = '';
  document.getElementById('forgot-form-panel').style.display = 'none';
  document.getElementById('reset-form-panel').style.display = 'none';
  document.getElementById('auth-err').style.display = 'none';
}
async function submitForgotPassword() {
  const btn = document.getElementById('forgot-btn');
  const err = document.getElementById('auth-err');
  err.style.display = 'none';
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) { err.textContent = 'Please enter your email.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await fetch('/api/employee/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const d = await r.json();
    if (d.error) { err.textContent = d.error; err.style.display = 'block'; return; }
    err.style.cssText = 'display:block;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.25);color:var(--success);padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:16px';
    err.textContent = 'If an account with that email exists, a reset link has been sent.';
  } catch (e) { err.textContent = 'Connection error'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Send Reset Link'; }
}
function showResetPasswordForm(token) {
  window._resetToken = token;
  document.getElementById('login-form-panel').style.display = 'none';
  document.getElementById('forgot-form-panel').style.display = 'none';
  document.getElementById('reset-form-panel').style.display = '';
}
async function submitResetPassword() {
  const btn = document.getElementById('reset-btn');
  const err = document.getElementById('auth-err');
  err.style.display = 'none';
  const newPassword  = document.getElementById('reset-pass').value;
  const confirmPass  = document.getElementById('reset-pass2').value;
  if (!newPassword || newPassword.length < 8) { err.textContent = 'Password must be at least 8 characters.'; err.style.display = 'block'; return; }
  if (newPassword !== confirmPass) { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const r = await fetch('/api/employee/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: window._resetToken, newPassword }) });
    const d = await r.json();
    if (d.error) { err.textContent = d.error; err.style.display = 'block'; return; }
    err.style.cssText = 'display:block;background:rgba(52,211,153,.08);border:1px solid rgba(52,211,153,.25);color:var(--success);padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:16px';
    err.textContent = 'Password updated! You can now sign in.';
    setTimeout(showLoginForm, 2000);
    history.replaceState({}, '', '/employee');
  } catch (e) { err.textContent = 'Connection error'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Set Password'; }
}

// ── Change password (inside the app) ─────────────────────────────────────────
async function submitChangePassword() {
  const btn = document.getElementById('chpass-btn');
  const err = document.getElementById('chpass-err');
  const ok  = document.getElementById('chpass-ok');
  err.style.display = 'none'; ok.style.display = 'none';
  const currentPassword = document.getElementById('chpass-current').value;
  const newPassword     = document.getElementById('chpass-new').value;
  const confirmPass     = document.getElementById('chpass-confirm').value;
  if (!currentPassword) { err.textContent = 'Enter your current password.'; err.style.display = 'block'; return; }
  if (!newPassword || newPassword.length < 8) { err.textContent = 'New password must be at least 8 characters.'; err.style.display = 'block'; return; }
  if (newPassword !== confirmPass) { err.textContent = 'New passwords do not match.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const r = await ef('/api/employee/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    const d = await r.json();
    if (d.error) { err.textContent = d.error; err.style.display = 'block'; return; }
    ok.textContent = 'Password updated successfully!'; ok.style.display = 'block';
    document.getElementById('chpass-current').value = '';
    document.getElementById('chpass-new').value = '';
    document.getElementById('chpass-confirm').value = '';
  } catch (e) { err.textContent = 'Connection error'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Update Password'; }
}

// ── Google Meet helper ────────────────────────────────────────────────────────
function joinMeeting() {
  const code = document.getElementById('meet-code').value.trim().replace(/\s/g, '');
  if (!code) return;
  window.open('https://meet.google.com/' + code, '_blank', 'noopener');
}

// Initialize Lucide icons
lucide.createIcons();

// Handle URL params for Google login redirect and password reset
(function handleUrlParams() {
  const params = new URLSearchParams(location.search);
  const empToken_ = params.get('emp_token');
  const resetToken = params.get('reset');
  const googleErr = params.get('google_login_error');
  if (empToken_) {
    empToken = empToken_;
    localStorage.setItem('ml_emp_token', empToken);
    history.replaceState({}, '', '/employee');
  }
  if (googleErr) {
    history.replaceState({}, '', '/employee');
    document.getElementById('auth-err').textContent = decodeURIComponent(googleErr);
    document.getElementById('auth-err').style.display = 'block';
  }
  if (resetToken) {
    history.replaceState({}, '', '/employee');
    showResetPasswordForm(resetToken);
  }
})();

checkAuth();

// ── Chat ──────────────────────────────────────────────────────────────────────
let chatRooms        = [];
let activeChatRoomId = null;
let chatMessages     = [];
let chatSse          = null;
let chatPeople       = [];
let chatUnread       = new Set();
let chatReplyingTo   = null; // { id, sender, body }
let chatForwardData  = null; // { body, file_url, file_name, file_size, file_type }
let chatPushSubscription = null;
let chatTypingTimers     = {};
let chatHeartbeatTimer   = null;
let chatPresenceTimer    = null;
let chatVoiceRecorder    = null;
let chatVoiceChunks      = [];
let chatVoiceTimer       = null;
let chatVoiceSeconds     = 0;

function myChatKey() { return `employee_${empInfo.id}`; }

function openChatSse() {
  if (chatSse) { chatSse.close(); chatSse = null; }
  chatSse = chatStream(() => `/api/employee/chat/events?_t=${encodeURIComponent(empToken)}`, es => {
  es.addEventListener('message', e => {
    try {
      const { roomId, message } = JSON.parse(e.data);
      if (roomId === activeChatRoomId) {
        chatAppendMessage(message);
        chatScrollBottom();
      } else {
        chatUnread.add(roomId);
        chatMarkUnread(roomId);
        chatUpdateNavBadge();
        chatPlayNotifSound();
        chatShowNotification(message.sender_name, message.body, roomId);
      }
      chatUpdatePreview(roomId, message);
    } catch (_) {}
  });
  es.addEventListener('edit', e => {
    try {
      const { message } = JSON.parse(e.data);
      const el = document.querySelector(`[data-msg-id="${message.id}"]`);
      if (!el) return;
      const bubble = el.querySelector('.chat-msg-bubble');
      if (bubble) bubble.innerHTML = chatLinkify(message.body) + '<span class="chat-edited">(edited)</span>';
      const idx = chatMessages.findIndex(m => m.id === message.id);
      if (idx >= 0) chatMessages[idx] = message;
    } catch (_) {}
  });
  es.addEventListener('delete', e => {
    try {
      const { msgId } = JSON.parse(e.data);
      const el = document.querySelector(`[data-msg-id="${msgId}"]`);
      if (el) el.innerHTML = '<div class="chat-deleted">Message deleted</div>';
      const idx = chatMessages.findIndex(m => m.id === msgId);
      if (idx >= 0) chatMessages.splice(idx, 1);
    } catch (_) {}
  });
  es.addEventListener('typing', e => {
    try {
      const { roomId, senderName } = JSON.parse(e.data);
      if (roomId !== activeChatRoomId) return;
      const bar = document.getElementById('chat-typing-bar');
      if (bar) bar.textContent = `${senderName} is typing…`;
      clearTimeout(chatTypingTimers[roomId]);
      chatTypingTimers[roomId] = setTimeout(() => { if (bar) bar.textContent = ''; }, 3500);
    } catch (_) {}
  });
  // WebRTC signalling for huddles rides this same stream
  es.addEventListener('huddle', e => {
    try { huddleOnSignal(JSON.parse(e.data)); } catch (_) {}
  });
  // Membership or name changed — refresh the list, and the header if it's open
  es.addEventListener('room', e => {
    try {
      const { roomId } = JSON.parse(e.data);
      HDCFG.refreshRooms().then(() => {
        if (activeChatRoomId !== roomId) return;
        if (chatRooms.some(r => r.id === roomId)) chatOpenRoom(roomId);
        else chatBackToRooms();   // we were removed from it
      });
    } catch (_) {}
  });
  });
}

function closeChatSse() {
  if (chatSse) { chatSse.close(); chatSse = null; }
  activeChatRoomId = null;
}

// ── Notification center (bell + counter, always-open SSE after login) ──────────
let notifSse     = null;
let notifItems   = [];
let notifUnread  = 0;

function openNotifStream() {
  if (notifSse) { notifSse.close(); notifSse = null; }
  notifSse = chatStream(() => `/api/employee/notifications/stream?_t=${encodeURIComponent(empToken)}`, es => {
  // Huddle invites also arrive here, because the chat stream only exists while the
  // chat page is open — off that page an invite used to be dropped server-side with
  // nothing to show it. Only invites come this way; the signalling itself stays on
  // the chat stream.
  es.addEventListener('huddle', e => {
    try { hdRingOnce(JSON.parse(e.data)); } catch (_) {}
  });
  es.addEventListener('notification', e => {
    try {
      const n = JSON.parse(e.data);
      notifItems.unshift(n);
      if (notifItems.length > 50) notifItems.pop();
      if (!n.read) notifUnread++;
      renderNotifs();
      showToast(`${n.title}${n.body ? ' · ' + n.body : ''}`);
      if (n.type === 'task' || n.type === 'reminder') { loadMyTasks(); loadDropdownTasks(); }
    } catch (_) {}
  });
  });
}
function closeNotifStream() {
  if (notifSse) { notifSse.close(); notifSse = null; }
}

async function loadNotifs() {
  try {
    const r = await ef('/api/employee/notifications');
    if (!r.ok) return;
    const d = await r.json();
    notifItems  = d.items || [];
    notifUnread = d.unread || 0;
    renderNotifs();
  } catch (_) {}
}

function notifRelTime(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function notifIcon(type) {
  const m = { task: 'clipboard-list', reminder: 'alarm-clock', hours: 'clock', lead: 'contact-2', deal: 'kanban-square', request: 'inbox', issue: 'bug', followup: 'alarm-clock', huddle: 'headphones' };
  return m[type] || 'bell';
}
// Strip any leading emoji/symbols so legacy notifications render clean text (new ones already clean)
function notifCleanTitle(t) { return (t || '').replace(/^[^\p{L}\p{N}]+/u, '').trim() || (t || ''); }

function renderNotifs() {
  const badge = document.getElementById('notif-badge');
  if (badge) {
    if (notifUnread > 0) { badge.textContent = notifUnread > 99 ? '99+' : notifUnread; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  }
  const navBadge = document.getElementById('notif-nav-badge');
  if (navBadge) {
    if (notifUnread > 0) { navBadge.textContent = notifUnread > 99 ? '99+' : notifUnread; navBadge.style.display = 'inline'; }
    else navBadge.style.display = 'none';
  }
  const list = document.getElementById('notif-list');
  if (list) {
    if (!notifItems.length) { list.innerHTML = '<div class="notif-empty">No notifications yet</div>'; }
    else list.innerHTML = notifItems.slice(0, 20).map(n => `
      <div class="notif-item${n.read ? '' : ' unread'}" onclick="notifClick(${n.id ? `'${n.id}'` : 'null'}, '${encodeURIComponent(n.url || '/employee')}', '${esc(n.type || '')}')">
        <span class="notif-type-icon"><i data-lucide="${notifIcon(n.type)}"></i></span>
        <div class="notif-body">
          <div class="notif-title">${esc(notifCleanTitle(n.title))}</div>
          ${n.body ? `<div class="notif-text">${esc(n.body)}</div>` : ''}
          <div class="notif-time">${esc(notifRelTime(n.created_at))}</div>
        </div>
      </div>`).join('');
    requestAnimationFrame(() => lucide.createIcons());
  }
  if (_currentEmpPage === 'notif') renderNotifPage();
}

function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const willOpen = !panel.classList.contains('open');
  panel.classList.toggle('open', willOpen);
  if (willOpen && notifUnread > 0) markAllNotifsRead();
}

async function markAllNotifsRead() {
  if (notifUnread === 0) return;
  notifItems.forEach(n => n.read = true);
  notifUnread = 0;
  renderNotifs();
  try { await ef('/api/employee/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) }); } catch (_) {}
}

// Route a notification to the right page (hash first, then type fallback for legacy rows)
function notifRoute(url, type) {
  const hash = (url || '').split('#')[1];
  if (hash && pageTitles[hash]) { navigate(hash); return; }
  const map = { hours: 'log', task: 'tasks', reminder: 'tasks', lead: 'quotation', deal: 'deals', request: 'requests', followup: 'leads' };
  navigate(map[type] || 'log');
}
// Mark a single notification read (local + server)
async function notifMarkRead(id) {
  if (!id) return;
  const it = notifItems.find(n => String(n.id) === String(id));
  if (it && !it.read) { it.read = true; notifUnread = Math.max(0, notifUnread - 1); renderNotifs(); }
  if (String(id).startsWith('tmp-')) return; // live-only notification (not persisted) — nothing to mark on the server
  try { await ef('/api/employee/notifications/read', { method: 'POST', body: JSON.stringify({ id }) }); } catch (_) {}
}

function notifClick(id, urlEnc, type) {
  document.getElementById('notif-panel')?.classList.remove('open');
  notifMarkRead(id);
  notifRoute(decodeURIComponent(urlEnc || '/employee'), type);
}

async function loadNotifPage() {
  try {
    const r = await ef('/api/employee/notifications');
    if (r.ok) {
      const d = await r.json();
      notifItems  = d.items || [];
      notifUnread = d.unread || 0;
      renderNotifs();
    }
  } catch (_) {}
  renderNotifPage();
}

function renderNotifPage() {
  const container = document.getElementById('notif-center-list');
  if (!container) return;
  if (!notifItems.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:14px">No notifications yet</div>';
    return;
  }
  container.innerHTML = notifItems.map(n => {
    const urlEnc = encodeURIComponent(n.url || '/employee');
    const idStr = n.id ? `'${n.id}'` : 'null';
    return `<div class="notif-center-item${n.read ? '' : ' unread'}" onclick="notifCenterClick(${idStr},'${urlEnc}','${esc(n.type || '')}')">
      <span class="notif-type-icon" style="margin-top:2px">${!n.read ? '<span class="notif-unread-marker"></span>' : ''}<i data-lucide="${notifIcon(n.type)}"></i></span>
      <div style="flex:1;min-width:0">
        <div class="notif-title">${esc(notifCleanTitle(n.title))}</div>
        ${n.body ? `<div class="notif-text" style="margin-top:2px">${esc(n.body)}</div>` : ''}
        <div class="notif-time" style="margin-top:4px">${esc(notifRelTime(n.created_at))}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0;margin-left:8px">${new Date(n.created_at).toLocaleDateString()}</div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => lucide.createIcons());
}

function notifCenterClick(id, urlEnc, type) {
  notifMarkRead(id);
  notifRoute(decodeURIComponent(urlEnc || '/employee'), type);
}

// Close the panel when clicking outside it
document.addEventListener('click', e => {
  const wrap = document.querySelector('.notif-wrap');
  const panel = document.getElementById('notif-panel');
  if (panel?.classList.contains('open') && wrap && !wrap.contains(e.target)) panel.classList.remove('open');
});

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'emp-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 4000);
}

async function loadChat() {
  chatRequestNotifPermission();
  openChatSse();
  const r = await ef('/api/employee/chat/rooms');
  if (!r.ok) return;
  chatRooms = await r.json();
  chatRenderRoomList();
  chatUpdateNavBadge();
  // Mobile: show room list panel
  document.getElementById('chat-rooms-panel')?.classList.add('mob-show');
  document.getElementById('chat-main')?.classList.remove('mob-show');
}

function chatRenderRoomList() {
  const el = document.getElementById('chat-room-list');
  if (!el) return;
  if (!chatRooms.length) {
    el.innerHTML = '<div style="padding:28px 16px;font-size:12px;color:var(--muted);text-align:center">No conversations yet.<br>Tap the edit icon to start one.</div>';
    return;
  }
  el.innerHTML = chatRooms.map(room => {
    const myKey  = myChatKey();
    const other  = room.type === 'direct' ? (room.members || []).find(m => m.member_key !== myKey) : null;
    const name   = room.type === 'group' ? room.name : (other?.member_name || 'Unknown');
    const init   = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const prev   = room.lastMessage ? room.lastMessage.body.slice(0,55) : 'No messages yet';
    const unread = chatUnread.has(room.id) ? '<div class="chat-unread-dot"></div>' : '';
    return `<div class="chat-room-item${activeChatRoomId === room.id ? ' active' : ''}" onclick="chatOpenRoom(${room.id})" data-room="${room.id}">
      <div class="chat-room-avatar-wrap">
        <div class="chat-room-avatar${room.type === 'group' ? ' grp' : ''}">${other?.member_avatar ? `<img src="${esc(other.member_avatar)}" alt="">` : esc(init)}</div>
        ${room.type === 'direct' ? `<div class="presence-dot" id="presence-dot-${room.id}"></div>` : ''}
      </div>
      <div class="chat-room-info">
        <div class="chat-room-name">${esc(name)}${statusEmojiOnly(other?.member_status_emoji, other?.member_status)}</div>
        <div class="chat-room-preview">${esc(prev)}</div>
      </div>${unread}
    </div>`;
  }).join('');
  requestAnimationFrame(() => lucide.createIcons());
}

async function chatOpenRoom(roomId) {
  activeChatRoomId = roomId;
  chatReplyingTo = null;
  chatUnread.delete(roomId);
  chatUpdateNavBadge();
  document.querySelectorAll('.chat-room-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.room) === roomId));
  document.querySelector(`[data-room="${roomId}"] .chat-unread-dot`)?.remove();

  const room = chatRooms.find(r => r.id === roomId);
  const myKey = myChatKey();
  const name = room?.type === 'group' ? room.name : (room?.members || []).find(m => m.member_key !== myKey)?.member_name || 'Chat';

  // Mobile: swap panels
  document.getElementById('chat-rooms-panel')?.classList.remove('mob-show');
  const main = document.getElementById('chat-main');
  main.classList.add('mob-show');
  main.innerHTML = `
    <div class="chat-header">
      <button class="chat-back-btn" onclick="chatBackToRooms()" title="Back"><i data-lucide="arrow-left" style="width:18px;height:18px"></i></button>
      <div class="chat-room-avatar${room?.type === 'group' ? ' grp' : ''}" style="width:32px;height:32px;font-size:12px">${esc(name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase())}</div>
      <div style="min-width:0">
        <div class="chat-header-name">${esc(name)} ${chatHeaderStatus(room)}</div>
        <div class="chat-header-meta" id="chat-header-meta">${room?.type === 'group' ? `${(room.members||[]).length} members` : 'Direct message'}</div>
      </div>
      ${chatHeaderActions(room)}
    </div>
    <div class="chat-messages" id="chat-messages"><div class="loading"><span class="spinner"></span></div></div>
    <div id="chat-attach-preview" style="display:none" class="chat-attach-preview">
      <span><i data-lucide="paperclip" style="width:14px;height:14px"></i></span><span class="chat-attach-preview-name" id="chat-attach-name"></span>
      <button class="chat-attach-remove" onclick="chatRemoveAttach()" title="Remove">×</button>
    </div>
    <div class="chat-typing-bar" id="chat-typing-bar"></div>
    <div class="chat-recording-bar" id="chat-recording-bar">
      <span style="color:var(--danger);display:flex"><i data-lucide="circle-dot" style="width:15px;height:15px"></i></span>
      <span id="chat-rec-timer" class="chat-rec-timer">00:00</span>
      <span style="flex:1;color:var(--muted);font-size:11px">Recording…</span>
      <button onclick="chatCancelRecording()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:4px"><i data-lucide="x" style="width:12px;height:12px"></i> Cancel</button>
      <button onclick="chatStopRecording()" class="btn btn-primary btn-sm">Send <i data-lucide="check" style="width:12px;height:12px"></i></button>
    </div>
    <div class="chat-reply-bar" id="chat-reply-bar">
      <span style="color:var(--primary);display:flex"><i data-lucide="corner-up-left" style="width:14px;height:14px"></i></span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:11px" id="chat-reply-sender"></div>
        <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="chat-reply-body"></div>
      </div>
      <button onclick="chatClearReply()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px">✕</button>
    </div>
    <div class="chat-composer" style="position:relative">
      <div class="chat-emoji-wrap" id="chat-emoji-wrap">
        <div class="chat-emoji-grid" id="chat-emoji-grid"></div>
      </div>
      <input type="file" id="chat-file-input" style="display:none" onchange="chatFileSelected(this)">
      <button class="chat-attach-btn" data-perm="chat.upload" onclick="document.getElementById('chat-file-input').click()" title="Attach file"><i data-lucide="paperclip" style="width:15px;height:15px"></i></button>
      <button class="chat-emoji-btn" onclick="chatToggleEmoji()" title="Emoji"><i data-lucide="smile" style="width:15px;height:15px"></i></button>
      <textarea class="chat-input" id="chat-input" rows="1" placeholder="Message ${esc(name)}…" onkeydown="chatHandleKey(event)" oninput="chatHandleInput()"
        onpaste="chatUploadFilePaste(event)" ondrop="chatUploadFileDrop(event)" ondragover="event.preventDefault()"></textarea>
      <button class="chat-voice-btn" id="chat-voice-btn" data-perm="chat.upload" onclick="chatStartRecording()" title="Voice message"><i data-lucide="mic" style="width:15px;height:15px"></i></button>
      <button class="chat-send-btn" id="chat-send-btn" data-perm="chat.send" onclick="chatSend()" title="Send"><i data-lucide="send" style="width:15px;height:15px"></i></button>
    </div>`;
  applyActionPerms();   // this markup did not exist when permissions were applied
  requestAnimationFrame(() => lucide.createIcons());

  const r = await ef(`/api/employee/chat/rooms/${roomId}/messages`);
  if (!r.ok) return;
  chatMessages = await r.json();
  chatRenderMessages();
  chatScrollBottom();
  // Presence refresh for DMs
  if (chatPresenceTimer) { clearInterval(chatPresenceTimer); chatPresenceTimer = null; }
  const openedRoom = chatRooms.find(rr => rr.id === roomId);
  if (openedRoom?.type === 'direct') {
    chatRefreshPresence();
    chatPresenceTimer = setInterval(chatRefreshPresence, 30000);
  }
}

function chatBackToRooms() {
  if (chatPresenceTimer) { clearInterval(chatPresenceTimer); chatPresenceTimer = null; }
  activeChatRoomId = null;
  document.getElementById('chat-rooms-panel')?.classList.add('mob-show');
  document.getElementById('chat-main')?.classList.remove('mob-show');
}

function chatToggleActions(e) {
  if (e.target.closest('a, button, textarea, img, .chat-reply-quote')) return; // don't hijack links/edit/buttons/quote
  const m = e.currentTarget;
  document.querySelectorAll('.chat-msg.show-actions').forEach(x => { if (x !== m) x.classList.remove('show-actions'); });
  m.classList.toggle('show-actions');
}

function chatMsgHTML(msg, myKey) {
  const mine    = msg.sender_key === myKey;
  const timeStr = new Date(msg.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const canDel  = mine && (Date.now() - new Date(msg.created_at).getTime()) < 5 * 60 * 1000;
  const actions = `<div class="chat-msg-actions">
    <button class="chat-action-btn" onclick="chatSetReply(${msg.id})" title="Reply"><i data-lucide="corner-up-left" style="width:13px;height:13px"></i></button>
    <button class="chat-action-btn" onclick="chatForwardMsg(${msg.id})" title="Forward"><i data-lucide="corner-up-right" style="width:13px;height:13px"></i></button>
    ${mine ? `<button class="chat-action-btn" onclick="chatStartEdit(${msg.id})" title="Edit"><i data-lucide="pencil" style="width:13px;height:13px"></i></button>` : ''}
    ${mine && canDel ? `<button class="chat-action-btn" onclick="chatDeleteMsg(${msg.id})" title="Delete"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>` : ''}
  </div>`;
  const replyHTML = msg.reply_to_body ? `<div class="chat-reply-quote" onclick="chatScrollToMsg(${msg.reply_to_id})">
    <div class="chat-reply-quote-sender">${esc(msg.reply_to_sender || '')}</div>
    <div class="chat-reply-quote-body">${esc(msg.reply_to_body)}</div>
  </div>` : '';
  const dlBtn = msg.file_url ? `<button class="chat-download-btn" onclick="chatDownloadFile(${msg.id})" title="Download"><i data-lucide="download" style="width:13px;height:13px"></i></button>` : '';
  const fileHTML = msg.file_url ? (
    msg.file_type?.startsWith('image/')
      ? `<div><img src="${esc(msg.file_url)}" class="chat-img-thumb" onclick="window.open('${esc(msg.file_url)}','_blank')" loading="lazy"><div style="text-align:right">${dlBtn}</div></div>`
      : msg.file_type?.startsWith('audio/')
        ? `<div class="chat-voice-msg"><audio controls src="${esc(msg.file_url)}" preload="none"></audio>${msg.voice_duration ? `<span class="chat-voice-dur">${String(Math.floor(msg.voice_duration/60)).padStart(2,'0')}:${String(msg.voice_duration%60).padStart(2,'0')}</span>` : ''}${dlBtn}</div>`
        : `<div class="chat-file-attach"><i data-lucide="paperclip" style="width:13px;height:13px"></i> <a href="${esc(msg.file_url)}" target="_blank" rel="noopener">${esc(msg.file_name || 'File')}</a><span style="color:var(--muted);margin-left:auto">${msg.file_size ? (msg.file_size/1024/1024).toFixed(1)+'MB' : ''}</span>${dlBtn}</div>`
  ) : '';
  return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}" data-msg-id="${msg.id}" onclick="chatToggleActions(event)">
    ${actions}
    ${!mine ? `<div class="chat-msg-sender">${msg.sender_avatar ? `<img class="chat-msg-avatar" src="${esc(msg.sender_avatar)}" alt="">` : ''}${esc(msg.sender_name)}${statusEmojiOnly(msg.sender_status_emoji, msg.sender_status)}</div>` : ''}
    ${replyHTML}
    ${msg.body ? `<div class="chat-msg-bubble">${chatLinkify(msg.body)}${msg.edited_at ? '<span class="chat-edited">(edited)</span>' : ''}</div>` : ''}
    ${msg.body ? googleUnfurl(msg.body) + chatPreviewSlot(msg.body) : ''}
    ${fileHTML}
    <div class="chat-msg-time">${timeStr}</div>
  </div>`;
}

function chatScrollToMsg(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior:'smooth', block:'center' });
  el.style.transition = 'background .3s';
  el.style.background = 'rgba(124,106,255,.15)';
  setTimeout(() => { el.style.background = ''; }, 900);
}

function chatRenderMessages() {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  const myKey = myChatKey();
  let lastDate = '';
  el.innerHTML = chatMessages.map(msg => {
    const d       = new Date(msg.created_at);
    const dateStr = d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
    let div = '';
    if (dateStr !== lastDate) { lastDate = dateStr; div = `<div class="chat-date-divider">${dateStr}</div>`; }
    return div + chatMsgHTML(msg, myKey);
  }).join('');
  chatHydratePreviews(el, ef, '/api/employee');
}

function chatAppendMessage(msg) {
  chatMessages.push(msg);
  const el = document.getElementById('chat-messages');
  if (!el) return;
  el.insertAdjacentHTML('beforeend', chatMsgHTML(msg, myChatKey()));
  chatHydratePreviews(el, ef, '/api/employee');
}

function chatScrollBottom() {
  const el = document.getElementById('chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

let chatPendingFile = null; // { url, name, size, type }

function chatFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  chatUploadFile(file);
}

// Takes a File rather than an <input>, so the picker, a pasted screenshot and a
// dropped image all go the same way.
async function chatUploadFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('File must be under 10 MB'); return; }
  const btn = document.getElementById('chat-send-btn');
  if (btn) btn.disabled = true;
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/employee/chat/upload', { method:'POST', body: fd, headers: { 'Authorization': 'Bearer ' + empToken } });
    const d = await r.json();
    if (d.error) { alert('Upload failed: ' + d.error); return; }
    chatPendingFile = d;
    chatUploadFilePreview(d);
  } catch (e) { alert('Upload failed: ' + e.message); }
  finally { if (btn) btn.disabled = false; }
}

// A pasted screenshot has no filename worth reading, so show the picture itself.
function chatUploadFilePreview(d) {
  const wrap = document.getElementById('chat-attach-preview');
  const nameEl = document.getElementById('chat-attach-name');
  if (nameEl) nameEl.textContent = d.name || 'Attachment';
  if (wrap) {
    const old = wrap.querySelector('.chat-attach-thumb');
    if (old) old.remove();
    if ((d.type || '').startsWith('image/') && d.url) {
      const img = document.createElement('img');
      img.className = 'chat-attach-thumb';
      img.src = d.url;
      wrap.insertBefore(img, wrap.firstChild);
    }
    wrap.style.display = 'flex';
  }
}

// Paste and drop into the composer. A paste with no image is left entirely alone so
// pasting text keeps working.
function chatUploadFilePaste(e) {
  const file = chatImageFromPaste(e);
  if (!file) return;
  e.preventDefault();
  chatUploadFile(file);
}
function chatUploadFileDrop(e) {
  const file = chatImageFromDrop(e);
  if (!file) return;
  e.preventDefault();
  chatUploadFile(file);
}

function chatRemoveAttach() {
  chatPendingFile = null;
  const _thumb = document.querySelector('#chat-attach-preview .chat-attach-thumb');
  if (_thumb) _thumb.remove();
  document.getElementById('chat-attach-preview').style.display = 'none';
}

async function chatSend() {
  const input = document.getElementById('chat-input');
  if (!input || !activeChatRoomId) return;
  const body = input.value.trim();
  if (!body && !chatPendingFile) return;
  input.value = '';
  chatAutoGrow(input);
  const payload = { body };
  if (chatPendingFile) { payload.file_url = chatPendingFile.url; payload.file_name = chatPendingFile.name; payload.file_size = chatPendingFile.size; payload.file_type = chatPendingFile.type; }
  if (chatReplyingTo) { payload.reply_to_id = chatReplyingTo.id; payload.reply_to_sender = chatReplyingTo.sender; payload.reply_to_body = chatReplyingTo.body; }
  chatRemoveAttach();
  chatClearReply();
  const btn = document.getElementById('chat-send-btn');
  if (btn) btn.disabled = true;
  try {
    const r = await ef(`/api/employee/chat/rooms/${activeChatRoomId}/messages`, { method:'POST', body:JSON.stringify(payload) });
    if (r.ok) {
      const msg = await r.json();
      chatAppendMessage(msg);
      chatScrollBottom();
      chatUpdatePreview(activeChatRoomId, msg);
    }
  } finally {
    if (btn) btn.disabled = false;
    input.focus();
  }
}

function chatHandleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } }
function chatAutoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 110) + 'px'; }
function chatHandleInput() {
  const el = document.getElementById('chat-input');
  if (el) chatAutoGrow(el);
  if (!activeChatRoomId) return;
  if (chatHandleInput._t) return;
  chatHandleInput._t = setTimeout(() => { chatHandleInput._t = null; }, 2000);
  ef(`/api/employee/chat/rooms/${activeChatRoomId}/typing`, { method:'POST' }).catch(() => {});
}

function chatUpdatePreview(roomId, message) {
  const room = chatRooms.find(r => r.id === roomId);
  if (room) room.lastMessage = message;
  const el = document.querySelector(`[data-room="${roomId}"] .chat-room-preview`);
  if (el) el.textContent = message.body.slice(0, 55);
}

function chatMarkUnread(roomId) {
  const el = document.querySelector(`[data-room="${roomId}"]`);
  if (el && !el.querySelector('.chat-unread-dot')) el.insertAdjacentHTML('beforeend', '<div class="chat-unread-dot"></div>');
  chatUpdateNavBadge();
}

function chatUpdateNavBadge() {
  const el = document.getElementById('chat-nav-badge');
  if (!el) return;
  const count = chatUnread.size;
  el.textContent = count > 99 ? '99+' : String(count);
  el.style.display = count > 0 ? 'flex' : 'none';
}

// ── Reply ─────────────────────────────────────────────────────────────────────
function chatSetReply(msgId) {
  const msg = chatMessages.find(m => m.id === msgId);
  if (!msg) return;
  const body = (msg.body || (msg.file_url ? (msg.file_name || 'Attachment') : '')).slice(0, 80);
  chatReplyingTo = { id: msg.id, sender: msg.sender_name, body };
  document.getElementById('chat-reply-sender').textContent = msg.sender_name;
  document.getElementById('chat-reply-body').textContent = body;
  document.getElementById('chat-reply-bar')?.classList.add('visible');
  document.getElementById('chat-input')?.focus();
}

function chatClearReply() {
  chatReplyingTo = null;
  document.getElementById('chat-reply-bar')?.classList.remove('visible');
}

// ── Download ──────────────────────────────────────────────────────────────────
async function chatDownloadFile(msgId) {
  const msg = chatMessages.find(m => m.id === msgId);
  if (!msg || !msg.file_url) return;
  const url = msg.file_url, name = msg.file_name || 'file';
  try {
    const r = await fetch(url);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (_) { window.open(url, '_blank'); }
}

// ── Forward ───────────────────────────────────────────────────────────────────
function chatForwardMsg(msgId) {
  const msg = chatMessages.find(m => m.id === msgId);
  if (!msg) return;
  chatForwardData = { body: msg.body, file_url: msg.file_url, file_name: msg.file_name, file_size: msg.file_size, file_type: msg.file_type };
  const list = document.getElementById('chat-forward-room-list');
  const myKey = myChatKey();
  list.innerHTML = chatRooms.filter(r => r.id !== activeChatRoomId).map(r => {
    const name = r.type === 'group' ? r.name : (r.members||[]).find(m => m.member_key !== myKey)?.member_name || 'Chat';
    return `<button class="btn btn-outline" style="justify-content:flex-start;text-align:left;width:100%" onclick="chatForwardTo(${r.id})">${esc(name)}</button>`;
  }).join('');
  if (!list.innerHTML) list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No other conversations yet.</div>';
  document.getElementById('chat-forward-modal').style.display = 'flex';
}

async function chatForwardTo(roomId) {
  document.getElementById('chat-forward-modal').style.display = 'none';
  if (!chatForwardData) return;
  const payload = { body: chatForwardData.body ? `↪ ${chatForwardData.body}` : '' };
  if (chatForwardData.file_url) { payload.file_url = chatForwardData.file_url; payload.file_name = chatForwardData.file_name; payload.file_size = chatForwardData.file_size; payload.file_type = chatForwardData.file_type; }
  const fwd = chatForwardData;
  chatForwardData = null;
  const r = await ef(`/api/employee/chat/rooms/${roomId}/messages`, { method:'POST', body:JSON.stringify(payload) });
  if (r.ok && roomId === activeChatRoomId) { const msg = await r.json(); chatAppendMessage(msg); chatScrollBottom(); chatUpdatePreview(roomId, msg); }
}

// ── Notifications ─────────────────────────────────────────────────────────────
async function chatRequestNotifPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted' && _swReg) chatSubscribePush(_swReg);
  } catch (_) {}
}

function chatPlayNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

function chatShowNotification(senderName, body, roomId) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return; // only when tab is in background
  try {
    const n = new Notification(senderName || 'New message', { body: (body || '').slice(0, 80) || '📎 Attachment' });
    n.onclick = () => { window.focus(); navigate('chat'); chatOpenRoom(roomId); n.close(); };
  } catch (_) {}
}

async function showNewDmModal() {
  if (!chatPeople.length) {
    const r = await ef('/api/employee/chat/people');
    chatPeople = r.ok ? await r.json() : [];
  }
  const sel = document.getElementById('dm-target-select');
  if (!sel) return;
  sel.innerHTML = chatPeople.map(p => `<option value="${esc(p.key)}" data-name="${esc(p.name)}">${esc(p.name)} (${esc(p.role)})</option>`).join('');
  document.getElementById('new-dm-modal').style.display = 'flex';
}

function closeNewDmModal() { document.getElementById('new-dm-modal').style.display = 'none'; }

async function startDm() {
  const sel = document.getElementById('dm-target-select');
  const targetKey  = sel.value;
  const targetName = sel.options[sel.selectedIndex]?.dataset.name || targetKey;
  closeNewDmModal();
  const r = await ef('/api/employee/chat/rooms/direct', { method:'POST', body:JSON.stringify({ targetKey, targetName }) });
  if (!r.ok) return;
  const room = await r.json();
  // Attach members so name resolves correctly before rooms are re-fetched
  room.members = [{ member_key: myChatKey(), member_name: empInfo.name }, { member_key: targetKey, member_name: targetName }];
  if (!chatRooms.find(rr => rr.id === room.id)) { chatRooms.unshift(room); chatRenderRoomList(); }
  chatOpenRoom(room.id);
}

// ── Edit / Delete ─────────────────────────────────────────────────────────────
function chatStartEdit(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const bubble = el.querySelector('.chat-msg-bubble');
  const orig   = chatMessages.find(m => m.id === msgId)?.body || '';
  bubble.innerHTML = `<textarea class="chat-edit-input" id="edit-input-${msgId}" rows="1">${esc(orig)}</textarea>
    <div class="chat-edit-actions">
      <button class="btn btn-sm btn-outline" onclick="chatCancelEdit(${msgId}, ${JSON.stringify(orig)})">Cancel</button>
      <button class="btn btn-sm btn-primary" onclick="chatSaveEdit(${msgId})">Save</button>
    </div>`;
  const ta = document.getElementById(`edit-input-${msgId}`);
  if (ta) { ta.style.height = ta.scrollHeight + 'px'; ta.focus(); ta.selectionStart = ta.value.length; }
}

function chatCancelEdit(msgId, orig) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const msg = chatMessages.find(m => m.id === msgId);
  const bubble = el.querySelector('.chat-msg-bubble');
  if (bubble) bubble.innerHTML = chatLinkify(orig) + (msg?.edited_at ? '<span class="chat-edited">(edited)</span>' : '');
}

async function chatSaveEdit(msgId) {
  const ta = document.getElementById(`edit-input-${msgId}`);
  if (!ta) return;
  const body = ta.value.trim();
  if (!body) return;
  const r = await ef(`/api/employee/chat/rooms/${activeChatRoomId}/messages/${msgId}`, { method:'PATCH', body:JSON.stringify({ body }) });
  if (!r.ok) { alert('Edit failed'); return; }
  const updated = await r.json();
  const idx = chatMessages.findIndex(m => m.id === msgId);
  if (idx >= 0) chatMessages[idx] = updated;
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) {
    const bubble = el.querySelector('.chat-msg-bubble');
    if (bubble) bubble.innerHTML = chatLinkify(updated.body) + '<span class="chat-edited">(edited)</span>';
  }
}

async function chatDeleteMsg(msgId) {
  if (!confirm('Delete this message?')) return;
  const r = await ef(`/api/employee/chat/rooms/${activeChatRoomId}/messages/${msgId}`, { method:'DELETE' });
  if (!r.ok) { const d = await r.json(); alert(d.error || 'Delete failed'); return; }
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (el) el.innerHTML = '<div class="chat-deleted">Message deleted</div>';
  const idx = chatMessages.findIndex(m => m.id === msgId);
  if (idx >= 0) chatMessages.splice(idx, 1);
}

// ── Emoji picker ──────────────────────────────────────────────────────────────
const CHAT_EMOJIS = ['😀','😂','😍','😎','🥳','😢','😡','🤔','👍','👎','👏','🙏','🔥','❤️','💯','✅','❌','⚠️','🎉','🎊','💪','🤝','👀','💬','📎','📁','🚀','⏰','📌','🔗','😊','🥰','😇','🤩','😏','😤','🤣','😅','😬','🤐','😴','🤮','💀','👻','🤖','🎯','💡','📊','🛠️','🔑'];

function chatInitEmoji() {
  const grid = document.getElementById('chat-emoji-grid');
  if (!grid || grid.childElementCount) return;
  grid.innerHTML = CHAT_EMOJIS.map(e => `<button type="button" onclick="chatInsertEmoji('${e}')">${e}</button>`).join('');
}

function chatToggleEmoji() {
  chatInitEmoji();
  document.getElementById('chat-emoji-wrap')?.classList.toggle('open');
}

function chatInsertEmoji(e) {
  const ta = document.getElementById('chat-input');
  if (!ta) return;
  const s = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + e + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = s + e.length;
  ta.focus();
  chatAutoGrow(ta);
}

pageTitles['chat'] = 'Chat';
pageLoaders['chat'] = loadChat;

// ── Help Bot (bilingual EN/AR support assistant) ────────────────────────────
const HELP_API = '/api/employee/help/chat';
let _helpHistory = [];
let _helpLang = 'auto';
let _helpBusy = false;
function helpInit() {
  if (document.getElementById('hb-root')) return;
  const style = document.createElement('style');
  style.textContent = `
    .hb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9994;opacity:0;pointer-events:none;transition:opacity .2s}
    .hb-overlay.open{opacity:1;pointer-events:auto}
    .hb-panel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:96vw;background:var(--surface,#141416);border-left:1px solid rgba(201,163,94,.3);z-index:9995;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.16,1,.3,1);box-shadow:-16px 0 48px rgba(0,0,0,.5)}
    .hb-panel.open{transform:translateX(0)}
    .hb-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:16px 18px;border-bottom:1px solid var(--border,#2a2a2e)}
    .hb-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
    .hb-tabs{display:flex;gap:4px;padding:10px 14px 0;border-bottom:1px solid var(--border,#2a2a2e)}
    .hb-tab{background:none;border:none;border-bottom:2px solid transparent;color:var(--muted,#9a958a);
            font-size:12.5px;font-weight:700;padding:7px 12px;cursor:pointer}
    .hb-tab.active{color:var(--text,#e8e4da);border-bottom-color:var(--primary,#c9a35e)}
    .hb-docs{flex:1;overflow-y:auto;padding:14px;display:none;flex-direction:column;gap:10px}
    .hb-docs.open{display:flex}
    .hb-search{background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);
               border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit}
    .hb-doc{display:block;width:100%;text-align:start;background:none;border:1px solid var(--border,#2a2a2e);
            border-radius:9px;padding:10px 12px;color:inherit;cursor:pointer;margin-bottom:7px}
    .hb-doc:hover{border-color:var(--primary,#c9a35e)}
    .hb-doc-t{font-size:13px;font-weight:700}
    .hb-doc-s{font-size:11.5px;color:var(--muted,#9a958a);margin-top:3px;
              display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .hb-art h3{font-size:14px;margin:16px 0 6px}
    .hb-art p{font-size:13px;line-height:1.65;margin:0 0 9px}
    .hb-art li{font-size:13px;line-height:1.65;margin-bottom:4px}
    .hb-art[dir="rtl"]{text-align:right}
    .hb-back{background:none;border:none;color:var(--primary,#c9a35e);font-size:12px;cursor:pointer;padding:0 0 8px}
    .hb-msg{max-width:86%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
    .hb-msg.user{align-self:flex-end;background:var(--primary,#c9a35e);color:#0c0c0e;border-bottom-right-radius:4px}
    .hb-msg.bot{align-self:flex-start;background:rgba(255,255,255,.06);color:var(--text,#e8e4da);border-bottom-left-radius:4px}
    .hb-msg.ar{direction:rtl;text-align:right}
    .hb-chip{display:inline-block;margin:4px 4px 0 0;padding:6px 10px;font-size:12px;border:1px solid var(--border,#2a2a2e);border-radius:16px;cursor:pointer;color:var(--muted,#9a958a);background:none}
    .hb-chip:hover{border-color:var(--primary,#c9a35e);color:var(--primary,#c9a35e)}
    .hb-composer{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border,#2a2a2e)}
    .hb-composer textarea{flex:1;resize:none;background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;max-height:120px}
    .hb-send{background:var(--primary,#c9a35e);color:#0c0c0e;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:700}
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hb-root';
  root.innerHTML = `
    <div class="hb-overlay" id="hb-overlay" onclick="helpClose()"></div>
    <div class="hb-panel" id="hb-panel">
      <div class="hb-head">
        <div style="font-weight:800;font-size:15px">Help · مساعدة</div>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="hb-lang" onchange="_helpLang=this.value" style="background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:8px;padding:4px 6px">
            <option value="auto">Auto</option><option value="en">EN</option><option value="ar">AR</option>
          </select>
          <button onclick="helpClose()" style="background:none;border:none;color:var(--muted,#9a958a);font-size:22px;cursor:pointer;line-height:1">×</button>
        </div>
      </div>
      <div class="hb-tabs">
        <button class="hb-tab active" data-tab="docs" onclick="helpTab('docs')">Docs</button>
        <button class="hb-tab" data-tab="ask" onclick="helpTab('ask')">Ask</button>
      </div>
      <div class="hb-docs" id="hb-docs">
        <input class="hb-search" id="hb-search" placeholder="Search the docs…" oninput="helpDocSearch(this.value)">
        <div id="hb-doc-list"></div>
        <div id="hb-doc-view" style="display:none"></div>
      </div>
      <div class="hb-body" id="hb-body"></div>
      <div class="hb-composer">
        <textarea id="hb-input" rows="1" placeholder="Ask about the system… · اسأل عن النظام…" onkeydown="helpKey(event)"></textarea>
        <button class="hb-send" onclick="helpSend()"><i data-lucide="send" style="width:16px;height:16px"></i></button>
      </div>
    </div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => { try { lucide.createIcons(); } catch (_) {} });
}
// ── Help centre docs ──────────────────────────────────────────────────────────
// Articles come from public/help-docs.js, shared by both portals. The bot stays
// on its own tab; this one is plain reading and search.
let _helpTab = 'docs';
function helpTab(which) {
  _helpTab = which;
  document.querySelectorAll('.hb-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === which));
  document.getElementById('hb-docs').classList.toggle('open', which === 'docs');
  document.getElementById('hb-body').style.display = which === 'docs' ? 'none' : 'flex';
  document.querySelector('.hb-composer').style.display = which === 'docs' ? 'none' : 'flex';
  if (which === 'docs') helpDocSearch(document.getElementById('hb-search').value || '');
}
function helpDocLang() {
  const v = (document.getElementById('hb-lang') || {}).value || 'auto';
  if (v === 'en' || v === 'ar') return v;
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
function helpDocSearch(q) {
  const lang = helpDocLang();
  const docs = window.HELP_DOCS || [];
  const term = String(q || '').trim().toLowerCase();
  const hits = docs.filter(d => !term
    || (d.title[lang] || '').toLowerCase().includes(term)
    || (d.body[lang] || '').toLowerCase().includes(term)
    || (d.title.en || '').toLowerCase().includes(term));
  document.getElementById('hb-doc-view').style.display = 'none';
  const list = document.getElementById('hb-doc-list');
  list.style.display = '';
  list.innerHTML = hits.length
    ? hits.map(d => `<button class="hb-doc" onclick="helpDocOpen('${d.id}')" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
        <div class="hb-doc-t">${esc(d.title[lang] || d.title.en)}</div>
        <div class="hb-doc-s">${esc((d.body[lang] || '').replace(/[#*-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110))}</div>
      </button>`).join('')
    : '<div style="font-size:12.5px;color:var(--muted);padding:8px">Nothing matched that.</div>';
}
// A deliberately small markdown subset — ## heading, - bullet, **bold**
function helpDocRender(md) {
  const out = [];
  let ul = false;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    const bold = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (line.startsWith('## ')) { if (ul) { out.push('</ul>'); ul = false; } out.push('<h3>' + bold(line.slice(3)) + '</h3>'); }
    else if (line.startsWith('- ')) { if (!ul) { out.push('<ul>'); ul = true; } out.push('<li>' + bold(line.slice(2)) + '</li>'); }
    else if (!line) { if (ul) { out.push('</ul>'); ul = false; } }
    else { if (ul) { out.push('</ul>'); ul = false; } out.push('<p>' + bold(line) + '</p>'); }
  }
  if (ul) out.push('</ul>');
  return out.join('');
}
function helpDocOpen(id) {
  const lang = helpDocLang();
  const d = (window.HELP_DOCS || []).find(x => x.id === id);
  if (!d) return;
  document.getElementById('hb-doc-list').style.display = 'none';
  const v = document.getElementById('hb-doc-view');
  v.style.display = '';
  v.innerHTML = `<button class="hb-back" onclick="helpDocSearch(document.getElementById('hb-search').value||'')">&larr; All articles</button>
    <div class="hb-art" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
      <h3 style="margin-top:0">${esc(d.title[lang] || d.title.en)}</h3>
      ${helpDocRender(d.body[lang] || d.body.en)}
    </div>`;
}

function helpOpen() {
  helpInit();
  document.getElementById('hb-overlay').classList.add('open');
  document.getElementById('hb-panel').classList.add('open');
  if (!_helpHistory.length) helpWelcome();
  helpTab(_helpTab);
  setTimeout(() => document.getElementById('hb-input')?.focus(), 120);
}
function helpClose() {
  document.getElementById('hb-overlay')?.classList.remove('open');
  document.getElementById('hb-panel')?.classList.remove('open');
}
function helpWelcome() {
  const chips = ['Add lead', 'Edit quotation', 'عرض سعر', 'متابعة'];
  document.getElementById('hb-body').innerHTML =
    `<div class="hb-msg bot">👋 Hi! I'm the Help Bot — ask me anything about using the system, in English or العربية.<br><br>مرحباً! أنا مساعد النظام، اسألني عن أي شيء داخل النظام بالعربية أو الإنجليزية.</div>
     <div>${chips.map(c => `<span class="hb-chip" onclick="helpChip(this)">${esc(c)}</span>`).join('')}</div>`;
}
function helpChip(el) { const i = document.getElementById('hb-input'); i.value = el.textContent; helpSend(); }
function helpAppend(text, who, source) {
  const body = document.getElementById('hb-body');
  const isAr = /[؀-ۿ]/.test(text);
  const div = document.createElement('div');
  div.className = 'hb-msg ' + (who === 'user' ? 'user' : 'bot') + (isAr ? ' ar' : '');
  div.textContent = text;
  if (who === 'bot' && source) {
    const tag = document.createElement('div');
    tag.textContent = source === 'ai' ? 'AI' : 'Guide';
    tag.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:.05em;opacity:.5;margin-top:4px';
    div.appendChild(tag);
  }
  body.appendChild(div); body.scrollTop = body.scrollHeight;
  return div;
}
function helpKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); helpSend(); } }
async function helpSend() {
  if (_helpBusy) return;
  const input = document.getElementById('hb-input');
  const msg = (input.value || '').trim();
  if (!msg) return;
  const chip = document.querySelector('#hb-body .hb-chip'); if (chip) chip.parentElement.remove();
  input.value = '';
  helpAppend(msg, 'user');
  _helpHistory.push({ role: 'user', content: msg });
  _helpBusy = true;
  const typing = helpAppend('…', 'bot');
  try {
    const r = await ef(HELP_API, { method: 'POST', body: JSON.stringify({ message: msg, history: _helpHistory.slice(-8), lang: _helpLang === 'auto' ? undefined : _helpLang }) });
    const d = await r.json();
    const ans = d.answer || d.error || 'Sorry, something went wrong.';
    typing.remove();
    helpAppend(ans, 'bot', d.source);
    _helpHistory.push({ role: 'bot', content: ans });
  } catch (e) {
    typing.remove(); helpAppend('Network error: ' + e.message, 'bot');
  } finally { _helpBusy = false; }
}
document.addEventListener('DOMContentLoaded', helpInit);

// ── PWA: Standalone detection ──────────────────────────────────────────────
(function detectStandalone() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;
  if (isStandalone) document.body.classList.add('standalone');
  window.matchMedia('(display-mode: standalone)').addEventListener('change', e => {
    document.body.classList.toggle('standalone', e.matches);
  });
})();

// ── PWA: Service Worker ────────────────────────────────────────────────────
let _swReg = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw-employee.js', { scope: '/employee' });
      _swReg = reg;
      chatSubscribePush(reg);
    } catch (err) { console.warn('SW registration failed:', err); }
  });
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'open_chat_room') { navigate('chat'); chatOpenRoom(e.data.roomId); }
  });
}

async function chatSubscribePush(reg) {
  try {
    if (!('PushManager' in window)) return;
    const res = await fetch('/api/push/vapid-public-key');
    const { key } = await res.json();
    if (!key) return;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    chatPushSubscription = sub;
    await ef('/api/employee/push/subscribe', { method:'POST', body:JSON.stringify(sub.toJSON()) });
  } catch (_) {}
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// ── Presence heartbeat ─────────────────────────────────────────────────────
function startPresenceHeartbeat() {
  if (chatHeartbeatTimer) return;
  ef('/api/employee/presence/heartbeat', { method:'POST' }).catch(() => {});
  chatHeartbeatTimer = setInterval(() => {
    ef('/api/employee/presence/heartbeat', { method:'POST' }).catch(() => {});
  }, 30000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(chatHeartbeatTimer); chatHeartbeatTimer = null;
  } else {
    startPresenceHeartbeat();
  }
});

async function chatRefreshPresence() {
  if (!activeChatRoomId) return;
  const room = chatRooms.find(r => r.id === activeChatRoomId);
  if (!room || room.type !== 'direct') return;
  const myKey = myChatKey();
  const otherKey = (room.members || []).find(m => m.member_key !== myKey)?.member_key;
  if (!otherKey) return;
  try {
    const data = await (await ef(`/api/employee/presence?keys=${encodeURIComponent(otherKey)}`)).json();
    const p = data.find(d => d.member_key === otherKey);
    const isOnline = p && (Date.now() - new Date(p.last_seen).getTime()) < 45000;
    const meta = document.getElementById('chat-header-meta');
    if (meta) meta.textContent = p ? (isOnline ? 'Online' : 'Last seen ' + chatRelativeTime(new Date(p.last_seen))) : 'Direct message';
    const dot = document.getElementById(`presence-dot-${activeChatRoomId}`);
    if (dot) dot.classList.toggle('online', isOnline);
  } catch (_) {}
}

function chatRelativeTime(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

// ── Voice recorder ─────────────────────────────────────────────────────────
async function chatStartRecording() {
  if (chatVoiceRecorder) { chatStopRecording(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chatVoiceChunks = [];
    chatVoiceRecorder = new MediaRecorder(stream);
    chatVoiceRecorder.ondataavailable = e => { if (e.data.size > 0) chatVoiceChunks.push(e.data); };
    chatVoiceRecorder.onstop = chatVoiceUploadAndSend;
    chatVoiceRecorder.start(250);
    chatVoiceSeconds = 0;
    document.getElementById('chat-voice-btn')?.classList.add('recording');
    document.getElementById('chat-recording-bar')?.classList.add('active');
    chatVoiceTimer = setInterval(() => {
      chatVoiceSeconds++;
      const m = String(Math.floor(chatVoiceSeconds / 60)).padStart(2, '0');
      const s = String(chatVoiceSeconds % 60).padStart(2, '0');
      const el = document.getElementById('chat-rec-timer');
      if (el) el.textContent = m + ':' + s;
      if (chatVoiceSeconds >= 300) chatStopRecording();
    }, 1000);
  } catch (_) { alert('Microphone access denied.'); }
}

function chatStopRecording() {
  if (!chatVoiceRecorder) return;
  clearInterval(chatVoiceTimer);
  chatVoiceRecorder.stream.getTracks().forEach(t => t.stop());
  chatVoiceRecorder.stop();
  chatVoiceRecorder = null;
  document.getElementById('chat-voice-btn')?.classList.remove('recording');
  document.getElementById('chat-recording-bar')?.classList.remove('active');
}

function chatCancelRecording() {
  if (!chatVoiceRecorder) return;
  clearInterval(chatVoiceTimer);
  chatVoiceRecorder.stream.getTracks().forEach(t => t.stop());
  chatVoiceRecorder.onstop = null;
  chatVoiceRecorder.stop();
  chatVoiceRecorder = null;
  chatVoiceChunks = [];
  document.getElementById('chat-voice-btn')?.classList.remove('recording');
  document.getElementById('chat-recording-bar')?.classList.remove('active');
}

async function chatVoiceUploadAndSend() {
  if (!chatVoiceChunks.length) return;
  const mimeType = chatVoiceChunks[0]?.type || 'audio/webm';
  const blob = new Blob(chatVoiceChunks, { type: mimeType });
  const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });
  const fd = new FormData(); fd.append('file', file);
  const duration = chatVoiceSeconds;
  chatVoiceChunks = [];
  try {
    const r = await fetch('/api/employee/chat/upload', { method:'POST', body:fd, headers:{ 'Authorization':'Bearer '+empToken } });
    const d = await r.json();
    if (d.error) { alert('Upload failed'); return; }
    const payload = { body: '', file_url: d.url, file_name: d.name, file_size: d.size, file_type: d.type, voice_duration: duration };
    const msgR = await ef(`/api/employee/chat/rooms/${activeChatRoomId}/messages`, { method:'POST', body:JSON.stringify(payload) });
    if (msgR.ok) { const msg = await msgR.json(); chatAppendMessage(msg); chatScrollBottom(); chatUpdatePreview(activeChatRoomId, msg); }
  } catch (_) { alert('Failed to send voice message'); }
}

// ── PWA: Install prompt (Android/Chrome) ───────────────────────────────────
let _installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  if (!localStorage.getItem('pwaInstallDismissed')) _showInstallBanner();
});

function _showInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
}

function triggerInstall() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(() => { _installPrompt = null; });
  document.getElementById('pwa-install-banner').style.display = 'none';
}

function dismissInstallBanner() {
  localStorage.setItem('pwaInstallDismissed', '1');
  document.getElementById('pwa-install-banner').style.display = 'none';
}

// ── PWA: iOS add-to-home-screen hint ──────────────────────────────────────
(function iosInstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!isIOS || window.navigator.standalone === true) return;
  if (localStorage.getItem('iosHintDismissed')) return;
  const hint = document.getElementById('pwa-ios-hint');
  if (hint) setTimeout(() => { hint.style.display = 'flex'; }, 2500);
})();

function dismissIOSHint() {
  localStorage.setItem('iosHintDismissed', '1');
  document.getElementById('pwa-ios-hint').style.display = 'none';
}

// ── Brand dropdowns ───────────────────────────────────────────────────────────
// Replaces every native <select> (form-input / form-control / filter-input) with
// a styled trigger + floating gold-on-dark options panel. The original select
// stays in the DOM (hidden) as the source of truth, so all existing code that
// reads/writes .value, rebuilds options via innerHTML, or listens to `change`
// keeps working unchanged. New selects added later (modals) are auto-enhanced.
(function () {
  const SELECTOR = 'select.form-input, select.form-control, select.filter-input';
  let menuEl = null, openFor = null;

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'bselect-menu';
    document.body.appendChild(menuEl);
    document.addEventListener('click', e => {
      if (openFor && !menuEl.contains(e.target) && !(openFor.trigger && openFor.trigger.contains(e.target))) closeBrandMenu();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBrandMenu(); });
    window.addEventListener('resize', closeBrandMenu);
  }
  function closeBrandMenu() {
    if (menuEl) menuEl.classList.remove('open');
    if (openFor?.trigger) openFor.trigger.classList.remove('open');
    openFor = null;
  }

  window.brandMenu = function (anchorEl, items, onPick, trigger) {
    ensureMenu();
    if (openFor && openFor.anchor === anchorEl) return closeBrandMenu();
    const showSearch = items.length > 8;   // type-to-filter for long lists (e.g. leads)
    const optsHtml = items.map((it, i) => `
      <button type="button" class="bselect-opt${it.selected ? ' selected' : ''}" data-i="${i}">
        <span class="bselect-check">${it.selected ? '<i data-lucide="check" style="width:12px;height:12px"></i>' : ''}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.label || '—')}</span>
      </button>`).join('');
    menuEl.innerHTML =
      (showSearch ? `<div class="bselect-search-wrap"><input type="text" class="bselect-search" placeholder="Search…"></div>` : '') +
      `<div class="bselect-list">${optsHtml}</div>` +
      `<div class="bselect-empty" style="display:none">No matches</div>`;
    const listEl = menuEl.querySelector('.bselect-list');
    const emptyEl = menuEl.querySelector('.bselect-empty');
    const pick = i => { const it = items[i]; closeBrandMenu(); onPick(it.key, it); };
    listEl.querySelectorAll('.bselect-opt').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); pick(parseInt(btn.dataset.i)); }));
    if (showSearch) {
      const search = menuEl.querySelector('.bselect-search');
      search.addEventListener('click', e => e.stopPropagation());
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        listEl.querySelectorAll('.bselect-opt').forEach(btn => {
          const ok = !q || (items[parseInt(btn.dataset.i)].label || '').toLowerCase().includes(q);
          btn.style.display = ok ? '' : 'none';
          if (ok) shown++;
        });
        emptyEl.style.display = shown ? 'none' : 'block';
      });
      search.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); const first = [...listEl.querySelectorAll('.bselect-opt')].find(b => b.style.display !== 'none'); if (first) pick(parseInt(first.dataset.i)); }
        else if (e.key === 'Escape') { e.preventDefault(); closeBrandMenu(); }
      });
    }
    const r = anchorEl.getBoundingClientRect();
    menuEl.style.minWidth = Math.max(r.width, 150) + 'px';
    menuEl.classList.add('open');
    const mh = Math.min(menuEl.scrollHeight, 280);
    const spaceBelow = window.innerHeight - r.bottom;
    menuEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menuEl.offsetWidth - 8)) + 'px';
    menuEl.style.top = (spaceBelow > mh + 12 || spaceBelow > r.top ? r.bottom + 6 : Math.max(8, r.top - mh - 6)) + 'px';
    openFor = { anchor: anchorEl, trigger: trigger || null };
    if (trigger) trigger.classList.add('open');
    menuEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    if (showSearch) setTimeout(() => menuEl.querySelector('.bselect-search')?.focus(), 20);
  };

  function labelFor(sel) {
    const o = sel.options[sel.selectedIndex];
    return o ? o.text : '';
  }
  function syncLabel(sel) {
    const lbl = sel._bTrigger?.querySelector('.bselect-label');
    if (lbl) lbl.textContent = labelFor(sel) || ' ';
  }

  function enhanceSelect(sel) {
    if (sel._bTrigger || sel.dataset.native != null || sel.multiple) return;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'bselect-trigger';
    trigger.style.cssText = sel.style.cssText;
    trigger.innerHTML = '<span class="bselect-label"> </span>';
    sel.after(trigger);
    sel.classList.add('bselect-hidden');
    sel._bTrigger = trigger;
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      window.brandMenu(trigger, [...sel.options].map((o, i) => ({ key: i, label: o.text, selected: i === sel.selectedIndex })), i => {
        sel.selectedIndex = i;
        syncLabel(sel);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, trigger);
    });
    sel.addEventListener('change', () => syncLabel(sel));
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      get() { return proto.get.call(this); },
      set(v) { proto.set.call(this, v); syncLabel(this); },
    });
    new MutationObserver(() => syncLabel(sel)).observe(sel, { childList: true, subtree: true });
    syncLabel(sel);
  }

  function enhanceAll(root) { (root && root.querySelectorAll ? root : document).querySelectorAll(SELECTOR).forEach(enhanceSelect); }
  window.enhanceBrandSelects = enhanceAll;
  enhanceAll();
  new MutationObserver(muts => {
    for (const mu of muts) {
      for (const n of mu.addedNodes) {
        if (n.nodeType === 1 && (n.matches?.(SELECTOR) || n.querySelector?.(SELECTOR))) { enhanceAll(); return; }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
})();

// Portal binding for the shared Home dashboard below.
const HOMECFG = {
  base: '/api/employee',
  fetch: (url, opts) => ef(url, opts),
  // Only offer widgets for sections this employee can actually open. The master
  // switch is enough here — a widget only reads, and empCan's per-action grants
  // (create/edit/delete) do not apply to reading a summary.
  can: section => empHas(section),
  // Read-only views of state the page already keeps, so the widgets do not fetch
  // what is sitting in memory a few lines away.
  unread: () => chatUnread.size,
  notifs: () => notifItems.filter(n => !n.read),
  google: { drive: '/api/employee/drive/files', sheets: '/api/employee/drive/sheets',
            email: '/api/employee/email/messages' },
  toast: msg => hdToast(msg),
  sheet: (t, b, f) => hdSheet(t, b, f),
  actions: () => ([
    { label: 'Log hours', icon: 'clock',          onclick: "navigate('log')" },
    { label: 'My tasks',  icon: 'clipboard-list', onclick: "navigate('tasks')" },
    { label: 'Chat',      icon: 'message-square', onclick: "navigate('chat')" },
  ]),
};

// Portal binding for the shared huddle / group-admin module below.
/* ── Generic modal ──────────────────────────────────────────────────────────
   Same three functions and the same element ids as the dashboard, because the
   shared operations module calls them through PROCFG and mobile.css already
   styles both portals by these class names. */
function showModal(title, bodyHTML, footerHTML, opts) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = bodyHTML;
  document.getElementById('modal-footer').innerHTML  = footerHTML;
  document.getElementById('modal-box').classList.toggle('modal-wide', !!(opts && opts.wide));
  document.getElementById('modal-overlay').style.display = 'flex';
  requestAnimationFrame(() => lucide.createIcons());
}
function hideModal() { document.getElementById('modal-overlay').style.display = 'none'; }
function closeModal(e) { if (e.target === document.getElementById('modal-overlay')) hideModal(); }

// Portal binding for the shared operations module (Suppliers, RFQ, POs, Contracts,
// Submissions). Same handlers as the dashboard on the server; the difference is
// entirely in `can`, which is what the admin actually granted this employee.
// A rep may create and sync a client folder when granted; who may OPEN one is
// the admin's list, enforced server-side — this portal never offers to edit it.
const CFCFG = {
  base: '/api/employee',
  path: id => `/leads/${id}/folder`,
  fetch: (url, opts) => ef(url, opts),
  toast: (msg, bad) => showToast(msg, bad),
  can: (section, action) => empCan(section, action),
  isAdmin: false,
  people: () => [],
};

// The calendar's portal adapter for the team. Everything is scoped server-side
// to this employee; the gates here only decide which affordances to draw.
const CALCFG = {
  base: '/api/employee',
  fetch: (url, opts) => ef(url, opts),
  can: (section, action) => empCan(section, action),
  modal: (...a) => showModal(...a),
  closeModal: () => hideModal(),
  toast: msg => showToast(msg),
  openTask: () => navigate('tasks'),
  openLead: id => { if (id && typeof openLeadProfile === 'function') openLeadProfile(id); },
};

const PROCFG = {
  base: '/api/employee',
  fetch: (url, opts) => ef(url, opts),
  modal: (...a) => showModal(...a),
  closeModal: () => hideModal(),
  toast: (m) => showToast(m),
  can: (section, action) => empCan(section, action),
};

const HDCFG = {
  base: '/api/employee/chat',
  me: () => myChatKey(),
  // The shared huddle module runs in both portals; only this one has permissions.
  can: (section, action) => empCan(section, action),
  fetch: (url, opts) => ef(url, opts),
  rooms: () => chatRooms,
  activeRoom: () => activeChatRoomId,
  openRoom: id => chatOpenRoom(id),
  // Opened on demand when a huddle is accepted from outside the chat page, which is
  // where the signalling actually travels.
  ensureStream: () => { if (!chatSse) openChatSse(); },
  refreshRooms: async () => {
    const r = await ef('/api/employee/chat/rooms');
    if (!r.ok) return;
    chatRooms = await r.json();
    chatRenderRoomList();
  },
};
