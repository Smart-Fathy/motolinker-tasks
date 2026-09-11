// The customer portal's two endpoints — the ones that carry personal data.
//
// register.motolinkers.com lets somebody who has bought a car sign in and see
// their own vehicle. The website holds none of that, so it asks here. The
// contract is docs/erp-customer-portal.md in the website repo.
//
// These are deliberately NOT extra fields on /api/inventory/track. That one is
// effectively public — a VIN is etched on the windscreen — and returns nothing
// personal. These return a customer's name. Separate endpoints, separate token,
// separate blast radius: a field that is never transmitted cannot leak.
//
// POST with a JSON body rather than GET with a query string, because a phone
// number in a query string lands in every access log, proxy log and analytics
// row between Cloudflare and Railway.
//
// src/ctx.js explains the context object.
const crypto = require('crypto');
const ctx = require('../ctx');
const { express, receiver, supabase } = ctx.need('express', 'receiver', 'supabase');
const { normVin } = require('../lib/vehicles');
const { normalizePhone } = require('../lib/phone');
const {
  customerStatus, findCarByVin, shipmentForVin, arrivalDate, lastUpdated, modelName,
} = require('../lib/customer-view');

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

// ─── Auth ───────────────────────────────────────────────────────────────────
// A different secret from the public tracker's on purpose. Unset means not
// commissioned: refuse everything rather than serve a name to whoever asks.
function tokenOk(header) {
  const want = process.env.INVENTORY_PORTAL_TOKEN || '';
  if (!want) return false;
  const given = String(header || '').replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── Rate limit ─────────────────────────────────────────────────────────────
// Per token, as the contract asks. One caller holds the token, so this bounds
// what a compromised portal can pull rather than what one visitor can.
const RATE_LIMIT = 240;
const RATE_WINDOW_MS = 60_000;
const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) hits.delete(k);
  }
  const recent = (hits.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > RATE_LIMIT;
}
// Bucketed by a hash of the token, never the token itself — this map is in
// memory and its keys end up in heap dumps.
const tokenBucket = header =>
  crypto.createHash('sha256').update(String(header || '')).digest('hex').slice(0, 16);

// ─── Who owns this car ──────────────────────────────────────────────────────
// The phone numbers that count as proof of ownership for one vehicle.
//
// NOT matched on the consignee's NAME. Two customers called Ahmed Hassan would
// each unlock the other's car, and on the live data the consignee strings
// ("Sara saied", "Moahmed Fawzy") match no customers row at all — so a name
// match would be both unsafe and useless.
//
// Two links are honoured, in order of how much they can be trusted:
//   customer_id  the real link — a foreign key to the row holding the phone
//   phone/cf_phone  the number written on the car itself
//
// Neither is populated today. Until one is, this returns nothing and every
// verification fails closed, which is the correct behaviour for "we cannot
// prove this is yours" — see the note on the route below.
async function ownerPhones(unit) {
  const out = new Set();

  const direct = normalizePhone(unit.phone || unit.cf_phone || '');
  if (direct) out.add(direct);

  const id = parseInt(unit.customer_id, 10);
  if (Number.isFinite(id) && id > 0) {
    try {
      const { data } = await supabase.from('customers')
        .select('phone,phone_norm').eq('id', id).maybeSingle();
      if (data) {
        // Re-normalise rather than trusting the stored column: phone_norm was
        // written by an older normaliser that left 28 records in a form nothing
        // matches. The raw `phone` is the fact; phone_norm is a derived value.
        for (const p of [data.phone_norm, data.phone]) {
          const n = normalizePhone(p);
          if (n) out.add(n);
        }
      }
    } catch (_) { /* an unreachable customers table must fail closed, not open */ }
  }
  return [...out];
}

// ─── 1. Does this phone belong to this VIN? ─────────────────────────────────
// Called once, at registration. The answer is the same 200 and the same body
// for a VIN we do not have, a VIN with no owner recorded, and a VIN whose owner
// has a different number. A 404 for one and a 200 for another is just as good
// an oracle as a different message would be.
receiver.router.post('/api/inventory/verify-owner', express.json({ limit: '8kb' }), async (req, res) => {
  if (!tokenOk(req.headers.authorization)) return res.status(401).json({ error: 'unauthorized' });
  if (rateLimited(tokenBucket(req.headers.authorization))) return res.status(429).json({ error: 'rate-limited' });

  const no = { match: false };
  const body = req.body || {};
  const vin = normVin(body.vin);
  const phone = normalizePhone(body.phone);
  if (!VIN_RE.test(vin) || !phone) return res.json(no);

  let found;
  try {
    found = await findCarByVin(supabase, vin);
  } catch (e) {
    // Failing closed is deliberate. A wrong "no" costs a phone call to the
    // account manager; a wrong "yes" opens somebody's account to a stranger.
    console.error('[portal] verify lookup failed:', (e && e.message) || e);
    return res.json(no);
  }
  if (!found) return res.json(no);

  const owners = await ownerPhones(found.unit);
  return res.json({ match: owners.includes(phone) });
});

// ─── 2. The signed-in customer's own vehicle ────────────────────────────────
// Called for a VIN the portal has already proven the visitor owns. This is the
// PII path, so every call is logged with the VIN and the time.
receiver.router.post('/api/inventory/vehicle', express.json({ limit: '8kb' }), async (req, res) => {
  if (!tokenOk(req.headers.authorization)) return res.status(401).json({ error: 'unauthorized' });
  if (rateLimited(tokenBucket(req.headers.authorization))) return res.status(429).json({ error: 'rate-limited' });

  const vin = normVin((req.body || {}).vin);
  if (!VIN_RE.test(vin)) return res.status(400).json({ error: 'invalid-vin' });

  let found;
  try {
    found = await findCarByVin(supabase, vin);
  } catch (e) {
    console.error('[portal] vehicle lookup failed:', (e && e.message) || e);
    return res.status(500).json({ error: 'lookup-failed' });
  }
  console.log(`[portal] vehicle ${vin} ${found ? 'served' : 'not found'} at ${new Date().toISOString()}`);
  if (!found) return res.status(404).json({ error: 'not-found' });

  const box = await shipmentForVin(supabase, vin);
  res.json({
    vin,
    // The name on the order, which is the whole reason this endpoint is
    // separate from the public one.
    consignee_name: String(found.unit.consignee || '').trim() || null,
    model: modelName(found.row),
    status: customerStatus(found.unit.status),
    status_changed_at: lastUpdated(found.row, box),
    eta: arrivalDate(box, found.unit),
    // Empty, and honestly so. The contract says `[]` means "nothing filed yet",
    // and nothing IS filed: customer paperwork lives as PDFs in a per-CLIENT
    // Google Drive folder (src/routes/client-folder.js), counted rather than
    // enumerated and not addressable per vehicle. The one table that holds
    // drive_file_id is supplier_docs — supplier correspondence, which is
    // exactly what the contract says must never reach a customer.
    documents: [],
  });
  // Deliberately absent: price_list, discounted, supplier, colour, cf_brand,
  // cf_vehicle_file. Adding a field here is a privacy decision, not a
  // formatting one.
});

module.exports = { tokenOk, ownerPhones };
