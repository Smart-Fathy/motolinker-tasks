// Huddles, group administration and status chips — shared by both portals.
//
// Extracted from the two portal bundles, where it lived as a verbatim copy in each
// (the only difference was huddleRelayTest, which the team portal simply lacked).
// Everything portal specific is in HDCFG, which each portal defines before loading
// this file; nothing here may reference an admin-only or employee-only global.


/* ── Huddles, group administration & status ───────────────────────────────────
   Shared between the admin dashboard and the team portal. Everything portal
   specific lives in HDCFG, which each portal defines just above this block. */

// Mesh topology: every participant holds one RTCPeerConnection per peer, so the
// server caps a huddle at HUDDLE_MAX. Signalling rides the chat SSE stream that
// messages already use, so there is no second socket to keep alive.

// ── The conversation menu ─────────────────────────────────────────────────────
// The "⋯" on every row in the chat list. Archiving and hiding are YOUR view of
// a conversation: the other side keeps theirs exactly as it was, which is why
// "delete" here says "for me" and means "until they write again". Managing the
// group itself — its name, its icon, whether it exists at all — is a different
// thing, and only offered to whoever may manage it.
let CHAT_MENU = null;
function chatMenuEl() {
  if (!CHAT_MENU) {
    CHAT_MENU = document.createElement('div');
    CHAT_MENU.className = 'lead-menu';
    document.body.appendChild(CHAT_MENU);
    document.addEventListener('click', e => {
      if (CHAT_MENU.classList.contains('open') && !CHAT_MENU.contains(e.target)
          && !(e.target.closest && e.target.closest('.chat-room-dots'))) chatMenuClose();
    });
  }
  return CHAT_MENU;
}
function chatMenuClose() { if (CHAT_MENU) CHAT_MENU.classList.remove('open'); }
function chatRoomDotsHtml(roomId) {
  return `<button class="chat-room-dots" title="More" aria-label="More"
    onclick="event.stopPropagation();chatRoomMenu(event, ${roomId})">⋯</button>`;
}
// Only the admin manages groups here. The server checks it again; this decides
// what to draw.
function chatMayManage() { return HDCFG.me && HDCFG.me() === 'admin'; }

function chatRoomMenu(e, roomId) {
  e.stopPropagation();
  const room = hdRoom(roomId);
  const m = chatMenuEl();
  const archived = !!(room && room.archived);
  const isGroup = room && room.type === 'group';
  m.innerHTML = `
    <button onclick="chatRoomArchive(${roomId}, ${archived ? 'false' : 'true'})">
      <i data-lucide="${archived ? 'archive-restore' : 'archive'}" style="width:13px;height:13px"></i>
      ${archived ? 'Move back to chats' : 'Archive for me'}</button>
    <button onclick="chatRoomHide(${roomId})">
      <i data-lucide="eye-off" style="width:13px;height:13px"></i> Delete for me</button>
    ${isGroup && chatMayManage() ? `<div class="lead-menu-sep"></div>
      <button onclick="chatRoomRename(${roomId})"><i data-lucide="pencil" style="width:13px;height:13px"></i> Rename group</button>
      <button onclick="chatRoomIcon(${roomId})"><i data-lucide="smile" style="width:13px;height:13px"></i> Group icon…</button>
      <button class="danger" onclick="chatRoomDelete(${roomId})"><i data-lucide="trash-2" style="width:13px;height:13px"></i> Delete group for everyone</button>` : ''}`;
  m.style.left = Math.min(e.clientX, window.innerWidth - 240) + 'px';
  m.style.top = Math.min(e.clientY + 6, window.innerHeight - 80) + 'px';
  m.classList.add('open');
  if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
}

