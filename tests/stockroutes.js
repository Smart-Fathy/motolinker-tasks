// The stock register (the cars in stock, a row per make, model and trim and the cars themselves under it), as the server does it — in
// both portals, which share the read and the two writes and differ only in what is left to the administrator: deleting, and the CSV.
//
// The new app's Models tab calls these routes as they are: nothing is written twice, so there is nothing to unify yet. This holds
// what the screen may rely on: who may ask for what (each grant is its own: browse reads, create adds, edit changes), what a save
// keeps, cleans and refuses (the cars are the count, a status the Columns editor defines is one a save keeps, the columns an
// administrator added ride along), what the administrator's CSV does with a row it cannot use — and that every answer is the shape
// packages/contracts says it is. The lists in packages/contracts/src/{documents,logistics}.js — a car's statuses and its columns, the
// CSV's header — are held to what the routes keep. The pure rules of a save are tests/stocktest.js; the permission rules are
// tests/permstest.js.
const C = require('../packages/contracts');
const { pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const S = C.schemas;
const DOCS = C.documents;
const LOGI = C.logistics;
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const grants = (on, over = {}) => ({ view: on, browse: on, create: on, edit: on, tracking: on, ...over });
const now = () => new Date().toISOString();
const db = createFakeSupabase({
  employees: [], sessions: [], quotation_settings: [], stock_vehicles: [],
// (rows are seeded after the tables are made, so a row made by a route never shares an id with one seeded here)
}, { serial: { stock_vehicles: 100 }, defaults: {
  stock_vehicles: () => ({ trim: '', price: 0, quantity: 0, notes: '', units: [], created_by: 'dashboard', updated_at: now() }),
} });
db.install();

// A database that answers as one does that has not had a migration applied, for the one request a test names.
const inject = [];
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  for (const f of inject) if (f.test(url, init || {})) return f.reply(url, init || {});
  return realFetch(input, init);
};
const JSON_HEADERS = { 'Content-Type': 'application/json' };

