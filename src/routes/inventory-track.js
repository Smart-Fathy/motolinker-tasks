// Public order tracking — a customer types their VIN on the website and is told
// where their vehicle is.
//
// The website (Smart-Fathy/motolinkers) holds no order data, so its
// /api/track route is a thin proxy in front of this one. The contract is
// written down in that repo at docs/erp-order-tracking.md; this implements it.
//
// Two things make this endpoint unlike every other route in here.
//
// A VIN IS NOT A SECRET. It is etched on the windscreen and stamped on the
// chassis — anyone who can see the car can read it, and it appears on any
// listing that car has ever been in. So treat this as public: it returns NO
// personal data. No consignee, no price, no supplier, no notes, no document
// links. A field that is never transmitted cannot leak, which is a stronger
// guarantee than trusting the caller to drop it.
//
// THE STORED STATUS IS NOT THE CUSTOMER'S STATUS. The keys in the database are
// the original procurement vocabulary; the labels on top of them were rewritten
// in the Columns editor and the two no longer agree. Stored `delivered` means
// IN TRANSIT. Stored `delivered_to_client` means RESERVED for a client. Passing
// the stored key straight through would tell a buyer their car had been handed
// over while it was still on a ship, so the translation below is explicit.
//
// src/ctx.js explains the context object.
const crypto = require('crypto');
const ctx = require('../ctx');
const { receiver, supabase } = ctx.need('receiver', 'supabase');
const { normVin } = require('../lib/vehicles');
// Shared with the customer portal so the two can never disagree about where a
// car is — see the note at the top of that file.
const {
  CUSTOMER_STATUS, customerStatus, findCarByVin, shipmentForVin,
  arrivalDate, lastUpdated, modelName,
} = require('../lib/customer-view');

// ─── Auth ───────────────────────────────────────────────────────────────────
// A shared bearer token, compared in constant time. Unset means the endpoint is
// not commissioned yet: it refuses everything rather than serving openly, and
// the website already treats "no token configured" as "not live" on its side.
function tokenOk(header) {
  const want = process.env.INVENTORY_TRACK_TOKEN || '';
  if (!want) return false;
  const given = String(header || '').replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(given), b = Buffer.from(want);
  // timingSafeEqual throws on a length mismatch, which is itself a timing
  // signal, so compare lengths first and fold the result in.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── Rate limit ─────────────────────────────────────────────────────────────
// The website limits to 12/min per IP, but the token is shared and this process
// is long-lived, so it keeps its own budget. Unlike a Workers isolate this map
// would grow forever, so it is pruned as it goes.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) hits.delete(k);
  }
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

function callerIp(req) {
  return String(req.headers['cf-connecting-ip']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0]
    || req.ip || '').trim() || 'unknown';
}

// ─── The route ──────────────────────────────────────────────────────────────
// Deliberately not under /api/dashboard or /api/employee: this is not a staff
// route wearing a different guard, it is a public endpoint with its own.
receiver.router.get('/api/inventory/track', async (req, res) => {
  if (!tokenOk(req.headers.authorization)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (rateLimited(callerIp(req))) {
    return res.status(429).json({ error: 'rate-limited' });
  }

  const vin = normVin(req.query.vin);
  // The full ISO 6346… no: ISO 3779. Seventeen characters, and never I, O or Q,
  // which were left out of the alphabet because they read as 1 and 0.
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return res.status(400).json({ error: 'invalid-vin' });
  }

  let found;
  try {
    found = await findCarByVin(supabase, vin);
  } catch (e) {
    console.error('[track] lookup failed:', (e && e.message) || e);
    return res.status(500).json({ error: 'lookup-failed' });
  }
  // Same answer whether the VIN is unknown or simply not ours. There is nothing
  // to gain from telling a stranger which is which.
  if (!found) return res.status(404).json({ error: 'not-found' });

  const box = await shipmentForVin(supabase, vin);
  const model = modelName(found.row);

  // Everything this endpoint will ever say about a car. Adding a field here is
  // a privacy decision, not a formatting one.
  res.json({
    vin,
    model,
    status: customerStatus(found.unit.status),
    status_changed_at: lastUpdated(found.row, box),
    eta: arrivalDate(box, found.unit),
  });
});

module.exports = { CUSTOMER_STATUS, customerStatus, arrivalDate, lastUpdated, tokenOk };