async function chatRoomState(roomId, patch, note) {
  const r = await hdFetch(`/rooms/${roomId}/state`, { method: 'POST', body: JSON.stringify(patch) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return hdToast(d.error || 'Could not update this conversation.');
  if (note) hdToast(note);
  if (HDCFG.refreshRooms) await HDCFG.refreshRooms();
}
function chatRoomArchive(roomId, on) {
  chatMenuClose();
  chatRoomState(roomId, { archived: !!on }, on ? 'Archived — only for you.' : 'Back in your chats.');
}
function chatRoomHide(roomId) {
  chatMenuClose();
  if (!confirm('Remove this conversation from your list? It stays on the other side, and comes back if they write again.')) return;
  chatRoomState(roomId, { hidden: true }, 'Removed from your list.');
}
async function chatRoomRename(roomId) {
  chatMenuClose();
  const room = hdRoom(roomId);
  const name = prompt('Group name', (room && room.name) || '');
  if (!name || !name.trim()) return;
  const r = await hdFetch(`/rooms/${roomId}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
  if (!r.ok) return hdToast('Could not rename the group.');
  if (HDCFG.refreshRooms) await HDCFG.refreshRooms();
}
// An emoji, so setting one needs no upload and no storage. Blank clears it.
async function chatRoomIcon(roomId) {
  chatMenuClose();
  const room = hdRoom(roomId);
  const icon = prompt('Group icon — one emoji. Leave blank to remove it.', (room && room.icon) || '');
  if (icon === null) return;
  const r = await hdFetch(`/rooms/${roomId}/icon`, { method: 'PUT', body: JSON.stringify({ icon: icon.trim() }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return hdToast(d.error || 'Could not set the icon.');
  hdToast(icon.trim() ? 'Group icon set.' : 'Group icon removed.');
  if (HDCFG.refreshRooms) await HDCFG.refreshRooms();
}
async function chatRoomDelete(roomId) {
  chatMenuClose();
  const room = hdRoom(roomId);
  if (!confirm(`Delete "${(room && room.name) || 'this group'}" for EVERYONE? The messages go with it.`)) return;
  const r = await hdFetch(`/rooms/${roomId}`, { method: 'DELETE' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return hdToast(d.error || 'Could not delete the group.');
  hdToast('Group deleted.');
  if (HDCFG.refreshRooms) await HDCFG.refreshRooms();
}
// Split for the two sections the list draws.
function chatRoomsSplit(rooms) {
  const all = rooms || [];
  return { active: all.filter(r => !r.archived), archived: all.filter(r => r.archived) };
}

let _hd = { roomId: null, peers: new Map(), local: null, screen: null, muted: false, cam: false, sharing: false, ice: null, iceUntil: 0, roster: [], statsTimer: null, startedAt: null, clockTimer: null };

function hdMe() { return HDCFG.me(); }
function hdFetch(path, opts) { return HDCFG.fetch(HDCFG.base + path, opts); }
function hdRoom(id) { return (HDCFG.rooms() || []).find(r => r.id === id) || null; }
function hdRoomMemberKeys(id) { return ((hdRoom(id) || {}).members || []).map(m => m.member_key); }
function hdNameFor(key) {
  for (const r of HDCFG.rooms() || []) {
    const m = (r.members || []).find(x => x.member_key === key);
    if (m) return m.member_name;
  }
  return key === 'admin' ? 'Admin' : key;
}
// The same room list already carries member_avatar, which the chat message bubbles
// render — so a huddle tile can show a real face rather than the grey microphone
// glyph everyone shared. Guests invited from outside the room have no entry, and the
// admin account has no employees row at all, so both fall back to initials.
function hdAvatarFor(key) {
  for (const r of HDCFG.rooms() || []) {
    const m = (r.members || []).find(x => x.member_key === key);
    if (m && m.member_avatar) return m.member_avatar;
  }
  return null;
}
function hdInitialsFor(key) {
  const name = hdNameFor(key) || '?';
  return String(name).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function hdSignal(type, to, data) {
  return hdFetch('/huddle/signal', { method: 'POST', body: JSON.stringify({ roomId: _hd.roomId, type, to, data }) });
}

async function hdIce() {
  // Relay credentials expire (Cloudflare mints short-lived ones), so this cache
  // has to as well — a tab left open all day must not start a call with a dead
  // username. Refresh a few minutes before the server's stated TTL.
  if (_hd.ice && Date.now() < _hd.iceUntil) return _hd.ice;
  try {
    _hd.ice = await hdFetch('/huddle/ice').then(r => r.json());
    _hd.iceUntil = Date.now() + Math.max(60, (_hd.ice.ttl || 3600) - 300) * 1000;
  } catch (_) {
    _hd.ice = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], hasTurn: false };
    _hd.iceUntil = Date.now() + 60000;   // retry soon; this is a degraded fallback
  }
  return _hd.ice;
}

// Does the relay actually work? Credentials being issued proves nothing — a revoked
// key, a blocked port or a typo'd token all still return a well-formed config, and
// on a friendly network peer-to-peer succeeds so the relay is never exercised.
// Gathering with iceTransportPolicy:'relay' discards host and reflexive candidates,
// so any candidate at all means the relay answered, and none means it didn't.
async function huddleRelayTest(opts) {
  const quiet = !!(opts && opts.quiet);
  const say = m => { if (!quiet) hdToast(m); };
  say('Testing the relay…');
  _hd.ice = null; _hd.iceUntil = 0;          // always ask the server, never a stale cache
  const cfg = await hdIce();
  if (!cfg.hasTurn) {
    say(`No TURN configured — provider: ${cfg.provider || 'none'}. Huddles will use STUN only.`);
    return { ok: false, reason: 'not-configured', provider: cfg.provider || 'none' };
  }
  let pc = null;
  try {
    pc = new RTCPeerConnection({ iceServers: cfg.iceServers || [], iceTransportPolicy: 'relay' });
    const protos = new Set();
    const done = new Promise(resolve => {
      const finish = () => resolve();
      const timer = setTimeout(finish, 8000);
      pc.onicecandidate = e => {
        if (!e.candidate) { clearTimeout(timer); return finish(); }   // gathering complete
        const m = /(?:^| )(udp|tcp|tls)(?: |$)/i.exec(e.candidate.candidate || '');
        protos.add(m ? m[1].toLowerCase() : (e.candidate.protocol || '?'));
      };
    });
    pc.createDataChannel('relay-probe');
    await pc.setLocalDescription(await pc.createOffer());
    await done;
    if (protos.size) {
      say(`Relay OK via ${cfg.provider} — ${[...protos].sort().join(', ')}.`);
      return { ok: true, provider: cfg.provider, protocols: [...protos].sort() };
    }
    say(`No relay reachable. ${cfg.provider} issued credentials but nothing came back — check the key is still active.`);
    return { ok: false, reason: 'no-candidates', provider: cfg.provider };
  } catch (e) {
    say('Relay test failed to run: ' + (e && e.message ? e.message : e));
    return { ok: false, reason: 'error', error: String(e && e.message || e) };
  } finally {
    if (pc) { try { pc.close(); } catch (_) {} }
  }
}

async function huddleStart(roomId, withVideo) {
  if (_hd.roomId === roomId) { hdToast('You are already in this huddle.'); return; }
  if (_hd.roomId) { hdToast('Leave your current huddle first.'); return; }
  try {
    _hd.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!withVideo });
  } catch (_) {
    hdToast('Could not access your microphone. Check the browser permission.');
    return;
  }
  // ICE first: committing roomId opens the gate on incoming signals, and an offer
  // arriving before the relay config lands would build a connection with no STUN and
  // no TURN — host candidates only, which fails on any real network.
  await hdIce();
  _hd.roomId = roomId; _hd.cam = !!withVideo; _hd.muted = false; _hd.sharing = false;
  hdHideJoinChip();
  hdRenderBar();
  let r = null;
  try { r = await hdFetch('/huddle/signal', { method: 'POST', body: JSON.stringify({ roomId, type: 'join' }) }).then(x => x.json()); }
  catch (_) {}
  if (!r || r.error) { hdToast((r && r.error) || 'Could not join the huddle.'); huddleLeave(); return; }
  _hd.roster = r.participants || [];
  _hd.startedAt = r.started_at || Date.now();
  hdStartClock();
  // Dial from the join response as well as from the roster frame. Signalling rides the
  // chat stream, and a joiner whose stream has not finished registering misses its own
  // roster broadcast — if it also holds the smaller key, nobody calls that pair at all
  // and the two sit in silence. hdCall is idempotent, so doing both is free.
  hdDialRoster();
  hdStartStats();
  // Ring everyone else in the conversation; they get an incoming-huddle prompt.
  hdRoomMemberKeys(roomId).forEach(k => { if (k !== hdMe()) hdSignal('invite', k).catch(() => {}); });
  hdRenderBar();
}

function huddleJoinExisting(roomId) { return huddleStart(roomId, false); }

// How long this has been going. Counted from the server's start time so it is
// the huddle's duration, not "how long I have been in it".
function hdElapsed(since) {
  const ms = Math.max(0, Date.now() - Number(since || Date.now()));
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const two = n => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(ss)}` : `${m}:${two(ss)}`;
}
function hdStartClock() {
  if (_hd.clockTimer) clearInterval(_hd.clockTimer);
  hdPaintClock();
  _hd.clockTimer = setInterval(hdPaintClock, 1000);
}
function hdStopClock() { if (_hd.clockTimer) { clearInterval(_hd.clockTimer); _hd.clockTimer = null; } }
function hdPaintClock() {
  const el = document.querySelector('#hd-bar .hd-clock');
  if (el) el.textContent = _hd.startedAt ? hdElapsed(_hd.startedAt) : '';
  const chip = document.querySelector('#hd-join-chip .hd-chip-clock');
  if (chip && chip.dataset.since) chip.textContent = hdElapsed(Number(chip.dataset.since));
}

function huddleLeave() {
  if (_hd.roomId) hdSignal('leave').catch(() => {});
  if (_hd.statsTimer) { clearInterval(_hd.statsTimer); _hd.statsTimer = null; }
  hdStopClock();
  _hd.peers.forEach(p => { try { p.pc.close(); } catch (_) {} });
  _hd.peers.clear();
  [_hd.local, _hd.screen].forEach(st => st && st.getTracks().forEach(t => t.stop()));
  _hd = { roomId: null, peers: new Map(), local: null, screen: null, muted: false, cam: false, sharing: false, ice: _hd.ice, iceUntil: _hd.iceUntil, roster: [], statsTimer: null, startedAt: null, clockTimer: null };
  hdPruneAudio(null);
  hdRenderBar();
}

function hdPeer(key) {
  if (_hd.peers.has(key)) return _hd.peers.get(key);
  const pc = new RTCPeerConnection({ iceServers: (_hd.ice && _hd.ice.iceServers) || [] });
  const entry = { pc, stream: new MediaStream(), name: hdNameFor(key), state: 'connecting' };
  _hd.peers.set(key, entry);
  if (_hd.local) _hd.local.getTracks().forEach(t => pc.addTrack(t, _hd.local));
  // Reserve the video slot before the first offer. A mesh has no SFU to renegotiate
  // through, so turning a camera or screen share on later has to be a track swap
  // onto an m-line that already exists.
  //
  // Only the side that will SEND the offer may reserve it. On the answering side
  // setRemoteDescription builds the transceivers from the offer itself, and one
  // added here beforehand is left unassociated (mid === null) — a track swapped
  // onto it goes nowhere. That is why sharing a screen only ever worked in one
  // direction: the offerer's share arrived, the answerer's silently did not.
  if (hdMe() < key && !pc.getSenders().some(s => s.track && s.track.kind === 'video')) {
    const vt = pc.addTransceiver('video', { direction: 'sendrecv' });
    // Someone joining mid-share must get the picture too. _hd.local carries the camera,
    // so a late joiner always saw that — but a screen share lives in its own stream and
    // only ever reached peers through hdSwapVideo at the moment it was toggled. A peer
    // created afterwards got an empty sender while hdBroadcastMedia announced
    // sharing:true: a tile claiming a picture and showing none.
    if (_hd.sharing && _hd.screen) {
      const st = _hd.screen.getVideoTracks()[0];
      if (st) vt.sender.replaceTrack(st).catch(() => {});
    }
  }
  // Safety net for any m-line that genuinely appears later. Only the designated
  // offerer may renegotiate, and never before the first exchange has settled,
  // or the two sides collide.
  pc.onnegotiationneeded = async () => {
    if (hdMe() > key || !entry.negotiated || entry.makingOffer || pc.signalingState !== 'stable') return;
    try {
      entry.makingOffer = true;
      await pc.setLocalDescription(await pc.createOffer());
      hdSignal('offer', key, pc.localDescription).catch(() => {});
    } catch (_) { /* the next state change will retry */ }
    finally { entry.makingOffer = false; }
  };
  pc.onicecandidate = e => { if (e.candidate) hdSignal('ice', key, e.candidate).catch(() => {}); };
  pc.ontrack = e => {
    (e.streams[0] ? e.streams[0].getTracks() : [e.track]).forEach(t => {
      if (!entry.stream.getTracks().includes(t)) entry.stream.addTrack(t);
    });
    hdRenderBar();
  };
  // Whether a peer has a picture is NOT readable from the track: with the slot
  // reserved sendrecv in both directions the remote track reports muted:false and
  // live even when nothing is being sent. Peers announce it instead (see 'media'),
  // and the stats poll below corrects us if that message is ever missed.
  pc.onconnectionstatechange = () => {
    entry.state = pc.connectionState;
    // 'failed' nearly always means no relay path — say so rather than hanging
    if (pc.connectionState === 'failed' && !(_hd.ice && _hd.ice.hasTurn)) {
      hdToast("Couldn't reach " + entry.name + ". This network needs a TURN relay.");
    }
    hdRenderBar();
  };
  return entry;
}

// Glare rule: only the lexicographically smaller key offers, so two peers never
// negotiate against each other. Idempotent — an existing peer is never re-dialled.
function hdDialRoster() {
  _hd.roster.forEach(p => {
    if (p.key !== hdMe() && !_hd.peers.has(p.key) && hdMe() < p.key) hdCall(p.key);
  });
}

// Candidates parked while there was no remote description to hang them on.
async function hdFlushIce(entry) {
  const queued = entry.pendingIce || [];
  entry.pendingIce = [];
  for (const c of queued) {
    try { await entry.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
  }
}

async function hdCall(key) {
  const entry = hdPeer(key);
  const { pc } = entry;
  try {
    entry.makingOffer = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    hdSignal('offer', key, offer).catch(() => {});
  } finally { entry.makingOffer = false; }
}

// Every 'huddle' SSE frame lands here.
async function huddleOnSignal(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'roster') {
    if (msg.roomId !== _hd.roomId) { hdNoteRoster(msg); return; }
    _hd.roster = msg.participants || [];
    hdDialRoster();
    [..._hd.peers.keys()].forEach(k => {
      if (!_hd.roster.some(p => p.key === k)) {
        try { _hd.peers.get(k).pc.close(); } catch (_) {}
        _hd.peers.delete(k);
      }
    });
    hdRenderBar();
    // Someone arriving mid-call has no idea what we are already sending
    if (_hd.cam || _hd.sharing) hdBroadcastMedia();
    if (_hd.peers.size) hdStartStats();
    return;
  }
  if (msg.type === 'invite') { hdRingOnce(msg); return; }
  if (msg.type === 'media') {
    const p = _hd.peers.get(msg.from);
    if (p) {
      // Kept as the authority the stats poll defers to, rather than a value the poll
      // is free to contradict three seconds later.
      p.announced = { cam: !!(msg.data && msg.data.cam), sharing: !!(msg.data && msg.data.sharing) };
      p.video = p.announced.cam || p.announced.sharing;
      p.sharing = p.announced.sharing;
      if (!p.video) p.everPainted = false;      // require a fresh frame before showing again
      hdRenderBar();
    }
    return;
  }
  if (msg.type === 'decline') { hdToast(esc(msg.fromName || 'They') + ' declined the huddle.'); return; }
  if (!_hd.roomId || msg.roomId !== _hd.roomId) return;   // signal for a call we're not in
  const from = msg.from;
  if (msg.type === 'offer') {
    const entry = hdPeer(from);
    const { pc } = entry;
    await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
    // We have no camera yet, so the offer's video m-line lands here as recvonly
    // and the answer would close this direction for good. Open it both ways
    // before answering — then starting a screen share later is a track swap on
    // an already-negotiated m-line, with nothing to renegotiate.
    const vt = hdVideoTransceiver(pc);
    if (vt && vt.direction !== 'sendrecv') { try { vt.direction = 'sendrecv'; } catch (_) {} }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    entry.negotiated = true;
    await hdFlushIce(entry);
    // Same for the answering side, once the offer has built the m-line to swap onto.
    if (_hd.sharing && _hd.screen) {
      const st = _hd.screen.getVideoTracks()[0];
      const t = hdVideoTransceiver(pc);
      if (st && t) t.sender.replaceTrack(st).catch(() => {});
    }
    hdSignal('answer', from, answer).catch(() => {});
  } else if (msg.type === 'answer') {
    const p = _hd.peers.get(from);
    if (p && p.pc.signalingState !== 'stable') {
      await p.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
      p.negotiated = true;
      await hdFlushIce(p);
    } else if (p && p.pc.remoteDescription) {
      // A duplicate answer in stable is discarded — but candidates that queued
      // behind it must not sit parked forever; the description they belong to
      // is already applied.
      await hdFlushIce(p);
    }
  } else if (msg.type === 'ice') {
    const p = _hd.peers.get(from);
    if (!p || !msg.data) return;
    // A candidate routinely arrives before the description it belongs to: this handler
    // is async and the SSE listener does not await it, so an ice frame can be processed
    // while the offer above is still suspended on setRemoteDescription — and each
    // signal is its own fire-and-forget POST, so they race in flight anyway.
    // addIceCandidate rejects in that window, and the candidate used to be swallowed
    // for good, quietly degrading or killing that one pair.
    if (!p.pc.remoteDescription) { (p.pendingIce = p.pendingIce || []).push(msg.data); return; }
    try { await p.pc.addIceCandidate(new RTCIceCandidate(msg.data)); } catch (_) {}
  }
}

// Tell every peer what we are sending. Cheap, instant, and the only reliable
// source of "do they have a picture" now that the reserved transceiver keeps the
// remote track unmuted regardless.
function hdBroadcastMedia() {
  const data = { cam: !!_hd.cam, sharing: !!_hd.sharing };
  _hd.peers.forEach((_p, key) => hdSignal('media', key, data).catch(() => {}));
}

// One poll drives two things: the per-participant quality bars, and a backstop for
// the picture flag in case a 'media' message was lost.
function hdStartStats() {
  if (_hd.statsTimer) return;
  _hd.statsTimer = setInterval(hdPollStats, 3000);
}
async function hdPollStats() {
  if (!_hd.roomId) return;
  for (const [, p] of _hd.peers) {
    try {
      let lost = 0, recv = 0, rtt = null, frames = 0;
      (await p.pc.getStats()).forEach(r => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') { lost = r.packetsLost || 0; recv = r.packetsReceived || 0; }
        if (r.type === 'inbound-rtp' && r.kind === 'video') frames = r.framesDecoded || 0;
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime;
      });
      const prev = p.stats || { lost: 0, recv: 0, frames: 0 };
      const dLost = Math.max(0, lost - prev.lost), dRecv = Math.max(0, recv - prev.recv);
      p.loss = (dLost + dRecv) ? dLost / (dLost + dRecv) : 0;
      p.rtt = rtt;
      p.stats = { lost, recv, frames };
      p.quality = hdQuality(p);
      // Frame movement is a backstop for a lost 'media' message, not the truth. It
      // used to be a one-way latch — it could only ever set p.video true — so the tick
      // straddling someone stopping a share re-raised the flag the stop had just
      // cleared, and their last frame stayed frozen on everyone's screen. It is
      // symmetric now, and it never overrides what the peer actually told us.
      const moving = frames > prev.frames;
      if (moving) p.stalls = 0; else p.stalls = (p.stalls || 0) + 1;
      if (p.announced) {
        p.video = !!(p.announced.cam || p.announced.sharing);
      } else if (moving) {
        p.video = true;
      } else if (p.stalls >= 2) {
        p.video = false;
      }
      // Only reveal a tile once a frame has actually arrived since it was hidden, so a
      // stale frame held in the compositor can never paint on the way back up.
      if (p.video && !moving && !p.everPainted) p.video = false;
      if (moving) p.everPainted = true;
    } catch (_) { /* a closing connection throws; the next tick will settle it */ }
  }
  // Offer watchdog. Dialling is idempotent by design (the glare rule), which
  // means a LOST offer strands the pair as "connecting" forever — signalling
  // rides the chat SSE stream, and frames sent while a peer's stream is
  // reconnecting are simply dropped, with no queue on the server. If we are the
  // offerer and the peer still has no remote description after two ticks (~6s),
  // offer again; bounded so a genuinely dead peer doesn't loop.
  for (const [key, p] of _hd.peers) {
    try {
      if (hdMe() < key
          && !p.pc.remoteDescription
          && (p.pc.connectionState === 'new' || p.pc.connectionState === 'connecting')
          && !p.makingOffer) {
        p.offerTicks = (p.offerTicks || 0) + 1;
        if (p.offerTicks >= 2 && (p.offerRetries || 0) < 3) {
          p.offerTicks = 0;
          p.offerRetries = (p.offerRetries || 0) + 1;
          hdCall(key).catch(() => {});
        }
      } else {
        p.offerTicks = 0;
      }
    } catch (_) {}
  }
  hdRenderBar();
}
// 0 connecting/failed · 1 poor · 2 fair · 3 good
function hdQuality(p) {
  if (p.pc.connectionState !== 'connected') return 0;
  if (p.loss > 0.08 || (p.rtt != null && p.rtt > 0.4)) return 1;
  if (p.loss > 0.03 || (p.rtt != null && p.rtt > 0.2)) return 2;
  return 3;
}
function hdQualityLabel(p) {
  const pct = Math.round((p.loss || 0) * 1000) / 10;
  const ms = p.rtt != null ? Math.round(p.rtt * 1000) + ' ms' : 'unknown';
  return ['Connecting', 'Poor connection', 'Fair connection', 'Good connection'][p.quality || 0]
    + ' \u00b7 ' + pct + '% packet loss \u00b7 round trip ' + ms;
}

// ── Controls ──
function huddleToggleMute() {
  if (!_hd.local) return;
  _hd.muted = !_hd.muted;
  _hd.local.getAudioTracks().forEach(t => { t.enabled = !_hd.muted; });
  hdRenderBar();
}
function hdAnnounceAndRender() { hdBroadcastMedia(); hdRenderBar(); }
async function huddleToggleCam() {
  if (!_hd.roomId) return;
  if (_hd.cam) {
    _hd.local.getVideoTracks().forEach(t => { t.stop(); _hd.local.removeTrack(t); });
    if (!_hd.sharing) hdSwapVideo(null);
    _hd.cam = false;
  } else {
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = cam.getVideoTracks()[0];
      _hd.local.addTrack(track);
      // While sharing a screen the screen track owns the video sender; the camera
      // takes over again when sharing stops.
      if (!_hd.sharing) hdSwapVideo(track);
      _hd.cam = true;
    } catch (_) { hdToast('Could not access your camera.'); }
  }
  hdAnnounceAndRender();
}
// The negotiated video transceiver, resolved fresh every time. Caching a sender
// across a negotiation is what broke this: the cached one can end up unassociated
// while the peer renders a different m-line entirely.
function hdVideoTransceiver(pc) {
  return pc.getTransceivers().find(t => t.mid != null && !t.stopped &&
    (((t.receiver || {}).track || {}).kind === 'video' || ((t.sender || {}).track || {}).kind === 'video'));
}
function hdSwapVideo(track) {
  _hd.peers.forEach(p => {
    const t = hdVideoTransceiver(p.pc);
    if (!t) return;
    // A transceiver left recvonly swallows the track without complaint
    if (t.direction !== 'sendrecv') { try { t.direction = 'sendrecv'; } catch (_) {} }
    t.sender.replaceTrack(track).catch(() => {});
  });
}
// iOS does not expose getDisplayMedia to web pages in any browser — not Safari, not
// Chrome, not Firefox — so the property is simply missing and calling it throws a
// synchronous TypeError. That used to be swallowed by a bare catch whose comment said
// "the picker was cancelled", which is why tapping the button on a phone did nothing
// at all, forever, with no message. Android Chrome does support it.
function hdCanShareScreen() {
  return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
}

async function huddleToggleShare() {
  if (!_hd.roomId) return;
  if (_hd.sharing) {
    if (_hd.screen) _hd.screen.getTracks().forEach(t => t.stop());
    _hd.screen = null; _hd.sharing = false;
    hdSwapVideo(_hd.local.getVideoTracks()[0] || null);
  } else {
    if (!hdCanShareScreen()) {
      hdToast('This browser cannot share a screen. On an iPhone or iPad no browser can — '
            + 'Apple does not allow it. You can turn your camera on instead.');
      return;
    }
    try {
      _hd.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = _hd.screen.getVideoTracks()[0];
      track.onended = () => { if (_hd.sharing) huddleToggleShare(); };   // browser's own "Stop sharing"
      hdSwapVideo(track);
      _hd.sharing = true;
    } catch (e) {
      // Cancelling the picker is not a failure and must stay silent. Anything else is
      // a real reason the user cannot otherwise discover.
      const name = (e && e.name) || '';
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        hdToast('Screen sharing did not start: ' + ((e && e.message) || name || 'unknown reason'));
      }
      _hd.screen = null;
    }
  }
  hdAnnounceAndRender();
}
function huddleInvite(key) { if (_hd.roomId) hdSignal('invite', key).catch(() => {}); }

