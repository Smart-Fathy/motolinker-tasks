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
           hdPollStats, hdQuality,
           state: () => _hd, peers: () => _hd.peers };
}

const ROOM = { id: 1, type: 'group', name: 'Test', created_by: 'A',
  members: [{ member_key: 'A', member_name: 'Ann' }, { member_key: 'B', member_name: 'Bob' },
             { member_key: 'C', member_name: 'Cid' }] };
const bus = { inbox: {}, rosters: {} };

function makeFetch(key) {
  return async (url, opts) => {
    if (url.endsWith('/huddle/ice')) {
      window.__iceCalls = (window.__iceCalls || 0) + 1;
      return { ok: true, json: async () => ({ iceServers: [], hasTurn: false, provider: 'none', ttl: 7200, max: 6 }) };
    }
    const body = JSON.parse(opts.body);
    window.__log.push(key + ' -> ' + body.type + (body.to ? ' @' + body.to : ''));
    const rid = body.roomId;
    if (body.type === 'join') {
      (bus.rosters[rid] = bus.rosters[rid] || new Set()).add(key);
      const participants = [...bus.rosters[rid]].map(k => ({ key: k, name: k }));
      setTimeout(() => ['A','B','C'].forEach(k => bus.inbox[k] && bus.inbox[k]({ type:'roster', roomId: rid, participants })), 0);
      return { ok: true, json: async () => ({ ok: true, participants }) };
    }
    if (body.type === 'leave') {
      if (bus.rosters[rid]) bus.rosters[rid].delete(key);
      const participants = [...(bus.rosters[rid] || [])].map(k => ({ key: k, name: k }));
      setTimeout(() => ['A','B','C'].forEach(k => bus.inbox[k] && bus.inbox[k]({ type:'roster', roomId: rid, participants })), 0);
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
  return { base: '/api/x/chat', me: () => key, fetch: makeFetch(key),
           rooms: () => [ROOM], activeRoom: () => 1, openRoom: () => {}, refreshRooms: async () => {} };
}
window.A = makeClient(cfg('A'));
window.B = makeClient(cfg('B'));
window.C = makeClient(cfg('C'));
bus.inbox.A = m => window.A.huddleOnSignal(m);
bus.inbox.B = m => window.B.huddleOnSignal(m);
bus.inbox.C = m => window.C.huddleOnSignal(m);
window.__bus = bus;
<\/script></body></html>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
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
  check('the remote element is NOT muted', audible.muted === false, JSON.stringify(audible));
  check('and it is actually playing', audible.paused === false, JSON.stringify(audible));
  check('our own tile IS muted, so we do not echo', audible.selfMuted === true, JSON.stringify(audible));

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

  // 4. A receives audio from B
  const gotAudio = await page.evaluate(() => {
    const p = [...window.A.peers().values()][0];
    return p.stream.getAudioTracks().length;
  });
  check('A receives B audio track', gotAudio === 1, 'tracks=' + gotAudio);

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
  await page.evaluate(() => window.A.hdRenderBar());
  await sleep(200);
  const fsBefore = await page.evaluate(() => {
    const t = k => document.querySelector('[data-tile="' + k + '"] .hd-full');
    return { withVideo: t('__self').style.display, audioOnly: t('B').style.display };
  });
  check('the full-screen button shows on a tile with a picture', fsBefore.withVideo === 'flex', JSON.stringify(fsBefore));
  check('and stays hidden on an audio-only tile', fsBefore.audioOnly === 'none', JSON.stringify(fsBefore));

  // requestFullscreen needs a trusted gesture, so drive a real click.
  // The toast is pointer-events:none precisely so it cannot intercept this.
  await page.click('[data-tile="__self"] .hd-full');
  await sleep(700);
  const inFs = await page.evaluate(() => {
    const el = document.fullscreenElement;
    if (!el) return { active: false };
    const v = el.querySelector('.hd-video');
    const cs = getComputedStyle(v), ts = getComputedStyle(el);
    return { active: true, tile: el.getAttribute('data-tile'),
             fit: cs.objectFit, cssW: cs.width, w: v.clientWidth, vw: innerWidth,
             tileW: el.clientWidth, tileCssW: ts.width, screenW: screen.width };
  });
  check('clicking it takes that tile full screen', inFs.active && inFs.tile === '__self', JSON.stringify(inFs));
  check('the thumbnail crop is dropped, so a shared screen keeps its edges',
    inFs.fit === 'contain', JSON.stringify(inFs));
  check('and the video fills the viewport', inFs.w >= inFs.vw - 2, JSON.stringify(inFs));

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

  await page.click('[data-tile="__self"] .hd-full');
  await sleep(700);
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

  check('no page errors', errs.length === 0, errs.slice(0, 4).join(' | '));

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})();
