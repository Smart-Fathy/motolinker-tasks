// What a request says about who is making it: the address, the browser, and a cookie
// that names this browser from one sign-in to the next.
//
// Used by the sign-in record and its alerts. None of it is proof of anything — a
// header is whatever the sender wrote — so it is shown to the account's owner to
// recognise ("that's my laptop") and never trusted to decide access.
const crypto = require('crypto');

// Behind Railway's edge (and Cloudflare, when it is in front) the socket address is
// the proxy's. The first X-Forwarded-For entry is the client as the outermost proxy
// saw it. It can be forged by a caller reaching the app directly, which is why
// nothing here gates access: it is for the owner to read, not for the server to act on.
function clientIp(req) {
  const h = (req && req.headers) || {};
  const raw = String(h['cf-connecting-ip'] || '').trim()
    || String(h['x-forwarded-for'] || '').split(',')[0].trim()
    || String(h['x-real-ip'] || '').trim()
    || String((req && req.socket && req.socket.remoteAddress) || '').trim();
  return raw.replace(/^::ffff:/, '').slice(0, 64) || 'unknown';
}

// "Chrome on Windows". A short label a person can match against their own device;
// the full user agent is kept alongside for anyone who needs the detail.
function deviceLabel(ua) {
  ua = String(ua || '');
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux|X11/.test(ua) ? 'Linux' : '';
  // Order matters: Edge, Opera and Samsung all say "Chrome"; Chrome says "Safari".
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari'
    : /curl|wget|python|node|axios|okhttp|postman/i.test(ua) ? 'Script' : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}

function requestMeta(req) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '').slice(0, 300);
  return { ip: clientIp(req), ua, device: deviceLabel(ua) };
}

// ── The device cookie ─────────────────────────────────────────────────────────
// A random id the server puts on a browser the first time an account signs in from
// it. "Have we seen this browser sign in to this account before?" is what decides
// whether a sign-in is worth an alert. Server-set and HttpOnly rather than kept in
// localStorage: a page script (or anything injected into one) cannot read it, so it
// cannot be copied out to make a stranger's browser look familiar.
const DEVICE_COOKIE = 'ml_did';
const DEVICE_COOKIE_MAX_AGE_S = 400 * 86400;   // the longest a browser will keep one

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}
function readDeviceId(req) {
  const v = parseCookies(req && req.headers && req.headers.cookie)[DEVICE_COOKIE];
  return /^[a-f0-9]{32}$/.test(v || '') ? v : null;
}
function newDeviceId() { return crypto.randomBytes(16).toString('hex'); }
// Only the hash is stored, so the table cannot be used to forge the cookie.
function hashDeviceId(id) { return crypto.createHash('sha256').update(String(id)).digest('hex'); }
function setDeviceCookie(res, req, id) {
  const secure = req && (req.secure || String((req.headers || {})['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
  res.append('Set-Cookie', `${DEVICE_COOKIE}=${id}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}

module.exports = { clientIp, deviceLabel, requestMeta, parseCookies, readDeviceId, newDeviceId, hashDeviceId, setDeviceCookie, DEVICE_COOKIE };
