// The sign-in building blocks: the failure limiter and the request fingerprint
// (address, device label, and the cookie that recognises a returning browser).
const { createLimiter } = require('../src/lib/rate-limit');
const ri = require('../src/lib/request-info');

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// ── The limiter ───────────────────────────────────────────────────────────────
{
  const l = createLimiter({ max: 3, windowMs: 60_000 });
  const t0 = 1_000_000;
  c('under the limit there is no wait', l.retryAfter('a', t0) === 0);
  l.fail('a', t0); l.fail('a', t0 + 1000);
  c('two failures of three allowed: still no wait', l.retryAfter('a', t0 + 2000) === 0);
  l.fail('a', t0 + 2000);
  const wait = l.retryAfter('a', t0 + 3000);
  c('the third failure locks the key, with the time left', wait > 0 && wait <= 60, `${wait}s`);
  c('another key is unaffected', l.retryAfter('b', t0 + 3000) === 0);
  c('the lock lifts when the oldest failure leaves the window', l.retryAfter('a', t0 + 60_001) === 0 || l.retryAfter('a', t0 + 60_001) <= 1);
  c('…and is gone entirely after the window', l.retryAfter('a', t0 + 125_000) === 0);
  l.fail('c', t0); l.fail('c', t0); l.fail('c', t0); l.reset('c');
  c('a successful sign-in clears the count', l.retryAfter('c', t0 + 1) === 0);
  l.fail('d', t0);
  c('a key with a live failure is held', l.size >= 1);
  l.sweep(t0 + 120_000);
  c('quiet keys are forgotten, so the map cannot grow without bound', l.size === 0, `${l.size} left`);
}

// ── The request fingerprint ───────────────────────────────────────────────────
{
  const CH = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const ED = CH + ' Edg/130.0.0.0';
  const FF = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
  const SF = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const AN = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  c('Chrome on Windows', ri.deviceLabel(CH) === 'Chrome on Windows', ri.deviceLabel(CH));
  c('Edge is not mistaken for Chrome', ri.deviceLabel(ED) === 'Edge on Windows', ri.deviceLabel(ED));
  c('Firefox on Linux', ri.deviceLabel(FF) === 'Firefox on Linux', ri.deviceLabel(FF));
  c('Safari on iOS (not macOS)', ri.deviceLabel(SF) === 'Safari on iOS', ri.deviceLabel(SF));
  c('Chrome on Android (not Linux)', ri.deviceLabel(AN) === 'Chrome on Android', ri.deviceLabel(AN));
  c('a script is called a script', ri.deviceLabel('curl/8.5.0') === 'Script', ri.deviceLabel('curl/8.5.0'));
  c('no user agent is still a label', ri.deviceLabel('') === 'Unknown device');

  const req = h => ({ headers: h, socket: { remoteAddress: '::ffff:10.0.0.9' } });
  c('the first forwarded address is the client', ri.clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.1.1.1' })) === '203.0.113.7');
  c('Cloudflare\'s header wins when present', ri.clientIp(req({ 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '203.0.113.7' })) === '198.51.100.4');
  c('with no proxy the socket address is used, IPv4-mapped prefix removed', ri.clientIp(req({})) === '10.0.0.9');
  const meta = ri.requestMeta(req({ 'user-agent': CH + 'x'.repeat(600) }));
  c('the user agent is capped so a header cannot bloat a row', meta.ua.length === 300 && meta.device === 'Chrome on Windows');

  c('cookies parse, including encoded values', ri.parseCookies('a=1; ml_did=abc%20d; b=') .ml_did === 'abc d');
  const id = ri.newDeviceId();
  c('a device id is 128 random bits as hex', /^[a-f0-9]{32}$/.test(id) && id !== ri.newDeviceId());
  c('the cookie is read back from a request', ri.readDeviceId(req({ cookie: `x=1; ${ri.DEVICE_COOKIE}=${id}` })) === id);
  c('a malformed cookie is ignored, not trusted', ri.readDeviceId(req({ cookie: `${ri.DEVICE_COOKIE}=<script>` })) === null);
  c('only a hash of the device id is stored', ri.hashDeviceId(id) !== id && ri.hashDeviceId(id) === ri.hashDeviceId(id) && ri.hashDeviceId(id).length === 64);
  const set = [];
  ri.setDeviceCookie({ append: (k, v) => set.push([k, v]) }, req({ 'x-forwarded-proto': 'https' }), id);
  c('the cookie is HttpOnly, SameSite=Lax, long-lived and Secure over https',
    /HttpOnly/.test(set[0][1]) && /SameSite=Lax/.test(set[0][1]) && /Max-Age=34560000/.test(set[0][1]) && /Secure/.test(set[0][1]), set[0][1]);
  const plainSet = [];
  ri.setDeviceCookie({ append: (k, v) => plainSet.push(v) }, req({}), id);
  c('…and not marked Secure over plain http (local development)', !/Secure/.test(plainSet[0]));
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} auth-library checks passed`);
process.exit(pass === results.length ? 0 : 1);
