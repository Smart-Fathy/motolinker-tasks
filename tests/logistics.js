// Vehicle register, payments ledger and container tracking.
//
// The pure pieces are exercised directly — the check digit, the cost arithmetic,
// the ledger summary, the sync merge — because those are the parts where being
// quietly wrong costs money rather than throwing. The rest is contract checking:
// the routes are mounted at both bases, the permissions exist and are not
// inherited, and the client's copy of the vocabulary still matches the server's.
const fs = require('fs');

const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const eq = (n, got, want) => c(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const K = require('../src/lib/constants');
const PORTAL   = fs.readFileSync('src/routes/employee-portal.js', 'utf8');
const CLIENT   = fs.readFileSync('public/assets/logistics.js', 'utf8');
const INDEX    = fs.readFileSync('index.js', 'utf8');
const SQL      = fs.readFileSync('migrations/019_units_payments_tracking.sql', 'utf8');

// ── Harness ─────────────────────────────────────────────────────────────────
// The three modules register their routes at require time against src/ctx, so
// the cheapest honest way to check what they mount — and what guards each route
// carries — is to hand them a context whose router records instead of serving.
// This asserts the real route table rather than grepping the source for it.
const ctx = require('../src/ctx');
const ROUTES = [];
const tag = (fn, meta) => Object.assign(fn, meta);
const requireAuth = tag(() => {}, { __guard: 'admin' });
const requireEmployeeAuth = tag(() => {}, { __guard: 'employee' });
const record = method => (path, ...mw) => ROUTES.push({
  method,
  path,
  guard: (mw.find(f => f && f.__guard) || {}).__guard || null,
  perm: (mw.find(f => f && f.__perm) || {}).__perm || null,
});
Object.assign(ctx, {
  express: { json: () => () => {} },
  receiver: { router: { get: record('GET'), post: record('POST'), put: record('PUT'),
                        delete: record('DELETE'), patch: record('PATCH'), use: () => {} } },
  requireAuth,
  requireEmployeeAuth,
  supabase: { from() { throw new Error('tests/logistics.js does not touch the database'); } },
  upload: { single: () => () => {} },
});
ctx.requirePerm = (section, action) => tag(() => {}, { __perm: `${section}.${action}` });

const UNITS = require('../src/routes/vehicle-units');
const PAY   = require('../src/routes/payments');
const CT    = require('../src/routes/containers');

const route = (method, path) => ROUTES.find(r => r.method === method && r.path === path);
const atBothBases = (method, tail, perm) => {
  const a = route(method, '/api/dashboard' + tail);
  const e = route(method, '/api/employee' + tail);
  const ok = a && e && a.guard === 'admin' && e.guard === 'employee'
    && (!perm || (a.perm === perm && e.perm === perm));
  if (!ok) console.log(`   (${method} ${tail}: admin=${JSON.stringify(a)} employee=${JSON.stringify(e)})`);
  return ok;
};

// ── ISO 6346 ────────────────────────────────────────────────────────────────
// CSQU3054383 is the worked example in the standard itself; MSDU7337230 came off
// the carrier screenshot the team is working from today. Both have to validate,
// or the field will reject real numbers.
{
  c('the standard\'s own example validates', K.inspectContainerNo('CSQU3054383').checkOk);
  c('the container from the team\'s screenshot validates', K.inspectContainerNo('MSDU7337230').checkOk);
  eq('and its check digit is computed, not read', K.containerCheckDigit('MSDU7337230'), 0);
  c('a transposed digit is caught', !K.inspectContainerNo('MSDU7337320').checkOk);
  c('a wrong check digit is caught', !K.inspectContainerNo('MSDU7337231').checkOk);
  eq('lower case and spaces normalise', K.inspectContainerNo('msdu 7337230').no, 'MSDU7337230');
  c('a short number is not valid at all', !K.inspectContainerNo('MSDU733723').valid);
  c('letters where digits belong are not valid', !K.inspectContainerNo('MSDUABCDEFG').valid);
  // The letter table is the part that is easy to get subtly wrong, and it is
  // written out in the source rather than computed. So compute it here, from the
  // rule as the standard states it — start at 10 and step, skipping every
  // multiple of 11 — and check the whole alphabet against the shipped table.
  // A typo in one letter shows up as a wrong check digit for every number using
  // it, which is exactly the bug that would look like "the carrier's number is
  // wrong" rather than "our validator is".
  {
    const derived = ch => {
      let v = 10;
      for (let i = 0; i < ch.charCodeAt(0) - 65; i++) { v++; while (v % 11 === 0) v++; }
      return v;
    };
    eq('the rule reproduces the anchors A, K, L, U and V',
      ['A', 'K', 'L', 'U', 'V'].map(derived), [10, 21, 23, 32, 34]);
    // Re-implement the check digit from the derived values and compare across
    // the alphabet in every letter position.
    const independent = no => {
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        const ch = no[i];
        sum += (ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : derived(ch)) * Math.pow(2, i);
      }
      return sum % 11 === 10 ? 0 : sum % 11;
    };
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let agree = true, firstBad = null;
    for (let i = 0; i < LETTERS.length; i++) {
      for (const pos of [0, 1, 2, 3]) {
        const chars = ['A', 'B', 'C', 'U'];
        chars[pos] = LETTERS[i];
        const no = chars.join('') + '1234567';
        if (K.containerCheckDigit(no) !== independent(no)) { agree = false; firstBad = no; }
      }
    }
    c('every letter of the shipped table matches the rule', agree, firstBad ? 'first mismatch ' + firstBad : '');
  }
}

// ── The client's copy of the check digit must agree with the server's ────────
// The browser validates before sending so a typo is caught at the field, which
// means the algorithm exists twice. This is what stops the two drifting.
{
  const src = CLIENT.match(/const LETTER_VALUES = \[[\s\S]*?\];[\s\S]*?function inspectContainerNo\(raw\) \{[\s\S]*?\n  \}/);
  c('the client carries its own check-digit implementation', !!src);
  if (src) {
    // eslint-disable-next-line no-new-func
    const clientInspect = new Function(src[0] + '; return inspectContainerNo;')();
    let same = true;
    for (const n of ['CSQU3054383', 'MSDU7337230', 'MSDU7337231', 'TGHU1234567', 'ABCU7654321', 'MSCU0000000']) {
      const a = clientInspect(n), b = K.inspectContainerNo(n);
      if (a.no !== b.no || a.valid !== b.valid || a.checkOk !== b.checkOk || a.expected !== b.expected) same = false;
    }
    c('client and server agree on every sample number', same);
  }
}

// ── Landed cost ─────────────────────────────────────────────────────────────
{
  const { unitCosts } = UNITS;
  const u = { purchase_cost: 10000, fx_rate: 48.5, freight_cost: 30000, customs_cost: 120000, clearing_cost: 15000, other_cost: 0 };
  eq('landed cost converts the purchase and adds the local charges',
    unitCosts(u).landed_base, 10000 * 48.5 + 165000);
  eq('the purchase leg is reported separately', unitCosts(u).purchase_base, 485000);

  // The one that matters: a purchase with no rate booked is UNKNOWN, not zero.
  // Reporting it as zero would show an imported vehicle as pure profit.
  const noRate = unitCosts({ purchase_cost: 10000, fx_rate: 0, freight_cost: 5000 });
  c('a purchase with no rate reports unknown, never zero', noRate.landed_base === null && noRate.landed_known === false);
  // A vehicle bought for nothing (a demo unit, a warranty replacement) still has
  // real local charges, and those are knowable.
  const freeCar = unitCosts({ purchase_cost: 0, fx_rate: 0, customs_cost: 8000 });
  c('local-only costs are still known when there is no purchase price',
    freeCar.landed_known === true && freeCar.landed_base === 8000);
}