// ── Huddle UI ──
function hdToast(msg) {
  const el = document.getElementById('hd-toast');
  if (!el) { console.warn('[huddle]', msg); return; }
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
}
function hdNoteRoster(msg) {
  // A huddle is running in a room we are not in
  if ((msg.participants || []).length) hdShowJoinChip(msg.roomId, msg.participants.length, msg.started_at);
  else hdHideJoinChip();
}
function hdShowJoinChip(roomId, n, startedAt) {
  const el = document.getElementById('hd-join-chip');
  if (!el || _hd.roomId) return;
  const room = hdRoom(roomId);
  const where = room ? (room.type === 'group' ? room.name : hdNameFor((room.members || []).map(m => m.member_key).find(k => k !== hdMe()) || '')) : 'a conversation';
  el.innerHTML = `<span class="hd-chip-live"></span>
    <span>Huddle in ${esc(where)} · ${n} ${n === 1 ? 'person' : 'people'}</span>
    ${startedAt ? `<span class="hd-chip-clock" data-since="${Number(startedAt)}">${esc(hdElapsed(startedAt))}</span>` : ''}
    <button class="hd-chip-btn" onclick="huddleJoinExisting(${roomId})">Join</button>
    <button class="hd-chip-x" onclick="hdHideJoinChip()" title="Dismiss">×</button>`;
  el.style.display = 'flex';
}
function hdHideJoinChip() {
  const el = document.getElementById('hd-join-chip');
  if (el) el.style.display = 'none';
  if (_hdChipTimer) { clearInterval(_hdChipTimer); _hdChipTimer = null; }
}
let _hdChipTimer = null;

