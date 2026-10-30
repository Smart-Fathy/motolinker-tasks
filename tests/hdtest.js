// Two-peer huddle test: the real module source lifted out of dashboard.html,
// instantiated twice in one page with an in-page signalling relay.
const fs = require('fs');
const puppeteer = require('puppeteer');
const http = require('http');

const html = fs.readFileSync('public/assets/huddle.js', 'utf8');
const CSSSRC = fs.readFileSync('public/assets/dashboard.css', 'utf8');
const start = html.indexOf('// Mesh topology: every participant holds one RTCPeerConnection');
const endMark = 'function statusEmojiOnly(emoji, text) {';
const end = html.indexOf('\n}', html.indexOf(endMark)) + 2;
if (start < 0 || end < 2) throw new Error('could not slice the huddle module');
const MODULE = html.slice(start, end);
if (!/function huddleToggleShare/.test(MODULE)) throw new Error('module slice looks wrong');

// The real stylesheet, not just the script: the full-screen behaviour is half CSS,
// and without it these assertions would only be measuring Chrome's UA defaults.
const cssFrom = CSSSRC.indexOf('/* \u2500\u2500 Huddles, group panel & status chips \u2500\u2500 */');
const mqAt = CSSSRC.indexOf('@media (max-width:640px) {', cssFrom);
let d = 0, cssEnd = mqAt;
for (; cssEnd < CSSSRC.length; cssEnd++) {
  if (CSSSRC[cssEnd] === '{') d++;
  else if (CSSSRC[cssEnd] === '}') { d--; if (!d) { cssEnd++; break; } }
}
const CSS = CSSSRC.slice(cssFrom, cssEnd);
// Validates the slice covers the right region. It deliberately does NOT pin the exact
// selector: asserting the rule's text is what let a rule that never wins ship once.
// The geometry assertions below are the real check.
if (!/\.hd-tile:fullscreen \.hd-video/.test(CSS)) throw new Error('css slice looks wrong');
console.log('module slice:', MODULE.split('\n').length, 'lines;  css slice:', CSS.split('\n').length, 'lines');

