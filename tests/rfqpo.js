// RFQs and purchase orders, as the server does them — in both portals, which share one handler each.
//
// The new app's RFQ and Purchase-orders screens call these routes as they are: nothing is written twice, so there is nothing to
// unify yet. This holds what the screens may rely on: who may ask for what (each grant is its own: view, create, edit, delete,
// export), what a save keeps, cleans and refuses, what the starting form is filled with, what an export hands back, and that every
// answer is the shape packages/contracts says it is. The lists in packages/contracts/src/documents.js — the statuses and the
// fields of a line — are held to what the routes accept and keep here. The workbook and the document themselves are
// tests/doc-rfq.js and tests/doc-po.js.
const C = require('../packages/contracts');
const { pointPuppeteerAtChrome } = require('./helpers/browser');
pointPuppeteerAtChrome();
const { createFakeSupabase, bootApp } = require('./helpers/fake-supabase');

const S = C.schemas;
const DOCS = C.documents;
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const shape = (schema, value) => { const r = schema.safeParse(value); return r.success ? true : JSON.stringify(r.error.issues.slice(0, 2)); };

const grants = (on, over = {}) => ({ view: on, create: on, edit: on, delete: on, export: on, ...over });
const now = () => new Date().toISOString();
const db = createFakeSupabase({
  employees: [], sessions: [], quotation_settings: [], google_tokens: [], customers: [], lead_activities: [],
  rfqs: [], purchase_orders: [],
// (rows are seeded after the tables are made, so a row made by a route never shares an id with one seeded here)
}, { serial: { rfqs: 100, purchase_orders: 100, lead_activities: 100 }, defaults: {
  rfqs: () => ({ created_at: now(), updated_at: now(), title: '' }),
  purchase_orders: () => ({ created_at: now(), updated_at: now(), title: '' }),
} });
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 4005 });
  const ctx = require(process.cwd() + '/src/ctx');
  const T = db.tables;
  const person = (id, name, rfq, po) => ({
    id, name, username: name.toLowerCase(), email: '', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), job_title: 'Ops',
    permissions: { rfq: rfq !== false, rfqActions: rfq || grants(false), purchaseorders: po !== false, purchaseordersActions: po || grants(false) },
    avatar_url: '', status_text: '', status_emoji: '',
  });
  T.employees.push(
    person(2, 'Ana', grants(true), grants(true)),
    person(3, 'Ben', grants(false, { view: true }), grants(false, { view: true })),
    person(4, 'Cy', false, false),
    person(5, 'Dee', grants(false, { view: true, export: true }), grants(false, { view: true, export: true })),
    person(6, 'Eli', grants(false, { view: true, create: true }), grants(false, { view: true, create: true })),
  );
  T.customers.push({ id: 7, name: 'Mona Saleh', phone: '010', car_in_question: 'BYD Seal Max', custom_fields: { cf_color: 'White / Black', cf_year: '2026' } });

  const call = async (method, path, { token, body } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch (_) {}
    return { status: r.status, data };
  };
  const signIn = async name => (await call('POST', '/api/employee/login', { body: { username: name.toLowerCase(), password: name.toLowerCase() + '-password-1' } })).data.token;
  const ana = await signIn('Ana'), ben = await signIn('Ben'), cy = await signIn('Cy'), dee = await signIn('Dee'), eli = await signIn('Eli');
  ctx.sessions.set('adm', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const D = '/api/dashboard', E = '/api/employee';

  // ═══ Who may ask ════════════════════════════════════════════════════════════
  for (const [kind, seg, one] of [['RFQs', '/rfqs', '/rfqs/1'], ['purchase orders', '/purchase-orders', '/purchase-orders/1']]) {
    const doors = [['GET', seg], ['GET', seg + '/new/defaults'], ['GET', one], ['POST', seg], ['PUT', one], ['DELETE', one], ['POST', seg + (seg === '/rfqs' ? '/xlsx' : '/pdf')], ['POST', one + (seg === '/rfqs' ? '/xlsx' : '/pdf')]];
    const refused = [];
    for (const [m, p] of doors) {
      const body = m === 'GET' || m === 'DELETE' ? undefined : {};
      const a = await call(m, D + p, { body });
      const b = await call(m, E + p, { body });
      const c = await call(m, E + p, { token: 'adm', body });   // the other portal's token is not a way in either
      const d = await call(m, D + p, { token: ana, body });
      if (a.status !== 401 || b.status !== 401 || c.status !== 401 || d.status !== 401) refused.push(`${m} ${p}: ${a.status}/${b.status}/${c.status}/${d.status}`);
    }
    check(`${kind}: every route needs the signed-in person of its own portal — nobody is a 401, and so is the other portal's token`, refused.length === 0, refused.join('; '));
  }
  const doorsFor = seg => [['GET', seg], ['GET', seg + '/new/defaults'], ['GET', seg + '/1'], ['POST', seg], ['PUT', seg + '/1'], ['DELETE', seg + '/1'], ['POST', seg + (seg === '/rfqs' ? '/xlsx' : '/pdf')], ['POST', seg + '/1' + (seg === '/rfqs' ? '/xlsx' : '/pdf')]];
  for (const seg of ['/rfqs', '/purchase-orders']) {
    const none = [];
    for (const [m, p] of doorsFor(seg)) {
      const r = await call(m, E + p, { token: cy, body: m === 'GET' || m === 'DELETE' ? undefined : {} });
      if (r.status !== 403) none.push(`${m} ${p}: ${r.status}`);
    }
    check(`${seg}: a team member with the section off is refused every route (403)`, none.length === 0, none.join('; '));
    const viewer = [];
    const writes = doorsFor(seg).filter(([m, p]) => m !== 'GET' || /new\/defaults/.test(p));
    for (const [m, p] of writes) {
      const r = await call(m, E + p, { token: ben, body: m === 'GET' || m === 'DELETE' ? undefined : {} });
      if (r.status !== 403) viewer.push(`${m} ${p}: ${r.status}`);
    }
    check(`${seg}: a member who may only view is refused creating, editing, deleting, exporting and the starting form (403)`, viewer.length === 0, viewer.join('; '));
  }

  // ═══ RFQs ═══════════════════════════════════════════════════════════════════
  const RFQ = {
    rfq_no: 'MT10W111Y26', title: 'Seal pre-order', supplier_id: 1, supplier_name: 'Yu Motors', supplier_contact: 'yu@x.test', supplier_address: 'Shenzhen',
    supplier_country: 'CN', issuer: 'Ops', rfq_date: '2026-10-01', items: [{ brand: 'BYD', model: 'Seal' }], payment_terms: '30/70', delivery_location: 'Alexandria',
    service_provider: 'Maersk', contact: 'ops@x.test', documents_required: 'B/L', customer_id: 7, status: 'sent', custom_fields: { cf_ref: 'A1' }, created_by: 'dashboard',
    created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z',
  };
  T.rfqs.push({ id: 1, ...RFQ }, { id: 2, ...RFQ, rfq_no: 'MT11W222Y26', title: 'Later', created_at: '2026-10-02T09:00:00Z', status: 'draft', items: [] });

  const rl = await call('GET', E + '/rfqs', { token: ben });
  check('a member who may view reads the RFQs, the newest first, with what a list is drawn from — in the shape the contract says',
    rl.status === 200 && rl.data.map(r => r.id).join() === '2,1' && shape(S.RfqList, rl.data) === true && !('supplier_contact' in rl.data[0]), shape(S.RfqList, rl.data));
  const adminRl = await call('GET', D + '/rfqs', { token: 'adm' });
  check('the administrator reads the same list', JSON.stringify(adminRl.data) === JSON.stringify(rl.data));
  const r1 = await call('GET', E + '/rfqs/1', { token: ben });
  check('one RFQ comes whole — the supplier block, the terms and the added fields — in the shape the contract says', r1.status === 200 && r1.data.supplier_contact === 'yu@x.test' && r1.data.custom_fields.cf_ref === 'A1' && shape(S.Rfq, r1.data) === true, shape(S.Rfq, r1.data));
  const r404 = await call('GET', E + '/rfqs/999', { token: ben });
  check('one that is not there is a 404 that says so', r404.status === 404 && r404.data.error === 'RFQ not found', JSON.stringify(r404));

  const d0 = await call('GET', E + '/rfqs/new/defaults', { token: eli });
  check('the starting form needs only the grant to create: a number, today, eight lines (each with the standing accessories), the standing terms and documents',
    d0.status === 200 && /^MT\d\dW\d{3}Y\d\d$/.test(d0.data.rfq_no) && d0.data.rfq_date === new Date().toISOString().slice(0, 10) && d0.data.items.length === 8
    && d0.data.items.every(i => i.accessories === require('../src/lib/docs/defaults').DOC_DEFAULT_ACCESSORIES) && d0.data.payment_terms.startsWith('30% deposit') && d0.data.documents_required.startsWith('MSDS')
    && d0.data.customer_id === null && shape(S.RfqDefaults, d0.data) === true, shape(S.RfqDefaults, d0.data));
  const d1 = await call('GET', E + '/rfqs/new/defaults?customer_id=7', { token: eli });
  check('…and, for a lead, the first line is the car they asked about (the rest stay blank) and the lead is named',
    d1.data.customer_id === 7 && d1.data.items[0].brand === 'BYD' && d1.data.items[0].model === 'Seal Max' && d1.data.items[0].colour === 'White / Black' && d1.data.items[0].year === '2026' && d1.data.items[1].brand === '' && shape(S.RfqDefaults, d1.data) === true, JSON.stringify(d1.data.items[0]));

  const made = await call('POST', E + '/rfqs', { token: ana, body: {
    rfq_no: '  MT12W333Y26  ', title: '  T  ', supplier_id: '1', supplier_name: ' Yu ', issuer: 'Ana', rfq_date: '2026-10-05', status: 'answered', customer_id: '7',
    items: [{ brand: ' BYD ', model: 'Seal', fob_price: 'USD 12,500', cif_price: '13000.50', colour: 'White', cf_grade: 'A' }, {}, { trim: 'Max' }, { cif_price: '0' }, { brand: '', model: '' }],
    custom_fields: { cf_ref: 'Z' } } });
  const mrow = T.rfqs.find(r => r.rfq_no === 'MT12W333Y26');
  check('creating keeps the trimmed header, whole-number ids and the added fields, files it under the member, and answers the saved row',
    made.status === 200 && made.data.id && mrow && mrow.title === 'T' && mrow.supplier_id === 1 && mrow.customer_id === 7 && mrow.supplier_name === 'Yu' && mrow.status === 'answered' && mrow.created_by === 'employee_2'
    && mrow.custom_fields.cf_ref === 'Z' && shape(S.Rfq, made.data) === true, shape(S.Rfq, made.data) + ' ' + JSON.stringify(mrow && mrow.created_by));
  check('…a line keeps its trimmed words, its prices as numbers (what is not one is nothing), a blank accessories as the standing wording, and a column the administrator added alongside',
    mrow.items[0].brand === 'BYD' && mrow.items[0].fob_price === 12500 && mrow.items[0].cif_price === 13000.5 && mrow.items[0].cf_grade === 'A'
    && mrow.items[0].accessories === require('../src/lib/docs/defaults').DOC_DEFAULT_ACCESSORIES, JSON.stringify(mrow.items[0]));
  check('…and a line with nothing of its own is not kept (blank, zero price, an empty brand), where one with only a trim is', mrow.items.length === 2 && mrow.items[1].trim === 'Max', JSON.stringify(mrow.items.map(i => i.trim || i.brand)));
  const odd = await call('POST', E + '/rfqs', { token: ana, body: { status: 'nonsense', custom_fields: 'x', supplier_id: 'abc', customer_id: '', items: 'not a list', rfq_date: '' } });
  const orow = T.rfqs.find(r => r.id === odd.data.id);
  check('a status that is not one of the four is a draft, added fields that are not an object are none, an id that is no number is none, a number is made when none was given',
    odd.status === 200 && orow.status === 'draft' && JSON.stringify(orow.custom_fields) === '{}' && Number.isNaN(orow.supplier_id) === false && orow.customer_id === null && orow.items.length === 0 && /^MT\d\dW\d{3}Y\d\d$/.test(orow.rfq_no) && orow.rfq_date === null,
    JSON.stringify({ status: orow.status, cf: orow.custom_fields, sid: orow.supplier_id, no: orow.rfq_no }));
  const keys = [];
  for (const [key] of DOCS.RFQ_STATUSES) {
    const r = await call('POST', E + '/rfqs', { token: ana, body: { status: key, items: [{ brand: 'X' }] } });
    if (T.rfqs.find(x => x.id === r.data.id).status !== key) keys.push(key);
  }
  check('every status the contract lists is one the server keeps as it was sent', keys.length === 0, keys.join());
  const lineKeys = [];
  const probe = Object.fromEntries(DOCS.RFQ_LINE_FIELDS.map(([k]) => [k, DOCS.RFQ_LINE_NUMBERS.includes(k) ? '7' : 'x ' + k]));
  const pr = await call('POST', E + '/rfqs', { token: ana, body: { items: [probe] } });
  const prow = T.rfqs.find(x => x.id === pr.data.id).items[0];
  for (const [k] of DOCS.RFQ_LINE_FIELDS) if (prow[k] === undefined || prow[k] === '' || prow[k] === 0) lineKeys.push(k);
  check('every field the contract gives an RFQ line is one the server keeps', lineKeys.length === 0, lineKeys.join());
  check('creating for a lead leaves a note in the lead\'s history, by whoever made it', T.lead_activities.some(a => a.customer_id === 7 && a.body === 'RFQ created — MT12W333Y26' && a.author_key === 'employee_2'), JSON.stringify(T.lead_activities.slice(-1)));

  const upd = await call('PUT', E + '/rfqs/' + made.data.id, { token: ana, body: { rfq_no: 'CHANGED', title: 'New title', status: 'closed', items: [{ model: 'Han' }], supplier_name: '' } });
  const urow = T.rfqs.find(r => r.id === made.data.id);
  check('editing replaces what the form sends (an emptied field is emptied), stamps the time, and never changes the number',
    upd.status === 200 && urow.rfq_no === 'MT12W333Y26' && urow.title === 'New title' && urow.status === 'closed' && urow.supplier_name === '' && urow.items.length === 1 && urow.items[0].model === 'Han' && urow.updated_at && shape(S.Rfq, upd.data) === true, shape(S.Rfq, upd.data));
  const gone = await call('DELETE', E + '/rfqs/' + made.data.id, { token: ana });
  check('deleting answers ok and the RFQ is gone', gone.status === 200 && shape(S.DocDeleted, gone.data) === true && !T.rfqs.some(r => r.id === made.data.id));
  const ed = await call('PUT', E + '/rfqs/999', { token: ana, body: { items: [] } });
  check('editing one that is not there is the database\'s own refusal (500 and its words), as it has always been', ed.status === 500 && typeof ed.data.error === 'string', JSON.stringify(ed));

  // ═══ RFQ exports ════════════════════════════════════════════════════════════
  const xs = await call('POST', E + '/rfqs/1/xlsx', { token: dee });
  const bytes = xs.data && xs.data.xlsx ? Buffer.from(xs.data.xlsx, 'base64') : Buffer.alloc(0);
  check('a saved RFQ is a workbook: base64 of a real .xlsx, named for its number — for a member who may export', xs.status === 200 && bytes.slice(0, 2).toString() === 'PK' && xs.data.name === 'MT10W111Y26' && shape(S.RfqXlsx, xs.data) === true, shape(S.RfqXlsx, xs.data));
  const xp = await call('POST', E + '/rfqs/xlsx', { token: dee, body: { rfq_no: 'DRAFT-1', supplier_name: 'Yu', items: [{ brand: 'BYD', model: 'Seal' }] } });
  check('…and so is the form as it stands, unsaved (the same answer from what it sends)', xp.status === 200 && Buffer.from(xp.data.xlsx, 'base64').slice(0, 2).toString() === 'PK' && xp.data.name === 'DRAFT-1' && shape(S.RfqXlsx, xp.data) === true);
  const x404 = await call('POST', E + '/rfqs/999/xlsx', { token: dee });
  check('an RFQ that is not there is a 404 that says so', x404.status === 404 && x404.data.error === 'RFQ not found', JSON.stringify(x404));
  const x410 = await call('POST', E + '/rfqs/1/pdf', { token: dee });
  check('a tab that still asks for the PDF is told why (410), where it was a 404 nobody could read', x410.status === 410 && /Excel/.test(x410.data.error), JSON.stringify(x410));

  // ═══ Purchase orders ════════════════════════════════════════════════════════
  const PO = {
    po_number: 'PO2610-1111', title: 'October order', supplier: 'Yu Motors', po_date: '2026-10-02', currency: 'USD', notes: 'n', status: 'confirmed', customer_id: 7,
    items: [{ client: 'Mona', brand: 'BYD', model: 'Seal', units: 2, pi_price: 31000, status: 'in_logistics' }], supplier_id: 1, supplier_contact: 'c', supplier_address: 'a',
    supplier_country: 'CN', issuer: 'Ops', quote_id: 'Q1', incoterm: 'FOB', delivery_location: 'Alexandria', service_provider: 'Maersk', contact: 'k', documents_required: 'B/L',
    payment_terms: '30/70', custom_fields: { cf_ref: 'A1' }, created_by: 'dashboard', created_at: '2026-10-02T09:00:00Z', updated_at: '2026-10-02T09:00:00Z',
  };
  T.purchase_orders.push({ id: 1, ...PO }, { id: 2, ...PO, po_number: 'PO2611-2222', title: 'Later', created_at: '2026-10-03T09:00:00Z', status: 'draft', items: [] });

  const pl = await call('GET', E + '/purchase-orders', { token: ben });
  check('a member who may view reads the purchase orders, the newest first, in the shape the contract says',
    pl.status === 200 && pl.data.map(r => r.id).join() === '2,1' && shape(S.PoList, pl.data) === true && !('notes' in pl.data[0]), shape(S.PoList, pl.data));
  const p1 = await call('GET', E + '/purchase-orders/1', { token: ben });
  check('one comes whole — the letterhead, the terms and the added fields', p1.status === 200 && p1.data.incoterm === 'FOB' && p1.data.custom_fields.cf_ref === 'A1' && shape(S.Po, p1.data) === true, shape(S.Po, p1.data));
  const p404 = await call('GET', E + '/purchase-orders/999', { token: ben });
  check('one that is not there is a 404 that says so', p404.status === 404 && p404.data.error === 'Purchase order not found', JSON.stringify(p404));

  const pd = await call('GET', E + '/purchase-orders/new/defaults', { token: eli });
  check('the starting form: a number, today, USD and one blank line', pd.status === 200 && /^PO\d{4}-\d{4}$/.test(pd.data.po_number) && pd.data.po_date === new Date().toISOString().slice(0, 10) && pd.data.currency === 'USD' && pd.data.items.length === 1 && pd.data.items[0].units === 1 && pd.data.items[0].status === 'send_to_supplier' && pd.data.customer_id === null && shape(S.PoDefaults, pd.data) === true, shape(S.PoDefaults, pd.data));
  const pd1 = await call('GET', E + '/purchase-orders/new/defaults?customer_id=7', { token: eli });
  check('…for a lead, its one line is the lead as client and consignee, and the car they asked about', pd1.data.customer_id === 7 && pd1.data.items[0].client === 'Mona Saleh' && pd1.data.items[0].consignee === 'Mona Saleh' && pd1.data.items[0].brand === 'BYD' && pd1.data.items[0].model === 'Seal Max' && pd1.data.items[0].color === 'White / Black' && pd1.data.items[0].year === '2026', JSON.stringify(pd1.data.items[0]));

  const pm = await call('POST', E + '/purchase-orders', { token: ana, body: {
    po_number: ' PO2610-9999 ', supplier: ' Yu ', po_date: '2026-10-08', currency: ' eur ', status: 'sent', customer_id: '7', incoterm: ' CIF ', supplier_id: '1',
    items: [{ client: ' Mona ', brand: 'BYD', units: '3 cars', pi_price: 'USD 31,000.50', status: 'delivered', cf_grade: 'A' }, { units: '5' }, { vin: 'V1' }, { client: '', brand: '', model: '', vin: '' }, { brand: 'Han', status: 'not a status', units: '0' }],
    custom_fields: { cf_ref: 'Z' } } });
  const prow2 = T.purchase_orders.find(r => r.po_number === 'PO2610-9999');
  check('creating keeps the trimmed header, the incoterm, whole-number ids and the added fields, and files it under the member',
    pm.status === 200 && prow2 && prow2.supplier === 'Yu' && prow2.currency === 'eur' && prow2.status === 'sent' && prow2.customer_id === 7 && prow2.supplier_id === 1 && prow2.incoterm === 'CIF' && prow2.created_by === 'employee_2' && prow2.custom_fields.cf_ref === 'Z' && shape(S.Po, pm.data) === true, shape(S.Po, pm.data));
  check('…a line: units are a whole number of one at least, a price is a number out of what was typed, a status is one of the four (or the first), and the administrator\'s columns ride alongside',
    prow2.items[0].units === 3 && prow2.items[0].pi_price === 31000.5 && prow2.items[0].status === 'delivered' && prow2.items[0].cf_grade === 'A' && prow2.items[1].vin === 'V1' && prow2.items.length === 3 && prow2.items[2].status === 'send_to_supplier' && prow2.items[2].units === 1, JSON.stringify(prow2.items));
  check('…and a line that names nobody and nothing (only units, or nothing) is not kept', !prow2.items.some(i => !i.client && !i.brand && !i.model && !i.vin), JSON.stringify(prow2.items.map(i => i.units)));
  const podd = await call('POST', E + '/purchase-orders', { token: ana, body: { status: 'nonsense', currency: '', incoterm: '', items: [{ brand: 'X' }] } });
  const poddRow = T.purchase_orders.find(r => r.id === podd.data.id);
  check('a status that is not one of the four is a draft, a missing currency is USD and a missing incoterm is FOB; a number is made when none was given',
    poddRow.status === 'draft' && poddRow.currency === 'USD' && poddRow.incoterm === 'FOB' && /^PO\d{4}-\d{4}$/.test(poddRow.po_number), JSON.stringify({ s: poddRow.status, c: poddRow.currency, i: poddRow.incoterm }));
  const pkeys = [];
  for (const [key] of DOCS.PO_STATUSES) {
    const r = await call('POST', E + '/purchase-orders', { token: ana, body: { status: key, items: [{ brand: 'X' }] } });
    if (T.purchase_orders.find(x => x.id === r.data.id).status !== key) pkeys.push(key);
  }
  check('every purchase-order status the contract lists is one the server keeps as it was sent', pkeys.length === 0, pkeys.join());
  const lkeys = [];
  for (const s of DOCS.PO_LINE_STATUSES) {
    const r = await call('POST', E + '/purchase-orders', { token: ana, body: { items: [{ brand: 'X', status: s.key }] } });
    if (T.purchase_orders.find(x => x.id === r.data.id).items[0].status !== s.key) lkeys.push(s.key);
  }
  const constants = require('../src/lib/constants');
  check('every line status the contract lists is one the server keeps — and they are the server\'s own, key for key, with the same labels and colours', lkeys.length === 0 && JSON.stringify(DOCS.PO_LINE_STATUSES) === JSON.stringify(constants.PO_LINE_STATUSES), lkeys.join());
  const pprobe = Object.fromEntries(DOCS.PO_LINE_FIELDS.map(([k]) => [k, DOCS.PO_LINE_NUMBERS.includes(k) ? '7' : k === 'status' ? 'delivered' : 'x ' + k]));
  const ppr = await call('POST', E + '/purchase-orders', { token: ana, body: { items: [pprobe] } });
  const pprow = T.purchase_orders.find(x => x.id === ppr.data.id).items[0];
  const missing = DOCS.PO_LINE_FIELDS.filter(([k]) => pprow[k] === undefined || pprow[k] === '' || pprow[k] === 0).map(([k]) => k);
  check('every field the contract gives a purchase-order line is one the server keeps', missing.length === 0, missing.join());

  // the statuses the administrator gave the lines (the Columns editor) are what a save may write
  T.quotation_settings.push({ key: 'columns_config:po_items', value: JSON.stringify([{ key: 'status', label: 'Status', type: 'select', builtin: true, visible: true, options: [{ key: 'at_port', label: 'At port' }, { key: 'delivered', label: 'Delivered' }] }]) });
  const own = await call('POST', E + '/purchase-orders', { token: ana, body: { items: [{ brand: 'A', status: 'at_port' }, { brand: 'B', status: 'in_logistics' }, { brand: 'C', status: 'nonsense' }] } });
  const ownRow = T.purchase_orders.find(x => x.id === own.data.id);
  check('a line status the administrator added is kept beside the built-in ones (an order made before keeps its own), and one that is neither is the first', ownRow.items[0].status === 'at_port' && ownRow.items[1].status === 'in_logistics' && ownRow.items[2].status === 'send_to_supplier', JSON.stringify(ownRow.items.map(i => i.status)));
  T.quotation_settings.length = 0;

  const pupd = await call('PUT', E + '/purchase-orders/' + pm.data.id, { token: ana, body: { po_number: 'CHANGED', supplier: 'Other', status: 'closed', items: [{ brand: 'Han' }] } });
  const pu = T.purchase_orders.find(r => r.id === pm.data.id);
  check('editing replaces what the form sends, stamps the time and never changes the number', pupd.status === 200 && pu.po_number === 'PO2610-9999' && pu.supplier === 'Other' && pu.status === 'closed' && pu.items.length === 1 && shape(S.Po, pupd.data) === true, shape(S.Po, pupd.data));
  check('creating for a lead leaves a note in the lead\'s history', T.lead_activities.some(a => a.customer_id === 7 && a.body === 'Purchase order created — PO2610-9999'));
  const pgone = await call('DELETE', E + '/purchase-orders/' + pm.data.id, { token: ana });
  check('deleting answers ok and the purchase order is gone', pgone.status === 200 && shape(S.DocDeleted, pgone.data) === true && !T.purchase_orders.some(r => r.id === pm.data.id));

  // ═══ The purchase order, as a document ══════════════════════════════════════
  const pdfById = await call('POST', E + '/purchase-orders/1/pdf', { token: dee });
  const pdfBytes = pdfById.data && pdfById.data.pdf ? Buffer.from(pdfById.data.pdf, 'base64') : Buffer.alloc(0);
  check('a saved purchase order is a PDF — base64 of a real one, named for its number — for a member who may export', pdfById.status === 200 && pdfBytes.slice(0, 4).toString() === '%PDF' && pdfById.data.name === 'PO2610-1111' && shape(S.PoPdf, pdfById.data) === true, shape(S.PoPdf, pdfById.data) + ' ' + pdfById.status);
  const pdfForm = await call('POST', E + '/purchase-orders/pdf', { token: dee, body: { po_number: 'PO-DRAFT', supplier: 'Yu', items: [{ brand: 'BYD', model: 'Seal', units: 2, pi_price: 100 }] } });
  const formBytes = pdfForm.data && pdfForm.data.pdf ? Buffer.from(pdfForm.data.pdf, 'base64') : Buffer.alloc(0);
  check('…and so is the form as it stands, unsaved (no name: it has not been saved)', pdfForm.status === 200 && formBytes.slice(0, 4).toString() === '%PDF' && pdfForm.data.name === undefined && shape(S.PoPdf, pdfForm.data) === true);
  const pdf404 = await call('POST', E + '/purchase-orders/999/pdf', { token: dee });
  check('a purchase order that is not there is a 404 that says so', pdf404.status === 404 && pdf404.data.error === 'Purchase order not found', JSON.stringify(pdf404));

  // ═══ The leads a document is attached to ════════════════════════════════════
  const admLeads = await call('GET', D + '/customers', { token: 'adm' });
  check('the administrator\'s list of leads is the register of customers, each with an id, a name and a phone (and whatever else they hold)', admLeads.status === 200 && shape(S.LeadOptionList, admLeads.data) === true && admLeads.data.some(l => l.id === 7 && l.name === 'Mona Saleh'), shape(S.LeadOptionList, admLeads.data));

  T.employees.push({ ...person(8, 'Fay', false, false), permissions: { leads: true, leadsActions: { view: true } } });
  const fay = await signIn('Fay');
  const teamLeads = await call('GET', E + '/leads', { token: fay });
  check('a team member\'s list of leads is the leads they may see — the picker offers them, where the classic page never filled it (it asked the administrator\'s route)',
    teamLeads.status === 200 && shape(S.LeadOptionList, teamLeads.data) === true && teamLeads.data.some(l => l.id === 7 && l.name === 'Mona Saleh'), shape(S.LeadOptionList, teamLeads.data));
  const noLeads = await call('GET', E + '/leads', { token: ana });
  check('…and a member with no leads grant is refused (403): their picker then offers only "No lead"', noLeads.status === 403, String(noLeads.status));

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