// A refresh leaves the call without leaving the roster: the huddle is still
// running, and the reloaded page had no way to know. Ask on boot, and offer it
// back — this is the difference between "the huddle is gone" and "rejoin".
// Boot: know the rooms before naming one in the chip, then ask.
async function hdBootLive() {
  try { if (HDCFG.refreshRooms) await HDCFG.refreshRooms(); } catch (_) {}
  hdCheckLive();
}
async function hdCheckLive() {
  if (_hd.roomId) return;
  let live = [];
  try {
    const r = await hdFetch('/huddle/live');
    if (!r.ok) return;                       // no chat.huddle grant: nothing to offer
    live = await r.json();
  } catch (_) { return; }
  if (!Array.isArray(live) || !live.length) return hdHideJoinChip();
  // The busiest one — with several running, the chip can only offer one.
  const best = live.slice().sort((a, b) => (b.participants || []).length - (a.participants || []).length)[0];
  hdShowJoinChip(best.roomId, (best.participants || []).length, best.started_at);
  if (_hdChipTimer) clearInterval(_hdChipTimer);
  _hdChipTimer = setInterval(hdPaintClock, 1000);
}

// An invite now arrives twice for anyone sitting on the chat page: once over the chat
// stream and once over the always-on notification stream. Ring once.
const _hdRang = new Map();          // roomId:from → when
function hdRingOnce(msg) {
  if (!msg || msg.roomId == null) return;
  const k = msg.roomId + ':' + (msg.from || '');
  const now = Date.now();
  if (now - (_hdRang.get(k) || 0) < 10000) return;
  _hdRang.set(k, now);
  if (_hdRang.size > 50) for (const [key, at] of _hdRang) if (now - at > 60000) _hdRang.delete(key);
  hdIncoming(msg);
}