(async () => {
  const base = await bootApp({ port: process.env.PORT || 4010 });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
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
    person(6, 'Eli', grants(false, { browse: true, create: true })),
  );

  const call = async (method, path, { token, body, form } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
    // (decoded by hand: `r.text()` drops a byte-order mark, which is one of the things the CSV template is held to)
    const text = Buffer.from(await r.arrayBuffer()).toString('utf8');
    let data = null; try { data = JSON.parse(text); } catch (_) {}
    return { status: r.status, data, text, headers: r.headers };
  };
  const signIn = async name => (await call('POST', '/api/employee/login', { body: { username: name.toLowerCase(), password: name.toLowerCase() + '-password-1' } })).data.token;
  const lone = {};
  for (const g of SINGLES) lone[g] = await signIn('Only' + g);
  const ana = await signIn('Ana'), ben = await signIn('Ben'), cy = await signIn('Cy'), eli = await signIn('Eli');
  ctx.sessions.set('adm', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const D = '/api/dashboard', E = '/api/employee';
  const csv = (text, name = 'stock.csv') => { const f = new FormData(); f.append('file', new Blob([text], { type: 'text/csv' }), name); return f; };

  // ═══ Who may ask ════════════════════════════════════════════════════════════
  const refused = [];
  for (const [m, p] of [['GET', '/stock'], ['POST', '/stock'], ['PUT', '/stock/1'], ['DELETE', '/stock/1'], ['GET', '/stock/template.csv'], ['POST', '/stock/bulk']]) {
    const body = m === 'GET' || m === 'DELETE' || p === '/stock/bulk' ? undefined : {};
    const a = await call(m, D + p, { body });
    const b = await call(m, E + p, { body });
    const c = await call(m, E + p, { token: 'adm', body });   // the other portal's token is not a way in either
    const d = await call(m, D + p, { token: ana, body });
    if (a.status !== 401 || (b.status !== 401 && b.status !== 404) || (c.status !== 401 && c.status !== 404) || d.status !== 401) refused.push(`${m} ${p}: ${a.status}/${b.status}/${c.status}/${d.status}`);
  }
  check('every route needs the signed-in person of its own portal — nobody is a 401, and so is the other portal\'s token (the administrator\'s-only routes are not in the team portal at all)', refused.length === 0, refused.join('; '));
  const none = [];
  for (const [m, p] of [['GET', '/stock'], ['POST', '/stock'], ['PUT', '/stock/1']]) {
    const r = await call(m, E + p, { token: cy, body: m === 'GET' ? undefined : { make: 'X', model: 'Y' } });
    if (r.status !== 403) none.push(`${m} ${p}: ${r.status}`);
  }
  check('a team member with the section off is refused every route (403)', none.length === 0, none.join('; '));
  const teamOnly = [];
  for (const [m, p] of [['DELETE', '/stock/1'], ['GET', '/stock/template.csv'], ['POST', '/stock/bulk']]) {
    const r = await call(m, E + p, { token: ana, form: m === 'POST' ? csv('make,model\nA,B') : undefined });
    if (r.status !== 404) teamOnly.push(`${m} ${p}: ${r.status}`);
  }
  check('deleting a vehicle and the CSV are the administrator\'s: a member who holds every grant finds no such route in the team portal (404)', teamOnly.length === 0, teamOnly.join('; '));

  // ═══ The register, and who reads it ═════════════════════════════════════════
  const SEAL = [
    { consignee: 'Hany', colour: 'White / Black', vin: 'LGXC76C41P0123456', status: 'in_logistics', price_list: 1950000, discounted: 1900000, logistics: 'Alexandria', supplier: 'BYD' },
    { consignee: '', colour: 'Grey', vin: 'LGXC76C41P0123457', status: 'delivered', price_list: 1950000, discounted: 0, logistics: '', supplier: 'BYD' },
  ];
  T.stock_vehicles.push(
    { id: 1, make: 'Toyota', model: 'Corolla', trim: 'GLI 1.6', price: 1150000, quantity: 0, units: [], notes: '', legacy_count: null, created_by: 'dashboard', created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z' },
    { id: 2, make: 'BYD', model: 'Seal', trim: 'Excellence AWD', price: 2250000, quantity: 2, units: SEAL, notes: 'Immediate delivery', legacy_count: null, created_by: 'employee_2', created_at: '2026-09-02T09:00:00Z', updated_at: '2026-09-03T09:00:00Z' },
    { id: 3, make: 'BYD', model: 'Seal', trim: 'Design', price: 1950000, quantity: 0, units: [], notes: '', legacy_count: null, created_by: 'dashboard', created_at: '2026-09-02T10:00:00Z', updated_at: '2026-09-02T10:00:00Z' },
    { id: 4, make: 'BYD', model: 'Atto 3', trim: '', price: 0, quantity: 0, units: [], notes: '', legacy_count: 5, created_by: 'dashboard_bulk', created_at: '2026-09-04T09:00:00Z', updated_at: '2026-09-04T09:00:00Z' },
  );
  const list = await call('GET', E + '/stock', { token: ben });
  check('a member who may browse reads the register, by make, then model, then trim — in the shape the contract says',
    list.status === 200 && list.data.map(r => r.id).join() === '4,3,2,1' && shape(S.StockList, list.data) === true, shape(S.StockList, list.data) + ' ' + (list.data || []).map(r => r.id));
  check('…each row carries its cars, their count, the count an older save gave it (legacy_count) and who made it', list.data[2].units.length === 2 && list.data[2].quantity === 2 && list.data[0].legacy_count === 5 && list.data[2].created_by === 'employee_2' && list.data[3].units.length === 0);
  const adminList = await call('GET', D + '/stock', { token: 'adm' });
  check('the administrator reads the same register', same(adminList.data, list.data));
  T.stock_vehicles.push({ id: 5, make: 'Zeekr', model: '001', trim: null, price: null, quantity: 0, notes: null });
  const bare = await call('GET', D + '/stock', { token: 'adm' });
  check('a row from before the cars were recorded (no cars column, no trim, no price) is still a row the contract reads', bare.status === 200 && bare.data.length === 5 && shape(S.StockList, bare.data) === true, shape(S.StockList, bare.data));
  T.stock_vehicles.pop();

  // ═══ Each grant is its own ══════════════════════════════════════════════════
  // A member with one grant and no other may do exactly what that grant is for.
  T.stock_vehicles.push({ id: 50, make: 'Matrix', model: 'Row', trim: '', price: 0, quantity: 0, units: [], notes: '' });
  const NEEDS = [['GET', '/stock', 'browse'], ['POST', '/stock', 'create'], ['PUT', '/stock/50', 'edit']];
  const wrong = [];
  for (const [m, p, need] of NEEDS) {
    for (const g of SINGLES) {
      const r = await call(m, E + p, { token: lone[g], body: m === 'GET' ? undefined : { make: 'Matrix', model: 'Row' } });
      const no = r.status === 403;
      if (g === need ? no : !no) wrong.push(`${m} ${p} for a member who may only ${g}: ${r.status}`);
    }
  }
  check('each route is for the one grant that names it: browse reads, create adds, edit changes — and a member with any other single grant (view, tracking, the other two) is refused', wrong.length === 0, wrong.slice(0, 4).join('; '));
  for (let i = T.stock_vehicles.length - 1; i >= 0; i--) if (T.stock_vehicles[i].make === 'Matrix') T.stock_vehicles.splice(i, 1);
  const eliRead = await call('GET', E + '/stock', { token: eli });
  const eliWrite = await call('PUT', E + '/stock/1', { token: eli, body: { make: 'Toyota', model: 'Corolla' } });
  check('create does not carry edit with it, nor browse edit: a member who may browse and add can read and add and may not change a vehicle', eliRead.status === 200 && eliWrite.status === 403, eliRead.status + '/' + eliWrite.status);

  // ═══ Adding ═════════════════════════════════════════════════════════════════
  const noMake = await call('POST', E + '/stock', { token: ana, body: { model: 'Seal' } });
  const noModel = await call('POST', E + '/stock', { token: ana, body: { make: 'BYD', model: '   ' } });
  const before = T.stock_vehicles.length;
  check('a vehicle needs a make and a model: without the make it is a 400 that says so, without the model another — and nothing is written',
    noMake.status === 400 && noMake.data.error === 'Make is required' && noModel.status === 400 && noModel.data.error === 'Model is required' && T.stock_vehicles.length === before, JSON.stringify([noMake.data, noModel.data]));
  const added = await call('POST', E + '/stock', { token: ana, body: {
    make: '  Geely ', model: ' Monjaro ', trim: ' Flagship ', price: ' 2,450,000 EGP ', notes: ' Fresh stock ', quantity: 99, colors: ['Red'],
    units: [{ consignee: ' Hany ', colour: ' White / Black ', vin: ' lgxc76c41p0123456 ', status: 'in_logistics', price_list: '1,950,000', discounted: 1800000.5, logistics: ' Cairo ', supplier: ' BYD ' }] } });
  const arow = T.stock_vehicles.find(r => r.make === 'Geely');
  check('adding keeps what was sent, trimmed — the price as a number, whatever else is written beside it dropped — files it under the member, and answers the saved row in the shape the contract says',
    added.status === 200 && arow && added.data.id === arow.id && arow.model === 'Monjaro' && arow.trim === 'Flagship' && arow.price === 2450000 && arow.notes === 'Fresh stock' && arow.created_by === 'employee_2' && shape(S.StockVehicle, added.data) === true,
    shape(S.StockVehicle, added.data) + ' ' + JSON.stringify(arow));
  check('…each car is made of the eight columns: trimmed, the VIN in capitals, the prices as numbers — and the cars are the count, whatever count was typed',
    same(arow.units, [{ consignee: 'Hany', colour: 'White / Black', vin: 'LGXC76C41P0123456', status: 'in_logistics', price_list: 1950000, discounted: 1800000.5, logistics: 'Cairo', supplier: 'BYD' }]) && arow.quantity === 1 && !('colors' in arow), JSON.stringify(arow.units));
  const procSrc = require('fs').readFileSync('public/assets/procurement.js', 'utf8');
  const classicCols = new Function('return ' + procSrc.match(/const STOCK_UNIT_COLS = (\[[\s\S]*?\n  \]);/)[1])();
  check('…the eight are the columns the classic page starts a car with — their keys, their words and their widths', same(classicCols, LOGI.STOCK_UNIT_FIELDS), JSON.stringify(classicCols).slice(0, 80));
  check('…the eight are the columns the contract lists, in its order', same(LOGI.STOCK_UNIT_FIELDS.map(f => f[0]), Object.keys(arow.units[0])) && same(LOGI.STOCK_UNIT_NUMBERS, ['price_list', 'discounted']), JSON.stringify(Object.keys(arow.units[0])));
  const adm = await call('POST', D + '/stock', { token: 'adm', body: { make: 'Kia', model: 'Seltos' } });
  const krow = T.stock_vehicles.find(r => r.make === 'Kia');
  check('the administrator adds one the same way, filed under "dashboard"; a price left out is none, a trim left out is empty, and a vehicle with no cars has none (and no count of its own)',
    adm.status === 200 && krow.created_by === 'dashboard' && krow.price === 0 && krow.trim === '' && same(krow.units, []) && krow.quantity === 0 && !('legacy_count' in krow), JSON.stringify(krow));
  const bad = await call('POST', E + '/stock', { token: ana, body: { make: 'A', model: 'B', price: 'abc' } });
  const badRow = T.stock_vehicles.find(r => r.id === bad.data.id);
  const bad2 = await call('POST', E + '/stock', { token: ana, body: { make: 'A', model: 'B', price: '1.2.3' } });
  check('a price that is not a number is none (and one with two decimal points is no number)', bad.status === 200 && badRow.price === 0 && T.stock_vehicles.find(r => r.id === bad2.data.id).price === 0, JSON.stringify([badRow.price, bad2.data.price]));

  // ── the cars ──
  const mk = async (units, token = ana) => { const r = await call('POST', E + '/stock', { token, body: { make: 'Cars', model: 'Test', units } }); return T.stock_vehicles.find(x => x.id === (r.data && r.data.id)); };
  const odd = await mk([
    { vin: 'a1', status: 'nonsense' }, { vin: 'a2' }, { vin: 'a3', status: 'delivered', color: 'Red' }, { status: 'delivered', price_list: 5, logistics: 'x' }, {}, { consignee: ' Only a name ' },
    { supplier: ' Only a supplier ' }, { vin: 'a5', price_list: ' 2 000 EGP ', discounted: '1,200.5', logistics: ' Port ' }, { colour: ' Only a colour ' },
  ]);
  check('a car with a status the server does not know is "send to supplier", and so is one with none; a car\'s colour may come under its older spelling (color)',
    odd.units.length === 7 && odd.units[0].status === 'send_to_supplier' && odd.units[1].status === 'send_to_supplier' && odd.units[2].status === 'delivered' && odd.units[2].colour === 'Red' && !('color' in odd.units[2]), JSON.stringify(odd.units));
  check('…a row of only a status, a price or a logistics note is not a car and is not kept; one with a VIN, a consignee, a colour or a supplier is', odd.units.map(u => u.vin || u.consignee || u.supplier || u.colour).join() === 'A1,A2,A3,Only a name,Only a supplier,A5,Only a colour' && odd.quantity === 7, JSON.stringify(odd.units.map(u => u.vin || u.consignee || u.supplier || u.colour)));
  check('…the prices of a car are read out of the way they were typed (thousands marks, a currency after them, a decimal point), and a note on its logistics is trimmed', odd.units[5].price_list === 2000 && odd.units[5].discounted === 1200.5 && odd.units[5].logistics === 'Port' && odd.units[4].supplier === 'Only a supplier', JSON.stringify(odd.units.slice(4)));
  const kept = [];
  for (const o of DOCS.PO_LINE_STATUSES) { const r = await mk([{ vin: 'k' + o.key, status: o.key }]); if (r.units[0].status !== o.key) kept.push(o.key); }
  check('every status a car can be in (the purchase order line\'s four) is one the server keeps as it was sent', kept.length === 0 && DOCS.PO_LINE_STATUSES.length === 4, kept.join());
  const extra = await mk([{ vin: 'e1', cf_link: ' https://x.example/a ', cf_flag: true, cf_n: 7, cf_obj: { a: 1 }, 'bad key!': 'x', cf_empty: '', cf_false: false }, { cf_only: 'a column the administrator added' }]);
  check('the columns an administrator added ride along on a car, flat — text trimmed, flags and numbers as they are — and what is not a plain value, has no usable name or says nothing is left out; a car with only such a column is a car',
    same(extra.units[0], { consignee: '', colour: '', vin: 'E1', status: 'send_to_supplier', price_list: 0, discounted: 0, logistics: '', supplier: '', cf_link: 'https://x.example/a', cf_flag: true, cf_n: '7' }) && extra.units[1].cf_only === 'a column the administrator added' && extra.units.length === 2, JSON.stringify(extra.units));
  const text = await mk('LGXC76C41P0123456:White:in_logistics | lgxc76c41p0123457 : Black : delivered | :Red: | lgxc76c41p0123458 | |');
  check('cars may be sent as one text, the way a CSV cell writes them ("VIN:Colour:Status | VIN:Colour:Status"): each is a car, a blank piece is not, a car with only a colour is, and so is one with only a VIN',
    text.units.length === 4 && text.units[3].vin === 'LGXC76C41P0123458' && text.units[3].colour === '' && text.units[0].vin === 'LGXC76C41P0123456' && text.units[0].colour === 'White' && text.units[0].status === 'in_logistics' && text.units[1].vin === 'LGXC76C41P0123457' && text.units[1].colour === 'Black' && text.units[1].status === 'delivered' && text.units[2].colour === 'Red' && text.units[2].vin === '' && text.quantity === 4, JSON.stringify(text.units));
  const legacy = await call('POST', E + '/stock', { token: ana, body: { make: 'Old', model: 'Count', legacy_count: 7 } });
  const lrow = T.stock_vehicles.find(r => r.id === legacy.data.id);
  const legacy2 = await call('POST', E + '/stock', { token: ana, body: { make: 'Old', model: 'Cars', legacy_count: 7, units: [{ vin: 'z1' }] } });
  const lrow2 = T.stock_vehicles.find(r => r.id === legacy2.data.id);
  check('the count an older save gave a vehicle is kept while it has no cars, and is gone once it has some (the cars are the count then)', lrow.legacy_count === 7 && lrow2.legacy_count === null, JSON.stringify([lrow.legacy_count, lrow2.legacy_count]));

  // a status the Columns editor defines
  T.quotation_settings.push({ key: 'columns_config:stock', value: JSON.stringify([{ key: 'status', label: 'Status', type: 'select', builtin: true, options: [{ key: 'in_house', label: 'In house', color: '#336699' }, { key: 'delivered', label: 'Handed over' }] }]) });
  const cfg = await mk([{ vin: 'c1', status: 'in_house' }, { vin: 'c2', status: 'in_logistics' }, { vin: 'c3', status: 'nonsense' }]);
  check('a status the administrator added in the Columns editor is one a save keeps (on the next save — it is read when a save is made), the four built-in ones still are, and anything else is still "send to supplier"',
    cfg.units.map(u => u.status).join() === 'in_house,in_logistics,send_to_supplier', cfg.units.map(u => u.status).join());
  T.quotation_settings.length = 0;
  const cfg2 = await mk([{ vin: 'c1', status: 'in_house' }]);
  check('…and once the administrator takes it away it is not one any more', cfg2.units[0].status === 'send_to_supplier', cfg2.units[0].status);
  T.quotation_settings.push({ key: 'columns_config:stock', value: 'not json' });
  const cfg3 = await mk([{ vin: 'c1', status: 'in_house' }, { vin: 'c2', status: 'delivered' }]);
  check('…and a configuration that cannot be read neither widens nor narrows what a save keeps', cfg3.units.map(u => u.status).join() === 'send_to_supplier,delivered', cfg3.units.map(u => u.status).join());
  T.quotation_settings.length = 0;

  // ═══ Changing ═══════════════════════════════════════════════════════════════
  const stamp = '2001-01-01T00:00:00.000Z';
  T.stock_vehicles.find(r => r.id === arow.id).updated_at = stamp;
  const upd = await call('PUT', E + '/stock/' + arow.id, { token: lone.edit, body: {
    make: 'Geely', model: 'Monjaro', trim: '', price: '2,500,000', notes: '', units: [{ vin: 'x9', status: 'delivered' }, { vin: 'x8' }] } });
  const urow = T.stock_vehicles.find(r => r.id === arow.id);
  check('changing replaces what the form sends — the cars whole, the count with them, an emptied trim and note as empty — stamps the time, and leaves who made it as it was',
    upd.status === 200 && urow.trim === '' && urow.notes === '' && urow.price === 2500000 && urow.units.map(u => u.vin).join() === 'X9,X8' && urow.quantity === 2 && urow.updated_at > stamp && urow.created_by === 'employee_2' && urow.created_at === arow.created_at && shape(S.StockVehicle, upd.data) === true, shape(S.StockVehicle, upd.data) + ' ' + JSON.stringify(urow));
  const keepLegacy = await call('PUT', D + '/stock/4', { token: 'adm', body: { make: 'BYD', model: 'Atto 3', trim: '', price: 0 } });
  check('a vehicle with an older count and no cars keeps that count when it is saved without one (the form does not send it)', keepLegacy.status === 200 && T.stock_vehicles.find(r => r.id === 4).legacy_count === 5, JSON.stringify(T.stock_vehicles.find(r => r.id === 4)));
  const putNo = await call('PUT', E + '/stock/' + arow.id, { token: lone.edit, body: { make: '', model: 'X' } });
  check('a change needs a make and a model too (400), and writes nothing', putNo.status === 400 && putNo.data.error === 'Make is required' && T.stock_vehicles.find(r => r.id === arow.id).model === 'Monjaro', JSON.stringify(putNo.data));
  const putGone = await call('PUT', E + '/stock/999', { token: lone.edit, body: { make: 'A', model: 'B' } });
  check('changing a vehicle that is not there is an error that says something (not an empty answer)', putGone.status >= 400 && typeof putGone.data.error === 'string' && putGone.data.error.length > 0, JSON.stringify(putGone));

  // ═══ Before the migrations ══════════════════════════════════════════════════
  inject.push({
    test: (u, i) => /\/rest\/v1\/stock_vehicles/.test(u) && i.method === 'POST' && /"units"/.test(String(i.body)),
    reply: () => new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'units' column of 'stock_vehicles' in the schema cache" }), { status: 400, headers: JSON_HEADERS }),
  });
  const fallback = await call('POST', E + '/stock', { token: ana, body: { make: 'Old', model: 'Database', price: 5, units: [{ vin: 'f1' }] } });
  inject.length = 0;
  const frow = T.stock_vehicles.find(r => r.make === 'Old' && r.model === 'Database');
  check('a database that has not had the cars\' migration applied still saves the vehicle — without the cars, which it has no column for', fallback.status === 200 && frow && frow.price === 5 && frow.quantity === 1 && !('legacy_count' in frow), JSON.stringify([fallback.status, frow]));
  T.stock_vehicles.find(r => r.id === frow.id).units = [];
  db.failing.add('stock_vehicles');
  const down = await call('GET', E + '/stock', { token: ben });
  const downW = await call('POST', E + '/stock', { token: ana, body: { make: 'A', model: 'B' } });
  db.failing.delete('stock_vehicles');
  check('a database that is down is a 500 with its words, for a read and for a save', down.status === 500 && typeof down.data.error === 'string' && downW.status === 500 && typeof downW.data.error === 'string', JSON.stringify([down.data, downW.data]));

  // ═══ Deleting (the administrator\'s) ═════════════════════════════════════════
  const del = await call('DELETE', D + '/stock/3', { token: 'adm' });
  check('the administrator deletes a vehicle: it is gone, and the answer is the one a delete gives', del.status === 200 && shape(S.Deleted, del.data) === true && !T.stock_vehicles.some(r => r.id === 3), JSON.stringify(del));
  const del2 = await call('DELETE', D + '/stock/3', { token: 'adm' });
  check('…twice is no error (a second press of the button is not a failure)', del2.status === 200 && del2.data.ok === true);
  const memberDel = await call('DELETE', D + '/stock/2', { token: ana });
  check('a team member\'s token deletes nothing (401), whatever they may do in their own portal', memberDel.status === 401 && T.stock_vehicles.some(r => r.id === 2));

  // ═══ The CSV (the administrator\'s) ══════════════════════════════════════════
  const tpl = await call('GET', D + '/stock/template.csv', { token: 'adm' });
  const tplLines = tpl.text.replace(/^﻿/, '').split('\n');
  check('the template is a CSV the administrator downloads, with a byte-order mark for Excel, under the name the browser saves it as',
    tpl.status === 200 && /^text\/csv/.test(tpl.headers.get('content-type')) && /attachment; filename="car-stock-template.csv"/.test(tpl.headers.get('content-disposition')) && tpl.text.charCodeAt(0) === 0xfeff, tpl.headers.get('content-type') + ' ' + tpl.text.charCodeAt(0));
  check('…its header is the columns the contract lists, and its sample rows are ones the register would take (the units cell in the "VIN:Colour:Status | …" form)',
    tplLines[0] === LOGI.STOCK_CSV_HEADERS.join(',') && tplLines.length === 4 && /LGXC76C41P0123456:White:in_logistics \| LGXC76C41P0123457:White:delivered/.test(tplLines[1]), tplLines.slice(0, 2).join(' / '));
  const noFile = await call('POST', D + '/stock/bulk', { token: 'adm' });
  const empty = await call('POST', D + '/stock/bulk', { token: 'adm', form: csv('make,model,trim,price,units,notes\n') });
  check('a CSV is needed (400 "No CSV file uploaded"), and one with only its header has nothing to load (400 "CSV has no data rows")',
    noFile.status === 400 && noFile.data.error === 'No CSV file uploaded' && empty.status === 400 && empty.data.error === 'CSV has no data rows', JSON.stringify([noFile.data, empty.data]));
  const rowsBefore = T.stock_vehicles.length;
  const bulk = await call('POST', D + '/stock/bulk', { token: 'adm', form: csv(tpl.text) });
  const loaded = T.stock_vehicles.filter(r => r.created_by === 'dashboard_bulk' && r.make !== 'BYD' || r.created_by === 'dashboard_bulk' && r.model === 'Seal');
  check('the template itself loads: every row goes in under "dashboard_bulk" (the byte-order mark does not spoil the header), the cars of the units cell with it, and the answer says how many and that nothing was refused — in the shape the contract says',
    bulk.status === 200 && bulk.data.inserted === 3 && bulk.data.errors.length === 0 && shape(S.StockBulkResult, bulk.data) === true && T.stock_vehicles.length === rowsBefore + 3
    && loaded.some(r => r.model === 'Seal' && r.trim === 'Design' && r.price === 1950000 && r.units.length === 2 && r.quantity === 2 && r.units[0].status === 'in_logistics' && r.units[1].status === 'delivered' && r.notes === 'Immediate delivery'), JSON.stringify(bulk.data));
  const mixed = await call('POST', D + '/stock/bulk', { token: 'adm', form: csv('Make,Model,Trim,Price,Units,Notes\n"Honda","Civic, Sport",RS,"1,200,000",,"has, a comma"\n,Accord,,,,\nNissan,,,,,\nMG,ZS,,not a price,,\n') });
  const civic = T.stock_vehicles.find(r => r.make === 'Honda');
  check('a row the register cannot use is named and left out ("Row 3: Make is required" — the header is row 1), the others go in; the header may be in any case, a quoted cell may hold a comma, a price that is not a number is none',
    mixed.status === 200 && mixed.data.inserted === 2 && same(mixed.data.errors, ['Row 3: Make is required', 'Row 4: Model is required']) && civic && civic.model === 'Civic, Sport' && civic.price === 1200000 && civic.notes === 'has, a comma' && T.stock_vehicles.find(r => r.make === 'MG').price === 0, JSON.stringify(mixed.data));
  const allBad = await call('POST', D + '/stock/bulk', { token: 'adm', form: csv('make,model\n,\n,x\n') });
  check('a CSV in which every row is refused loads nothing and says why for each (inserted 0)', allBad.status === 200 && allBad.data.inserted === 0 && allBad.data.errors.length === 2, JSON.stringify(allBad.data));
  inject.push({
    test: (u, i) => /\/rest\/v1\/stock_vehicles/.test(u) && i.method === 'POST' && /"units"/.test(String(i.body)),
    reply: () => new Response(JSON.stringify({ code: '42703', message: 'column "units" of relation "stock_vehicles" does not exist' }), { status: 400, headers: JSON_HEADERS }),
  });
  const old = await call('POST', D + '/stock/bulk', { token: 'adm', form: csv('make,model,units\nOldDb,One,v1:Red:delivered\n') });
  inject.length = 0;
  T.quotation_settings.push({ key: 'columns_config:stock', value: JSON.stringify([{ key: 'status', label: 'Status', type: 'select', builtin: true, options: [{ key: 'in_house', label: 'In house' }] }]) });
  const cfgCsv = await call('POST', D + '/stock/bulk', { token: 'adm', form: csv('make,model,units\nCfg,Csv,v1:Red:in_house | v2:Red:in_logistics | v3:Red:nonsense\n') });
  T.quotation_settings.length = 0;
  const cfgRow = T.stock_vehicles.find(r => r.make === 'Cfg');
  check('a status the administrator added in the Columns editor is one the CSV keeps too, beside the built-in ones', cfgCsv.data.inserted === 1 && cfgRow && cfgRow.units.map(u => u.status).join() === 'in_house,in_logistics,send_to_supplier', JSON.stringify(cfgRow && cfgRow.units));
  check('a database without the cars\' column still takes the CSV, without the cars', old.status === 200 && old.data.inserted === 1 && T.stock_vehicles.some(r => r.make === 'OldDb' && !('units' in r) || r.make === 'OldDb' && same(r.units, [])), JSON.stringify(old.data));

  // ═══ What the contract lists is what the server keeps ═══════════════════════
  const rows = (await call('GET', D + '/stock', { token: 'adm' })).data;
  const odd2 = rows.filter(r => shape(S.StockVehicle, r) !== true);
  check('every vehicle the checks above left in the register — each way of being saved — is one the contract reads', odd2.length === 0, odd2.slice(0, 2).map(r => r.id + ': ' + shape(S.StockVehicle, r)).join('; '));
  check('a body the app sends is one the contract takes (the add form\'s)', shape(S.StockBody, { make: 'A', model: 'B', trim: '', price: '1,000', notes: '', units: [{ vin: 'x' }] }) === true && shape(S.StockBody, { make: 'A', model: 'B', units: 'V1:Red:delivered' }) === true && shape(S.StockBody, { model: 'B' }) !== true);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
