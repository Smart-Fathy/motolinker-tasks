// Chat extras — pasted images and link previews. Shared by both portals.
//
// The chat code itself is not identical between the two bundles (the admin side
// prefixes everything with `admin`), so it was not extracted. Anything new goes here
// instead and both renderers call in, rather than growing a third copy of the same
// logic in each file.

// ── Escaping ──────────────────────────────────────────────────────────────────
// Deliberately not the portals' own esc(). dashboard.js escapes " but not ',
// employee.js is a textContent round-trip that escapes neither, and one of them
// throws on a non-string. Linkified output goes into href attributes, so it needs a
// single definition that handles both quotes.
function chatEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Links ─────────────────────────────────────────────────────────────────────
// Trailing punctuation is excluded from the match so "see https://x.com/a." does not
// produce a link with a full stop welded onto the end. Balanced closing brackets are
// left out for the same reason.
const CHAT_URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;

function chatLinkUrls(text) {
  return [...new Set(String(text || '').match(CHAT_URL_RE) || [])];
}

// Tokenise the RAW body into link and non-link runs and escape each run separately.
// Escaping first and then matching would mean searching text where & has already
// become &amp;, so the href would carry the escaped form and the link would break.
function chatLinkify(text) {
  const s = String(text == null ? '' : text);
  let out = '', last = 0;
  CHAT_URL_RE.lastIndex = 0;
  let m;
  while ((m = CHAT_URL_RE.exec(s)) !== null) {
    out += chatEsc(s.slice(last, m.index));
    const url = m[0];
    out += `<a href="${chatEsc(url)}" target="_blank" rel="noopener noreferrer" class="chat-link">${chatEsc(url)}</a>`;
    last = m.index + url.length;
  }
  return out + chatEsc(s.slice(last));
}

// ── Link previews ─────────────────────────────────────────────────────────────
// Google links are recognised from their shape alone by the existing googleUnfurl, so
// they never need a fetch. Everything else asks the server, which reads the page's
// Open Graph tags behind an SSRF guard and caches the answer.
const _chatPreview = new Map();          // url → meta | null (null = asked, nothing useful)

function chatPreviewCardHtml(meta) {
  if (!meta || !meta.title) return '';
  const img = meta.image
    ? `<img class="gcard-thumb" src="${chatEsc(meta.image)}" referrerpolicy="no-referrer"
         onerror="this.style.display='none'" loading="lazy" alt="">`
    : '';
  const sub = meta.description || meta.siteName || meta.domain || '';
  return `<a class="gcard" href="${chatEsc(meta.url)}" target="_blank" rel="noopener noreferrer">
    <span class="gcard-badge" style="background:var(--border)">
      <i data-lucide="link" style="width:14px;height:14px"></i></span>
    <span class="gcard-meta">
      <span class="gcard-title">${chatEsc(meta.title)}</span>
      <span class="gcard-sub">${chatEsc(String(sub).slice(0, 120))}</span></span>
    <span class="gcard-open">${chatEsc(meta.domain || 'Open')} ↗</span>${img}</a>`;
}

// Called after messages render. Fetches at most a couple of previews per message so a
// wall of links cannot turn one render into fifty requests, and patches each card in
// when it arrives — a slow site never delays the message itself.
async function chatHydratePreviews(root, fetchFn, base) {
  if (!root) return;
  const jobs = [];
  root.querySelectorAll('[data-preview-for]').forEach(slot => {
    if (slot.dataset.done) return;
    slot.dataset.done = '1';
    const urls = (slot.getAttribute('data-preview-for') || '').split(' ').filter(Boolean).slice(0, 2);
    for (const raw of urls) {
      const url = decodeURIComponent(raw);
      if (_chatPreview.has(url)) { slot.insertAdjacentHTML('beforeend', chatPreviewCardHtml(_chatPreview.get(url))); continue; }
      jobs.push((async () => {
        let meta = null;
        try {
          const r = await fetchFn(base + '/link-preview', { method: 'POST', body: JSON.stringify({ url }) });
          if (r.ok) { const d = await r.json(); if (d && d.title) meta = d; }
        } catch (_) { /* a preview is decoration; never let it break the thread */ }
        _chatPreview.set(url, meta);
        if (meta) slot.insertAdjacentHTML('beforeend', chatPreviewCardHtml(meta));
      })());
    }
  });
  if (!jobs.length) return;
  await Promise.all(jobs);
  if (window.lucide) lucide.createIcons();
}

// The empty slot a message renders so a card has somewhere to land later.
function chatPreviewSlot(body) {
  const urls = chatLinkUrls(body).filter(u => !/^https?:\/\/(docs|drive)\.google\.com\//i.test(u));
  if (!urls.length) return '';
  return `<div class="chat-previews" data-preview-for="${urls.slice(0, 2).map(encodeURIComponent).join(' ')}"></div>`;
}

// ── Pasted and dropped images ─────────────────────────────────────────────────
// A clipboard image arrives as a File with either no name or a generic one, and the
// server builds its storage key from the extension of that name — an empty name gave
// a key ending in a bare dot and an object the browser then refused to display. So
// the name is synthesized here from the mime type, and the server has its own
// fallback for the same reason.
const CHAT_IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

function chatNameForBlob(file) {
  const ext = CHAT_IMG_EXT[file.type] || (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `screenshot-${stamp}.${ext}`;
}

// Returns a File ready to upload, or null when the paste held no image — in which
// case the event is left alone so pasting text still works normally.
function chatImageFromPaste(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.kind !== 'file' || !String(it.type || '').startsWith('image/')) continue;
    const blob = it.getAsFile();
    if (!blob) continue;
    return (blob.name && /\.[a-z0-9]+$/i.test(blob.name))
      ? blob
      : new File([blob], chatNameForBlob(blob), { type: blob.type });
  }
  return null;
}

function chatImageFromDrop(e) {
  const files = (e.dataTransfer && e.dataTransfer.files) || [];
  for (const f of files) if (String(f.type || '').startsWith('image/')) return f;
  return files.length ? files[0] : null;
}

// ── Self-healing EventSource ──────────────────────────────────────────────────
// None of the five live streams in either portal had an error handler, so the
// app leaned entirely on the browser's built-in retry — which is abandoned
// permanently the moment a reconnect gets a non-2xx answer. After every server
// restart the streams therefore died silently: chat and notifications simply
// stopped for the rest of the session with the EventSource object still there.
//
// This wrapper recreates the source with exponential backoff when the browser
// gives up, and rebuilds the URL each attempt so a refreshed token is picked up.
// `wire` receives every new EventSource and attaches the listeners; callers keep
// a handle and call .close() where they used to call es.close().
function chatStream(makeUrl, wire) {
  let es = null, timer = null, dead = false, delay = 3000;
  const open = () => {
    if (dead) return;
    let url = '';
    try { url = makeUrl(); } catch (_) {}
    if (!url) { timer = setTimeout(open, delay); return; }
    es = new EventSource(url);
    wire(es);
    es.onopen = () => { delay = 3000; };
    es.onerror = () => {
      if (dead) return;
      // CONNECTING means the browser is retrying by itself — leave it alone.
      if (es.readyState !== EventSource.CLOSED) return;
      try { es.close(); } catch (_) {}
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 60000);
    };
  };
  open();
  return {
    close() { dead = true; clearTimeout(timer); try { es && es.close(); } catch (_) {} },
  };
}