function hdIncoming(msg) {
  if (_hd.roomId === msg.roomId) return;              // already in it
  const el = document.getElementById('hd-incoming');
  if (!el) return;
  el.innerHTML = `<div class="hd-ring-title">${esc(msg.fromName || 'Someone')} started a huddle</div>
    <div class="hd-ring-actions">
      <button class="hd-chip-btn" onclick="hdAccept(${msg.roomId})">Join</button>
      <button class="hd-chip-x wide" onclick="hdDecline(${JSON.stringify(String(msg.from || '')).replace(/"/g, '&quot;')},${msg.roomId})">Decline</button>
    </div>`;
  el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 45000);
  try { hdRing(); } catch (_) {}
}
function hdRing() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.frequency.value = 660; gain.gain.value = 0.06;
  osc.connect(gain); gain.connect(ctx.destination);
  // Born from an SSE event, not a gesture, so it starts suspended — without the
  // resume() the incoming-huddle ring was usually silent.
  if (ctx.state === 'suspended' && ctx.resume) { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); }
  osc.start(); osc.stop(ctx.currentTime + 0.5);
  setTimeout(() => { try { ctx.close(); } catch (_) {} }, 900);
}
function hdAccept(roomId) {
  const el = document.getElementById('hd-incoming');
  if (el) el.style.display = 'none';
  // Signalling rides the chat stream, and that is opened by the chat page. Accepting
  // from Home or anywhere else has to open it first or the offer never arrives.
  if (HDCFG.ensureStream) HDCFG.ensureStream();
  huddleJoinExisting(roomId);
}
function hdDecline(from, roomId) {
  const el = document.getElementById('hd-incoming');
  if (el) el.style.display = 'none';
  hdFetch('/huddle/signal', { method: 'POST', body: JSON.stringify({ roomId, type: 'decline', to: from }) }).catch(() => {});
}

function hdCssEsc(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');
}

// Find-or-create a tile. Tiles are reused across renders because they hold live
// media elements: rebuilding the bar's innerHTML would tear down every <video>
// mid-call and restart playback, which is audible as a dropout.
function hdTileEl(tiles, id) {
  let el = tiles.querySelector('[data-tile="' + hdCssEsc(id) + '"]');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'hd-tile';
  el.setAttribute('data-tile', id);
  el.innerHTML = '<div class="hd-tile-name"></div>'
    + '<video class="hd-video" autoplay playsinline></video>'
    + '<div class="hd-avatar"><img class="hd-face" alt="" style="display:none">'
    +   '<span class="hd-initials"></span></div>'
    + '<button class="hd-full" style="display:none" title="Full screen">⛶</button>'
    + '<span class="hd-q" data-q="0"><i></i><i></i><i></i></span>';
  el.querySelector('.hd-full').addEventListener('click', () => hdFullscreen(el));
  el.querySelector('.hd-video').addEventListener('dblclick', () => hdFullscreen(el));
  tiles.appendChild(el);
  return el;
}

// Full screen for a shared screen — a 132px tile is useless for reading someone's
// code or spreadsheet. Goes full screen on the tile rather than the <video> so the
// name label comes along, except on iOS Safari, which can only do it to a <video>.
function hdFullscreen(tile) {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    return;
  }
  const v = tile.querySelector('.hd-video');
  if (tile.requestFullscreen) { const r = tile.requestFullscreen(); if (r && r.catch) r.catch(() => {}); }
  else if (tile.webkitRequestFullscreen) tile.webkitRequestFullscreen();
  else if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  else hdToast('This browser will not go full screen.');
}

// ── The audio path, kept out of the UI entirely ───────────────────────────────
// A peer's voice must never depend on how their tile is displayed. The old design
// played audio through the tile's <video> and hid it with display:none when there
// was no picture — and while Chromium keeps playing a hidden video, WebKit does
// NOT: a MediaStream <video> outside the render tree simply never starts. That is
// exactly "they can't hear me until I share my screen" — sharing set p.video,
// unhid the element, and its autoplay finally kicked in. The sink lives on <body>,
// OUTSIDE #hd-bar, so minimising the widget (a persisted preference that hides
// .hd-tiles with display:none) can never mute a call either.
let _hdSinkEl = null;   // closure-held, not id-looked-up: one sink per module instance
function hdAudioSink() {
  if (!_hdSinkEl || !_hdSinkEl.isConnected) {
    _hdSinkEl = document.createElement('div');
    _hdSinkEl.className = 'hd-audio-sink';
    _hdSinkEl.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden';
    document.body.appendChild(_hdSinkEl);
  }
  return _hdSinkEl;
}
function hdPaintAudio(key, stream) {
  const sink = hdAudioSink();
  let au = [...sink.children].find(a => a.dataset.peer === key);
  if (!stream || !stream.getAudioTracks().length) { if (au) { au.srcObject = null; au.remove(); } return; }
  if (!au) {
    au = document.createElement('audio');
    au.autoplay = true;
    au.dataset.peer = key;
    sink.appendChild(au);
  }
  if (au.srcObject !== stream) au.srcObject = stream;
  if (au.paused) {
    const r = au.play();
    // Only a genuine autoplay refusal warrants the "blocked" flow. AbortError is
    // a superseded load and NotSupportedError a not-yet-live track — both settle
    // by themselves on a later render.
    if (r && r.catch) r.catch(err => { if (err && err.name === 'NotAllowedError') hdAudioBlocked(); });
  }
}
function hdPruneAudio(keep) {
  const sink = _hdSinkEl;
  if (!sink) return;
  [...sink.children].forEach(a => {
    if (!keep || !keep.has(a.dataset.peer)) { a.srcObject = null; a.remove(); }
  });
}

