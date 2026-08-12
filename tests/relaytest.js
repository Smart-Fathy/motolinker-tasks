// huddleRelayTest reporting logic, using the real module sliced out of the page.
// Served over http://127.0.0.1 so RTCPeerConnection behaves like it does in the app.
const fs = require('fs'), http = require('http');
const puppeteer = require('puppeteer');

const html = fs.readFileSync('public/assets/dashboard.js', 'utf8');
const start = html.indexOf('// Mesh topology: every participant holds one RTCPeerConnection');
const end = html.indexOf('\n}', html.indexOf('function statusEmojiOnly(emoji, text) {')) + 2;
const MODULE = html.slice(start, end);
if (!/async function huddleRelayTest/.test(MODULE)) throw new Error('relay test not in the slice');

const PAGE = `<!doctype html><html><body>
<div id="hd-bar"></div><div id="hd-toast"></div><div id="hd-join-chip"></div>
<div id="hd-incoming"></div><div id="hd-sheet"></div>
<script>
function esc(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
window.__open = 0;                                   // live RTCPeerConnections
const RealPC = window.RTCPeerConnection;
window.RTCPeerConnection = function (cfg) {
  const pc = new RealPC(cfg);
  window.__open++; window.__lastCfg = cfg;
  const close = pc.close.bind(pc);
  pc.close = () => { window.__open--; return close(); };
  return pc;
};
function makeClient(HDCFG) {
${MODULE}
  return { huddleRelayTest, state: () => _hd };
}
window.mk = iceCfg => makeClient({
  base: '/x', me: () => 'admin',
  fetch: async () => ({ ok: true, json: async () => iceCfg }),
  rooms: () => [], activeRoom: () => null, openRoom: () => {}, refreshRooms: async () => {},
});
<\/script></body></html>`;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

(async () => {
  const server = http.createServer((_q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'domcontentloaded' });

  const toast = () => page.evaluate(() => document.getElementById('hd-toast').textContent);

  // 1. Nothing configured — must not even open a peer connection
  const noTurn = await page.evaluate(() => window.mk({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    hasTurn: false, provider: 'none', ttl: 7200 }).huddleRelayTest());
  check('no TURN configured is reported as such', noTurn.ok === false && noTurn.reason === 'not-configured', JSON.stringify(noTurn));
  check('the message names the provider', (await toast()).includes('provider: none'), await toast());
  check('no probe connection is opened when there is nothing to test',
    (await page.evaluate(() => window.__open)) === 0);

  // 2. TURN configured but unreachable — 8s gathering window, then a clear failure
  const t0 = Date.now();
  const dead = await page.evaluate(() => window.mk({
    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] },
                 { urls: ['turn:127.0.0.1:3478'], username: 'u', credential: 'p' }],
    hasTurn: true, provider: 'cloudflare', ttl: 7200 }).huddleRelayTest());
  const took = Date.now() - t0;
  check('an unreachable relay is reported as unreachable',
    dead.ok === false && dead.reason === 'no-candidates' && dead.provider === 'cloudflare', JSON.stringify(dead));
  check('the message says credentials were issued but nothing came back',
    (await toast()).includes('issued credentials but nothing came back'), await toast());
  check('it gives up inside the 8s window', took < 12000, took + 'ms');
  check('the probe connection is closed afterwards', (await page.evaluate(() => window.__open)) === 0);

  // 3. The relay-only policy is what actually gets used
  check("gathering is forced to relay-only", (await page.evaluate(() => window.__lastCfg.iceTransportPolicy)) === 'relay');
  check('the server ICE servers are passed through unchanged',
    (await page.evaluate(() => window.__lastCfg.iceServers.length)) === 2);

  // 4. A throwing config still closes the connection
  const boom = await page.evaluate(() => window.mk({
    iceServers: [{ urls: ['turn:nope'], username: 'u', credential: 'p' }], hasTurn: true, provider: 'cloudflare' }).huddleRelayTest());
  check('a malformed ICE server surfaces an error rather than hanging',
    boom.ok === false && (boom.reason === 'error' || boom.reason === 'no-candidates'), JSON.stringify(boom));
  check('and still leaves no open connection', (await page.evaluate(() => window.__open)) === 0);

  // 5. The cache is bypassed so the button always reflects current server state
  const fresh = await page.evaluate(async () => {
    const c = window.mk({ iceServers: [], hasTurn: false, provider: 'none', ttl: 7200 });
    c.state().ice = { hasTurn: true, provider: 'stale', iceServers: [] };
    c.state().iceUntil = Date.now() + 3600e3;
    const r = await c.huddleRelayTest();
    return { reason: r.reason, provider: r.provider };
  });
  check('a stale cached config is discarded before testing',
    fresh.provider === 'none' && fresh.reason === 'not-configured', JSON.stringify(fresh));

  // 6. The success path, against a real coturn on 127.0.0.1 — the one case where a
  //    false pass would be dangerous, so it is tested against a live relay rather
  //    than a stub that cannot tell "answered" from "silently dropped".
  if (process.env.LIVE_TURN) {
    const live = await page.evaluate(() => window.mk({
      iceServers: [{ urls: ['turn:127.0.0.1:3478?transport=udp'], username: 'probe', credential: 'probepass' }],
      hasTurn: true, provider: 'cloudflare', ttl: 7200 }).huddleRelayTest());
    check('a reachable relay reports OK', live.ok === true && live.provider === 'cloudflare', JSON.stringify(live));
    check('and names the protocols that got through',
      Array.isArray(live.protocols) && live.protocols.includes('udp'), JSON.stringify(live.protocols));
    check('the success message reads clearly', (await toast()).startsWith('Relay OK via cloudflare'), await toast());
    check('the probe connection is closed after a success', (await page.evaluate(() => window.__open)) === 0);

    // The dangerous failure is a false pass: a live, reachable relay that rejects
    // our credentials must not read as working just because the host answered.
    const badPass = await page.evaluate(() => window.mk({
      iceServers: [{ urls: ['turn:127.0.0.1:3478?transport=udp'], username: 'probe', credential: 'WRONG' }],
      hasTurn: true, provider: 'cloudflare', ttl: 7200 }).huddleRelayTest());
    check('a reachable relay with a bad credential is reported as failing',
      badPass.ok === false && badPass.reason === 'no-candidates', JSON.stringify(badPass));
  }

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