// ── The payments ledger ─────────────────────────────────────────────────────
{
  const { paymentSummary, daysOverdue } = PAY;
  const p = (kind, amount, extra) => ({ kind, amount, amount_base: amount, direction: (extra && extra.direction) || 'in', paid_on: (extra && extra.paid_on) || '2026-01-01', ...(extra || {}) });

  const s = paymentSummary([p('down_payment', 200000), p('instalment', 150000)], 1000000);
  eq('received is the sum of what came in', s.received, 350000);
  eq('outstanding is the agreed price less the net', s.outstanding, 650000);
  eq('collected percent is rounded, not truncated', s.collected_pct, 35);

  const refunded = paymentSummary([p('down_payment', 200000), p('refund', 50000, { direction: 'out' })], 1000000);
  eq('a refund comes back off the net', refunded.net, 150000);
  eq('and is reported on its own', refunded.refunded, 50000);

  // Supplier-side money is cost, not settlement. Counting a freight invoice as a
  // customer payment is how a sale looks paid when nobody has paid.
  const withCost = paymentSummary([p('down_payment', 200000), p('freight', 40000, { direction: 'out' })], 1000000);
  eq('supplier and freight payments do not settle the customer', withCost.net, 200000);
  eq('they are reported as cost instead', withCost.supplier_costs, 40000);

  // A foreign-currency payment is booked at the rate on the day.
  const fx = paymentSummary([{ kind: 'instalment', direction: 'in', amount: 1000, fx_rate: 48.5, amount_base: 48500, paid_on: '2026-02-02' }], 100000);
  eq('a foreign payment settles at its stored base amount', fx.net, 48500);
  // The stored base amount wins over any recomputation, which is the whole point
  // of storing it: the rate has moved since.
  const stale = paymentSummary([{ kind: 'instalment', direction: 'in', amount: 1000, fx_rate: 60, amount_base: 48500, paid_on: '2026-02-02' }], 100000);
  eq('the rate booked on the day is what counts, not today\'s', stale.net, 48500);

  eq('a sale with no price is 0% collected, never NaN', paymentSummary([p('instalment', 5000)], 0).collected_pct, 0);
  c('an unpriced sale is not reported as settled', paymentSummary([], 0).settled === false);
  c('a fully paid sale is settled', paymentSummary([p('final', 1000)], 1000).settled === true);
  eq('overpayment does not drive outstanding negative', paymentSummary([p('final', 1200)], 1000).outstanding, 0);

  eq('a balance past its due date is overdue by whole days', daysOverdue('2026-01-01', 5000, '2026-01-11'), 10);
  eq('nothing owed is never overdue', daysOverdue('2020-01-01', 0, '2026-01-11'), 0);
  // An unsettled sale with no due date is unscheduled, not 20,000 days late.
  eq('no due date means not overdue', daysOverdue('', 5000, '2026-01-11'), 0);
  eq('a future due date is not overdue', daysOverdue('2026-12-01', 5000, '2026-01-11'), 0);
}

