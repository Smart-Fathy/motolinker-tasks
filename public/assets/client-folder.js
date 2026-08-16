// The client folder section of the lead drawer — one implementation, both portals.
//
// A lead already carries its quotations, RFQs, purchase orders and contracts;
// this is the button that turns them into a real Drive folder somebody can be
// sent, plus the admin's list of who may open it. Pressing it again files
// whatever is new — the server keeps track of what it has already uploaded, so
// the folder never fills up with seven copies of the same quotation.
//
// Wired through CFCFG so each portal supplies its own API base, fetch and toast:
//
//   CFCFG = { base: '/api/dashboard', path: id => `/customers/${id}/folder`,
//             fetch, toast, can: (section, action) => bool, isAdmin: bool,
//             people: () => [{id, name}] }
(function () {
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const CF = () => (typeof CFCFG !== 'undefined' ? CFCFG : null);

  let _cfState = null;      // last fetched folder view, per open drawer
  let _cfLeadId = null;

  function cfCan() { const c = CF(); return !!c && (!c.can || c.can('leads', 'clientFolder')); }

  // The roster for the sharing list. The portal hands over whatever it already
  // has in memory; when that is empty — the admin opened a lead profile without
  // visiting Tasks or Employees first — fetch it once rather than showing a
  // sharing box with nobody in it.
  let _cfPeople = null;
  function cfPeople() {
    const c = CF();
    const inMemory = (c.people && c.people()) || [];
    if (inMemory.length) return inMemory;
    if (_cfPeople) return _cfPeople;
    if (_cfPeople !== null) return [];
    _cfPeople = [];
    c.fetch(`${c.base}/employees-for-tasks`)
      .then(r => r.json())
      .then(list => { if (Array.isArray(list) && list.length) { _cfPeople = list; cfRender(); } })
      .catch(() => {});
    return [];
  }
  function cfUrl(id) { const c = CF(); return c.base + c.path(id); }

  // Called by the drawer render. Returns the container immediately and fills it
  // in when the fetch lands, so the drawer never waits on Drive.
  function clientFolderSection(leadId) {
    if (!cfCan()) return '';
    _cfLeadId = leadId;
    _cfState = null;
    setTimeout(() => cfLoad(leadId), 0);
    return `<div class="ld-section" id="cf-section">
      <div class="ld-section-title">Client folder</div>
      <div id="cf-body"><div style="font-size:12px;color:var(--muted)">Checking Drive…</div></div>
    </div>`;
  }

  async function cfLoad(leadId) {
    const c = CF();
    if (!c) return;
    try {
      const r = await c.fetch(cfUrl(leadId));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not read the client folder.');
      _cfState = d;
      cfRender();
    } catch (e) {
      cfPaint(`<div style="font-size:12px;color:var(--muted)">${esc(e.message)}</div>`);
    }
  }

  function cfPaint(html) {
    const box = document.getElementById('cf-body');
    if (box) { box.innerHTML = html; if (window.lucide) requestAnimationFrame(() => lucide.createIcons()); }
  }

  function cfRender() {
    const c = CF();
    const d = _cfState || {};
    if (!d.exists) {
      cfPaint(`<div style="font-size:12px;color:var(--muted);margin-bottom:8px">
          No folder yet. Creating one files a PDF of every quotation, RFQ, purchase order
          and contract on this lead into <strong>MotoLinker / Clients</strong>.</div>
        <button class="btn btn-sm btn-primary" id="cf-make" onclick="cfSync()">
          <i data-lucide="folder-plus" style="width:13px;height:13px"></i> Create client folder</button>`);
      return;
    }
    // The link is only present when the server decided this person may open it.
    const open = d.canOpen && d.link
      ? `<a class="btn btn-sm btn-outline" href="${esc(d.link)}" target="_blank" rel="noopener">
           <i data-lucide="external-link" style="width:12px;height:12px"></i> Open in Drive</a>`
      : `<span style="font-size:11.5px;color:var(--muted)" title="An admin decides who may open this folder">No access</span>`;
    cfPaint(`
      <div class="ld-quote-row">
        <div style="min-width:0">
          <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <i data-lucide="folder" style="width:13px;height:13px;vertical-align:-2px"></i> ${esc(d.name || 'Client folder')}</div>
          <div style="font-size:10.5px;color:var(--muted);margin-top:2px">${d.documents || 0} document(s) filed${
            d.created_at ? ' · since ' + new Date(d.created_at).toLocaleDateString() : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
          ${open}
          <button class="btn btn-sm btn-outline" id="cf-make" onclick="cfSync()" title="File any new documents">
            <i data-lucide="refresh-cw" style="width:12px;height:12px"></i> Sync</button>
        </div>
      </div>
      ${c.isAdmin ? cfViewersHtml(d) : ''}`);
  }

  // The admin's list. Employees see who has access but cannot change it — the
  // server refuses their write anyway, so offering the control would be a lie.
  function cfViewersHtml(d) {
    const c = CF();
    const people = cfPeople();
    const chosen = (d.viewers || []).map(String);
    const named = people.filter(p => chosen.includes(String(p.id)));
    return `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">
        Who can open this folder</div>
      <div id="cf-viewers" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <span class="perm-badge full">Admins</span>
        ${named.map(p => `<span class="perm-badge on" data-cf-viewer="${p.id}">${esc(p.name)}
          <button onclick="cfDropViewer(${p.id})" title="Remove"
            style="background:none;border:none;color:inherit;cursor:pointer;padding:0 0 0 4px;font-size:12px">×</button></span>`).join('')}
        ${people.length ? `<select id="cf-add-viewer" class="form-control" style="width:auto;font-size:12px;padding:4px 8px"
          onchange="cfAddViewer(this.value)">
          <option value="">+ Add someone…</option>
          ${people.filter(p => !chosen.includes(String(p.id)))
            .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>` : ''}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">
        ${named.length ? 'These people can open the folder from their portal.'
                       : 'Only admins can open this folder — add people to share it.'}</div>
    </div>`;
  }

  async function cfSync() {
    const c = CF();
    const btn = document.getElementById('cf-make');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Filing documents…'; }
    try {
      const r = await c.fetch(cfUrl(_cfLeadId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not create the folder.');
      _cfState = d;
      cfRender();
      const added = (d.added || []).length;
      // Say what happened, including the honest "nothing new" — a button that
      // looks identical whether it did something or not is how people press it
      // five more times.
      c.toast(added ? `${added} document(s) filed to Drive.`
                    : 'Client folder is up to date — nothing new to file.');
      if ((d.failed || []).length) c.toast(`${d.failed.length} document(s) could not be rendered.`, true);
    } catch (e) {
      cfRender();
      c.toast(e.message, true);
    }
  }

  async function cfSaveViewers(ids) {
    const c = CF();
    try {
      const r = await c.fetch(`${c.base}/customers/${_cfLeadId}/folder/viewers`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewers: ids }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      _cfState = { ..._cfState, ...d };
      cfRender();
    } catch (e) { c.toast(e.message, true); }
  }
  function cfAddViewer(id) {
    if (!id) return;
    const now = (_cfState.viewers || []).map(String);
    cfSaveViewers([...new Set([...now, String(id)])]);
  }
  function cfDropViewer(id) {
    cfSaveViewers((_cfState.viewers || []).filter(v => String(v) !== String(id)));
  }

  Object.assign(window, { cfAddViewer, cfDropViewer, cfSync, clientFolderSection });
})();