// Tiles are pure picture now — the sink above carries every remote voice.
function hdPaintTile(el, label, stream, showVideo, mute, peer, key) {
  const nameEl = el.querySelector('.hd-tile-name');
  if (nameEl.textContent !== label) nameEl.textContent = label;
  const v = el.querySelector('.hd-video');
  // ALWAYS muted: remote audio plays through the sink, and playing it here too
  // would double every voice on Chromium. (Muted also means this play() can
  // never be autoplay-blocked, so the tile paints regardless of gestures.)
  v.muted = true;
  // Follow the TRACKS, not the stream object — hdPeer mutates one entry.stream in
  // place — but never re-ASSIGN the same object: the srcObject setter re-runs the
  // load algorithm unconditionally, which rejects the still-pending play() with
  // AbortError. In an audio-only call ontrack fires twice (mic, then the reserved
  // video transceiver's track), so the old code re-bound on the second track and
  // reported its own AbortError as "your browser blocked the sound" every call.
  const sig = stream ? stream.getTracks().map(t => t.id).join(',') : '';
  if (v.dataset.sig !== sig) {
    if (!sig) {
      v.dataset.sig = '';
      v.srcObject = null;          // nothing to play yet; binding empty is the bug
    } else {
      if (v.srcObject !== stream) v.srcObject = stream;   // a live stream picks up added tracks itself
      const r = v.play();
      if (r && r.then) {
        // The signature is recorded only once playback actually starts, so a
        // failed attempt stays retryable on the very next render.
        r.then(() => { v.dataset.sig = sig; }, () => {});
      } else {
        v.dataset.sig = sig;
      }
    }
  }
  v.style.display = showVideo ? '' : 'none';
  const av = el.querySelector('.hd-avatar');
  av.style.display = showVideo ? 'none' : '';
  // Updated rather than rebuilt: these tiles are deliberately reused across renders
  // because they hold the live <video>, and replacing the markup would drop the audio.
  if (!showVideo) {
    const face = av.querySelector('.hd-face'), ini = av.querySelector('.hd-initials');
    // A tile without these is a bug, but losing a face is not worth taking the whole
    // call down for — hdPaintTile runs on every render for every participant.
    if (!face || !ini) return;
    const src = hdAvatarFor(key);
    if (src) {
      if (face.getAttribute('src') !== src) face.setAttribute('src', src);
      face.style.display = ''; ini.style.display = 'none';
      face.onerror = () => { face.style.display = 'none'; ini.style.display = ''; };
    } else {
      face.style.display = 'none'; ini.style.display = '';
      const txt = hdInitialsFor(key);
      if (ini.textContent !== txt) ini.textContent = txt;
    }
  }
  // Nothing to enlarge when there is no picture
  el.querySelector('.hd-full').style.display = showVideo ? 'flex' : 'none';
  // Quality bars, so everyone can see who is struggling and why
  const q = el.querySelector('.hd-q');
  if (peer) {
    q.style.display = '';
    q.setAttribute('data-q', String(peer.quality == null ? 0 : peer.quality));
    q.title = hdQualityLabel(peer);
  } else { q.style.display = 'none'; }
}

// Browsers refuse to start audio without a user gesture. Joining a huddle is a
// click, so this should be rare — but when it does happen the call is silent with
// no clue why, so say so and retry on the next gesture. The retry STAYS armed
// until something actually starts playing: the old version unhooked its listener
// unconditionally and swallowed the retry's own failures, so the user's one
// click burned the only recovery path and the call stayed silent for good.
let _hdGestureHooked = false;
let _hdBlockedToastAt = 0;
function hdAudioBlocked() {
  // Every blocked element lands here; one toast every few seconds is plenty.
  if (Date.now() - _hdBlockedToastAt > 4000) {
    _hdBlockedToastAt = Date.now();
    hdToast('Your browser blocked the sound. Tap anywhere to turn it on.');
  }
  if (_hdGestureHooked) return;
  _hdGestureHooked = true;
  const EVENTS = ['click', 'pointerdown', 'keydown'];
  function unhook() {
    EVENTS.forEach(t => document.removeEventListener(t, resume));
    _hdGestureHooked = false;
  }
  function resume() {
    const els = [...document.querySelectorAll('#hd-bar video, .hd-audio-sink audio')];
    if (!els.length) { unhook(); return; }
    let pending = els.length, anyOk = false;
    const done = ok => {
      anyOk = anyOk || ok;
      // Stand down only once at least one element genuinely started; otherwise
      // stay armed for the next gesture instead of giving up silently.
      if (--pending === 0 && anyOk) unhook();
    };
    els.forEach(el => {
      const r = el.play();
      if (r && r.then) r.then(() => done(true), () => done(false));
      else done(true);
    });
  }
  EVENTS.forEach(t => document.addEventListener(t, resume));
}

// Where the widget sits and whether it is collapsed survives across calls and
// reloads — it is a preference, not call state, so it lives outside _hd.
let _hdUI = { min: false, max: false, x: null, y: null };
try { Object.assign(_hdUI, JSON.parse(localStorage.getItem('ml_huddle_ui') || '{}')); } catch (_) {}
function hdSaveUI() { try { localStorage.setItem('ml_huddle_ui', JSON.stringify(_hdUI)); } catch (_) {} }

function hdApplyWidget(bar) {
  bar.classList.toggle('min', !!_hdUI.min);
  bar.classList.toggle('max', !!_hdUI.max);
  // Only override the CSS corner once the user has actually dragged it somewhere
  const moved = !_hdUI.max && _hdUI.x != null;
  bar.style.left = moved ? _hdUI.x + 'px' : '';
  bar.style.top = moved ? _hdUI.y + 'px' : '';
  bar.style.right = moved ? 'auto' : '';
  bar.style.bottom = moved ? 'auto' : '';
}
function hdWidgetAct(act) {
  if (act === 'min') { _hdUI.min = !_hdUI.min; if (_hdUI.min) _hdUI.max = false; }
  if (act === 'max') { _hdUI.max = !_hdUI.max; if (_hdUI.max) _hdUI.min = false; }
  hdSaveUI();
  hdRenderBar();
}
function hdBindWidget(bar) {
  const head = bar.querySelector('.hd-head');
  head.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.hd-wbtn');
    if (btn) { hdWidgetAct(btn.dataset.act); return; }
    if (_hdUI.max) return;                       // maximised does not move
    const r = bar.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => {
      // Clamped, so it can never be dragged off screen and stranded there
      _hdUI.x = Math.round(Math.min(Math.max(0, ev.clientX - dx), innerWidth - bar.offsetWidth));
      _hdUI.y = Math.round(Math.min(Math.max(0, ev.clientY - dy), innerHeight - bar.offsetHeight));
      hdApplyWidget(bar);
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      hdSaveUI();
    };
    try { head.setPointerCapture(e.pointerId); } catch (_) {}
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    e.preventDefault();
  });
}

function hdRenderBar() {
  const bar = document.getElementById('hd-bar');
  if (!bar) return;
  if (!_hd.roomId) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
  if (!bar.querySelector('.hd-tiles')) {
    bar.innerHTML = '<div class="hd-head">'
      + '<span class="hd-grip"><i data-lucide="grip-horizontal" style="width:14px;height:14px"></i></span>'
      + '<span class="hd-title"></span>'
      + '<span class="hd-clock" title="How long this huddle has been running"></span>'
      + '<button class="hd-wbtn" data-act="min" title="Minimise"><i data-lucide="minus" style="width:14px;height:14px"></i></button>'
      + '<button class="hd-wbtn" data-act="max" title="Maximise"><i data-lucide="maximize-2" style="width:14px;height:14px"></i></button>'
      + '</div><div class="hd-tiles"></div><div class="hd-controls"></div>';
    hdBindWidget(bar);
  }
  const tiles = bar.querySelector('.hd-tiles');
  bar.style.display = 'flex';
  hdApplyWidget(bar);
  bar.querySelector('.hd-title').textContent = 'Huddle · ' + (_hd.peers.size + 1);
  hdPaintClock();

  const selfLabel = 'You' + (_hd.muted ? ' (muted)' : '') + (_hd.sharing ? ' · sharing' : '');
  hdPaintTile(hdTileEl(tiles, '__self'), selfLabel, _hd.sharing ? _hd.screen : _hd.local,
              !!(_hd.cam || _hd.sharing), true, null, hdMe());

  const peers = [..._hd.peers.entries()];
  peers.forEach(([key, p]) => {
    const label = (p.name || key) + (p.state !== 'connected' ? ' · ' + p.state : '')
      + (p.sharing ? ' · sharing' : '');
    hdPaintTile(hdTileEl(tiles, key), label, p.stream, !!p.video, false, p, key);
    hdPaintAudio(key, p.stream);   // the voice, independent of every tile state
  });

  const keep = new Set(['__self', ...peers.map(([k]) => k)]);
  [...tiles.children].forEach(el => { if (!keep.has(el.getAttribute('data-tile'))) el.remove(); });
  hdPruneAudio(new Set(peers.map(([k]) => k)));

  // No media lives in the controls, so replacing those wholesale is safe
  const ic = n => `<i data-lucide="${n}" style="width:16px;height:16px"></i>`;
  bar.querySelector('.hd-controls').innerHTML = `
    <button class="hd-btn ${_hd.muted ? 'off' : 'on'}" onclick="huddleToggleMute()" title="${_hd.muted ? 'Unmute' : 'Mute'}">${ic(_hd.muted ? 'mic-off' : 'mic')}</button>
    <button class="hd-btn ${_hd.cam ? 'on' : ''}" onclick="huddleToggleCam()" title="Camera">${ic(_hd.cam ? 'video' : 'video-off')}</button>
    <button class="hd-btn ${_hd.sharing ? 'on' : ''}" onclick="huddleToggleShare()" title="Share screen">${ic('monitor-up')}</button>
    <button class="hd-btn" onclick="hdOpenInvite()" title="Add someone">${ic('user-plus')}</button>
    <button class="hd-btn leave" onclick="huddleLeave()" title="Leave huddle">${ic('phone-off')}</button>`;
  if (window.lucide) requestAnimationFrame(() => lucide.createIcons());
}

