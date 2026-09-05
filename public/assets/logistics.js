// Inventory → the vehicle register, container tracking, and the payments ledger.
//
// Three views that all hang off one idea: the physical vehicle is a row now
// (src/routes/vehicle-units.js), so money and shipping have something real to
// point at. Shared by both portals for the same reason procurement.js is —
// copying it into each bundle is how a fix lands in one and misses the other.
//
// The seam is PROCFG, the adapter each portal already defines for procurement.js
// (base, fetch, modal, closeModal, toast, can). Nothing new to wire up per
// portal; the server mounts every route below at both bases, so the only
// difference between the two is which actions the admin granted.
//
// The container and voyage cards deliberately mirror what the team is reading
// off the carrier's site today — container, type, latest move, POD ETA; then the
// ship, the leg, the actual departure and the reported arrival — so moving from
// screenshots to this is recognition rather than retraining.
(function () {

  function logiPath(url) {
    const u = String(url);
    return PROCFG.base === '/api/dashboard' ? u : u.replace(/^\/api\/dashboard/, PROCFG.base);
  }
  const api  = (url, opts) => PROCFG.fetch(logiPath(url), opts);
  const modal = (...a) => PROCFG.modal(...a);
  const closeModal = () => PROCFG.closeModal();
  const toast = m => PROCFG.toast(m);
  const can = (section, action) => !PROCFG.can || PROCFG.can(section, action);

  // These mirror src/lib/constants.js. Duplicated rather than fetched because the
  // page has to render before any request completes — tests/logistics.js asserts
  // the two copies agree, so the duplication cannot drift unnoticed.
  const UNIT_STATUSES = [
    { key: 'ordered',   label: 'Ordered',         fg: '#2f3f8f' },
    { key: 'produced',  label: 'In production',   fg: '#7b2d8e' },
    { key: 'shipped',   label: 'Shipped',         fg: '#8a5a00' },
    { key: 'landed',    label: 'Landed',          fg: '#9a4b12' },
    { key: 'cleared',   label: 'Customs cleared', fg: '#3d6b1e' },
    { key: 'in_stock',  label: 'In stock',        fg: '#1e6b2a' },
    { key: 'allocated', label: 'Allocated',       fg: '#14568c' },
    { key: 'delivered', label: 'Delivered',       fg: '#1e6b2a' },
    { key: 'cancelled', label: 'Cancelled',       fg: '#8e2d2d' },
  ];
  const CONTAINER_STATUSES = [
    { key: 'booked',     label: 'Booked',     fg: '#2f3f8f' },
    { key: 'in_transit', label: 'In transit', fg: '#8a5a00' },
    { key: 'arrived',    label: 'Arrived',    fg: '#14568c' },
    { key: 'discharged', label: 'Discharged', fg: '#3d6b1e' },
    { key: 'cleared',    label: 'Cleared',    fg: '#1e6b2a' },
    { key: 'closed',     label: 'Closed',     fg: '#555555' },
  ];
  const CONTAINER_TYPES = ["20' DRY", "40' DRY", "40' HIGH CUBE", "45' HIGH CUBE",
    "20' REEFER", "40' REEFER", "20' OPEN TOP", "40' OPEN TOP",
    "20' FLAT RACK", "40' FLAT RACK", 'OTHER'];
  const CURRENCIES = ['EGP', 'USD', 'EUR', 'AED', 'SAR', 'CNY', 'JPY', 'GBP'];
  const BASE_CURRENCY = 'EGP';
  const PAYMENT_KINDS = [
    { key: 'reservation',  label: 'Reservation',   dir: 'in'  },
    { key: 'down_payment', label: 'Down payment',  dir: 'in'  },
    { key: 'instalment',   label: 'Instalment',    dir: 'in'  },
    { key: 'final',        label: 'Final payment', dir: 'in'  },
    { key: 'refund',       label: 'Refund',        dir: 'out' },
    { key: 'supplier',     label: 'Supplier',      dir: 'out' },
    { key: 'freight',      label: 'Freight',       dir: 'out' },
    { key: 'customs',      label: 'Customs',       dir: 'out' },
  ];
  const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'instapay', 'other'];

  // ── Styles ────────────────────────────────────────────────────────────────
  // Injected once rather than copied into both portal stylesheets. The module is
  // shared, so its CSS being in two files is the same drift problem the JS was
  // moved here to avoid; the help panel (help-docs.js) is styled the same way.
  // Every colour reads a portal variable with a literal fallback, so the cards
  // pick up each portal's palette and still render if one is missing.
  const STYLE_ID = 'logi-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
    .logi-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
    .logi-hint{font-size:12px;color:var(--muted,#8d897f)}
    .logi-empty{padding:26px 18px;text-align:center;color:var(--muted,#8d897f);font-size:13px;
                border:1px dashed var(--border,rgba(255,255,255,.12));border-radius:12px}

    /* The container card: one field per row, icon then label then value, which is
       the shape the carrier's own card uses and what the team reads at a glance. */
    /* align-items:start so a box with no voyage yet hugs its content instead of
       stretching to match the tallest card in the row. */
    .logi-ct-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;align-items:start}
    /* The field upper-cases what is typed, which would otherwise shout the
       placeholder too. */
    #logi-ct-search::placeholder{text-transform:none}
    .logi-ct{border:1px solid var(--primary,#c9a35e);border-radius:16px;overflow:hidden;
             background:var(--card,#18181b);display:flex;flex-direction:column}
    .logi-ct-body{padding:18px 20px;display:flex;flex-direction:column;gap:14px}
    .logi-ct-row{display:flex;align-items:center;gap:14px;min-width:0}
    .logi-ct-ic{width:26px;height:26px;flex-shrink:0;color:var(--text,#f3efe7);opacity:.75;
                display:flex;align-items:center;justify-content:center}
    .logi-ct-ic svg{width:22px;height:22px}
    .logi-ct-k{font-size:11.5px;color:var(--muted,#8d897f);line-height:1.3}
    .logi-ct-v{font-size:16px;font-weight:600;letter-spacing:.01em;line-height:1.35;
               overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .logi-ct-foot{padding:14px 20px;background:rgba(255,255,255,.04);
                  border-top:1px solid var(--border,rgba(255,255,255,.09));
                  display:flex;align-items:center;gap:14px}
    .logi-ct-foot .logi-ct-row{flex:1;min-width:0}
    .logi-ct-actions{display:flex;gap:6px;flex-shrink:0}
    .logi-ct-btn{width:34px;height:34px;border-radius:50%;border:1px solid var(--border,rgba(255,255,255,.12));
                 background:none;color:var(--muted,#8d897f);cursor:pointer;
                 display:flex;align-items:center;justify-content:center}
    .logi-ct-btn:hover{color:var(--primary,#c9a35e);border-color:var(--primary,#c9a35e)}

    /* The voyage strip, under the container card: ship, leg, and where on it. */
    .logi-voy{padding:16px 20px;border-top:1px solid var(--border,rgba(255,255,255,.09))}
    .logi-voy-ship{display:flex;align-items:center;gap:9px;margin-bottom:14px;min-width:0}
    .logi-voy-name{font-size:14.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .logi-voy-imo{font-size:11px;color:var(--muted,#8d897f);flex-shrink:0}
    .logi-voy-ends{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--muted,#8d897f)}
    .logi-voy-codes{display:flex;justify-content:space-between;gap:12px;font-size:15px;font-weight:800;margin-top:2px}
    .logi-voy-track{position:relative;height:22px;margin:8px 0 4px}
    /* The dotted remainder sits under a solid bar of the distance already run;
       the ship marker rides the join, so "how far along" is one glance. */
    .logi-voy-line{position:absolute;top:9px;left:6px;right:6px;height:3px;border-radius:2px;
                   background-image:radial-gradient(circle,var(--muted,#8d897f) 1.3px,transparent 1.4px);
                   background-size:9px 3px;opacity:.65}
    .logi-voy-done{position:absolute;top:9px;left:6px;height:3px;border-radius:2px;background:var(--primary,#c9a35e)}
    .logi-voy-dot{position:absolute;top:4px;left:0;width:13px;height:13px;border-radius:50%;
                  background:var(--primary,#c9a35e)}
    .logi-voy-end{position:absolute;top:3px;right:0;color:var(--muted,#8d897f);display:flex}
    .logi-voy-end svg{width:15px;height:15px}
    .logi-voy-ship-ic{position:absolute;top:0;color:var(--primary,#c9a35e);display:flex;transform:translateX(-50%)}
    .logi-voy-ship-ic svg{width:19px;height:19px}
    .logi-voy-times{display:flex;justify-content:space-between;gap:12px;font-size:11.5px;margin-top:9px}
    .logi-voy-times b{display:block;font-size:12.5px;font-weight:700;margin-top:2px}
    .logi-voy-none{font-size:12px;color:var(--muted,#8d897f);padding:4px 0}

    /* Live position. The map is only mounted for a container that has a fix, so
       a box still sitting at the load port costs nothing. */
    .logi-pos{border-top:1px solid var(--border,rgba(255,255,255,.09))}
    .logi-pos-head{display:flex;align-items:center;gap:8px;padding:12px 20px 8px;font-size:11.5px}
    .logi-pos-co{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
                 color:var(--text,#f3efe7);white-space:nowrap}
    .logi-pos-head{flex-wrap:wrap}
    .logi-pos-age{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-weight:700;
                  padding:2px 8px;border-radius:20px;white-space:nowrap}
    /* A fix has an age and the age decides how much to trust it: minutes is a
       coastal report, hours is a satellite pass, a day is not a position. */
    .logi-pos-age.fresh{background:rgba(16,185,129,.12);color:var(--success,#8a9a86)}
    .logi-pos-age.aging{background:rgba(245,158,11,.12);color:var(--warning,#c9a35e)}
    .logi-pos-age.stale{background:rgba(239,68,68,.12);color:var(--danger,#c97d6e)}
    .logi-map{height:190px;width:100%;background:rgba(255,255,255,.03)}
    .logi-map-fallback{padding:14px 20px;font-size:12px;color:var(--muted,#8d897f)}
    /* Leaflet paints its own light chrome; tone it into the dark card. */
    .logi-map .leaflet-tile{filter:brightness(.72) saturate(.75) contrast(1.05)}
    .logi-map .leaflet-container{background:#0d1b2a}
    .logi-map .leaflet-control-attribution{background:rgba(0,0,0,.55);color:#9aa;font-size:9px}
    .logi-map .leaflet-control-attribution a{color:#bcd}
    .logi-ship-marker{display:flex;align-items:center;justify-content:center;color:var(--primary,#c9a35e);
                      filter:drop-shadow(0 0 3px rgba(0,0,0,.8))}

    .logi-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:20px;
               font-size:10.5px;font-weight:800;letter-spacing:.02em;white-space:nowrap}
    .logi-warn{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--warning,#c9a35e);
               margin-top:8px}
    .logi-units{border-top:1px solid var(--border,rgba(255,255,255,.09));padding:12px 20px;
                display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .logi-unit-chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;
                    border:1px solid var(--border,rgba(255,255,255,.12));border-radius:20px;padding:3px 10px}
    .logi-unit-chip button{background:none;border:none;color:var(--muted,#8d897f);cursor:pointer;
                           font-size:13px;line-height:1;padding:0}

    /* Payments */
    .logi-pay-sum{display:flex;gap:18px;flex-wrap:wrap;padding:14px 16px;border-radius:12px;
                  border:1px solid var(--border,rgba(255,255,255,.09));margin-bottom:14px}
    .logi-pay-cell{min-width:110px}
    .logi-pay-k{font-size:10.5px;color:var(--muted,#8d897f);text-transform:uppercase;letter-spacing:.06em}
    .logi-pay-v{font-size:16px;font-weight:800;margin-top:3px}
    .logi-pay-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden;margin-top:10px}
    .logi-pay-bar i{display:block;height:100%;background:var(--success,#8a9a86)}
    .logi-pay-row{display:flex;align-items:center;gap:12px;padding:10px 4px;
                  border-bottom:1px solid var(--border,rgba(255,255,255,.07));font-size:12.5px}
    .logi-pay-amt{margin-left:auto;font-weight:800;white-space:nowrap}
    .logi-pay-amt.out{color:var(--danger,#c97d6e)}
    .logi-pay-fx{font-size:10.5px;color:var(--muted,#8d897f);font-weight:600}

    @media (max-width:700px){
      .logi-ct-grid{grid-template-columns:1fr}
      .logi-ct-body{padding:14px 15px;gap:12px}
      .logi-ct-v{font-size:15px}
      .logi-voy,.logi-ct-foot,.logi-units{padding-left:15px;padding-right:15px}
      .logi-pay-sum{gap:12px}
    }`;
    document.head.appendChild(el);
  }

  // ── Formatting ────────────────────────────────────────────────────────────
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  function money(n, ccy) {
    if (n == null || n === '' || !Number.isFinite(Number(n))) return '—';
    return nf.format(Math.round(Number(n))) + ' ' + (ccy || BASE_CURRENCY);
  }
  // dd/mm/yyyy, which is what the carrier's card shows and how the team writes a
  // date. Parsed as a plain date, never through the local timezone: a POD ETA is
  // a calendar day, and shifting it by an hour can move it to the day before.
  function fmtDate(v) {
    const s = String(v || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
    return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  }
  function fmtDateTime(v) {
    if (!v) return '—';
    const t = Date.parse(v);
    if (!Number.isFinite(t)) return '—';
    const d = new Date(t);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function statusPill(list, key) {
    const s = list.find(x => x.key === key) || list[0];
    return `<span class="logi-pill" style="background:${s.fg}22;color:${s.fg}">${esc(s.label)}</span>`;
  }
  const ic = (n, size) => `<i data-lucide="${n}" style="width:${size || 16}px;height:${size || 16}px"></i>`;
  function opts(list, cur, keyOf, labelOf) {
    return list.map(o => {
      const k = keyOf ? keyOf(o) : o;
      const l = labelOf ? labelOf(o) : o;
      return `<option value="${esc(k)}"${String(k) === String(cur ?? '') ? ' selected' : ''}>${esc(l)}</option>`;
    }).join('');
  }
  const val = id => (document.getElementById(id) || {}).value || '';

  // The ISO 6346 check digit, so a number typed off a screenshot is checked
  // before it is sent. Same algorithm as src/lib/constants.js — the letter values
  // are 10..38 with every multiple of 11 left out, written as a table because the
  // arithmetic that generates it is easy to get subtly wrong.
  const LETTER_VALUES = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24,
    25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 38];
  function normContainerNo(v) {
    return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
  }
  function inspectContainerNo(raw) {
    const no = normContainerNo(raw);
    if (!/^[A-Z]{4}[0-9]{7}$/.test(no)) return { no, valid: false, checkOk: false, expected: null };
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const c = no[i];
      const v = (c >= '0' && c <= '9') ? c.charCodeAt(0) - 48 : LETTER_VALUES[c.charCodeAt(0) - 65];
      sum += v * Math.pow(2, i);
    }
    const d = sum % 11 === 10 ? 0 : sum % 11;
    return { no, valid: true, checkOk: d === Number(no[10]), expected: d };
  }

  // ── Live vessel position ──────────────────────────────────────────────────
  // Leaflet is loaded from a CDN the first time a card with a fix is drawn, and
  // never otherwise. If it does not arrive — blocked CDN, offline PWA — the card
  // falls back to the coordinates and a link out, which is the information the
  // map was there to convey anyway.
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const LEAFLET_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  let _leafletPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (_leafletPromise) return _leafletPromise;
    _leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = LEAFLET_JS;
      js.onload = () => resolve(window.L);
      js.onerror = () => reject(new Error('Leaflet did not load'));
      document.head.appendChild(js);
    });
    return _leafletPromise;
  }

  // Degrees to the notation a chart uses. 31.2°N reads as a position; -31.2
  // reads as a number and gets mistaken for a longitude.
  function dm(v, axis) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const hemi = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : (n >= 0 ? 'E' : 'W');
    return `${Math.abs(n).toFixed(3)}° ${hemi}`;
  }

  // How old the fix is, and how much to trust it. Satellite AIS mid-ocean is
  // routinely an hour or more behind, so "live" is a claim worth qualifying on
  // the card rather than in a footnote nobody reads.
  function positionAge(at) {
    const t = Date.parse(at || '');
    if (!Number.isFinite(t)) return { label: 'age unknown', cls: 'stale', mins: null };
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    const cls = mins <= 90 ? 'fresh' : mins <= 12 * 60 ? 'aging' : 'stale';
    if (mins < 60) return { label: `${mins} min ago`, cls, mins };
    if (mins < 48 * 60) return { label: `${Math.round(mins / 60)} h ago`, cls, mins };
    return { label: `${Math.round(mins / 1440)} d ago`, cls, mins };
  }

  function positionHtml(c) {
    if (c.vessel_lat == null || c.vessel_lon == null) return '';
    const age = positionAge(c.vessel_position_at);
    const speed = c.vessel_speed != null && c.vessel_speed !== '' ? `${Number(c.vessel_speed).toFixed(1)} kn` : '';
    return `<div class="logi-pos">
      <div class="logi-pos-head">
        <span style="color:var(--primary,#c9a35e);display:flex">${ic('radio', 14)}</span>
        <span class="logi-pos-co">${esc(dm(c.vessel_lat, 'lat'))}, ${esc(dm(c.vessel_lon, 'lon'))}</span>
        ${speed ? `<span style="color:var(--muted,#8d897f)">· ${esc(speed)}</span>` : ''}
        <span class="logi-pos-age ${age.cls}" title="AIS reports are delayed, especially by satellite mid-ocean">${esc(age.label)}</span>
      </div>
      <div class="logi-map" id="logi-map-${c.id}"
           data-lat="${esc(c.vessel_lat)}" data-lon="${esc(c.vessel_lon)}"
           data-course="${esc(c.vessel_course == null ? '' : c.vessel_course)}"
           data-name="${esc(c.vessel_name || 'Vessel')}"></div>
    </div>`;
  }

  // Mount every map on the page that has not been mounted yet.
  function mountMaps() {
    const boxes = [...document.querySelectorAll('.logi-map')].filter(el => !el.dataset.mounted);
    if (!boxes.length) return;
    loadLeaflet().then(L => {
      boxes.forEach(el => {
        if (el.dataset.mounted) return;
        el.dataset.mounted = '1';
        const lat = Number(el.dataset.lat), lon = Number(el.dataset.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        // Zoom 4 shows the sea area around the ship. Street-level tiles are
        // useless in the middle of an ocean, which is where these boxes are.
        const map = L.map(el, { attributionControl: true, zoomControl: true, scrollWheelZoom: false })
          .setView([lat, lon], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 12, attribution: '© OpenStreetMap',
        }).addTo(map);
        const course = Number(el.dataset.course);
        const rot = Number.isFinite(course) ? course : 0;
        const icon = L.divIcon({
          className: '',
          iconSize: [22, 22], iconAnchor: [11, 11],
          html: `<div class="logi-ship-marker" style="transform:rotate(${rot}deg)">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2l7 19-7-4-7 4 7-19Z"/></svg></div>`,
        });
        L.marker([lat, lon], { icon }).addTo(map).bindPopup(el.dataset.name || 'Vessel');
        // The card is laid out after this runs, so Leaflet's first size read can
        // be of a zero-height box; one invalidate once painted fixes it.
        setTimeout(() => map.invalidateSize(), 60);
      });
    }).catch(() => {
      boxes.forEach(el => {
        el.outerHTML = `<div class="logi-map-fallback">Map unavailable offline —
          position ${esc(dm(el.dataset.lat, 'lat'))}, ${esc(dm(el.dataset.lon, 'lon'))}
          (<a href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(el.dataset.lat)}&mlon=${encodeURIComponent(el.dataset.lon)}#map=5/${encodeURIComponent(el.dataset.lat)}/${encodeURIComponent(el.dataset.lon)}"
              target="_blank" rel="noopener" style="color:var(--primary,#c9a35e)">open a map</a>)</div>`;
      });
    });
  }

  // ═══ Container tracking ═══════════════════════════════════════════════════
  let _containers = [];

  // How far along the leg the box is, 0..1. Time-based rather than distance —
  // ATD and ETA are the only two facts available — and clamped at both ends so a
  // late ship does not draw past the destination.
  function voyageProgress(atd, eta) {
    const a = Date.parse(atd || ''), e = Date.parse(eta || '');
    if (!Number.isFinite(a) || !Number.isFinite(e) || e <= a) return null;
    return Math.max(0, Math.min(1, (Date.now() - a) / (e - a)));
  }

  function voyageHtml(c) {
    if (!c.vessel_name && !c.pol_code && !c.pod_code) {
      return `<div class="logi-voy"><div class="logi-voy-none">No voyage recorded yet — edit the container to add the vessel and its ports.</div></div>`;
    }
    const p = voyageProgress(c.atd, c.eta);
    const pct = p == null ? 0 : Math.round(p * 100);
    return `<div class="logi-voy">
      <div class="logi-voy-ship">
        <span style="color:var(--primary,#c9a35e);display:flex">${ic('ship', 17)}</span>
        <span class="logi-voy-name">${esc(c.vessel_name || 'Vessel not set')}</span>
        ${c.vessel_imo ? `<span class="logi-voy-imo">IMO ${esc(c.vessel_imo)}</span>` : ''}
      </div>
      <div class="logi-voy-ends">
        <span>${c.pol_name ? 'Departure from ' + esc(c.pol_name) : 'Load port'}</span>
        <span>${c.pod_name ? 'Arrival at ' + esc(c.pod_name) : 'Discharge port'}</span>
      </div>
      <div class="logi-voy-codes"><span>${esc(c.pol_code || '—')}</span><span>${esc(c.pod_code || '—')}</span></div>
      <div class="logi-voy-track">
        <div class="logi-voy-line"></div>
        ${p == null ? '' : `<div class="logi-voy-done" style="width:calc((100% - 12px) * ${pct / 100})"></div>`}
        <div class="logi-voy-dot"></div>
        ${p == null ? '' : `<div class="logi-voy-ship-ic" style="left:calc(6px + (100% - 12px) * ${pct / 100})">${ic('navigation-2', 19)}</div>`}
        <div class="logi-voy-end">${ic('map-pin', 15)}</div>
      </div>
      <div class="logi-voy-times">
        <span style="color:var(--muted,#8d897f)">Actual departure<b style="color:var(--text,#f3efe7)">${esc(fmtDateTime(c.atd))}</b></span>
        <span style="color:var(--muted,#8d897f);text-align:right">Reported ETA<b style="color:var(--text,#f3efe7)">${esc(fmtDateTime(c.eta))}</b></span>
      </div>
    </div>`;
  }

  function ctRow(icon, label, value) {
    return `<div class="logi-ct-row">
      <span class="logi-ct-ic">${ic(icon, 22)}</span>
      <div style="min-width:0">
        <div class="logi-ct-k">${esc(label)}</div>
        <div class="logi-ct-v">${esc(value || '—')}</div>
      </div>
    </div>`;
  }

  function containerCardHtml(c) {
    const check = inspectContainerNo(c.container_no);
    const mayEdit = can('stock', 'tracking');
    const units = Array.isArray(c.units) ? c.units : [];
    return `<div class="logi-ct" data-container="${c.id}">
      <div class="logi-ct-body">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          ${statusPill(CONTAINER_STATUSES, c.status)}
          <span style="font-size:11px;color:var(--muted,#8d897f)">${esc(c.carrier || '')}</span>
        </div>
        ${ctRow('container', 'Container', c.container_no)}
        ${ctRow('box', 'Type', c.container_type)}
        ${ctRow('map-pin', 'Latest move', c.latest_move)}
        ${check.valid && !check.checkOk
          ? `<div class="logi-warn">${ic('alert-triangle', 13)} Check digit should be ${check.expected} — worth confirming against the B/L.</div>`
          : ''}
      </div>
      ${voyageHtml(c)}
      ${positionHtml(c)}
      <div class="logi-ct-foot">
        ${ctRow('timer', 'POD ETA', fmtDate(c.pod_eta))}
        <div class="logi-ct-actions">
          ${mayEdit ? `<button class="logi-ct-btn" title="Refresh from the carrier" onclick="ctRefresh(${c.id})">${ic('refresh-cw', 15)}</button>` : ''}
          ${mayEdit ? `<button class="logi-ct-btn" title="Edit" onclick="openContainerForm(${c.id})">${ic('pencil', 15)}</button>` : ''}
        </div>
      </div>
      <div class="logi-units">
        <span style="font-size:11px;color:var(--muted,#8d897f)">${units.length ? 'Vehicles inside' : 'No vehicles linked yet'}</span>
        ${units.map(u => `<span class="logi-unit-chip">${ic('car-front', 12)} ${esc(u.vin || (u.make + ' ' + u.model))}
          ${mayEdit ? `<button title="Remove" onclick="ctUnlinkUnit(${c.id},${u.id})">×</button>` : ''}</span>`).join('')}
        ${mayEdit ? `<button class="btn btn-outline btn-sm" style="padding:3px 10px;font-size:11px" onclick="ctLinkUnit(${c.id})">${ic('plus', 12)} Add vehicle</button>` : ''}
      </div>
    </div>`;
  }

  async function loadContainers() {
    injectStyles();
    const box = document.getElementById('logi-containers');
    if (!box) return;
    box.innerHTML = '<div class="loading"><span class="spinner"></span> Loading containers…</div>';
    let list = [];
    try {
      const r = await api('/api/dashboard/containers');
      const d = await r.json();
      if (!r.ok) { box.innerHTML = `<div class="error-msg" style="display:block">${esc(d.error || 'Could not load containers.')}</div>`; return; }
      list = Array.isArray(d) ? d : [];
    } catch (_) {
      box.innerHTML = '<div class="error-msg" style="display:block">Could not load containers.</div>';
      return;
    }
    _containers = list;
    box.innerHTML = list.length
      ? `<div class="logi-ct-grid">${list.map(containerCardHtml).join('')}</div>`
      : `<div class="logi-empty">Nothing is being tracked yet. Enter a container number above to start.</div>`;
    requestAnimationFrame(() => { lucide.createIcons(); mountMaps(); });
  }

  // The entry point the team asked for: type the container in, see the card.
  async function ctLookup() {
    injectStyles();
    const input = document.getElementById('logi-ct-search');
    const out = document.getElementById('logi-ct-result');
    if (!input || !out) return;
    const seen = inspectContainerNo(input.value);
    if (!seen.valid) {
      out.innerHTML = `<div class="error-msg" style="display:block">A container number is four letters then seven digits, like MSDU7337230.</div>`;
      return;
    }
    input.value = seen.no;
    out.innerHTML = '<div class="loading"><span class="spinner"></span> Looking it up…</div>';
    let d;
    try {
      const r = await api('/api/dashboard/containers/lookup/' + encodeURIComponent(seen.no));
      d = await r.json();
      if (!r.ok) { out.innerHTML = `<div class="error-msg" style="display:block">${esc(d.error || 'Lookup failed.')}</div>`; return; }
    } catch (_) {
      out.innerHTML = '<div class="error-msg" style="display:block">Lookup failed.</div>';
      return;
    }
    if (d.found) {
      out.innerHTML = `<div class="logi-ct-grid">${containerCardHtml(d.container)}</div>`;
      requestAnimationFrame(() => { lucide.createIcons(); mountMaps(); });
      return;
    }
    // Not tracked. Say what the provider had to say about it — "not-configured"
    // is a normal state here, not a failure, because typing the card in by hand
    // is a supported way to work.
    // A vendor's error is a JSON blob and must never be shouted at somebody
    // trying to find a container. The server classifies it; this turns the class
    // into one sentence that says what to do next. The blob stays as a tooltip.
    const NAMES = { terminal49: 'Terminal49', safecube: 'Safecube', generic: 'The carrier feed' };
    const label = esc(NAMES[d.provider_name] || 'The carrier platform');
    const WHY = {
      'not-configured': 'Automatic lookup is not set up, so enter what the carrier shows.',
      'not-tracked-yet': `${label} is not watching this container yet. Register it and the milestones arrive on the next refresh.`,
      unknown: 'CONTAINER_TRACKING_PROVIDER is not a name I recognise — check the spelling.',
      // The one that matters here: the key is fine, the plan is the limit.
      'plan-required': `${label} accepted the key, but reading containers back needs a paid plan — the free key may only register them. Register it below and follow it in ${label}, or enter the details by hand.`,
      unauthorized: `${label} did not recognise the key at all. Check CONTAINER_TRACKING_KEY, and that it is the right kind of key.`,
      forbidden: `${label} recognised the key and refused the request — an account, plan or scope limit rather than a wrong key. Test connection says which.`,
      'rate-limited': `${label} is rate-limiting us — try again shortly.`,
      'provider-down': `${label} is not responding right now.`,
      timeout: `${label} did not answer in time.`,
      unreachable: `Could not reach ${label}.`,
      'not-found': `${label} has no record of this container.`,
    };
    const why = d.code === 'ok' ? 'Prefilled from the carrier.'
      : (WHY[d.code] || `Carrier lookup unavailable — enter it by hand.`);
    const prefill = JSON.stringify({ container_no: seen.no, ...(d.prefill || {}) }).replace(/'/g, '&#39;');
    out.innerHTML = `<div class="logi-empty">
      <div style="font-weight:700;color:var(--text,#f3efe7);margin-bottom:6px">${esc(seen.no)} is not tracked yet</div>
      <div style="margin-bottom:12px;max-width:620px;margin-left:auto;margin-right:auto"${d.detail ? ` title="${esc(d.detail)}"` : ''}>${why}</div>
      ${can('stock', 'tracking') ? `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        ${d.can_register ? `<button class="btn btn-outline btn-sm" onclick="ctRegister('${esc(seen.no)}')">Ask ${label} to track it</button>` : ''}
        <button class="btn btn-primary btn-sm" onclick='openContainerForm(null, ${prefill})'>Start tracking it</button>
      </div>` : ''}
      ${seen.checkOk ? '' : `<div class="logi-warn" style="justify-content:center">Check digit should be ${seen.expected} — worth confirming against the B/L.</div>`}
    </div>`;
    requestAnimationFrame(() => lucide.createIcons());
  }

  // "I added the key — is it working?" as one button rather than another deploy.
  // Probes with a container number that exists in the ISO standard's own example
  // and nowhere in anyone's fleet, so nothing is registered and no real shipment
  // is touched: what is being tested is the vendor's REPLY.
  async function ctProviderCheck() {
    toast('Testing the carrier connection…');
    let d;
    try {
      const r = await api('/api/dashboard/containers/provider-status?probe=1');
      d = await r.json();
      if (!r.ok) throw new Error(d.error || 'check failed');
    } catch (e) { toast('Could not run the check.'); return; }

    const name = d.provider === 'none' ? 'No carrier feed is configured'
      : d.provider === 'unknown' ? 'CONTAINER_TRACKING_PROVIDER is not a name I recognise'
      : `Provider: ${d.provider}`;
    const parts = [name];
    if (d.provider !== 'none' && d.provider !== 'unknown') {
      parts.push(d.reachable ? 'key accepted'
        : `key rejected (${d.probe}${d.http ? ' ' + d.http : ''})`);
      // Safecube carries the position on the same shipment, so it needs no
      // second vendor — worth saying, because otherwise somebody goes shopping
      // for an AIS subscription they do not need.
      parts.push(d.carrier_has_position ? 'positions included' : `AIS: ${d.ais}`);
      parts.push(d.webhook_ready ? 'webhook secret set' : 'no webhook secret');
    }
    toast(parts.join(' · '));

    // A refused key: say which header shape the vendor DOES accept, and the
    // exact variable to set. This is the answer that was otherwise only in docs
    // we could not reach.
    if (d.auth) {
      const box = document.getElementById('logi-ct-result');
      if (!box) return;
      const tried = list => (list || []).map(a =>
        `<li><code>${esc(a.shape || a.base)}</code> → ${esc(a.code)}${a.status ? ' (' + a.status + ')' : ''}</li>`).join('');
      // Recognised but refused: the key is FINE. Saying "rejected" here is what
      // sends somebody rotating a key that was never the problem.
      if (d.auth.ok === false && d.auth.stage === 'permission') {
        box.innerHTML = `<div class="logi-empty" style="text-align:left">
          <div style="font-weight:700;color:var(--warning,#c9a35e);margin-bottom:8px">
            ${ic('key-round', 14)} The key is valid — the account is not permitted</div>
          <div style="margin-bottom:10px">${esc(d.auth.reason)}</div>
          <div style="margin-bottom:6px">Worth checking, in this order: that the trial includes API access;
            whether this is a sandbox key being sent to production; and whether the API product needs enabling on the account.</div>
          <div style="font-size:11.5px;color:var(--muted,#8d897f);margin-top:10px">Headers tried:</div>
          <ul style="margin:6px 0 0 18px;font-size:11.5px;color:var(--muted,#8d897f)">${tried(d.auth.attempts)}</ul>
          ${d.auth.baseAttempts ? `<div style="font-size:11.5px;color:var(--muted,#8d897f);margin-top:8px">Base paths tried with <code>${esc(d.auth.shape)}</code>:</div>
            <ul style="margin:6px 0 0 18px;font-size:11.5px;color:var(--muted,#8d897f)">${tried(d.auth.baseAttempts)}</ul>` : ''}
        </div>`;
        requestAnimationFrame(() => lucide.createIcons());
        return;
      }
      box.innerHTML = d.auth.ok
        ? `<div class="logi-empty" style="text-align:left">
             <div style="font-weight:700;color:var(--success,#8a9a86);margin-bottom:8px">
               ${ic('check', 14)} The key works — it just needs a different header</div>
             <div style="margin-bottom:10px">${esc(d.provider)} accepted <code>${esc(d.auth.shape)}</code>.</div>
             <div>Set this and redeploy:</div>
             <pre style="margin:8px 0 0;padding:10px 12px;background:rgba(255,255,255,.05);border-radius:8px;overflow-x:auto;font-size:12px">${esc(d.auth.env)}</pre>
             ${d.auth.base ? `<div style="font-size:11.5px;color:var(--muted,#8d897f);margin-top:8px">Working base: <code>${esc(d.auth.base)}</code></div>` : ''}
           </div>`
        : `<div class="logi-empty" style="text-align:left">
             <div style="font-weight:700;color:var(--danger,#c97d6e);margin-bottom:8px">
               ${ic('alert-triangle', 14)} Every header shape was refused</div>
             <div style="margin-bottom:10px">${esc(d.auth.reason || 'The key itself looks wrong, or is not active yet.')}</div>
             <div style="font-size:11.5px;color:var(--muted,#8d897f)">Tried:</div>
             <ul style="margin:6px 0 0 18px;font-size:11.5px;color:var(--muted,#8d897f)">${tried(d.auth.attempts)}</ul>
           </div>`;
      requestAnimationFrame(() => lucide.createIcons());
    }
  }

  // Register a box with the carrier platform, then create our row for it so the
  // team has somewhere to look while the milestones catch up.
  async function ctRegister(no) {
    toast('Registering with the carrier…');
    const r = await api('/api/dashboard/containers/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ container_no: no }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || 'Could not register that container.'); return; }
    if (!d.ok) {
      toast(d.code === 'plan-required'
        ? 'That needs a paid plan on the carrier platform.'
        : d.code === 'unauthorized' ? 'The carrier rejected the key.'
        : `Carrier would not take it: ${d.reason}`);
      return;
    }
    toast(`Registered — status ${d.status}. Milestones arrive on the next refresh.`);
    openContainerForm(null, { container_no: no });
  }

  function openContainerForm(id, prefill) {
    const c = id ? (_containers.find(x => String(x.id) === String(id)) || {}) : (prefill || {});
    const f = (label, idAttr, value, type, ph) => `<div class="form-group">
      <label class="form-label">${esc(label)}</label>
      <input class="form-control" id="${idAttr}" type="${type || 'text'}" value="${esc(value ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>
    </div>`;
    // datetime-local wants "YYYY-MM-DDTHH:MM" and rejects the Z-suffixed ISO the
    // server stores, which is why the tail is cut rather than passed through.
    const dtLocal = v => {
      const t = Date.parse(v || '');
      if (!Number.isFinite(t)) return '';
      const d = new Date(t); const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    modal(id ? `Container ${c.container_no || ''}` : 'Track a container', `
      <div class="qt-grid-3">
        ${f('Container number *', 'ct-no', c.container_no, 'text', 'MSDU7337230')}
        <div class="form-group"><label class="form-label">Type</label>
          <select class="form-control" id="ct-type">${opts([''].concat(CONTAINER_TYPES), c.container_type)}</select></div>
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-control" id="ct-status">${opts(CONTAINER_STATUSES, c.status || 'in_transit', o => o.key, o => o.label)}</select></div>
        ${f('Carrier', 'ct-carrier', c.carrier, 'text', 'MSC')}
        ${f('B/L number', 'ct-bl', c.bl_number)}
        ${f('Latest move', 'ct-move', c.latest_move, 'text', 'SINGAPORE, SG')}
        ${f('POD ETA', 'ct-eta-date', String(c.pod_eta || '').slice(0, 10), 'date')}
        ${f('Vessel', 'ct-vessel', c.vessel_name, 'text', 'MSC ELISABETTA')}
        ${f('IMO', 'ct-imo', c.vessel_imo, 'text', '9954747')}
        ${f('Load port code', 'ct-pol-code', c.pol_code, 'text', 'SGSIN')}
        ${f('Load port', 'ct-pol-name', c.pol_name, 'text', 'Singapore')}
        ${f('Actual departure', 'ct-atd', dtLocal(c.atd), 'datetime-local')}
        ${f('Discharge port code', 'ct-pod-code', c.pod_code, 'text', 'ITGIT')}
        ${f('Discharge port', 'ct-pod-name', c.pod_name, 'text', 'Gioia Tauro')}
        ${f('Reported arrival', 'ct-eta', dtLocal(c.eta), 'datetime-local')}
      </div>
      <div style="font-size:12px;font-weight:700;margin:14px 0 6px">Vessel position</div>
      <div class="logi-hint" style="margin-bottom:10px">Filled by the AIS feed when one is configured. Type it in if the agent sends a position — decimal degrees, south and west negative.</div>
      <div class="qt-grid-3">
        ${f('Latitude', 'ct-lat', c.vessel_lat, 'number', '-33.918')}
        ${f('Longitude', 'ct-lon', c.vessel_lon, 'number', '18.423')}
        ${f('Reported at', 'ct-pos-at', dtLocal(c.vessel_position_at), 'datetime-local')}
        ${f('Course °', 'ct-course', c.vessel_course, 'number')}
        ${f('Speed kn', 'ct-speed', c.vessel_speed, 'number')}
        ${f('MMSI', 'ct-mmsi', c.vessel_mmsi, 'text', '636092xxx')}
      </div>
      <div class="form-group"><label class="form-label">Notes</label>
        <textarea class="form-control" id="ct-notes" rows="2">${esc(c.notes || '')}</textarea></div>
      <div id="ct-err" class="error-msg" style="display:none"></div>`,
      `<button class="btn btn-outline" onclick="PROCFG.closeModal()">Cancel</button>
       ${id ? `<button class="btn btn-outline" style="color:var(--danger,#c97d6e);border-color:var(--danger,#c97d6e)" onclick="deleteContainer(${id})">Delete</button>` : ''}
       <button class="btn btn-primary" onclick="saveContainer(${id || 'null'})">${id ? 'Save changes' : 'Start tracking'}</button>`,
      { wide: true });
    requestAnimationFrame(() => lucide.createIcons());
  }

  async function saveContainer(id) {
    const err = document.getElementById('ct-err');
    const seen = inspectContainerNo(val('ct-no'));
    if (!seen.valid) {
      err.textContent = 'A container number is four letters then seven digits, like MSDU7337230.';
      err.style.display = 'block';
      return;
    }
    const payload = {
      container_no: seen.no,
      container_type: val('ct-type'), status: val('ct-status'),
      carrier: val('ct-carrier'), bl_number: val('ct-bl'),
      latest_move: val('ct-move'), pod_eta: val('ct-eta-date'),
      vessel_name: val('ct-vessel'), vessel_imo: val('ct-imo'),
      pol_code: val('ct-pol-code'), pol_name: val('ct-pol-name'), atd: val('ct-atd'),
      pod_code: val('ct-pod-code'), pod_name: val('ct-pod-name'), eta: val('ct-eta'),
      vessel_lat: val('ct-lat'), vessel_lon: val('ct-lon'),
      vessel_position_at: val('ct-pos-at'), vessel_course: val('ct-course'),
      vessel_speed: val('ct-speed'), vessel_mmsi: val('ct-mmsi'),
      notes: val('ct-notes'),
    };
    const r = await api(id ? `/api/dashboard/containers/${id}` : '/api/dashboard/containers',
      { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = d.error || 'Could not save.'; err.style.display = 'block'; return; }
    closeModal();
    toast(id ? 'Container updated.' : `Now tracking ${seen.no}.`);
    const out = document.getElementById('logi-ct-result');
    if (out) out.innerHTML = '';
    loadContainers();
  }

  async function deleteContainer(id) {
    if (!confirm('Stop tracking this container? The vehicles inside it are not deleted.')) return;
    const r = await api(`/api/dashboard/containers/${id}`, { method: 'DELETE' });
    if (!r.ok) { toast('Could not delete that container.'); return; }
    closeModal();
    loadContainers();
  }

  async function ctRefresh(id) {
    toast('Checking the carrier…');
    const r = await api(`/api/dashboard/containers/${id}/refresh`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || 'Refresh failed.'); return; }

    // Two feeds, reported separately — "the ETA is stale but the dot moved" is a
    // real and common outcome, and one summary line would hide it.
    const say = [];
    const SHORT = { 'not-configured': 'no carrier feed set up', 'not-tracked-yet': 'carrier is not watching this box yet',
      'plan-required': 'carrier reads need a paid plan',
      unauthorized: 'carrier did not recognise the key', forbidden: 'carrier recognised the key but refused',
      'rate-limited': 'carrier is rate-limiting us', 'provider-down': 'carrier is down',
      timeout: 'carrier timed out', 'no-vessel-id': 'no IMO on this container yet' };
    if (d.carrier && d.carrier.ok) say.push('carrier updated');
    else if (d.carrier) say.push(SHORT[d.carrier.code] || `carrier: ${d.carrier.reason}`);
    if (d.position && d.position.ok) say.push('position updated');
    else if (d.position) say.push(SHORT[d.position.code] || `position: ${d.position.reason}`);

    if (!d.ok && !d.changed) {
      toast(say.length ? say.join(' · ') : 'Nothing to update.');
      return;
    }
    toast(d.changed ? `${say.join(' · ')} (${d.changed} field${d.changed === 1 ? '' : 's'})` : 'Already up to date.');
    loadContainers();
  }

  async function ctLinkUnit(containerId) {
    const units = await loadUnitList();
    const free = units.filter(u => u.status !== 'delivered' && u.status !== 'cancelled');
    if (!free.length) {
      toast('No vehicles in the register yet — add one under Register first.');
      return;
    }
    modal('Add a vehicle to the container', `
      <div class="form-group"><label class="form-label">Vehicle</label>
        <select class="form-control" id="ct-unit-pick">
          ${free.map(u => `<option value="${u.id}">${esc([u.vin || 'no VIN', u.make, u.model, u.trim, u.colour].filter(Boolean).join(' · '))}</option>`).join('')}
        </select></div>
      <div id="ct-unit-err" class="error-msg" style="display:none"></div>`,
      `<button class="btn btn-outline" onclick="PROCFG.closeModal()">Cancel</button>
       <button class="btn btn-primary" onclick="ctLinkUnitSave(${containerId})">Add</button>`);
  }

  async function ctLinkUnitSave(containerId) {
    const unitId = Number(val('ct-unit-pick'));
    const r = await api(`/api/dashboard/containers/${containerId}/units`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unit_id: unitId }) });
    const d = await r.json().catch(() => ({}));
    const err = document.getElementById('ct-unit-err');
    if (!r.ok) { if (err) { err.textContent = d.error || 'Could not add.'; err.style.display = 'block'; } return; }
    closeModal();
    loadContainers();
  }

  async function ctUnlinkUnit(containerId, unitId) {
    const r = await api(`/api/dashboard/containers/${containerId}/units/${unitId}`, { method: 'DELETE' });
    if (!r.ok) { toast('Could not remove that vehicle.'); return; }
    loadContainers();
  }

  // ═══ Vehicle register ═════════════════════════════════════════════════════
  let _units = [];

  async function loadUnitList() {
    try {
      const r = await api('/api/dashboard/units');
      const d = await r.json();
      if (r.ok && Array.isArray(d)) { _units = d; return d; }
    } catch (_) { /* fall through */ }
    return _units;
  }

  async function loadUnits() {
    injectStyles();
    const box = document.getElementById('logi-units-table');
    if (!box) return;
    box.innerHTML = '<div class="loading"><span class="spinner"></span> Loading the register…</div>';
    const q = (document.getElementById('logi-unit-search') || {}).value || '';
    const status = (document.getElementById('logi-unit-status') || {}).value || '';
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (status) qs.set('status', status);
    let list;
    try {
      const r = await api('/api/dashboard/units' + (qs.toString() ? '?' + qs : ''));
      const d = await r.json();
      if (!r.ok) { box.innerHTML = `<div class="error-msg" style="display:block">${esc(d.error || 'Could not load the register.')}</div>`; return; }
      list = d;
    } catch (_) {
      box.innerHTML = '<div class="error-msg" style="display:block">Could not load the register.</div>';
      return;
    }
    _units = list;
    if (!list.length) {
      box.innerHTML = `<div class="logi-empty">${q || status ? 'No vehicle matches that.' : 'No vehicles yet. Add one to start costing and tracking it.'}</div>`;
      return;
    }
    const mayEdit = can('stock', 'edit');
    box.innerHTML = `<div class="table-scroll"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:900px">
      <thead><tr style="text-align:left;color:var(--muted,#8d897f);border-bottom:1px solid var(--border,rgba(255,255,255,.09))">
        <th style="padding:8px 10px">VIN</th><th style="padding:8px 10px">Vehicle</th>
        <th style="padding:8px 10px">Colour</th><th style="padding:8px 10px">Status</th>
        <th style="padding:8px 10px">Supplier</th><th style="padding:8px 10px;text-align:right">Landed cost</th>
        <th style="padding:8px 10px">Location</th><th></th>
      </tr></thead><tbody>
      ${list.map(u => `<tr style="border-bottom:1px solid rgba(255,255,255,.05)">
        <td style="padding:8px 10px;font-family:ui-monospace,monospace">${esc(u.vin || '—')}</td>
        <td style="padding:8px 10px">${esc([u.make, u.model, u.trim].filter(Boolean).join(' '))}</td>
        <td style="padding:8px 10px">${esc(u.colour || '—')}</td>
        <td style="padding:8px 10px">${statusPill(UNIT_STATUSES, u.status)}</td>
        <td style="padding:8px 10px">${esc(u.supplier || '—')}</td>
        <td style="padding:8px 10px;text-align:right;white-space:nowrap">${
          u.costs && u.costs.landed_known
            ? esc(money(u.costs.landed_base))
            : `<span title="No exchange rate booked against the purchase price yet" style="color:var(--muted,#8d897f)">rate not set</span>`}</td>
        <td style="padding:8px 10px">${esc(u.location || '—')}</td>
        <td style="padding:8px 10px;text-align:right">${mayEdit
          ? `<button class="btn btn-outline btn-sm" style="padding:3px 10px;font-size:11px" onclick="openUnitForm(${u.id})">Edit</button>` : ''}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
    requestAnimationFrame(() => lucide.createIcons());
  }

  function openUnitForm(id) {
    const u = id ? (_units.find(x => String(x.id) === String(id)) || {}) : {};
    const f = (label, idAttr, value, type, ph) => `<div class="form-group">
      <label class="form-label">${esc(label)}</label>
      <input class="form-control" id="${idAttr}" type="${type || 'text'}" value="${esc(value ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>
    </div>`;
    modal(id ? `Vehicle ${u.vin || u.model || ''}` : 'Add a vehicle to the register', `
      <div class="qt-grid-3">
        ${f('VIN', 'vu-vin', u.vin, 'text', 'Leave empty until the supplier sends it')}
        ${f('Make *', 'vu-make', u.make)}
        ${f('Model *', 'vu-model', u.model)}
        ${f('Trim', 'vu-trim', u.trim)}
        ${f('Model year', 'vu-year', u.model_year, 'number')}
        ${f('Colour', 'vu-colour', u.colour)}
        <div class="form-group"><label class="form-label">Status</label>
          <select class="form-control" id="vu-status">${opts(UNIT_STATUSES, u.status || 'ordered', o => o.key, o => o.label)}</select></div>
        ${f('Supplier', 'vu-supplier', u.supplier)}
        ${f('Location', 'vu-location', u.location, 'text', 'Yard, port, showroom…')}
      </div>
      <div style="font-size:12px;font-weight:700;margin:14px 0 8px">Cost</div>
      <div class="logi-hint" style="margin-bottom:10px">Purchase price is in the currency you bought in; the rate converts it to ${BASE_CURRENCY}. Freight, customs and clearing are local charges, so they are already in ${BASE_CURRENCY}.</div>
      <div class="qt-grid-3">
        <div class="form-group"><label class="form-label">Purchase currency</label>
          <select class="form-control" id="vu-ccy">${opts(CURRENCIES, u.purchase_ccy || 'USD')}</select></div>
        ${f('Purchase price', 'vu-cost', u.purchase_cost, 'number')}
        ${f(`Rate → ${BASE_CURRENCY}`, 'vu-fx', u.fx_rate, 'number')}
        ${f('Freight', 'vu-freight', u.freight_cost, 'number')}
        ${f('Customs', 'vu-customs', u.customs_cost, 'number')}
        ${f('Clearing', 'vu-clearing', u.clearing_cost, 'number')}
      </div>
      <div style="font-size:12px;font-weight:700;margin:14px 0 8px">Dates</div>
      <div class="qt-grid-3">
        ${f('Ordered', 'vu-ordered', String(u.ordered_on || '').slice(0, 10), 'date')}
        ${f('Shipped', 'vu-shipped', String(u.shipped_on || '').slice(0, 10), 'date')}
        ${f('Arrived', 'vu-arrived', String(u.arrived_on || '').slice(0, 10), 'date')}
      </div>
      <div class="form-group"><label class="form-label">Notes</label>
        <textarea class="form-control" id="vu-notes" rows="2">${esc(u.notes || '')}</textarea></div>
      <div id="vu-err" class="error-msg" style="display:none"></div>`,
      `<button class="btn btn-outline" onclick="PROCFG.closeModal()">Cancel</button>
       <button class="btn btn-primary" onclick="saveUnit(${id || 'null'})">${id ? 'Save changes' : 'Add vehicle'}</button>`,
      { wide: true });
  }

  async function saveUnit(id) {
    const err = document.getElementById('vu-err');
    const payload = {
      vin: val('vu-vin'), make: val('vu-make'), model: val('vu-model'), trim: val('vu-trim'),
      model_year: val('vu-year'), colour: val('vu-colour'), status: val('vu-status'),
      supplier: val('vu-supplier'), location: val('vu-location'),
      purchase_ccy: val('vu-ccy'), purchase_cost: val('vu-cost'), fx_rate: val('vu-fx'),
      freight_cost: val('vu-freight'), customs_cost: val('vu-customs'), clearing_cost: val('vu-clearing'),
      ordered_on: val('vu-ordered'), shipped_on: val('vu-shipped'), arrived_on: val('vu-arrived'),
      notes: val('vu-notes'),
    };
    if (!payload.make || !payload.model) {
      err.textContent = 'Make and Model are required.'; err.style.display = 'block'; return;
    }
    const r = await api(id ? `/api/dashboard/units/${id}` : '/api/dashboard/units',
      { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = d.error || 'Could not save.'; err.style.display = 'block'; return; }
    closeModal();
    loadUnits();
  }

  // ═══ Payments ═════════════════════════════════════════════════════════════
  // Opened from a sale. The summary is the server's — the client never does the
  // arithmetic, so the Sales tab, a report and this panel cannot disagree.
  let _paySaleId = null;

  async function openPaymentsPanel(saleId) {
    injectStyles();
    _paySaleId = saleId;
    modal('Payments', '<div class="loading"><span class="spinner"></span> Loading the ledger…</div>', '', { wide: true });
    let d;
    try {
      const r = await api(`/api/dashboard/sales/${saleId}/payments`);
      d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load payments.');
    } catch (e) {
      modal('Payments', `<div class="error-msg" style="display:block">${esc(e.message)}</div>`,
        `<button class="btn btn-outline" onclick="PROCFG.closeModal()">Close</button>`);
      return;
    }
    renderPaymentsPanel(d);
  }

  function renderPaymentsPanel(d) {
    const s = d.summary || {};
    const kindLabel = k => (PAYMENT_KINDS.find(x => x.key === k) || { label: k }).label;
    const rows = (d.payments || []).map(p => `<div class="logi-pay-row">
      <span style="color:var(--muted,#8d897f);min-width:82px">${esc(fmtDate(p.paid_on))}</span>
      <span style="font-weight:600">${esc(kindLabel(p.kind))}</span>
      <span style="color:var(--muted,#8d897f)">${esc((p.method || '').replace(/_/g, ' '))}${p.reference ? ' · ' + esc(p.reference) : ''}</span>
      ${p.receipt && p.receipt.url ? `<a href="${esc(p.receipt.url)}" target="_blank" rel="noopener" title="Receipt" style="display:flex;color:var(--primary,#c9a35e)">${ic('paperclip', 13)}</a>` : ''}
      <span class="logi-pay-amt ${p.direction === 'out' ? 'out' : ''}">
        ${p.direction === 'out' ? '−' : ''}${esc(money(p.amount, p.currency))}
        ${p.currency !== BASE_CURRENCY ? `<span class="logi-pay-fx"> @ ${esc(p.fx_rate)} → ${esc(money(p.amount_base))}</span>` : ''}
      </span>
      ${can('deals', 'paymentsEdit') ? `<button class="logi-ct-btn" style="width:26px;height:26px" title="Edit" onclick="openPaymentForm(${d.sale.id},${p.id})">${ic('pencil', 12)}</button>` : ''}
    </div>`).join('');

    modal(`Payments — ${esc(d.sale.client || 'sale #' + d.sale.id)}`, `
      <div class="logi-pay-sum">
        <div class="logi-pay-cell"><div class="logi-pay-k">Agreed</div><div class="logi-pay-v">${esc(money(s.price))}</div></div>
        <div class="logi-pay-cell"><div class="logi-pay-k">Received</div><div class="logi-pay-v" style="color:var(--success,#8a9a86)">${esc(money(s.net))}</div></div>
        <div class="logi-pay-cell"><div class="logi-pay-k">Outstanding</div>
          <div class="logi-pay-v" style="color:${s.outstanding > 0 ? 'var(--danger,#c97d6e)' : 'var(--success,#8a9a86)'}">${esc(money(s.outstanding))}</div></div>
        <div class="logi-pay-cell"><div class="logi-pay-k">Collected</div><div class="logi-pay-v">${Number(s.collected_pct || 0)}%</div></div>
        ${s.days_overdue > 0 ? `<div class="logi-pay-cell"><div class="logi-pay-k">Overdue</div>
          <div class="logi-pay-v" style="color:var(--danger,#c97d6e)">${Number(s.days_overdue)} day${s.days_overdue === 1 ? '' : 's'}</div></div>` : ''}
        <div style="flex:1 1 100%"><div class="logi-pay-bar"><i style="width:${Math.max(0, Math.min(100, Number(s.collected_pct || 0)))}%"></i></div></div>
      </div>
      ${rows || '<div class="logi-empty">No payments recorded against this sale yet.</div>'}
      ${s.supplier_costs > 0 ? `<div class="logi-hint" style="margin-top:12px">Supplier and shipping payments on this sale: ${esc(money(s.supplier_costs))} — counted as cost, not settlement.</div>` : ''}`,
      `<button class="btn btn-outline" onclick="PROCFG.closeModal()">Close</button>
       ${can('deals', 'paymentsEdit') ? `<button class="btn btn-primary" onclick="openPaymentForm(${d.sale.id},null)">${ic('plus', 14)} Record a payment</button>` : ''}`,
      { wide: true });
    requestAnimationFrame(() => lucide.createIcons());
  }

  function openPaymentForm(saleId, paymentId) {
    _paySaleId = saleId;
    const today = new Date().toISOString().slice(0, 10);
    modal(paymentId ? 'Edit payment' : 'Record a payment', `
      <div class="qt-grid-3">
        <div class="form-group"><label class="form-label">What for</label>
          <select class="form-control" id="pm-kind">${opts(PAYMENT_KINDS, 'instalment', o => o.key, o => o.label)}</select></div>
        <div class="form-group"><label class="form-label">Amount *</label>
          <input class="form-control" id="pm-amount" type="number" step="0.01" placeholder="0.00"></div>
        <div class="form-group"><label class="form-label">Currency</label>
          <select class="form-control" id="pm-ccy" onchange="pmCcyChanged()">${opts(CURRENCIES, BASE_CURRENCY)}</select></div>
        <div class="form-group" id="pm-fx-wrap" style="display:none"><label class="form-label">Rate → ${BASE_CURRENCY}</label>
          <input class="form-control" id="pm-fx" type="number" step="0.0001" placeholder="e.g. 48.5"></div>
        <div class="form-group"><label class="form-label">Method</label>
          <select class="form-control" id="pm-method">${opts([''].concat(PAYMENT_METHODS), '', o => o, o => (o ? o.replace(/_/g, ' ') : '—'))}</select></div>
        <div class="form-group"><label class="form-label">Paid on</label>
          <input class="form-control" id="pm-date" type="date" value="${today}"></div>
        <div class="form-group"><label class="form-label">Reference</label>
          <input class="form-control" id="pm-ref" placeholder="Transfer or cheque number"></div>
      </div>
      <div class="form-group"><label class="form-label">Notes</label>
        <input class="form-control" id="pm-notes"></div>
      <div class="logi-hint">Amounts are recorded with the rate used on the day, so the ${BASE_CURRENCY} figure does not move when the rate does.</div>
      <div id="pm-err" class="error-msg" style="display:none"></div>`,
      `<button class="btn btn-outline" onclick="openPaymentsPanel(${saleId})">Back</button>
       <button class="btn btn-primary" onclick="savePayment(${saleId},${paymentId || 'null'})">Save</button>`,
      { wide: true });
  }

  // A payment already in the base currency has no rate to ask for, so the field
  // only appears when it is needed — and it is required when it does.
  function pmCcyChanged() {
    const wrap = document.getElementById('pm-fx-wrap');
    if (wrap) wrap.style.display = val('pm-ccy') === BASE_CURRENCY ? 'none' : '';
  }

  async function savePayment(saleId, paymentId) {
    const err = document.getElementById('pm-err');
    const payload = {
      sale_id: saleId,
      kind: val('pm-kind'), amount: val('pm-amount'), currency: val('pm-ccy'),
      fx_rate: val('pm-fx'), method: val('pm-method'), paid_on: val('pm-date'),
      reference: val('pm-ref'), notes: val('pm-notes'),
    };
    if (!(Number(payload.amount) > 0)) { err.textContent = 'Enter an amount greater than zero.'; err.style.display = 'block'; return; }
    const r = await api(paymentId ? `/api/dashboard/payments/${paymentId}` : '/api/dashboard/payments',
      { method: paymentId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = d.error || 'Could not save the payment.'; err.style.display = 'block'; return; }
    toast('Payment recorded.');
    openPaymentsPanel(saleId);
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  // Inventory is three views of the same stock now: the model register that was
  // always here, the vehicles themselves, and the boxes they arrive in.
  let _invTab = 'models';
  function inventoryTab(tab) {
    injectStyles();
    _invTab = tab;
    document.querySelectorAll('.logi-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ['models', 'units', 'tracking'].forEach(t => {
      const el = document.getElementById('inv-pane-' + t);
      if (el) el.style.display = t === tab ? '' : 'none';
    });
    if (tab === 'units') loadUnits();
    if (tab === 'tracking') loadContainers();
    requestAnimationFrame(() => lucide.createIcons());
  }

  Object.assign(window, {
    inventoryTab, injectLogiStyles: injectStyles,
    loadUnits, loadUnitList, openUnitForm, saveUnit,
    loadContainers, ctLookup, openContainerForm, saveContainer, deleteContainer,
    ctRefresh, ctRegister, ctProviderCheck, ctLinkUnit, ctLinkUnitSave, ctUnlinkUnit,
    logiMountMaps: mountMaps, logiPositionAge: positionAge, logiDegrees: dm,
    openPaymentsPanel, openPaymentForm, savePayment, pmCcyChanged,
    logiInspectContainerNo: inspectContainerNo, logiVoyageProgress: voyageProgress,
    LOGI_UNIT_STATUSES: UNIT_STATUSES, LOGI_CONTAINER_STATUSES: CONTAINER_STATUSES,
    LOGI_CONTAINER_TYPES: CONTAINER_TYPES, LOGI_PAYMENT_KINDS: PAYMENT_KINDS,
    LOGI_PAYMENT_METHODS: PAYMENT_METHODS, LOGI_CURRENCIES: CURRENCIES,
  });
})();
