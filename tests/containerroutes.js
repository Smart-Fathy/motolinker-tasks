// Container tracking (the board of boxes on the water, and the vehicles in each), as the server does it — in both portals, which share
// every route and differ only in what is left to the administrator: deleting a box.
//
// The new app's Tracking tab calls these routes as they are: nothing is written twice, so there is nothing to unify yet. This holds
// what the screen may rely on: who may ask for what (one grant, `tracking`, opens all of them — and none of the other four does),
// what a save keeps, cleans and refuses (the number is the only thing required, and its check digit is reported, never enforced; a
// change writes only what it carries), what a look-up, a refresh and a registration say when the carrier is, is not and cannot be
// asked, what the board shows of the cars in a box — and that every answer is the shape packages/contracts says it is. The carrier's
// and the ship-position feeds are stood in for (the routes ask `tracking-providers` for them at the time of the request); what they
// answer is tests/logistics.js. The lists in packages/contracts/src/logistics.js — a box's statuses and sizes, the check on its
// number — are held to the server's own.
const C = require('../packages/contracts');
const { pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');
// The settings of a real carrier are the operator's, not the test's: whatever is in this machine's environment, nothing is configured.
for (const k of ['AIS_TRACKING_HEADER', 'AIS_TRACKING_KEY', 'AIS_TRACKING_NAME', 'AIS_TRACKING_URL', 'CONTAINER_TRACKING_AUTH_PREFIX', 'CONTAINER_TRACKING_FILTER',
  'CONTAINER_TRACKING_HEADER', 'CONTAINER_TRACKING_KEY', 'CONTAINER_TRACKING_NAME', 'CONTAINER_TRACKING_PROVIDER', 'CONTAINER_TRACKING_URL', 'SAFECUBE_BASE_URL',
  'SAFECUBE_ENDPOINT_ID', 'SAFECUBE_SEALINE', 'SAFECUBE_WEBHOOK_BASE_URL', 'TERMINAL49_WEBHOOK_SECRET', 'TRACKING_WEBHOOK_SECRET', 'TERMINAL49_API_KEY', 'SAFECUBE_API_KEY']) delete process.env[k];

const S = C.schemas;
const LOGI = C.logistics;
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const grants = (on, over = {}) => ({ view: on, browse: on, create: on, edit: on, tracking: on, ...over });
const now = () => new Date().toISOString();
const db = createFakeSupabase({
  employees: [], sessions: [], quotation_settings: [], stock_vehicles: [], shipment_containers: [], container_vehicles: [],
// (rows are seeded after the tables are made, so a row made by a route never shares an id with one seeded here)
}, { serial: { shipment_containers: 100 }, defaults: {
  shipment_containers: () => ({
    container_type: '', bl_number: '', carrier: '', status: 'in_transit', latest_move: '', vessel_name: '', vessel_imo: '', pol_code: '', pol_name: '',
    pod_code: '', pod_name: '', moves: [], supplier: '', notes: '', source: 'manual', raw: {}, created_by: 'dashboard', updated_at: now(),
  }),
  container_vehicles: () => ({ linked_at: now(), linked_by: '' }),
} });
db.install();

// A database that answers as one does that is told to refuse, for the one request a test names.
const inject = [];
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  for (const f of inject) if (f.test(url, init || {})) return f.reply(url, init || {});
  return realFetch(input, init);
};
const JSON_HEADERS = { 'Content-Type': 'application/json' };

