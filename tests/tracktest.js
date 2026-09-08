// Public order tracking — GET /api/inventory/track
//
// The website's contract lives in the other repo at docs/erp-order-tracking.md.
// Two things here are worth more than the rest of the suite put together: the
// status translation, and the promise that no personal data leaves the process.
const fs = require('fs');
const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const eq = (n, got, want) => c(n, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ── Harness ─────────────────────────────────────────────────────────────────
// The module registers its route at require time against src/ctx, so hand it a
// context whose router records the handler. That gives the REAL handler to call.
const ctx = require('../src/ctx');
const ROUTES = [];
const STOCK = [{
  id: 6, make: 'Deepal', model: 'S05', trim: '620 Max EV', updated_at: '2026-09-01T10:00:00Z',
  units: [{
    vin: 'LS6CME0P7TK504025', status: 'delivered', colour: 'Silver in dual tune black and grey',
    // Everything below is exactly what must never reach a stranger.
    consignee: 'Sara saied', supplier: 'Changan', price_list: 1700000, discounted: 1650000,
    logistics: '2026-09-24', cf_brand: 'Motolinkers',
    cf_vehicle_file: 'https://drive.google.com/drive/folders/1rO6wMGSPoYUbUeVZFFL879Sis450iYLV',
  }],
}];
let LINKS = [{ container_id: 4 }];
let BOX = { pod_eta: '2026-09-28', last_synced_at: '2026-09-06T06:23:16Z' };

const table = name => ({
  select: () => {
    const q = {
      eq: () => q, limit: () => q, maybeSingle: () => q,
      then: (fn) => fn(name === 'stock_vehicles' ? { data: STOCK, error: null }
        : name === 'container_vehicles' ? { data: LINKS, error: null }
        : { data: BOX, error: null }),
    };
    return q;
  },
});
Object.assign(ctx, {
  receiver: { router: { get: (path, h) => ROUTES.push({ path, h }), post: () => {}, put: () => {},
                        delete: () => {}, patch: () => {}, use: () => {} } },
  supabase: { from: table },
});

const TOKEN = 'a'.repeat(64);
process.env.INVENTORY_TRACK_TOKEN = TOKEN;
const M = require('../src/routes/inventory-track');
const handler = ROUTES.find(r => r.path === '/api/inventory/track').h;

// One call through the real handler, with a fake req/res.
async function call({ vin, token = TOKEN, ip = '1.2.3.4' } = {}) {
  const out = { code: 200, body: null };
  const res = {
    status(n) { out.code = n; return this; },
    json(b) { out.body = b; return this; },
  };
  await handler({
    query: { vin },
    headers: { authorization: token === null ? undefined : `Bearer ${token}`, 'cf-connecting-ip': ip },
    ip,
  }, res);
  return out;
}

(async () => {
  // ── The translation, which is where a wrong answer costs the most ─────────
  // The stored keys are the original procurement vocabulary. The labels above
  // them were rewritten in the Columns editor and no longer agree, so the two
  // marked below are the ones that would tell a customer their car had been
  // handed over while it was still at sea.
  const { customerStatus } = M;
  eq('stored `delivered` means IN TRANSIT to a customer', customerStatus('delivered'), 'in_transit');
  eq('stored `delivered_to_client` means RESERVED, not handed over',
    customerStatus('delivered_to_client'), 'reserved_for_client');
  eq('…and the actual handover is the second one', customerStatus('delivered_to_client_2'), 'delivered_to_client');
  eq('the procurement keys map to the early milestones',
    ['send_to_supplier', 'in_preparation', 'in_logistics'].map(customerStatus),
    ['acquired', 'booked', 'manufacturing']);
  eq('the two that carry their own name are unchanged',
    ['in_house', 'off_site', 'pending'].map(customerStatus), ['in_house', 'off_site', 'pending']);
  // Understating progress is the safe direction: "ready for handover" is a
  // promise, "arrived in Egypt" is a fact.
  eq('customs clearance and PDI read as arrived, not as ready',
    ['in_customs_clearance', 'in_pre_delivery_inspection'].map(customerStatus), ['in_house', 'in_house']);
  // The website shows "unavailable" for a status it does not know, which reads
  // as a broken site. `pending` reads as "ask your account manager".
  eq('a status nobody mapped degrades to pending, not to nonsense',
    customerStatus('some_new_status_added_next_year'), 'pending');
  eq('…and so does an empty one', [customerStatus(''), customerStatus(null)], ['pending', 'pending']);

  // Every value this endpoint can emit has to be one the website accepts, or
  // the customer gets "unavailable" from a lookup that actually worked.
  const site = '/home/user/motolinkers/src/lib/tracking/status.ts';
  if (fs.existsSync(site)) {
    const known = (fs.readFileSync(site, 'utf8').match(/ERP_STATUSES = \[([\s\S]*?)\]/) || [, ''])[1]
      .match(/"([a-z_]+)"/g)?.map(s => s.replace(/"/g, '')) || [];
    const emitted = [...new Set(Object.values(M.CUSTOMER_STATUS))];
    eq('every status we emit is one the website understands',
      emitted.filter(s => !known.includes(s)), []);
  }

  // ── Privacy: the whole reason this endpoint is narrow ─────────────────────
  const hit = await call({ vin: 'LS6CME0P7TK504025' });
  eq('a known VIN is found', hit.code, 200);
  eq('…and answers with exactly five fields, no more',
    Object.keys(hit.body).sort(), ['eta', 'model', 'status', 'status_changed_at', 'vin']);
  const blob = JSON.stringify(hit.body);
  for (const [what, leak] of [['the buyer’s name', 'Sara'], ['the supplier', 'Changan'],
                              ['the price', '1700000'], ['the discounted price', '1650000'],
                              ['the document link', 'drive.google.com'], ['the colour', 'Silver']]) {
    c(`the response never carries ${what}`, !blob.includes(leak), blob);
  }

  eq('the car is named by make, model and trim', hit.body.model, 'Deepal S05 620 Max EV');
  eq('the VIN comes back normalised', hit.body.vin, 'LS6CME0P7TK504025');
  eq('the status is the customer’s, not the database’s', hit.body.status, 'in_transit');

  // ── The arrival date ──────────────────────────────────────────────────────
  // The carrier's own ETA beats a date somebody typed, and it is the PORT'S day
  // rather than a UTC instant — Alexandria is UTC+3, so a timestamp rendered in
  // the browser can show the day before, and "arrives the 27th" when the
  // paperwork says the 28th is a support call.
  eq('the arrival date is the carrier’s, not the typed one', hit.body.eta, '2026-09-28');
  eq('…and it is a date, not an instant that can drift a day',
    /^\d{4}-\d{2}-\d{2}$/.test(hit.body.eta), true);
  eq('"last updated" is the most recent of the row and the carrier sync',
    hit.body.status_changed_at, '2026-09-06T06:23:16.000Z');

  // With no container linked, the date the team typed is all there is.
  LINKS = [];
  const typed = await call({ vin: 'LS6CME0P7TK504025' });
  eq('with no shipment linked it falls back to the typed date', typed.body.eta, '2026-09-24');
  eq('…and "last updated" falls back to the row', typed.body.status_changed_at, '2026-09-01T10:00:00.000Z');
  LINKS = [{ container_id: 4 }];

  // ── Auth, shape and the unknown VIN ───────────────────────────────────────
  eq('a wrong token is refused', (await call({ vin: 'LS6CME0P7TK504025', token: 'b'.repeat(64) })).code, 401);
  eq('a missing token is refused', (await call({ vin: 'LS6CME0P7TK504025', token: null })).code, 401);
  eq('a token of the wrong length is refused, not thrown on',
    (await call({ vin: 'LS6CME0P7TK504025', token: 'short' })).code, 401);
  // An uncommissioned endpoint must refuse everything rather than serve openly.
  const saved = process.env.INVENTORY_TRACK_TOKEN;
  delete process.env.INVENTORY_TRACK_TOKEN;
  eq('with no token configured it refuses rather than opening up',
    (await call({ vin: 'LS6CME0P7TK504025' })).code, 401);
  process.env.INVENTORY_TRACK_TOKEN = saved;

  eq('an unknown VIN is a plain 404', (await call({ vin: 'WVWZZZ1JZXW000001' })).code, 404);
  eq('…and says nothing about why', (await call({ vin: 'WVWZZZ1JZXW000001' })).body, { error: 'not-found' });
  // I, O and Q are not in the VIN alphabet; they read as 1 and 0.
  eq('a VIN containing O is rejected before the database is touched',
    (await call({ vin: '1HGCM8263OA004352' })).code, 400);
  eq('a short VIN is rejected', (await call({ vin: 'LS6CME0P7TK' })).code, 400);
  eq('no VIN at all is rejected', (await call({ vin: undefined })).code, 400);
  eq('lower case and punctuation are accepted and normalised',
    (await call({ vin: ' ls6cme0p7tk-504025 ' })).body.vin, 'LS6CME0P7TK504025');

  // ── Rate limit ────────────────────────────────────────────────────────────
  // A VIN is public, so the endpoint is enumerable by anyone holding the token.
  let limited = 0;
  for (let i = 0; i < 70; i++) {
    if ((await call({ vin: 'LS6CME0P7TK504025', ip: '9.9.9.9' })).code === 429) limited++;
  }
  c('a burst from one address is cut off', limited > 0, `${limited} of 70 refused`);
  eq('…and another address is unaffected',
    (await call({ vin: 'LS6CME0P7TK504025', ip: '8.8.8.8' })).code, 200);

  // ── It is not a staff route in disguise ──────────────────────────────────
  const SRC = fs.readFileSync('src/routes/inventory-track.js', 'utf8');
  c('the route carries no dashboard or employee guard',
    !/requireAuth|requireEmployeeAuth|requirePerm/.test(SRC));
  // Assert the registered path, not the source text — the file explains in a
  // comment that it is deliberately not under a portal base, and grepping for
  // the strings finds that sentence.
  eq('…and mounts exactly one route, outside both portal bases',
    ROUTES.map(r => r.path), ['/api/inventory/track']);
  c('the token is compared in constant time', /timingSafeEqual/.test(SRC));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exitCode = results.every(Boolean) ? 0 : 1;
})();
