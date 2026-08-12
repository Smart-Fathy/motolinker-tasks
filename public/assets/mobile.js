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

// Is the viewport in the card layout? Renderers that need to behave differently on a
// phone — Leads swaps tap-to-edit for tap-to-open — ask this rather than re-deriving
// the breakpoint, so there is one definition of "mobile" shared with mobile.css.
function mlIsMobile() {
  return window.matchMedia('(max-width: 700px)').matches;
}