// ── Container sync merge ────────────────────────────────────────────────────
{
  const { mergeSynced, mapProviderPayload, sanitizeMoves } = CT;

  eq('a sync fills a blank field', mergeSynced({ eta: '', updated_at: null, last_synced_at: null }, { eta: 'X' }), { eta: 'X' });
  eq('a sync refreshes a field nobody has touched',
    mergeSynced({ eta: 'OLD', last_synced_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }, { eta: 'NEW' }), { eta: 'NEW' });
  // The important one: a person corrected the ETA off a phone call after the last
  // sync, so the carrier's stale value must not overwrite it.
  eq('a sync leaves a hand-edited field alone',
    mergeSynced({ eta: 'CORRECTED', last_synced_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-09T00:00:00Z' }, { eta: 'STALE' }), {});
  // …but still fills anything that was blank on that same hand-edited row.
  eq('and still fills the blanks on a hand-edited row',
    mergeSynced({ eta: 'CORRECTED', vessel_name: '', last_synced_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-09T00:00:00Z' },
      { eta: 'STALE', vessel_name: 'MSC ELISABETTA' }), { vessel_name: 'MSC ELISABETTA' });
  eq('empty values from a provider are ignored', mergeSynced({}, { eta: '', vessel_name: null }), {});

  // The adapter has to cope with each provider's own nesting and naming.
  const mapped = mapProviderPayload({ data: { container: { size_type: "40' HIGH CUBE", imo: '9954747' }, vessel: 'MSC ELISABETTA' }, eta: '2026-09-12T14:00:00Z' });
  eq('provider fields are read through the alias table',
    [mapped.container_type, mapped.vessel_imo, mapped.vessel_name, mapped.eta],
    ["40' HIGH CUBE", '9954747', 'MSC ELISABETTA', '2026-09-12T14:00:00Z']);

  const moves = sanitizeMoves([{ at: '2026-08-15T07:17:00Z', event: 'Departed', place: 'Singapore' },
                               { at: '2026-09-01T00:00:00Z', event: 'In transit', place: 'At sea' }]);
  eq('the port call log comes back newest first', moves.map(m => m.event), ['In transit', 'Departed']);
  eq('junk entries are dropped', sanitizeMoves([{}, null, 'x']).length, 0);
  c('the log is capped', sanitizeMoves(Array.from({ length: 200 }, (_, i) => ({ event: 'e' + i }))).length <= 60);
}

// ── Terminal49: unwrapping JSON:API ─────────────────────────────────────────
// The one that would silently return nothing: JSON:API puts records in a `data`
// ARRAY with related records in `included`, and the generic flatten deliberately
// does not descend into arrays. So Terminal49 needs its own unwrap, and the
// facts are split — the container knows its equipment, the shipment knows the
// vessel, the ports and the ETA.
{
  const P = require('../src/routes/tracking-providers');

  const payload = {
    data: [{
      id: 'c1', type: 'container',
      attributes: { number: 'MSDU7337230', equipment_length: 40, equipment_height: 'high_cube',
                    equipment_type: 'dry', pod_arrived_at: null, pod_discharged_at: null },
      relationships: { shipment: { data: { id: 's1', type: 'shipment' } } },
    }],
    included: [{
      id: 's1', type: 'shipment',
      attributes: { pod_eta_at: '2026-09-20T00:00:00Z', pod_vessel_name: 'MSC ELISABETTA',
                    pod_vessel_imo: '9954747', shipping_line_scac: 'MSCU',
                    port_of_lading_locode: 'SGSIN', port_of_lading_name: 'Singapore',
                    port_of_discharge_locode: 'ITGIT', port_of_discharge_name: 'Gioia Tauro',
                    pol_atd_at: '2026-08-14T23:17:00Z', bill_of_lading_number: 'MEDUXY123456' },
    }],
  };

  const { list, included } = P.t49Records(payload);
  eq('the container comes out of the data array', list.length, 1);
  const shipment = P.t49Related(list[0], included, 'shipment');
  c('its shipment is resolved out of `included`', !!shipment && shipment.id === 's1');

  const f = P.t49Map(list[0], shipment);
  eq('the vessel comes from the shipment', f.vessel_name, 'MSC ELISABETTA');
  eq('so does the IMO', f.vessel_imo, '9954747');
  eq('and both port codes', [f.pol_code, f.pod_code], ['SGSIN', 'ITGIT']);
  eq('and the actual departure', f.atd, '2026-08-14T23:17:00Z');
  eq('and the ETA', f.pod_eta, '2026-09-20T00:00:00Z');
  // Terminal49 splits the size across three fields; the card shows one string,
  // and it should read the way the carrier's own screen does.
  eq('equipment is composed into the label the card shows', f.container_type, "40' HIGH CUBE");
  eq('a plain 20ft box reads as DRY',
    P.t49EquipmentLabel({ equipment_length: 20, equipment_height: 'standard', equipment_type: 'dry' }), "20' DRY");
  eq('a reefer says so',
    P.t49EquipmentLabel({ equipment_length: 40, equipment_height: 'standard', equipment_type: 'reefer' }), "40' REEFER");

  // The latest move is the FURTHEST milestone reached, not the first field with
  // a date on it — otherwise a box sitting on the quay still reads "Departed".
  eq('with only a departure, that is the latest move', f.latest_move, 'Departed — Singapore');
  const arrived = P.t49Map(
    { attributes: { ...payload.data[0].attributes, pod_arrived_at: '2026-09-19T06:00:00Z' } }, shipment);
  eq('once it arrives, arrival outranks departure', arrived.latest_move, 'Arrived — Gioia Tauro');
  const out = P.t49Map(
    { attributes: { ...payload.data[0].attributes, pod_arrived_at: '2026-09-19T06:00:00Z',
                    pod_discharged_at: '2026-09-20T08:00:00Z', pod_full_out_at: '2026-09-22T11:00:00Z' } }, shipment);
  eq('and pick-up outranks both', out.latest_move, 'Picked up — Gioia Tauro');

  // A shipment that never resolved must not throw — a container can exist
  // before its shipment record does.
  const orphan = P.t49Map(list[0], null);
  c('a container with no shipment still maps what it knows',
    orphan.container_type === "40' HIGH CUBE" && orphan.vessel_name === undefined);

  // And the generic adapter must still refuse to descend into arrays, which is
  // exactly why Terminal49 needed its own path.
  const generic = P.mapProviderPayload(payload);
  c('the generic adapter finds nothing in a JSON:API envelope', generic.vessel_name === undefined);
}

// ── Safecube: one response, both feeds ──────────────────────────────────────
// The reason it earns its own adapter rather than an alias entry: the shipment
// carries the milestones AND the vessel AND a lat/lng, so a Safecube setup needs
// no second AIS vendor. The two halves are mapped separately because refresh
// treats them differently — milestones through the hand-edit guard, a position
// as a fresh observation.
//
// The fixture below is the documented GET /shipment response shape, trimmed.
// It is NOT a guess: this adapter previously mapped an invented shape against
// the wrong API entirely, so the test now pins it to what Sinay publishes.
{
  const P = require('../src/routes/tracking-providers');
  const sh = {
    metadata: {
      shipmentType: 'CT', shipmentNumber: 'MSDU7337230', sealine: 'MSCU',
      sealineName: 'Mediterranean Shipping Company (MSC)', shippingStatus: 'IN_TRANSIT',
      updatedAt: '2026-09-01T06:00:00Z', warnings: [],
    },
    route: {
      prepol: { location: null, date: null, actual: false, predictiveEta: null },
      pol: { location: { name: 'Singapore', locode: 'SGSIN' }, date: '2026-08-11T04:18:00Z', actual: true, predictiveEta: null },
      pod: { location: { name: 'Gioia Tauro', locode: 'ITGIT' }, date: '2026-09-20T00:00:00Z', actual: false, predictiveEta: null },
      postpod: { location: null, date: null, actual: false, predictiveEta: null },
    },
    vessels: [{ name: 'MSC ELISABETTA', imo: 9954747, mmsi: 636092123, flag: 'PT' }],
    containers: [{
      number: 'MSDU7337230', isoCode: '45G1', sizeType: "40' High Cube Dry", status: 'IN_TRANSIT',
      events: [
        { description: 'Gate in at Port terminal', eventCode: 'GTIN', status: 'CGI', date: '2026-08-09T07:34:00Z',
          isActual: true, location: { name: 'Singapore', locode: 'SGSIN' }, vessel: null },
        { description: 'Loaded on board', eventCode: 'LOAD', status: 'CLL', date: '2026-08-11T03:51:00Z',
          isActual: true, location: { name: 'Singapore', locode: 'SGSIN' },
          vessel: { name: 'MSC ELISABETTA', imo: 9954747, mmsi: 636092123 } },
        { description: 'Vessel Arrival', eventCode: 'ARRI', status: 'VAD', date: '2026-09-20T00:00:00Z',
          isActual: false, location: { name: 'Gioia Tauro', locode: 'ITGIT' },
          vessel: { name: 'MSC ELISABETTA', imo: 9954747 } },
      ],
    }],
    routeData: {
      routeSegments: [{ path: [{ lat: 1.26, lng: 103.8 }], routeType: 'SEA' }],
      coordinates: { lat: -20.1, lng: 5.0 },
      ais: {
        status: 'OK',
        data: {
          vessel: { name: 'MSC ELISABETTA', imo: 9954747, mmsi: 636092123 },
          lastVesselPosition: { lat: -22.94, lng: 4.31, updatedAt: '2026-09-01T05:12:00Z' },
          updatedAt: '2026-09-01T05:40:00Z',
        },
      },
    },
  };

  const f = P.safecubeMap(sh, 'MSDU7337230');
  eq('the vessel and its IMO map', [f.vessel_name, f.vessel_imo], ['MSC ELISABETTA', 9954747]);
  eq('both ports map', [f.pol_code, f.pol_name, f.pod_code, f.pod_name],
    ['SGSIN', 'Singapore', 'ITGIT', 'Gioia Tauro']);
  eq('the carrier is the full sealine name', f.carrier, 'Mediterranean Shipping Company (MSC)');
  eq('the size type becomes the container type', f.container_type, "40' High Cube Dry");
  eq('the ETA maps', f.pod_eta, '2026-09-20T00:00:00Z');
  // The LAST ACTUAL event is where the box is — the arrival is still a plan.
  // The place is part of the sentence: "Loaded on board" alone, at a
  // transhipment, reads as though the box were loaded for the final leg.
  eq('the latest ACTUAL event is the latest move, named with its port',
    f.latest_move, 'Loaded on board — Singapore');
  eq('…and carries that event’s time, not the response’s', f.latest_move_at, '2026-08-11T03:51:00Z');
  // ATD is a fact about a departure that happened; route.pol.actual says so.
  eq('a confirmed departure becomes the ATD', f.atd, '2026-08-11T04:18:00Z');
  // Looked up by container, the shipmentNumber IS the container. Copying it into
  // bl_number would invent a bill of lading that does not exist.
  c('a container lookup does not invent a BL number', f.bl_number === undefined);
  eq('the port call log is carried over', f.moves.length, 3);
  c('…and an unconfirmed event is labelled rather than passed off as fact',
    f.moves.some(m => /Vessel Arrival \(expected\)/.test(m.event)));

  // DCSA status beats the headline: IN_TRANSIT covers gate-in through the far
  // quay, so the last actual event is the sharper signal.
  eq('the status comes from the last actual event', f.status, 'in_transit');
  const arrived = JSON.parse(JSON.stringify(sh));
  arrived.containers[0].events[2].isActual = true;
  eq('…so a confirmed vessel arrival reads as arrived',
    P.safecubeMap(arrived, 'MSDU7337230').status, 'arrived');
  c('…and once arrived the ETA is dropped rather than kept as a due date',
    (() => { const a2 = JSON.parse(JSON.stringify(sh)); a2.route.pod.actual = true;
             return P.safecubeMap(a2, 'MSDU7337230').eta === undefined; })());

  // A bill of lading can carry several boxes. Mapping the first one onto a row
  // for a different number would be silently wrong rather than loudly wrong.
  const two = JSON.parse(JSON.stringify(sh));
  two.containers.push({ number: 'MSDU7337231', sizeType: "20' Dry", events: [
    { description: 'Gate out', eventCode: 'GTOT', status: 'CGO', date: '2026-09-25T09:00:00Z', isActual: true,
      location: { name: 'Gioia Tauro' } }] });
  eq('the named container is the one mapped', P.safecubeMap(two, 'MSDU7337231').container_type, "20' Dry");
  eq('…with its own status, not its neighbour’s', P.safecubeMap(two, 'MSDU7337231').status, 'cleared');
  eq('…and without a name it falls back to the first', P.safecubeMap(two).container_type, "40' High Cube Dry");

  const pos = P.safecubePosition(sh);
  // lng, not lon — getting that wrong yields a ship in the wrong ocean.
  eq('lat and lng are read into lat/lon', [pos.vessel_lat, pos.vessel_lon], [-22.94, 4.31]);
  eq('the fix carries the vendor and its own time',
    [pos.position_source, pos.vessel_position_at], ['safecube', '2026-09-01T05:12:00.000Z']);
  eq('MMSI comes across as a string', pos.vessel_mmsi, '636092123');
  // The AIS fix and the carrier's coordinate are different claims. AIS wins
  // because it is the one with an age on it.
  c('the AIS fix is preferred over the carrier coordinate',
    pos.vessel_lat === -22.94 && pos.vessel_lat !== -20.1);
  const noAis = JSON.parse(JSON.stringify(sh));
  noAis.routeData.ais = { status: 'NO_AIS_DATA' };
  eq('…and the carrier coordinate is the fallback',
    [P.safecubePosition(noAis).vessel_lat, P.safecubePosition(noAis).vessel_lon], [-20.1, 5.0]);
  c('no coordinates at all means no position',
    P.safecubePosition({ metadata: {} }) === null);
  c('Null Island is refused here too',
    P.safecubePosition({ routeData: { coordinates: { lat: 0, lng: 0 } } }) === null);
  c('an out-of-range fix is refused',
    P.safecubePosition({ routeData: { coordinates: { lat: 91, lng: 4 } } }) === null);
  // This feed reports neither, and a zero would draw a stopped ship facing north.
  c('course and speed are absent rather than invented',
    pos.vessel_course === undefined && pos.vessel_speed === undefined);

  // Sinay runs several APIs behind one key and they are NOT interchangeable.
  // safecube/api/v1 is the PREMIUM Shipment Management product — pointing the
  // tracking adapter at it is what made a valid key answer 403 to everything.
  {
    const PSRC = fs.readFileSync('src/routes/tracking-providers.js', 'utf8');
    c('tracking goes to the Container Tracking API',
      /api\.sinay\.ai\/container-tracking\/api\/v2/.test(PSRC));
    c('…and never to the premium Shipment Management one',
      !/api\.sinay\.ai\/safecube\/api\/v1/.test(PSRC));
    c('registration goes to the Webhook API, which is where it lives',
      /api\.sinay\.ai\/webhook\/api\/v1/.test(PSRC)
      && /easy-shipment-asynchronous/.test(PSRC));
    c('the Safecube base is overridable', /process\.env\.SAFECUBE_BASE_URL/.test(PSRC));
    c('…with a trailing slash trimmed so a set value cannot double up',
      /replace\(\/\\\/\+\$\/, ''\)/.test(PSRC));
    // The connection check must not cost a tracking credit or register anything.
    c('the connection probe uses the free sealines endpoint',
      /\$\{base\}\/sealines/.test(PSRC));
    // Diagnosis is header-then-path, and the second stage only runs once a
    // header has actually been recognised.
    c('the diagnosis separates the header question from the path question',
      /Stage 1: the header/.test(PSRC) && /Stage 2: the path/.test(PSRC));
    c('…and reports a permission limit as its own outcome',
      /stage: 'permission'/.test(PSRC));
  }

  // Auto-detection of the carrier is documented to fail; naming it skips the
  // guess. The hint is optional, threaded from the caller, and defaultable.
  {
    const saved = process.env.SAFECUBE_SEALINE;
    delete process.env.SAFECUBE_SEALINE;
    const q = new URLSearchParams(P.safecubeQuery('MSDU7337230'));
    eq('the lookup asks by container number', q.get('shipmentNumber'), 'MSDU7337230');
    eq('…and says it is a container, not a BL', q.get('shipmentType'), 'CT');
    // route=true is what turns the AIS block on; without it there is no position.
    eq('…and asks for the route, which is what carries AIS', q.get('route'), 'true');
    eq('…and for AIS itself', q.get('ais'), 'true');
    c('no sealine is sent when none is known', q.get('sealine') === null);
    eq('an explicit hint is sent, upper-cased',
      new URLSearchParams(P.safecubeQuery('MSDU7337230', 'mscu')).get('sealine'), 'MSCU');
    process.env.SAFECUBE_SEALINE = 'hlcu';
    eq('…and the environment supplies a default',
      new URLSearchParams(P.safecubeQuery('MSDU7337230')).get('sealine'), 'HLCU');
    eq('…which an explicit hint still beats',
      new URLSearchParams(P.safecubeQuery('MSDU7337230', 'MSCU')).get('sealine'), 'MSCU');
    if (saved == null) delete process.env.SAFECUBE_SEALINE; else process.env.SAFECUBE_SEALINE = saved;
  }

  // A carrier Sinay cannot identify is a 400 with a named code — one missing
  // parameter, not a broken integration, and the UI has to say which.
  eq('an undetectable sealine is its own code',
    P.classify(400, '{"message":"AUTO_CANT_DETECT_SEALINE"}'), 'sealine-unknown');
  eq('an unsupported sealine reads the same way',
    P.classify(400, '{"message":"SEALINE_NOT_SUPPORTED"}'), 'sealine-unknown');
  eq('a rejected number is distinct from a rejected carrier',
    P.classify(400, '{"message":"WRONG_NUMBER"}'), 'bad-number');

  // The register button and the register dispatcher must agree. They used to be
  // two hardcoded lists, and the UI hid the one button that worked.
  {
    const saved = process.env.CONTAINER_TRACKING_PROVIDER;
    for (const [name, expected] of [['safecube', true], ['terminal49', true], ['generic', false], ['', false]]) {
      process.env.CONTAINER_TRACKING_PROVIDER = name;
      eq(`registration is ${expected ? 'offered' : 'withheld'} for ${name || '(none)'}`,
        P.canRegister(), expected);
    }
    if (saved == null) delete process.env.CONTAINER_TRACKING_PROVIDER;
    else process.env.CONTAINER_TRACKING_PROVIDER = saved;
    const CSRC = fs.readFileSync('src/routes/containers.js', 'utf8');
    c('…and the route asks the provider module rather than naming a vendor',
      /can_register: !prov\.ok && providers\.canRegister\(\)/.test(CSRC));
  }

  // Vendors wrap lists differently; the finder looks for shape, not a path.
  const wrapped = P.everyObject({ content: { items: [{ containerNumber: 'X' }] } }, 0, []);
  c('a record is found however it is wrapped', wrapped.some(o => o.containerNumber === 'X'));
}

// ── What a webhook delivery IS, per vendor ──────────────────────────────────
// The two vendors disagree, and flattening that here is what keeps the write
// half of the handler a single path.
//
// Safecube (via Svix) posts a whole SHIPMENT. Reading a container out of it in
// isolation — which this code used to do — throws away the route, the vessel
// and the position, because those live on the shipment and not on the box. The
// result was a delivery that matched, wrote almost nothing, and looked fine.
{
  const shipment = {
    metadata: { shipmentType: 'CT', shipmentNumber: 'MSDU7337230', sealine: 'MSCU',
      sealineName: 'MSC', shippingStatus: 'IN_TRANSIT' },
    route: { pol: { location: { name: 'Singapore', locode: 'SGSIN' }, date: '2026-08-11T04:18:00Z', actual: true },
             pod: { location: { name: 'Gioia Tauro', locode: 'ITGIT' }, date: '2026-09-20T00:00:00Z', actual: false } },
    vessels: [{ name: 'MSC ELISABETTA', imo: 9954747, mmsi: 636092123 }],
    containers: [
      { number: 'MSDU7337230', sizeType: "40' High Cube Dry", events: [
        { description: 'Loaded on board', status: 'CLL', date: '2026-08-11T03:51:00Z', isActual: true,
          location: { name: 'Singapore' }, vessel: { name: 'MSC ELISABETTA', imo: 9954747 } }] },
      { number: 'MSDU7337231', sizeType: "20' Dry", events: [
        { description: 'Gate out', status: 'CGO', date: '2026-09-25T09:00:00Z', isActual: true,
          location: { name: 'Gioia Tauro' } }] },
    ],
    routeData: { ais: { status: 'OK', data: {
      vessel: { name: 'MSC ELISABETTA', mmsi: 636092123 },
      lastVesselPosition: { lat: -22.94, lng: 4.31, updatedAt: '2026-09-01T05:12:00Z' } } } },
  };

  const ups = CT.webhookUpdates('safecube', shipment);
  eq('every container on the shipment becomes an update', ups.map(u => u.no),
    ['MSDU7337230', 'MSDU7337231']);
  const first = ups[0].fields();
  // The proof the shipment is not being thrown away: none of these fields is on
  // the container object at all.
  eq('the shipment-level route reaches the container row',
    [first.pol_code, first.pod_code], ['SGSIN', 'ITGIT']);
  eq('…and so does the vessel', first.vessel_name, 'MSC ELISABETTA');
  eq('…and each box keeps its own events', first.latest_move, 'Loaded on board — Singapore');
  eq('the second box is mapped against its own, not the first’s',
    ups[1].fields().latest_move, 'Gate out — Gioia Tauro');
  eq('the position rides in on the same delivery',
    [ups[0].position().vessel_lat, ups[0].position().vessel_lon], [-22.94, 4.31]);

  // An event with no container in it is a legitimate delivery, not an error.
  eq('a shipment-less event yields nothing to write',
    CT.webhookUpdates('safecube', { type: 'ping' }).length, 0);

  // Terminal49 posts JSON:API, where the container IS the unit and the shipment
  // is a sibling record to be resolved.
  const t49 = {
    data: { type: 'container', id: 'c1', attributes: { number: 'MSDU7337230' },
      relationships: { shipment: { data: { type: 'shipment', id: 's1' } } } },
    included: [{ type: 'shipment', id: 's1', attributes: { pol_locode: 'SGSIN' } }],
  };
  const t = CT.webhookUpdates('terminal49', t49);
  eq('a JSON:API container is still found', t.map(u => u.no), ['MSDU7337230']);
  c('…and its sibling shipment is resolved with it', !!t[0].fields());
  c('…and it claims no position, because that feed carries none',
    t[0].position() === null);

  // The same box named twice in one delivery is one update, not two writes.
  const dup = JSON.parse(JSON.stringify(shipment));
  dup.containers.push({ number: 'MSDU7337230', events: [] });
  eq('a repeated container is written once', CT.webhookUpdates('safecube', dup).length, 2);
}

// ── Telling a dead key apart from an unentitled one ─────────────────────────
// Sinay sells several APIs behind ONE key, so "refused" is ambiguous in a way
// that matters: a key entitled to Webhooks but not Container Tracking is a
// sentence about a PLAN, and a key that is dead everywhere is a sentence about
// the KEY. They need different actions and the app used to say the same thing
// for both.
{
  const PSRC = fs.readFileSync('src/routes/tracking-providers.js', 'utf8');
  c('a refused key is cross-checked against another Sinay product',
    /async function probeWebhookApi/.test(PSRC));
  c('…using a read that lists what exists, so the check registers nothing',
    /\$\{safecubeWebhookBase\(\)\}\/endpoint/.test(PSRC));
  c('…and the verdict says which of the two it is',
    /has no Container Tracking access/.test(PSRC));
  // Only Safecube runs several products off one key; Terminal49 does not, and
  // probing it would be a request that answers nothing.
  c('the cross-check is Safecube-only', /name === 'safecube' \? await probeWebhookApi/.test(PSRC));
}

// ── The POD ETA a sync could never write ────────────────────────────────────
// pod_eta is a DATE column and every carrier feed sends a full ISO timestamp for
// it. The old validator demanded exactly YYYY-MM-DD and refused anything else,
// so pod_eta came back NULL from every sync on every provider while the eta
// timestamp beside it saved fine. The blank column was the visible half; the
// container LIST is ordered by pod_eta, so the invisible half was synced boxes
// sorting after hand-typed ones instead of by when they actually arrive.
{
  const row = b => CT.containerBuildRow({ container_no: 'MSDU7337230', ...b }).row;

  eq('a date picker value is kept as-is', row({ pod_eta: '2026-09-25' }).pod_eta, '2026-09-25');
  eq('an ISO timestamp is narrowed to its date, not thrown away',
    row({ pod_eta: '2026-09-25T00:00:00Z' }).pod_eta, '2026-09-25');
  eq('…including one with an offset', row({ pod_eta: '2026-09-25T23:30:00+02:00' }).pod_eta, '2026-09-25');
  // Still a DATE column: anything that is not one of those two shapes is refused
  // rather than coerced into a plausible-looking wrong day.
  eq('free text is still refused', row({ pod_eta: 'next tuesday' }).pod_eta, null);
  eq('a bare year is still refused', row({ pod_eta: '2026' }).pod_eta, null);
  eq('an impossible date is refused', row({ pod_eta: '2026-13-45T00:00:00Z' }).pod_eta, null);
  eq('empty is null, not today', row({ pod_eta: '' }).pod_eta, null);

  // The whole point: what Safecube sends must survive the round trip.
  const P = require('../src/routes/tracking-providers');
  const mapped = P.safecubeMap({
    metadata: { shipmentType: 'CT', shipmentNumber: 'MSDU7337230', sealineName: 'MSC', shippingStatus: 'IN_TRANSIT' },
    route: { pod: { location: { name: 'Alexandria', locode: 'EGALY' }, date: '2026-09-25T00:00:00Z', actual: false } },
    containers: [{ number: 'MSDU7337230', events: [] }],
  }, 'MSDU7337230');
  eq('the mapper still emits the timestamp it was given', mapped.pod_eta, '2026-09-25T00:00:00Z');
  eq('…and the row now stores a real date for it',
    row({ pod_eta: mapped.pod_eta }).pod_eta, '2026-09-25');

  // The ordering this protects.
  const SRC = fs.readFileSync('src/routes/containers.js', 'utf8');
  c('the container list is ordered by pod_eta, which is why the drop mattered',
    /order\('pod_eta'/.test(SRC));
}

// ── Seeing what the carrier said ────────────────────────────────────────────
// The webhook path logged every delivery; the pull path logged nothing at all,
// so "no data for this box", "your key was refused" and "we could not tell which
// shipping line this is" were one indistinguishable silence from outside the
// process. That is the ambiguity that cost this integration two wrong turns.
{
  const P = require('../src/routes/tracking-providers');
  const PSRC = fs.readFileSync('src/routes/tracking-providers.js', 'utf8');

  c('the pull path has a log of its own', typeof P.logLookup === 'function');
  c('…and the dispatcher is what calls it, so every caller is covered',
    /if \(!r \|\| r\.code !== 'not-configured'\) logLookup\(name, containerNo, r\)/.test(PSRC));

  const said = [];
  const real = console.log;
  console.log = (...a) => said.push(a.join(' '));
  try {
    P.logLookup('safecube', 'MSDU7337230',
      { ok: false, code: 'forbidden', status: 403, reason: 'provider returned 403',
        detail: '{"message":"NO_CREDITS"}' });
    P.logLookup('safecube', 'MSDU7337230',
      { ok: true, fields: { carrier: 'MSC', eta: 'x' }, position: { vessel_lat: 1 } });
  } finally { console.log = real; }

  c('a refusal names the code and the HTTP status', /forbidden/.test(said[0]) && /403/.test(said[0]));
  c('…and carries the vendor’s own words, which are the useful part',
    /NO_CREDITS/.test(said[0]));
  c('a hit says how much came back', /2 field\(s\)/.test(said[1]) && /carrier MSC/.test(said[1]));
  c('…and whether a position rode along with it', /position included/.test(said[1]));
  // The one thing it must never do.
  c('the key is never printed', !said.some(l => /CONTAINER_TRACKING_KEY|sk_|API_KEY:/.test(l)));

  // JSON.stringify(null) is the string "null", and handing a person the word
  // "null" as a vendor's explanation is worse than saying nothing.
  c('an empty error body is reported as nothing, not as the word "null"',
    /detail == null \? '' :/.test(PSRC));
}

// ── Editing a card must not destroy what the sync filled ────────────────────
// containerBuildRow emits EVERY column, and the edit form has inputs for only
// some of them. A full-row PUT therefore wrote moves as [], po_id as null and
// supplier as '' — so correcting one ETA on a synced container silently deleted
// its port-call log, unlinked its purchase order and cleared its supplier.
{
  const SRC = fs.readFileSync('src/routes/containers.js', 'utf8');
  const CL = fs.readFileSync('public/assets/logistics.js', 'utf8');

  c('the PUT writes only the columns the request actually carried',
    /hasOwnProperty\.call\(req\.body \|\| \{\}, k\)\) patch\[k\] = row\[k\]/.test(SRC));
  c('…and the container number is always among them, since it identifies the row',
    /patch\.container_no = row\.container_no/.test(SRC));

  // The three fields with no input. If the form ever grows one, this test should
  // be the thing that notices.
  const form = (CL.match(/const payload = \{[\s\S]*?\n    \};/) || [''])[0];
  c('the edit form still has no input for the port call log', !/\bmoves\b/.test(form));
  c('…nor for the purchase order link', !/\bpo_id\b/.test(form));
  c('…nor for the supplier', !/\bsupplier\b/.test(form));
  c('…which is exactly why the PUT may not write them', /const patch = \{\};/.test(SRC));
}

// ── The port call log, capped from the right end and finally rendered ───────
{
  const SRC = fs.readFileSync('src/routes/containers.js', 'utf8');
  const CL = fs.readFileSync('public/assets/logistics.js', 'utf8');

  // Carriers send events oldest-first. Capping before sorting kept the sixty
  // OLDEST and threw away everything recent — the opposite of a log whose whole
  // point is where the box is now.
  const fn = (SRC.match(/function sanitizeMoves[\s\S]*?\n}/) || [''])[0];
  c('the moves list is sorted before it is capped',
    fn.indexOf('.sort(') >= 0 && fn.indexOf('.slice(0, MOVES_MAX)') > fn.indexOf('.sort('));

  const many = Array.from({ length: 90 }, (_, i) =>
    ({ at: `2026-${String(1 + (i % 12)).padStart(2, '0')}-01T00:00:00Z`, event: `e${i}` }));
  const kept = CT.containerBuildRow({ container_no: 'MSDU7337230', moves: many }).row.moves;
  eq('the cap keeps sixty', kept.length, 60);
  c('…and they are the NEWEST sixty, newest first',
    kept[0].at >= kept[kept.length - 1].at && kept[0].at.startsWith('2026-12'));

  // Stored by every sync since this feature shipped, read by nothing.
  c('the card now renders the port call log', /function movesHtml/.test(CL));
  c('…and it is on the card, not merely defined', /\$\{movesHtml\(c\)\}/.test(CL));
  c('…marking an unconfirmed leg rather than passing a plan off as a fact',
    /logi-move-est/.test(CL) && /expected/.test(CL));
  c('…and both portals can style it',
    /\.logi-moves/.test(fs.readFileSync('public/assets/dashboard.css', 'utf8'))
    && /\.logi-moves/.test(fs.readFileSync('public/assets/employee.css', 'utf8')));
}

// ── Auth shape ──────────────────────────────────────────────────────────────
// A vendor's docs are the only place the header name is written down, and they
// are not always reachable. The key is, though — so the shape is configurable
// and discoverable rather than hard-coded on a guess.
{
  const P = require('../src/routes/tracking-providers');
  const saved = process.env.CONTAINER_TRACKING_KEY;

  // A value pasted into a hosting variable field can carry a stray space, and a
  // vendor answers that with a 401 — which reads as "wrong key" and is not.
  process.env.CONTAINER_TRACKING_KEY = '  sk_abc123\n';
  eq('the key is trimmed before it is ever sent', P.trackingKey(), 'sk_abc123');
  c('…and whitespace alone does not count as configured',
    (process.env.CONTAINER_TRACKING_KEY = '   ', P.trackingKey()) === '');

  // The candidates cover what vendors actually do, and each is distinct — a
  // duplicate would waste a request and muddle the report.
  const shapes = P.AUTH_SHAPES.map(x => x.header + '|' + x.prefix);
  eq('every candidate auth shape is distinct', shapes.length, new Set(shapes).size);
  c('the candidates cover the four common conventions',
    ['API_KEY', 'x-api-key', 'apikey', 'Authorization'].every(h => P.AUTH_SHAPES.some(x => x.header === h)));
  c('and one of them is a Bearer token',
    P.AUTH_SHAPES.some(x => x.header === 'Authorization' && /bearer/i.test(x.prefix)));

  process.env.CONTAINER_TRACKING_KEY = saved || '';
  if (!saved) delete process.env.CONTAINER_TRACKING_KEY;
}

// ── Picking a provider, now that two of them take a bare key ────────────────
{
  const P = require('../src/routes/tracking-providers');
  const set = v => {
    for (const k of ['CONTAINER_TRACKING_URL', 'CONTAINER_TRACKING_KEY', 'CONTAINER_TRACKING_PROVIDER',
      'AIS_TRACKING_URL', 'TRACKING_WEBHOOK_SECRET', 'TERMINAL49_WEBHOOK_SECRET']) delete process.env[k];
    Object.assign(process.env, v);
  };
  set({ CONTAINER_TRACKING_PROVIDER: 'safecube', CONTAINER_TRACKING_KEY: 'k' });
  eq('safecube is selectable', P.containerProviderName(), 'safecube');
  c('…and it supplies positions itself', P.carrierHasPosition() === true);
  eq('…so the status says no AIS vendor is needed',
    P.providerStatus().carrier_has_position, true);
  // A typo must not quietly send a Safecube key to Terminal49's endpoint.
  set({ CONTAINER_TRACKING_PROVIDER: 'safcube', CONTAINER_TRACKING_KEY: 'k' });
  eq('a misspelled provider is "unknown", not a silent fallback', P.containerProviderName(), 'unknown');
  c('…and reports itself unconfigured', P.providerStatus().configured === false);
  set({ CONTAINER_TRACKING_KEY: 'k' });
  eq('a bare key keeps the documented default', P.containerProviderName(), 'terminal49');
  c('…which does not supply positions', P.carrierHasPosition() === false);
  set({ CONTAINER_TRACKING_PROVIDER: 'safecube', CONTAINER_TRACKING_KEY: 'k', TRACKING_WEBHOOK_SECRET: 's' });
  c('the status reports a webhook secret once one is set', P.providerStatus().webhook_ready === true);
  set({});
}

// ── Classifying a vendor's refusal ──────────────────────────────────────────
// The distinction the UI depends on: a key that is WRONG versus a key that is
// RIGHT but on a plan that does not include the call. Terminal49 reports the
// second as a 401 with a billing message, so reading the status alone would send
// somebody hunting for a key that is fine.
{
  const P = require('../src/routes/tracking-providers');
  // The exact body Terminal49 returned on the free Developer Key.
  const freeKey = '[{"detail":"You do not have permissions for using the API, except for creating tracking requests. All other permissions require a paid plan. See https://app.terminal49.com/settings/billing"}]';
  eq('a plan limit is not reported as a bad key', P.classify(401, freeKey), 'plan-required');
  eq('a genuinely bad key is', P.classify(401, '{"detail":"Invalid API token"}'), 'unauthorized');
  // THE distinction, learned the hard way: Safecube answered 403 to API_KEY and
  // 401 to every other header, which identified the header exactly — and read
  // as "all five refused" while these two shared one code.
  //   401 — no credential recognised. Usually the wrong header name.
  //   403 — credential recognised, request refused anyway. The key is fine.
  eq('403 is not 401 — recognised-and-refused is its own answer', P.classify(403, 'forbidden'), 'forbidden');
  c('…so the two are never the same code', P.classify(401, '') !== P.classify(403, ''));
  // A 403 that names the plan is still a plan limit; the text wins over status.
  eq('a 403 naming the plan is still plan-required', P.classify(403, 'upgrade your subscription'), 'plan-required');
  eq('rate limiting is its own answer', P.classify(429, ''), 'rate-limited');
  eq('a vendor outage is its own answer', P.classify(503, ''), 'provider-down');
  eq('anything else is generic', P.classify(422, 'bad scac'), 'error');
  // Every code the server can emit must have a sentence in the client, or the
  // UI falls back to something vague at exactly the moment it needs to be clear.
  const CLIENT_SRC = fs.readFileSync('public/assets/logistics.js', 'utf8');
  const codes = ['not-configured', 'not-tracked-yet', 'plan-required', 'unauthorized', 'forbidden',
    'rate-limited', 'provider-down', 'timeout', 'unreachable', 'not-found'];
  const missing = codes.filter(k => !new RegExp(`['"]?${k}['"]?\\s*:`).test(CLIENT_SRC));
  c('the client names Safecube rather than calling it "the carrier platform"',
    /safecube: 'Safecube'/.test(CLIENT_SRC));
  c('and offers a one-click connection check', /function ctProviderCheck\(/.test(CLIENT_SRC));
  // A recognised-but-refused key must never be described as rejected — that is
  // what sends somebody rotating a key that was never the problem.
  c('a forbidden key is described as valid, not rejected',
    /forbidden: `\$\{label\} recognised the key/.test(CLIENT_SRC));
  c('an unrecognised key says so specifically',
    /unauthorized: `\$\{label\} did not recognise the key/.test(CLIENT_SRC));
  eq('the client has a sentence for every code the server emits', missing, []);
  // And it must not render the vendor's raw JSON as body text.
  c('the vendor blob is a tooltip, not the message',
    /title="\$\{esc\(d\.detail\)\}"/.test(CLIENT_SRC));
}

// ── AIS: mapping a position ─────────────────────────────────────────────────
{
  const P = require('../src/routes/tracking-providers');

  const pos = P.mapAisPayload({ lat: -33.918, lon: 18.423, speed: 14.2, course: 118, timestamp: '2026-09-01T06:00:00Z', mmsi: 636092123 });
  eq('a flat position maps', [pos.vessel_lat, pos.vessel_lon], [-33.918, 18.423]);
  eq('speed and course come across', [pos.vessel_speed, pos.vessel_course], [14.2, 118]);
  eq('the MMSI is kept as a string', pos.vessel_mmsi, '636092123');

  // Vendors report time three different ways, and getting seconds vs
  // milliseconds wrong dates a fix to 1970 or to the year 57000.
  eq('unix seconds are read as seconds', P.aisTime(1788249600), new Date(1788249600000).toISOString());
  eq('unix milliseconds are read as milliseconds', P.aisTime(1788249600000), new Date(1788249600000).toISOString());
  eq('an ISO string passes through', P.aisTime('2026-09-01T06:00:00Z'), '2026-09-01T06:00:00.000Z');
  eq('nonsense is null', P.aisTime('not a time'), null);

  // The three ways a feed says "no fix", each of which would otherwise plot a
  // ship somewhere it has never been.
  c('a missing position is null', P.mapAisPayload({ speed: 12 }) === null);
  c('an out-of-range latitude is refused', P.mapAisPayload({ lat: 200, lon: 18 }) === null);
  c('Null Island is refused', P.mapAisPayload({ lat: 0, lon: 0 }) === null);

  // Several vendors answer with a list of positions; the newest is first.
  const arr = P.mapAisPayload({ data: [{ latitude: 12.5, longitude: -40.1, sog: 18 }] });
  eq('a list-shaped answer maps its first entry', [arr.vessel_lat, arr.vessel_lon, arr.vessel_speed], [12.5, -40.1, 18]);
  const alt = P.mapAisPayload({ AIS: { LAT: 5.5, LON: -3.2, SPEED: 9 } });
  eq('a nested, upper-cased vendor maps too', [alt.vessel_lat, alt.vessel_lon], [5.5, -3.2]);
}

// ── The webhook ─────────────────────────────────────────────────────────────
{
  const CT_SRC = fs.readFileSync('src/routes/containers.js', 'utf8');
  // A plain === on a secret leaks its prefix to anyone willing to time replies.
  c('the webhook secret is compared in constant time', /timingSafeEqual/.test(CT_SRC));
  // An endpoint that answers "wrong secret" has confirmed it is worth attacking.
  c('an unconfigured or wrong secret is a 404, not a 403',
    /webhookSecretOk\(req\.params\.secret\)\) return res\.sendStatus\(404\)/.test(CT_SRC));
  // A webhook that could INSERT would let anyone who learns the URL fill the
  // table; it may only update boxes the team already tracks.
  c('the webhook only updates boxes we already track',
    /if \(cur\.error \|\| !cur\.data\) continue;/.test(CT_SRC)
    && !/webhooks[\s\S]{0,3000}\.insert\(/.test(CT_SRC));
  c('a pushed milestone respects a hand-edited field too',
    /Same hand-edit guard as a pull[\s\S]{0,200}mergeSynced\(cur\.data, built\.row\)/.test(CT_SRC));
  c('the body is size-capped', /express\.json\(\{ limit: '256kb' \}\)/.test(CT_SRC));
}

// ── Which provider is in play ───────────────────────────────────────────────
{
  const P = require('../src/routes/tracking-providers');
  const saved = { u: process.env.CONTAINER_TRACKING_URL, k: process.env.CONTAINER_TRACKING_KEY,
                  p: process.env.CONTAINER_TRACKING_PROVIDER, a: process.env.AIS_TRACKING_URL };
  const set = v => {
    for (const k of ['CONTAINER_TRACKING_URL', 'CONTAINER_TRACKING_KEY', 'CONTAINER_TRACKING_PROVIDER', 'AIS_TRACKING_URL']) delete process.env[k];
    Object.assign(process.env, v);
  };
  set({});
  eq('nothing configured means no provider', P.containerProviderName(), 'none');
  c('…and no AIS', P.aisConfigured() === false);
  set({ CONTAINER_TRACKING_KEY: 'k' });
  eq('a bare key means Terminal49, the documented default', P.containerProviderName(), 'terminal49');
  set({ CONTAINER_TRACKING_URL: 'https://x/{container}' });
  eq('a URL template means the generic adapter', P.containerProviderName(), 'generic');
  set({ CONTAINER_TRACKING_URL: 'https://x/{container}', CONTAINER_TRACKING_PROVIDER: 'terminal49' });
  eq('an explicit choice wins over both', P.containerProviderName(), 'terminal49');
  set({ AIS_TRACKING_URL: 'https://ais/{imo}' });
  c('AIS is configured independently of the carrier feed', P.aisConfigured() === true);
  // The two feeds are separate products; neither may imply the other.
  eq('…and does not turn on a carrier provider', P.containerProviderName(), 'none');
  set({});
  Object.assign(process.env, saved.u ? { CONTAINER_TRACKING_URL: saved.u } : {},
    saved.k ? { CONTAINER_TRACKING_KEY: saved.k } : {},
    saved.p ? { CONTAINER_TRACKING_PROVIDER: saved.p } : {},
    saved.a ? { AIS_TRACKING_URL: saved.a } : {});
}

// ── Validation ──────────────────────────────────────────────────────────────
{
  const { unitBuildRow } = UNITS;
  const { paymentBuildRow } = PAY;
  const { containerBuildRow } = CT;

  c('a unit needs a make and a model', !!unitBuildRow({ make: '', model: 'X' }).error);
  c('a 17-character VIN is accepted', !unitBuildRow({ make: 'A', model: 'B', vin: '1HGCM82633A004352' }).error);
  // I, O and Q were left out of the VIN alphabet because they read as 1 and 0.
  c('a VIN containing O is refused', !!unitBuildRow({ make: 'A', model: 'B', vin: '1HGCM8263OA004352' }).error);
  c('a short VIN is refused', !!unitBuildRow({ make: 'A', model: 'B', vin: '1HGCM82' }).error);
  c('no VIN at all is fine — it arrives later', !unitBuildRow({ make: 'A', model: 'B', vin: '' }).error);
  eq('an unknown status falls back to ordered', unitBuildRow({ make: 'A', model: 'B', status: 'teleported' }).row.status, 'ordered');

  c('a payment needs an amount', !!paymentBuildRow({ amount: 0 }).error);
  // A foreign payment without a rate would be booked as worthless, so it is
  // refused rather than guessed at.
  c('a foreign payment without a rate is refused', !!paymentBuildRow({ amount: 100, currency: 'USD' }).error);
  eq('a base-currency payment is rate 1 whatever was sent',
    paymentBuildRow({ amount: 100, currency: 'EGP', fx_rate: 99 }).row.fx_rate, 1);
  eq('the base amount is stored, not left to the client',
    paymentBuildRow({ amount: 100, currency: 'USD', fx_rate: 48.5 }).row.amount_base, 4850);
  eq('direction follows the kind unless it is given',
    [paymentBuildRow({ amount: 1, kind: 'supplier' }).row.direction, paymentBuildRow({ amount: 1, kind: 'instalment' }).row.direction],
    ['out', 'in']);
  // The receipt column is rendered as a link, so it takes our own uploads only.
  eq('a receipt pointing anywhere but our storage is dropped',
    paymentBuildRow({ amount: 1, receipt: { url: 'javascript:alert(1)', name: 'x' } }).row.receipt, {});

  c('a malformed container number is refused', !!containerBuildRow({ container_no: 'NOPE' }).error);
  const built = containerBuildRow({ container_no: 'msdu 7337230', vessel_imo: 'IMO 9954747', pol_code: 'sgsin' });
  eq('the number is normalised on the way in', built.row.container_no, 'MSDU7337230');
  eq('an IMO keeps only its seven digits', built.row.vessel_imo, '9954747');
  eq('port codes are upper-cased', built.row.pol_code, 'SGSIN');
  // A wrong-but-real number on a bill of lading still has to be trackable, so the
  // check digit is reported and never enforced.
  const odd = containerBuildRow({ container_no: 'MSDU7337231' });
  c('a bad check digit is reported, not refused', !odd.error && odd.check.checkOk === false && odd.check.expected === 0);

  // A position typed in by hand goes through the same guard as one from a feed.
  const pos = containerBuildRow({ container_no: 'MSDU7337230', vessel_lat: '-33.918', vessel_lon: '18.423',
    vessel_course: '118', vessel_speed: '14.2', vessel_mmsi: 'MMSI 636092123' });
  eq('a hand-typed position is kept', [pos.row.vessel_lat, pos.row.vessel_lon], [-33.918, 18.423]);
  eq('an MMSI keeps only its nine digits', pos.row.vessel_mmsi, '636092123');
  const bad = containerBuildRow({ container_no: 'MSDU7337230', vessel_lat: '200', vessel_lon: '18' });
  eq('an impossible latitude is dropped, not stored', bad.row.vessel_lat, null);
  const spun = containerBuildRow({ container_no: 'MSDU7337230', vessel_course: '900' });
  eq('a course outside 0-360 is dropped', spun.row.vessel_course, null);
  const none = containerBuildRow({ container_no: 'MSDU7337230' });
  eq('no position means null, not zero', [none.row.vessel_lat, none.row.vessel_lon], [null, null]);
}

// ── Routes and permissions ──────────────────────────────────────────────────
{
  // Every read and write is mounted once for each portal, behind that portal's
  // guard and the same permission — which is what makes the team portal's copy
  // of a feature identical to the admin's apart from the grant.
  c('the register lists and reads at both bases',
    atBothBases('GET', '/units', 'stock.units') && atBothBases('GET', '/units/:id', 'stock.units'));
  c('the register writes at both bases',
    atBothBases('POST', '/units', 'stock.create') && atBothBases('PUT', '/units/:id', 'stock.edit'));
  c('the ledger reads at both bases',
    atBothBases('GET', '/sales/:id/payments', 'deals.payments') && atBothBases('GET', '/payments', 'deals.payments'));
  c('the ledger writes at both bases',
    atBothBases('POST', '/payments', 'deals.paymentsEdit') && atBothBases('PUT', '/payments/:id', 'deals.paymentsEdit'));
  c('tracking reads at both bases',
    atBothBases('GET', '/containers', 'stock.tracking')
    && atBothBases('GET', '/containers/lookup/:no', 'stock.tracking')
    && atBothBases('GET', '/containers/:id', 'stock.tracking'));
  c('tracking writes at both bases',
    atBothBases('POST', '/containers', 'stock.tracking')
    && atBothBases('PUT', '/containers/:id', 'stock.tracking')
    && atBothBases('POST', '/containers/:id/refresh', 'stock.tracking'));
  // Migrations are applied by hand here, so a deploy can land before the SQL.
  // Without the writeOptional retry, the position columns in every write would
  // take container tracking down until somebody ran the migration.
  {
    const CT_SRC = fs.readFileSync('src/routes/containers.js', 'utf8');
    c('container writes survive migration 020 not being applied yet',
      /POSITION_COLUMNS/.test(CT_SRC)
      && (CT_SRC.match(/ctx\.writeOptional\(/g) || []).length >= 3);
  }
  c('registering a box with the carrier works from both portals',
    atBothBases('POST', '/containers/register', 'stock.tracking'));
  c('the container-to-vehicle link works from both portals',
    atBothBases('POST', '/containers/:id/units', 'stock.tracking')
    && atBothBases('DELETE', '/containers/:id/units/:unitId', 'stock.tracking'));

  // Nothing may be read without a grant. Inventory's master switch is on for
  // everybody, so a route that forgot its permission would hand the whole team
  // the company's landed costs.
  const ungated = ROUTES.filter(r => !r.perm
    && !/^\/api\/dashboard\/(units|payments|containers)\/:id$/.test(r.path)
    // The webhook is public by necessity — Terminal49 has no session with us —
    // and is guarded by a secret in its path instead. Listed explicitly so a
    // second ungated route can never appear by accident.
    && !/^\/api\/webhooks\/(terminal49|safecube)\/:secret$/.test(r.path));
  eq('no route is left without a permission', ungated.map(r => r.method + ' ' + r.path), []);
  c('both vendors post to a secret-guarded webhook, and nothing else is public',
    !!route('POST', '/api/webhooks/terminal49/:secret')
    && !!route('POST', '/api/webhooks/safecube/:secret'));
  c('the connection probe is behind the tracking grant at both bases',
    atBothBases('GET', '/containers/provider-status', 'stock.tracking'));

  // Trying five auth headers is a fine diagnosis and an unacceptable retry
  // policy — five 401s per lookup would get the key rate-limited or locked. It
  // may only run from the probe, and only when the key was actually refused.
  {
    const SRC = fs.readFileSync('src/routes/containers.js', 'utf8');
    const calls = [...SRC.matchAll(/diagnoseAuth\(/g)];
    eq('auth discovery is called exactly once in the codebase', calls.length, 1);
    // 401 and 403 both, and ONLY those two. A refused-but-recognised key is the
    // case the diagnosis exists for; gating it on 401 alone meant the one
    // situation worth diagnosing never got diagnosed.
    c('…and only when the key was refused, on either of the two ways to be refused',
      /probe\.code === 'unauthorized' \|\| probe\.code === 'forbidden'/.test(SRC));
    c('…and not on a merely empty answer, which would spend five requests for nothing',
      !/probe\.code === 'not-tracked-yet'[\s\S]{0,80}diagnoseAuth/.test(SRC));
    // In the provider module it is DEFINED once and never invoked — the export
    // list mentions it by name, which is not a call, so count parenthesised uses.
    const PSRC = fs.readFileSync('src/routes/tracking-providers.js', 'utf8');
    const invoked = [...PSRC.matchAll(/diagnoseAuth\(/g)];
    eq('the provider module defines it and never calls it itself', invoked.length, 1);
    c('…and that one occurrence is the declaration',
      /async function diagnoseAuth\(\)/.test(PSRC));
  }

  // Registration ORDER is load-bearing and a route table alone will not show it:
  // Express matches in order, so a literal path registered after /containers/:id
  // is dead — :id captures it and hands "provider-status" to a BIGSERIAL lookup.
  // Same for /containers/lookup/:no.
  {
    const at = path => ROUTES.findIndex(r => r.method === 'GET' && r.path === path);
    for (const base of ['/api/dashboard', '/api/employee']) {
      const wildcard = at(`${base}/containers/:id`);
      for (const literal of ['/containers/lookup/:no', '/containers/provider-status']) {
        const i = at(base + literal);
        c(`${base}${literal} is registered before /containers/:id can swallow it`,
          i >= 0 && wildcard >= 0 && i < wildcard, `literal@${i} wildcard@${wildcard}`);
      }
    }
    // The same trap on the POST side: /containers/register must beat any
    // POST /containers/:id... pattern that might be added later.
    const reg = ROUTES.findIndex(r => r.method === 'POST' && r.path === '/api/dashboard/containers/register');
    const postId = ROUTES.findIndex(r => r.method === 'POST' && /^\/api\/dashboard\/containers\/:id$/.test(r.path));
    c('POST /containers/register is not shadowed', reg >= 0 && (postId < 0 || reg < postId));
  }

  // Deleting money, or a costed vehicle, stays the admin's alone.
  c('deleting a payment is admin-only',
    route('DELETE', '/api/dashboard/payments/:id') && !route('DELETE', '/api/employee/payments/:id'));
  c('deleting a unit is admin-only',
    route('DELETE', '/api/dashboard/units/:id') && !route('DELETE', '/api/employee/units/:id'));
  c('deleting a container is admin-only',
    route('DELETE', '/api/dashboard/containers/:id') && !route('DELETE', '/api/employee/containers/:id'));

  c('index.js loads all three modules',
    /routes\/vehicle-units/.test(INDEX) && /routes\/payments/.test(INDEX) && /routes\/containers/.test(INDEX));

  c('the new actions are declared on their sections',
    /stock: \[.*'units', 'tracking'\]/.test(PORTAL) && /deals: \[.*'payments', 'paymentsEdit'\]/.test(PORTAL));
  c('the admin editor labels them', /'stock\.units':/.test(PORTAL) && /'deals\.payments':/.test(PORTAL));
  // Cost and supplier routes must not arrive switched on for the whole team the
  // day this deploys, the way `browse` was careful not to.
  c('the register and tracking are never inherited',
    /PERM_ACTION_NEVER_INHERIT[\s\S]*?'stock\.units', 'stock\.tracking'\]/.test(PORTAL));
  c('payments follow the Sales tab an employee already had',
    /'deals\.payments': acts => acts\.sales === true/.test(PORTAL));
}

// ── The vocabulary exists once on each side, and they agree ─────────────────
{
  const clientList = (name) => {
    const m = CLIENT.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
    if (!m) return null;
    // eslint-disable-next-line no-new-func
    return new Function('return [' + m[1] + '];')();
  };
  const keysOf = a => (a || []).map(x => (x && x.key != null ? x.key : x));
  eq('client and server agree on the unit statuses', keysOf(clientList('UNIT_STATUSES')), K.UNIT_STATUS_KEYS);
  eq('client and server agree on the container statuses', keysOf(clientList('CONTAINER_STATUSES')), K.CONTAINER_STATUS_KEYS);
  eq('client and server agree on the container types', clientList('CONTAINER_TYPES'), K.CONTAINER_TYPES);
  eq('client and server agree on the payment kinds', keysOf(clientList('PAYMENT_KINDS')), K.PAYMENT_KIND_KEYS);
  eq('client and server agree on the payment methods', clientList('PAYMENT_METHODS'), K.PAYMENT_METHODS);
  eq('client and server agree on the currencies', clientList('CURRENCIES'), K.CURRENCIES);
  c('the base currency is stated in one place and reused',
    /const BASE_CURRENCY = 'EGP'/.test(CLIENT) && K.BASE_CURRENCY === 'EGP');
}

// ── The migration ───────────────────────────────────────────────────────────
{
  for (const t of ['vehicle_units', 'payments', 'shipment_containers', 'container_units']) {
    c(`migration 019 creates ${t}`, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`).test(SQL));
  }
  c('it can be applied twice', (SQL.match(/CREATE TABLE IF NOT EXISTS/g) || []).length === 4
    && !/CREATE TABLE (?!IF NOT EXISTS)/.test(SQL));
  // Many units have no VIN yet, so a plain UNIQUE would refuse the second one.
  c('the VIN index allows many blanks but no duplicate',
    /CREATE UNIQUE INDEX IF NOT EXISTS vehicle_units_vin_uq[\s\S]*?WHERE vin IS NOT NULL/.test(SQL));
  c('the container link cascades from both sides',
    /container_id[\s\S]*?REFERENCES public\.shipment_containers\(id\) ON DELETE CASCADE/.test(SQL)
    && /unit_id[\s\S]*?REFERENCES public\.vehicle_units\(id\) ON DELETE CASCADE/.test(SQL));
  c('a payment stores the rate it was booked at', /amount_base\s+NUMERIC/.test(SQL) && /fx_rate\s+NUMERIC/.test(SQL));

  // 020: the vessel position columns, in the migration and in the bootstrap.
  {
    const POS = fs.readFileSync('migrations/020_vessel_position.sql', 'utf8');
    const BOOT2 = fs.readFileSync('schema.sql', 'utf8');
    for (const col of ['vessel_lat', 'vessel_lon', 'vessel_position_at', 'vessel_course', 'vessel_speed', 'vessel_mmsi', 'position_source']) {
      c(`020 adds ${col}`, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`).test(POS));
      c(`…and schema.sql has it too`, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`).test(BOOT2));
    }
    c('020 can be applied twice', !/ADD COLUMN (?!IF NOT EXISTS)/.test(POS));
    // The fix carries its own time, separate from the row's updated_at, because
    // the age of a position is what says how much to trust it.
    c('the position has a timestamp of its own', /vessel_position_at\s+TIMESTAMPTZ/.test(POS));
  }
  // schema.sql is the cumulative bootstrap a fresh install pastes (README step
  // 1). A table that lives only in the migration means a new deployment gets
  // 018 and the code has nowhere to write.
  {
    const BOOT = fs.readFileSync('schema.sql', 'utf8');
    for (const t of ['vehicle_units', 'payments', 'shipment_containers', 'container_units']) {
      c(`schema.sql also creates ${t}`, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`).test(BOOT));
      c(`…with RLS on, like every other table here`,
        new RegExp(`ALTER TABLE IF EXISTS public\\.${t} ENABLE ROW LEVEL SECURITY`).test(BOOT));
    }
    c('the migration enables RLS too, so an existing database matches',
      ['vehicle_units', 'payments', 'shipment_containers', 'container_units']
        .every(t => new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`).test(SQL)));
  }
}

// ── Both portals reach it ───────────────────────────────────────────────────
{
  for (const portal of ['dashboard', 'employee']) {
    const html = fs.readFileSync(`public/${portal}.html`, 'utf8');
    c(`${portal} has the three Inventory tabs`,
      /data-tab="models"/.test(html) && /data-tab="units"/.test(html) && /data-tab="tracking"/.test(html));
    c(`${portal} has somewhere to enter a container number`, /id="logi-ct-search"/.test(html));
    c(`${portal} has the register and container panes`,
      /id="logi-units-table"/.test(html) && /id="logi-containers"/.test(html));
  }
  // The team portal hides what the employee was not granted; the admin's is
  // ungated, so it carries no data-perm and must not grow one by accident.
  const emp = fs.readFileSync('public/employee.html', 'utf8');
  c('the team portal gates the two new tabs',
    /data-perm="stock\.units"/.test(emp) && /data-perm="stock\.tracking"/.test(emp));
  c('the sales row offers the ledger behind its permission',
    /procCan\('deals', 'payments'\)[\s\S]{0,200}openPaymentsPanel/.test(fs.readFileSync('public/assets/procurement.js', 'utf8')));
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
