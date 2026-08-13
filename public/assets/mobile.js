// Shared mobile behaviour for both portals.
//
// Below 700px mobile.css restacks every data table into cards, one labelled line per
// cell. The labels come from each table's own <th>, copied onto the cells here rather
// than added by hand in twelve different renderers — none of which share a component,
// and several of which build their markup as one long innerHTML string.
//
// A MutationObserver rather than a call at each render site, for the same reason: the
// renderers are scattered and a new one would silently miss out. This way a table is
// labelled because it exists, not because somebody remembered.

(function () {
  const LABELLED = '_mlLabelled';

  function labelTable(table) {
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!heads.length) return;
    for (const tr of table.querySelectorAll('tbody tr')) {
      // A full-width "no rows yet" cell is not a record; leave it alone.
      if (tr.children.length === 1 && tr.children[0].hasAttribute('colspan')) continue;
      [...tr.children].forEach((cell, i) => {
        const label = heads[i];
        if (label != null && cell.getAttribute('data-label') !== label) {
          cell.setAttribute('data-label', label);
        }
      });
    }
  }

  function labelAll(root) {
    const scope = root && root.querySelectorAll ? root : document;
    for (const t of scope.querySelectorAll('.table-scroll table')) labelTable(t);
    if (scope !== document && scope.matches && scope.matches('.table-scroll table')) labelTable(scope);
  }

  function start() {
    labelAll(document);
    // Rows are replaced wholesale by innerHTML on every filter, sort and reload, so
    // watch the subtree rather than trying to hook each renderer.
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches && n.matches('table')) { labelTable(n); continue; }
          if (n.querySelectorAll) labelAll(n);
          // A <tr> appended into an existing table needs its own table relabelled.
          const t = n.closest && n.closest('.table-scroll table');
          if (t) labelTable(t);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    document.body[LABELLED] = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

// Keep the calendar embed in step with the viewport, at load and on rotation.
(function () {
  const sync = () => { try { mlCalendarMode(); } catch (_) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
  else sync();
  window.matchMedia('(max-width: 700px)').addEventListener('change', sync);
})();

// ── Escape closes whatever is open ───────────────────────────────────────────
// There are 34 fixed overlays across the two portals in five different patterns —
// the generic showModal one, a dozen hand-rolled divs that borrow its CSS, four PDF
// viewers that borrow nothing, the drawers and the huddle sheet — and not one of them
// bound Escape. One document-level handler rather than 34 edits, so the 35th overlay
// somebody adds gets the behaviour for free.
function mlOpenOverlay() {
  const vw = window.innerWidth, vh = window.innerHeight;
  let best = null, bestZ = -1;
  for (const el of document.querySelectorAll('div, nav, aside')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    // Not every overlay hides with display:none — the help scrim stays laid out at
    // opacity:0 with pointer-events:none, and being the highest z-index on the page it
    // was answering for every Escape. If you cannot click it, it is not open.
    if (cs.pointerEvents === 'none' || parseFloat(cs.opacity) < 0.05) continue;
    const r = el.getBoundingClientRect();
    // A scrim starts at the origin and covers the viewport. Anchoring on the origin as
    // well as the size is what separates it from a side panel that happens to be full
    // height — the help panel is 96vw wide and merely translated off-canvas when
    // closed, so a size-only test picked it as the top overlay and Escape did nothing.
    if (r.left > 1 || r.top > 1) continue;
    if (r.width < vw * 0.95 || r.height < vh * 0.95) continue;
    const z = parseInt(cs.zIndex, 10) || 0;
    if (z >= bestZ) { bestZ = z; best = el; }
  }
  return best;
}

function mlCloseOverlay(el) {
  // Prefer the overlay's own close control, so whatever cleanup it does still runs.
  const btn = el.querySelector('.modal-close, .sidebar-close-btn, [data-close]')
    || [...el.querySelectorAll('button')].find(b => /hideModal|display\s*=\s*'none'|close/i.test(b.getAttribute('onclick') || ''));
  if (btn) { btn.click(); return true; }
  if (el.id === 'modal-overlay' && typeof hideModal === 'function') { hideModal(); return true; }
  el.style.display = 'none';
  return true;
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // The drawer is the most recently opened thing when it is open.
  const sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('open') && typeof closeSidebar === 'function') {
    closeSidebar(); return;
  }
  const el = mlOpenOverlay();
  if (el) { e.preventDefault(); mlCloseOverlay(el); }
});

// ── Google Calendar embed ────────────────────────────────────────────────────
// The week grid is seven columns of a day each; at 390px that is unreadable. Agenda
// mode is the same data as a list. The mode is a query parameter rather than
// something CSS can reach, so it is swapped on the iframe — and swapped back if the
// window grows, so a tablet rotating to landscape gets the grid again.
function mlCalendarMode() {
  const want = mlIsMobile() ? 'AGENDA' : 'WEEK';
  for (const f of document.querySelectorAll('iframe[src*="calendar.google.com/calendar/embed"]')) {
    const src = f.getAttribute('src') || '';
    if (!/[?&]mode=/.test(src)) continue;
    const next = src.replace(/([?&]mode=)[A-Z]+/, '$1' + want);
    if (next !== src) f.setAttribute('src', next);   // only reload when it changes
  }
}

// Is the viewport in the card layout? Renderers that need to behave differently on a
// phone — Leads swaps tap-to-edit for tap-to-open — ask this rather than re-deriving
// the breakpoint, so there is one definition of "mobile" shared with mobile.css.
function mlIsMobile() {
  return window.matchMedia('(max-width: 700px)').matches;
}
