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
  c('the container-to-vehicle link works from both portals',
    atBothBases('POST', '/containers/:id/units', 'stock.tracking')
    && atBothBases('DELETE', '/containers/:id/units/:unitId', 'stock.tracking'));

  // Nothing may be read without a grant. Inventory's master switch is on for
  // everybody, so a route that forgot its permission would hand the whole team
  // the company's landed costs.
  const ungated = ROUTES.filter(r => !r.perm
    && !/^\/api\/dashboard\/(units|payments|containers)\/:id$/.test(r.path));
  eq('no route is left without a permission', ungated.map(r => r.method + ' ' + r.path), []);

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
