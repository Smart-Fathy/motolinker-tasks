// The supplier register and what hangs off it, as the server does them — in both portals, which share one handler each.
//
// The new app's Suppliers screen (and the column engine it brings) call these routes as they are: nothing is written twice, so
// there is nothing to unify yet. This holds what the screen may rely on: who may ask for what (each grant is its own: the
// register, creating, editing, deleting, the catalogue, the documents, the purchases), what a save keeps and trims, what is
// refused and with which status, what the column configuration is cleaned to on the way in and on the way out, and that every
// answer is the shape packages/contracts says it is. The purchase figures themselves are tests/suptest.js; the Drive upload is
// tests/drivetest.js — this reads what the screen is told about them.
const C = require('../packages/contracts');
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const S = C.schemas;
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };

const everyone = on => ({ view: on, create: on, edit: on, delete: on, catalogue: on, docs: on, purchases: on });
const db = createFakeSupabase({
  employees: [], sessions: [], quotation_settings: [], google_tokens: [],
  suppliers: [], supplier_vehicles: [], supplier_docs: [], stock_vehicles: [], purchase_orders: [],
// (rows are seeded after the tables are made, so the new ones' ids are counted from beyond them: a row made here must never share an id with one seeded)
}, { serial: { suppliers: 100, supplier_vehicles: 100, supplier_docs: 100 }, defaults: { suppliers: () => ({ created_by: 'dashboard', updated_at: new Date().toISOString() }), supplier_vehicles: () => ({ currency: 'USD' }) } });
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 4002 });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  const person = (id, name, suppliers, actions) => ({
    id, name, username: name.toLowerCase(), email: '', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), job_title: 'Ops',
    permissions: { suppliers, suppliersActions: actions }, avatar_url: '', status_text: '', status_emoji: '',
  });
  T.employees.push(
    person(2, 'Ana', true, everyone(true)),
    person(3, 'Ben', true, { ...everyone(false), view: true }),
    person(4, 'Cy', false, everyone(false)),
    person(5, 'Dee', true, { ...everyone(false), view: true, catalogue: true }),
  );

  const call = async (method, path, { token, body, form } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
    let data = null; try { data = await r.json(); } catch (_) {}
    return { status: r.status, data };
  };
  const signIn = async name => (await call('POST', '/api/employee/login', { body: { username: name.toLowerCase(), password: name.toLowerCase() + '-password-1' } })).data.token;
  const ana = await signIn('Ana'), ben = await signIn('Ben'), cy = await signIn('Cy'), dee = await signIn('Dee');
  ctx.sessions.set('adm', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const D = '/api/dashboard', E = '/api/employee';

  // ═══ Who may ask ════════════════════════════════════════════════════════════
  const doors = [['GET', '/suppliers'], ['POST', '/suppliers'], ['PUT', '/suppliers/1'], ['DELETE', '/suppliers/1'], ['GET', '/suppliers/1/vehicles'], ['POST', '/suppliers/1/vehicles'],
    ['PUT', '/suppliers/1/vehicles/1'], ['DELETE', '/suppliers/1/vehicles/1'], ['GET', '/supplier-vehicles'], ['GET', '/suppliers/1/docs'], ['DELETE', '/suppliers/1/docs/1'], ['GET', '/suppliers/1/purchases'],
    ['GET', '/columns/suppliers'], ['PUT', '/columns/suppliers']];
  const refused = [];
  for (const [m, p] of doors) {
    const a = await call(m, D + p, { body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    const b = await call(m, E + p, { body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    // the other portal's token is not a way in either
    const c = await call(m, E + p, { token: 'adm', body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    const d = await call(m, D + p, { token: ana, body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    if (a.status !== 401 || b.status !== 401 || c.status !== 401 || d.status !== 401) refused.push(`${m} ${p}: ${a.status}/${b.status}/${c.status}/${d.status}`);
  }
  check('every route needs the signed-in person of its own portal: nobody is a 401, and so is the other portal\'s token', refused.length === 0, refused.join('; '));
  check('a team member with the section off is refused the register (403), and so is one who has only some of the other grants',
    (await call('GET', E + '/suppliers', { token: cy })).status === 403);

  // ═══ The register ═══════════════════════════════════════════════════════════
  T.suppliers.push(
    { id: 1, name: 'Yu Motors', contact: 'yu@example.com', address: 'Shanghai', country: 'China', notes: '', custom_fields: { cf_rating: 'A' }, created_by: 'admin', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    { id: 2, name: 'Alpha Cars', contact: '', address: '', country: 'Japan', notes: 'slow to answer', created_by: 'employee_2', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
  );
  const list = await call('GET', E + '/suppliers', { token: ben });
  check('a member who may view reads the register, by name, in the shape the contract says', list.status === 200 && list.data.map(s => s.name).join() === 'Alpha Cars,Yu Motors' && shape(S.SupplierList, list.data) === true, shape(S.SupplierList, list.data));
  check('the administrator reads the same register', JSON.stringify((await call('GET', D + '/suppliers', { token: 'adm' })).data) === JSON.stringify(list.data));
  db.failing.add('suppliers');
  const down = await call('GET', E + '/suppliers', { token: ben });
  db.failing.delete('suppliers');
  check('a database that does not answer is a 500 with its words — never an empty register', down.status === 500 && typeof down.data.error === 'string' && !Array.isArray(down.data), JSON.stringify(down));

  const made = await call('POST', E + '/suppliers', { token: ana, body: { name: '  Gulf Auto  ', contact: ' sales@gulf.test ', country: ' UAE ', address: '', notes: ' pays late ', custom_fields: { cf_rating: 'B' }, ignored: 'x', created_by: 'forged' } });
  check('creating trims what it keeps, keeps the added fields, ignores anything else and files it under the member who made it',
    made.status === 200 && made.data.name === 'Gulf Auto' && made.data.contact === 'sales@gulf.test' && made.data.country === 'UAE' && made.data.notes === 'pays late'
    && made.data.custom_fields.cf_rating === 'B' && made.data.created_by === 'employee_2' && made.data.ignored === undefined && shape(S.Supplier, made.data) === true, JSON.stringify(made.data));
  const byAdmin = await call('POST', D + '/suppliers', { token: 'adm', body: { name: 'Admin Imports' } });
  check('…and the administrator\'s is filed under "admin", with the other fields empty', byAdmin.status === 200 && byAdmin.data.created_by === 'admin' && byAdmin.data.contact === '' && byAdmin.data.country === '');
  check('a name is required (a 400 that says so), and one of spaces is none',
    (await call('POST', E + '/suppliers', { token: ana, body: { name: '   ' } })).data.error === 'Supplier name is required'
    && (await call('POST', D + '/suppliers', { token: 'adm', body: {} })).status === 400);
  check('custom fields that are not an object are not kept', (await call('POST', E + '/suppliers', { token: ana, body: { name: 'No Fields', custom_fields: 'x' } })).data.custom_fields === undefined);
  check('creating, editing and deleting are each a grant: a viewer is refused all three (403), and the register is unchanged',
    (await call('POST', E + '/suppliers', { token: ben, body: { name: 'Nope' } })).status === 403
    && (await call('PUT', E + '/suppliers/1', { token: ben, body: { name: 'Nope' } })).status === 403
    && (await call('DELETE', E + '/suppliers/1', { token: ben })).status === 403
    && !T.suppliers.some(s => s.name === 'Nope') && T.suppliers.find(s => s.id === 1).name === 'Yu Motors');

  const edited = await call('PUT', E + '/suppliers/1', { token: ana, body: { name: ' Yu Motors Ltd ', contact: 'new@yu.test', country: 'China', address: '', notes: '' } });
  check('editing replaces the five fields (an empty one is emptied) and stamps the time', edited.status === 200 && edited.data.name === 'Yu Motors Ltd' && edited.data.address === '' && edited.data.contact === 'new@yu.test'
    && edited.data.updated_at !== '2026-01-01T00:00:00Z' && shape(S.Supplier, edited.data) === true);
  check('editing needs a name too', (await call('PUT', D + '/suppliers/1', { token: 'adm', body: { name: '' } })).status === 400);
  const gone = await call('PUT', E + '/suppliers/999', { token: ana, body: { name: 'Ghost' } });
  check('editing one that is not there is the database\'s own refusal, as it has always been (500 and its words)', gone.status === 500 && typeof gone.data.error === 'string', JSON.stringify(gone));

  const removed = await call('DELETE', E + '/suppliers/2', { token: ana });
  check('deleting answers ok and the supplier is gone', removed.status === 200 && removed.data.ok === true && !T.suppliers.some(s => s.id === 2));

  // ═══ What a supplier offers ═════════════════════════════════════════════════
  T.supplier_vehicles.push(
    { id: 1, supplier_id: 1, brand: 'BYD', model: 'Seal', trim: 'Max', model_year: 2026, availability: 'Pre-order', fob_price: 32789, currency: 'USD', lead_time: '4 to 6 weeks', accessories: 'mats', notes: '', custom_fields: {}, suppliers: { name: 'Yu Motors Ltd' } },
    { id: 2, supplier_id: 1, brand: 'Aion', model: 'Y', trim: '', model_year: null, availability: '', fob_price: null, currency: 'USD', lead_time: '', accessories: '', notes: '', custom_fields: { cf_stock: '12' }, suppliers: { name: 'Yu Motors Ltd' } },
    { id: 3, supplier_id: 3, brand: 'Geely', model: 'Starray', trim: '', model_year: 2026, availability: '', fob_price: 21000, currency: 'USD', lead_time: '8 weeks', accessories: '', notes: '', suppliers: { name: 'Gulf Auto' } },
  );
  const cat = await call('GET', E + '/suppliers/1/vehicles', { token: ben });
  check('the catalogue is readable with the register: only that supplier\'s vehicles, by brand then model', cat.status === 200 && cat.data.map(v => v.brand).join() === 'Aion,BYD' && shape(S.SupplierVehicleList, cat.data) === true, shape(S.SupplierVehicleList, cat.data));
  const offers = await call('GET', E + '/supplier-vehicles', { token: ben });
  check('every supplier\'s vehicles, each with the supplier\'s name beside it', offers.status === 200 && offers.data.length === 3 && offers.data.find(v => v.id === 3).supplier_name === 'Gulf Auto' && shape(S.SupplierOfferList, offers.data) === true, shape(S.SupplierOfferList, offers.data));
  check('…and the member with no register grant is refused both (403)', (await call('GET', E + '/suppliers/1/vehicles', { token: cy })).status === 403 && (await call('GET', E + '/supplier-vehicles', { token: cy })).status === 403);

  const added = await call('POST', E + '/suppliers/1/vehicles', { token: dee, body: { brand: ' MG ', model: '4', model_year: '2026', fob_price: '12,500.50 USD', currency: 'EGP-LONG-CODE', lead_time: ' 6 weeks ', custom_fields: { cf_stock: '3' } } });
  check('adding a vehicle: text is trimmed, a price is read out of what was typed, a year is a year, a currency is cut to eight characters',
    added.status === 200 && added.data.brand === 'MG' && added.data.fob_price === 12500.5 && added.data.model_year === 2026 && added.data.currency === 'EGP-LONG' && added.data.lead_time === '6 weeks'
    && added.data.supplier_id === 1 && added.data.custom_fields.cf_stock === '3' && shape(S.SupplierVehicle, added.data) === true, JSON.stringify(added.data));
  const odd = await call('POST', E + '/suppliers/1/vehicles', { token: dee, body: { model: 'Only a model', model_year: '1850', fob_price: 'free' } });
  check('a year out of range and a price that is not one are nothing; a model alone is enough', odd.status === 200 && odd.data.model_year === null && odd.data.fob_price === null && odd.data.brand === '');
  check('brand or model is required (a 400 that says so)', (await call('POST', E + '/suppliers/1/vehicles', { token: dee, body: { trim: 'x' } })).data.error === 'Brand or model is required');
  check('the catalogue is its own grant: view alone is refused (403), and so is editing the register without it',
    (await call('POST', E + '/suppliers/1/vehicles', { token: ben, body: { brand: 'x' } })).status === 403
    && (await call('PUT', E + '/suppliers/1/vehicles/1', { token: ben, body: { brand: 'x' } })).status === 403
    && (await call('DELETE', E + '/suppliers/1/vehicles/1', { token: ben })).status === 403
    && (await call('POST', E + '/suppliers/1/vehicles', { token: ana, body: { brand: 'Ana may' } })).status === 200);
  const changed = await call('PUT', E + '/suppliers/1/vehicles/1', { token: dee, body: { brand: 'BYD', model: 'Seal', fob_price: '33000', lead_time: '5 weeks', custom_fields: {} } });
  check('editing a vehicle saves the whole row and stamps the time', changed.status === 200 && changed.data.fob_price === 33000 && changed.data.lead_time === '5 weeks' && changed.data.trim === '' && typeof changed.data.updated_at === 'string');
  check('a vehicle is edited and removed only through its own supplier', (await call('PUT', E + '/suppliers/2/vehicles/1', { token: dee, body: { brand: 'Hijack' } })).status === 500
    && (await call('DELETE', E + '/suppliers/2/vehicles/1', { token: dee })).status === 200 && T.supplier_vehicles.some(v => v.id === 1));
  check('removing a vehicle answers ok and it is gone', (await call('DELETE', E + '/suppliers/1/vehicles/1', { token: dee })).data.ok === true && !T.supplier_vehicles.some(v => v.id === 1));

  // ═══ Their paperwork ════════════════════════════════════════════════════════
  T.supplier_docs.push(
    { id: 1, supplier_id: 1, name: 'price-list.pdf', drive_file_id: 'f1', web_link: 'https://drive.example/f1', mime_type: 'application/pdf', size_bytes: 20480, uploaded_by: 'admin', created_at: '2026-02-01T00:00:00Z' },
    { id: 2, supplier_id: 1, name: 'licence.png', drive_file_id: 'f2', web_link: 'https://drive.example/f2', mime_type: 'image/png', size_bytes: 512, uploaded_by: 'admin', created_at: '2026-03-01T00:00:00Z' },
    { id: 3, supplier_id: 2, name: 'other.pdf', drive_file_id: 'f3', web_link: '', mime_type: '', size_bytes: 0, uploaded_by: 'admin', created_at: '2026-03-02T00:00:00Z' },
  );
  const docs = await call('GET', E + '/suppliers/1/docs', { token: ana });
  check('the documents of the supplier, newest first, in the shape the contract says', docs.status === 200 && docs.data.map(d => d.id).join() === '2,1' && shape(S.SupplierDocList, docs.data) === true, shape(S.SupplierDocList, docs.data));
  check('the documents are their own grant: a member who may only view the register is refused (403)', (await call('GET', E + '/suppliers/1/docs', { token: ben })).status === 403 && (await call('DELETE', E + '/suppliers/1/docs/1', { token: ben })).status === 403);
  const up = (name, bytes) => { const f = new FormData(); f.append('file', new Blob([bytes], { type: 'application/pdf' }), name); return f; };
  const noFile = new FormData(); noFile.append('note', 'no file here');
  check('an upload without a file is a 400, and one when Google is not set up says so (409), so nothing is stored',
    (await call('POST', E + '/suppliers/1/docs', { token: ana, form: noFile })).data.error === 'No file'
    && (await call('POST', E + '/suppliers/1/docs', { token: ana, form: up('x.pdf', 'abc') })).status === 409
    && (await call('POST', E + '/suppliers/1/docs', { token: ana, form: up('x.pdf', 'abc') })).data.error === 'Google is not configured on this deployment.'
    && T.supplier_docs.length === 3);
  const big = await call('POST', D + '/suppliers/1/docs', { token: 'adm', form: up('big.pdf', Buffer.alloc(26 * 1024 * 1024)) });
  check('a file over 25 MB is refused with the limit in words (413)', big.status === 413 && /25 MB/.test(big.data.error), JSON.stringify(big));
  check('removing a document removes its row (the file stays in Drive), only through its own supplier',
    (await call('DELETE', E + '/suppliers/2/docs/1', { token: ana })).status === 200 && T.supplier_docs.some(d => d.id === 1)
    && (await call('DELETE', E + '/suppliers/1/docs/1', { token: ana })).data.ok === true && !T.supplier_docs.some(d => d.id === 1));

  // ═══ What was bought ════════════════════════════════════════════════════════
  T.stock_vehicles.push({ id: 10, make: 'BYD', model: 'Seal', trim: 'Max', units: [
    { vin: 'V1', colour: 'White', status: 'delivered', supplier_id: 1, discounted: 30000, price_list: 32000 },
    { vin: 'V2', colour: 'Black', status: 'in_logistics', supplier: 'Yu Motors Ltd', price_list: 34000 },
    { vin: 'V3', colour: 'Red', supplier_id: 99, price_list: 99999 },
  ] });
  T.purchase_orders.push({ id: 20, po_number: 'PO-20', po_date: '2026-04-01', supplier_id: 1, supplier: 'Yu Motors Ltd', currency: 'USD', items: [{ brand: 'BYD', model: 'Seal', trim: 'Max', qty: 2, fob_price: '31,000', lead_time: '6 weeks' }, { brand: 'Aion', model: 'Y', qty: 1, lead_time: '6 weeks' }] });
  const buys = await call('GET', E + '/suppliers/1/purchases', { token: ana });
  check('what was bought: the cars held against stock (by id, or by name where the id is missing), the lines ordered, and the figures over both',
    buys.status === 200 && buys.data.units.length === 2 && buys.data.poLines.length === 2 && buys.data.totals.vehicles === 2 && buys.data.totals.ordered === 3
    && buys.data.totals.avg_unit_price === 32000 && buys.data.totals.avg_po_price === 31000 && buys.data.totals.lead_times.join() === '6 weeks' && shape(S.SupplierPurchases, buys.data) === true, shape(S.SupplierPurchases, buys.data));
  check('the purchases are their own grant: a member who may only view the register is refused (403), the administrator is not',
    (await call('GET', E + '/suppliers/1/purchases', { token: ben })).status === 403 && (await call('GET', D + '/suppliers/1/purchases', { token: 'adm' })).status === 200);
  const nothing = await call('GET', D + '/suppliers/777/purchases', { token: 'adm' });
  check('a supplier nothing was bought from has nothing: empty lists and zeros', nothing.status === 200 && nothing.data.units.length === 0 && nothing.data.poLines.length === 0 && nothing.data.totals.vehicles === 0 && nothing.data.totals.lead_times.length === 0 && shape(S.SupplierPurchases, nothing.data) === true);

  // ═══ The columns of each ════════════════════════════════════════════════════
  const none = await call('GET', D + '/columns/suppliers', { token: 'adm' });
  check('a table nobody has arranged has no configuration (columns: null) — its own columns stand', none.status === 200 && none.data.columns === null && none.data.entity === 'suppliers' && shape(S.ColumnsResponse, none.data) === true);
  check('an entity the server does not know is a 404, and a configuration that is not a list is a 400',
    (await call('GET', D + '/columns/nonsense', { token: 'adm' })).status === 404 && (await call('PUT', D + '/columns/suppliers', { token: 'adm', body: { columns: 'x' } })).data.error === 'columns must be an array');
  const dirty = [
    { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true, width: 140 },
    { key: 'country', label: 'Country', type: 'select', builtin: true, visible: true, width: 5000, options: [{ key: 'cn', label: 'China', color: '#AA00FF' }, { key: 'x"y', label: 'Quote' }, { key: 'jp', label: 'Japan', color: 'red' }] },
    { key: 'cf_rating', label: 'Rating', type: 'telepathy', builtin: false, visible: false, required: true },
    { key: "cf_'evil", label: 'Evil', type: 'text' },
    { key: 'cf_rating', label: 'Rating again', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'text', builtin: true, deleted: true, visible: false },
    null, 'junk', { label: 'No key' },
  ];
  const saved = await call('PUT', D + '/columns/suppliers', { token: 'adm', body: { columns: dirty } });
  const kept = saved.data.columns || [];
  check('what is saved is cleaned: an unknown type is text, a key with a quote is dropped, a repeated key is kept once, an option\'s colour is #rrggbb in lower case or nothing, a width outside 40–800 is none',
    saved.status === 200 && saved.data.ok === true && kept.map(c => c.key).join() === 'name,country,cf_rating,notes'
    && kept[2].type === 'text' && kept[2].required === true && kept[2].visible === false && kept[1].width === undefined && kept[0].width === 140
    && kept[1].options.map(o => o.key).join() === 'cn,jp' && kept[1].options[0].color === '#aa00ff' && kept[1].options[1].color === undefined && kept[3].deleted === true
    && shape(S.ColumnsSaved, saved.data) === true, JSON.stringify(saved.data));
  const back = await call('GET', E + '/columns/suppliers', { token: ben });
  check('the team reads what the administrator arranged, in the shape the contract says', back.status === 200 && JSON.stringify(back.data.columns) === JSON.stringify(kept) && shape(S.ColumnsResponse, back.data) === true);
  check('…a member with no register grant does not (403)', (await call('GET', E + '/columns/suppliers', { token: cy })).status === 403);
  check('…and nobody on the team arranges it, whatever they are granted (403): the layout is the administrator\'s',
    (await call('PUT', E + '/columns/suppliers', { token: ana, body: { columns: [] } })).status === 403 && (await call('PUT', E + '/columns/supplier_vehicles', { token: dee, body: { columns: [] } })).status === 403
    && JSON.stringify((await call('GET', D + '/columns/suppliers', { token: 'adm' })).data.columns) === JSON.stringify(kept));
  T.quotation_settings.push({ key: 'columns_config:supplier_vehicles', value: JSON.stringify([{ key: 'brand', label: 'Brand', type: 'text', builtin: true, visible: true }, { key: '<b>x', label: 'Bad', type: 'text' }, { key: 'cf_ok', label: 'Fine', type: 'nope' }]) });
  const reread = await call('GET', E + '/columns/supplier_vehicles', { token: ben });
  check('a configuration that reached the table some other way is cleaned on the way out as well', reread.status === 200 && reread.data.columns.map(c => c.key + ':' + c.type).join() === 'brand:text,cf_ok:text' && shape(S.ColumnsResponse, reread.data) === true, JSON.stringify(reread.data));
  const many = await call('PUT', D + '/columns/supplier_vehicles', { token: 'adm', body: { columns: Array.from({ length: 80 }, (_, i) => ({ key: 'cf_' + i, label: 'F' + i, type: 'text' })) } });
  check('no more than 60 columns are kept', many.data.columns.length === 60);
  db.failing.add('quotation_settings');
  const lenient = await call('GET', D + '/columns/suppliers', { token: 'adm' });
  const refusedSave = await call('PUT', D + '/columns/suppliers', { token: 'adm', body: { columns: [] } });
  db.failing.delete('quotation_settings');
  check('settings that cannot be read are read as "nothing arranged" (null: the screen\'s own columns stand), as they always were; one that cannot be written says so (500)',
    lenient.status === 200 && lenient.data.columns === null && refusedSave.status === 500 && typeof refusedSave.data.error === 'string', JSON.stringify([lenient, refusedSave]));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