(async () => {
  const base = await bootApp({ port: process.env.PORT || 4011 });
  const ctx = require(process.cwd() + '/src/ctx');
  const providers = require(process.cwd() + '/src/routes/tracking-providers');
  const server = require(process.cwd() + '/src/lib/constants');
  const T = db.tables;
  // The carrier and ship feeds, as a test says they answer. The routes ask for them by name at the time of the request.
  const REAL = { ...providers };
  const asked = [];
  const stub = over => Object.assign(providers, over);
  // (puts the real ones back and says what the stood-in ones were asked)
  const unstub = () => { Object.assign(providers, REAL); const was = asked.slice(); asked.length = 0; return was; };

  const person = (id, name, ac) => ({
    id, name, username: name.toLowerCase(), email: '', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), job_title: 'Ops',
    permissions: { stock: ac !== false, stockActions: ac || grants(false) }, avatar_url: '', status_text: '', status_emoji: '',
  });
  const SINGLES = ['view', 'browse', 'create', 'edit', 'tracking'];
  T.employees.push(
    person(2, 'Ana', grants(true)),
    person(3, 'Ben', grants(false, { browse: true })),
    person(4, 'Cy', false),
    ...SINGLES.map((g, i) => person(21 + i, 'Only' + g, grants(false, { [g]: true }))),
  );
  const call = async (method, path, { token, body } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch (_) {}
    return { status: r.status, data, text };
  };
  const signIn = async name => (await call('POST', '/api/employee/login', { body: { username: name.toLowerCase(), password: name.toLowerCase() + '-password-1' } })).data.token;
  const lone = {};
  for (const g of SINGLES) lone[g] = await signIn('Only' + g);
  const ana = await signIn('Ana'), ben = await signIn('Ben'), cy = await signIn('Cy');
  ctx.sessions.set('adm', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const D = '/api/dashboard', E = '/api/employee';

  // numbers whose last digit is the one the others call for
  const good = p => p + LOGI.containerCheckDigit(p + '0');
  const N1 = good('MSKU907032'), N2 = good('TGHU123456'), N3 = good('CSQU305438'), N4 = good('HLCU765432');
  const BAD = N4.slice(0, 10) + ((Number(N4[10]) + 1) % 10);
  const MSG = 'A container number is four letters then seven digits, like MSDU7337230.';

  // ═══ What the contract lists is what the server keeps ═══════════════════════
  check('a box\'s statuses are the server\'s, key for key, with the same words and colours', same(LOGI.CONTAINER_STATUSES, server.CONTAINER_STATUSES) && same(LOGI.CONTAINER_STATUS_KEYS, server.CONTAINER_STATUS_KEYS), JSON.stringify(LOGI.CONTAINER_STATUS_KEYS));
  check('…and so are the sizes it can be', same(LOGI.CONTAINER_TYPES, server.CONTAINER_TYPES) && LOGI.CONTAINER_TYPES.length === 11);
  const MANY = Array.from({ length: 120 }, (_, i) => 'MSKU' + String(1000000 + i * 13));   // some of these have a check of 10, which is written 0
  const logiSrc = require('fs').readFileSync('public/assets/logistics.js', 'utf8');
  const classicStatuses = new Function('return ' + logiSrc.match(/const CONTAINER_STATUSES = (\[[\s\S]*?\n  \]);/)[1])();
  const classicTypes = new Function('return ' + logiSrc.match(/const CONTAINER_TYPES = (\[[\s\S]*?\]);/)[1])();
  check('a box\'s statuses and sizes are the classic page\'s too: the same keys in the same order, the same words, the same colours (the classic page paints with the colour alone) and the same sizes',
    same(classicStatuses, LOGI.CONTAINER_STATUSES.map(({ key, label, fg }) => ({ key, label, fg }))) && same(classicTypes, LOGI.CONTAINER_TYPES), JSON.stringify(classicStatuses).slice(0, 80));
  const CORPUS = [...MANY, N1, N2, N3, N4, BAD, 'CSQU3054383', 'csqu3054383', ' csqu-305 4383 ', 'CSQU305438', 'CSQU30543831', 'CSQU30543839999', 'CSQ3054383', '1234567890A', 'ABCD0000000', 'ZZZU9999999', 'UUUU1111111', '', null, undefined, 12345, 'TGHU 123 456 7'];
  const drift = CORPUS.filter(x => !same(LOGI.inspectContainerNo(x), server.inspectContainerNo(x)) || LOGI.normContainerNo(x) !== server.normContainerNo(x));
  check('the check on a container number — its shape, the digit the others call for, whether the last is that digit — comes out the same as the server\'s on every number tried (good ones, wrong digits, loose spellings, too long, too short, nothing)', drift.length === 0, drift.join(' | '));
  check('…and among them are numbers whose check comes out 10, which is written 0', MANY.some(n => LOGI.inspectContainerNo(n).expected === 0 && LOGI.containerCheckDigit(n) === 0) && MANY.filter(n => LOGI.inspectContainerNo(n).checkOk).length > 5);
  check('…and the standard\'s own example is a good one (CSQU3054383), and a number one digit off is valid in shape and not in its check', LOGI.inspectContainerNo('CSQU3054383').checkOk === true && LOGI.inspectContainerNo(BAD).valid === true && LOGI.inspectContainerNo(BAD).checkOk === false && LOGI.inspectContainerNo('CSQU3054383').expected === 3);

  // ═══ Who may ask ════════════════════════════════════════════════════════════
  const doors = [
    ['GET', '/containers'], ['GET', '/containers/lookup/' + N1], ['GET', '/containers/provider-status'], ['GET', '/containers/1'],
    ['POST', '/containers'], ['PUT', '/containers/1'], ['POST', '/containers/1/refresh'], ['POST', '/containers/register'],
    ['POST', '/containers/1/units'], ['DELETE', '/containers/1/units/LGXC76C41P0123456'],
  ];
  const bodyFor = (m) => (m === 'GET' || m === 'DELETE' ? undefined : {});
  const unauth = [];
  for (const [m, p] of doors) {
    const a = await call(m, D + p, { body: bodyFor(m) });
    const b = await call(m, E + p, { body: bodyFor(m) });
    const c = await call(m, E + p, { token: 'adm', body: bodyFor(m) });   // the other portal's token is not a way in either
    const d = await call(m, D + p, { token: ana, body: bodyFor(m) });
    if (a.status !== 401 || b.status !== 401 || c.status !== 401 || d.status !== 401) unauth.push(`${m} ${p}: ${a.status}/${b.status}/${c.status}/${d.status}`);
  }
  check('every route needs the signed-in person of its own portal — nobody is a 401, and so is the other portal\'s token', unauth.length === 0, unauth.join('; '));
  const none = [];
  for (const [m, p] of doors) {
    const r = await call(m, E + p, { token: cy, body: bodyFor(m) });
    if (r.status !== 403) none.push(`${m} ${p}: ${r.status}`);
  }
  check('a team member with the section off is refused every route (403)', none.length === 0, none.join('; '));
  const wrong = [];
  for (const [m, p] of doors) {
    for (const g of SINGLES) {
      const r = await call(m, E + p, { token: lone[g], body: bodyFor(m) });
      const no = r.status === 403;
      if (g === 'tracking' ? no : !no) wrong.push(`${m} ${p} for a member who may only ${g}: ${r.status}`);
    }
  }
  check('one grant opens all ten routes — tracking — and a member with any other single grant (view, browse, create, edit) is refused every one: reading the register or adding a vehicle is no way into the boxes', wrong.length === 0, wrong.slice(0, 4).join('; '));
  const benRead = await call('GET', E + '/containers', { token: ben });
  check('…which a member who may browse the register and nothing else shows plainly: the board is refused', benRead.status === 403 && typeof benRead.data.error === 'string', JSON.stringify(benRead.data));
  const delTeam = await call('DELETE', E + '/containers/1', { token: ana });
  const delMember = await call('DELETE', D + '/containers/1', { token: ana });
  check('deleting a box is the administrator\'s: the team portal has no such route (404), and a member\'s token is refused on the administrator\'s (401)', delTeam.status === 404 && delMember.status === 401, delTeam.status + '/' + delMember.status);

  // ═══ The board ══════════════════════════════════════════════════════════════
  T.stock_vehicles.push({ id: 7, make: 'BYD', model: 'Seal', trim: 'Design', units: [
    { vin: 'LGXC76C41P0123456', colour: 'White', status: 'in_logistics', consignee: 'Hany' },
    { vin: 'LGXC76C41P0123457', colour: 'Grey', status: 'delivered' },
  ] });
  const moves1 = [{ at: '2026-10-02T00:00:00.000Z', event: 'Vessel departure', place: 'Shanghai', vessel: 'MSC AURORA' }, { at: '2026-10-01T10:00:00.000Z', event: 'Gate out', place: 'Shanghai', vessel: '' }];
  T.shipment_containers.push(
    { id: 1, container_no: N1, container_type: "40' HIGH CUBE", bl_number: 'BL-1', carrier: 'MSC', status: 'in_transit', latest_move: 'Departed', latest_move_at: '2026-10-02T00:00:00.000Z', pod_eta: '2026-11-20',
      vessel_name: 'MSC AURORA', vessel_imo: '9876543', pol_code: 'CNSHA', pol_name: 'Shanghai', pod_code: 'EGALY', pod_name: 'Alexandria', atd: '2026-10-02T00:00:00.000Z', eta: '2026-11-19T22:00:00.000Z',
      moves: moves1, po_id: 12, supplier: 'BYD', notes: 'Seals', source: 'manual', last_synced_at: null, raw: {}, created_by: 'dashboard', created_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-01T09:00:00.000Z',
      vessel_lat: null, vessel_lon: null, vessel_position_at: null, vessel_course: null, vessel_speed: null, vessel_mmsi: '', position_source: '' },
    { id: 2, container_no: N2, container_type: "20' DRY", bl_number: '', carrier: '', status: 'arrived', latest_move: '', latest_move_at: null, pod_eta: '2026-11-05', vessel_name: '', vessel_imo: '', pol_code: '', pol_name: '', pod_code: '', pod_name: '',
      atd: null, eta: null, moves: [], po_id: null, supplier: '', notes: '', source: 'manual', last_synced_at: null, raw: {}, created_by: 'employee_2', created_at: '2026-10-02T09:00:00.000Z', updated_at: '2026-10-02T09:00:00.000Z' },
    { id: 3, container_no: N3, container_type: '', bl_number: '', carrier: '', status: 'cleared', latest_move: '', latest_move_at: null, pod_eta: '2026-12-01', vessel_name: '', vessel_imo: '', pol_code: '', pol_name: '', pod_code: '', pod_name: '',
      atd: null, eta: null, moves: [], po_id: null, supplier: '', notes: '', source: 'manual', last_synced_at: null, raw: {}, created_by: 'dashboard', created_at: '2026-10-03T09:00:00.000Z', updated_at: '2026-10-03T09:00:00.000Z' },
  );
  T.container_vehicles.push(
    { container_id: 1, vin: 'LGXC76C41P0123456' }, { container_id: 1, vin: 'unknownvin000001' }, { container_id: 1, vin: 'UNKNOWN-VIN-000001' },
    { container_id: 2, vin: 'LGXC76C41P0123457' },
  );
  const board = await call('GET', E + '/containers', { token: lone.tracking });
  check('a member who may track reads the board, the soonest arrival first, each box with the cars in it — in the shape the contract says',
    board.status === 200 && board.data.map(c => c.id).join() === '2,1,3' && shape(S.ContainerList, board.data) === true, shape(S.ContainerList, board.data) + ' ' + (board.data || []).map(c => c.id));
  const c1 = board.data.find(c => c.id === 1), c2 = board.data.find(c => c.id === 2), c3 = board.data.find(c => c.id === 3);
  check('…a car that is in the register is shown as the register has it (make, model, trim, colour, status, consignee, which vehicle row it is in), one that nobody has recorded as a VIN alone and marked so, and the same VIN written two ways is one car',
    c1.units.length === 2 && same(c1.units[0], { vin: 'LGXC76C41P0123456', stock_id: 7, make: 'BYD', model: 'Seal', trim: 'Design', colour: 'White', status: 'in_logistics', consignee: 'Hany' })
    && same(c1.units[1], { vin: 'UNKNOWNVIN000001', unrecorded: true }) && c2.units.length === 1 && c2.units[0].colour === 'Grey' && c3.units.length === 0, JSON.stringify(c1.units));
  check('…the port-call log, the purchase order and the supplier come with the box', same(c1.moves, moves1) && c1.po_id === 12 && c1.supplier === 'BYD' && c1.pod_eta === '2026-11-20');
  const adminBoard = await call('GET', D + '/containers', { token: 'adm' });
  check('the administrator reads the same board', same(adminBoard.data, board.data));
  const byStatus = await call('GET', E + '/containers?status=arrived', { token: ana });
  const byBogus = await call('GET', E + '/containers?status=nonsense', { token: ana });
  check('the board may be narrowed to one status; a word that is not a status narrows nothing', byStatus.data.map(c => c.id).join() === '2' && byBogus.data.length === 3, byStatus.data.map(c => c.id) + ' / ' + byBogus.data.length);
  const bySearch = await call('GET', E + '/containers?q=' + encodeURIComponent(' ku-9070 '), { token: ana });
  const byNothing = await call('GET', E + '/containers?q=' + encodeURIComponent('---'), { token: ana });
  const noMatch = await call('GET', E + '/containers?q=ZZZZ', { token: ana });
  check('…or to the numbers that contain what was typed — anywhere in the number — however it was written (case, spaces, dashes); symbols alone narrow nothing; no match is an empty board, not an error',
    bySearch.data.map(c => c.id).join() === '1' && byNothing.data.length === 3 && noMatch.status === 200 && same(noMatch.data, []), JSON.stringify([bySearch.data.map(c => c.id), byNothing.data.length, noMatch.data]));
  const one = await call('GET', E + '/containers/1', { token: ana });
  check('one box comes whole with its cars, in the shape the contract says', one.status === 200 && one.data.units.length === 2 && one.data.container_no === N1 && shape(S.Container, one.data) === true, shape(S.Container, one.data));
  const gone = await call('GET', E + '/containers/999', { token: ana });
  check('a box that is not there is an error that says something', gone.status >= 400 && typeof gone.data.error === 'string' && gone.data.error.length > 0, JSON.stringify(gone.data));
  db.missing.add('container_vehicles');
  const noLinks = await call('GET', E + '/containers', { token: ana });
  db.missing.delete('container_vehicles');
  check('before the migration that links cars to boxes the boxes still list, without their cars', noLinks.status === 200 && noLinks.data.length === 3 && noLinks.data.every(c => c.units.length === 0), noLinks.status + ' ' + JSON.stringify(noLinks.data).slice(0, 80));
  db.missing.add('shipment_containers');
  const noTable = await call('GET', E + '/containers', { token: ana });
  db.missing.delete('shipment_containers');
  check('before the migration that makes the boxes there is a 503 that names the file to apply', noTable.status === 503 && /migrations\/019_units_payments_tracking\.sql/.test(noTable.data.error) && noTable.data.migration === '019', JSON.stringify(noTable.data));
  db.failing.add('shipment_containers');
  const down = await call('GET', E + '/containers', { token: ana });
  db.failing.delete('shipment_containers');
  check('a database that is down is a 500 with its words', down.status === 500 && typeof down.data.error === 'string', JSON.stringify(down.data));

  // ═══ Looking one up ═════════════════════════════════════════════════════════
  const bad = await call('GET', E + '/containers/lookup/ABC123', { token: ana });
  check('a number that is not four letters and seven digits is a 400 that says so and what was made of it', bad.status === 400 && bad.data.error === MSG && bad.data.check.valid === false && bad.data.check.no === 'ABC123', JSON.stringify(bad.data));
  const tracked = await call('GET', E + '/containers/lookup/' + encodeURIComponent(' ' + N1.toLowerCase() + ' '), { token: ana });
  check('a box we track is found by its number however it is written, with its cars and what the number\'s check said — in the shape the contract says',
    tracked.status === 200 && tracked.data.found === true && tracked.data.container.id === 1 && tracked.data.container.units.length === 2 && tracked.data.check.checkOk === true && shape(S.ContainerLookup, tracked.data) === true, shape(S.ContainerLookup, tracked.data));
  const wrongDigit = await call('GET', E + '/containers/lookup/' + BAD, { token: ana });
  check('…and the check is reported for a number that fails it, not held against it', wrongDigit.status === 200 && wrongDigit.data.found === false && wrongDigit.data.check.valid === true && wrongDigit.data.check.checkOk === false && wrongDigit.data.check.expected === Number(N4[10]), JSON.stringify(wrongDigit.data.check));
  const rows0 = T.shipment_containers.length;
  const unknown = await call('GET', E + '/containers/lookup/' + N4, { token: ana });
  check('a box we do not track, with no carrier set up, says so — nothing to prefill, nothing to register — and is not saved by being looked for',
    unknown.status === 200 && same(unknown.data, { found: false, check: { no: N4, valid: true, checkOk: true, expected: Number(N4[10]) }, prefill: null, provider: 'not-configured', code: 'not-configured', detail: null, provider_name: 'none', can_register: false })
    && shape(S.ContainerLookup, unknown.data) === true && T.shipment_containers.length === rows0, JSON.stringify(unknown.data));
  stub({ canRegister: () => true, lookupContainer: async no => { asked.push(no); return { ok: true, fields: { carrier: 'MSC', vessel_name: 'MSC AURORA II', status: 'in_transit', pod_eta: '2026-12-10' }, raw: { x: 1 } }; } });
  const found = await call('GET', E + '/containers/lookup/' + N4.toLowerCase(), { token: ana });
  const seenFound = unstub();
  check('a box we do not track but the carrier knows is offered as a prefill for the form — what the carrier said, as it said it — and is still not saved; the carrier is asked for the clean number; there is nothing to register for a box the carrier already knows',
    found.data.found === false && same(found.data.prefill, { carrier: 'MSC', vessel_name: 'MSC AURORA II', status: 'in_transit', pod_eta: '2026-12-10' }) && found.data.provider === 'ok' && found.data.code === 'ok' && found.data.detail === null && found.data.can_register === false
    && T.shipment_containers.length === rows0 && same(seenFound, [N4]) && shape(S.ContainerLookup, found.data) === true, JSON.stringify(found.data) + ' ' + seenFound.join());
  stub({ lookupContainer: async () => ({ ok: false, status: 401, code: 'unauthorized', reason: 'provider returned 401', detail: 'Invalid key' }), canRegister: () => true, containerProviderName: () => 'terminal49' });
  const refusedKey = await call('GET', E + '/containers/lookup/' + N4, { token: ana });
  unstub();
  check('a carrier that refuses the key is told as a word the screen can turn into a sentence, with what the carrier said and which carrier it was — and registering is offered where the carrier takes registrations',
    refusedKey.data.found === false && refusedKey.data.prefill === null && refusedKey.data.code === 'unauthorized' && refusedKey.data.detail === 'Invalid key' && refusedKey.data.provider === 'provider returned 401' && refusedKey.data.provider_name === 'terminal49' && refusedKey.data.can_register === true && shape(S.ContainerLookup, refusedKey.data) === true,
    JSON.stringify(refusedKey.data));
  stub({ lookupContainer: async () => ({ ok: false }) });
  const silent = await call('GET', E + '/containers/lookup/' + N4, { token: ana });
  unstub();
  check('a feed that fails without a word is "error", with nothing else to say — the answer is still one the contract reads', silent.data.found === false && silent.data.code === 'error' && silent.data.detail === null && silent.data.prefill === null && !('provider' in silent.data) && shape(S.ContainerLookup, silent.data) === true, JSON.stringify(silent.data));
  stub({ lookupContainer: async () => ({ ok: false, code: 'not-tracked-yet', reason: 'not-tracked-yet' }), canRegister: () => false });
  const notYet = await call('GET', E + '/containers/lookup/' + N4, { token: ana });
  unstub();
  check('…and not where it does not', notYet.data.code === 'not-tracked-yet' && notYet.data.can_register === false);
  stub({ lookupContainer: async () => { asked.push('lookup'); return { ok: true, fields: {} }; } });
  const inBoard = await call('GET', E + '/containers/lookup/' + N1, { token: ana });
  const seenBoard = unstub();
  check('a box we already track is not asked of the carrier at all', inBoard.data.found === true && seenBoard.length === 0, seenBoard.join());

  // ═══ The carrier test ═══════════════════════════════════════════════════════
  const st = await call('GET', E + '/containers/provider-status', { token: ana });
  check('what the settings amount to, with nothing set up: no carrier, no ship feed, no webhook — in the shape the contract says',
    st.status === 200 && same(st.data, { provider: 'none', configured: false, auth_header: 'API_KEY', carrier_has_position: false, ais: 'not-configured', webhook_ready: false }) && shape(S.ContainerProviderStatus, st.data) === true, JSON.stringify(st.data));
  stub({ lookupContainer: async no => { asked.push(no); return { ok: true, fields: {} }; } });
  await call('GET', E + '/containers/provider-status', { token: ana });
  const noProbe = unstub();
  check('…reading it asks the carrier nothing (a real call costs a shipment on a metered plan)', noProbe.length === 0, noProbe.join());
  const probeNone = await call('GET', E + '/containers/provider-status?probe=1', { token: ana });
  check('probing with no carrier set up says the carrier is not configured and not reachable', probeNone.data.probe === 'not-configured' && probeNone.data.reachable === false && probeNone.data.http === null && probeNone.data.detail === 'not-configured' && shape(S.ContainerProviderStatus, probeNone.data) === true, JSON.stringify(probeNone.data));
  const probes = {};
  for (const [name, answer] of Object.entries({
    ok: { ok: true, fields: {} },
    notYet: { ok: false, code: 'not-tracked-yet', reason: 'not-tracked-yet', status: 200 },
    notFound: { ok: false, code: 'not-found', reason: 'provider returned 404', status: 404 },
    unauthorized: { ok: false, code: 'unauthorized', reason: 'provider returned 401', status: 401, detail: 'Invalid key' },
    forbidden: { ok: false, code: 'forbidden', reason: 'provider returned 403', status: 403, detail: 'No access' },
    timeout: { ok: false, code: 'timeout', reason: 'provider timed out' },
  })) {
    stub({ lookupContainer: async no => { asked.push(no); return answer; }, diagnoseAuth: async () => ({ ok: false, stage: 'header', attempts: [] }) });
    probes[name] = (await call('GET', E + '/containers/provider-status?probe=1', { token: ana })).data;
    unstub();
  }
  check('a probe writes nothing', T.shipment_containers.length === 3);
  check('…a carrier that answers, or says it does not watch that box yet or has no such box, has been reached (the key is read); one that refuses the key, refuses the account or does not answer has not',
    probes.ok.reachable === true && probes.notYet.reachable === true && probes.notFound.reachable === true && probes.unauthorized.reachable === false && probes.forbidden.reachable === false && probes.timeout.reachable === false
    && probes.ok.probe === 'ok' && probes.notYet.probe === 'not-tracked-yet' && probes.timeout.probe === 'timeout', JSON.stringify(Object.values(probes).map(p => [p.probe, p.reachable])));
  check('…what the carrier said comes with it (its http status and its words), and a refused key or account also comes with the diagnosis of which header the carrier reads — nothing else does',
    probes.unauthorized.http === 401 && probes.unauthorized.detail === 'Invalid key' && probes.unauthorized.auth.stage === 'header' && probes.forbidden.auth && !('auth' in probes.timeout) && !('auth' in probes.ok) && probes.ok.detail === null && Object.values(probes).every(p => shape(S.ContainerProviderStatus, p) === true),
    JSON.stringify(Object.values(probes).map(p => shape(S.ContainerProviderStatus, p))));
  const seenProbe = [];
  stub({ lookupContainer: async no => { seenProbe.push(no); return { ok: true, fields: {} }; } });
  await call('GET', E + '/containers/provider-status?probe=1', { token: ana });
  unstub();
  check('…and the container it reads is the standard\'s example number, CSQU3054383', same(seenProbe, ['CSQU3054383']), seenProbe.join());

  // ═══ Adding ═════════════════════════════════════════════════════════════════
  const rowsBefore = T.shipment_containers.length;
  const noNumber = await call('POST', E + '/containers', { token: ana, body: { container_no: 'ABC123', carrier: 'MSC' } });
  const noNumber2 = await call('POST', E + '/containers', { token: ana, body: { carrier: 'MSC' } });
  check('a box needs a number of four letters and seven digits (400, and the words to say so), and nothing is written without one', noNumber.status === 400 && noNumber.data.error === MSG && noNumber2.status === 400 && T.shipment_containers.length === rowsBefore, JSON.stringify([noNumber.data, noNumber2.data]));
  const added = await call('POST', E + '/containers', { token: ana, body: {
    container_no: ' ' + N4.slice(0, 4).toLowerCase() + '-' + N4.slice(4) + ' ', container_type: "40' HIGH CUBE", bl_number: ' BL 77 ', carrier: ' Hapag ', status: 'booked', latest_move: ' Gate in ', latest_move_at: '2026-10-05T08:00:00+03:00',
    pod_eta: '2026-11-20T08:00:00+03:00', vessel_name: ' EVER GIVEN ', vessel_imo: 'IMO 9 876 543 21', pol_code: ' cnsha ', pol_name: 'Shanghai', pod_code: 'egaly', pod_name: 'Alexandria', atd: '2026-10-02', eta: '2026-11-19T22:00:00Z',
    vessel_lat: 31.2, vessel_lon: -122.4, vessel_position_at: '2026-10-30T12:00:00Z', vessel_course: 90, vessel_speed: 14.5, vessel_mmsi: '636-012-345-99', position_source: 'ais', po_id: '12', supplier: ' BYD ', notes: ' Seals ',
    source: 'carrier', raw: { x: 1 }, id: 9999 } });
  const arow = T.shipment_containers.find(r => r.container_no === N4);
  check('adding keeps the number as the carrier writes it (capitals, no spaces or dashes), files the box under the member, and answers it with what the number\'s check said — in the shape the contract says',
    added.status === 200 && arow && added.data.id === arow.id && arow.id !== 9999 && arow.created_by === 'employee_2' && added.data.check.checkOk === true && shape(S.ContainerSaved, added.data) === true, shape(S.ContainerSaved, added.data) + ' ' + JSON.stringify(arow && arow.created_by));
  check('…the other fields are cleaned the way the carrier\'s card is read: texts trimmed, a size and a status kept (a status that is not one of the six is "in transit"), codes in capitals, the IMO number as its seven digits, the MMSI as its nine, the POD ETA as the date the vendor wrote, the times as instants, the purchase order as a number',
    arow.container_type === "40' HIGH CUBE" && arow.bl_number === 'BL 77' && arow.carrier === 'Hapag' && arow.status === 'booked' && arow.vessel_imo === '9876543' && arow.pol_code === 'CNSHA' && arow.pod_code === 'EGALY' && arow.vessel_mmsi === '636012345'
    && arow.pod_eta === '2026-11-20' && arow.latest_move_at === '2026-10-05T05:00:00.000Z' && arow.atd === '2026-10-02T00:00:00.000Z' && arow.eta === '2026-11-19T22:00:00.000Z' && arow.po_id === 12 && arow.supplier === 'BYD' && arow.notes === 'Seals' && arow.latest_move === 'Gate in' && arow.vessel_name === 'EVER GIVEN', JSON.stringify(arow));
  check('…where the ship is is kept as given when it can be a place (latitude within 90, longitude within 180) and a course within 360, and what source and when come with it; nothing the body says about the row\'s own bookkeeping (its id, where it came from, what the carrier last said) is taken',
    arow.vessel_lat === 31.2 && arow.vessel_lon === -122.4 && arow.vessel_course === 90 && arow.vessel_speed === 14.5 && arow.vessel_position_at === '2026-10-30T12:00:00.000Z' && arow.position_source === 'ais' && arow.source === 'manual' && !('last_synced_at' in arow && arow.last_synced_at) && same(arow.raw, {}), JSON.stringify([arow.source, arow.raw]));
  const odd = await call('POST', D + '/containers', { token: 'adm', body: {
    container_no: good('GESU123456'), container_type: 'Odd 53ft pallet-wide special', status: 'nonsense', pod_eta: 'next week', eta: 'soon', atd: '', vessel_lat: 95, vessel_lon: 181, vessel_course: 361, vessel_speed: 61, vessel_imo: 'n/a', po_id: 'abc',
    moves: [{ at: '2026-10-01', event: ' A ' }, { at: '2026-10-03T00:00:00Z', event: 'B', place: 'P', vessel: 'V' }, {}, 'text', null, { at: '', event: '', place: '' }, { place: 'only a place' }] } });
  const orow = T.shipment_containers.find(r => r.id === odd.data.id) || {};
  check('a size the list does not have is kept as typed, a status it does not know is "in transit", a date that is not one is none, a position that cannot be one is none (out of range — and 0,0 is a broken feed\'s, though not tested here), an IMO that is not digits is empty, a purchase order that is not a number is none',
    odd.status === 200 && orow.container_type === 'Odd 53ft pallet-wide special' && orow.status === 'in_transit' && orow.pod_eta === null && orow.eta === null && orow.atd === null && orow.vessel_lat === null && orow.vessel_lon === null && orow.vessel_course === null && orow.vessel_speed === null && orow.vessel_imo === '' && orow.po_id === null && orow.created_by === 'dashboard', JSON.stringify(orow.id ? orow : odd));
  check('…the port-call log keeps the lines that say something — the newest first — and drops the rest', same(orow.moves, [
    { at: '2026-10-03T00:00:00.000Z', event: 'B', place: 'P', vessel: 'V' }, { at: '2026-10-01T00:00:00.000Z', event: 'A', place: '', vessel: '' }, { at: '', event: '', place: 'only a place', vessel: '' }]), JSON.stringify(orow.moves));
  const odd3 = await call('POST', D + '/containers', { token: 'adm', body: { container_no: good('FCIU123456'), pod_eta: '2026-13-45T00:00:00Z', vessel_lat: -95, vessel_lon: -181, vessel_course: -1, vessel_speed: -1 } });
  const orow3 = T.shipment_containers.find(r => r.id === odd3.data.id) || {};
  check('…and going the other way: a date-time that is not a date, a latitude below −90, a longitude below −180, a course or a speed below nothing are none', odd3.status === 200 && orow3.pod_eta === null && orow3.vessel_lat === null && orow3.vessel_lon === null && orow3.vessel_course === null && orow3.vessel_speed === null, JSON.stringify(orow3.id ? orow3 : odd3));
  const lots = Array.from({ length: 70 }, (_, i) => ({ at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), event: 'e' + i }));
  const many = await call('POST', E + '/containers', { token: ana, body: { container_no: good('MRKU555555'), moves: lots } });
  const mrow = T.shipment_containers.find(r => r.id === many.data.id);
  check('…and keeps sixty at most — the sixty newest, not the sixty oldest', mrow.moves.length === 60 && mrow.moves[0].event === 'e69' && mrow.moves[59].event === 'e10', mrow.moves.length + ' ' + mrow.moves[0].event + ' ' + mrow.moves[59].event);
  const off = await call('POST', E + '/containers', { token: ana, body: { container_no: BAD } });
  check('a number whose last digit is not the one the others call for is saved all the same, and the answer says so and what the digit should have been', off.status === 200 && off.data.check.valid === true && off.data.check.checkOk === false && off.data.check.expected === Number(N4[10]) && T.shipment_containers.some(r => r.container_no === BAD), JSON.stringify(off.data.check));
  inject.push({ test: (u, i) => /\/rest\/v1\/shipment_containers/.test(u) && i.method === 'POST', reply: () => new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "shipment_containers_container_no_key"' }), { status: 409, headers: JSON_HEADERS }) });
  const dup = await call('POST', E + '/containers', { token: ana, body: { container_no: N1 } });
  inject.length = 0;
  check('a number that is already on the board is a 409 that says which', dup.status === 409 && dup.data.error === `${N1} is already being tracked.`, JSON.stringify(dup.data));
  for (const r of [orow, orow3, mrow, T.shipment_containers.find(r => r.container_no === BAD)]) if (T.shipment_containers.includes(r)) T.shipment_containers.splice(T.shipment_containers.indexOf(r), 1);

  // ═══ Changing ═══════════════════════════════════════════════════════════════
  const stamp = '2001-01-01T00:00:00.000Z';
  T.shipment_containers.find(r => r.id === 1).updated_at = stamp;
  const upd = await call('PUT', E + '/containers/1', { token: ana, body: { container_no: N1.toLowerCase(), pod_eta: '2026-11-22', notes: ' corrected ' } });
  const urow = T.shipment_containers.find(r => r.id === 1);
  check('a change writes what it carries — here the number, an ETA and a note — and nothing else: the port-call log, the purchase order, the supplier, the vessel and the rest are as they were; the time is stamped; the answer is the box with the check, in the shape the contract says',
    upd.status === 200 && urow.pod_eta === '2026-11-22' && urow.notes === 'corrected' && same(urow.moves, moves1) && urow.po_id === 12 && urow.supplier === 'BYD' && urow.vessel_name === 'MSC AURORA' && urow.carrier === 'MSC' && urow.status === 'in_transit' && urow.updated_at > stamp
    && upd.data.check.checkOk === true && shape(S.ContainerSaved, upd.data) === true, shape(S.ContainerSaved, upd.data) + ' ' + JSON.stringify(urow));
  const clear = await call('PUT', E + '/containers/1', { token: ana, body: { container_no: N1, moves: [], po_id: '', supplier: '', status: 'nonsense' } });
  check('…and what it carries is written even when it is empty (the log cleared, the purchase order taken off, the supplier blanked), cleaned as a save is (a status that is not one is "in transit")', clear.status === 200 && same(urow.moves, []) && urow.po_id === null && urow.supplier === '' && urow.status === 'in_transit');
  const renumber = await call('PUT', E + '/containers/1', { token: ana, body: { container_no: N3 } });
  check('…and the number is always among it: a change with another number renumbers the box', renumber.status === 200 && urow.container_no === N3);
  await call('PUT', E + '/containers/1', { token: ana, body: { container_no: N1 } });
  const putBad = await call('PUT', E + '/containers/1', { token: ana, body: { container_no: 'x', notes: 'no' } });
  check('a change without a good number is a 400 and writes nothing', putBad.status === 400 && putBad.data.error === MSG && urow.notes === 'corrected');
  const putGone = await call('PUT', E + '/containers/999', { token: ana, body: { container_no: N1 } });
  check('a change to a box that is not there is an error that says something', putGone.status >= 400 && typeof putGone.data.error === 'string' && putGone.data.error.length > 0, JSON.stringify(putGone.data));

  // ═══ Asking the carrier again ═══════════════════════════════════════════════
  const reset = () => Object.assign(T.shipment_containers.find(r => r.id === 1), {
    container_no: N1, status: 'in_transit', pod_eta: '2026-11-20', vessel_name: 'MSC AURORA', carrier: '', latest_move: 'Departed', moves: moves1, source: 'manual', last_synced_at: '2026-10-10T00:00:00.000Z', updated_at: '2026-10-10T00:00:00.000Z',
    vessel_lat: null, vessel_lon: null, vessel_position_at: null, vessel_course: null, vessel_speed: null, vessel_mmsi: '', position_source: '', raw: {}, notes: 'Seals', po_id: 12, supplier: 'BYD' });
  const CARRIER = { status: 'arrived', pod_eta: '2026-11-25T00:00:00+03:00', vessel_name: 'MSC AURORA II', carrier: 'MSC', latest_move: 'Arrived at POD', bl_number: '', moves: [{ at: '2026-11-24T10:00:00Z', event: 'Discharged', place: 'Alexandria', vessel: 'MSC AURORA II' }] };
  reset();
  stub({ lookupContainer: async no => { asked.push(no); return { ok: true, fields: CARRIER, raw: { shipment: 'S1' } }; }, containerProviderName: () => 'terminal49' });
  const r1 = await call('POST', E + '/containers/1/refresh', { token: ana });
  const seenR1 = unstub();
  const row1 = T.shipment_containers.find(r => r.id === 1);
  check('a refresh asks the carrier for the box by its number and writes what it said (a blank is not news: the bill of lading number stays); stamps when the box changed — the status, the arrival as the date the carrier wrote, the vessel, the log — when nobody has touched the box since the last time the carrier was asked; and says where the news came from and when, and keeps what the carrier sent',
    r1.status === 200 && same(seenR1, [N1]) && row1.bl_number === 'BL-1' && row1.updated_at > '2026-10-10T00:00:00.000Z' && row1.status === 'arrived' && row1.pod_eta === '2026-11-25' && row1.vessel_name === 'MSC AURORA II' && row1.latest_move === 'Arrived at POD' && row1.moves.length === 1 && row1.moves[0].event === 'Discharged'
    && row1.source === 'terminal49' && row1.last_synced_at > '2026-10-10T00:00:00.000Z' && same(row1.raw, { shipment: 'S1' }), JSON.stringify(row1));
  check('…it answers what each feed said, whether anything changed, and the box as it now is — in the shape the contract says', r1.data.ok === true && same(r1.data.carrier, { ok: true }) && r1.data.position === null && r1.data.changed > 0 && r1.data.container.status === 'arrived' && shape(S.ContainerRefreshed, r1.data) === true, shape(S.ContainerRefreshed, r1.data) + ' ' + JSON.stringify(r1.data.carrier));
  reset();
  Object.assign(T.shipment_containers.find(r => r.id === 1), { updated_at: '2026-10-10T00:00:00.500Z' });   // the write that followed the sync itself
  stub({ lookupContainer: async () => ({ ok: true, fields: CARRIER, raw: {} }) });
  await call('POST', E + '/containers/1/refresh', { token: ana });
  unstub();
  check('…the moment a sync\'s own write takes (half a second after it) is not "somebody changed it": the carrier still has its way', row1.status === 'arrived' && row1.vessel_name === 'MSC AURORA II', JSON.stringify([row1.status, row1.vessel_name]));
  reset();
  Object.assign(T.shipment_containers.find(r => r.id === 1), { updated_at: '2026-10-20T00:00:00.000Z' });   // a person changed it after the last sync
  stub({ lookupContainer: async () => ({ ok: true, fields: CARRIER, raw: {} }), containerProviderName: () => 'terminal49' });
  const r2 = await call('POST', E + '/containers/1/refresh', { token: ana });
  unstub();
  check('when somebody has changed the box since the carrier was last asked, the carrier fills in what is blank (here the carrier\'s name) and leaves what a person put there — the status, the ETA, the vessel, the log — alone', r2.status === 200
    && row1.carrier === 'MSC' && row1.status === 'in_transit' && row1.pod_eta === '2026-11-20' && row1.vessel_name === 'MSC AURORA' && same(row1.moves, moves1) && r2.data.carrier.ok === true, JSON.stringify(row1));
  reset();
  Object.assign(T.shipment_containers.find(r => r.id === 1), { updated_at: '2026-10-20T00:00:00.000Z', moves: [] });
  stub({ lookupContainer: async () => ({ ok: true, fields: CARRIER, raw: {} }) });
  await call('POST', E + '/containers/1/refresh', { token: ana });
  unstub();
  check('…an empty port-call log counts as blank too: the carrier\'s fills it, though the status beside it is left alone', row1.moves.length === 1 && row1.moves[0].event === 'Discharged' && row1.status === 'in_transit', JSON.stringify([row1.moves, row1.status]));
  reset();
  stub({ lookupContainer: async () => ({ ok: false, status: 401, code: 'unauthorized', reason: 'provider returned 401', detail: 'Invalid key' }) });
  const r3 = await call('POST', E + '/containers/1/refresh', { token: ana });
  unstub();
  check('a carrier that refuses is reported as it refused, the box is not written to, and the answer is the box as it was — in the shape the contract says',
    r3.status === 200 && r3.data.ok === false && same(r3.data.carrier, { ok: false, code: 'unauthorized', reason: 'provider returned 401', detail: 'Invalid key' }) && r3.data.position === null && r3.data.changed === 0 && r3.data.container.id === 1
    && row1.updated_at === '2026-10-10T00:00:00.000Z' && shape(S.ContainerRefreshed, r3.data) === true, shape(S.ContainerRefreshed, r3.data) + ' ' + JSON.stringify(r3.data.carrier));
  const FIX = { vessel_lat: 31.2, vessel_lon: 29.9, vessel_position_at: '2026-11-01T00:00:00.000Z', vessel_course: 90, vessel_speed: 12, vessel_mmsi: '636012345', position_source: 'ais' };
  reset();
  stub({ lookupContainer: async () => ({ ok: false, code: 'not-configured', reason: 'not-configured' }), aisConfigured: () => true, lookupPosition: async arg => { asked.push(JSON.stringify(arg)); return { ok: true, fields: { ...FIX } }; } });
  const r4 = await call('POST', E + '/containers/1/refresh', { token: ana });
  const seenR4 = unstub();
  check('with only the ship feed set up, a refresh asks it for the ship by its IMO and MMSI and writes where it is — whoever last touched the box — and says when the fix was from and how many columns it wrote (the seven of the fix and the time)',
    r4.status === 200 && r4.data.ok === true && r4.data.carrier.ok === false && same(r4.data.position, { ok: true, at: '2026-11-01T00:00:00.000Z' }) && row1.vessel_lat === 31.2 && row1.vessel_lon === 29.9 && row1.vessel_mmsi === '636012345' && row1.position_source === 'ais'
    && row1.status === 'in_transit' && r4.data.changed === 8 && shape(S.ContainerRefreshed, r4.data) === true, shape(S.ContainerRefreshed, r4.data) + ' ' + JSON.stringify(r4.data.position));
  check('…and the feed is asked about the ship the box is on', seenR4.length === 1 && JSON.parse(seenR4[0]).imo === '9876543', seenR4.join());
  reset();
  Object.assign(T.shipment_containers.find(r => r.id === 1), { vessel_lat: 30, vessel_lon: 30, vessel_position_at: '2026-11-02T00:00:00.000Z' });
  stub({ lookupContainer: async () => ({ ok: false, code: 'not-configured', reason: 'not-configured' }), aisConfigured: () => true, lookupPosition: async () => ({ ok: true, fields: { ...FIX } }) });
  const r5 = await call('POST', E + '/containers/1/refresh', { token: ana });
  unstub();
  check('a fix older than the one the box already has is not taken (vendors serve stale positions), and the answer says so', r5.data.position.ok === false && /older fix/.test(r5.data.position.reason) && row1.vessel_lat === 30 && r5.data.changed === 0, JSON.stringify(r5.data.position));
  reset();
  stub({ lookupContainer: async () => ({ ok: false, code: 'not-configured', reason: 'not-configured' }), aisConfigured: () => true, lookupPosition: async () => ({ ok: true, fields: { ...FIX, vessel_position_at: '' } }) });
  const r6 = await call('POST', E + '/containers/1/refresh', { token: ana });
  unstub();
  check('a fix that does not say when it is from is dated now', r6.data.position.ok === true && Date.now() - Date.parse(r6.data.position.at) < 60000 && row1.vessel_position_at === r6.data.position.at, JSON.stringify(r6.data.position));
  reset();
  stub({ lookupContainer: async () => ({ ok: false, code: 'not-configured', reason: 'not-configured' }), aisConfigured: () => true, lookupPosition: async () => ({ ok: false, code: 'no-fix', reason: 'no position in the response' }) });
  const r7 = await call('POST', E + '/containers/1/refresh', { token: ana });
  unstub();
  check('a ship feed that has nothing is reported as it said, beside whatever the carrier said', r7.data.ok === false && same(r7.data.position, { ok: false, code: 'no-fix', reason: 'no position in the response' }) && same(r7.data.carrier, { ok: false, code: 'not-configured', reason: 'not-configured', detail: null }) && shape(S.ContainerRefreshed, r7.data) === true, JSON.stringify(r7.data));
  reset();
  stub({ lookupContainer: async () => ({ ok: true, fields: CARRIER, raw: {}, position: { ...FIX } }), aisConfigured: () => true, lookupPosition: async () => { asked.push('ais'); return { ok: false, code: 'x', reason: 'x' }; } });
  const r8 = await call('POST', E + '/containers/1/refresh', { token: ana });
  const seenR8 = unstub();
  check('a carrier that gives the ship\'s position with its news is believed — the ship feed is not asked on top of it', r8.data.ok === true && r8.data.position.ok === true && row1.vessel_lat === 31.2 && !seenR8.includes('ais'), JSON.stringify(r8.data.position) + seenR8.join());
  reset();
  const r9 = await call('POST', E + '/containers/1/refresh', { token: ana });
  check('with neither feed set up a refresh says so and changes nothing', r9.status === 200 && r9.data.ok === false && r9.data.carrier.code === 'not-configured' && r9.data.position === null && r9.data.changed === 0 && row1.updated_at === '2026-10-10T00:00:00.000Z' && row1.last_synced_at === '2026-10-10T00:00:00.000Z', JSON.stringify(r9.data));
  const r10 = await call('POST', E + '/containers/999/refresh', { token: ana });
  check('a refresh of a box that is not there is an error that says something', r10.status >= 400 && typeof r10.data.error === 'string' && r10.data.error.length > 0, JSON.stringify(r10.data));

  // ═══ Asking the carrier to watch a box ══════════════════════════════════════
  const rg0 = await call('POST', E + '/containers/register', { token: ana, body: { container_no: 'nope' } });
  check('registering needs a good number too (400)', rg0.status === 400 && rg0.data.error === MSG);
  const rg1 = await call('POST', E + '/containers/register', { token: ana, body: { container_no: N4 } });
  check('with a carrier that has nothing to register, the answer is a plain 200 that says why not (not an error)', rg1.status === 200 && rg1.data.ok === false && rg1.data.code === 'not-supported' && typeof rg1.data.reason === 'string' && rg1.data.detail === null && shape(S.ContainerRegistered, rg1.data) === true, JSON.stringify(rg1.data));
  stub({ registerContainer: async (no, scac) => { asked.push([no, scac]); return { ok: true, status: 'registered' }; }, containerProviderName: () => 'safecube' });
  const rg2 = await call('POST', E + '/containers/register', { token: ana, body: { container_no: ' ' + N4.toLowerCase() + ' ', scac: ' msc ' } });
  const seenRg2 = unstub();
  check('a carrier that registers is asked for the clean number and the shipping line\'s code in capitals, and says who it was — in the shape the contract says',
    rg2.status === 200 && same(rg2.data, { ok: true, status: 'registered', provider: 'safecube' }) && same(seenRg2, [[N4, 'MSC']]) && shape(S.ContainerRegistered, rg2.data) === true, JSON.stringify(rg2.data) + JSON.stringify(seenRg2));
  stub({ registerContainer: async (no, scac) => { asked.push([no, scac]); return { ok: false, code: 'forbidden', reason: 'provider returned 403', detail: 'No registration on this plan' }; } });
  const rg3 = await call('POST', E + '/containers/register', { token: ana, body: { container_no: N4 } });
  const seenRg3 = unstub();
  check('…and one that refuses is reported, with its words, as an answer — a code for the line is optional', rg3.status === 200 && same(rg3.data, { ok: false, code: 'forbidden', reason: 'provider returned 403', detail: 'No registration on this plan' }) && same(seenRg3, [[N4, '']]), JSON.stringify(rg3.data) + JSON.stringify(seenRg3));

  // ═══ The cars in a box ══════════════════════════════════════════════════════
  const lk0 = await call('POST', E + '/containers/1/units', { token: ana, body: { vin: '   ' } });
  const lk00 = await call('POST', E + '/containers/1/units', { token: ana, body: {} });
  check('a car is put in a box by its VIN: without one, a 400 that says to pick a vehicle', lk0.status === 400 && lk0.data.error === 'Pick a vehicle to add.' && lk00.status === 400, JSON.stringify([lk0.data, lk00.data]));
  const lk1 = await call('POST', E + '/containers/3/units', { token: ana, body: { vin: ' lgxc76c41p-0123457 ' } });
  const link = T.container_vehicles.find(l => l.container_id === 3);
  check('…with one, the VIN is written as the chassis number is (capitals, letters and digits only), the link is filed under whoever made it, and the answer says which car — in the shape the contract says',
    lk1.status === 200 && same(lk1.data, { ok: true, vin: 'LGXC76C41P0123457' }) && link && link.vin === 'LGXC76C41P0123457' && link.linked_by === 'employee_2' && shape(S.ContainerCarLinked, lk1.data) === true, JSON.stringify([lk1.data, link]));
  await call('POST', D + '/containers/3/units', { token: 'adm', body: { vin: 'LGXC76C41P0123457' } });
  check('…putting the same car in the same box again is no second link', T.container_vehicles.filter(l => l.container_id === 3 && l.vin === 'LGXC76C41P0123457').length === 1);
  const lk2 = await call('POST', D + '/containers/3/units', { token: 'adm', body: { vin: 'abcdefghijklmnopqrstuvwxyz0123' } });
  check('…a VIN is cut at seventeen characters', lk2.data.vin === 'ABCDEFGHIJKLMNOPQ' && lk2.data.vin.length === 17, lk2.data.vin);
  const withCar = await call('GET', E + '/containers/3', { token: ana });
  check('the box then shows the car — the one the register has with what the register has, the one it has not as a VIN alone — on its card and on the board',
    withCar.data.units.length === 2 && withCar.data.units.some(u => u.vin === 'LGXC76C41P0123457' && u.colour === 'Grey' && u.stock_id === 7) && withCar.data.units.some(u => u.vin === 'ABCDEFGHIJKLMNOPQ' && u.unrecorded === true), JSON.stringify(withCar.data.units));
  db.missing.add('container_vehicles');
  const noLinkTable = await call('POST', E + '/containers/3/units', { token: ana, body: { vin: 'ABC' } });
  db.missing.delete('container_vehicles');
  check('before the migration that links cars to boxes, putting a car in one is a 503 that names the file to apply', noLinkTable.status === 503 && /migrations\/020_container_vehicles\.sql/.test(noLinkTable.data.error) && noLinkTable.data.migration === '020', JSON.stringify(noLinkTable.data));
  const un0 = await call('DELETE', E + '/containers/3/units/' + encodeURIComponent('---'), { token: ana });
  check('taking a car out needs a VIN (400 "Which vehicle?")', un0.status === 400 && un0.data.error === 'Which vehicle?', JSON.stringify(un0.data));
  const un1 = await call('DELETE', E + '/containers/3/units/lgxc76c41p0123457', { token: ana });
  check('…and takes the car out by its VIN however it is written; the box and the car stay — only the link goes', un1.status === 200 && shape(S.Deleted, un1.data) === true && !T.container_vehicles.some(l => l.container_id === 3 && l.vin === 'LGXC76C41P0123457') && T.container_vehicles.some(l => l.container_id === 3 && l.vin === 'ABCDEFGHIJKLMNOPQ') && T.shipment_containers.some(r => r.id === 3) && T.stock_vehicles.length === 1);
  const un2 = await call('DELETE', E + '/containers/3/units/lgxc76c41p0123457', { token: ana });
  check('…twice is no error', un2.status === 200 && un2.data.ok === true);

  // ═══ Deleting (the administrator\'s) ═════════════════════════════════════════
  const del = await call('DELETE', D + '/containers/2', { token: 'adm' });
  check('the administrator deletes a box: it is gone, and the answer is the one a delete gives', del.status === 200 && shape(S.Deleted, del.data) === true && !T.shipment_containers.some(r => r.id === 2), JSON.stringify(del.data));
  const del2 = await call('DELETE', D + '/containers/2', { token: 'adm' });
  check('…twice is no error', del2.status === 200 && del2.data.ok === true);

  // ═══ What the contract reads ════════════════════════════════════════════════
  const all = (await call('GET', D + '/containers', { token: 'adm' })).data;
  const odd2 = all.filter(c => shape(S.Container, c) !== true);
  check('every box the checks above left on the board — each way of being saved, refreshed and changed — is one the contract reads', all.length >= 2 && odd2.length === 0, odd2.slice(0, 2).map(c => c.id + ': ' + shape(S.Container, c)).join('; '));
  check('a body the app sends is one the contract takes (the form\'s) — and one without a number is not', shape(S.ContainerBody, { container_no: N1, container_type: "40' DRY", status: 'booked', pod_eta: null, po_id: '12', moves: [] }) === true && shape(S.ContainerBody, { carrier: 'x' }) !== true);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
