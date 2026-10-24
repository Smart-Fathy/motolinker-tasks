// The second-factor building blocks: TOTP, recovery codes, and the box that seals the
// secret before it reaches the database.
//
// TOTP is checked against the test vectors published in RFC 6238 appendix B, not
// against itself — an implementation that is wrong the same way in both directions
// would pass a round-trip test and still never match anyone's authenticator app.
const totp = require('../src/lib/totp');
const { createBox } = require('../src/lib/secret-box');

const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// ── RFC 6238 appendix B (SHA-1, secret "12345678901234567890") ────────────────
const RFC_SECRET = totp.base32Encode(Buffer.from('12345678901234567890'));
c('base32 of the RFC secret is the well-known string', RFC_SECRET === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', RFC_SECRET);
// The RFC lists 8-digit codes; the six-digit code is the last six of them.
for (const [t, eight] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
  c(`RFC 6238 vector at T=${t}`, totp.totpAt(RFC_SECRET, t * 1000, { digits: 8 }) === eight && totp.totpAt(RFC_SECRET, t * 1000) === eight.slice(2));
}

// ── Verification window and replay ────────────────────────────────────────────
{
  const secret = totp.generateSecret();
  const now = 1_700_000_000_000;
  const step = totp.stepAt(now);
  const at = s => totp.totpAt(secret, s * 30_000);
  c('a generated secret is 160 bits of base32', /^[A-Z2-7]{32}$/.test(secret), secret);
  c('the current code is accepted and reports its step', totp.verifyTotp(secret, at(step), { now }) === step);
  c('the previous and next step are accepted (clock drift)', totp.verifyTotp(secret, at(step - 1), { now }) === step - 1 && totp.verifyTotp(secret, at(step + 1), { now }) === step + 1);
  c('two steps away is refused', totp.verifyTotp(secret, at(step - 2), { now }) === 0 && totp.verifyTotp(secret, at(step + 2), { now }) === 0);
  c('a step already used cannot be used again', totp.verifyTotp(secret, at(step), { now, afterStep: step }) === 0);
  c('…nor any older one', totp.verifyTotp(secret, at(step - 1), { now, afterStep: step }) === 0);
  c('…but the next step still works', totp.verifyTotp(secret, at(step + 1), { now, afterStep: step }) === step + 1);
  c('spaces and a dash in the typed code are ignored', totp.verifyTotp(secret, at(step).slice(0, 3) + ' ' + at(step).slice(3), { now }) === step
    && totp.verifyTotp(secret, at(step).slice(0, 3) + '-' + at(step).slice(3), { now }) === step);
  c('a code of the wrong length or with letters is refused', ['', '12345', '1234567', 'abcdef', null, undefined].every(x => totp.verifyTotp(secret, x, { now }) === 0));
  c('a wrong code is refused', totp.verifyTotp(secret, at(step) === '000000' ? '000001' : '000000', { now }) === 0);
  c('a garbage secret refuses everything instead of throwing', totp.verifyTotp('not base32 !!', '123456', { now }) === 0);
  c('base32 round-trips arbitrary bytes', (() => { const b = require('crypto').randomBytes(33); return totp.base32Decode(totp.base32Encode(b)).equals(b); })());
  c('base32 accepts lower case, spaces and padding', totp.base32Decode('gezd gnbv-gy3t qojq====').toString() === '1234567890');
  const uri = totp.otpauthUri({ issuer: 'MotoLinker', account: 'sara@x.com', secret });
  c('the otpauth link carries issuer, account and secret', uri.startsWith('otpauth://totp/MotoLinker:sara%40x.com?') && uri.includes('secret=' + secret) && uri.includes('issuer=MotoLinker'), uri);
}

// ── Recovery codes ────────────────────────────────────────────────────────────
{
  const codes = totp.generateRecoveryCodes();
  c('ten recovery codes, all different, shaped xxxxx-xxxxx', codes.length === 10 && new Set(codes).size === 10 && codes.every(x => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(x) && !/[01loi]/.test(x)), codes[0]);
  c('a code hashes the same however it is typed', totp.hashRecoveryCode(codes[0]) === totp.hashRecoveryCode(codes[0].toUpperCase().replace('-', ' ')));
  c('different codes hash differently', totp.hashRecoveryCode(codes[0]) !== totp.hashRecoveryCode(codes[1]));
  c('a recovery code is told apart from a six-digit code', totp.looksLikeRecoveryCode(codes[0]) && !totp.looksLikeRecoveryCode('123456'));
}

// ── The secret box ────────────────────────────────────────────────────────────
{
  const key = 'k'.repeat(40);
  const box = createBox(key);
  const sealed = box.seal('JBSWY3DPEHPK3PXP');
  c('a sealed secret is not readable in the database', box.encrypted && sealed.startsWith('v1:') && !sealed.includes('JBSWY3DP'));
  c('…and opens with the same key', box.open(sealed) === 'JBSWY3DPEHPK3PXP');
  c('sealing twice gives different ciphertext (fresh IV)', box.seal('JBSWY3DPEHPK3PXP') !== sealed);
  let wrong = false; try { createBox('z'.repeat(40)).open(sealed); } catch (_) { wrong = true; }
  c('the wrong key cannot open it', wrong);
  let tampered = false; try { box.open(sealed.slice(0, -2) + 'AA'); } catch (_) { tampered = true; }
  c('a tampered value is refused, not decrypted to garbage', tampered);
  let nokey = false; try { createBox('').open(sealed); } catch (_) { nokey = true; }
  c('a sealed secret cannot be opened without a key (fail closed)', nokey);
  const plain = createBox('');
  c('with no key a secret is stored readable and marked', !plain.encrypted && plain.seal('ABC') === 'plain:ABC' && plain.open('plain:ABC') === 'ABC');
  c('…and a plain secret still opens once a key is set', box.open('plain:ABC') === 'ABC');
  c('a short key is not accepted as a key', !createBox('short').encrypted);
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} second-factor library checks passed`);
process.exit(pass === results.length ? 0 : 1);