const PAGE = `<!doctype html><html><head><style>
:root{--bg:#0c0c0e;--surface:#141416;--border:rgba(255,255,255,.09);--text:#f3efe7;
      --muted:#8d897f;--primary:#c9a35e;--danger:#c97d6e}
body{margin:0;background:var(--bg);color:var(--text)}
${CSS}
</style></head><body>
<div id="hd-bar"></div><div id="hd-toast"></div><div id="hd-join-chip"></div>
<div id="hd-incoming"></div><div id="hd-sheet"></div>
<script>
function esc(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
window.__log = [];
function makeClient(HDCFG) {
${MODULE}
  return { huddleStart, huddleJoinExisting, huddleLeave, huddleOnSignal, huddleToggleMute,
           huddleToggleCam, huddleToggleShare, hdRenderBar, hdIncoming, hdIce, hdOpenInvite,
           hdPollStats, hdQuality, hdCanShareScreen, hdAvatarFor, hdInitialsFor, hdRingOnce,
           hdRenderBar, hdDialRoster, hdAudioBlocked, hdBootLive, hdCheckLive, hdElapsed,
           hdRestart, hdAlive, hdTeardown, hdLeaveOnUnload, huddleOnStreamOpen, huddleOnStreamFrame,
           hdStreamQuery,
           state: () => _hd, peers: () => _hd.peers };
}

const ROOM = { id: 1, type: 'group', name: 'Test', created_by: 'A',
  members: [{ member_key: 'A', member_name: 'Ann' },
             { member_key: 'B', member_name: 'Bob Marley', member_avatar: '/icons/icon-192.png' },
             { member_key: 'C', member_name: 'Cid' }] };
// Mirrors the server: a boot id per process, a session id per join, and roster
// frames that say who joined or left.
const bus = { inbox: {}, rosters: {}, sids: {}, boot: 'b1' };
const plist = rid => [...(bus.rosters[rid] || [])].map(k => ({ key: k, name: k, sid: (bus.sids[rid] || {})[k] }));

function makeFetch(key) {
  return async (url, opts) => {
    if (url.endsWith('/huddle/live')) {
      const live = Object.entries(bus.rosters).filter(([, set]) => set.size)
        .map(([rid, set]) => ({ roomId: Number(rid), started_at: window.__hdStarted || Date.now() - 125000,
                                participants: [...set].map(k => ({ key: k, name: k })) }));
      return { ok: true, json: async () => live };
    }
    if (url.endsWith('/huddle/ice')) {
      window.__iceCalls = (window.__iceCalls || 0) + 1;
      return { ok: true, json: async () => ({ iceServers: [], hasTurn: false, provider: 'none', ttl: 7200, max: 6 }) };
    }
    const one = url.split('/huddle/')[1];
    if (one && /^[0-9]+$/.test(one)) return { ok: true, json: async () => ({ boot: bus.boot, participants: plist(Number(one)), started_at: window.__hdStarted }) };
    const body = JSON.parse(opts.body);
    window.__log.push(key + ' -> ' + body.type + (body.to ? ' @' + body.to : ''));
    // A test can answer a request itself, or change it on the way in (scenarios 39–41).
    if (window.__hook) { const reply = window.__hook(key, body); if (reply) return { ok: true, json: async () => reply }; }
    const rid = body.roomId;
    if (body.type === 'join') {
      (bus.rosters[rid] = bus.rosters[rid] || new Set()).add(key);
      (bus.sids[rid] = bus.sids[rid] || {})[key] = body.data && body.data.sid;
      const participants = plist(rid);
      // The server stamps the huddle's start once; everybody reads the same one.
      window.__hdStarted = window.__hdStarted || Date.now() - 125000;
      const started_at = window.__hdStarted;
      const boot = bus.boot;
      setTimeout(() => ['A','B','C'].forEach(k => bus.inbox[k] && bus.inbox[k]({ type:'roster', roomId: rid, boot, participants, started_at, joined: key })), 0);
      return { ok: true, json: async () => ({ ok: true, boot, participants, started_at }) };
    }
    if (body.type === 'alive') {
      (window.__alive = window.__alive || []).push({ key, data: body.data });
      return { ok: true, json: async () => ({ ok: true, inCall: !!(bus.rosters[rid] && bus.rosters[rid].has(key)), boot: bus.boot, sid: (bus.sids[rid] || {})[key] || null }) };
    }
    if (body.type === 'leave') {
      const cur = (bus.sids[rid] || {})[key];
      if (body.data && body.data.sid && cur && body.data.sid !== cur) return { ok: true, json: async () => ({ ok: true, ignored: 'superseded' }) };
      if (bus.rosters[rid]) bus.rosters[rid].delete(key);
      if (bus.sids[rid]) delete bus.sids[rid][key];
      const participants = plist(rid);
      // The server sends the start time on every roster frame, leave included —
      // otherwise the chip a leaver is left looking at loses its clock.
      const startedLeave = participants.length ? window.__hdStarted : (window.__hdStarted = null);
      const boot = bus.boot;
      setTimeout(() => ['A','B','C'].forEach(k => bus.inbox[k] && bus.inbox[k]({ type:'roster', roomId: rid, boot, participants, started_at: startedLeave, left: key })), 0);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    setTimeout(() => {
      const t = bus.inbox[body.to];
      if (t) t({ type: body.type, roomId: rid, from: key, fromName: key, data: body.data });
    }, 0);
    return { ok: true, json: async () => ({ ok: true }) };
  };
}
function cfg(key) {
  return { base: '/api/x/chat', me: () => key, fetch: makeFetch(key), token: () => 'tok-' + key,
           rooms: () => [ROOM], activeRoom: () => 1, openRoom: () => {}, refreshRooms: async () => {} };
}
window.A = makeClient(cfg('A'));
window.B = makeClient(cfg('B'));
window.C = makeClient(cfg('C'));
window.B2 = makeClient(cfg('B'));   // the same person on a second device (scenario 33)
bus.inbox.A = m => window.A.huddleOnSignal(m);
bus.inbox.B = m => window.B.huddleOnSignal(m);
bus.inbox.C = m => window.C.huddleOnSignal(m);
window.__bus = bus;
<\/script></body></html>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: require('./helpers/browser').chromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--auto-select-desktop-capture-source=Entire screen', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  // navigator.mediaDevices only exists in a secure context, and about:blank is not
  // one — serve the harness from http://127.0.0.1, which the browser trusts.
  const server = http.createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'domcontentloaded' });

  const results = [];
  const check = (name, ok, extra) => { results.push({ name, ok, extra }); console.log((ok ? '  ok  ' : ' FAIL ') + name + (extra ? '  ' + extra : '')); };

  // 1. A starts an audio huddle; B should see the incoming prompt
  await page.evaluate(() => window.A.huddleStart(1, false));
  await sleep(400);
  const incoming = await page.evaluate(() => document.getElementById('hd-incoming').style.display);
  check('B gets an incoming-huddle prompt', incoming === 'block', 'display=' + incoming);

  // 2. B joins → both connect
  await page.evaluate(() => window.B.huddleJoinExisting(1));
  const connected = await page.waitForFunction(() => {
    const a = [...window.A.peers().values()][0], b = [...window.B.peers().values()][0];
    return a && b && a.pc.connectionState === 'connected' && b.pc.connectionState === 'connected';
  }, { timeout: 20000 }).then(() => true).catch(() => false);
  const states = await page.evaluate(() => ({
    a: [...window.A.peers().entries()].map(([k, p]) => k + ':' + p.pc.connectionState),
    b: [...window.B.peers().entries()].map(([k, p]) => k + ':' + p.pc.connectionState),
  }));
  check('both peers reach connected', connected, JSON.stringify(states));

  // 2b. AUDIBILITY. Frames being decoded proves nothing reaches the speakers —
  //     a remote stream is only heard once it is attached to a media element.
  //     An audio-only huddle has no camera, so this is the case that regressed:
  //     the tile drew an avatar and never created the element that plays sound.
  await sleep(600);
  const audible = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('#hd-bar [data-tile]')];
    const peerTile = tiles.find(t => t.getAttribute('data-tile') !== '__self');
    const v = peerTile && peerTile.querySelector('video');
    return {
      tiles: tiles.map(t => t.getAttribute('data-tile')),
      hasEl: !!v,
      attached: !!(v && v.srcObject),
      audioTracks: v && v.srcObject ? v.srcObject.getAudioTracks().length : 0,
      muted: v ? v.muted : null,
      paused: v ? v.paused : null,
      selfMuted: (tiles.find(t => t.getAttribute('data-tile') === '__self') || {}).querySelector
        ? tiles.find(t => t.getAttribute('data-tile') === '__self').querySelector('video').muted : null,
    };
  });
  check('an audio-only peer still gets a media element', audible.hasEl, JSON.stringify(audible));
  check('the remote stream is attached to it', audible.attached && audible.audioTracks === 1, JSON.stringify(audible));
  // The audio path moved OUT of the tile: the tile <video> is always muted now
  // (the sink below carries the voice; both playing would double every voice),
  // which also means tile playback can never be autoplay-blocked.
  check('the remote TILE is muted — audio rides the sink, not the tile', audible.muted === true, JSON.stringify(audible));
  check('and it is actually playing', audible.paused === false, JSON.stringify(audible));
  check('our own tile IS muted, so we do not echo', audible.selfMuted === true, JSON.stringify(audible));

  // 2b-sink. The voice lives in a per-peer <audio> OUTSIDE #hd-bar, so no tile
  // state — avatar mode, a minimised widget, display:none anywhere in the bar —
  // can silence a call. This is the WebKit half of "they can't hear me until I
  // share my screen": a MediaStream <video> outside the render tree never plays
  // there, and the old design's only audio element was display:none whenever the
  // peer had no picture.
  const sink = await page.evaluate(() => {
    const sinks = [...document.querySelectorAll('.hd-audio-sink')];
    // Client A's sink: the one holding an element for peer B.
    const au = sinks.flatMap(sk => [...sk.children]).find(a => a.dataset.peer === 'B');
    if (!au) return { found: false, sinks: sinks.length };
    const tileVideo = document.querySelector('#hd-bar [data-tile="B"] video');
    return {
      found: true,
      insideBar: !!au.closest('#hd-bar'),
      tag: au.tagName,
      muted: au.muted,
      paused: au.paused,
      sameStream: !!(tileVideo && au.srcObject === tileVideo.srcObject),
      audioTracks: au.srcObject ? au.srcObject.getAudioTracks().length : 0,
    };
  });
  check('a per-peer audio sink exists', sink.found === true, JSON.stringify(sink));
  check('…as an <audio> OUTSIDE #hd-bar', sink.tag === 'AUDIO' && sink.insideBar === false, JSON.stringify(sink));
  check('…unmuted and playing the same remote stream', sink.muted === false && sink.paused === false && sink.sameStream && sink.audioTracks === 1, JSON.stringify(sink));

  // Minimising the widget hides every tile with display:none — the sink must
  // keep playing regardless, because it does not live in the widget at all.
  const minimised = await page.evaluate(async () => {
    const bar = document.getElementById('hd-bar');
    bar.classList.add('min');
    await new Promise(r => setTimeout(r, 150));
    const au = [...document.querySelectorAll('.hd-audio-sink audio')].find(a => a.dataset.peer === 'B');
    const out = { paused: au ? au.paused : null };
    bar.classList.remove('min');
    return out;
  });
  check('minimising the widget does not pause the voice', minimised.paused === false, JSON.stringify(minimised));

  // 2c. Re-rendering must not tear down live playback
  const survives = await page.evaluate(() => {
    const el = () => document.querySelector('#hd-bar [data-tile]:not([data-tile="__self"]) video');
    const before = el();
    const beforeStream = before.srcObject;
    window.A.hdRenderBar(); window.A.hdRenderBar();
    const after = el();
    return { sameNode: before === after, sameStream: after.srcObject === beforeStream, paused: after.paused };
  });
  check('a re-render reuses the media element instead of recreating it',
    survives.sameNode && survives.sameStream && survives.paused === false, JSON.stringify(survives));

  // 3. Glare rule: only A (smaller key) created the offer
  const log = await page.evaluate(() => window.__log.slice());
  const offers = log.filter(l => l.includes('-> offer'));
  check('exactly one offer, sent by A', offers.length === 1 && offers[0].startsWith('A'), JSON.stringify(offers));

  // 4. AUDIO BOTH WAYS. Every assertion above reads window.A — and A is always the
  //    offerer, because the glare rule picks by key order. So the answering side was
  //    never checked at all, which is the direction users report as "he cannot hear me".
  //    Checked at the element, not the peer entry: a track the page holds but never
  //    plays is silence.
  const bothWays = await page.evaluate(() => {
    const probe = (who, peerKey) => {
      const p = window[who].peers().get(peerKey);
      if (!p) return { err: 'no peer ' + peerKey + ' on ' + who };
      const el = [...document.querySelectorAll('#hd-bar [data-tile]')]
        .find(t => t.getAttribute('data-tile') === peerKey);
      const v = el && el.querySelector('video');
      const recv = p.pc.getReceivers().filter(r => r.track && r.track.kind === 'audio');
      const send = p.pc.getSenders().filter(r => r.track && r.track.kind === 'audio');
      const at = p.pc.getTransceivers().find(t => (t.receiver.track || {}).kind === 'audio');
      return {
        entryAudio: p.stream.getAudioTracks().length,
        sending: send.length, receiving: recv.length,
        audioDirection: at ? at.currentDirection : null,
        elAudio: v && v.srcObject ? v.srcObject.getAudioTracks().length : 0,
        elPaused: v ? v.paused : null,
        elMuted: v ? v.muted : null,
      };
    };
    return { aFromB: probe('A', 'B'), bFromA: probe('B', 'A') };
  });
  check('the offerer receives the answerer\'s audio',
    bothWays.aFromB.entryAudio === 1, JSON.stringify(bothWays.aFromB));
  check('the ANSWERER receives the offerer\'s audio',
    bothWays.bFromA.entryAudio === 1, JSON.stringify(bothWays.bFromA));
  check('both sides are actually sending audio',
    bothWays.aFromB.sending === 1 && bothWays.bFromA.sending === 1,
    JSON.stringify({ a: bothWays.aFromB.sending, b: bothWays.bFromA.sending }));
  check('neither audio m-line ended up receive-only',
    bothWays.aFromB.audioDirection === 'sendrecv' && bothWays.bFromA.audioDirection === 'sendrecv',
    JSON.stringify({ a: bothWays.aFromB.audioDirection, b: bothWays.bFromA.audioDirection }));

  // 4b. THE PLAYBACK INVARIANT. The negotiation above is fine in both directions, so
  //     silence comes from the element, not the SDP. hdPeer creates entry.stream EMPTY
  //     and hdPaintTile binds it behind an identity check; ontrack later mutates that
  //     same object. If a render happens before the first track — which it does for the
  //     offerer, since the roster handler calls hdCall() then hdRenderBar() — the
  //     element is bound to an empty stream, play() rejects, and because the identity
  //     never changes it is never bound or played again. That rejected play() is what
  //     raises "your browser blocked the sound", and the click listener it installs is
  //     why the call starts working the moment the user clicks anything at all.
  const playback = await page.evaluate(async () => {
    const A = window.A;
    // Record every play() with whether the element had anything to play.
    const realPlay = HTMLMediaElement.prototype.play;
    const calls = [];
    HTMLMediaElement.prototype.play = function () {
      calls.push({ tracks: this.srcObject ? this.srcObject.getTracks().length : -1 });
      return realPlay.call(this);
    };

    // A peer that exists before any of its media has arrived — the ordinary case.
    const stream = new MediaStream();
    A.peers().set('Z', { pc: { connectionState: 'connected', close() {} },
                         stream, name: 'Zoe', state: 'connected', video: false, quality: 3 });
    A.hdRenderBar();
    await new Promise(r => setTimeout(r, 50));
    const tile = () => document.querySelector('#hd-bar [data-tile="Z"]');
    const boundWhileEmpty = !!(tile() && tile().querySelector('video').srcObject);
    const playsWhileEmpty = calls.filter(c => c.tracks === 0).length;

    // Now the audio arrives, exactly as ontrack delivers it: added to the same object.
    const track = A.state().local.getAudioTracks()[0].clone();
    stream.addTrack(track);
    const before = calls.length;
    A.hdRenderBar();
    await new Promise(r => setTimeout(r, 50));
    const v = tile() && tile().querySelector('video');
    const out = {
      boundWhileEmpty, playsWhileEmpty,
      playedAfterTrack: calls.length - before,
      elHasAudio: v && v.srcObject ? v.srcObject.getAudioTracks().length : 0,
      elPaused: v ? v.paused : null,
    };
    HTMLMediaElement.prototype.play = realPlay;
    A.peers().delete('Z'); A.hdRenderBar();
    return out;
  });
  check('a tile with no media yet is not bound to an empty stream',
    playback.boundWhileEmpty === false && playback.playsWhileEmpty === 0, JSON.stringify(playback));
  check('audio arriving after the tile was painted gets played',
    playback.playedAfterTrack >= 1, JSON.stringify(playback));
  check('and the element ends up holding it, unpaused',
    playback.elHasAudio === 1 && playback.elPaused === false, JSON.stringify(playback));

  // 5. Mute disables the local audio track without renegotiating
  await page.evaluate(() => window.A.huddleToggleMute());
  const muted = await page.evaluate(() => ({
    flag: window.A.state().muted,
    enabled: window.A.state().local.getAudioTracks()[0].enabled,
  }));
  check('mute disables the outgoing audio track', muted.flag === true && muted.enabled === false, JSON.stringify(muted));
  await page.evaluate(() => window.A.huddleToggleMute());
  const unmuted = await page.evaluate(() => window.A.state().local.getAudioTracks()[0].enabled);
  check('unmute re-enables it', unmuted === true);

  // 6. Camera on → a video sender appears and B receives a video track
  await page.evaluate(() => window.A.huddleToggleCam());
  const camOn = await page.waitForFunction(() => {
    const a = [...window.A.peers().values()][0];
    return window.A.state().cam && a.pc.getSenders().some(s => s.track && s.track.kind === 'video');
  }, { timeout: 8000 }).then(() => true).catch(() => false);
  // The reserved transceiver means a video track always exists; what proves the
  // camera really reached B is the track unmuting and frames being decoded.
  const bVideo = await page.waitForFunction(async () => {
    const b = [...window.B.peers().values()][0];
    if (!b || b.stream.getVideoTracks().length !== 1 || b.stream.getVideoTracks()[0].muted) return false;
    let frames = 0;
    (await b.pc.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') frames = r.framesDecoded || 0; });
    return frames > 0;
  }, { timeout: 20000, polling: 500 }).then(() => true).catch(() => false);
  const bStats = await page.evaluate(async () => {
    const b = [...window.B.peers().values()][0];
    const t = b.stream.getVideoTracks()[0];
    let frames = 0;
    (await b.pc.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') frames = r.framesDecoded || 0; });
    return { tracks: b.stream.getVideoTracks().length, muted: t ? t.muted : null, frames, flagged: b.video };
  });
  check('camera adds a video sender on A', camOn);
  check('B decodes A video frames', bVideo, JSON.stringify(bStats));

  // 6b. Full screen. Both clients share one DOM in this harness, so render from A
  //     and assert against A's view: A's camera is on, B is audio-only.
  //     The others keep polling and each poll re-renders the one shared widget with
  //     its own idea of whether it is maximised, which, landing between a toggle and a
  //     click, makes this section flake. Only A needs to draw it here.
  await page.evaluate(() => { for (const k of ['B', 'C', 'B2']) { const st = window[k].state(); clearInterval(st.statsTimer); st.statsTimer = null; } });
  await page.evaluate(() => window.A.hdRenderBar());
  await sleep(200);
  const fsBefore = await page.evaluate(() => {
    const t = k => document.querySelector('[data-tile="' + k + '"] .hd-full');
    return { withVideo: t('__self').style.display, audioOnly: t('B').style.display };
  });
  check('the full-screen button shows on a tile with a picture', fsBefore.withVideo === 'flex', JSON.stringify(fsBefore));
  check('and stays hidden on an audio-only tile', fsBefore.audioOnly === 'none', JSON.stringify(fsBefore));

  // Maximised, because that is the only state the bug appears in — and it is sticky,
  // persisted in localStorage and reapplied on every render, so once a user clicks
  // maximise full screen stays broken for them across calls and reloads.
  // `#hd-bar.max .hd-video` is (1,2,0) and beat the unscoped `.hd-tile:fullscreen
  // .hd-video` at (0,3,0), leaving the share at thumbnail size in the corner.
  // Maximise through the real control, not by adding the class: hdApplyWidget
  // re-derives it from the persisted _hdUI on every render and would strip it.
  await page.evaluate(() => document.querySelector('#hd-bar .hd-wbtn[data-act="max"]')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 })));
  await sleep(150);

  // requestFullscreen needs a trusted gesture, so drive a real click.
  // The toast is pointer-events:none precisely so it cannot intercept this.
  for (let attempt = 1; ; attempt++) {
    try { await page.click('[data-tile="__self"] .hd-full'); break; }
    catch (e) { if (attempt >= 6) throw e; await sleep(150); }
  }
  await page.waitForFunction(() => !!document.fullscreenElement, { timeout: 4000, polling: 50 }).catch(() => {});
  await sleep(300);
  const inFs = await page.evaluate(() => {
    const el = document.fullscreenElement;
    if (!el) return { active: false };
    const v = el.querySelector('.hd-video');
    const cs = getComputedStyle(v), ts = getComputedStyle(el);
    return { active: true, tile: el.getAttribute('data-tile'),
             fit: cs.objectFit, cssW: cs.width, w: v.clientWidth, vw: innerWidth,
             h: v.clientHeight, vh: innerHeight,
             maxed: document.getElementById('hd-bar').classList.contains('max'),
             tileW: el.clientWidth, tileCssW: ts.width, screenW: screen.width };
  });
  check('clicking it takes that tile full screen', inFs.active && inFs.tile === '__self', JSON.stringify(inFs));
  check('the thumbnail crop is dropped, so a shared screen keeps its edges',
    inFs.fit === 'contain', JSON.stringify(inFs));
  check('and the video fills the viewport', inFs.w >= inFs.vw - 2, JSON.stringify(inFs));
  // The pixel geometry above cannot prove the maximised case: headless Chromium does
  // not lay a full-screen element out faithfully — with the rule scoped or unscoped it
  // reports the same non-pixel computed width. So the cascade is asserted directly,
  // which is where the bug actually lived. `#hd-bar.max .hd-video` is (1,2,0) and an id
  // outranks any number of classes, so an unscoped `.hd-tile:fullscreen .hd-video` at
  // (0,3,0) loses and the share stays thumbnail-sized in the corner of a black screen.
  {
    const spec = sel => {
      const ids = (sel.match(/#[\w-]+/g) || []).length;
      const cls = (sel.match(/\.[\w-]+|:[\w-]+(?:\([^)]*\))?|\[[^\]]+\]/g) || []).length;
      return ids * 1000 + cls;   // one id outranks any realistic number of classes
    };
    // A rule can list several selectors; only the one that targets .hd-video counts.
    const ruleFor = re => {
      const list = (CSS.match(re) || [])[1];
      if (!list) return null;
      return list.split(',').map(x => x.trim()).find(x => x.includes('.hd-video')) || null;
    };
    const fsVideo = ruleFor(/\n\s*([^\n{]*:fullscreen[^\n{]*\.hd-video)\s*\{/);
    const maxVideo = ruleFor(/\n\s*([^\n{]*#hd-bar\.max[^\n{]*\.hd-video[^\n{]*)\s*\{[^}]*height/);
    check('the full-screen video rule outranks the maximised-widget rule',
      !!fsVideo && !!maxVideo && spec(fsVideo) > spec(maxVideo),
      JSON.stringify({ fsVideo, fs: fsVideo && spec(fsVideo), maxVideo, max: maxVideo && spec(maxVideo) }));
    check('and it was exercised with the widget actually maximised', inFs.maxed === true);
  }

  const stillLive = await page.evaluate(() => {
    const v = document.querySelector('[data-tile="__self"] .hd-video');
    return { paused: v.paused, attached: !!v.srcObject };
  });
  check('playback survives the transition', stillLive.paused === false && stillLive.attached, JSON.stringify(stillLive));

  // A re-render mid-fullscreen must not drop us out of it
  await page.evaluate(() => window.A.hdRenderBar());
  await sleep(300);
  check('a re-render does not kick us out of full screen',
    await page.evaluate(() => !!document.fullscreenElement));
  await page.evaluate(() => {
    document.querySelector('#hd-bar .hd-wbtn[data-act="max"]')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 10 }));
    localStorage.removeItem('ml_huddle_ui');
  });

  // The widget re-renders after the toggle above, and a click that lands mid-render finds
  // the button detached or not laid out yet ("Node is either not clickable"). It has to
  // be a real click — full screen needs a user gesture — so try again until one lands.
  for (let attempt = 1; ; attempt++) {
    try { await page.click('[data-tile="__self"] .hd-full'); break; }
    catch (e) { if (attempt >= 6) throw e; await sleep(150); }
  }
  // Leaving full screen is asynchronous; a slow start can take longer than a fixed pause.
  await page.waitForFunction(() => !document.fullscreenElement, { timeout: 4000, polling: 50 }).catch(() => {});
  await sleep(150);
  const outFs = await page.evaluate(() => {
    const v = document.querySelector('[data-tile="__self"] .hd-video');
    const cs = getComputedStyle(v);
    return { active: !!document.fullscreenElement, fit: cs.objectFit, cssW: cs.width,
             matchesFs: v.closest('.hd-tile').matches(':fullscreen') };
  });
  check('clicking again exits full screen', outFs.active === false, JSON.stringify(outFs));
  check('and the thumbnail crop comes back', outFs.fit === 'cover', JSON.stringify(outFs));

  // 7. Screen share replaces the camera track on the same sender (no new m-line)
  const beforeSenders = await page.evaluate(() => [...window.A.peers().values()][0].pc.getSenders().length);
  const shared = await page.evaluate(async () => {
    await window.A.huddleToggleShare();
    return window.A.state().sharing;
  });
  const afterShare = await page.evaluate(() => {
    const p = [...window.A.peers().values()][0];
    const vs = p.pc.getSenders().filter(s => s.track && s.track.kind === 'video');
    return { senders: p.pc.getSenders().length, videoSenders: vs.length,
             label: vs[0] ? vs[0].track.label : null,
             screenTrack: window.A.state().screen ? window.A.state().screen.getVideoTracks()[0].label : null };
  });
  check('screen share turns on', shared === true);
  check('screen share reuses the video sender (no extra sender)',
        afterShare.senders === beforeSenders && afterShare.videoSenders === 1,
        JSON.stringify(afterShare));
  check('the video sender now carries the screen track',
        !!afterShare.label && afterShare.label === afterShare.screenTrack, JSON.stringify(afterShare));

  // 8. Stopping the share puts the camera track back on the same sender
  await page.evaluate(() => window.A.huddleToggleShare());
  const afterStop = await page.evaluate(() => {
    const p = [...window.A.peers().values()][0];
    const vs = p.pc.getSenders().filter(s => s.track && s.track.kind === 'video');
    return { sharing: window.A.state().sharing, videoSenders: vs.length,
             label: vs[0] ? vs[0].track.label : null,
             camLabel: window.A.state().local.getVideoTracks()[0] ? window.A.state().local.getVideoTracks()[0].label : null };
  });
  check('stopping the share restores the camera track',
        afterStop.sharing === false && afterStop.videoSenders === 1 && afterStop.label === afterStop.camLabel,
        JSON.stringify(afterStop));

  // 9. Leaving tears the peer down on both sides
  await page.evaluate(() => window.B.huddleLeave());
  await sleep(500);
  const afterLeave = await page.evaluate(() => ({
    aPeers: window.A.peers().size, bRoom: window.B.state().roomId,
    bLocalLive: window.B.state().local ? window.B.state().local.getTracks().some(t => t.readyState === 'live') : false,
  }));
  check('B leaving drops the peer on A and stops B media',
        afterLeave.aPeers === 0 && afterLeave.bRoom === null && afterLeave.bLocalLive === false,
        JSON.stringify(afterLeave));

  await page.evaluate(() => window.A.huddleLeave());
  await sleep(400);

  // 10. Three-way mesh: each participant holds a connection to both others, and
  //     the glare rule still yields exactly one offer per pair.
  await page.evaluate(() => { window.__log.length = 0; });
  await page.evaluate(() => window.A.huddleStart(2, false));
  await sleep(200);
  await page.evaluate(() => window.B.huddleJoinExisting(2));
  await sleep(200);
  await page.evaluate(() => window.C.huddleJoinExisting(2));
  const mesh = await page.waitForFunction(() => ['A','B','C'].every(k => {
    const ps = [...window[k].peers().values()];
    return ps.length === 2 && ps.every(p => p.pc.connectionState === 'connected');
  }), { timeout: 25000, polling: 500 }).then(() => true).catch(() => false);
  const meshState = await page.evaluate(() => Object.fromEntries(['A','B','C'].map(k =>
    [k, [...window[k].peers().entries()].map(([n, p]) => n + ':' + p.pc.connectionState)])));
  check('3-way mesh: everyone connected to everyone', mesh, JSON.stringify(meshState));
  const offers3 = await page.evaluate(() => window.__log.filter(l => l.includes('-> offer')).sort());
  check('one offer per pair, always from the smaller key',
        offers3.length === 3 && offers3.join() === 'A -> offer @B,A -> offer @C,B -> offer @C',
        JSON.stringify(offers3));
  await page.evaluate(() => { window.A.huddleLeave(); window.B.huddleLeave(); window.C.huddleLeave(); });
  await sleep(300);

  // 11. The client-side ICE cache must expire — relay credentials are short-lived
  const iceCache = await page.evaluate(async () => {
    window.__iceCalls = 0;
    window.A.state().ice = null; window.A.state().iceUntil = 0;   // start from a cold cache
    const t0 = Date.now();
    await window.A.hdIce();
    const after1 = { calls: window.__iceCalls, untilIn: Math.round((window.A.state().iceUntil - t0) / 1000) };
    await window.A.hdIce();
    const after2 = window.__iceCalls;
    window.A.state().iceUntil = 0;          // pretend the credential aged out
    await window.A.hdIce();
    return { after1, after2, after3: window.__iceCalls };
  });
  check('a fresh ICE config is cached, not re-fetched', iceCache.after1.calls === 1 && iceCache.after2 === 1, JSON.stringify(iceCache));
  check('the cache expires 5 min before the server ttl',
        Math.abs(iceCache.after1.untilIn - 6900) <= 2, 'untilIn=' + iceCache.after1.untilIn + 's');
  check('an expired ICE config is re-fetched', iceCache.after3 === 2, 'calls=' + iceCache.after3);

  // 12. Widget chrome: drag, minimise, maximise
  await page.evaluate(() => { localStorage.removeItem('ml_huddle_ui'); });
  await page.evaluate(() => window.A.huddleStart(9, false));
  await sleep(400);
  const head = await page.evaluate(() => !!document.querySelector('#hd-bar .hd-head'));
  check('the widget has a draggable header', head);

  const dragged = await page.evaluate(async () => {
    const bar = document.getElementById('hd-bar');
    const h = bar.querySelector('.hd-head');
    const r = bar.getBoundingClientRect();
    const ev = (t, x, y) => h.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
    ev('pointerdown', r.left + 20, r.top + 8);
    ev('pointermove', 260, 180);
    ev('pointerup', 260, 180);
    await new Promise(r => setTimeout(r, 50));
    return { left: bar.style.left, top: bar.style.top, saved: localStorage.getItem('ml_huddle_ui') };
  });
  check('dragging the header moves it and the position is saved',
    dragged.left && dragged.top && /"x":\d+/.test(dragged.saved || ''), JSON.stringify(dragged));

  const offscreen = await page.evaluate(async () => {
    const bar = document.getElementById('hd-bar');
    const h = bar.querySelector('.hd-head');
    const ev = (t, x, y) => h.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 2 }));
    ev('pointerdown', 270, 190); ev('pointermove', 99999, 99999); ev('pointerup', 99999, 99999);
    await new Promise(r => setTimeout(r, 50));
    const b = bar.getBoundingClientRect();
    return { right: Math.round(b.right), bottom: Math.round(b.bottom), vw: innerWidth, vh: innerHeight };
  });
  check('it cannot be dragged off screen',
    offscreen.right <= offscreen.vw + 1 && offscreen.bottom <= offscreen.vh + 1, JSON.stringify(offscreen));

  const minned = await page.evaluate(async () => {
    document.querySelector('#hd-bar .hd-wbtn[data-act="min"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3 }));
    await new Promise(r => setTimeout(r, 60));
    const bar = document.getElementById('hd-bar');
    return { min: bar.classList.contains('min'),
             tilesHidden: getComputedStyle(bar.querySelector('.hd-tiles')).display === 'none',
             titleShown: bar.querySelector('.hd-title').textContent };
  });
  check('minimise collapses to a pill that still names the call',
    minned.min && minned.tilesHidden && /Huddle/.test(minned.titleShown), JSON.stringify(minned));

  const maxed = await page.evaluate(async () => {
    document.querySelector('#hd-bar .hd-wbtn[data-act="max"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4 }));
    await new Promise(r => setTimeout(r, 60));
    const bar = document.getElementById('hd-bar');
    const b = bar.getBoundingClientRect();
    return { max: bar.classList.contains('max'), min: bar.classList.contains('min'),
             w: Math.round(b.width), vw: innerWidth };
  });
  check('maximise fills the screen and clears minimise',
    maxed.max && !maxed.min && maxed.w > maxed.vw * 0.9, JSON.stringify(maxed));
  await page.evaluate(() => { window.A.huddleLeave(); localStorage.removeItem('ml_huddle_ui'); });
  await sleep(200);

  // 13. Connection quality buckets
  const q = await page.evaluate(() => {
    const mk = (loss, rtt, state) => window.A.hdQuality({ loss, rtt, pc: { connectionState: state || 'connected' } });
    return { good: mk(0, 0.05), fair: mk(0.05, 0.05), poorLoss: mk(0.2, 0.05),
             poorRtt: mk(0, 0.9), notConnected: mk(0, 0.05, 'connecting') };
  });
  check('quality buckets read from loss and round-trip',
    q.good === 3 && q.fair === 2 && q.poorLoss === 1 && q.poorRtt === 1 && q.notConnected === 0, JSON.stringify(q));

  // ── 14. Screen sharing where the browser cannot do it ──
  // iOS has no getDisplayMedia at all, and the TypeError that produces used to be
  // swallowed as "the picker was cancelled" — so the button did nothing, silently.
  {
    await page.evaluate(() => window.A.huddleStart(1));
    await sleep(300);
    const res = await page.evaluate(async () => {
      const md = navigator.mediaDevices;
      const real = md.getDisplayMedia;
      // getDisplayMedia is on MediaDevices.prototype, so deleting the own property
      // does nothing — shadow it to stand in for an iPhone.
      Object.defineProperty(md, 'getDisplayMedia', { value: undefined, configurable: true });
      const can = window.A.hdCanShareScreen();
      document.getElementById('hd-toast').textContent = '';
      await window.A.huddleToggleShare();
      const toast = document.getElementById('hd-toast');
      const out = { can, sharing: window.A.state().sharing, msg: toast.textContent,
                    shown: toast.style.display };
      Object.defineProperty(md, 'getDisplayMedia', { value: real, configurable: true });
      return out;
    });
    check('an unsupported browser is detected rather than assumed', res.can === false, JSON.stringify(res));
    check('and the user is told why nothing happened',
      /cannot share a screen/i.test(res.msg) && res.shown === 'block', JSON.stringify(res));
    check('sharing is not left half on', res.sharing === false, JSON.stringify(res));

    // Cancelling the picker is not a failure and must stay silent.
    const cancelled = await page.evaluate(async () => {
      const md = navigator.mediaDevices;
      const real = md.getDisplayMedia;
      Object.defineProperty(md, 'getDisplayMedia', { configurable: true,
        value: async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; } });
      document.getElementById('hd-toast').textContent = '';
      document.getElementById('hd-toast').style.display = 'none';
      await window.A.huddleToggleShare();
      const t = document.getElementById('hd-toast');
      const out = { msg: t.textContent, shown: t.style.display };
      Object.defineProperty(md, 'getDisplayMedia', { value: real, configurable: true });
      return out;
    });
    check('cancelling the picker raises no complaint about sharing',
      !/screen|share/i.test(cancelled.msg), JSON.stringify(cancelled));

    // A genuine failure is reported instead of vanishing.
    const failed = await page.evaluate(async () => {
      const md = navigator.mediaDevices;
      const real = md.getDisplayMedia;
      Object.defineProperty(md, 'getDisplayMedia', { configurable: true,
        value: async () => { const e = new Error('capture device busy'); e.name = 'NotReadableError'; throw e; } });
      document.getElementById('hd-toast').textContent = '';
      await window.A.huddleToggleShare();
      const out = document.getElementById('hd-toast').textContent;
      Object.defineProperty(md, 'getDisplayMedia', { value: real, configurable: true });
      return out;
    });
    check('a real failure surfaces its reason', /capture device busy/.test(failed), failed);
    await page.evaluate(() => window.A.huddleLeave());
    await sleep(150);
  }

  // ── 15. The frozen last frame ──
  // Stopping a share leaves the peer's <video> holding its last decoded frame. It is
  // hidden by the picture flag going false — so the flag must actually go false and
  // stay false, which the one-way latch in the stats poll did not guarantee.
  {
    await page.evaluate(() => window.A.huddleStart(1, false));
    await sleep(300);
    await page.evaluate(() => window.B.huddleJoinExisting(1));
    await page.waitForFunction(() => window.A.peers().get('B'), { timeout: 20000 }).catch(() => {});
    const frozen = await page.evaluate(async () => {
      const p = window.A.peers().get('B');
      if (!p) return { err: 'no peer' };
      // Only getStats is shadowed, so the frame counter can be moved deliberately while
      // the connection itself stays real — replacing the whole RTCPeerConnection broke
      // the signalling that arrives moments later.
      let frames = 100;
      const realGetStats = p.pc.getStats.bind(p.pc);
      p.pc.getStats = async () => new Map([['v', { type: 'inbound-rtp', kind: 'video', framesDecoded: frames }]]);
      p.stats = { lost: 0, recv: 0, frames: 0 };

      // Bob announces a screen share, and frames arrive.
      window.A.huddleOnSignal({ type: 'media', roomId: 1, from: 'B', data: { cam: false, sharing: true } });
      await window.A.hdPollStats();
      const whileSharing = p.video;

      // Bob stops. The announcement says so, but the very next poll still sees the
      // frames decoded a moment before the stop — the exact race that used to relatch.
      window.A.huddleOnSignal({ type: 'media', roomId: 1, from: 'B', data: { cam: false, sharing: false } });
      const rightAfterStop = p.video;
      frames = 140;                       // frames decoded just before the stop landed
      await window.A.hdPollStats();
      const afterPoll = p.video;

      p.pc.getStats = realGetStats;
      const tile = document.querySelector('#hd-bar [data-tile="B"]');
      return { whileSharing, rightAfterStop, afterPoll,
               videoHidden: tile ? tile.querySelector('.hd-video').style.display === 'none' : null,
               avatarShown: tile ? tile.querySelector('.hd-avatar').style.display !== 'none' : null };
    });
    check('a live screen share shows a picture', frozen.whileSharing === true, JSON.stringify(frozen));
    check('stopping the share clears the picture immediately', frozen.rightAfterStop === false, JSON.stringify(frozen));
    check('and the next stats poll does not bring the frozen frame back',
      frozen.afterPoll === false, JSON.stringify(frozen));
    check('the frozen frame is not on screen', frozen.videoHidden === true && frozen.avatarShown === true,
      JSON.stringify(frozen));
  }

  // ── 16. Faces in the tiles ──
  {
    const faces = await page.evaluate(() => {
      window.A.hdRenderBar();
      const tile = document.querySelector('#hd-bar [data-tile="B"]');
      const self = document.querySelector('#hd-bar [data-tile="__self"]');
      // Null-safe on purpose: if the tile markup regresses this should report what is
      // missing, not throw and take the whole run down with it.
      const g = el => {
        if (!el) return null;
        const f = el.querySelector('.hd-face'), i = el.querySelector('.hd-initials');
        return {
          img: f ? f.getAttribute('src') : null,
          imgShown: !!f && f.style.display !== 'none',
          initials: i ? i.textContent : null,
          initialsShown: !!i && i.style.display !== 'none',
        };
      };
      return { peer: g(tile), self: g(self),
               lookup: window.A.hdAvatarFor('B'), noPic: window.A.hdAvatarFor('C'),
               ini: window.A.hdInitialsFor('B'), selfIni: window.A.hdInitialsFor('A') };
    });
    check('a member with a picture shows it in their tile',
      faces.peer && faces.peer.imgShown && /icon-192/.test(faces.peer.img || ''), JSON.stringify(faces.peer));
    check('the avatar is read from the room list already in memory',
      faces.lookup === '/icons/icon-192.png' && faces.noPic === null, JSON.stringify(faces));
    check('someone without a picture falls back to their initials',
      faces.self && faces.self.initialsShown && faces.self.initials === 'A', JSON.stringify(faces.self));
    check('initials come from the real name', faces.ini === 'BM', faces.ini);
    check('nobody gets the old shared microphone glyph',
      !(await page.evaluate(() => !!document.querySelector('#hd-bar .hd-avatar [data-lucide="mic"]'))));
    // Both sides leave: B lingering in this room made a later join a no-op.
    await page.evaluate(() => { window.A.huddleLeave(); window.B.huddleLeave(); });
    await sleep(150);
  }

  // ── 17. One ring per invite ──
  // The invite now arrives on both the chat stream and the always-on notification
  // stream, so anyone sitting on the chat page receives it twice.
  {
    // Counting DOM mutations is unreliable — two synchronous changes arrive in one
    // observer batch. So the evidence is wiped between the two deliveries: if the
    // second one rings, it puts it back.
    const ring = await page.evaluate(async () => {
      const el = document.getElementById('hd-incoming');
      const wipe = () => { el.innerHTML = ''; el.style.display = 'none'; };
      const rang = () => el.style.display === 'block' && /Bob Marley/.test(el.textContent);

      wipe();
      const inv = { type: 'invite', roomId: 7, from: 'B', fromName: 'Bob Marley' };
      window.A.hdRingOnce(inv);                       // chat stream
      const first = rang();

      wipe();
      window.A.hdRingOnce(inv);                       // notification stream, moments later
      const second = rang();

      wipe();
      window.A.hdRingOnce({ type: 'invite', roomId: 8, from: 'B', fromName: 'Bob Marley' });
      const other = rang();
      wipe();
      return { first, second, other };
    });
    check('an invite rings', ring.first === true, JSON.stringify(ring));
    check('the same invite arriving twice does not ring twice', ring.second === false, JSON.stringify(ring));
    check('a different huddle still rings', ring.other === true, JSON.stringify(ring));
  }

  // ── 18. A candidate arriving before its description is kept, not dropped ──
  // Every signal is an independent POST and this handler is never awaited, so an ice
  // frame overtaking its offer is routine rather than exotic. It used to be swallowed
  // by a bare catch, quietly degrading that one pair while the others worked.
  {
    const ice = await page.evaluate(async () => {
      await window.A.huddleStart(5, false);
      // A peer with no remote description yet — exactly the window that loses candidates.
      const pc = new RTCPeerConnection({});
      const added = [];
      pc.addIceCandidate = async c => { added.push(c); };
      window.A.peers().set('Q', { pc, stream: new MediaStream(), name: 'Q', state: 'connecting' });
      const cand = { candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host', sdpMid: '0', sdpMLineIndex: 0 };
      await window.A.huddleOnSignal({ type: 'ice', roomId: 5, from: 'Q', data: cand });
      const entry = window.A.peers().get('Q');
      const queued = (entry.pendingIce || []).length;
      const appliedEarly = added.length;
      // Once a description exists the queue is flushed by the answer path.
      Object.defineProperty(pc, 'remoteDescription', { value: { type: 'offer' }, configurable: true });
      await window.A.huddleOnSignal({ type: 'ice', roomId: 5, from: 'Q', data: cand });
      const out = { queued, appliedEarly, appliedLater: added.length };
      window.A.peers().delete('Q'); window.A.huddleLeave();
      return out;
    });
    check('a candidate with no remote description yet is queued, not thrown away',
      ice.queued === 1 && ice.appliedEarly === 0, JSON.stringify(ice));
    check('and once there is a description candidates go straight in',
      ice.appliedLater === 1, JSON.stringify(ice));
  }
  await sleep(200);

  // ── 19. Dialling does not depend on the roster frame arriving ──
  // huddleStart already has the participant list in its join response; relying only on
  // the SSE frame meant a joiner whose stream had not finished registering never
  // dialled, and if it held the smaller key nobody dialled that pair at all. Proven by
  // withholding A's roster frame entirely — the join response has to be enough.
  {
    const dials = await page.evaluate(async () => {
      const bus = window.__bus, realInbox = bus.inbox.A;
      await window.B.huddleStart(6, false);        // B is already in the room
      await new Promise(r => setTimeout(r, 200));
      bus.inbox.A = () => {};                      // A never hears the roster broadcast
      window.__log.length = 0;
      await window.A.huddleStart(6, false);
      await new Promise(r => setTimeout(r, 500));
      const offers = window.__log.filter(l => l.includes('-> offer'));
      window.A.hdDialRoster();                     // idempotent?
      await new Promise(r => setTimeout(r, 300));
      const after = window.__log.filter(l => l.includes('-> offer'));
      bus.inbox.A = realInbox;
      const out = { offers: offers.slice(), after: after.slice(),
                    roster: window.A.state().roster.map(p => p.key) };
      window.A.huddleLeave(); window.B.huddleLeave();
      return out;
    });
    check('the join response alone is enough to dial the other side',
      dials.offers.length === 1 && dials.offers[0] === 'A -> offer @B', JSON.stringify(dials));
    check('and dialling twice does not offer twice', dials.after.length === 1, JSON.stringify(dials.after));
  }
  await sleep(300);

  // ── 20. Someone joining mid-share gets the picture ──
  // A screen share lives in its own stream and only ever reached peers through the
  // toggle, so anyone who arrived afterwards got an empty video sender while being told
  // a share was running.
  {
    const late = await page.evaluate(async () => {
      const bus = window.__bus, realInbox = bus.inbox.A;
      await window.A.huddleStart(7, false);
      await new Promise(r => setTimeout(r, 150));
      bus.inbox.A = () => {};                      // keep the roster stable under us
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
      const fake = canvas.captureStream(1);
      window.A.state().screen = fake;
      window.A.state().sharing = true;
      window.A.state().roster = [{ key: 'A', name: 'A' }, { key: 'Y', name: 'Y' }];
      window.A.hdDialRoster();
      await new Promise(r => setTimeout(r, 400));
      const p = window.A.peers().get('Y');
      const senders = p ? p.pc.getSenders().filter(x => x.track && x.track.kind === 'video') : [];
      const out = { hasPeer: !!p, videoSenders: senders.length,
                    sendingScreen: senders.some(x => x.track === fake.getVideoTracks()[0]) };
      bus.inbox.A = realInbox;
      window.A.state().sharing = false; window.A.state().screen = null;
      window.A.huddleLeave();
      return out;
    });
    check('a peer created during a share is sent the shared screen',
      late.hasPeer && late.videoSenders === 1 && late.sendingScreen, JSON.stringify(late));
  }
  await sleep(300);

  // ── 21. The load algorithm is never re-run on a live element ──
  // In an audio-only call ontrack fires twice (mic, then the reserved video
  // transceiver's track). Re-assigning srcObject on the second one re-runs the
  // media load algorithm, which rejects the pending play() with AbortError — and
  // the old code reported that self-inflicted AbortError as "your browser
  // blocked the sound" on every single call.
  {
    const r1 = await page.evaluate(async () => {
      // Count srcObject assignments per element, and record every toast.
      const proto = HTMLMediaElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'srcObject');
      Object.defineProperty(proto, 'srcObject', {
        configurable: true,
        get: desc.get,
        // Only an IDENTICAL re-assign is the defect — it re-runs the load
        // algorithm for nothing and aborts the pending play(). (The harness's
        // shared #hd-bar makes both clients alternate their own self-tile
        // stream, so counting every assignment would flag a harness artifact.)
        set(v) { if (v && desc.get.call(this) === v) this.__srcSets = (this.__srcSets || 0) + 1; return desc.set.call(this, v); },
      });
      const toasts = [];
      const toastEl = document.getElementById('hd-toast');
      const mo = new MutationObserver(() => { if (toastEl.textContent) toasts.push(toastEl.textContent); });
      mo.observe(toastEl, { childList: true, characterData: true, subtree: true });

      await window.A.huddleStart(8, false);
      await new Promise(r => setTimeout(r, 150));
      await window.B.huddleStart(8, false);
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        const a = window.A.peers().get('B');
        if (a && a.pc.connectionState === 'connected') break;
        await new Promise(r => setTimeout(r, 200));
      }
      // Let several renders and both ontrack firings go by.
      await new Promise(r => setTimeout(r, 1200));
      window.A.hdRenderBar(); window.B.hdRenderBar();
      await new Promise(r => setTimeout(r, 300));
      const counts = [...document.querySelectorAll('#hd-bar [data-tile] video, .hd-audio-sink audio')]
        .map(el => ({ tag: el.tagName, peer: el.dataset.peer || el.closest('[data-tile]')?.getAttribute('data-tile'), sets: el.__srcSets || 0 }));
      mo.disconnect();
      Object.defineProperty(proto, 'srcObject', desc);
      const out = { counts, blockedToasts: toasts.filter(t => /blocked the sound/i.test(t)) };
      window.A.huddleLeave(); window.B.huddleLeave();
      return out;
    });
    const overSet = r1.counts.filter(c => c.sets > 0);
    check('no live element ever has its srcObject re-assigned with the same object', overSet.length === 0, JSON.stringify(r1.counts));
    check('a healthy call raises NO "blocked the sound" toast', r1.blockedToasts.length === 0, JSON.stringify(r1.blockedToasts));
  }
  await sleep(300);

  // ── 22. The gesture retry survives a failed attempt ──
  // The old handler unhooked itself unconditionally and swallowed the retry's own
  // rejection: the user's one click burned the only recovery path, and the call
  // stayed silent for good. Now it stays armed until something actually plays.
  {
    const r3 = await page.evaluate(async () => {
      // A sink element for the retry to find.
      const sink = document.createElement('div');
      sink.className = 'hd-audio-sink';
      const au = document.createElement('audio');
      sink.appendChild(au); document.body.appendChild(sink);
      const orig = HTMLMediaElement.prototype.play;
      let fail = true, plays = 0;
      HTMLMediaElement.prototype.play = function () {
        if (fail) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
        plays++; return Promise.resolve();
      };
      window.A.hdAudioBlocked();                       // arm the recovery
      document.dispatchEvent(new Event('click'));      // gesture #1 — retry FAILS
      await new Promise(r => setTimeout(r, 120));
      fail = false;                                    // browser would now allow it
      document.dispatchEvent(new Event('click'));      // gesture #2 — must still be armed
      await new Promise(r => setTimeout(r, 120));
      HTMLMediaElement.prototype.play = orig;
      sink.remove();
      return { plays };
    });
    check('a failed gesture retry stays armed for the next gesture', r3.plays > 0, JSON.stringify(r3));
  }
  await sleep(200);

  // ── 23. A lost offer is re-sent — the pair is no longer stranded forever ──
  // Signalling rides the chat SSE stream with no server-side queue; a frame sent
  // during a reconnect gap is simply gone. Dialling being idempotent (the glare
  // rule) meant one lost offer parked the pair at "connecting" for good.
  {
    const r4 = await page.evaluate(async () => {
      const bus = window.__bus, realB = bus.inbox.B;
      let dropped = 0;
      bus.inbox.B = m => { if (m.type === 'offer' && dropped < 1) { dropped++; return; } realB(m); };
      await window.B.huddleStart(9, false);
      await new Promise(r => setTimeout(r, 150));
      window.__log.length = 0;
      await window.A.huddleStart(9, false);           // A offers; the offer is eaten
      await new Promise(r => setTimeout(r, 400));
      const before = window.__log.filter(l => l === 'A -> offer @B').length;
      // Two watchdog ticks (it retries on the second) — the stats poll hosts it.
      await window.A.hdPollStats(); await window.A.hdPollStats();
      const t0 = Date.now();
      while (Date.now() - t0 < 10000) {
        const p = window.A.peers().get('B');
        if (p && p.pc.remoteDescription) break;
        await new Promise(r => setTimeout(r, 200));
      }
      const after = window.__log.filter(l => l === 'A -> offer @B').length;
      const p = window.A.peers().get('B');
      const out = { dropped, before, after, gotAnswer: !!(p && p.pc.remoteDescription) };
      bus.inbox.B = realB;
      window.A.huddleLeave(); window.B.huddleLeave();
      return out;
    });
    check('the first offer was dropped and only one was sent initially',
      r4.dropped === 1 && r4.before === 1, JSON.stringify(r4));
    check('the watchdog re-offers and the pair recovers', r4.after >= 2 && r4.gotAnswer, JSON.stringify(r4));
  }
  await sleep(200);

  // ── 24. How long has this been going, and is it still going ─────────────────
  // Two reports in one: a huddle with no clock, and a refresh that made the call
  // vanish from the page while it was still running for everybody else.
  {
    const r5 = await page.evaluate(async () => {
      window.__hdStarted = Date.now() - 125000;          // 2:05 ago
      await window.A.huddleStart(1, false);
      await new Promise(r => setTimeout(r, 300));
      const clock = document.querySelector('#hd-bar .hd-clock');
      const shown = clock ? clock.textContent.trim() : null;
      // The duration is the HUDDLE's, not "since I joined" — B arrives late and
      // must read the same number.
      await window.B.huddleStart(1, false);
      await new Promise(r => setTimeout(r, 300));
      const bSees = window.B.state().startedAt;
      const same = bSees === window.__hdStarted;
      const fmt = window.A.hdElapsed(Date.now() - 3725000);   // 1:02:05
      // Now the refresh: A's page is gone, the huddle is not.
      window.A.huddleLeave();
      const gone = !!document.querySelector('#hd-bar .hd-clock');
      // A real reload starts with nothing on screen and no roster frame coming:
      // the page has to ASK. Clearing the chip first is what makes this a test of
      // the boot check rather than of the broadcast that happened to precede it.
      await new Promise(r => setTimeout(r, 60));
      document.getElementById('hd-join-chip').style.display = 'none';
      document.getElementById('hd-join-chip').innerHTML = '';
      await window.A.hdBootLive();
      await new Promise(r => setTimeout(r, 250));
      const chip = document.getElementById('hd-join-chip');
      const chipText = chip ? chip.textContent.replace(/\s+/g, ' ').trim() : '';
      const chipShown = !!chip && chip.style.display === 'flex';
      const rejoinable = !!chip.querySelector('.hd-chip-btn');
      window.B.huddleLeave();
      return { shown, same, fmt, gone, chipText, chipShown, rejoinable };
    });
    check('the huddle bar shows a running clock', /^\d+:\d\d$/.test(String(r5.shown)), String(r5.shown));
    check('…reading about two minutes in, not zero',
      /^(2:0[4-9]|2:1\d)$/.test(String(r5.shown)), String(r5.shown));
    check('…the same duration for somebody who joined late', r5.same === true);
    check('…and hours are formatted, not counted in minutes', r5.fmt === '1:02:05', r5.fmt);
    check('after a reload the still-running huddle is offered back',
      r5.chipShown === true && r5.rejoinable === true && /Huddle in/.test(r5.chipText), JSON.stringify(r5.chipText));
    check('…with how long it has been running', /\d+:\d\d/.test(r5.chipText), r5.chipText);
  }
  await sleep(150);

  // ── 25–32. Keeping a call up: the "connectivity issues" report ───────────────
  // Every one of these used to strand a pair on "connecting" or hang up on people
  // who were still there. The helpers live inside each evaluate: the page script is
  // a template literal, where a regex's backslashes would not survive.

  // 25. A pair that drops is restarted, not abandoned. Only the smaller key offers,
  //     so the other side asks it to.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const conn = async (pairs, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pairs.every(([c, k]) => { const p = c.peers().get(k); return p && p.pc.connectionState === 'connected'; })) return true; await wait(150); } return false; };
      const ufrag = pc => (((pc.localDescription && pc.localDescription.sdp) || '').match(/a=ice-ufrag:(\S+)/) || [])[1];
      await window.A.huddleStart(21, false); await window.B.huddleStart(21, false);
      const up = await conn([[window.A, 'B'], [window.B, 'A']]);
      const pa = window.A.peers().get('B'); const before = ufrag(pa.pc);
      window.__log.length = 0;
      await window.B.hdRestart('A');
      let after = before; const t0 = Date.now();
      while (Date.now() - t0 < 8000) { after = ufrag(pa.pc); if (after !== before && pa.pc.signalingState === 'stable') break; await wait(150); }
      const asked = window.__log.includes('B -> restart @A');
      const reoffered = window.__log.includes('A -> offer @B');
      const same = window.A.peers().get('B') === pa;
      const still = await conn([[window.A, 'B'], [window.B, 'A']], 8000);
      // Bounded: a peer that is really gone is not restarted forever, and we say so.
      document.getElementById('hd-toast').textContent = '';
      for (let i = 0; i < 4; i++) await window.A.hdRestart('B');
      const toast = document.getElementById('hd-toast').textContent;
      window.A.huddleLeave(); window.B.huddleLeave();
      return { up, asked, reoffered, before, after, same, still, toast };
    });
    check('the answering side can ask for an ICE restart', r.up && r.asked && r.reoffered, JSON.stringify(r));
    check('…which the offerer runs on the same connection', r.same && !!r.before && !!r.after && r.before !== r.after, JSON.stringify(r));
    check('…and the pair is connected again', r.still, JSON.stringify(r));
    check('restarts are bounded, and the person is told', /Bob Marley/.test(r.toast), r.toast);
  }
  await sleep(250);

  // 26. A page that dies without leaving (crash, killed app) and comes back. Its old
  //     connection is dead whatever its state says; the session id gives it away.
  for (const [who, other, room] of [['B', 'A', 22], ['A', 'B', 23]]) {
    const r = await page.evaluate(async (who, other, room) => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const conn = async (pairs, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pairs.every(([c, k]) => { const p = c.peers().get(k); return p && p.pc.connectionState === 'connected'; })) return true; await wait(150); } return false; };
      const W = window[who], O = window[other];
      await O.huddleStart(room, false); await W.huddleStart(room, false);
      const up = await conn([[O, who], [W, other]]);
      const old = O.peers().get(who);
      W.hdTeardown();                       // the page is gone; no leave was sent
      await wait(100);
      await W.huddleStart(room, false);     // reloaded, joins again with a new session
      const back = await conn([[O, who], [W, other]]);
      const now = O.peers().get(who);
      const out = { up, back, replaced: !!now && now !== old, oldClosed: old.pc.signalingState === 'closed', sidChanged: !!now && now.sid !== old.sid };
      O.huddleLeave(); W.huddleLeave();
      return out;
    }, who, other, room);
    check(`${who === 'B' ? 'the answering' : 'the offering'} side reloads mid-call: the other drops the dead connection`,
      r.up && r.replaced && r.oldClosed && r.sidChanged, JSON.stringify(r));
    check('…and the two reconnect without anyone leaving', r.back, JSON.stringify(r));
    await sleep(250);
  }

  // 27. The server restarts mid-call (a deploy). It forgets every roster while the
  //     calls, peer to peer, carry on. The first person back used to look like the
  //     only one left, and everybody else hung up on everybody.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const conn = async (pairs, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pairs.every(([c, k]) => { const p = c.peers().get(k); return p && p.pc.connectionState === 'connected'; })) return true; await wait(150); } return false; };
      const bus = window.__bus;
      await window.A.huddleStart(24, false); await window.B.huddleStart(24, false);
      const up = await conn([[window.A, 'B'], [window.B, 'A']]);
      const pa = window.A.peers().get('B'), pb = window.B.peers().get('A');
      bus.rosters[24] = new Set(); bus.sids[24] = {}; bus.boot = 'b2';
      await window.B.huddleOnStreamOpen();   // B's stream is back first, and rejoins
      await wait(600);
      const out = {
        up,
        kept: window.A.peers().get('B') === pa && window.B.peers().get('A') === pb,
        both: bus.rosters[24].has('A') && bus.rosters[24].has('B'),
        boots: [window.A.state().boot, window.B.state().boot],
        still: await conn([[window.A, 'B'], [window.B, 'A']], 5000),
      };
      window.A.huddleLeave(); window.B.huddleLeave();
      return out;
    });
    check('after a server restart nobody is hung up on', r.up && r.kept && r.still, JSON.stringify(r));
    check('…and everyone is back on the new roster', r.both && r.boots.join() === 'b2,b2', JSON.stringify(r));
  }
  await sleep(250);

  // 28. The server sweeps a tab it hasn't heard from (asleep, throttled). Its call
  //     still works, so the others keep it, and it gets itself back on the roster.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const conn = async (pairs, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pairs.every(([c, k]) => { const p = c.peers().get(k); return p && p.pc.connectionState === 'connected'; })) return true; await wait(150); } return false; };
      const bus = window.__bus;
      await window.A.huddleStart(25, false); await window.B.huddleStart(25, false);
      const up = await conn([[window.A, 'B'], [window.B, 'A']]);
      const pa = window.A.peers().get('B');
      bus.rosters[25].delete('B'); delete bus.sids[25].B;
      const participants = [{ key: 'A', name: 'A', sid: bus.sids[25].A }];
      ['A', 'B'].forEach(k => bus.inbox[k]({ type: 'roster', roomId: 25, boot: bus.boot, participants, started_at: Date.now(), left: 'B', swept: true }));
      await wait(600);
      const out = { up, kept: window.A.peers().get('B') === pa, back: bus.rosters[25].has('B'), still: await conn([[window.A, 'B'], [window.B, 'A']], 3000) };
      // The 'alive' ping is what catches it when no roster frame does.
      bus.rosters[25].delete('B');
      window.__log.length = 0;
      await window.B.hdAlive();
      await wait(200);
      out.pingRejoined = bus.rosters[25].has('B') && window.__log.includes('B -> join');
      window.A.huddleLeave(); window.B.huddleLeave();
      return out;
    });
    check('a swept tab whose call still works is not hung up on', r.up && r.kept && r.still, JSON.stringify(r));
    check('…and it rejoins the roster by itself', r.back, JSON.stringify(r));
    check('…as it does when its own ping says it was dropped', r.pingRejoined, JSON.stringify(r));
  }
  await sleep(250);

  // 29. One side hung up on the pair and the other didn't notice. The stale end's
  //     ICE restart reaches a brand-new connection with a different certificate.
  //     Chromium renegotiates onto it; Firefox and Safari refuse, and the pair has
  //     to start afresh at both ends. 'strict' plays the refusing browser.
  for (const [quitter, keeper, room, strict] of [['B', 'A', 26, false], ['A', 'B', 27, false], ['B', 'A', 29, true], ['A', 'B', 30, true]]) {
    const r = await page.evaluate(async (quitter, keeper, room, strict) => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const conn = async (pairs, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pairs.every(([c, k]) => { const p = c.peers().get(k); return p && p.pc.connectionState === 'connected'; })) return true; await wait(150); } return false; };
      const fp = sdp => ((sdp || '').match(/a=fingerprint:\S+ (\S+)/) || [])[1];
      const orig = RTCPeerConnection.prototype.setRemoteDescription;
      let refused = 0;
      if (strict) RTCPeerConnection.prototype.setRemoteDescription = function (d) {
        const cur = this.remoteDescription && fp(this.remoteDescription.sdp);
        if (cur && d && d.sdp && fp(d.sdp) !== cur) { refused++; return Promise.reject(new DOMException('remote certificate changed', 'InvalidAccessError')); }
        return orig.apply(this, arguments);
      };
      const Q = window[quitter], K = window[keeper];
      try {
        await window.A.huddleStart(room, false); await window.B.huddleStart(room, false);
        const up = await conn([[window.A, 'B'], [window.B, 'A']]);
        const gone = Q.peers().get(keeper); gone.pc.close(); Q.peers().delete(keeper);
        await K.hdRestart(quitter);           // the keeper notices its pair failing
        const back = await conn([[window.A, 'B'], [window.B, 'A']], 15000);
        return { up, back, refused };
      } finally {
        RTCPeerConnection.prototype.setRemoteDescription = orig;
        window.A.huddleLeave(); window.B.huddleLeave();
      }
    }, quitter, keeper, room, strict);
    check(`${quitter === 'B' ? 'the answering' : 'the offering'} side dropped the pair alone: it comes back${strict ? ' (strict browser)' : ''}`,
      r.up && r.back && (!strict || r.refused > 0), JSON.stringify(r));
    await sleep(250);
  }

  // 30. Only starting a huddle rings the room. Joining one already running used to
  //     ring everyone again, people already in the call included. (Pressing Start
  //     still rings; the server skips whoever it knows is already in the call.)
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      window.__log.length = 0;
      await window.A.huddleStart(1, false); await wait(100);
      await window.B.huddleJoinExisting(1); await wait(100);   // the chip, the ring's Join, the calendar
      const out = { a: window.__log.filter(l => l.startsWith('A -> invite')), b: window.__log.filter(l => l.startsWith('B -> invite')) };
      window.A.huddleLeave(); window.B.huddleLeave();
      document.getElementById('hd-incoming').style.display = 'none';
      return out;
    });
    check('starting a huddle rings the rest of the room', r.a.length === 2, JSON.stringify(r));
    check('joining a running one rings nobody', r.b.length === 0, JSON.stringify(r));
  }
  await sleep(250);

  // 31. The transport: frames remember where they were, for the server's replay.
  {
    const r = await page.evaluate(() => {
      const before = window.A.hdStreamQuery();
      window.A.huddleOnStreamFrame({ lastEventId: 'k3x.42', data: JSON.stringify({ type: 'media', roomId: 99, from: 'Z' }) });
      window.A.huddleOnStreamFrame({ data: 'not json' });
      return { before, after: window.A.hdStreamQuery() };
    });
    check('a rebuilt stream asks for what it missed since the last frame',
      r.before === '&hd=2' && r.after === '&hd=2&hs=k3x.42', JSON.stringify(r));
  }

  // 32. Closing the tab leaves the call at once, by beacon — no Leave click needed.
  {
    const r = await page.evaluate(async () => {
      const sent = [];
      const real = navigator.sendBeacon;
      Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (url, body) => { sent.push({ url, body }); return true; } });
      await window.A.huddleStart(28, false);
      const mic = window.A.state().local.getAudioTracks()[0];
      window.A.hdLeaveOnUnload();
      Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: real });
      window.__bus.rosters[28].delete('A');
      const body = sent[0] ? JSON.parse(await sent[0].body.text()) : null;
      return { n: sent.length, url: sent[0] && sent[0].url, body, out: window.A.state().roomId === null, micOff: mic.readyState === 'ended' };
    });
    check('closing the tab sends a leave beacon, authorised in the URL',
      r.n === 1 && r.url === '/api/x/chat/huddle/signal?_t=tok-A' && r.body && r.body.type === 'leave' && r.body.roomId === 28, JSON.stringify(r));
    check('…and releases the microphone', r.out && r.micOff, JSON.stringify(r));
  }
  await sleep(150);

  // 33. The same person on a second device joins the call they are already in. The
  //     server keeps one place per person and their offers reach every tab, so two
  //     copies used to answer each other's calls and fight over the place for good.
  //     The newer copy takes the call; the older one hangs up quietly.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const conn = async (pairs, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pairs.every(([c, k]) => { const p = c.peers().get(k); return p && p.pc.connectionState === 'connected'; })) return true; await wait(150); } return false; };
      const bus = window.__bus, realB = bus.inbox.B;
      bus.inbox.B = m => { realB(m); window.B2.huddleOnSignal(m); };   // both devices hear B's frames
      try {
        await window.A.huddleStart(31, false); await window.B.huddleStart(31, false);
        const up = await conn([[window.A, 'B'], [window.B, 'A']]);
        document.getElementById('hd-toast').textContent = '';
        await window.B2.huddleStart(31, false, true);
        const moved = await conn([[window.A, 'B'], [window.B2, 'A']]);
        await wait(300);
        const out = {
          up, moved,
          oldOut: window.B.state().roomId === null,
          toast: document.getElementById('hd-toast').textContent,
          stillB2: window.A.peers().get('B') && window.A.peers().get('B').sid === window.B2.state().sid,
        };
        // The old device's page closes later: its beacon must not end the new one's call.
        window.__log.length = 0;
        await window.B.huddleStart(31, false, true);           // (only to give it a sid to leave with)
        await wait(200);
        const tookBack = await conn([[window.A, 'B'], [window.B, 'A']]);
        out.b2SteppedAside = window.B2.state().roomId === null;
        window.B.huddleLeave();
        await wait(200);
        out.after = [...(bus.rosters[31] || [])];
        return { ...out, tookBack };
      } finally {
        bus.inbox.B = realB;
        window.A.huddleLeave(); window.B.huddleLeave(); window.B2.huddleLeave();
      }
    });
    check('joining from a second device moves the call there', r.up && r.moved && r.stillB2, JSON.stringify(r));
    check('…and the first device hangs up, and says why', r.oldOut && /somewhere else/.test(r.toast), JSON.stringify(r));
    check('…and back again, without the two fighting over it', r.tookBack && r.b2SteppedAside, JSON.stringify(r));
  }
  await sleep(250);

  // 34. Two answers to one offer handled at once (frames are not awaited one by one).
  //     The second meets a connection the first already settled; it must be dropped as
  //     a duplicate, not taken for a mismatch that tears the working pair down.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const conn = async (pairs, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pairs.every(([c, k]) => { const p = c.peers().get(k); return p && p.pc.connectionState === 'connected'; })) return true; await wait(150); } return false; };
      const bus = window.__bus, realA = bus.inbox.A;
      bus.inbox.A = m => { realA(m); if (m.type === 'answer') realA(m); };   // every answer twice, back to back
      try {
        window.__log.length = 0;
        await window.A.huddleStart(32, false); await window.B.huddleStart(32, false);
        const up = await conn([[window.A, 'B'], [window.B, 'A']]);
        const pa = window.A.peers().get('B');
        await wait(1500);
        // One offer: the pair was never rebuilt. (It would be within milliseconds of
        // the first answer, before 'connected' — so count, don't compare objects.)
        const offers = window.__log.filter(l => l === 'A -> offer @B').length;
        return { up, offers, same: window.A.peers().get('B') === pa, open: pa.pc.signalingState !== 'closed' };
      } finally {
        bus.inbox.A = realA;
        window.A.huddleLeave(); window.B.huddleLeave();
      }
    });
    check('a duplicate answer does not tear down the pair it belongs to', r.up && r.offers === 1 && r.same && r.open, JSON.stringify(r));
  }
  await sleep(250);

  // 35. A pair that dropped and used up its restarts is still retried, so it comes
  //     back once the network does, instead of sitting failed for the rest of the call.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      await window.A.huddleStart(33, false); await window.B.huddleStart(33, false);
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) { const p = window.A.peers().get('B'); if (p && p.pc.connectionState === 'connected') break; await wait(150); }
      const p = window.A.peers().get('B');
      // Pretend the network died: the pair reports 'failed' and the budget is spent.
      Object.defineProperty(p.pc, 'connectionState', { configurable: true, get: () => 'failed' });
      p.restarts = [Date.now() - 59000, Date.now() - 59000, Date.now() - 59000];
      window.__log.length = 0;
      for (let i = 0; i < 4; i++) await window.A.hdPollStats();   // four ticks of a dead pair…
      await wait(1500);                                            // …the oldest restarts age out…
      await window.A.hdPollStats();                                // …and the fifth tick retries
      await wait(1000);
      const offers = window.__log.filter(l => l === 'A -> offer @B').length;
      delete p.pc.connectionState;
      window.A.huddleLeave(); window.B.huddleLeave();
      return { offers };
    });
    check('a failed pair past its restart budget is retried, not abandoned', r.offers >= 1, JSON.stringify(r));
  }
  await sleep(150);

  // 36. Speaking for a peer on the previous bundle, which can't ping: the 15-second
  //     'alive' says who we have a working connection to.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      await window.A.huddleStart(34, false); await window.B.huddleStart(34, false);
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) { const p = window.A.peers().get('B'); if (p && p.pc.connectionState === 'connected') break; await wait(150); }
      window.__alive = [];
      await window.A.hdAlive();
      const sent = (window.__alive || []).find(a => a.key === 'A');
      window.A.huddleLeave(); window.B.huddleLeave();
      return { sent };
    });
    check("the 15-second ping reports who we're connected to",
      r.sent && r.sent.data && Array.isArray(r.sent.data.connected) && r.sent.data.connected.join() === 'B', JSON.stringify(r));
  }
  await sleep(150);

  // 37. Our own entry with no sid is a tab on the previous bundle — usually this very
  //     tab before its reload. It must not hide the Join chip the way our entry from
  //     another current tab does.
  {
    const r = await page.evaluate(() => {
      const chip = document.getElementById('hd-join-chip');
      chip.style.display = 'none';
      window.C.huddleOnSignal({ type: 'roster', roomId: 1, participants: [{ key: 'A', name: 'A', sid: 'a1' }, { key: 'C', name: 'C' }], started_at: Date.now() });
      const oldSelf = chip.style.display;
      window.C.huddleOnSignal({ type: 'roster', roomId: 1, participants: [{ key: 'A', name: 'A', sid: 'a1' }, { key: 'C', name: 'C', sid: 'c9' }], started_at: Date.now() });
      const otherTab = chip.style.display;
      chip.style.display = 'none';
      return { oldSelf, otherTab };
    });
    check('our own entry from an old-bundle tab still offers the call here', r.oldSelf === 'flex', JSON.stringify(r));
    check('…while our entry from another current tab hides it', r.otherTab === 'none', JSON.stringify(r));
  }

  // 38. "This page is not responding" on coming back to a tab in a call. The 3-second
  //     stats tick rebuilt the controls on every render — five new icons to draw —
  //     and queued an icon pass each time; a hidden tab keeps every queued frame
  //     callback and ran them all on its return, each one redrawing every icon on
  //     the page. Now: the controls are rebuilt only when they change, one icon pass
  //     at most is queued, and a hidden tab isn't rendered at all until it is shown.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      window.__iconCalls = 0;
      window.lucide = { createIcons() { window.__iconCalls++; } };
      try {
        await window.A.huddleStart(40, false); await window.B.huddleStart(40, false);
        const t0 = Date.now();
        while (Date.now() - t0 < 15000) { const p = window.A.peers().get('B'); if (p && p.pc.connectionState === 'connected') break; await wait(150); }
        await wait(100);
        const micBtn = () => document.querySelectorAll('#hd-bar .hd-controls .hd-btn')[0];
        const out = {};
        // Steady state: the tick renders, the controls stay as they are.
        const btn = micBtn();
        window.__iconCalls = 0;
        for (let i = 0; i < 5; i++) await window.A.hdPollStats();
        await new Promise(res => requestAnimationFrame(() => res()));
        out.sameButton = micBtn() === btn;
        out.iconsOnTicks = window.__iconCalls;
        // A real change rebuilds them; many renders before a frame queue one pass.
        window.__iconCalls = 0;
        window.A.huddleToggleMute(); window.A.hdRenderBar(); window.A.hdRenderBar(); window.A.huddleToggleMute(); window.A.hdRenderBar();
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));
        out.rebuilt = micBtn() !== btn;
        out.iconsOnChange = window.__iconCalls;
        // Hidden: the tick leaves the bar alone; shown again, it is brought up to date.
        const title = document.querySelector('#hd-bar .hd-title');
        title.textContent = 'stale';
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        await window.A.hdPollStats();
        out.hiddenTitle = title.textContent;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        out.shownTitle = title.textContent;
        return out;
      } finally {
        delete document.hidden;
        delete window.lucide;
        window.A.huddleLeave(); window.B.huddleLeave();
      }
    });
    check('a steady call does not rebuild the controls every 3 s', r.sameButton && r.iconsOnTicks === 0, JSON.stringify(r));
    check('a real change rebuilds them, with one icon pass for many renders', r.rebuilt && r.iconsOnChange === 1, JSON.stringify(r));
    check('a hidden tab is not re-rendered by the tick', r.hiddenTitle === 'stale', JSON.stringify(r));
    check('…and is brought up to date when shown again', r.shownTitle !== 'stale' && /^Huddle\b.*\b2$/.test(r.shownTitle), JSON.stringify(r));
  }
  await sleep(150);

  // 39. Someone moves their call from this page to a tab still on the previous bundle,
  //     which takes the place without a sid — invisible to our own superseded check.
  //     The server names the page the join displaced, answers that page's ping with a
  //     sid that isn't its own, and answers its rejoin as held by someone else: each
  //     makes it step aside. A roster merely listing our key without a sid is not
  //     enough on its own; it may date from before our join.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const bus = window.__bus;
      const toast = () => document.getElementById('hd-toast').textContent;
      const reset = () => { window.__hook = null; window.A.huddleLeave(); window.B.huddleLeave(); bus.rosters[41] = new Set(); bus.sids[41] = {}; };
      const inCall = async () => { reset(); await window.A.huddleStart(41, false); await window.B.huddleStart(41, false); await wait(200); document.getElementById('hd-toast').textContent = ''; };
      const out = {};
      try {
        await inCall();
        const listedBare = () => [{ key: 'A', name: 'A', sid: window.A.state().sid }, { key: 'B', name: 'B' }];
        window.B.huddleOnSignal({ type: 'roster', roomId: 41, boot: bus.boot, participants: listedBare() });
        await wait(50);
        out.stays = window.B.state().roomId === 41;
        window.B.huddleOnSignal({ type: 'roster', roomId: 41, boot: bus.boot, participants: listedBare(), joined: 'B', displaced: window.B.state().sid });
        await wait(50);
        out.byFrame = window.B.state().roomId === null && /somewhere else/.test(toast());

        await inCall();
        window.__hook = (key, body) => key === 'B' && body.type === 'alive' ? { ok: true, inCall: true, boot: bus.boot, sid: 'elsewhere' } : null;
        await window.B.hdAlive();
        out.byPing = window.B.state().roomId === null && /somewhere else/.test(toast());

        // Its stream reopens and the roster lists it without its sid, so it rejoins;
        // the server answers with the place held by someone else.
        await inCall();
        delete bus.sids[41].B;
        window.__hook = (key, body) => key === 'B' && body.type === 'join'
          ? { ok: true, superseded: true, boot: bus.boot, participants: [{ key: 'A', name: 'A' }, { key: 'B', name: 'B', sid: 'elsewhere' }] } : null;
        window.__log.length = 0;
        await window.B.huddleOnStreamOpen();
        out.byRejoin = window.__log.includes('B -> join') && window.B.state().roomId === null && /somewhere else/.test(toast());
        return out;
      } finally { reset(); }
    });
    check('a roster listing our key without a sid is no reason to leave by itself', r.stays, JSON.stringify(r));
    check('the frame of a join that took our place makes this page step aside', r.byFrame, JSON.stringify(r));
    check('…as does a ping answered with a sid that is not ours', r.byPing, JSON.stringify(r));
    check('…and a rejoin answered with the place held by someone else', r.byRejoin, JSON.stringify(r));
  }
  await sleep(150);

  // 40. A peer on the previous bundle that the server dropped as unreachable. That
  //     bundle hears signalling only on its Chat page and can't rejoin by itself, so
  //     the drop was final: we hung up on the pair and stopped offering. Now our end is
  //     kept, out of sight, and offered on; when it answers, it is back on screen and
  //     in our ping — which is what puts it back in the call on the server.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const bus = window.__bus, realC = bus.inbox.C;
      const self = () => ({ key: 'A', name: 'A', sid: window.A.state().sid });
      const out = {};
      // C stands in for the previous bundle: it joins without a sid.
      window.__hook = (key, body) => { if (key === 'C' && body.type === 'join' && body.data) delete body.data.sid; return null; };
      try {
        await window.A.huddleStart(42, false);
        bus.inbox.C = () => {};                                   // on another page: deaf
        await window.C.huddleStart(42, false, true);
        await wait(300);
        const p = window.A.peers().get('C');
        out.dialled = !!p && !p.sid && p.pc.connectionState !== 'connected';
        bus.rosters[42].delete('C');                              // the server gives up on it
        await window.A.huddleOnSignal({ type: 'roster', roomId: 42, boot: bus.boot, participants: [self()], left: 'C', swept: true });
        window.A.hdRenderBar();
        out.kept = window.A.peers().get('C') === p && !!p.keptAt;
        out.hidden = !document.querySelector('#hd-bar [data-tile="C"]') && /\b1$/.test(document.querySelector('#hd-bar .hd-title').textContent);
        window.__log.length = 0; p.restarts = [];
        for (let i = 0; i < 8; i++) await window.A.hdPollStats();
        out.stillKept = window.A.peers().get('C') === p;
        out.reoffered = window.__log.filter(l => l === 'A -> offer @C').length;
        bus.inbox.C = realC;                                      // back on its Chat page
        const t0 = Date.now();
        while (Date.now() - t0 < 15000 && p.pc.connectionState !== 'connected') { p.restarts = []; await window.A.hdPollStats(); await wait(300); }
        out.connected = p.pc.connectionState === 'connected';
        window.A.hdRenderBar();
        out.shown = !!document.querySelector('#hd-bar [data-tile="C"]');
        window.__alive = [];
        await window.A.hdAlive();
        const sent = window.__alive.find(a => a.key === 'A');
        out.reported = !!sent && sent.data.connected.includes('C');
        await window.A.huddleOnSignal({ type: 'roster', roomId: 42, boot: bus.boot, participants: [self(), { key: 'C', name: 'C' }] });
        out.ordinary = window.A.peers().get('C') === p && !p.keptAt;
        return out;
      } finally {
        window.__hook = null; bus.inbox.C = realC;
        window.A.huddleLeave(); window.C.huddleLeave();
      }
    });
    check('a dropped peer on the previous bundle keeps its pair, out of sight', r.dialled && r.kept && r.hidden, JSON.stringify(r));
    check('…which is offered to on every tick that would offer', r.stillKept && r.reoffered >= 1, JSON.stringify(r));
    check('…and once it answers, is back on screen and in our ping', r.connected && r.shown && r.reported, JSON.stringify(r));
    check('…and an ordinary peer again once the server lists it', r.ordinary, JSON.stringify(r));
  }
  await sleep(150);

  // 41. …but only for a while, and only for the previous bundle: a peer on this bundle
  //     rejoins by itself when it wakes, and one that pressed Leave has left.
  {
    const r = await page.evaluate(async () => {
      const wait = ms => new Promise(res => setTimeout(res, ms));
      const bus = window.__bus, realB = bus.inbox.B, realC = bus.inbox.C;
      const listed = () => [...bus.rosters[43]].map(k => ({ key: k, name: k, sid: bus.sids[43][k] }));
      const out = {};
      window.__hook = (key, body) => { if (key === 'C' && body.type === 'join' && body.data) delete body.data.sid; return null; };
      try {
        await window.A.huddleStart(43, false);
        bus.inbox.B = () => {}; bus.inbox.C = () => {};
        await window.B.huddleStart(43, false, true);
        await window.C.huddleStart(43, false, true);
        await wait(300);
        const pc = window.A.peers().get('C');
        out.dialled = window.A.peers().has('B') && !!pc;
        bus.rosters[43].delete('B');
        await window.A.huddleOnSignal({ type: 'roster', roomId: 43, boot: bus.boot, participants: listed(), left: 'B', swept: true });
        out.sidPeerDropped = !window.A.peers().has('B');
        bus.rosters[43].delete('C');
        await window.A.huddleOnSignal({ type: 'roster', roomId: 43, boot: bus.boot, participants: listed(), left: 'C', swept: true });
        out.kept = window.A.peers().get('C') === pc;
        // The same person joins again from another old tab: start the pair afresh.
        window.__log.length = 0;
        bus.rosters[43].add('C');
        await window.A.huddleOnSignal({ type: 'roster', roomId: 43, boot: bus.boot, participants: listed(), joined: 'C' });
        await wait(200);
        const pc2 = window.A.peers().get('C');
        out.fresh = !!pc2 && pc2 !== pc && pc.pc.signalingState === 'closed' && window.__log.includes('A -> offer @C');
        bus.rosters[43].delete('C');
        await window.A.huddleOnSignal({ type: 'roster', roomId: 43, boot: bus.boot, participants: listed(), left: 'C', swept: true });
        out.keptAgain = window.A.peers().get('C') === pc2;
        pc2.keptAt = Date.now() - 10 * 60 * 1000 - 1000;          // the server's window is up
        await window.A.hdPollStats(); await window.A.hdPollStats();
        out.expired = !window.A.peers().has('C');
        window.C.huddleLeave();
        await window.C.huddleStart(43, false, true);
        await wait(300);
        out.redialled = window.A.peers().has('C');
        window.C.huddleLeave();                                   // its Leave button
        await wait(100);
        out.leftDropped = !window.A.peers().has('C');
        return out;
      } finally {
        window.__hook = null; bus.inbox.B = realB; bus.inbox.C = realC;
        window.A.huddleLeave(); window.B.huddleLeave(); window.C.huddleLeave();
      }
    });
    check('a swept peer on this bundle whose pair is not working is let go, as before', r.dialled && r.sidPeerDropped, JSON.stringify(r));
    check('…a kept pair is started afresh when the person joins again from another old tab', r.kept && r.fresh, JSON.stringify(r));
    check('…and goes once the server would no longer put the peer back', r.keptAgain && r.expired, JSON.stringify(r));
    check('…and a peer on the previous bundle that leaves goes at once', r.redialled && r.leftDropped, JSON.stringify(r));
  }
  await sleep(150);

  check('no page errors', errs.length === 0, errs.slice(0, 4).join(' | '));

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})();