// Anyone in the workspace can be pulled in, not just people in this conversation.
// Someone outside it joins the call as a guest — the server grants them signalling
// for this huddle only, and never adds them to the room, so no history leaks.
async function hdOpenInvite() {
  const inCall = new Set((_hd.roster || []).map(r => r.key));
  const members = new Set(hdRoomMemberKeys(_hd.roomId));
  let people = [];
  try { const r = await HDCFG.fetch(HDCFG.base + '/people'); people = r.ok ? await r.json() : []; } catch (_) {}
  const rows = people
    .filter(p => p.key !== hdMe() && !inCall.has(p.key))
    .map(p => ({ ...p, guest: !members.has(p.key) }))
    .sort((a, b) => (a.guest - b.guest) || String(a.name).localeCompare(String(b.name)));
  if (!rows.length) { hdToast('Everyone is already here.'); return; }
  hdSheet('Add to huddle', `<div class="hd-list">
      ${rows.map(p => `<label class="hd-row"><input type="checkbox" class="hd-inv" value="${esc(p.key)}">
        <span style="flex:1">${esc(p.name)}</span>
        ${p.guest ? '<span class="hd-guest">guest</span>' : ''}</label>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px">Someone marked <em>guest</em> is not in this
      conversation. They join the call only — they will not see its messages.</div>`,
    `<button class="btn btn-outline btn-sm" onclick="hdSheetClose()">Cancel</button>
     <button class="btn btn-primary btn-sm" onclick="hdSendInvites()">Invite</button>`);
}
function hdSendInvites() {
  const picked = [...document.querySelectorAll('.hd-inv:checked')].map(cb => cb.value);
  picked.forEach(k => huddleInvite(k));
  hdSheetClose();
  hdToast(picked.length ? 'Invite sent.' : 'Nobody selected.');
}

// ── A small overlay used by the huddle invite and the group panel ──
function hdSheet(title, bodyHTML, footHTML) {
  const el = document.getElementById('hd-sheet');
  if (!el) return;
  el.innerHTML = `<div class="hd-sheet-box">
      <div class="hd-sheet-head"><div class="hd-sheet-title">${esc(title)}</div>
        <button class="hd-sheet-x" onclick="hdSheetClose()" title="Close">×</button></div>
      <div class="hd-sheet-body">${bodyHTML}</div>
      ${footHTML ? `<div class="hd-sheet-foot">${footHTML}</div>` : ''}
    </div>`;
  el.style.display = 'flex';
}
function hdSheetClose() { const el = document.getElementById('hd-sheet'); if (el) { el.style.display = 'none'; el.innerHTML = ''; } }

// ── Group administration ──────────────────────────────────────────────────────
// The admin manages any group; an employee manages groups they created. The
// server enforces the same rule — this only decides whether to draw the controls.
function chatCanManageRoom(room) {
  if (!room || room.type !== 'group') return false;
  return hdMe() === 'admin' || room.created_by === hdMe();
}

async function chatGroupPanel(roomId) {
  const room = hdRoom(roomId);
  if (!room) return;
  const can = chatCanManageRoom(room);
  const members = room.members || [];
  hdSheet(room.type === 'group' ? (room.name || 'Group') : 'Conversation', `
    ${can ? `<div class="hd-field">
      <label>Group name</label>
      <div style="display:flex;gap:8px">
        <input id="cg-name" class="hd-input" value="${esc(room.name || '')}" maxlength="80">
        <button class="btn btn-primary btn-sm" onclick="chatRenameRoom(${roomId})">Save</button>
      </div>
    </div>` : ''}
    <div class="hd-field">
      <label>${members.length} member${members.length === 1 ? '' : 's'}</label>
      <div class="hd-list" id="cg-members">
        ${members.map(m => `<div class="hd-row">
          <span style="flex:1">${esc(m.member_name)}${m.member_status_emoji ? ` <span title="${esc(m.member_status || '')}">${esc(m.member_status_emoji)}</span>` : ''}${m.member_key === hdMe() ? ' <span style="color:var(--muted)">(you)</span>' : ''}</span>
          ${can && m.member_key !== hdMe() ? `<button class="hd-sheet-x" title="Remove" onclick="chatRemoveMember(${roomId},${JSON.stringify(m.member_key).replace(/"/g, '&quot;')})">×</button>` : ''}
        </div>`).join('')}
      </div>
    </div>
    ${can ? `<div class="hd-field">
      <label>Add people</label>
      <div class="hd-list" id="cg-add"><div style="font-size:12px;color:var(--muted);padding:6px">Loading…</div></div>
    </div>` : ''}
    <div class="hd-field">
      <label>Shared files</label>
      <div id="cg-files"><div style="font-size:12px;color:var(--muted);padding:6px">Loading…</div></div>
    </div>`,
    `<button class="btn btn-outline btn-sm" onclick="hdSheetClose()">Close</button>
     ${can ? '<button class="btn btn-primary btn-sm" onclick="chatAddMembers(' + roomId + ')">Add selected</button>' : ''}`);
  if (can) chatGroupLoadCandidates(roomId);
  chatGroupLoadFiles(roomId);
}

async function chatGroupLoadCandidates(roomId) {
  const box = document.getElementById('cg-add');
  if (!box) return;
  let people = [];
  try { const r = await HDCFG.fetch(HDCFG.base + '/people'); people = r.ok ? await r.json() : []; } catch (_) {}
  const have = new Set(hdRoomMemberKeys(roomId));
  const free = people.filter(p => !have.has(p.key));
  box.innerHTML = free.length
    ? free.map(p => `<label class="hd-row"><input type="checkbox" class="cg-add-cb" value="${esc(p.key)}"> ${esc(p.name)}${p.role ? ` <span style="color:var(--muted)">· ${esc(p.role)}</span>` : ''}</label>`).join('')
    : '<div style="font-size:12px;color:var(--muted);padding:6px">Everyone is already in this group.</div>';
}

