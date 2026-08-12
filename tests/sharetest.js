// Does a screen share started from a COLD audio-only call always reach the peer?
// Runs the real module N times, alternating who shares, and reports the failures.
const fs = require('fs'), http = require('http'), puppeteer = require('puppeteer');
const html = fs.readFileSync('public/assets/huddle.js', 'utf8');
const start = html.indexOf('// Mesh topology: every participant holds one RTCPeerConnection');
const end = html.indexOf('\n}', html.indexOf('function statusEmojiOnly(emoji, text) {')) + 2;
const MODULE = html.slice(start, end);

const PAGE = `<!doctype html><html><body>
<div id="hd-bar"></div><div id="hd-toast"></div><div id="hd-join-chip"></div>
<div id="hd-incoming"></div><div id="hd-sheet"></div>
<script>
function esc(s){ return s ? String(s) : ''; }
function makeClient(HDCFG) {
${MODULE}
  return { huddleStart, huddleJoinExisting, huddleLeave, huddleOnSignal, huddleToggleShare,
           state: () => _hd, peers: () => _hd.peers };
}
window.mkPair = () => {
  const bus = { inbox: {}, roster: new Set() };
  const mkFetch = key => async (url, opts) => {
    if (url.endsWith('/huddle/ice')) return { ok:true, json: async () => ({ iceServers: [], hasTurn:false, ttl:7200 }) };
    const b = JSON.parse(opts.body), rid = b.roomId;
    if (b.type === 'join' || b.type === 'leave') {
      b.type === 'join' ? bus.roster.add(key) : bus.roster.delete(key);
      const participants = [...bus.roster].map(k => ({ key:k, name:k }));
      setTimeout(() => ['A','B'].forEach(k => bus.inbox[k] && bus.inbox[k]({ type:'roster', roomId:rid, participants })), 0);
      return { ok:true, json: async () => ({ ok:true, participants }) };
    }
    setTimeout(() => { const t = bus.inbox[b.to]; if (t) t({ type:b.type, roomId:rid, from:key, fromName:key, data:b.data }); }, 0);
    return { ok:true, json: async () => ({ ok:true }) };
  };
  const ROOM = { id:1, type:'group', name:'T', created_by:'A',
    members:[{member_key:'A',member_name:'A'},{member_key:'B',member_name:'B'}] };
  const cfg = k => ({ base:'/x', me:()=>k, fetch:mkFetch(k), rooms:()=>[ROOM],
                      activeRoom:()=>1, openRoom:()=>{}, refreshRooms:async()=>{} });
  const A = makeClient(cfg('A')), B = makeClient(cfg('B'));
  bus.inbox.A = m => A.huddleOnSignal(m); bus.inbox.B = m => B.huddleOnSignal(m);
  return { A, B };
};
<\/script></body></html>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const server = http.createServer((_q,s)=>{s.writeHead(200,{'Content-Type':'text/html'});s.end(PAGE);});
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const browser = await puppeteer.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless:'new', args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/', { waitUntil:'domcontentloaded' });

  const N = 8; let fails = 0;
  for (let i = 0; i < N; i++) {
    const sharer = i % 2 === 0 ? 'A' : 'B';
    const viewer = sharer === 'A' ? 'B' : 'A';
    const r = await page.evaluate(async (sharer, viewer) => {
      const { A, B } = window.mkPair();
      window.__p = { A, B };
      const S = { A, B }[sharer], V = { A, B }[viewer];
      await S.huddleStart(1, false);                // cold: audio only
      await new Promise(r => setTimeout(r, 150));
      await V.huddleJoinExisting(1);
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        const s = [...S.peers().values()][0], v = [...V.peers().values()][0];
        if (s && v && s.pc.connectionState === 'connected' && v.pc.connectionState === 'connected') break;
        await new Promise(r => setTimeout(r, 150));
      }
      await S.huddleToggleShare();                   // now share
      let frames = 0, mLines = 0, viewerMuted = null;
      const t1 = Date.now();
      while (Date.now() - t1 < 9000) {
        const v = [...V.peers().values()][0];
        if (v) {
          const vt = v.stream.getVideoTracks()[0];
          viewerMuted = vt ? vt.muted : null;
          (await v.pc.getStats()).forEach(x => { if (x.type==='inbound-rtp' && x.kind==='video') frames = x.framesDecoded||0; });
          if (frames > 0) break;
        }
        await new Promise(r => setTimeout(r, 250));
      }
      const sPc = [...S.peers().values()][0].pc;
      mLines = (sPc.localDescription.sdp.match(/^m=video/gm) || []).length;
      const vSenders = sPc.getTransceivers().filter(t => t.sender.track && t.sender.track.kind === 'video');
      const out = { frames, mLines, viewerMuted,
        senderMid: vSenders[0] ? vSenders[0].mid : null,
        senderDir: vSenders[0] ? vSenders[0].direction : null,
        curDir: vSenders[0] ? vSenders[0].currentDirection : null };
      A.huddleLeave(); B.huddleLeave();
      return out;
    }, sharer, viewer);
    const ok = r.frames > 0;
    if (!ok) fails++;
    console.log(`run ${i+1} ${sharer}->${viewer}  ${ok ? 'ok  ' : 'FAIL'}  ${JSON.stringify(r)}`);
    await sleep(400);
  }
  console.log(`\n${N - fails}/${N} screen shares arrived`);
  await browser.close(); server.close();
})();
