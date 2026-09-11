// What a customer may be told about their own car, and how to find it.
//
// Two endpoints answer about a vehicle from outside the company: the public VIN
// tracker (src/routes/inventory-track.js) and the signed-in customer portal
// (src/routes/inventory-portal.js). They differ entirely in what they are
// allowed to say — one carries no personal data at all, the other is built to
// carry a name — but they must agree completely on WHERE the car is. A customer
// who reads "In transit" on the public tracker and something else on their own
// portal page has caught us contradicting ourselves about their property.
//
// So the lookup and the status translation live here, once.
const { normVin } = require('./vehicles');

// ─── The stored key → what the customer is told ─────────────────────────────
// Keyed on the stored value, not the label: the labels were rewritten in the
// Columns editor and no longer describe what the key means. Stored `delivered`
// is IN TRANSIT. Stored `delivered_to_client` is RESERVED, not handed over.
// Passing a stored key through would tell a buyer their car had arrived while
// it was still at sea.
//
// The nine values on the right are the website's vocabulary, which maps them
// onto six customer milestones (docs/erp-order-tracking.md in the site repo).
const CUSTOMER_STATUS = {
  send_to_supplier:           'acquired',
  in_preparation:             'booked',
  in_logistics:               'manufacturing',
  delivered:                  'in_transit',
  in_house:                   'in_house',
  off_site:                   'off_site',
  pending:                    'pending',
  delivered_to_client:        'reserved_for_client',
  delivered_to_client_2:      'delivered_to_client',
  // Neither has a value in the website's vocabulary. Both mean the car is in
  // Egypt but not yet in anybody's name, which is what "Arrived in Egypt"
  // already describes. Understating progress is the safe direction: "arrived"
  // is a fact, "ready for handover" is a promise.
  in_customs_clearance:       'in_house',
  in_pre_delivery_inspection: 'in_house',
};

// An unmapped status becomes `pending`, which the site renders as "ask your
// account manager" rather than the "unavailable" it shows for a value it does
// not recognise — truer, and more useful to the person reading it.
function customerStatus(stored) {
  return CUSTOMER_STATUS[String(stored || '').trim()] || 'pending';
}

// ─── Finding the car ────────────────────────────────────────────────────────
// Cars live as units inside a stock_vehicles row, so there is no VIN column to
// index. This reads the model list — one row per make/model/trim, not one per
// car — and walks its units.
async function findCarByVin(supabase, vin) {
  const want = normVin(vin);
  if (!want) return null;
  const { data, error } = await supabase.from('stock_vehicles')
    .select('id,make,model,trim,units,updated_at');
  if (error) throw error;
  for (const row of data || []) {
    for (const u of Array.isArray(row.units) ? row.units : []) {
      if (normVin(u.vin) === want) return { row, unit: u };
    }
  }
  return null;
}

// The box this car is in, when it has been linked to one. This is where a real
// arrival date comes from: the carrier's own ETA, kept current by the tracking
// sync, rather than a date typed in weeks ago.
async function shipmentForVin(supabase, vin) {
  try {
    const { data } = await supabase.from('container_vehicles')
      .select('container_id').eq('vin', normVin(vin)).limit(1);
    const id = data && data[0] && data[0].container_id;
    if (!id) return null;
    const { data: box } = await supabase.from('shipment_containers')
      .select('pod_eta,last_synced_at').eq('id', id).maybeSingle();
    return box || null;
  } catch (_) {
    // migrations/020 not applied. No ETA is a fine answer; the status still
    // tells the customer what they came for.
    return null;
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// The port's own day, not a UTC instant. Alexandria is UTC+3, so a timestamp
// rendered in the reader's browser can land on the previous date — and "my car
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

// The display name of the car. Never the colour, the price or the supplier.
function modelName(row) {
  return [row.make, row.model, row.trim]
    .map(s => String(s || '').trim()).filter(Boolean).join(' ') || null;
}

module.exports = {
  CUSTOMER_STATUS, customerStatus,
  findCarByVin, shipmentForVin, arrivalDate, lastUpdated, modelName,
};
