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

// ─── The stored key → what the customer is told ─────────────────────────────
// Keys, not labels: an admin renaming "In transit" in the Columns editor must
// not silently change what a buyer is shown, and keys are the part that does
// not move. The website's own vocabulary is the nine values on the right; it
// maps those onto six milestones (src/lib/tracking/status.ts over there).
const CUSTOMER_STATUS = {
  send_to_supplier:           'acquired',
  in_preparation:             'booked',
  in_logistics:               'manufacturing',
  delivered:                  'in_transit',          // ← not "delivered"
  in_house:                   'in_house',
  off_site:                   'off_site',
  pending:                    'pending',
  delivered_to_client:        'reserved_for_client', // ← not "delivered" either
  delivered_to_client_2:      'delivered_to_client',
  // Neither of these has a value in the website's vocabulary. Both mean the car
  // is in Egypt but not yet in anybody's name, which is what the "Arrived in
  // Egypt" milestone already describes — its own copy mentions customs
  // clearance. Understating progress is the safe direction here: telling
  // somebody their car is ready for handover while it is still being inspected
  // is a promise we might not be able to keep.
  in_customs_clearance:       'in_house',
  in_pre_delivery_inspection: 'in_house',
};

// A status nobody mapped becomes `pending`, which the website renders as
// "Awaiting update — your account manager can tell you where it stands". That
// is both truer and more useful than the "unavailable" it shows for a value it
// does not recognise, which reads as "the website is broken".
function customerStatus(stored) {
  return CUSTOMER_STATUS[String(stored || '').trim()] || 'pending';
}

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

// ─── Finding the car ────────────────────────────────────────────────────────
// Cars live as units inside a stock_vehicles row, so there is no VIN column to
// query. This reads the model list — which is short, one row per make/model/trim
// rather than one per car — and walks its units.
async function findCar(vin) {
  const { data, error } = await supabase.from('stock_vehicles')
    .select('id,make,model,trim,units,updated_at');
  if (error) throw error;
  for (const row of data || []) {
    for (const u of Array.isArray(row.units) ? row.units : []) {
      if (normVin(u.vin) === vin) return { row, unit: u };
    }
  }
  return null;
}

// The box this car is in, if it has been linked to one. This is where a real
// arrival date comes from: the carrier's own ETA, kept current by the tracking
// sync, rather than a date somebody typed weeks ago.
async function shipmentFor(vin) {
  try {
    const { data } = await supabase.from('container_vehicles')
      .select('container_id').eq('vin', vin).limit(1);
    const id = data && data[0] && data[0].container_id;
    if (!id) return null;
    const { data: box } = await supabase.from('shipment_containers')
      .select('pod_eta,last_synced_at').eq('id', id).maybeSingle();
    return box || null;
  } catch (_) {
    // migrations/020 not applied yet. No ETA is a perfectly good answer; the
    // status still tells the customer what they came for.
    return null;
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// The port's own day, not a UTC instant. Alexandria is UTC+3, so a timestamp
// converted in the reader's browser can land on the previous date — and "my car
// arrives on the 27th" when the paperwork says the 28th is a support call.
function arrivalDate(box, unit) {
  if (box && DATE_ONLY.test(String(box.pod_eta || ''))) return String(box.pod_eta);
  const typed = String((unit && unit.logistics) || '').trim();
  return DATE_ONLY.test(typed) ? typed : null;
}

// "Last updated" from the customer's side is the last time anything about their
// car changed — a person editing the row, or the carrier moving the ETA.
function lastUpdated(row, box) {
  const times = [row && row.updated_at, box && box.last_synced_at]
    .map(t => (t ? Date.parse(t) : NaN)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
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
    found = await findCar(vin);
  } catch (e) {
    console.error('[track] lookup failed:', (e && e.message) || e);
    return res.status(500).json({ error: 'lookup-failed' });
  }
  // Same answer whether the VIN is unknown or simply not ours. There is nothing
  // to gain from telling a stranger which is which.
  if (!found) return res.status(404).json({ error: 'not-found' });

  const box = await shipmentFor(vin);
  const model = [found.row.make, found.row.model, found.row.trim]
    .map(s => String(s || '').trim()).filter(Boolean).join(' ') || null;

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
