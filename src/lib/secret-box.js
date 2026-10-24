// Encrypts the second-factor secrets before they reach the database.
//
// A TOTP secret is a shared secret: whoever holds it can make every code the
// authenticator will ever show. A password is stored as a one-way hash, but this
// cannot be, because the server has to recompute the code. So it is encrypted
// instead, with a key that lives in the environment and never in the database —
// which means a stolen database dump or backup does not carry working second factors.
//
//   MFA_ENCRYPTION_KEY   any long random string (>= 32 chars). `openssl rand -hex 32`
//
// Without the key the secrets are stored readable, marked `plain:`. That works — the
// database is already the thing the service key protects — but it is the weaker
// setting, so the Security panel says so. Setting the key later is safe: a stored
// `plain:` value still opens, and is sealed the next time it is written.
//
// Format of a sealed value:  v1:<iv>:<auth tag>:<ciphertext>   (base64url, AES-256-GCM)
const crypto = require('crypto');

function keyFrom(secret) {
  const s = String(secret || '');
  return s.length >= 32 ? crypto.createHash('sha256').update('motolinker.mfa.v1:' + s).digest() : null;
}

function createBox(secret = process.env.MFA_ENCRYPTION_KEY) {
  const key = keyFrom(secret);
  return {
    encrypted: !!key,
    seal(plain) {
      if (!key) return 'plain:' + plain;
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
    },
    // Throws when a sealed value cannot be opened (wrong or missing key). The caller
    // must treat that as "this account's second factor is unreadable" and refuse the
    // sign-in — never as "no second factor".
    open(stored) {
      const s = String(stored == null ? '' : stored);
      if (s.startsWith('plain:')) return s.slice(6);
      const [v, iv, tag, ct] = s.split(':');
      if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised secret format');
      if (!key) throw new Error('This secret is encrypted and MFA_ENCRYPTION_KEY is not set');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
    },
    isSealed: stored => String(stored || '').startsWith('v1:'),
  };
}

module.exports = { createBox };
