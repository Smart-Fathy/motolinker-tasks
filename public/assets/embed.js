// The bridge between a classic page and the new app that is showing it in a frame.
//
// The new app (apps/web) shows a screen it has not rebuilt yet as the classic page itself, in an <iframe> at
// /legacy/dashboard?embed=1#<page>. The server marks such a page with data-embed on <html> and loads this file first,
// before any other script, which is why everything below is written to need nothing else on the page. This file decides
// whether the page really is in a frame, and gives the rest of the page (and the app) one way to talk:
//
//   page -> app   { ml: 'embed', v: 1, type: 'ready',        page }   the first page is on screen
//                 { ml: 'embed', v: 1, type: 'navigated',    page }   the person moved to another page, in the frame
//                 { ml: 'embed', v: 1, type: 'unauthorized' }         the session is gone: the app decides what to do
//   app -> page   { ml: 'embed', v: 1, type: 'navigate',     page }   show that page (no reload)
//                 { ml: 'embed', v: 1, type: 'look',         profile } the workspace's look changed
//
// Only the window that framed this page, from this origin, is listened to or spoken to. The page's own scripts ask
// `document.documentElement.hasAttribute('data-embed')` to leave to the app what the app now owns (the live notification
// stream, presence, push, the service worker, the sign-in screen); apps/web/README.md lists them.
(function () {
  const root = document.documentElement;
  if (!root.hasAttribute('data-embed')) return;
  // Opened on its own (a pasted link, a bookmark): there is nobody to talk to, so be the ordinary page.
  if (window.parent === window) { root.removeAttribute('data-embed'); return; }

  const PROTOCOL = 'embed', VERSION = 1;
  const app = window.parent;
  const send = (type, fields) => {
    try { app.postMessage(Object.assign({ ml: PROTOCOL, v: VERSION, type }, fields), location.origin); } catch (_) { /* no app to tell */ }
  };

  let shown = null;          // the page the app was last told about
  let lastNoSession = 0;
  window.mlEmbed = {
    // navigate() calls this each time a page is put on screen.
    navigated(page) {
      if (shown === page) return;
      send(shown === null ? 'ready' : 'navigated', { page });
      shown = page;
    },
    // Every call that fails for a dead session ends up here; the app needs telling once.
    unauthorized() {
      const now = Date.now();
      if (now - lastNoSession < 3000) return;
      lastNoSession = now;
      send('unauthorized');
    },
  };

  window.addEventListener('message', e => {
    if (e.source !== app || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.ml !== PROTOCOL || m.v !== VERSION) return;
    if (m.type === 'navigate') {
      // a page of this portal, by its id, that this page has
      if (typeof m.page !== 'string' || !document.getElementById('page-' + m.page)) return;
      if (typeof window.navigate === 'function') window.navigate(m.page);
    } else if (m.type === 'look') {
      if (m.profile && typeof m.profile === 'object' && typeof window.wsApply === 'function') window.wsApply(m.profile);
    }
  });
})();
