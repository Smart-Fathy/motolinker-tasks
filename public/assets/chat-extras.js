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
    out += chatMentionify(chatEsc(s.slice(last, m.index)));
    const url = m[0];
    out += `<a href="${chatEsc(url)}" target="_blank" rel="noopener noreferrer" class="chat-link">${chatEsc(url)}</a>`;
    last = m.index + url.length;
  }
  return out + chatMentionify(chatEsc(s.slice(last)));
}

// ── The assistant in the room ────────────────────────────────────────────────
// "@AI …" in any room is answered in that room by a sender of its own (the
// server does the answering; src/lib/chat-ai.js holds the same grammar). Here:
// the mention is highlighted, the assistant's messages get their own look, and
// typing "@" in the composer offers the assistant.
const CHAT_ASSISTANT_KEY = 'assistant';
const CHAT_MENTION_RE = /(^|[\s(\[،,"'«]|&quot;|&#39;)@(ai|assistant|motolinker|bot|المساعد|الذكاء)(?![\w\u0600-\u06FF.-])/gi;
function chatMentionify(escaped) {
  return String(escaped || '').replace(CHAT_MENTION_RE, (_, pre, name) => `${pre}<span class="chat-mention">@${name}</span>`);
}
function chatIsAssistant(msg) { return !!msg && msg.sender_key === CHAT_ASSISTANT_KEY; }

// Icons are <i data-lucide> tags that lucide fills in; every render and every
// live append must ask it to, or the reply/forward buttons stay empty pills.
function chatIcons() { try { if (window.lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {} }

(function chatStyle() {
  const add = () => {
    if (document.getElementById('chat-extras-style')) return;
    const s = document.createElement('style');
    s.id = 'chat-extras-style';
    s.textContent = `
      .chat-msg-bubble{white-space:pre-wrap}
      .chat-link{color:#7cc4ff;text-decoration:underline;text-underline-offset:2px}
      .chat-msg.mine .chat-link{color:inherit}
      .chat-mention{color:#a78bfa;font-weight:800}
      .chat-msg.mine .chat-mention{color:inherit;text-decoration:underline;text-underline-offset:2px}
      .chat-msg.assistant .chat-msg-bubble{background:linear-gradient(160deg,rgba(167,139,250,.14),rgba(56,189,248,.08));border:1px solid rgba(167,139,250,.45)}
      .chat-msg.assistant .chat-msg-sender{color:#a78bfa}
      .chat-msg.assistant .chat-msg-avatar{border:1px solid rgba(167,139,250,.5)}
      .chat-mention-box{position:fixed;z-index:9990;background:var(--surface,#141416);border:1px solid rgba(167,139,250,.45);border-radius:10px;padding:4px;box-shadow:0 10px 30px rgba(0,0,0,.45);min-width:220px}
      .chat-mention-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--text,#e8e4da)}
      .chat-mention-item:hover,.chat-mention-item.on{background:rgba(167,139,250,.14)}
      .chat-mention-item .av{width:22px;height:22px;border-radius:50%;flex-shrink:0}
      .chat-mention-item small{color:var(--muted,#9a958a);margin-left:auto;font-size:11px}
    `;
    document.head.appendChild(s);
  };
  // The tests load this file in Node with a stub document; a real one has these.
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function' || !document.head || typeof document.addEventListener !== 'function') return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();

// The @ hint. Watches both portals' composers by id; Tab or Enter picks the
// suggestion (in the capture phase, before the composer's own Enter-to-send).
const CHAT_MENTION_INPUTS = ['admin-chat-input', 'chat-input'];
const CHAT_ASSISTANT_AVATAR_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f472b6"/><stop offset=".45" stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs><circle cx="20" cy="20" r="20" fill="#17171b"/><g fill="none" stroke="url(#g)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(8 8)"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/></g></svg>');
let _chatMentionFor = null;
function chatMentionMatch(el) {
  const before = String(el.value || '').slice(0, el.selectionStart == null ? el.value.length : el.selectionStart);
  const m = before.match(/(^|\s)@([\w\u0600-\u06FF]*)$/);
  if (!m) return null;
  const typed = m[2].toLowerCase();
  const fits = !typed || 'ai'.startsWith(typed) || 'assistant'.startsWith(typed) || 'المساعد'.startsWith(m[2]);
  return fits ? { start: before.length - m[2].length - 1, typed: m[2] } : null;
}
function chatMentionHide() { const box = document.getElementById('chat-mention-box'); if (box) box.remove(); _chatMentionFor = null; }
function chatMentionShow(el, match) {
  let box = document.getElementById('chat-mention-box');
  if (!box) { box = document.createElement('div'); box.id = 'chat-mention-box'; box.className = 'chat-mention-box'; document.body.appendChild(box); }
  box.innerHTML = `<div class="chat-mention-item on" onmousedown="event.preventDefault(); chatMentionPick()"><img class="av" src="${CHAT_ASSISTANT_AVATAR_SVG}" alt=""><span><b>AI Assistant</b> · answers here for everyone</span><small>Tab</small></div>`;
  const r = el.getBoundingClientRect();
  box.style.left = Math.max(8, r.left) + 'px';
  box.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + 'px';
  _chatMentionFor = { el, match };
}
function chatMentionPick() {
  const m = _chatMentionFor;
  if (!m) return;
  const v = m.el.value;
  const caret = m.el.selectionStart == null ? v.length : m.el.selectionStart;
  m.el.value = v.slice(0, m.match.start) + '@AI ' + v.slice(caret);
  const pos = m.match.start + 4;
  try { m.el.setSelectionRange(pos, pos); } catch (_) {}
  chatMentionHide();
  m.el.focus();
}
function chatMentionHint(el) {
  const match = chatMentionMatch(el);
  if (match) chatMentionShow(el, match); else chatMentionHide();
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && typeof document.getElementById === 'function') {
  document.addEventListener('input', e => { const t = e.target; if (t && CHAT_MENTION_INPUTS.includes(t.id)) chatMentionHint(t); });
  document.addEventListener('keydown', e => {
    if (!_chatMentionFor) return;
    if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); chatMentionPick(); }
    else if (e.key === 'Escape') { e.stopPropagation(); chatMentionHide(); }
  }, true);
  document.addEventListener('focusout', e => { const t = e.target; if (t && CHAT_MENTION_INPUTS.includes(t.id)) setTimeout(chatMentionHide, 120); });
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
  if (!jobs.length) { chatIcons(); return; }
  await Promise.all(jobs);
  chatIcons();
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
