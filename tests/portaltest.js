// The customer portal's two endpoints — the PII path.
//
// The contract is docs/erp-customer-portal.md in the website repo. Two things
// here carry the weight: that verify-owner gives a stranger no oracle, and that
// the vehicle record never carries a field nobody agreed to send.
const fs = require('fs');
const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const eq = (n, got, want) => c(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const ctx = require('../src/ctx');
const ROUTES = [];
let STOCK, CUSTOMER, LINKS, BOX;
function reset() {
  STOCK = [{
    id: 9, make: 'Deepal', model: 'S05', trim: '620 Max EV', updated_at: '2026-09-01T10:00:00Z',
    units: [{
      vin: 'LS6CME0P7TK504025', status: 'delivered', consignee: 'Sara saied',
      colour: 'Silver in dual tune black and grey', supplier: 'Changan',
      price_list: 1700000, discounted: 1650000, logistics: '2026-09-24', cf_brand: 'Motolinkers',
      cf_vehicle_file: 'https://drive.google.com/drive/folders/1rO6wMGSPoYUbUeVZFFL879Sis450iYLV',
    }],
  }];
  CUSTOMER = null;
  LINKS = [{ container_id: 4 }];
  BOX = { pod_eta: '2026-09-28', last_synced_at: '2026-09-06T06:23:16Z' };
}
reset();

const table = name => ({
  select: () => {
    const q = { eq: () => q, limit: () => q, maybeSingle: () => q,
      then: fn => fn(name === 'stock_vehicles' ? { data: STOCK, error: null }
        : name === 'container_vehicles' ? { data: LINKS, error: null }
        : name === 'customers' ? { data: CUSTOMER, error: null }
        : { data: BOX, error: null }) };
    return q;
  },
});
Object.assign(ctx, {
  express: { json: () => () => {} },
  receiver: { router: { post: (path, _mw, h) => ROUTES.push({ path, h }), get: () => {}, put: () => {},
                        delete: () => {}, patch: () => {}, use: () => {} } },
  supabase: { from: table },
});

const TOKEN = 'p'.repeat(64);
process.env.INVENTORY_PORTAL_TOKEN = TOKEN;
require('../src/routes/inventory-portal');
const route = p => ROUTES.find(r => r.path === p).h;

async function call(path, body, token = TOKEN) {
  const out = { code: 200, body: null };
  const res = { status(n) { out.code = n; return this; }, json(b) { out.body = b; return this; } };
  await route(path)({ body, headers: { authorization: token === null ? undefined : `Bearer ${token}` } }, res);
  return out;
}
const verify = (b, t) => call('/api/inventory/verify-owner', b, t);
const vehicle = (b, t) => call('/api/inventory/vehicle', b, t);
const VIN = 'LS6CME0P7TK504025';

(async () => {
  // ── verify-owner gives a stranger nothing to learn from ──────────────────
  // Every one of these is a different underlying situation. If any of them
  // answered differently, the differences ARE the leak: an attacker learns
  // which VINs we hold, and which of those have an owner on file.
  const probes = [
    ['a VIN we do not have',        { vin: 'WVWZZZ1JZXW000001', phone: '01000500577' }],
    ['a VIN we have, wrong number', { vin: VIN,                 phone: '01111111111' }],
    ['a VIN we have, no owner set', { vin: VIN,                 phone: '01000500577' }],
    ['a malformed VIN',             { vin: 'NOPE',              phone: '01000500577' }],
    ['a VIN with O in it',          { vin: '1HGCM8263OA004352', phone: '01000500577' }],
    ['no phone at all',             { vin: VIN,                 phone: '' }],
    ['no body fields at all',       {}],
  ];
  const answers = [];
  for (const [why, body] of probes) {
    const r = await verify(body);
    answers.push(`${r.code}:${JSON.stringify(r.body)}`);
    c(`${why} → the same 200 {match:false}`, r.code === 200 && r.body.match === false,
      `${r.code} ${JSON.stringify(r.body)}`);
  }
  eq('…and every one of those is byte-identical', [...new Set(answers)].length, 1);
  c('the answer carries nothing but the verdict',
    Object.keys((await verify({ vin: VIN, phone: '01000500577' })).body).join() === 'match');

  // ── It says yes only when the number really is on the car ────────────────
  STOCK[0].units[0].customer_id = 77;
  CUSTOMER = { phone: '+2001000500577', phone_norm: '2001000500577' };
  eq('the right number matches through the customer link',
    (await verify({ vin: VIN, phone: '01000500577' })).body, { match: true });
  // The stored phone_norm here is one of the 28 the old normaliser mangled.
  // Re-normalising the raw number is what rescues it.
  eq('…even when the stored phone_norm is one the old normaliser mangled',
    (await verify({ vin: VIN, phone: '+20 100 050 0577' })).body, { match: true });
  eq('a different number still does not', (await verify({ vin: VIN, phone: '01000500578' })).body, { match: false });
  reset();

  STOCK[0].units[0].phone = '01000500577';
  eq('a number written on the car itself also proves ownership',
    (await verify({ vin: VIN, phone: '0100 050 0577' })).body, { match: true });
  reset();

  // The consignee's NAME must never be a key. Two customers called Ahmed
  // Hassan would each unlock the other's car.
  const SRC = fs.readFileSync('src/routes/inventory-portal.js', 'utf8');
  c('ownership is never decided by the consignee name',
    !/consignee[\s\S]{0,80}(match|===|includes)/.test(SRC.slice(SRC.indexOf('function ownerPhones'), SRC.indexOf('verify-owner'))));

  // ── The vehicle record ────────────────────────────────────────────────────
  const got = await vehicle({ vin: VIN });
  eq('a known VIN is served', got.code, 200);
  eq('…with exactly the agreed fields, no more', Object.keys(got.body).sort(),
    ['consignee_name', 'documents', 'eta', 'model', 'status', 'status_changed_at', 'vin']);
  eq('the name on the order is the point of this endpoint', got.body.consignee_name, 'Sara saied');
  eq('the status is translated, not the stored key', got.body.status, 'in_transit');
  eq('the arrival date is the carrier’s, as a port day', got.body.eta, '2026-09-28');
  eq('documents is an empty array, not a missing key', got.body.documents, []);

  // Everything the record must not carry, checked against the blob rather than
  // the key list — a nested field would pass a key check and still leak.
  const blob = JSON.stringify(got.body);
  for (const [what, leak] of [['the list price', '1700000'], ['the discount', '1650000'],
                              ['the supplier', 'Changan'], ['the colour', 'Silver'],
                              ['the internal brand tag', 'Motolinkers'],
                              ['the Drive folder', 'drive.google.com']]) {
    c(`the record never carries ${what}`, !blob.includes(leak), blob);
  }

  eq('an unknown VIN is a plain 404', (await vehicle({ vin: 'WVWZZZ1JZXW000001' })).code, 404);
  eq('a malformed VIN is refused before the lookup', (await vehicle({ vin: 'NOPE' })).code, 400);

  // ── Both endpoints are gated, separately from the public tracker ──────────
  for (const [name, fn] of [['verify-owner', verify], ['vehicle', vehicle]]) {
    eq(`${name} refuses a wrong token`, (await fn({ vin: VIN, phone: '01000500577' }, 'x'.repeat(64))).code, 401);
    eq(`${name} refuses a missing token`, (await fn({ vin: VIN, phone: '01000500577' }, null)).code, 401);
  }
  const saved = process.env.INVENTORY_PORTAL_TOKEN;
  delete process.env.INVENTORY_PORTAL_TOKEN;
  eq('uncommissioned, it refuses rather than serving a name',
    (await vehicle({ vin: VIN })).code, 401);
  process.env.INVENTORY_PORTAL_TOKEN = saved;

  c('the portal token is a different secret from the public tracker’s',
    /INVENTORY_PORTAL_TOKEN/.test(SRC) && !/INVENTORY_TRACK_TOKEN/.test(SRC));
  c('both endpoints are POST, so a phone never lands in a query string',
    (SRC.match(/receiver\.router\.post\(/g) || []).length === 2
    && !/receiver\.router\.get\(/.test(SRC));
  c('the PII path is logged with the VIN and the time', /\[portal\] vehicle \$\{vin\}/.test(SRC));
  c('the rate-limit bucket is a hash, never the token itself',
    /createHash\('sha256'\)/.test(SRC) && !/hits\.get\(String\(header/.test(SRC));
  c('the token is compared in constant time', /timingSafeEqual/.test(SRC));

  // ── The two customer-facing endpoints cannot drift apart ─────────────────
  // A buyer reading "In transit" on the public tracker and something else on
  // their own portal page has caught us contradicting ourselves.
  const CV = fs.readFileSync('src/lib/customer-view.js', 'utf8');
  const TRACK = fs.readFileSync('src/routes/inventory-track.js', 'utf8');
  c('the status map is defined once', /CUSTOMER_STATUS = \{/.test(CV)
    && !/CUSTOMER_STATUS = \{/.test(TRACK) && !/CUSTOMER_STATUS = \{/.test(SRC));
  c('…and both endpoints read it from there',
    /require\('\.\.\/lib\/customer-view'\)/.test(TRACK) && /require\('\.\.\/lib\/customer-view'\)/.test(SRC));
  c('the phone normaliser is shared with whatever wrote phone_norm',
    /require\('\.\.\/lib\/phone'\)/.test(SRC)
    && /require\('\.\.\/lib\/phone'\)/.test(fs.readFileSync('src/routes/employee-portal.js', 'utf8')));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exitCode = results.every(Boolean) ? 0 : 1;
})();
