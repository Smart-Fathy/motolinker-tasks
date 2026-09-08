// Helpers that outlived the Vehicle register.
//
// migrations/019 built `vehicle_units` as the home for a physical car, and
// src/routes/vehicle-units.js served it. In practice the register stayed empty:
// every car the team owns lives where they already work, as a unit inside a
// stock_vehicles row. The register's UI and routes are gone; these three pieces
// are not, because they were never about that table —
//
//   dbFail    turns "relation does not exist" into the instruction that fixes it,
//             and is used by container tracking and the payments ledger;
//   normVin   is how a chassis number is written down, everywhere;
//   unitCosts is the landed-cost arithmetic, which is worth keeping correct in
//             one place whichever row it is eventually applied to.
const { BASE_CURRENCY } = require('./constants');

// The tables from 019 are applied by hand, so a deploy can land before the SQL
// does. "relation does not exist" is a useless thing to show a salesperson.
const MISSING_TABLE_RE = /(does not exist|could not find the table|schema cache)/i;
const TABLES_019 = /vehicle_units|payments|shipment_containers|container_units|container_vehicles/;
function dbFail(res, error, what) {
  const msg = String((error && (error.message || error.details)) || 'Database error');
  if (MISSING_TABLE_RE.test(msg) && TABLES_019.test(msg)) {
    const which = /container_vehicles/.test(msg)
      ? { file: 'migrations/020_container_vehicles.sql', id: '020' }
      : { file: 'migrations/019_units_payments_tracking.sql', id: '019' };
    return res.status(503).json({ error: `${what} is not set up yet — apply ${which.file}.`, migration: which.id });
  }
  return res.status(500).json({ error: msg });
}

// A VIN is 17 characters and never contains I, O or Q — those were left out of
// the standard precisely because they read as 1 and 0. Enforced loosely: a
// pre-production car legitimately has no VIN at all, and a supplier's interim
// reference is better stored than refused. Uppercased so lookups match.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
function normVin(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
}

const num = v => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// What a car actually cost, landed, in the base currency.
//
// purchase_cost is in purchase_ccy and fx_rate converts it; freight, customs,
// clearing and other are local charges already in the base currency. A zero
// fx_rate means nobody has booked a rate yet, so the purchase side is reported
// as unknown rather than as zero — a 0 there would quietly show a vehicle as
// pure profit.
function unitCosts(u) {
  const rate = num(u.fx_rate);
  const purchase = num(u.purchase_cost);
  const local = num(u.freight_cost) + num(u.customs_cost) + num(u.clearing_cost) + num(u.other_cost);
  const known = !(purchase > 0 && rate <= 0);
  return {
    purchase_base: rate > 0 ? Math.round(purchase * rate * 100) / 100 : null,
    local_base: Math.round(local * 100) / 100,
    landed_base: known ? Math.round((purchase * rate + local) * 100) / 100 : null,
    landed_known: known,
    base_currency: BASE_CURRENCY,
  };
}

module.exports = { dbFail, normVin, VIN_RE, unitCosts };
