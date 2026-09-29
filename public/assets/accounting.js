// The Accounting section — shared by both portals.
//
// Money in, money out, what the company spends on itself, and a finance AI that
// reads all of it. Every number on this page comes from the server's finance
// pack (src/lib/finance.js); the model narrates, prioritises and suggests, and
// when it does arithmetic the working is shown so the figure can be traced.
//
// Like procurement.js, this file keeps the dashboard-shaped paths it was written
// with and maps them onto whichever portal is running through PROCFG, which each
// bundle defines AFTER this file loads — so nothing here touches PROCFG until a
// function is called.
(function () {
  function acctPath(url) {
    const u = String(url);
    if (PROCFG.base === '/api/dashboard') return u;
    return u.replace(/^\/api\/dashboard/, PROCFG.base);
  }
  const api = (url, opts) => PROCFG.fetch(acctPath(url), opts);
  const modal = (...a) => PROCFG.modal(...a);
  const closeModal = () => PROCFG.closeModal();
  const toast = m => PROCFG.toast(m);
  // Read as "may I", so a button the employee cannot use is never drawn. The
  // server refuses it as well; this only keeps the page honest.
  const can = (section, action) => !PROCFG.can || PROCFG.can(section, action);
  const isAdmin = () => PROCFG.base === '/api/dashboard';

  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Math.round(Number(n) || 0).toLocaleString('en-US');
  const shortM = n => {
    const v = Number(n) || 0, a = Math.abs(v), sign = v < 0 ? '−' : '';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return sign + Math.round(a / 1e3) + 'K';
    return sign + String(Math.round(a));
  };
  const fmtDate = d => (d ? String(d).slice(0, 10) : '—');
  const icons = () => { try { lucide.createIcons(); } catch (_) {} };
  // Tests stub every unknown API path with an array; a renderer must never be
  // handed one where it expects an object.
  async function acctJson(r) {
    let d = null;
    try { d = await r.json(); } catch (_) { d = null; }
    if (!r.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
    return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  }
  const A = v => (Array.isArray(v) ? v : []);
  const N = v => Number(v) || 0;

  // The brain: lucide's `brain` paths with a gradient stroke. Not data-lucide,
  // so createIcons() leaves it alone; the gradient itself is defined once per
  // page (#ml-ai-grad in the portal markup) so cloning this never duplicates it.
  const ACCT_BRAIN_SVG = '<svg class="ml-brain" viewBox="0 0 24 24" fill="none" stroke="url(#ml-ai-grad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>'
    + '<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>'
    + '<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>'
    + '<path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>'
    + '<path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/>'
    + '<path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/></svg>';

  const TABS = [
    ['overview', 'Overview'], ['receivables', 'Receivables'], ['payables', 'Payables & costs'],
    ['expenses', 'Expenses'], ['ledger', 'Ledger'], ['reports', 'Reports'],
  ];
  const PERIODS = [
    ['this_month', 'This month'], ['last_month', 'Last month'], ['quarter', 'This quarter'],
    ['ytd', 'Year to date'], ['custom', 'Custom…'],
  ];
  const CHIPS = {
    overview: ['Summarise this month', 'Forecast next month\'s cash', 'ما هو صافي النتيجة هذا الشهر؟'],
    receivables: ['Who should we chase first?', 'Draft a reminder in Arabic', 'What is 10% of the overdue balance?'],
    payables: ['Where is the cost going?', 'How much did we pay suppliers this period?'],
    expenses: ['Anything unusual this month?', 'What if we cut marketing 20%?'],
    ledger: ['Total cash in and out this period', 'Largest single payment this period'],
    reports: ['Write the executive summary', 'Three risks I should raise'],
  };

  const _acct = {
    tab: 'overview', period: 'this_month', from: '', to: '', lang: 'auto',
    aiHistory: [], aiBusy: false, data: {}, sort: { key: 'outstanding', dir: -1 },
    ledger: { direction: '', kind: '' }, expenses: { category: '' }, reportLang: 'en', reportPeriod: 'last_month',
  };
  try {
    const t = localStorage.getItem('ml_acct_tab'); if (t && TABS.some(x => x[0] === t)) _acct.tab = t;
    const p = localStorage.getItem('ml_acct_period'); if (p && PERIODS.some(x => x[0] === p) && p !== 'custom') _acct.period = p;
  } catch (_) {}

  function rangeQs() {
    if (_acct.period === 'custom' && _acct.from && _acct.to) return `period=custom&from=${_acct.from}&to=${_acct.to}`;
    return `period=${_acct.period}`;
  }
  function rangeBody() {
    return _acct.period === 'custom' && _acct.from && _acct.to
      ? { period: 'custom', from: _acct.from, to: _acct.to } : { period: _acct.period };
  }
  function rangeLabel() {
    const r = _acct.data.range;
    return r && r.label ? r.label : (PERIODS.find(p => p[0] === _acct.period) || [])[1] || '';
  }

  // ── Styles, injected once (employee.css has none of the report classes) ──
  function acctStyle() {
    if (document.getElementById('acct-style')) return;
    const s = document.createElement('style');
    s.id = 'acct-style';
    s.textContent = `
      .acct-shell{padding:0 28px 28px}
      .acct-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:22px 0 12px}
      .acct-title{display:flex;align-items:center;gap:10px}
      .acct-title .ml-brain{width:26px;height:26px}
      .acct-sub{font-size:12.5px;color:var(--muted);margin-top:3px}
      .acct-ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .acct-ctl select,.acct-ctl input{background:var(--surface,#141416);color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:9px;padding:7px 10px;font:inherit;font-size:13px}
      .acct-ai-btn{display:inline-flex;align-items:center;gap:8px;padding:7px 13px;border-radius:10px;cursor:pointer;font:inherit;font-size:13px;font-weight:700;color:var(--text,#e8e4da);
        border:1px solid rgba(167,139,250,.45);background:linear-gradient(135deg,rgba(244,114,182,.16),rgba(167,139,250,.16) 45%,rgba(56,189,248,.16));transition:box-shadow .15s}
      .acct-ai-btn:hover{box-shadow:0 0 0 1px rgba(167,139,250,.5),0 0 16px rgba(167,139,250,.35)}
      .acct-ai-btn .ml-brain{width:16px;height:16px}
      .acct-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border,#2a2a2e);margin-bottom:18px;overflow-x:auto}
      .acct-tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--muted,#9a958a);padding:10px 14px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;margin-bottom:-1px}
      .acct-tab.active{color:var(--gold,#c9a35e);border-bottom-color:var(--gold,#c9a35e);font-weight:700}
      .acct-pane{display:none}.acct-pane.active{display:block}
      .acct-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px}
      .acct-kpi{background:linear-gradient(160deg,color-mix(in srgb,var(--c,#c9a35e) 11%,transparent),rgba(20,20,22,0) 62%);border:1px solid var(--border,#2a2a2e);border-radius:14px;padding:13px 14px 12px;min-width:0}
      .acct-kpi .l{display:inline-flex;padding:3px 9px;border-radius:99px;font-size:10px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;background:color-mix(in srgb,var(--c,#c9a35e) 14%,transparent);color:var(--c,#c9a35e)}
      .acct-kpi .v{font-size:22px;font-weight:800;letter-spacing:-.03em;margin-top:9px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .acct-kpi .s{font-size:11px;color:var(--muted,#9a958a);margin-top:5px}
      .acct-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px}
      .acct-card{background:var(--surface,#141416);border:1px solid var(--border,#2a2a2e);border-radius:14px;padding:16px 16px 14px;min-width:0}
      .acct-card.wide{grid-column:1/-1}
      .acct-card-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-bottom:12px}
      .acct-card-head h3{font-family:'Cormorant Garamond',serif;font-size:19px;font-weight:600;margin:0;letter-spacing:.3px}
      .acct-card-head span{font-size:11.5px;color:var(--muted,#9a958a)}
      .acct-mini{margin-left:auto;padding:4px 10px;background:none;border:1px solid var(--border,#2a2a2e);border-radius:7px;color:var(--muted,#9a958a);font:inherit;font-size:11px;font-weight:700;cursor:pointer}
      .acct-mini:hover{color:var(--gold,#c9a35e);border-color:rgba(201,163,94,.4)}
      .acct-empty{padding:22px;text-align:center;color:var(--muted,#9a958a);font-size:12.5px}
      .acct-bars{display:flex;align-items:flex-end;gap:10px;min-height:150px;padding-top:6px}
      .acct-bar{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px}
      .acct-bar .n{font-size:10.5px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
      .acct-bar .b{width:100%;max-width:52px;height:100px;display:flex;align-items:flex-end;gap:3px}
      .acct-bar .b i{display:block;flex:1;border-radius:4px 4px 0 0;min-height:2px}
      .acct-bar .b i.in{background:#6dd8a4}.acct-bar .b i.out{background:#e57373}.acct-bar .b i.ox{background:#a78bfa}
      .acct-bar .m{font-size:10.5px;color:var(--muted,#9a958a)}
      .acct-legend{display:flex;gap:14px;font-size:11px;color:var(--muted,#9a958a);margin-top:8px}
      .acct-legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:middle}
      .acct-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:8px;margin-bottom:11px}
      .acct-row .nm{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
      .acct-row .mt{font-size:11px;color:var(--muted,#9a958a);white-space:nowrap}
      .acct-row .vl{font-size:12.5px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
      .acct-row .tr{grid-column:1/-1;height:4px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden}
      .acct-row .tr i{display:block;height:100%;background:var(--gold,#c9a35e);border-radius:99px}
      .acct-table-wrap{overflow-x:auto}
      .acct-table{width:100%;border-collapse:collapse;font-size:12.5px}
      .acct-table th{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted,#9a958a);text-align:left;padding:8px 9px;border-bottom:1px solid var(--border,#2a2a2e);white-space:nowrap}
      .acct-table th.sort{cursor:pointer}.acct-table th.sort:hover{color:var(--text,#e8e4da)}
      .acct-table td{padding:8px 9px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:middle}
      .acct-table td.n,.acct-table th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      .acct-pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10.5px;font-weight:700;white-space:nowrap}
      .acct-pill.ok{background:rgba(109,216,164,.15);color:#6dd8a4}.acct-pill.warn{background:rgba(230,168,80,.16);color:#e6a850}
      .acct-pill.bad{background:rgba(229,115,115,.16);color:#e57373}.acct-pill.mut{background:rgba(255,255,255,.07);color:var(--muted,#9a958a)}
      .acct-pill.in{background:rgba(109,216,164,.15);color:#6dd8a4}.acct-pill.out{background:rgba(229,115,115,.16);color:#e57373}
      .acct-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
      .acct-filters select,.acct-filters input{background:var(--surface,#141416);color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:8px;padding:6px 9px;font:inherit;font-size:12.5px}
      .acct-btn{padding:7px 13px;border-radius:9px;border:1px solid var(--border,#2a2a2e);background:none;color:var(--text,#e8e4da);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
      .acct-btn.pri{background:linear-gradient(135deg,var(--gold-soft,#d9bd7f),var(--primary,#c9a35e));color:#0c0c0e;border-color:transparent}
      .acct-btn.ai{border-color:rgba(167,139,250,.45);background:linear-gradient(135deg,rgba(244,114,182,.16),rgba(167,139,250,.16) 45%,rgba(56,189,248,.16));display:inline-flex;align-items:center;gap:7px}
      .acct-btn.ai .ml-brain{width:14px;height:14px}
      .acct-btn.danger{color:#e57373;border-color:rgba(229,115,115,.35)}
      .acct-btn:disabled{opacity:.5;cursor:default}
      .acct-ins{border:1px solid rgba(167,139,250,.35);background:linear-gradient(160deg,rgba(167,139,250,.08),rgba(56,189,248,.05) 60%,rgba(20,20,22,0));border-radius:14px;padding:14px 16px}
      .acct-ins-head{display:flex;align-items:center;gap:9px;margin-bottom:10px}
      .acct-ins-head .ml-brain{width:18px;height:18px}
      .acct-ins-head b{font-size:13.5px}
      .acct-ins-head .st{font-size:11px;color:var(--muted,#9a958a);margin-left:auto}
      .acct-ins-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
      .acct-ins h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;margin:0 0 6px;color:var(--muted,#9a958a)}
      .acct-ins ul{margin:0;padding-left:16px}.acct-ins li{font-size:12.5px;line-height:1.55;margin-bottom:5px}
      .acct-ins .ar{direction:rtl;text-align:right;padding-left:0;padding-right:16px}
      .acct-ins textarea{width:100%;min-height:74px;background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:9px;padding:8px 10px;font:inherit;font-size:12.5px;resize:vertical;box-sizing:border-box}
      .acct-warn{font-size:11.5px;color:#e6a850;margin:0 0 12px}
      .acct-narr h2{font-family:'Cormorant Garamond',serif;font-size:20px;margin:16px 0 6px;color:var(--gold,#c9a35e)}
      .acct-narr p,.acct-narr li{font-size:13px;line-height:1.65}
      .acct-narr[dir="rtl"]{text-align:right}
      .acct-narr[dir="rtl"] ul,.acct-narr[dir="rtl"] ol{padding-right:20px;padding-left:0}
      .acct-form{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
      .acct-form label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--muted,#9a958a);font-weight:600}
      .acct-form label.full{grid-column:1/-1}
      .acct-form input,.acct-form select,.acct-form textarea{background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:9px;padding:8px 10px;font:inherit;font-size:13px}
      .acct-form textarea{min-height:64px;resize:vertical}
      .acct-receipt{font-size:11.5px;color:var(--muted,#9a958a)}
      .acct-receipt a{color:var(--gold,#c9a35e)}
      @media (max-width:640px){ .acct-shell{padding:0 14px 20px} .acct-form{grid-template-columns:1fr} .acct-kpi .v{font-size:19px} }
      /* The drawer */
      .acai-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9994;opacity:0;pointer-events:none;transition:opacity .2s}
      .acai-overlay.open{opacity:1;pointer-events:auto}
      .acai-panel{position:fixed;top:0;right:0;bottom:0;width:420px;max-width:96vw;background:var(--surface,#141416);border-left:1px solid rgba(167,139,250,.35);z-index:9995;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.16,1,.3,1);box-shadow:-16px 0 48px rgba(0,0,0,.5)}
      .acai-panel.open{transform:translateX(0)}
      .acai-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px;border-bottom:1px solid var(--border,#2a2a2e);background:linear-gradient(135deg,rgba(244,114,182,.10),rgba(167,139,250,.10) 45%,rgba(56,189,248,.10))}
      .acai-head .ml-brain{width:22px;height:22px}
      .acai-title{display:flex;align-items:center;gap:9px;font-weight:800;font-size:14.5px}
      .acai-status{font-size:11px;margin-top:2px;color:var(--muted,#9a958a)}
      .acai-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
      .acai-msg{max-width:88%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
      .acai-msg.user{align-self:flex-end;background:var(--primary,#c9a35e);color:#0c0c0e;border-bottom-right-radius:4px}
      .acai-msg.bot{align-self:flex-start;background:rgba(255,255,255,.06);color:var(--text,#e8e4da);border-bottom-left-radius:4px}
      .acai-msg.ar{direction:rtl;text-align:right}
      .acai-tag{font-size:9px;text-transform:uppercase;letter-spacing:.05em;opacity:.55;margin-top:5px}
      .acai-work{margin-top:7px;font-size:11px;color:var(--muted,#9a958a)}
      .acai-work summary{cursor:pointer}
      .acai-work code{display:block;margin-top:4px;font-size:11px;white-space:pre-wrap;word-break:break-all;color:#a78bfa}
      .acai-chip{display:inline-block;margin:4px 4px 0 0;padding:6px 10px;font-size:12px;border:1px solid var(--border,#2a2a2e);border-radius:16px;cursor:pointer;color:var(--muted,#9a958a);background:none}
      .acai-chip:hover{border-color:#a78bfa;color:#a78bfa}
      .acai-composer{display:flex;gap:8px;padding:12px;border-top:1px solid var(--border,#2a2a2e)}
      .acai-composer textarea{flex:1;resize:none;background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;max-height:120px}
      .acai-send{background:linear-gradient(135deg,#f472b6,#a78bfa 45%,#38bdf8);color:#0c0c0e;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:700}
      .acai-send:disabled{opacity:.5}
      .acai-sel{background:#101013;color:var(--text,#e8e4da);border:1px solid var(--border,#2a2a2e);border-radius:8px;padding:4px 6px;font:inherit;font-size:12px}
      /* Last, so it beats every field rule above: iOS zooms into any control under 16px. */
      @media (max-width:768px){ .acct-shell select,.acct-shell input,.acct-shell textarea,.acct-form input,.acct-form select,.acct-form textarea,.acai-panel select,.acai-panel textarea,.acai-composer textarea,.acai-sel{font-size:16px} }
    `;
    document.head.appendChild(s);
  }

  // ── The page ──────────────────────────────────────────────────────────────
  function shellHtml() {
    return `<div class="acct-shell">
      <div class="acct-head">
        <div>
          <div class="acct-title">${ACCT_BRAIN_SVG}<span class="page-title" style="margin:0">Accounting</span></div>
          <div class="acct-sub">Company-wide figures in EGP · <span id="acct-range-label">${h(rangeLabel())}</span></div>
        </div>
        <div class="acct-ctl">
          <select id="acct-period" onchange="acctSetRange(this.value)">
            ${PERIODS.map(p => `<option value="${p[0]}"${p[0] === _acct.period ? ' selected' : ''}>${h(p[1])}</option>`).join('')}
          </select>
          <span id="acct-custom" style="display:${_acct.period === 'custom' ? 'inline-flex' : 'none'};gap:6px;align-items:center">
            <input type="date" id="acct-from" value="${h(_acct.from)}" onchange="acctSetCustom()">
            <span style="color:var(--muted)">→</span>
            <input type="date" id="acct-to" value="${h(_acct.to)}" onchange="acctSetCustom()">
          </span>
          ${can('accounting', 'ai') ? `<button class="acct-ai-btn" id="acct-ai-btn" data-perm="accounting.ai" onclick="acctAiOpen()" title="Ask the finance AI">${ACCT_BRAIN_SVG} Finance AI</button>` : ''}
        </div>
      </div>
      <div class="acct-tabs" role="tablist">
        ${TABS.map(t => `<button class="acct-tab${t[0] === _acct.tab ? ' active' : ''}" data-tab="${t[0]}" onclick="acctTab('${t[0]}')">${h(t[1])}</button>`).join('')}
      </div>
      ${TABS.map(t => `<div class="acct-pane${t[0] === _acct.tab ? ' active' : ''}" id="acct-pane-${t[0]}"><div class="loading"><div class="spinner"></div> Loading…</div></div>`).join('')}
    </div>`;
  }

  function loadAccounting() {
    const root = document.getElementById('acct-root');
    if (!root) return;
    acctStyle();
    if (!root.querySelector('.acct-shell')) root.innerHTML = shellHtml();
    // The shared assistant (assets/assistant.js) is the one drawer everywhere;
    // the local one is built only when it is not loaded.
    if (typeof window.aiOpen !== 'function') acctAiInit();
    acctTab(_acct.tab);
  }

  const RENDER = {};
  function acctTab(tab) {
    if (!TABS.some(t => t[0] === tab)) tab = 'overview';
    _acct.tab = tab;
    try { localStorage.setItem('ml_acct_tab', tab); } catch (_) {}
    document.querySelectorAll('.acct-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.acct-pane').forEach(p => p.classList.toggle('active', p.id === 'acct-pane-' + tab));
    const pane = document.getElementById('acct-pane-' + tab);
    if (!pane) return;
    if (!pane.dataset.loadedFor || pane.dataset.loadedFor !== rangeQs()) {
      pane.dataset.loadedFor = rangeQs();
      RENDER[tab](pane).catch(e => { pane.innerHTML = `<div class="error-msg">${h(e.message)}</div>`; });
    }
  }
  function acctSetRange(period) {
    _acct.period = PERIODS.some(p => p[0] === period) ? period : 'this_month';
    try { localStorage.setItem('ml_acct_period', _acct.period); } catch (_) {}
    const custom = document.getElementById('acct-custom');
    if (custom) custom.style.display = _acct.period === 'custom' ? 'inline-flex' : 'none';
    if (_acct.period === 'custom' && !(_acct.from && _acct.to)) return;
    acctReload();
  }
  function acctSetCustom() {
    const from = (document.getElementById('acct-from') || {}).value || '';
    const to = (document.getElementById('acct-to') || {}).value || '';
    if (!from || !to || from > to) return;
    _acct.from = from; _acct.to = to;
    acctReload();
  }
  function acctReload() {
    document.querySelectorAll('.acct-pane').forEach(p => { p.dataset.loadedFor = ''; });
    _acct.aiHistory = [];
    acctTab(_acct.tab);
  }
  function setRangeLabel(d) {
    if (d && d.range) _acct.data.range = d.range;
    const el = document.getElementById('acct-range-label');
    if (el) el.textContent = rangeLabel();
  }
  const warnHtml = w => (A(w).length ? `<div class="acct-warn">⚠ ${A(w).map(h).join(' · ')}</div>` : '');

  // ── AI insight cards ──────────────────────────────────────────────────────
  function insCard(tab, title) {
    if (!can('accounting', 'ai')) return '';
    return `<div class="acct-ins" id="acct-ins-${tab}" data-perm="accounting.ai">
      <div class="acct-ins-head">${ACCT_BRAIN_SVG}<b>${h(title)}</b><span class="st" id="acct-ins-st-${tab}">…</span>
        <button class="acct-mini" style="margin-left:6px" onclick="acctInsights('${tab}', true)">Refresh</button></div>
      <div id="acct-ins-body-${tab}"><div class="acct-empty">Asking the finance AI…</div></div>
    </div>`;
  }
  const isAr = s => /[؀-ۿ]/.test(String(s || ''));
  const insList = (title, items) => `<div><h4>${h(title)}</h4>${A(items).length
    ? `<ul class="${A(items).some(isAr) ? 'ar' : ''}">${A(items).map(x => `<li>${h(x)}</li>`).join('')}</ul>`
    : '<div class="acct-empty" style="padding:6px 0;text-align:left">Nothing to flag.</div>'}</div>`;
  async function acctInsights(tab, refresh) {
    const body = document.getElementById('acct-ins-body-' + tab);
    const st = document.getElementById('acct-ins-st-' + tab);
    if (!body) return;
    if (refresh) body.innerHTML = '<div class="acct-empty">Asking the finance AI…</div>';
    try {
      const r = await api('/api/dashboard/accounting/ai/insights', { method: 'POST',
        body: JSON.stringify({ tab, ...rangeBody(), lang: _acct.lang === 'auto' ? undefined : _acct.lang, refresh: !!refresh }) });
      const d = await acctJson(r);
      if (d.ai === false) { body.innerHTML = '<div class="acct-empty">AI not configured — set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server to turn on insights, reports and the finance assistant.</div>'; if (st) st.textContent = 'AI off'; return; }
      if (!d.ok) { body.innerHTML = `<div class="acct-empty">${h(d.busy || d.error || 'The AI could not answer just now.')}</div>`; if (st) st.textContent = d.status === 429 ? 'busy' : 'error'; return; }
      if (st) st.textContent = (d.cached ? 'cached · ' : '') + (d.model || 'AI') + ' · ' + String(d.generated_at || '').slice(11, 16);
      const ins = d.insights || {};
      let extra = '';
      const x = d.extra || {};
      if (tab === 'receivables') {
        const plan = A(x.collection_plan);
        extra += `<div class="acct-card wide" style="margin-top:12px"><div class="acct-card-head"><h3>Collection plan</h3><span>who to chase first, and why</span></div>
          ${plan.length ? `<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>#</th><th>Client</th><th class="n">Outstanding</th><th class="n">Days overdue</th><th>Why</th></tr></thead><tbody>
          ${plan.map((p, i) => `<tr><td>${i + 1}</td><td>${h(p.client)}</td><td class="n">EGP ${money(p.outstanding)}</td><td class="n">${h(p.days_overdue)}</td><td>${h(p.why)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="acct-empty">Nothing to chase.</div>'}
          <div class="acct-grid" style="margin-top:12px">
            <div><h4 style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 6px">Reminder · EN <button class="acct-mini" onclick="acctCopy('acct-rem-en')">Copy</button></h4><textarea id="acct-rem-en" readonly>${h((x.reminder || {}).en || '')}</textarea></div>
            <div><h4 style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 6px">Reminder · AR <button class="acct-mini" onclick="acctCopy('acct-rem-ar')">Copy</button></h4><textarea id="acct-rem-ar" readonly dir="rtl">${h((x.reminder || {}).ar || '')}</textarea></div>
          </div></div>`;
      }
      if (tab === 'payables' && A(x.cost_analysis).length) extra += `<div style="margin-top:12px">${insList('Cost analysis', x.cost_analysis)}</div>`;
      if (tab === 'expenses') {
        const an = A(x.anomalies);
        extra += `<div style="margin-top:12px"><h4 style="font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 6px">Anomalies vs the prior 3 months</h4>
          ${an.length ? `<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Category</th><th class="n">This period</th><th class="n">Prior avg / month</th><th>Note</th></tr></thead><tbody>
          ${an.map(a => `<tr><td>${h(a.category)}</td><td class="n">EGP ${money(a.this_period)}</td><td class="n">EGP ${money(a.prior_avg)}</td><td>${h(a.note)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="acct-empty" style="padding:6px 0;text-align:left">Nothing unusual.</div>'}
          ${A(x.categorisation).length ? insList('Categorisation', x.categorisation) : ''}</div>`;
      }
      body.innerHTML = `<div class="acct-ins-cols">${insList('Highlights', ins.highlights)}${insList('Risks', ins.risks)}${insList('Suggestions', ins.suggestions)}</div>${extra}`;
    } catch (e) { body.innerHTML = `<div class="acct-empty">${h(e.message)}</div>`; if (st) st.textContent = 'error'; }
  }
  function acctCopy(id) {
    const el = document.getElementById(id);
    if (!el) return;
    try { navigator.clipboard.writeText(el.value); toast('Copied'); } catch (_) { el.select(); }
  }

  // ── Overview ──────────────────────────────────────────────────────────────
  const kpi = (label, value, c, sub) => `<div class="acct-kpi" style="--c:${c}"><span class="l">${h(label)}</span><div class="v" title="EGP ${money(value)}">EGP ${shortM(value)}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  function barsHtml(months, keys) {
    const rows = A(months);
    if (!rows.length) return '<div class="acct-empty">No movements in range.</div>';
    const max = Math.max(1, ...rows.flatMap(m => keys.map(k => Math.abs(N(m[k.key])))));
    return `<div class="acct-bars">${rows.map(m => `<div class="acct-bar" title="${h(m.month)}: ${keys.map(k => k.label + ' ' + money(m[k.key])).join(' · ')}">
        <span class="n" style="color:${N(m.net) < 0 ? '#e57373' : 'inherit'}">${m.net !== undefined ? shortM(m.net) : shortM(m[keys[0].key])}</span>
        <span class="b">${keys.map(k => `<i class="${k.cls}" style="height:${Math.max(2, Math.round(Math.abs(N(m[k.key])) / max * 100))}%"></i>`).join('')}</span>
        <span class="m">${h(String(m.month).slice(2).replace('-', '/'))}</span></div>`).join('')}</div>
      <div class="acct-legend">${keys.map(k => `<span><i class="${k.cls}" style="background:${k.color}"></i>${h(k.label)}</span>`).join('')}</div>`;
  }
  RENDER.overview = async function (pane) {
    const d = await acctJson(await api(`/api/dashboard/accounting/overview?${rangeQs()}`));
    setRangeLabel(d);
    const k = d.kpis || {};
    pane.innerHTML = `${warnHtml(d.warnings)}
      <div class="acct-kpis">
        ${kpi('Cash in', k.cash_in, '#6dd8a4', `${N((d.counts || {}).payments_in)} payments`)}
        ${kpi('Cash out', k.cash_out, '#e57373', `${N((d.counts || {}).payments_out)} payments`)}
        ${kpi('Net cash', k.net_cash, N(k.net_cash) < 0 ? '#e57373' : '#c9a35e')}
        ${kpi('Receivables', k.receivables_outstanding, '#e6a850', `EGP ${money(k.receivables_overdue)} overdue`)}
        ${kpi('Vehicle costs', k.landed_costs, '#9fb0bd', 'supplier · freight · customs')}
        ${kpi('Gross margin', k.gross_margin, N(k.gross_margin) < 0 ? '#e57373' : '#6dd8a4', `${N(k.gross_margin_pct)}% of cash revenue`)}
        ${kpi('Expenses', k.expenses, '#a78bfa', `${N((d.counts || {}).expenses)} entries`)}
        ${kpi('Net result', k.net_result, N(k.net_result) < 0 ? '#e57373' : '#6dd8a4', 'margin − expenses')}
      </div>
      ${insCard('overview', 'AI insights')}
      <div class="acct-grid" style="margin-top:14px">
        <div class="acct-card"><div class="acct-card-head"><h3>Cash flow by month</h3><span>in, out and net</span><button class="acct-mini" onclick="acctExport('cash_by_month')" ${can('accounting', 'export') ? '' : 'hidden'}>CSV</button></div>
          ${barsHtml(d.cash_by_month, [{ key: 'in', cls: 'in', label: 'In', color: '#6dd8a4' }, { key: 'out', cls: 'out', label: 'Out', color: '#e57373' }])}</div>
        <div class="acct-card"><div class="acct-card-head"><h3>Top paying clients</h3><span>cash received in range</span></div>
          ${A(d.top_clients).length ? A(d.top_clients).map((c, i, all) => `<div class="acct-row"><span class="nm">${h(c.client)}</span><span class="mt"></span><span class="vl">EGP ${money(c.received)}</span><span class="tr"><i style="width:${Math.round(N(c.received) / Math.max(1, N(all[0].received)) * 100)}%"></i></span></div>`).join('') : '<div class="acct-empty">No customer payments in range.</div>'}</div>
      </div>`;
    icons();
    if (can('accounting', 'ai')) acctInsights('overview');
  };

  // ── Receivables ───────────────────────────────────────────────────────────
  const bucketPill = b => ({ current: 'mut', '1_30': 'warn', '31_60': 'warn', '61_90': 'bad', '90_plus': 'bad' }[b] || 'mut');
  RENDER.receivables = async function (pane) {
    const d = await acctJson(await api(`/api/dashboard/accounting/receivables?${rangeQs()}`));
    setRangeLabel(d);
    _acct.data.receivables = d;
    const rows = A(d.rows);
    const aging = d.aging || {};
    const tot = Math.max(1, N(d.outstanding));
    pane.innerHTML = `${warnHtml(d.warnings)}
      <div class="acct-kpis">
        ${kpi('Outstanding', d.outstanding, '#e6a850', `${rows.length} open sales · as of ${h(d.as_of || '')}`)}
        ${kpi('Overdue', d.overdue, '#e57373', `${N(d.overdue_count)} sales past due`)}
        <div class="acct-kpi" style="--c:#6dd8a4"><span class="l">Settled</span><div class="v">${N(d.settled)}</div><div class="s">sales fully paid</div></div>
      </div>
      <div class="acct-card" style="margin-bottom:14px"><div class="acct-card-head"><h3>Aging</h3><span>how old the money owed is</span><button class="acct-mini" onclick="acctExport('receivables')" ${can('accounting', 'export') ? '' : 'hidden'}>CSV</button></div>
        ${A(d.buckets).map(b => { const a = aging[b.key] || {}; return `<div class="acct-row"><span class="nm">${h(b.label)}</span><span class="mt">${N(a.count)} sale${N(a.count) === 1 ? '' : 's'}</span><span class="vl">EGP ${money(a.amount)}</span><span class="tr"><i style="width:${Math.round(N(a.amount) / tot * 100)}%;background:${b.key === 'current' ? '#9fb0bd' : b.key === '1_30' || b.key === '31_60' ? '#e6a850' : '#e57373'}"></i></span></div>`; }).join('')}
      </div>
      ${insCard('receivables', 'AI collection insights')}
      <div class="acct-card" style="margin-top:14px"><div class="acct-card-head"><h3>Open balances</h3><span>click a column to sort</span></div><div id="acct-recv-table"></div></div>`;
    renderRecvTable();
    icons();
    if (can('accounting', 'ai')) acctInsights('receivables');
  };
  function renderRecvTable() {
    const box = document.getElementById('acct-recv-table');
    const d = _acct.data.receivables || {};
    if (!box) return;
    const rows = A(d.rows).slice().sort((a, b) => {
      const k = _acct.sort.key, x = a[k], y = b[k];
      const cmp = (typeof x === 'number' || typeof y === 'number') ? N(x) - N(y) : String(x || '').localeCompare(String(y || ''));
      return cmp * _acct.sort.dir;
    });
    const th = (key, label, n) => `<th class="sort${n ? ' n' : ''}" onclick="acctSort('${key}')">${h(label)}${_acct.sort.key === key ? (_acct.sort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    box.innerHTML = rows.length ? `<div class="acct-table-wrap"><table class="acct-table"><thead><tr>
        ${th('client', 'Client')}${th('vehicle', 'Vehicle')}${th('agreed_price', 'Agreed', 1)}${th('received', 'Received', 1)}${th('outstanding', 'Outstanding', 1)}${th('due', 'Due')}${th('days_overdue', 'Overdue', 1)}<th>Age</th><th>Last paid</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${h(r.client || '—')}${r.legacy ? ' <span class="acct-pill mut" title="No payment rows yet — read from the sale\'s own columns">legacy</span>' : ''}</td><td>${h(r.vehicle || '—')}</td>
          <td class="n">${money(r.agreed_price)}</td><td class="n">${money(r.received)}</td><td class="n"><b>${money(r.outstanding)}</b></td>
          <td>${fmtDate(r.due)}</td><td class="n">${N(r.days_overdue) ? N(r.days_overdue) + ' d' : '—'}</td>
          <td><span class="acct-pill ${bucketPill(r.bucket)}">${h((A(d.buckets).find(b => b.key === r.bucket) || {}).label || r.bucket || '')}</span></td><td>${fmtDate(r.last_payment_on)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="acct-empty">Nothing outstanding — every sale is settled.</div>';
  }
  function acctSort(key) {
    if (_acct.sort.key === key) _acct.sort.dir = -_acct.sort.dir; else _acct.sort = { key, dir: key === 'client' || key === 'vehicle' || key === 'due' ? 1 : -1 };
    renderRecvTable();
  }

  // ── Payables & costs ──────────────────────────────────────────────────────
  RENDER.payables = async function (pane) {
    const d = await acctJson(await api(`/api/dashboard/accounting/payables?${rangeQs()}`));
    setRangeLabel(d);
    const cogs = d.cogs || {};
    const kinds = A(d.out_by_kind);
    const kmax = Math.max(1, ...kinds.map(k => N(k.amount)));
    const rate = d.indicative_usd_rate;
    const pos = A(d.purchase_orders);
    const byCcy = d.po_by_currency || {};
    pane.innerHTML = `${warnHtml(d.warnings)}
      <div class="acct-kpis">
        ${kpi('Supplier payments', cogs.supplier, '#9fb0bd')}
        ${kpi('Freight', cogs.freight, '#9fb0bd')}
        ${kpi('Customs', cogs.customs, '#9fb0bd')}
        ${kpi('Total vehicle cost', cogs.total, '#e57373', 'paid out in range')}
        <div class="acct-kpi" style="--c:#c98b5e"><span class="l">POs in range</span><div class="v">${Object.keys(byCcy).length ? Object.entries(byCcy).map(([c, v]) => `${h(c)} ${shortM(v)}`).join(' · ') : '—'}</div><div class="s">${N(d.po_in_range)} purchase orders (PI totals)</div></div>
        <div class="acct-kpi" style="--c:#a78bfa"><span class="l">Indicative USD rate</span><div class="v">${rate ? N(rate.rate).toFixed(2) : '—'}</div><div class="s">${rate ? 'last USD movement booked ' + h(rate.as_of) : 'no USD movement recorded yet'}</div></div>
      </div>
      ${insCard('payables', 'AI cost analysis')}
      <div class="acct-grid" style="margin-top:14px">
        <div class="acct-card"><div class="acct-card-head"><h3>Money out by kind</h3><span>in range</span></div>
          ${kinds.length ? kinds.map(k => `<div class="acct-row"><span class="nm">${h(k.label)}</span><span class="mt">${N(k.count)} payment${N(k.count) === 1 ? '' : 's'}</span><span class="vl">EGP ${money(k.amount)}</span><span class="tr"><i style="width:${Math.round(N(k.amount) / kmax * 100)}%;background:#e57373"></i></span></div>`).join('') : '<div class="acct-empty">Nothing paid out in range.</div>'}</div>
        <div class="acct-card"><div class="acct-card-head"><h3>Top suppliers</h3><span>by PI value of POs in range</span></div>
          ${A(d.top_suppliers).length ? A(d.top_suppliers).map((s, i, all) => `<div class="acct-row"><span class="nm">${h(s.supplier)}</span><span class="mt">${N(s.orders)} PO${N(s.orders) === 1 ? '' : 's'}</span><span class="vl">${h(s.currency)} ${money(s.pi_total)}</span><span class="tr"><i style="width:${Math.round(N(s.pi_total) / Math.max(1, N(all[0].pi_total)) * 100)}%;background:#9fb0bd"></i></span></div>`).join('') : '<div class="acct-empty">No purchase orders in range.</div>'}</div>
        <div class="acct-card wide"><div class="acct-card-head"><h3>Purchase orders</h3><span>PI totals in the PO's currency · "paid" is known only where vehicle units link payments to the PO</span></div>
          ${pos.length ? `<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>PO</th><th>Supplier</th><th>Date</th><th>Status</th><th class="n">Units</th><th class="n">PI total</th><th class="n">Paid (EGP)</th></tr></thead><tbody>
          ${pos.slice(0, 60).map(p => `<tr><td>${h(p.po_number || '#' + p.id)}</td><td>${h(p.supplier || '—')}</td><td>${fmtDate(p.po_date)}</td><td><span class="acct-pill mut">${h(p.status || '—')}</span></td><td class="n">${N(p.units)}</td><td class="n">${h(p.currency)} ${money(p.pi_total)}</td><td class="n">${p.paid_base == null ? '—' : money(p.paid_base)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="acct-empty">No purchase orders recorded.</div>'}</div>
      </div>`;
    icons();
    if (can('accounting', 'ai')) acctInsights('payables');
  };

  // ── Expenses ──────────────────────────────────────────────────────────────
  RENDER.expenses = async function (pane) {
    const cat = _acct.expenses.category;
    const d = await acctJson(await api(`/api/dashboard/accounting/expenses?${rangeQs()}${cat ? '&category=' + encodeURIComponent(cat) : ''}`));
    setRangeLabel(d);
    _acct.data.expenses = d;
    const cats = A(d.categories);
    const byCat = A(d.by_category);
    const cmax = Math.max(1, ...byCat.map(c => N(c.amount)));
    const prior = d.prior || {};
    const rows = A(d.rows);
    pane.innerHTML = `${warnHtml(d.warnings)}
      <div class="acct-kpis">
        ${kpi('Expenses in range', d.total, '#a78bfa', `${N(d.count)} entries`)}
        ${kpi('Prior 3-month average', prior.avg_per_month, '#9fb0bd', 'per month')}
        ${kpi('Largest category', byCat.length ? byCat[0].amount : 0, '#e6a850', byCat.length ? h(byCat[0].label) : '—')}
      </div>
      ${insCard('expenses', 'AI expense review')}
      <div class="acct-grid" style="margin-top:14px">
        <div class="acct-card"><div class="acct-card-head"><h3>By category</h3><span>in range</span><button class="acct-mini" onclick="acctExport('opex')" ${can('accounting', 'export') ? '' : 'hidden'}>CSV</button></div>
          ${byCat.length ? byCat.map(c => `<div class="acct-row"><span class="nm">${h(c.label)}</span><span class="mt">${N(c.count)}</span><span class="vl">EGP ${money(c.amount)}</span><span class="tr"><i style="width:${Math.round(N(c.amount) / cmax * 100)}%;background:#a78bfa"></i></span></div>`).join('') : '<div class="acct-empty">No expenses in range.</div>'}</div>
        <div class="acct-card"><div class="acct-card-head"><h3>By month</h3><span>operating expenses</span></div>
          ${barsHtml(A(d.by_month).map(m => ({ month: m.month, amount: m.amount })), [{ key: 'amount', cls: 'ox', label: 'Expenses', color: '#a78bfa' }])}</div>
      </div>
      <div class="acct-card"><div class="acct-card-head"><h3>Entries</h3><span>${rows.length} in range</span>
          <span style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <select class="acai-sel" onchange="acctExpenseFilter(this.value)"><option value="">All categories</option>${cats.map(c => `<option value="${h(c.key)}"${c.key === cat ? ' selected' : ''}>${h(c.label)}</option>`).join('')}</select>
            ${can('accounting', 'export') ? `<button class="acct-btn" onclick="acctExport('expenses')">CSV</button>` : ''}
            ${can('accounting', 'edit') ? `<button class="acct-btn pri" data-perm="accounting.edit" onclick="openExpenseForm()">+ Expense</button>` : ''}
          </span></div>
        ${rows.length ? `<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th class="n">Amount</th><th class="n">EGP</th><th>Method</th><th>Receipt</th>${can('accounting', 'edit') ? '<th></th>' : ''}</tr></thead><tbody>
          ${rows.map(e => `<tr><td>${fmtDate(e.spent_on)}</td><td><span class="acct-pill mut">${h((cats.find(c => c.key === e.category) || {}).label || e.category)}</span></td><td>${h(e.description || '—')}</td><td>${h(e.vendor || '—')}</td>
            <td class="n">${h(e.currency)} ${money(e.amount)}${e.currency !== 'EGP' ? ` <span class="mt" style="color:var(--muted);font-size:10.5px">@${N(e.fx_rate)}</span>` : ''}</td><td class="n"><b>${money(e.amount_base)}</b></td><td>${h(e.method || '—')}</td>
            <td>${e.receipt && e.receipt.url ? `<a href="${h(e.receipt.url)}" target="_blank" rel="noopener" style="color:var(--gold)">${h(e.receipt.name || 'file')}</a>` : '—'}</td>
            ${can('accounting', 'edit') ? `<td style="white-space:nowrap"><button class="acct-mini" onclick="openExpenseForm(${N(e.id)})">Edit</button> <button class="acct-mini" style="color:#e57373" onclick="deleteExpense(${N(e.id)})">Delete</button></td>` : ''}</tr>`).join('')}
          </tbody></table></div>` : '<div class="acct-empty">No expenses recorded in range.' + (can('accounting', 'edit') ? ' Add the first one with + Expense.' : '') + '</div>'}
      </div>`;
    icons();
    if (can('accounting', 'ai')) acctInsights('expenses');
  };
  function acctExpenseFilter(cat) { _acct.expenses.category = cat || ''; const p = document.getElementById('acct-pane-expenses'); if (p) { p.dataset.loadedFor = ''; } acctTab('expenses'); }

  let _receipt = null;
  function openExpenseForm(id) {
    const d = _acct.data.expenses || {};
    const cats = A(d.categories), methods = A(d.methods), ccys = A(d.currencies).length ? A(d.currencies) : ['EGP', 'USD'];
    const e = id ? A(d.rows).find(r => N(r.id) === N(id)) : null;
    if (id && !e) return;
    _receipt = e && e.receipt && e.receipt.url ? e.receipt : null;
    const v = (k, def) => h(e ? (e[k] ?? def ?? '') : (def ?? ''));
    modal(e ? 'Edit expense' : 'Record an expense', `<div class="acct-form">
        <label>Date<input type="date" id="ex-date" value="${v('spent_on', new Date().toISOString().slice(0, 10))}"></label>
        <label>Category<select id="ex-cat">${cats.map(c => `<option value="${h(c.key)}"${e && e.category === c.key ? ' selected' : ''}>${h(c.label)}</option>`).join('')}</select></label>
        <label>Amount<input type="number" step="0.01" min="0" id="ex-amount" value="${v('amount')}" placeholder="0.00"></label>
        <label>Currency<select id="ex-ccy" onchange="acctExpenseCcy()">${ccys.map(c => `<option value="${h(c)}"${(e ? e.currency : 'EGP') === c ? ' selected' : ''}>${h(c)}</option>`).join('')}</select></label>
        <label id="ex-fx-wrap" style="display:${e && e.currency !== 'EGP' ? 'flex' : 'none'}">Rate to EGP<input type="number" step="0.0001" min="0" id="ex-fx" value="${e && e.currency !== 'EGP' ? v('fx_rate') : ''}" placeholder="e.g. 48.5"></label>
        <label>Method<select id="ex-method"><option value="">—</option>${methods.map(m => `<option value="${h(m)}"${e && e.method === m ? ' selected' : ''}>${h(m.replace('_', ' '))}</option>`).join('')}</select></label>
        <label>Vendor<input id="ex-vendor" value="${v('vendor')}" placeholder="Who was paid"></label>
        <label>Reference<input id="ex-ref" value="${v('reference')}" placeholder="Invoice or receipt no."></label>
        <label class="full">Description<input id="ex-desc" value="${v('description')}" placeholder="What it was for"></label>
        <label class="full">Receipt<input type="file" id="ex-file" accept="image/*,.pdf" onchange="acctExpenseUpload(this)"><span class="acct-receipt" id="ex-receipt">${_receipt ? `<a href="${h(_receipt.url)}" target="_blank" rel="noopener">${h(_receipt.name || 'file')}</a> · <a href="#" onclick="acctExpenseClearReceipt();return false">remove</a>` : 'Optional — up to 10 MB'}</span></label>
        <label class="full">Notes<textarea id="ex-notes">${v('notes')}</textarea></label>
      </div>`,
      `<button class="acct-btn" onclick="PROCFG.closeModal()">Cancel</button> <button class="acct-btn pri" id="ex-save" onclick="saveExpense(${e ? N(e.id) : 0})">${e ? 'Save changes' : 'Record expense'}</button>`);
  }
  function acctExpenseCcy() {
    const c = (document.getElementById('ex-ccy') || {}).value;
    const w = document.getElementById('ex-fx-wrap');
    if (w) w.style.display = c && c !== 'EGP' ? 'flex' : 'none';
  }
  async function acctExpenseUpload(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const span = document.getElementById('ex-receipt');
    if (span) span.textContent = 'Uploading…';
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await api('/api/dashboard/tasks/upload', { method: 'POST', body: fd });
      const d = await acctJson(r);
      if (!d.url) throw new Error('Upload failed');
      _receipt = { url: d.url, name: d.name || f.name, size: d.size || f.size, type: d.type || f.type };
      if (span) span.innerHTML = `<a href="${h(_receipt.url)}" target="_blank" rel="noopener">${h(_receipt.name)}</a> · <a href="#" onclick="acctExpenseClearReceipt();return false">remove</a>`;
    } catch (e) { _receipt = null; if (span) span.textContent = 'Upload failed: ' + e.message; }
  }
  function acctExpenseClearReceipt() { _receipt = null; const s = document.getElementById('ex-receipt'); if (s) s.textContent = 'Optional — up to 10 MB'; }
  const val = id => ((document.getElementById(id) || {}).value || '').trim();
  async function saveExpense(id) {
    const btn = document.getElementById('ex-save');
    const body = { spent_on: val('ex-date'), category: val('ex-cat'), amount: val('ex-amount'), currency: val('ex-ccy'), fx_rate: val('ex-fx'),
      method: val('ex-method'), vendor: val('ex-vendor'), reference: val('ex-ref'), description: val('ex-desc'), notes: val('ex-notes'), receipt: _receipt || undefined };
    if (!(Number(body.amount) > 0)) { toast('Enter an amount greater than zero'); return; }
    if (btn) btn.disabled = true;
    try {
      const r = await api(id ? `/api/dashboard/accounting/expenses/${id}` : '/api/dashboard/accounting/expenses', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      await acctJson(r);
      closeModal();
      toast(id ? 'Expense updated' : 'Expense recorded');
      acctReload();
    } catch (e) { toast(e.message); if (btn) btn.disabled = false; }
  }
  async function deleteExpense(id) {
    if (!confirm('Delete this expense? This cannot be undone.')) return;
    try {
      await acctJson(await api(`/api/dashboard/accounting/expenses/${id}`, { method: 'DELETE' }));
      toast('Expense deleted');
      acctReload();
    } catch (e) { toast(e.message); }
  }

  // ── Ledger ────────────────────────────────────────────────────────────────
  RENDER.ledger = async function (pane) {
    const f = _acct.ledger;
    const d = await acctJson(await api(`/api/dashboard/accounting/ledger?${rangeQs()}${f.direction ? '&direction=' + f.direction : ''}${f.kind ? '&kind=' + encodeURIComponent(f.kind) : ''}`));
    setRangeLabel(d);
    const rows = A(d.rows), kinds = A(d.kinds), t = d.totals || {};
    pane.innerHTML = `${warnHtml(d.warnings)}
      <div class="acct-kpis">
        ${kpi('In', t.in, '#6dd8a4', 'matching the filters')}${kpi('Out', t.out, '#e57373', 'matching the filters')}${kpi('Net', N(t.in) - N(t.out), N(t.in) - N(t.out) < 0 ? '#e57373' : '#c9a35e')}
      </div>
      <div class="acct-card"><div class="acct-card-head"><h3>Every payment</h3><span>${rows.length} rows, newest first</span>
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select class="acai-sel" onchange="acctLedgerFilter('direction', this.value)"><option value="">In and out</option><option value="in"${f.direction === 'in' ? ' selected' : ''}>In only</option><option value="out"${f.direction === 'out' ? ' selected' : ''}>Out only</option></select>
          <select class="acai-sel" onchange="acctLedgerFilter('kind', this.value)"><option value="">All kinds</option>${kinds.map(k => `<option value="${h(k.key)}"${f.kind === k.key ? ' selected' : ''}>${h(k.label)}</option>`).join('')}</select>
          ${can('accounting', 'export') ? `<button class="acct-btn" data-perm="accounting.export" onclick="acctExport('ledger')">CSV</button>` : ''}
        </span></div>
        ${rows.length ? `<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Date</th><th></th><th>Kind</th><th>Client / vehicle</th><th class="n">Amount</th><th class="n">EGP</th><th>Method</th><th>Reference</th><th>By</th></tr></thead><tbody>
          ${rows.map(p => `<tr><td>${fmtDate(p.paid_on)}</td><td><span class="acct-pill ${p.direction === 'out' ? 'out' : 'in'}">${p.direction === 'out' ? 'OUT' : 'IN'}</span></td><td>${h((kinds.find(k => k.key === p.kind) || {}).label || p.kind)}</td>
            <td>${h(p.client || '—')}${p.vehicle ? ` <span style="color:var(--muted);font-size:11px">${h(p.vehicle)}</span>` : ''}</td>
            <td class="n">${h(p.currency)} ${money(p.amount)}${p.currency !== 'EGP' ? ` <span style="color:var(--muted);font-size:10.5px">@${N(p.fx_rate)}</span>` : ''}</td><td class="n"><b>${money(p.amount_base)}</b></td>
            <td>${h(p.method || '—')}</td><td>${h(p.reference || '—')}</td><td style="color:var(--muted);font-size:11px">${h(p.recorded_by || '')}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="acct-empty">No payments match.</div>'}
      </div>`;
    icons();
  };
  function acctLedgerFilter(k, v) { _acct.ledger[k] = v || ''; const p = document.getElementById('acct-pane-ledger'); if (p) p.dataset.loadedFor = ''; acctTab('ledger'); }

  // ── Reports ───────────────────────────────────────────────────────────────
  RENDER.reports = async function (pane) {
    let list = [];
    let warn = '';
    try { const r = await api('/api/dashboard/accounting/reports'); const d = await r.json(); if (!r.ok) warn = (d && d.error) || 'Could not load saved reports'; else list = A(d); }
    catch (e) { warn = e.message; }
    pane.innerHTML = `${warn ? `<div class="acct-warn">⚠ ${h(warn)}</div>` : ''}
      <div class="acct-grid">
        <div class="acct-card"><div class="acct-card-head"><h3>Generate a report</h3><span>the figures are computed here; the AI writes the analysis</span></div>
          <div class="acct-filters">
            <select id="acct-rep-period" onchange="acctRepPeriod(this.value)">${PERIODS.map(p => `<option value="${p[0]}"${p[0] === _acct.reportPeriod ? ' selected' : ''}>${h(p[1])}</option>`).join('')}</select>
            <span id="acct-rep-custom" style="display:${_acct.reportPeriod === 'custom' ? 'inline-flex' : 'none'};gap:6px;align-items:center"><input type="date" id="acct-rep-from"> → <input type="date" id="acct-rep-to"></span>
            <select id="acct-rep-lang"><option value="en"${_acct.reportLang === 'en' ? ' selected' : ''}>English</option><option value="ar"${_acct.reportLang === 'ar' ? ' selected' : ''}>العربية</option></select>
            ${can('accounting', 'ai') ? `<button class="acct-btn ai" id="acct-rep-gen" data-perm="accounting.ai" onclick="acctReportGenerate()">${ACCT_BRAIN_SVG} Generate</button>` : '<span class="acct-empty" style="padding:0">Generating a report needs the finance AI permission.</span>'}
          </div>
          <div id="acct-rep-status" style="font-size:12px;color:var(--muted)"></div>
          ${insCard('reports', 'AI summary of the selected period')}
        </div>
        <div class="acct-card"><div class="acct-card-head"><h3>Saved reports</h3><span>${list.length} kept</span></div>
          ${list.length ? `<div class="acct-table-wrap"><table class="acct-table"><thead><tr><th>Period</th><th>Language</th><th>Generated</th><th>Summary</th><th></th></tr></thead><tbody>
            ${list.map(r => `<tr><td><b>${h(r.period_label || (r.period_from + ' → ' + r.period_to))}</b></td><td>${r.lang === 'ar' ? 'AR' : 'EN'}</td><td>${fmtDate(r.created_at)}</td><td style="color:var(--muted);font-size:11.5px">${h(r.summary || (r.model ? '' : 'figures only — no AI narrative'))}</td>
              <td style="white-space:nowrap"><button class="acct-mini" onclick="acctReportOpen(${N(r.id)})">Open</button>${isAdmin() ? ` <button class="acct-mini" style="color:#e57373" onclick="acctReportDelete(${N(r.id)})">Delete</button>` : ''}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="acct-empty">No reports yet. Generate the first one on the left.</div>'}
        </div>
      </div>
      <div id="acct-rep-view"></div>`;
    icons();
    if (can('accounting', 'ai')) acctInsights('reports');
  };
  function acctRepPeriod(p) { _acct.reportPeriod = p; const c = document.getElementById('acct-rep-custom'); if (c) c.style.display = p === 'custom' ? 'inline-flex' : 'none'; }
  async function acctReportGenerate() {
    const btn = document.getElementById('acct-rep-gen'), st = document.getElementById('acct-rep-status');
    const lang = val('acct-rep-lang') || 'en';
    _acct.reportLang = lang;
    const body = { period: _acct.reportPeriod, lang };
    if (_acct.reportPeriod === 'custom') { body.from = val('acct-rep-from'); body.to = val('acct-rep-to'); if (!body.from || !body.to) { toast('Pick the custom dates first'); return; } }
    if (btn) btn.disabled = true;
    if (st) st.textContent = 'Computing the figures and asking the AI to write the analysis… this takes a few seconds.';
    try {
      const d = await acctJson(await api('/api/dashboard/accounting/reports', { method: 'POST', body: JSON.stringify(body) }));
      if (d.ai === false) toast('Report saved with figures only — configure the AI provider for the narrative');
      else if (d.ok === false) toast(d.busy || ('The AI could not write the narrative: ' + (d.error || 'unknown error')));
      else toast('Report generated');
      const p = document.getElementById('acct-pane-reports'); if (p) p.dataset.loadedFor = '';
      await RENDER.reports(p);
      if (d.row && d.row.id) acctReportOpen(d.row.id);
    } catch (e) { toast(e.message); if (st) st.textContent = e.message; }
    finally { if (btn) btn.disabled = false; }
  }
  // The same small markdown subset the Help centre renders.
  function mdHtml(md) {
    const out = []; let list = null;
    const close = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } };
    const inline = s => h(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    for (const raw of String(md || '').split('\n')) {
      const line = raw.trim();
      if (/^#{1,3}\s/.test(line)) { close(); out.push('<h2>' + inline(line.replace(/^#{1,3}\s+/, '')) + '</h2>'); }
      else if (/^[-*]\s/.test(line)) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(line.slice(2)) + '</li>'); }
      else if (/^\d+[.)]\s/.test(line)) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(line.replace(/^\d+[.)]\s+/, '')) + '</li>'); }
      else if (!line) close();
      else { close(); out.push('<p>' + inline(line) + '</p>'); }
    }
    close();
    return out.join('');
  }
  async function acctReportOpen(id) {
    const box = document.getElementById('acct-rep-view');
    if (!box) return;
    box.innerHTML = '<div class="loading"><div class="spinner"></div> Opening…</div>';
    try {
      const r = await acctJson(await api(`/api/dashboard/accounting/reports/${id}`));
      const p = r.pack || {}, cash = p.cash || {}, rev = p.revenue || {}, gm = p.gross_margin || {}, opex = p.opex || {}, recv = p.receivables || {};
      box.innerHTML = `<div class="acct-card" style="margin-top:14px">
        <div class="acct-card-head"><h3>${h(r.period_label || '')}</h3><span>${r.lang === 'ar' ? 'Arabic' : 'English'} · generated ${fmtDate(r.created_at)}${r.model ? ' · ' + h(r.model) : ''}</span>
          <span style="margin-left:auto;display:flex;gap:8px">
            ${can('accounting', 'export') ? `<button class="acct-btn" data-perm="accounting.export" onclick="acctReportPdf(${N(r.id)}, '${h(r.period_label || '').replace(/'/g, '')}')">PDF</button>` : ''}
            <button class="acct-btn" onclick="document.getElementById('acct-rep-view').innerHTML=''">Close</button></span></div>
        <div class="acct-kpis">
          ${kpi('Cash in', cash.in, '#6dd8a4')}${kpi('Cash out', cash.out, '#e57373')}${kpi('Revenue (cash)', rev.cash, '#c9a35e')}${kpi('Gross margin', gm.amount, N(gm.amount) < 0 ? '#e57373' : '#6dd8a4', `${N(gm.pct)}%`)}
          ${kpi('Expenses', opex.total, '#a78bfa')}${kpi('Net result', p.net_result, N(p.net_result) < 0 ? '#e57373' : '#6dd8a4')}${kpi('Receivables', recv.outstanding, '#e6a850', `EGP ${money(recv.overdue)} overdue`)}
        </div>
        <div class="acct-narr" dir="${r.lang === 'ar' ? 'rtl' : 'ltr'}">${String(r.narrative || '').trim() ? mdHtml(r.narrative) : '<p class="acct-empty">No AI narrative was generated for this report (no AI provider was configured). The figures above stand on their own.</p>'}</div>
      </div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { box.innerHTML = `<div class="error-msg">${h(e.message)}</div>`; }
  }
  function acctReportPdf(id, label) {
    if (typeof viewDocPdfPayload !== 'function') { toast('The document viewer is not loaded'); return; }
    viewDocPdfPayload(`/api/dashboard/accounting/reports/${id}/pdf`, {}, 'Finance report ' + (label || ''));
  }
  async function acctReportDelete(id) {
    if (!confirm('Delete this saved report?')) return;
    try {
      await acctJson(await api(`/api/dashboard/accounting/reports/${id}`, { method: 'DELETE' }));
      toast('Report deleted');
      const p = document.getElementById('acct-pane-reports'); if (p) { p.dataset.loadedFor = ''; RENDER.reports(p); }
    } catch (e) { toast(e.message); }
  }

  // ── CSV ───────────────────────────────────────────────────────────────────
  async function acctExport(report) {
    try {
      const r = await api(`/api/dashboard/accounting/export.csv?report=${encodeURIComponent(report)}&${rangeQs()}`);
      if (!r.ok) { let d = null; try { d = await r.json(); } catch (_) {} throw new Error((d && d.error) || ('HTTP ' + r.status)); }
      const blob = await r.blob();
      const name = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || `accounting-${report}.csv`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { toast(e.message); }
  }

  // ── The finance AI drawer ─────────────────────────────────────────────────
  function acctAiInit() {
    if (document.getElementById('acct-ai-root')) return;
    const root = document.createElement('div');
    root.id = 'acct-ai-root';
    root.innerHTML = `
      <div class="acai-overlay" id="acai-overlay" onclick="acctAiClose()"></div>
      <div class="acai-panel" id="acai-panel" role="dialog" aria-label="Finance AI">
        <div class="acai-head">
          <div><div class="acai-title">${ACCT_BRAIN_SVG}<span>Finance AI</span></div><div class="acai-status" id="acai-status">…</div></div>
          <div style="display:flex;gap:6px;align-items:center">
            <select class="acai-sel" id="acai-lang" onchange="acctAiLang(this.value)"><option value="auto">Auto</option><option value="en">EN</option><option value="ar">AR</option></select>
            <button onclick="acctAiClose()" style="background:none;border:none;color:var(--muted,#9a958a);font-size:22px;cursor:pointer;line-height:1">×</button>
          </div>
        </div>
        <div class="acai-body" id="acai-body"></div>
        <div class="acai-composer">
          <textarea id="acai-input" rows="1" placeholder="Ask about the numbers… · اسأل عن الأرقام…" onkeydown="acctAiKey(event)"></textarea>
          <button class="acai-send" id="acai-send" onclick="acctAiSend()"><i data-lucide="send" style="width:16px;height:16px"></i></button>
        </div>
      </div>`;
    document.body.appendChild(root);
    icons();
  }
  function acctAiLang(v) { _acct.lang = v; }
  // The global assistant is the one drawer everywhere; on this page it hands the
  // conversation to the finance tools. The local drawer below is the fallback
  // when the shared assistant is not loaded.
  function acctAiContext() { return { tab: _acct.tab, ...rangeBody() }; }
  function acctAiOpen() {
    if (typeof window.aiOpen === 'function') return window.aiOpen('accounting');
    acctAiInit();
    document.getElementById('acai-overlay').classList.add('open');
    document.getElementById('acai-panel').classList.add('open');
    if (!_acct.aiHistory.length) acctAiWelcome();
    acctAiStatus();
    setTimeout(() => document.getElementById('acai-input')?.focus(), 120);
  }
  function acctAiClose() {
    document.getElementById('acai-overlay')?.classList.remove('open');
    document.getElementById('acai-panel')?.classList.remove('open');
  }
  async function acctAiStatus() {
    const el = document.getElementById('acai-status');
    if (!el) return;
    try {
      const d = await acctJson(await api('/api/dashboard/accounting/ai/status'));
      if (!d.ai) { el.textContent = '● AI not configured — set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server'; el.style.color = '#e6a850'; return; }
      if (d.ok) { el.textContent = '● Connected (' + String(d.model || 'AI').replace(/^@cf\/[^/]+\//, '') + ') · reading ' + rangeLabel(); el.style.color = '#6dd8a4'; }
      else if (d.status === 429) { el.textContent = '● Busy — out of capacity, retry shortly'; el.style.color = '#e6a850'; }
      else if (d.ok === false) { el.textContent = '● Key set but failing: ' + (d.error || 'unknown error'); el.style.color = '#e6a850'; }
      else { el.textContent = '● Ready · reading ' + rangeLabel(); el.style.color = 'var(--muted,#9a958a)'; }
    } catch (_) { el.textContent = ''; }
  }
  function acctAiWelcome() {
    const chips = CHIPS[_acct.tab] || CHIPS.overview;
    document.getElementById('acai-body').innerHTML =
      `<div class="acai-msg bot">I read the company's ledger, sales, purchase orders and expenses for <b>${h(rangeLabel())}</b>. Ask me to explain a figure, work something out, or suggest what to do next — in English or العربية. Every calculation I make is shown.</div>
       <div>${chips.map(c => `<span class="acai-chip" onclick="acctAiChip(this)">${h(c)}</span>`).join('')}</div>`;
  }
  function acctAiChip(el) { const i = document.getElementById('acai-input'); i.value = el.textContent; acctAiSend(); }
  function acctAiAppend(text, who, meta) {
    const body = document.getElementById('acai-body');
    const div = document.createElement('div');
    div.className = 'acai-msg ' + (who === 'user' ? 'user' : 'bot') + (isAr(text) ? ' ar' : '');
    div.textContent = text;
    if (who === 'bot' && meta) {
      const calls = A(meta.tool_calls);
      if (calls.length) {
        const det = document.createElement('details');
        det.className = 'acai-work';
        det.innerHTML = `<summary>Worked out with ${calls.length} tool call${calls.length === 1 ? '' : 's'}</summary>` + calls.map(c => {
          const r = c.result || {};
          const what = c.name === 'calculate' ? `calculate(${c.args && c.args.expression})` : `${c.name}(${JSON.stringify(c.args || {})})`;
          const res = c.name === 'calculate' ? (r.error ? 'error: ' + r.error : '= ' + (typeof r.result === 'number' ? r.result.toLocaleString('en-US', { maximumFractionDigits: 4 }) : r.result)) : JSON.stringify(r).slice(0, 400);
          return `<code>${h(what)}\n${h(res)}</code>`;
        }).join('');
        div.appendChild(det);
      }
      const tag = document.createElement('div');
      tag.className = 'acai-tag';
      tag.textContent = meta.model ? 'AI · ' + meta.model : 'AI';
      div.appendChild(tag);
    }
    body.appendChild(div); body.scrollTop = body.scrollHeight;
    return div;
  }
  function acctAiKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acctAiSend(); } }
  async function acctAiSend() {
    if (_acct.aiBusy) return;
    const input = document.getElementById('acai-input');
    const msg = (input.value || '').trim();
    if (!msg) return;
    const chipRow = document.querySelector('#acai-body .acai-chip'); if (chipRow) chipRow.parentElement.remove();
    input.value = '';
    acctAiAppend(msg, 'user');
    _acct.aiHistory.push({ role: 'user', content: msg });
    _acct.aiBusy = true;
    const send = document.getElementById('acai-send'); if (send) send.disabled = true;
    const typing = acctAiAppend('…', 'bot');
    try {
      const r = await api('/api/dashboard/accounting/ai/chat', { method: 'POST', body: JSON.stringify({
        message: msg, history: _acct.aiHistory.slice(-8), tab: _acct.tab, ...rangeBody(), lang: _acct.lang === 'auto' ? undefined : _acct.lang }) });
      const d = await acctJson(r);
      typing.remove();
      let ans;
      if (d.ai === false) ans = 'The finance AI is not configured. Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server and I will read the figures for you.';
      else if (d.ok === false) ans = d.busy || ('I could not answer just now: ' + (d.error || 'unknown error'));
      else ans = d.answer || 'I have nothing to add.';
      acctAiAppend(ans, 'bot', d.ok ? d : null);
      _acct.aiHistory.push({ role: 'bot', content: ans });
    } catch (e) {
      typing.remove(); acctAiAppend('Network error: ' + e.message, 'bot');
    } finally { _acct.aiBusy = false; if (send) send.disabled = false; }
  }

  Object.assign(window, {
    loadAccounting, acctTab, acctSetRange, acctSetCustom, acctSort, acctInsights, acctCopy, acctExport,
    acctExpenseFilter, openExpenseForm, acctExpenseCcy, acctExpenseUpload, acctExpenseClearReceipt, saveExpense, deleteExpense,
    acctLedgerFilter, acctRepPeriod, acctReportGenerate, acctReportOpen, acctReportPdf, acctReportDelete,
    acctAiOpen, acctAiClose, acctAiLang, acctAiChip, acctAiKey, acctAiSend, acctAiContext, ACCT_BRAIN_SVG,
  });
})();
