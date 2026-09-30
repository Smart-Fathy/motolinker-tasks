// The assistant on every page — shared by both portals.
//
// One "Ask AI" button in the header opens a panel that DOCKS beside the page
// on a desktop (the page shrinks, nothing is covered, you keep working while
// it answers), slides in over the page on a tablet, and rises as a sheet on a
// phone. Ctrl/⌘+K opens and closes it. Every section also carries an insight
// card at the top of its page.
//
// The panel tells the server what is on screen: which record is open (a lead
// profile, a deal, a task, a supplier, a purchase order…), the active tab, the
// search box and the filters — so "summarise this lead" needs no name, and
// the server puts the open record in front of the model in full. The record
// registry below is fed by wrapping the portals' own open/close functions and
// by watching the modal elements, so a page needs no code of its own.
//
// When the model proposes an action, it arrives here as a card with a Confirm
// button — nothing is written until that button is pressed, and the server
// re-checks the proposal when it is.
//
// Like the other shared files, dashboard-shaped paths are mapped onto the
// running portal through PROCFG, which each bundle defines after this loads.
(function () {
  function aiPath(url) {
    const u = String(url);
    if (PROCFG.base === '/api/dashboard') return u;
    return u.replace(/^\/api\/dashboard/, PROCFG.base);
  }
  const api = (url, opts) => PROCFG.fetch(aiPath(url), opts);
  const toast = m => PROCFG.toast(m);
  const can = (section, action) => !PROCFG.can || PROCFG.can(section, action);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isAr = s => /[؀-ۿ]/.test(String(s || ''));
  const A = v => (Array.isArray(v) ? v : []);
  const icons = () => { try { lucide.createIcons(); } catch (_) {} };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const desktop = () => window.matchMedia('(min-width: 1024px)').matches;
  const phone = () => window.matchMedia('(max-width: 768px)').matches;
  async function aiJson(r) {
    let d = null;
    try { d = await r.json(); } catch (_) { d = null; }
    if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
    return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  }
  const BRAIN = '<svg class="ml-brain" viewBox="0 0 24 24" fill="none" stroke="url(#ml-ai-grad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>'
    + '<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>'
    + '<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>'
    + '<path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></svg>';
  // Mirrors PAGE_TO_SECTION on the server; the server's answer wins once loaded.
  const PAGES = { customers: 'leads', leads: 'leads', rfqs: 'rfq', rfq: 'rfq', calendar: 'meet', deletions: 'home', notif: 'home', chat: 'home', whatsapp: 'home', gchat: 'home', email: 'home', drive: 'home', sheets: 'home', reports: 'deals', availability: 'meet' };

  const _ai = { page: 'home', section: 'home', label: 'Home', sections: null, pages: null, act: false, on: null, lang: 'auto', histories: {}, busy: false, loading: null, ignoreRecord: null, restored: false };
  const pageNow = () => _ai.page;
  function sectionFor(page) {
    const p = String(page || 'home');
    if (p === 'accounting') return (_ai.sections && _ai.sections.accounting) ? 'accounting' : 'home';
    if (_ai.sections && _ai.sections[p]) return p;
    const m = ((_ai.pages || PAGES)[p]) || PAGES[p] || 'home';
    return (_ai.sections && _ai.sections[m]) ? m : 'home';
  }
  const labelOf = s => (_ai.sections && _ai.sections[s] && _ai.sections[s].label) || (s === 'home' ? 'Home' : s);
  // The insight card belongs on a section's own page. Chat, mail, Drive,
  // Sheets, the calendar, notifications and the rest borrow the Home pack for
  // the panel but are full-height layouts of their own — a card there sits on
  // top of the conversation list and breaks the page.
  const CARD_ALIASES = { customers: 'leads', leads: 'leads', rfqs: 'rfq', rfq: 'rfq' };
  const cardAllowed = page => page === 'home' || !!(_ai.sections && _ai.sections[page]) || !!(CARD_ALIASES[page] && _ai.sections && _ai.sections[CARD_ALIASES[page]]);
  const uiLang = () => (_ai.lang === 'en' || _ai.lang === 'ar') ? _ai.lang : ((navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en');
  async function aiSections() {
    if (_ai.sections) return _ai.sections;
    if (_ai.loading) return _ai.loading;
    _ai.loading = (async () => {
      try {
        const d = await aiJson(await api('/api/dashboard/ai/sections'));
        const map = {};
        A(d.sections).forEach(s => { if (s && s.key) map[s.key] = s; });
        if (!map.home) map.home = { key: 'home', label: 'Home', chips: { en: ['What needs my attention today?'], ar: ['ما الذي يحتاج انتباهي اليوم؟'] }, actions: [] };
        _ai.sections = map; _ai.pages = d.pages || null; _ai.act = !!d.act; _ai.on = d.ai === true;
      } catch (_) { _ai.sections = { home: { key: 'home', label: 'Home', chips: { en: [], ar: [] }, actions: [] } }; }
      return _ai.sections;
    })();
    return _ai.loading;
  }

  // ── Styles, once ──────────────────────────────────────────────────────────
  function aiStyle() {
    if (document.getElementById('ai-style')) return;
    const s = document.createElement('style');
    s.id = 'ai-style';
    s.textContent = `
      :root{--ai-w:420px}
      .ai-pill{position:relative;display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 12px 0 9px;border-radius:999px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:800;letter-spacing:.1px;color:var(--text,#f3efe7);
        border:1.5px solid transparent;background:linear-gradient(var(--surface,#141416),var(--surface,#141416)) padding-box,linear-gradient(135deg,#f472b6,#a78bfa 45%,#38bdf8) border-box;transition:box-shadow .15s,transform .15s}
      .ai-pill .ml-brain{width:20px;height:20px;flex-shrink:0}
      .ai-pill:hover{box-shadow:0 0 0 1px rgba(167,139,250,.35),0 0 14px rgba(167,139,250,.35);transform:translateY(-1px)}
      .ai-pill[aria-expanded="true"]{box-shadow:0 0 0 1px rgba(167,139,250,.45),0 0 16px rgba(167,139,250,.45);background:linear-gradient(rgba(167,139,250,.12),rgba(167,139,250,.12)) padding-box,linear-gradient(135deg,#f472b6,#a78bfa 45%,#38bdf8) border-box}
      .ai-pill-kbd{font:inherit;font-size:10px;font-weight:700;color:var(--muted,#9a958a);border:1px solid var(--border,#2a2a2e);border-radius:5px;padding:1px 5px;line-height:1.3}
      .ai-card{border:1px solid rgba(167,139,250,.35);background:linear-gradient(160deg,rgba(167,139,250,.08),rgba(56,189,248,.05) 60%,rgba(20,20,22,0));border-radius:14px;padding:12px 16px;margin:0 0 16px}
      .ai-card-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
      .ai-card-head .ml-brain{width:18px;height:18px;flex-shrink:0}
      .ai-card-head b{font-size:13.5px}
      .ai-card-head .st{font-size:11px;color:var(--muted,#9a958a);margin-left:auto}
      .ai-mini{padding:4px 10px;background:none;border:1px solid var(--border,#2a2a2e);border-radius:7px;color:var(--muted,#9a958a);font:inherit;font-size:11px;font-weight:700;cursor:pointer}
      .ai-mini:hover{color:#a78bfa;border-color:rgba(167,139,250,.5)}
      .ai-mini.ask{border-color:rgba(167,139,250,.45);color:var(--text,#e8e4da);background:linear-gradient(135deg,rgba(244,114,182,.16),rgba(167,139,250,.16) 45%,rgba(56,189,248,.16))}
      .ai-card-body{margin-top:10px}
      .ai-card.collapsed .ai-card-body{display:none}
      .ai-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
      .ai-cols h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;margin:0 0 6px;color:var(--muted,#9a958a)}
      .ai-cols ul{margin:0;padding-left:16px}.ai-cols li{font-size:12.5px;line-height:1.55;margin-bottom:5px}
      .ai-cols ul.ar{direction:rtl;text-align:right;padding-left:0;padding-right:16px}
      .ai-empty{font-size:12.5px;color:var(--muted,#9a958a);padding:4px 0}
      .ai-calls{margin-top:10px;display:flex;flex-direction:column;gap:5px}
      .ai-call{display:flex;gap:8px;align-items:baseline;font-size:12.5px}
      .ai-call b{white-space:nowrap}.ai-call span{color:var(--muted,#9a958a)}
      .ai-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9994;opacity:0;pointer-events:none;transition:opacity .2s}
      .ai-overlay.open{opacity:1;pointer-events:auto}
      .ai-overlay button{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
      .ai-panel{position:fixed;top:0;right:0;bottom:0;width:var(--ai-w);max-width:96vw;background:var(--surface,#141416);border-left:1px solid rgba(167,139,250,.35);z-index:9995;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.16,1,.3,1);box-shadow:-16px 0 48px rgba(0,0,0,.5)}
      .ai-panel.open{transform:translateX(0)}
      .ai-grip{position:absolute;left:-4px;top:0;bottom:0;width:8px;cursor:col-resize;z-index:2}
      .ai-grip:hover,.ai-grip.on{background:linear-gradient(180deg,rgba(244,114,182,.5),rgba(167,139,250,.5),rgba(56,189,248,.5))}
      .ai-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:12px 14px 10px;border-bottom:1px solid var(--border,#2a2a2e);background:linear-gradient(135deg,rgba(244,114,182,.10),rgba(167,139,250,.10) 45%,rgba(56,189,248,.10))}
      .ai-panel-head .ml-brain{width:22px;height:22px}
      .ai-title{display:flex;align-items:center;gap:9px;font-weight:800;font-size:14.5px}
      .ai-title small{font-weight:600;color:var(--muted,#9a958a);font-size:12px}
      .ai-status{font-size:11px;margin-top:2px;color:var(--muted,#9a958a)}
      .ai-tools{display:flex;gap:4px;align-items:center;flex-shrink:0}
      .ai-ib{background:none;border:none;color:var(--muted,#9a958a);cursor:pointer;width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:20px;line-height:1}
      .ai-ib:hover{background:rgba(255,255,255,.06);color:var(--text,#e8e4da)}
      .ai-ib i,.ai-ib svg{width:16px;height:16px}
      .ai-screen{display:none;align-items:center;gap:8px;margin:0 14px;padding:7px 10px;border:1px solid rgba(56,189,248,.35);background:rgba(56,189,248,.08);border-radius:10px;font-size:12px;color:var(--text,#e8e4da)}
      .ai-screen.on{display:flex}
      .ai-screen .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.6px;color:#38bdf8;font-weight:800;white-space:nowrap}
      .ai-screen .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ai-screen .x{background:none;border:none;color:var(--muted,#9a958a);cursor:pointer;font-size:16px;line-height:1;padding:0 2px}
      .ai-body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
      .ai-msg{max-width:92%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
      .ai-msg.user{align-self:flex-end;background:var(--primary,#c9a35e);color:#0c0c0e;border-bottom-right-radius:4px}
      .ai-msg.bot{align-self:flex-start;background:rgba(255,255,255,.06);color:var(--text,#e8e4da);border-bottom-left-radius:4px}
      .ai-msg.ar{direction:rtl;text-align:right}
      .ai-tag{font-size:9px;text-transform:uppercase;letter-spacing:.05em;opacity:.55;margin-top:5px}
      .ai-work{margin-top:7px;font-size:11px;color:var(--muted,#9a958a)}
      .ai-work summary{cursor:pointer}
      .ai-work code{display:block;margin-top:4px;font-size:11px;white-space:pre-wrap;word-break:break-all;color:#a78bfa}
      .ai-action{align-self:stretch;border:1px solid rgba(167,139,250,.45);border-radius:12px;padding:10px 12px;background:rgba(167,139,250,.08)}
      .ai-action .t{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#a78bfa;font-weight:800}
      .ai-action .d{font-size:13px;margin:4px 0 8px}
      .ai-action .r{display:flex;gap:8px}
      .ai-action.done{border-color:rgba(109,216,164,.45);background:rgba(109,216,164,.08)}
      .ai-action.done .t{color:#6dd8a4}
      .ai-action.failed{border-color:rgba(229,115,115,.45);background:rgba(229,115,115,.08)}
      .ai-action.failed .t{color:#e57373}
      .ai-btn{padding:7px 13px;border-radius:9px;border:1px solid var(--border,#2a2a2e);background:none;color:var(--text,#e8e4da);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
      .ai-btn.pri{background:linear-gradient(135deg,#f472b6,#a78bfa 45%,#38bdf8);color:#0c0c0e;border-color:transparent}
      .ai-btn:disabled{opacity:.5;cursor:default}
      .ai-chip{display:inline-block;margin:4px 4px 0 0;padding:6px 10px;font-size:12px;border:1px solid var(--border,#2a2a2e);border-radius:16px;cursor:pointer;color:var(--muted,#9a958a);background:none}
      .ai-chip:hover{border-color:#a78bfa;color:#a78bfa}
      .ai-composer{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--border,#2a2a2e)}
      .ai-composer textarea{flex:1;resize:none;background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;max-height:120px}
      .ai-send{background:linear-gradient(135deg,#f472b6,#a78bfa 45%,#38bdf8);color:#0c0c0e;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:700}
      .ai-send:disabled{opacity:.5}
      .ai-sel{background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:8px;padding:4px 6px;font:inherit;font-size:12px}
      /* Docked: on a desktop the page gives the panel its room; nothing is covered. */
      @media (min-width:1024px){
        body.ai-docked .app-content{margin-right:var(--ai-w)}
        body.ai-docked .content{margin-right:var(--ai-w);width:auto}
        body.ai-docked .ai-panel{box-shadow:none}
        body.ai-docked .ai-overlay{display:none}
      }
      @media (max-width:1023px){ .ai-grip{display:none} }
      /* A sheet on a phone. */
      @media (max-width:768px){
        .ai-panel{top:auto;left:0;right:0;bottom:0;width:100%;max-width:none;height:min(86vh,calc(100vh - 56px));border-left:none;border-top:1px solid rgba(167,139,250,.45);border-radius:18px 18px 0 0;transform:translateY(100%)}
        .ai-panel.open{transform:translateY(0)}
        .ai-pill{width:44px;height:44px;padding:0;justify-content:center;border-radius:50%}
        .ai-pill-label,.ai-pill-kbd{display:none}
        .ai-card{margin:0 0 12px}
      }
      /* Last, so it beats every field rule above: iOS zooms into any control under 16px. */
      @media (max-width:768px){ .ai-panel select,.ai-panel textarea,.ai-composer textarea,.ai-sel{font-size:16px} }
    `;
    document.head.appendChild(s);
  }

  // ── The header button ─────────────────────────────────────────────────────
  function aiHeaderButton() {
    if (document.getElementById('ai-btn')) return;
    const help = document.getElementById('help-btn');
    if (!help || !help.parentElement) return;
    const b = document.createElement('button');
    b.className = 'ai-pill';
    b.id = 'ai-btn';
    b.type = 'button';
    b.setAttribute('aria-label', 'Ask AI');
    b.setAttribute('aria-expanded', 'false');
    b.title = (isMac ? '⌘K' : 'Ctrl+K') + ' · Ask the assistant · المساعد';
    b.style.display = 'none';
    b.innerHTML = BRAIN + '<span class="ai-pill-label">Ask AI</span><kbd class="ai-pill-kbd">' + (isMac ? '⌘K' : 'Ctrl K') + '</kbd>';
    b.onclick = () => aiToggle();
    help.parentElement.insertBefore(b, help);
  }

  // ── What is on screen ─────────────────────────────────────────────────────
  // A record is registered when one of the portals' own open functions runs,
  // and forgotten when the element it lives in closes. Search, tab and
  // filters are read from the page at the moment a message is sent.
  const _screen = { record: null };
  const KIND_LABEL = { lead: 'Lead', deal: 'Deal', task: 'Task', supplier: 'Supplier', purchase_order: 'PO', rfq: 'RFQ', contract: 'Contract', quotation: 'Quotation', container: 'Container', vehicle: 'VIN', stock_model: 'Stock', request: 'Request', issue: 'Issue', meeting: 'Meeting', submission: 'Submission', expense: 'Expense', employee: 'Employee', sale: 'Sale', automation: 'Rule', report: 'Report' };
  function aiScreenSet(record) {
    if (record && record.kind && record.id != null) {
      const same = _screen.record && _screen.record.kind === record.kind && String(_screen.record.id) === String(record.id);
      _screen.record = { kind: record.kind, id: String(record.id), title: String(record.title || ''), sub: String(record.sub || ''), src: record.src || '' };
      if (!same) _ai.ignoreRecord = null;
    } else _screen.record = null;
    aiScreenChip();
  }
  function aiScreenClear(src) {
    if (_screen.record && (!src || _screen.record.src === src)) { _screen.record = null; aiScreenChip(); }
  }
  const txt = id => { const el = document.getElementById(id); return el ? (('value' in el && el.tagName !== 'DIV') ? el.value : el.textContent).replace(/\s+/g, ' ').trim() : ''; };
  // Titles land in the DOM after a fetch; read them when the message goes out.
  function recordNow() {
    const r = _screen.record;
    if (!r) return null;
    if (_ai.ignoreRecord && _ai.ignoreRecord === r.kind + ':' + r.id) return null;
    let title = r.title, sub = r.sub;
    if (!title) {
      if (r.src === 'lead-drawer') { title = txt('ld-name'); sub = [txt('ld-status'), txt('ld-phone')].filter(Boolean).join(' · '); }
      else if (r.src === 'customer-modal') title = txt('cm-name');
      else if (r.src === 'emp-lead-modal') title = txt('eml-name');
      else if (r.src === 'deal-modal') title = txt('dm-title');
      else if (r.src === 'emp-deal-modal') title = txt('emd-title-input');
      else if (r.src === 'task-drawer') title = txt('td-title');
      else if (r.src === 'modal-overlay') title = txt('modal-title');
      else if (r.src === 'iss-detail') { const t = document.querySelector('#iss-detail .iss-d-title'); title = t ? t.textContent.trim() : ''; }
      else if (r.src === 'automation-modal') title = txt('am-name');
    }
    return { kind: r.kind, id: r.id, title: String(title || '').slice(0, 120), sub: String(sub || '').slice(0, 120) };
  }
  function pageEl() { return document.getElementById('page-' + _ai.page); }
  function aiScreenSnapshot() {
    const out = { page: _ai.page, section: _ai.section };
    const rec = recordNow();
    if (rec) out.record = rec;
    const root = pageEl() || document;
    const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    // The active tab of the page, whatever it calls its tabs.
    const tab = [...root.querySelectorAll('.deal-tab.active, .acct-tab.active, .logi-tab.active, .qt-tab.active, .sup-tab.active, .tabs .active, .tab.active, .seg .active, [role="tab"][aria-selected="true"]')].find(vis);
    if (tab) out.tab = tab.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    // The first search box with text in it.
    const search = [...root.querySelectorAll('input[type="search"], input[id*="search" i], input[placeholder*="search" i]')].find(el => vis(el) && el.value.trim());
    if (search) out.search = search.value.trim().slice(0, 80);
    // Selects and date ranges that are not at their "everything" default.
    const filters = {};
    for (const sel of root.querySelectorAll('select')) {
      if (!vis(sel) || sel.closest('.ai-panel, .modal, .modal-overlay')) continue;
      const v = String(sel.value || '').trim();
      if (!v || /^(all|any|none|)$/i.test(v)) continue;
      const key = (sel.id || sel.name || sel.getAttribute('aria-label') || 'filter').replace(/^(f-|lr-|rep-|emp-rep-)/, '');
      const opt = sel.options[sel.selectedIndex];
      filters[key] = (opt ? opt.textContent : v).replace(/\s+/g, ' ').trim().slice(0, 40);
      if (Object.keys(filters).length >= 8) break;
    }
    for (const inp of root.querySelectorAll('input[type="date"]')) { if (vis(inp) && inp.value) filters[(inp.id || 'date').replace(/^(lead-|emp-lead-|rep-|emp-rep-)/, '')] = inp.value; }
    const chips = [...root.querySelectorAll('#lead-filter-chips > *, #emp-lead-filter-chips > *')].map(c => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6);
    if (chips.length) filters.chips = chips.join(' | ').slice(0, 120);
    if (Object.keys(filters).length) out.filters = filters;
    // Ticked rows.
    const ticked = [...root.querySelectorAll('tr input[type="checkbox"]:checked')].map(cb => cb.closest('tr')).filter(tr => tr && tr.getAttribute('data-id')).slice(0, 10);
    if (ticked.length) out.selected = ticked.map(tr => ({ kind: _ai.section === 'leads' ? 'lead' : _ai.section === 'deals' ? 'deal' : _ai.section === 'tasks' ? 'task' : 'row', id: tr.getAttribute('data-id'), title: (tr.querySelector('td') || tr).textContent.replace(/\s+/g, ' ').trim().slice(0, 60) }));
    return out;
  }
  function aiScreenChip() {
    const el = document.getElementById('ai-screen');
    if (!el) return;
    const rec = recordNow();
    if (!rec) { el.classList.remove('on'); return; }
    el.innerHTML = `<span class="k">Looking at</span><span class="t">${h((KIND_LABEL[rec.kind] || rec.kind) + (rec.id ? ' #' + rec.id : '') + (rec.title ? ' · ' + rec.title : ''))}</span><button class="x" title="Ignore this record" onclick="aiScreenIgnore()">×</button>`;
    el.classList.add('on');
    const input = document.getElementById('ai-input');
    if (input) input.placeholder = 'Ask about this ' + (KIND_LABEL[rec.kind] || rec.kind).toLowerCase() + ', or anything else…';
  }
  function aiScreenIgnore() { const r = _screen.record; if (r) _ai.ignoreRecord = r.kind + ':' + r.id; aiScreenChip(); const input = document.getElementById('ai-input'); if (input) input.placeholder = 'Ask about this section… · اسأل عن هذا القسم…'; }
  // Wrap a portal function so opening a record registers it. Top-level
  // function declarations are window properties, so the wrapper catches
  // inline onclick calls and calls from inside the bundle alike.
  function wrap(name, fn) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__ai) return;
    const w = function (...args) { const out = orig.apply(this, args); try { fn(...args); } catch (_) {} return out; };
    w.__ai = true;
    window[name] = w;
  }
  function watch(id, isOpen) {
    const el = document.getElementById(id);
    if (!el || el.__aiWatched) return;
    el.__aiWatched = true;
    new MutationObserver(() => { if (!isOpen(el)) aiScreenClear(id); }).observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
  const shown = el => el.style.display !== 'none' && !el.hidden;
  function aiScreenHooks() {
    const set = (kind, src, idOf) => (...args) => aiScreenSet({ kind, id: idOf ? idOf(...args) : args[0], src });
    const first = id => id;
    // Leads
    wrap('openLeadProfile', set('lead', 'lead-drawer', first));
    wrap('closeLeadProfile', () => aiScreenClear('lead-drawer'));
    wrap('openCustomerModal', set('lead', 'customer-modal', first));
    wrap('closeCustomerModal', () => aiScreenClear('customer-modal'));
    wrap('openEmpLeadModal', set('lead', 'emp-lead-modal', first));
    // Deals, sales, payments
    wrap('openDealModal', set('deal', 'deal-modal', first));
    wrap('closeDealModal', () => aiScreenClear('deal-modal'));
    wrap('openEmpDealModal', set('deal', 'emp-deal-modal', first));
    wrap('openSaleForm', set('sale', 'modal-overlay', first));
    wrap('openPaymentsPanel', set('sale', 'modal-overlay', first));
    // Tasks, requests, issues
    wrap('openTaskDrawer', set('task', 'task-drawer', first));
    wrap('closeTaskDrawer', () => aiScreenClear('task-drawer'));
    wrap('openTaskModal', set('task', 'modal-overlay', first));
    wrap('openTaskComments', set('task', 'modal-overlay', first));
    wrap('openEmpTaskComments', set('task', 'emp-comments-modal', first));
    wrap('openRequestModal', set('request', 'modal-overlay', first));
    wrap('openRequestComments', set('request', 'modal-overlay', first));
    wrap('openEmpReqComments', set('request', 'emp-comments-modal', first));
    wrap('issOpen', set('issue', 'iss-detail', first));
    // Operations
    wrap('openSupplierDetail', set('supplier', 'modal-overlay', first));
    wrap('openSupplierForm', set('supplier', 'modal-overlay', first));
    wrap('openPoForm', set('purchase_order', 'modal-overlay', first));
    wrap('previewPo', set('purchase_order', 'modal-overlay', first));
    wrap('openRfqForm', set('rfq', 'modal-overlay', first));
    wrap('openContractForm', set('contract', 'modal-overlay', first));
    wrap('openContainerForm', set('container', 'modal-overlay', first));
    wrap('openStockForm', set('stock_model', 'modal-overlay', first));
    wrap('openExpenseForm', set('expense', 'modal-overlay', first));
    wrap('openMeetingForm', set('meeting', 'modal-overlay', first));
    wrap('editQuotation', set('quotation', 'qt-panel-draft', first));
    wrap('acctReportOpen', set('report', 'acct-rep-view', first));
    wrap('openEmpModal', set('employee', 'modal-overlay', first));
    wrap('openAutomationModal', set('automation', 'automation-modal', first));
    // Closing: the elements each kind of view lives in.
    watch('modal-overlay', shown);
    watch('customer-modal', shown); watch('deal-modal', shown); watch('automation-modal', shown);
    watch('emp-lead-modal', shown); watch('emp-deal-modal', shown); watch('emp-comments-modal', shown);
    watch('lead-drawer', el => el.classList.contains('open'));
    watch('task-drawer', el => el.classList.contains('open') && !el.hidden);
    // A record opened without an id (a new one) is not a record.
    aiScreenChip();
  }

  // ── Per page ──────────────────────────────────────────────────────────────
  // Called by both bundles' navigate() once the page loader has run.
  function aiOnNavigate(page) {
    const changed = _ai.page !== String(page || 'home');
    _ai.page = String(page || 'home');
    aiStyle(); aiHeaderButton(); aiScreenHooks();
    if (changed) aiScreenClear();
    const btn = document.getElementById('ai-btn');
    if (!can('assistant', 'chat')) { if (btn) btn.style.display = 'none'; return; }
    if (btn) btn.style.display = '';
    aiSections().then(() => {
      _ai.section = sectionFor(_ai.page);
      _ai.label = labelOf(_ai.section);
      if (_ai.page !== 'accounting' && cardAllowed(_ai.page)) aiMountCard(_ai.page);
      else { const stray = document.getElementById('ai-card-' + _ai.page); if (stray) stray.remove(); }
      const title = document.getElementById('ai-title-section');
      if (title) title.textContent = _ai.label;
      const open = document.getElementById('ai-panel') && document.getElementById('ai-panel').classList.contains('open');
      if (open && !A(_ai.histories[_ai.section]).length) aiWelcome();
      if (open) aiStatus();
      // Back where it was: the panel stays docked across a reload on a desktop.
      if (!_ai.restored) { _ai.restored = true; if (store.get('ml_ai_open') === '1' && desktop()) aiOpen(null, { quiet: true }); }
    });
  }
  // The card sits at the top of the page's body; pages have three shapes.
  function cardSlot(pageEl) {
    const body = pageEl.querySelector(':scope > .page-body');
    if (body) return { parent: body, before: body.firstElementChild };
    const header = pageEl.querySelector(':scope > .page-header');
    if (header) return { parent: pageEl, before: header.nextElementSibling };
    return { parent: pageEl, before: pageEl.firstElementChild };
  }
  function aiMountCard(page) {
    const pageEl = document.getElementById('page-' + page);
    if (!pageEl || document.getElementById('ai-card-' + page) || !cardAllowed(page)) return;
    const section = sectionFor(page);
    const card = document.createElement('div');
    card.className = 'ai-card';
    card.id = 'ai-card-' + page;
    card.dataset.section = section;
    let collapsed = false;
    try { collapsed = localStorage.getItem('ml_ai_card_' + page) === 'closed'; } catch (_) {}
    if (collapsed) card.classList.add('collapsed');
    card.innerHTML = `<div class="ai-card-head">${BRAIN}<b>AI insights · ${h(labelOf(section))}</b><span class="st" id="ai-card-st-${h(page)}"></span>
        <button class="ai-mini" onclick="aiCardRefresh('${h(page)}')">Refresh</button>
        <button class="ai-mini ask" onclick="aiOpen()">${BRAIN.replace('class="ml-brain"', 'class="ml-brain" style="width:12px;height:12px;vertical-align:-2px"')} Ask</button>
        <button class="ai-mini" onclick="aiCardToggle('${h(page)}')" id="ai-card-tg-${h(page)}">${collapsed ? 'Show' : 'Hide'}</button></div>
      <div class="ai-card-body" id="ai-card-body-${h(page)}"><div class="ai-empty">…</div></div>`;
    const slot = cardSlot(pageEl);
    slot.parent.insertBefore(card, slot.before || null);
    if (!collapsed) aiCardLoad(page, false);
  }
  function aiCardToggle(page) {
    const card = document.getElementById('ai-card-' + page);
    if (!card) return;
    const closed = card.classList.toggle('collapsed');
    try { localStorage.setItem('ml_ai_card_' + page, closed ? 'closed' : 'open'); } catch (_) {}
    const tg = document.getElementById('ai-card-tg-' + page);
    if (tg) tg.textContent = closed ? 'Show' : 'Hide';
    if (!closed && !card.dataset.loaded) aiCardLoad(page, false);
  }
  function aiCardRefresh(page) { aiCardLoad(page, true); }
  const insList = (title, items) => `<div><h4>${h(title)}</h4>${A(items).length
    ? `<ul class="${A(items).some(isAr) ? 'ar' : ''}">${A(items).map(x => `<li>${h(x)}</li>`).join('')}</ul>`
    : '<div class="ai-empty">Nothing to flag.</div>'}</div>`;
  async function aiCardLoad(page, refresh) {
    const card = document.getElementById('ai-card-' + page);
    const body = document.getElementById('ai-card-body-' + page);
    const st = document.getElementById('ai-card-st-' + page);
    if (!card || !body) return;
    card.dataset.loaded = '1';
    body.innerHTML = '<div class="ai-empty">Reading this section…</div>';
    try {
      const d = await aiJson(await api('/api/dashboard/ai/insights', { method: 'POST', body: JSON.stringify({ page, lang: _ai.lang === 'auto' ? undefined : _ai.lang, refresh: !!refresh }) }));
      if (d.ai === false) { body.innerHTML = '<div class="ai-empty">AI not configured — set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server to turn on insights and the assistant.</div>'; if (st) st.textContent = 'AI off'; return; }
      if (!d.ok) { body.innerHTML = `<div class="ai-empty">${h(d.busy || d.error || d.note || 'The AI could not answer just now.')}</div>`; if (st) st.textContent = d.status === 429 ? 'busy' : ''; return; }
      if (st) st.textContent = (d.cached ? 'cached · ' : '') + String(d.model || 'AI').replace(/^@cf\/[^/]+\//, '') + ' · ' + String(d.generated_at || '').slice(11, 16);
      const ins = d.insights || {};
      let extra = '';
      const calls = A(d.extra && d.extra.call_list);
      if (calls.length) extra = `<div class="ai-calls"><h4 style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;margin:8px 0 2px;color:var(--muted)">Call first</h4>${calls.map((c, i) => `<div class="ai-call"><b>${i + 1}. ${h(c.name || ('#' + c.customer_id))}</b><span>${h(c.why)}</span></div>`).join('')}</div>`;
      body.innerHTML = `<div class="ai-cols">${insList('Highlights', ins.highlights)}${insList('Risks', ins.risks)}${insList('Suggestions', ins.suggestions)}</div>${extra}`;
    } catch (e) { body.innerHTML = `<div class="ai-empty">${h(e.message)}</div>`; }
  }

  // ── The panel ─────────────────────────────────────────────────────────────
  function aiInit() {
    aiStyle();
    if (document.getElementById('ai-root')) return;
    const root = document.createElement('div');
    root.id = 'ai-root';
    root.innerHTML = `
      <div class="ai-overlay" id="ai-overlay" onclick="aiClose()"><button data-close type="button" aria-hidden="true" tabindex="-1" onclick="aiClose()"></button></div>
      <div class="ai-panel" id="ai-panel" role="dialog" aria-label="AI assistant">
        <div class="ai-grip" id="ai-grip" title="Drag to resize"></div>
        <div class="ai-panel-head">
          <div style="min-width:0"><div class="ai-title">${BRAIN}<span>Assistant</span> <small>· <span id="ai-title-section">${h(_ai.label)}</span></small></div><div class="ai-status" id="ai-status">…</div></div>
          <div class="ai-tools">
            <select class="ai-sel" id="ai-lang" onchange="aiLang(this.value)" title="Language"><option value="auto">Auto</option><option value="en">EN</option><option value="ar">AR</option></select>
            <button class="ai-ib" onclick="aiNewChat()" title="New conversation" aria-label="New conversation"><i data-lucide="message-square-plus"></i></button>
            <button class="ai-ib" onclick="aiClose()" title="Close (Esc)" aria-label="Close">×</button>
          </div>
        </div>
        <div class="ai-screen" id="ai-screen"></div>
        <div class="ai-body" id="ai-body"></div>
        <div class="ai-composer">
          <textarea id="ai-input" rows="1" placeholder="Ask about this section… · اسأل عن هذا القسم…" onkeydown="aiKey(event)"></textarea>
          <button class="ai-send" id="ai-send" onclick="aiSend()" aria-label="Send"><i data-lucide="send" style="width:16px;height:16px"></i></button>
        </div>
      </div>`;
    document.body.appendChild(root);
    icons();
    aiGrip();
    const w = parseInt(store.get('ml_ai_w') || '', 10);
    if (w >= 340 && w <= 760) document.documentElement.style.setProperty('--ai-w', w + 'px');
  }
  // Drag the left edge to resize; the width is remembered.
  function aiGrip() {
    const grip = document.getElementById('ai-grip');
    if (!grip) return;
    let startX = 0, startW = 0;
    const move = e => { const x = e.touches ? e.touches[0].clientX : e.clientX; const w = Math.max(340, Math.min(760, Math.round(startW + (startX - x)))); document.documentElement.style.setProperty('--ai-w', w + 'px'); };
    const stop = () => { grip.classList.remove('on'); document.body.style.userSelect = ''; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ai-w'), 10); if (w) store.set('ml_ai_w', String(w)); };
    grip.addEventListener('mousedown', e => { e.preventDefault(); startX = e.clientX; startW = document.getElementById('ai-panel').getBoundingClientRect().width; grip.classList.add('on'); document.body.style.userSelect = 'none'; window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop); });
  }
  function aiLang(v) { _ai.lang = v; }
  function aiIsOpen() { const p = document.getElementById('ai-panel'); return !!(p && p.classList.contains('open')); }
  function aiToggle() { if (aiIsOpen()) aiClose(); else aiOpen(); }
  function aiOpen(section, opts) {
    aiInit();
    aiSections().then(() => {
      if (section) { _ai.section = sectionFor(section); _ai.label = labelOf(_ai.section); }
      else { _ai.section = sectionFor(pageNow()); _ai.label = labelOf(_ai.section); }
      const title = document.getElementById('ai-title-section');
      if (title) title.textContent = _ai.label;
      const overlay = document.getElementById('ai-overlay'), panel = document.getElementById('ai-panel');
      overlay.style.display = '';
      overlay.classList.add('open');
      panel.classList.add('open');
      document.body.classList.toggle('ai-docked', desktop());
      const btn = document.getElementById('ai-btn'); if (btn) btn.setAttribute('aria-expanded', 'true');
      store.set('ml_ai_open', '1');
      aiRenderHistory();
      aiStatus();
      aiScreenChip();
      if (!(opts && opts.quiet) && !phone()) setTimeout(() => document.getElementById('ai-input')?.focus(), 120);
    });
  }
  function aiClose() {
    document.getElementById('ai-overlay')?.classList.remove('open');
    document.getElementById('ai-panel')?.classList.remove('open');
    document.body.classList.remove('ai-docked');
    const btn = document.getElementById('ai-btn'); if (btn) btn.setAttribute('aria-expanded', 'false');
    store.set('ml_ai_open', '0');
  }
  function aiNewChat() { _ai.histories[_ai.section] = []; aiRenderHistory(); }
  async function aiStatus() {
    const el = document.getElementById('ai-status');
    if (!el) return;
    try {
      const d = await aiJson(await api('/api/dashboard/ai/status'));
      if (d.ai === false) { el.textContent = '● AI not configured — set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server'; el.style.color = '#e6a850'; return; }
      if (d.ok) { el.textContent = '● Connected (' + String(d.model || 'AI').replace(/^@cf\/[^/]+\//, '') + ') · reading ' + _ai.label; el.style.color = '#6dd8a4'; }
      else if (d.status === 429) { el.textContent = '● Busy — out of capacity, retry shortly'; el.style.color = '#e6a850'; }
      else if (d.ok === false) { el.textContent = '● Key set but failing: ' + (d.error || 'unknown error'); el.style.color = '#e6a850'; }
      else { el.textContent = '● Ready · reading ' + _ai.label; el.style.color = 'var(--muted,#9a958a)'; }
    } catch (_) { el.textContent = ''; }
  }
  function aiRenderHistory() {
    const body = document.getElementById('ai-body');
    if (!body) return;
    body.innerHTML = '';
    const hist = A(_ai.histories[_ai.section]);
    if (!hist.length) return aiWelcome();
    for (const m of hist) aiAppend(m.content, m.role === 'user' ? 'user' : 'bot', m.meta || null);
  }
  function aiWelcome() {
    const body = document.getElementById('ai-body');
    if (!body) return;
    const sec = (_ai.sections || {})[_ai.section] || {};
    const chips = A((sec.chips || {})[uiLang()]).length ? A(sec.chips[uiLang()]) : A((sec.chips || {}).en);
    const actNote = A(sec.actions).length ? ' I can also propose things to do here — a follow-up, a task, a status change, a payment — and you confirm each one with a button.' : '';
    body.innerHTML = `<div class="ai-msg bot">I read the <b>${h(_ai.label)}</b> section — only what you are allowed to see — and I can follow any lead, deal, supplier or VIN across the whole system, or search everything. Ask me to explain a figure, find something, work something out or draft a message, in English or العربية.${actNote}</div>
      <div>${chips.map(c => `<span class="ai-chip" onclick="aiChip(this)">${h(c)}</span>`).join('')}</div>`;
  }
  function aiChip(el) { const i = document.getElementById('ai-input'); i.value = el.textContent; aiSend(); }
  function aiAppend(text, who, meta) {
    const body = document.getElementById('ai-body');
    const div = document.createElement('div');
    div.className = 'ai-msg ' + (who === 'user' ? 'user' : 'bot') + (isAr(text) ? ' ar' : '');
    div.textContent = text;
    if (who === 'bot' && meta) {
      const calls = A(meta.tool_calls).filter(c => c.name !== 'propose_action');
      if (calls.length) {
        const det = document.createElement('details');
        det.className = 'ai-work';
        det.innerHTML = `<summary>Worked out with ${calls.length} lookup${calls.length === 1 ? '' : 's'}</summary>` + calls.map(c => {
          const r = c.result || {};
          const what = c.name === 'calculate' ? `calculate(${c.args && c.args.expression})` : `${c.name}(${JSON.stringify(c.args || {})})`;
          const res = c.name === 'calculate' ? (r.error ? 'error: ' + r.error : '= ' + (typeof r.result === 'number' ? r.result.toLocaleString('en-US', { maximumFractionDigits: 4 }) : r.result)) : JSON.stringify(r).slice(0, 400);
          return `<code>${h(what)}\n${h(res)}</code>`;
        }).join('');
        div.appendChild(det);
      }
      const tag = document.createElement('div');
      tag.className = 'ai-tag';
      tag.textContent = meta.model ? 'AI · ' + String(meta.model).replace(/^@cf\/[^/]+\//, '') : 'AI';
      div.appendChild(tag);
    }
    body.appendChild(div);
    if (who === 'bot' && meta && A(meta.proposals).length) for (const p of meta.proposals) body.appendChild(aiActionCard(p));
    body.scrollTop = body.scrollHeight;
    return div;
  }
  function aiActionCard(p) {
    const card = document.createElement('div');
    card.className = 'ai-action';
    card.dataset.action = JSON.stringify(p.action || {});
    if (p.state === 'done') { card.classList.add('done'); card.innerHTML = `<div class="t">Done</div><div class="d">${h(p.message || p.description)}</div>`; return card; }
    card.innerHTML = `<div class="t">Proposed · ${h(p.label || (p.action && p.action.type) || 'action')}</div><div class="d">${h(p.description || '')}</div>
      <div class="r"><button class="ai-btn pri" onclick="aiActionConfirm(this)">Confirm</button><button class="ai-btn" onclick="aiActionDismiss(this)">Dismiss</button></div>`;
    return card;
  }
  async function aiActionConfirm(btn) {
    const card = btn.closest('.ai-action');
    if (!card) return;
    let action = null;
    try { action = JSON.parse(card.dataset.action || '{}'); } catch (_) { action = null; }
    if (!action || !action.type) return;
    card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const d = await aiJson(await api('/api/dashboard/ai/actions/run', { method: 'POST', body: JSON.stringify({ action }) }));
      card.classList.add('done');
      card.innerHTML = `<div class="t">Done</div><div class="d">${h(d.message || 'Done.')}</div>`;
      const hist = A(_ai.histories[_ai.section]);
      const last = hist[hist.length - 1];
      if (last && last.meta && A(last.meta.proposals).length) {
        const p = last.meta.proposals.find(x => JSON.stringify(x.action) === card.dataset.action);
        if (p) { p.state = 'done'; p.message = d.message; }
      }
      toast(d.message || 'Done');
      aiRefreshPage();
    } catch (e) {
      card.classList.add('failed');
      card.querySelector('.r')?.remove();
      card.insertAdjacentHTML('beforeend', `<div class="d" style="color:#e57373;margin:6px 0 0">${h(e.message)}</div>`);
    }
  }
  function aiActionDismiss(btn) { const card = btn.closest('.ai-action'); if (card) card.remove(); }
  // After a confirmed action the page should show it; the bundle's own loader does that.
  function aiRefreshPage() {
    try { if (typeof pageLoaders !== 'undefined' && pageLoaders[_ai.page]) pageLoaders[_ai.page](); } catch (_) {}
    const card = document.getElementById('ai-card-' + _ai.page);
    if (card) card.dataset.loaded = '';
  }
  function aiKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); } }
  async function aiSend() {
    if (_ai.busy) return;
    const input = document.getElementById('ai-input');
    const msg = (input.value || '').trim();
    if (!msg) return;
    const chipRow = document.querySelector('#ai-body .ai-chip'); if (chipRow) chipRow.parentElement.remove();
    input.value = '';
    const section = _ai.section;
    _ai.histories[section] = A(_ai.histories[section]);
    aiAppend(msg, 'user');
    _ai.histories[section].push({ role: 'user', content: msg });
    _ai.busy = true;
    const send = document.getElementById('ai-send'); if (send) send.disabled = true;
    const typing = aiAppend('…', 'bot');
    try {
      const extra = (section === 'accounting' && typeof window.acctAiContext === 'function') ? window.acctAiContext() : {};
      const r = await api('/api/dashboard/ai/chat', { method: 'POST', body: JSON.stringify({
        section, page: _ai.page, message: msg, history: _ai.histories[section].slice(-8).map(m => ({ role: m.role, content: m.content })),
        lang: _ai.lang === 'auto' ? undefined : _ai.lang, screen: aiScreenSnapshot(), ...extra }) });
      const d = await aiJson(r);
      typing.remove();
      let ans, meta = null;
      if (d.ai === false) ans = 'The assistant is not configured. Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server and I will read this section for you.';
      else if (d.ok === false) ans = d.busy || ('I could not answer just now: ' + (d.error || 'unknown error'));
      else { ans = d.answer || 'I have nothing to add.'; meta = { model: d.model, tool_calls: d.tool_calls, proposals: A(d.proposals) }; }
      aiAppend(ans, 'bot', meta);
      _ai.histories[section].push({ role: 'bot', content: ans, meta });
    } catch (e) {
      typing.remove(); aiAppend('Network error: ' + e.message, 'bot');
    } finally { _ai.busy = false; if (send) send.disabled = false; }
  }

  // Ctrl/⌘+K opens and closes the panel from anywhere; Escape closes it when
  // it has the keyboard (a scrim on top of it keeps its own Escape).
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k') {
      const btn = document.getElementById('ai-btn');
      if (!btn || btn.style.display === 'none') return;
      e.preventDefault(); aiToggle(); return;
    }
    if (e.key === 'Escape' && aiIsOpen()) {
      const panel = document.getElementById('ai-panel');
      if (panel.contains(document.activeElement) || (desktop() && !document.querySelector('.modal-overlay[style*="flex"], #lead-drawer.open, #task-drawer.open'))) { e.preventDefault(); aiClose(); }
    }
  });
  window.addEventListener('resize', () => { if (aiIsOpen()) document.body.classList.toggle('ai-docked', desktop()); });

  document.addEventListener('DOMContentLoaded', () => { aiStyle(); aiHeaderButton(); aiScreenHooks(); });
  Object.assign(window, { aiOnNavigate, aiOpen, aiClose, aiToggle, aiLang, aiChip, aiKey, aiSend, aiNewChat, aiActionConfirm, aiActionDismiss, aiCardRefresh, aiCardToggle, aiMountCard, aiRefreshPage, aiScreenSet, aiScreenClear, aiScreenIgnore, aiScreenSnapshot, AI_BRAIN_SVG: BRAIN });
})();