async function chatGroupLoadFiles(roomId) {
  const box = document.getElementById('cg-files');
  if (!box) return;
  let files = [];
  try { const r = await HDCFG.fetch(HDCFG.base + '/rooms/' + roomId + '/attachments'); files = r.ok ? await r.json() : []; } catch (_) {}
  if (!files.length) { box.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px">Nothing shared yet.</div>'; return; }
  box.innerHTML = '<div class="hd-files">' + files.map(f => {
    const img = (f.file_type || '').startsWith('image/');
    const kb = f.file_size ? Math.max(1, Math.round(f.file_size / 1024)) + ' KB' : '';
    return `<a class="hd-file" href="${esc(f.file_url)}" target="_blank" rel="noopener" title="${esc(f.file_name || '')}">
      ${img ? `<img src="${esc(f.file_url)}" alt="">` : '<div class="hd-file-ic"><i data-lucide="file-text" style="width:22px;height:22px"></i></div>'}
      <div class="hd-file-meta"><div class="hd-file-name">${esc(f.file_name || 'file')}</div>
        <div class="hd-file-sub">${esc(f.sender_name || '')}${kb ? ' · ' + kb : ''}</div></div></a>`;
  }).join('') + '</div>';
}

async function chatRenameRoom(roomId) {
  const name = (document.getElementById('cg-name') || {}).value || '';
  if (!name.trim()) { hdToast('Give the group a name.'); return; }
  const r = await HDCFG.fetch(HDCFG.base + '/rooms/' + roomId, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
  if (!r.ok) { hdToast(((await r.json().catch(() => ({}))).error) || 'Could not rename the group.'); return; }
  await HDCFG.refreshRooms();
  hdToast('Group renamed.');
  if (HDCFG.activeRoom() === roomId) HDCFG.openRoom(roomId);
  chatGroupPanel(roomId);
}

async function chatAddMembers(roomId) {
  const keys = [...document.querySelectorAll('.cg-add-cb:checked')].map(cb => cb.value);
  if (!keys.length) { hdToast('Pick at least one person.'); return; }
  const r = await HDCFG.fetch(HDCFG.base + '/rooms/' + roomId + '/members', { method: 'POST', body: JSON.stringify({ memberKeys: keys }) });
  if (!r.ok) { hdToast(((await r.json().catch(() => ({}))).error) || 'Could not add members.'); return; }
  await HDCFG.refreshRooms();
  hdToast(keys.length === 1 ? 'Member added.' : keys.length + ' members added.');
  chatGroupPanel(roomId);
}

async function chatRemoveMember(roomId, key) {
  if (!confirm('Remove ' + hdNameFor(key) + ' from this group?')) return;
  const r = await HDCFG.fetch(HDCFG.base + '/rooms/' + roomId + '/members/' + encodeURIComponent(key), { method: 'DELETE' });
  if (!r.ok) { hdToast(((await r.json().catch(() => ({}))).error) || 'Could not remove that member.'); return; }
  await HDCFG.refreshRooms();
  hdToast('Member removed.');
  chatGroupPanel(roomId);
}

// ── Chat header extras ────────────────────────────────────────────────────────
function chatHeaderActions(room) {
  if (!room) return '';
  const ic = (n) => `<i data-lucide="${n}" style="width:16px;height:16px"></i>`;
  const inThis = _hd.roomId === room.id;
  // Someone already in a call can always hang up, whatever their permissions say —
  // the alternative is a participant trapped in a huddle with no leave button.
  const mayHuddle = !HDCFG.can || HDCFG.can('chat', 'huddle');
  // The huddle control was two unlabelled icons, so "can I call these people"
  // was answered by hovering. The audio one carries its name now; video stays
  // an icon beside it rather than being dropped.
  // hdRelayCheck(false) is a no-op once the probe has run, so calling it on
  // every header render costs nothing and means the chip fills itself in the
  // first time a conversation is opened.
  if (mayHuddle) setTimeout(() => hdRelayCheck(false), 0);
  return `<div class="chat-head-actions">
    ${mayHuddle ? hdRelayChipHtml() : ''}
    ${inThis
      ? `<button class="hd-head-btn live" onclick="huddleLeave()" title="Leave the huddle">${ic('phone-off')} Leave</button>`
      : !mayHuddle ? ''
      : `<button class="hd-head-btn labelled" onclick="huddleStart(${room.id},false)" title="Start a huddle">${ic('headphones')} Huddle</button>
         <button class="hd-head-btn" onclick="huddleStart(${room.id},true)" title="Start a huddle with video">${ic('video')}</button>`}
    <button class="hd-head-btn" onclick="chatGroupPanel(${room.id})" title="${room.type === 'group' ? 'Group info, members and files' : 'Shared files'}">${ic(room.type === 'group' ? 'users' : 'paperclip')}</button>
  </div>`;
}
// ── Relay chip ────────────────────────────────────────────────────────
// Whether a huddle will actually connect was knowable only by pressing an
// admin-only icon and reading a toast that vanished in six seconds. It is
// a property of the room you are looking at, so it belongs in its header.
//
// Probed once per session and cached: the probe opens a peer connection and
// waits up to eight seconds for candidates, which is not something to repeat
// every time somebody opens a conversation. Clicking re-runs it.
let _hdRelay = { state: 'unknown', label: 'Relay', detail: '' };

function hdRelayChipHtml() {
  const s = _hdRelay;
  return `<button class="hd-relay ${esc(s.state)}" onclick="hdRelayCheck(true)"
    title="${esc(s.detail || 'Check whether huddles can reach a relay')}">
    <i data-lucide="signal" style="width:13px;height:13px"></i> <span>${esc(s.label)}</span></button>`;
}

function hdRelaySet(state, label, detail) {
  _hdRelay = { state, label, detail };
  document.querySelectorAll('.hd-relay').forEach(el => {
    el.className = 'hd-relay ' + state;
    el.title = detail || '';
    const t = el.querySelector('span');
    if (t) t.textContent = label;
  });
}

async function hdRelayCheck(force) {
  if (!force && _hdRelay.state !== 'unknown') return _hdRelay;
  hdRelaySet('checking', 'Checking…', 'Testing whether a relay is reachable');
  try {
    const r = await huddleRelayTest({ quiet: true });
    if (r && r.ok) {
      hdRelaySet('ok', 'Relay OK', `Relay reachable via ${r.provider} — ${(r.protocols || []).join(', ')}`);
    } else if (r && r.reason === 'not-configured') {
      // Not a failure: calls still work on the same network. Saying "OK" would
      // be wrong and saying "failed" would be alarming, so it says what it is.
      hdRelaySet('stun', 'STUN only', `No TURN configured (provider: ${r.provider}). Huddles work on the same network.`);
    } else {
      hdRelaySet('down', 'No relay', (r && r.reason) ? String(r.reason) : 'Nothing came back from the relay');
    }
  } catch (e) {
    hdRelaySet('down', 'No relay', String((e && e.message) || e));
  }
  return _hdRelay;
}

function chatHeaderStatus(room) {
  if (!room || room.type !== 'direct') return '';
  const other = (room.members || []).find(m => m.member_key !== hdMe());
  if (!other) return '';
  // Today's availability rides along when the board has been loaded this
  // session — "partial 14:00–18:00" answers "can I call?" before the call.
  let avail = '';
  try {
    const d = typeof availabilityToday === 'function' ? availabilityToday(other.member_key) : null;
    if (d) {
      const color = d.status === 'available' ? '#22c55e' : d.status === 'partial' ? '#eab308' : '#6b7280';
      // Availability reads as 12h everywhere, including here.
      const span = typeof avRange12 === 'function' ? avRange12(d.from, d.to) : `${d.from}–${d.to}`;
      const hours = d.status !== 'off' && span ? ` ${span}` : '';
      avail = ` <span style="font-size:10px;font-weight:600;color:${color}">· ${d.status}${hours}</span>`;
    }
  } catch (_) {}
  return statusChip(other.member_status_emoji, other.member_status) + avail;
}

// ── Status ────────────────────────────────────────────────────────────────────
// Everyone's status is attached to room members and message senders by the API,
// so any viewer sees it — not just the person who set it.
function statusChip(emoji, text) {
  if (!emoji && !text) return '';
  const tip = text || '';
  return `<span class="status-chip" title="${esc(tip)}">${emoji ? esc(emoji) : '<i data-lucide="message-square" style="width:11px;height:11px"></i>'}${text ? '<span class="status-chip-txt">' + esc(text) + '</span>' : ''}</span>`;
}
function statusEmojiOnly(emoji, text) {
  if (!emoji) return '';
  return `<span class="status-emo" title="${esc(text || '')}">${esc(emoji)}</span>`;
}
