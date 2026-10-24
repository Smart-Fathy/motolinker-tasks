// Time-based one-time passwords (RFC 6238) — the six-digit code an authenticator app
// (Google Authenticator, Microsoft Authenticator, Authy, 1Password…) shows and
// refreshes every 30 seconds.
//
// Written against node:crypto rather than pulling in a package: the algorithm is an
// HMAC and a truncation, and a dependency here would be one more thing to trust with
// the thing that guards every account.
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_S = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
// Tolerant of how people copy these: lower case, spaces, dashes, trailing '='.
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[\s\-=]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Not a valid base32 secret');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// 160 bits, the size RFC 4226 recommends for an HMAC-SHA1 key.
function generateSecret() { return base32Encode(crypto.randomBytes(20)); }

function hotp(key, counter, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const stepAt = (timeMs, period = PERIOD_S) => Math.floor(timeMs / 1000 / period);

function totpAt(secretB32, timeMs = Date.now(), { period = PERIOD_S, digits = DIGITS } = {}) {
  return hotp(base32Decode(secretB32), stepAt(timeMs, period), digits);
}

// Check a code the user typed. Accepts the current 30-second step and one either side
// (a phone clock a few seconds off is normal), and refuses any step at or before
// `afterStep` — the last one this account already used — so a code that was shoulder-
// surfed or intercepted cannot be replayed inside its validity window.
//
// Returns the step that matched, which the caller stores as the new `afterStep`, or 0.
function verifyTotp(secretB32, code, { now = Date.now(), window = 1, afterStep = 0, period = PERIOD_S, digits = DIGITS } = {}) {
  const given = String(code == null ? '' : code).replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(given)) return 0;
  let key;
  try { key = base32Decode(secretB32); } catch (_) { return 0; }
  const want = Buffer.from(given);
  const cur = stepAt(now, period);
  let matched = 0;
  // Check every step in the window rather than returning at the first match, so the
  // time taken does not say which step (or whether any) was right.
  for (let s = cur - window; s <= cur + window; s++) {
    if (s <= afterStep) continue;
    const ok = crypto.timingSafeEqual(Buffer.from(hotp(key, s, digits)), want);
    if (ok && !matched) matched = s;
  }
  return matched;
}

// The otpauth:// link an authenticator app reads from the QR code.
function otpauthUri({ issuer, account, secret }) {
  const label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_S}`;
}

// ── Recovery codes ────────────────────────────────────────────────────────────
// One-time codes for a lost phone. Ten characters from an alphabet without the
// look-alikes (0/o, 1/l/i), shown as xxxxx-xxxxx. Only their SHA-256 is stored: they
// carry 50 bits, so a database leak must not hand them out, and unlike a password
// there is no reason to make the hash slow — a guess is limited by the sign-in
// limiter, not by the cost of hashing.
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function generateRecoveryCodes(n = 10) {
  const codes = [];
  while (codes.length < n) {
    const bytes = crypto.randomBytes(10);
    let s = '';
    for (const b of bytes) s += RC_ALPHABET[b % RC_ALPHABET.length];
    codes.push(s.slice(0, 5) + '-' + s.slice(5));
  }
  return codes;
}
const normalizeRecoveryCode = c => String(c == null ? '' : c).toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecoveryCode = c => crypto.createHash('sha256').update('recovery:' + normalizeRecoveryCode(c)).digest('hex');
const looksLikeRecoveryCode = c => normalizeRecoveryCode(c).length === 10;

module.exports = {
  base32Encode, base32Decode, generateSecret, hotp, totpAt, verifyTotp, otpauthUri, stepAt,
  generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, looksLikeRecoveryCode,
  PERIOD_S, DIGITS,
};
