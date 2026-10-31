// Contracts (the Arabic car-sale contract), as the server does them — in both portals, which share one handler each.
//
// The new app's Contracts screen calls these routes as they are: nothing is written twice, so there is nothing to unify yet. This
// holds what the screen may rely on: who may ask for what (each grant is its own: view, create, edit, delete, export), what the
// starting form is filled with (from a lead, from a deal, from the company's settings), what a save keeps, cleans and refuses,
// what the contract's number does, what a render hands back, what a deal that is won drafts for itself — and that every answer is
// the shape packages/contracts says it is. The lists in packages/contracts/src/documents.js — the statuses, the blanks of the form —
// are held to what the routes keep and what the contract prints. The wording and the look of the contract are tests/doc-contract.js;
// the permission rules are tests/contracts.js.
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
  employees: [], sessions: [], quotation_settings: [], google_tokens: [], customers: [], deals: [], lead_activities: [], notifications: [], contracts: [],
// (rows are seeded after the tables are made, so a row made by a route never shares an id with one seeded here)
}, { serial: { contracts: 100, lead_activities: 100, notifications: 100 }, defaults: {
  contracts: () => ({ created_at: now(), updated_at: now(), title: '' }),
} });
db.install();

(async () => {
  const base = await bootApp({ port: process.env.PORT || 4007 });
  const ctx = require(process.cwd() + '/src/ctx');
  const { autoCreateContractForWonDeal } = require(process.cwd() + '/src/routes/contracts');
  const { DEFAULT_PAYMENT_WHEN } = require(process.cwd() + '/src/lib/docs/contract-sale-text');
  const { SALE_TEMPLATE, buildContractHtml } = require(process.cwd() + '/src/lib/docs/contract');
  const fx = require('../tools/doc-fixtures/contract');
  const T = db.tables;
  const person = (id, name, ct) => ({
    id, name, username: name.toLowerCase(), email: '', password_hash: ctx.hashPassword(name.toLowerCase() + '-password-1'), job_title: 'Ops',
    permissions: { contracts: ct !== false, contractsActions: ct || grants(false) }, avatar_url: '', status_text: '', status_emoji: '',
  });
  T.employees.push(
    person(2, 'Ana', grants(true)),
    person(3, 'Ben', grants(false, { view: true })),
    person(4, 'Cy', false),
    person(5, 'Dee', grants(false, { view: true, export: true })),
    ...['view', 'create', 'edit', 'delete', 'export'].map((g, i) => person(21 + i, 'Only' + g, grants(false, { [g]: true }))),
    person(6, 'Eli', grants(false, { view: true, create: true })),
  );
  T.customers.push({ id: 7, name: 'Mona Saleh', phone: '010', address: 'Nasr City', car_in_question: 'BYD Seal Max', custom_fields: { cf_color: 'White / Black', cf_year: '2026', cf_national_id: '29001011234567' } });
  T.deals.push({ id: 3, customer_id: 7, stage: 'won', title: 'Seal deal', vehicle: 'BYD Seal Max', budget_egp: 1500000 });

  const call = async (method, path, { token, body } = {}) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch (_) {}
    return { status: r.status, data };
  };
  const signIn = async name => (await call('POST', '/api/employee/login', { body: { username: name.toLowerCase(), password: name.toLowerCase() + '-password-1' } })).data.token;
  const lone = {};
  for (const g of ['view', 'create', 'edit', 'delete', 'export']) lone[g] = await signIn('Only' + g);
  const ana = await signIn('Ana'), ben = await signIn('Ben'), cy = await signIn('Cy'), dee = await signIn('Dee'), eli = await signIn('Eli');
  ctx.sessions.set('adm', { username: 'admin', pwv: ctx.ADMIN_PW_VERSION, createdAt: Date.now() });
  const D = '/api/dashboard', E = '/api/employee';

  // ═══ Who may ask ════════════════════════════════════════════════════════════
  const doors = seg => [['GET', seg], ['GET', seg + '/new/defaults'], ['GET', seg + '/1'], ['POST', seg], ['PUT', seg + '/1'], ['DELETE', seg + '/1'], ['POST', seg + '/pdf'], ['POST', seg + '/1/pdf']];
  const refused = [];
  for (const [m, p] of doors('/contracts')) {
    const body = m === 'GET' || m === 'DELETE' ? undefined : {};
    const a = await call(m, D + p, { body });
    const b = await call(m, E + p, { body });
    const c = await call(m, E + p, { token: 'adm', body });   // the other portal's token is not a way in either
    const d = await call(m, D + p, { token: ana, body });
    if (a.status !== 401 || b.status !== 401 || c.status !== 401 || d.status !== 401) refused.push(`${m} ${p}: ${a.status}/${b.status}/${c.status}/${d.status}`);
  }
  check('every route needs the signed-in person of its own portal — nobody is a 401, and so is the other portal\'s token', refused.length === 0, refused.join('; '));
  const none = [];
  for (const [m, p] of doors('/contracts')) {
    const r = await call(m, E + p, { token: cy, body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    if (r.status !== 403) none.push(`${m} ${p}: ${r.status}`);
  }
  check('a team member with the section off is refused every route (403)', none.length === 0, none.join('; '));
  const viewer = [];
  for (const [m, p] of doors('/contracts').filter(([m, p]) => m !== 'GET' || /new\/defaults/.test(p))) {
    const r = await call(m, E + p, { token: ben, body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    if (r.status !== 403) viewer.push(`${m} ${p}: ${r.status}`);
  }
  check('a member who may only view is refused creating, editing, deleting, rendering and the starting form (403)', viewer.length === 0, viewer.join('; '));
  const exporter = [];
  for (const [m, p] of doors('/contracts').filter(([m, p]) => m !== 'GET' && !/pdf$/.test(p) || /new\/defaults/.test(p))) {
    const r = await call(m, E + p, { token: dee, body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    if (r.status !== 403) exporter.push(`${m} ${p}: ${r.status}`);
  }
  check('…and one who may only render is refused all of those too: export is its own grant', exporter.length === 0, exporter.join('; '));

  // ═══ The list, and one ══════════════════════════════════════════════════════
  const SALE = { ...fx.contract, contractNo: 'MC2610-1111' };
  T.contracts.push(
    { id: 1, contract_no: 'MC2610-1111', title: 'عقد — عمر حسن محمود', data: SALE, customer_id: 7, deal_id: null, status: 'signed', created_by: 'dashboard', created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z' },
    { id: 2, contract_no: 'MC2610-2222', title: 'عقد — قديم', data: fx.contractLegacy, customer_id: null, deal_id: 9, status: 'draft', created_by: 'auto_won', created_at: '2026-10-02T09:00:00Z', updated_at: '2026-10-02T09:00:00Z' },
  );
  const l = await call('GET', E + '/contracts', { token: ben });
  check('a member who may view reads the contracts, the newest first, with what a row is drawn from and not the contract itself — in the shape the contract says',
    l.status === 200 && l.data.map(r => r.id).join() === '2,1' && shape(S.ContractList, l.data) === true && !('data' in l.data[0]) && l.data[0].created_by === 'auto_won' && l.data[0].deal_id === 9, shape(S.ContractList, l.data));
  const adminList = await call('GET', D + '/contracts', { token: 'adm' });
  check('the administrator reads the same list', JSON.stringify(adminList.data) === JSON.stringify(l.data));
  const one = await call('GET', E + '/contracts/1', { token: ben });
  check('one contract comes whole — the blanks of the paper form under `data` — in the shape the contract says', one.status === 200 && one.data.data.buyer.name === 'عمر حسن محمود' && one.data.data.template === 'sale-v2' && shape(S.Contract, one.data) === true, shape(S.Contract, one.data));
  const gone = await call('GET', E + '/contracts/999', { token: ben });
  check('one that is not there is a 404 that says so', gone.status === 404 && gone.data.error === 'Contract not found', JSON.stringify(gone));

  // ═══ The starting form ══════════════════════════════════════════════════════
  const today = new Date();
  const two = n => String(n).padStart(2, '0');
  const d0 = await call('GET', E + '/contracts/new/defaults', { token: eli });
  const dd = d0.data && d0.data.data;
  check('the starting form needs only the grant to create: a number, the car-sale template carrying that number, today\'s date, the company\'s standing details, one payment line',
    d0.status === 200 && /^MC\d{4}-\d{4}$/.test(d0.data.contract_no) && dd.template === DOCS.CONTRACT_SALE_TEMPLATE && dd.template === SALE_TEMPLATE && dd.contractNo === d0.data.contract_no
    && dd.contractDate.d === two(today.getDate()) && dd.contractDate.m === two(today.getMonth() + 1) && dd.contractDate.y === String(today.getFullYear()) && /^[؀-ۿ]+$/.test(dd.contractDate.day)
    && dd.company.name === 'MotoLinkers' && dd.company.commercialReg === '282378' && dd.company.taxId === '773934006' && /Heliopolis/.test(dd.company.address)
    && dd.rep.nationality === 'مصري' && dd.rep.role === 'مدير الشركة' && dd.buyer.name === '' && dd.buyer.nationality === 'مصري' && dd.buyer.religion === 'مسلم' && dd.vehicle.make === '' && dd.total === ''
    && dd.payments.length === 1 && dd.payments[0].amount === '' && dd.payments[0].when === DEFAULT_PAYMENT_WHEN && shape(S.ContractDefaults, d0.data) === true, shape(S.ContractDefaults, d0.data));
  check('…and the wording of a payment line the form starts with is the one the contract prints for a line with none', DOCS.CONTRACT_PAYMENT_WHEN === DEFAULT_PAYMENT_WHEN);
  const d1 = await call('GET', E + '/contracts/new/defaults?customer_id=7', { token: eli });
  const b1 = d1.data.data;
  check('for a lead, the buyer is the lead (name, national ID, address) and the vehicle is the car they asked about, split into make and model, with its colour and year',
    b1.buyer.name === 'Mona Saleh' && b1.buyer.nationalId === '29001011234567' && b1.buyer.address === 'Nasr City' && b1.vehicle.make === 'BYD' && b1.vehicle.model === 'Seal Max' && b1.vehicle.color === 'White / Black' && b1.vehicle.year === '2026' && b1.total === '', JSON.stringify(b1.vehicle));
  const d2 = await call('GET', E + '/contracts/new/defaults?customer_id=7&deal_id=3', { token: eli });
  check('…and for a deal, the total is the deal\'s budget', d2.data.data.total === '1500000' && d2.data.data.buyer.name === 'Mona Saleh', d2.data.data.total);
  T.quotation_settings.push(
    { key: 'company_name', value: 'Acme Motors' }, { key: 'company_commercial_reg', value: '111' }, { key: 'company_tax_id', value: '222' },
    { key: 'company_address', value: 'Alexandria' }, { key: 'company_rep', value: 'Hany Ali' },
  );
  const d3 = await call('GET', E + '/contracts/new/defaults', { token: eli });
  check('the company is the workspace\'s own where it has said who it is (name, register, tax number, address, and who signs for it)',
    d3.data.data.company.name === 'Acme Motors' && d3.data.data.company.commercialReg === '111' && d3.data.data.company.taxId === '222' && d3.data.data.company.address === 'Alexandria' && d3.data.data.company.repIn === 'Hany Ali' && d3.data.data.rep.name === 'Hany Ali', JSON.stringify(d3.data.data.company));
  T.quotation_settings.length = 0;
  // what the lead's own page knows, where it is not in the column the form looks at first
  T.customers.push(
    { id: 9, name: 'Sara Adel', phone: '011', address: '', car_in_question: 'Kia Rio', custom_fields: { cf_address: 'Giza', cf_vehicle_price: 800000, cf_vehicle_offered: 'Toyota Corolla', cf_vehicle_requested: 'Honda Civic' } },
    { id: 10, name: 'Omar Said', phone: '012', address: '', car_in_question: 'Kia Rio', custom_fields: { cf_vehicle_requested: 'Honda Civic' } },
  );
  const d4 = (await call('GET', E + '/contracts/new/defaults?customer_id=9', { token: eli })).data.data;
  check('a lead with no address of its own has the one in its custom field, and a lead\'s price is the total where no deal is named', d4.buyer.address === 'Giza' && d4.total === '800000', JSON.stringify([d4.buyer.address, d4.total]));
  check('the car a lead was offered is the car of the contract, before the one they asked for and the one in question', d4.vehicle.make === 'Toyota' && d4.vehicle.model === 'Corolla', JSON.stringify(d4.vehicle));
  const d5 = (await call('GET', E + '/contracts/new/defaults?customer_id=10', { token: eli })).data.data;
  check('…the one they asked for comes before the one in question', d5.vehicle.make === 'Honda' && d5.vehicle.model === 'Civic', JSON.stringify(d5.vehicle));
  const d6 = (await call('GET', E + '/contracts/new/defaults?customer_id=9&deal_id=3', { token: eli })).data.data;
  check('…and a deal\'s budget is the total before a lead\'s price', d6.total === '1500000', d6.total);
  T.quotation_settings.push({ key: 'company_reg_no', value: '555' });
  const d7 = (await call('GET', E + '/contracts/new/defaults', { token: eli })).data.data;
  check('the register number is the one the footer of every document reads where no contract-specific one is set', d7.company.commercialReg === '555', d7.company.commercialReg);
  T.quotation_settings.push({ key: 'company_commercial_reg', value: '111' });
  const d8 = (await call('GET', E + '/contracts/new/defaults', { token: eli })).data.data;
  check('…and the contract-specific one wins when both are', d8.company.commercialReg === '111', d8.company.commercialReg);
  T.quotation_settings.length = 0;

  // ═══ Saving ═════════════════════════════════════════════════════════════════
  const made = await call('POST', E + '/contracts', { token: ana, body: {
    contract_no: '  MC2610-5555  ', title: '  عقد — عمر  ', status: 'signed', customer_id: '7', deal_id: '3',
    data: { template: 'sale-v2', contractNo: 'WRONG', buyer: { name: 'عمر' }, payments: [{ amount: '100', when: 'x', label: '' }], custom_fields: { cf_ref: 'Z' } } } });
  const mrow = T.contracts.find(r => r.contract_no === 'MC2610-5555');
  check('creating keeps the trimmed number and title, whole-number ids and the status, files it under the member, and answers the saved row',
    made.status === 200 && made.data.id && mrow && mrow.title === 'عقد — عمر' && mrow.status === 'signed' && mrow.customer_id === 7 && mrow.deal_id === 3 && mrow.created_by === 'employee_2' && shape(S.Contract, made.data) === true, shape(S.Contract, made.data) + ' ' + JSON.stringify(mrow && mrow.created_by));
  check('…a car-sale contract carries its own number in its data (what was sent as the number is overruled), and the rest of the data — the added fields among it — is kept as sent',
    mrow.data.contractNo === 'MC2610-5555' && mrow.data.buyer.name === 'عمر' && mrow.data.payments.length === 1 && mrow.data.custom_fields.cf_ref === 'Z', JSON.stringify(mrow.data));
  check('creating for a lead leaves a note in the lead\'s history, by whoever made it', T.lead_activities.some(a => a.customer_id === 7 && a.body === 'Contract generated — MC2610-5555' && a.author_key === 'employee_2'), JSON.stringify(T.lead_activities.slice(-1)));
  const older = await call('POST', E + '/contracts', { token: ana, body: { contract_no: 'MC2610-6666', data: { buyer: { name: 'قديم' }, importCountry: 'الصين' } } });
  const orow = T.contracts.find(r => r.contract_no === 'MC2610-6666');
  check('a contract on the older wording (no template) is kept as it was sent: no number is written into it', older.status === 200 && !('contractNo' in orow.data) && orow.data.importCountry === 'الصين', JSON.stringify(orow.data));
  const odd = await call('POST', E + '/contracts', { token: ana, body: { status: 'nonsense', data: 'not an object', customer_id: '', deal_id: '' } });
  const xrow = T.contracts.find(r => r.id === odd.data.id);
  check('a status that is not one of the three is a draft, data that is not an object is none, ids that are blank are none, a number is made when none was given, and a title is empty',
    odd.status === 200 && xrow.status === 'draft' && JSON.stringify(xrow.data) === '{}' && xrow.customer_id === null && xrow.deal_id === null && /^MC\d{4}-\d{4}$/.test(xrow.contract_no) && xrow.title === '', JSON.stringify(xrow));
  const kept = [];
  for (const [key] of DOCS.CONTRACT_STATUSES) {
    const r = await call('POST', E + '/contracts', { token: ana, body: { status: key, data: { template: 'sale-v2' } } });
    if (T.contracts.find(x => x.id === r.data.id).status !== key) kept.push(key);
  }
  check('every status the contract lists is one the server keeps as it was sent, and the first is the one a new contract has', kept.length === 0 && DOCS.CONTRACT_STATUSES[0][0] === 'draft', kept.join());
  check('…and the contract lists exactly the three the server keeps — draft, signed, cancelled — so the app offers no status the server would turn into a draft', JSON.stringify(DOCS.CONTRACT_STATUSES.map(([k]) => k)) === JSON.stringify(['draft', 'signed', 'cancelled']), JSON.stringify(DOCS.CONTRACT_STATUSES));

  T.contracts.find(r => r.id === made.data.id).updated_at = '2001-01-01T00:00:00.000Z';
  const upd = await call('PUT', E + '/contracts/' + made.data.id, { token: ana, body: { contract_no: 'CHANGED', title: ' New ', status: 'cancelled', customer_id: '', data: { template: 'sale-v2', buyer: { name: 'غيره' } } } });
  const urow = T.contracts.find(r => r.id === made.data.id);
  check('editing replaces what the form sends — the data whole, an emptied lead as none — stamps the time, and never changes the number',
    upd.status === 200 && urow.contract_no === 'MC2610-5555' && urow.title === 'New' && urow.status === 'cancelled' && urow.customer_id === null && JSON.stringify(urow.data) === JSON.stringify({ template: 'sale-v2', buyer: { name: 'غيره' } }) && urow.updated_at > '2020' && shape(S.Contract, upd.data) === true, shape(S.Contract, upd.data));
  const keep = await call('PUT', E + '/contracts/' + made.data.id, { token: ana, body: { status: 'nonsense' } });
  check('…what it does not send it leaves (a status that is not one is no change), and a form with nothing in it only stamps the time', keep.status === 200 && T.contracts.find(r => r.id === made.data.id).status === 'cancelled' && T.contracts.find(r => r.id === made.data.id).title === 'New');
  const removed = await call('DELETE', E + '/contracts/' + made.data.id, { token: ana });
  check('deleting answers ok and the contract is gone', removed.status === 200 && shape(S.DocDeleted, removed.data) === true && !T.contracts.some(r => r.id === made.data.id));
  const ed = await call('PUT', E + '/contracts/999', { token: ana, body: { title: 'x' } });
  check('editing one that is not there is the database\'s own refusal (500 and its words), as it has always been', ed.status === 500 && typeof ed.data.error === 'string', JSON.stringify(ed));

  // ═══ A deal that is won drafts a contract ═══════════════════════════════════
  const auto = await autoCreateContractForWonDeal({ id: 3, stage: 'won', customer_id: 7, title: 'Seal deal', vehicle: 'BYD Seal Max', budget_egp: 1500000 });
  check('a deal that reaches Won has a contract drafted for it: the lead as the buyer, the deal\'s car and budget, a draft, filed under the system', !!auto && auto.created_by === 'auto_won' && auto.deal_id === 3 && auto.customer_id === 7 && auto.status === 'draft'
    && auto.title === 'عقد — Mona Saleh' && auto.data.template === 'sale-v2' && auto.data.contractNo === auto.contract_no && auto.data.buyer.name === 'Mona Saleh' && auto.data.vehicle.make === 'BYD' && auto.data.total === '1500000', JSON.stringify(auto && auto.data.vehicle));
  const again = await autoCreateContractForWonDeal({ id: 3, stage: 'won', customer_id: 7 });
  check('…once: entering Won again drafts nothing more', again === null && T.contracts.filter(r => r.deal_id === 3).length === 1, String(T.contracts.filter(r => r.deal_id === 3).length));
  check('…and leaves a note in the lead\'s history, by the system', T.lead_activities.some(a => a.customer_id === 7 && /generated automatically \(deal won\)/.test(a.body) && a.author_key === 'system'));
  const notWon = await autoCreateContractForWonDeal({ id: 4, stage: 'negotiation', customer_id: 7 });
  check('a deal that is not at Won drafts nothing', notWon === null && !T.contracts.some(r => r.deal_id === 4));
  const after = await call('GET', E + '/contracts', { token: ben });
  check('the drafted contract is in the list as an "auto" one, in the shape the contract says', after.data.some(r => r.id === auto.id && r.created_by === 'auto_won') && shape(S.ContractList, after.data) === true, shape(S.ContractList, after.data));

  // ═══ The document ═══════════════════════════════════════════════════════════
  const px = await call('POST', E + '/contracts/pdf', { token: dee, body: { data: fx.contract } });
  const bytes = px.data && px.data.pdf ? Buffer.from(px.data.pdf, 'base64') : Buffer.alloc(0);
  check('the form as it stands is a PDF: base64 of a real document, for a member who may export — no name, there is no row yet', px.status === 200 && bytes.slice(0, 4).toString() === '%PDF' && bytes.length > 2000 && !('name' in px.data) && shape(S.ContractPdf, px.data) === true, shape(S.ContractPdf, px.data));
  const pl = await call('POST', E + '/contracts/pdf', { token: dee, body: { data: fx.contractLegacy } });
  check('…the older wording too', pl.status === 200 && Buffer.from(pl.data.pdf, 'base64').slice(0, 4).toString() === '%PDF');
  const pn = await call('POST', E + '/contracts/pdf', { token: dee, body: {} });
  check('…and a form with nothing in it (every blank a dotted line)', pn.status === 200 && Buffer.from(pn.data.pdf, 'base64').slice(0, 4).toString() === '%PDF');
  const pi = await call('POST', E + '/contracts/1/pdf', { token: dee });
  check('a saved contract is a PDF named for its number', pi.status === 200 && Buffer.from(pi.data.pdf, 'base64').slice(0, 4).toString() === '%PDF' && pi.data.name === 'MC2610-1111' && shape(S.ContractPdf, pi.data) === true, shape(S.ContractPdf, pi.data));
  const p404 = await call('POST', E + '/contracts/999/pdf', { token: dee });
  check('one that is not there is a 404 that says so', p404.status === 404 && p404.data.error === 'Contract not found', JSON.stringify(p404));
  const admin = await call('POST', D + '/contracts/pdf', { token: 'adm', body: { data: fx.contract } });
  check('the administrator renders the same', admin.status === 200 && Buffer.from(admin.data.pdf, 'base64').slice(0, 4).toString() === '%PDF');
  // the number a contract is printed under: the one the form holds (sent with it, else inside it), or the saved row's own
  const printed = [];
  const render = ctx.renderQuotationPdf;
  ctx.renderQuotationPdf = async html => { printed.push(html); return render(html); };
  const { contractNo: _no, ...unnumbered } = fx.contract;
  await call('POST', E + '/contracts/pdf', { token: dee, body: { contract_no: 'MC2610-7777', data: unnumbered } });
  await call('POST', E + '/contracts/pdf', { token: dee, body: { data: { ...unnumbered, contractNo: 'MC2610-8888' } } });
  await call('POST', E + '/contracts/1/pdf', { token: dee });
  T.contracts.push({ id: 77, contract_no: 'MC2610-0077', title: '', status: 'draft', customer_id: null, deal_id: null, created_by: 'admin', created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z', data: { template: SALE_TEMPLATE, buyer: { name: 'x' } } });
  await call('POST', E + '/contracts/77/pdf', { token: dee });   // (saved without its number inside it: the row's is what is printed)
  ctx.renderQuotationPdf = render;
  check('an unsaved contract is printed under the number its form holds — the one sent with it, else the one inside its data — and a saved one under its row\'s',
    printed.length === 4 && printed[0].includes('MC2610-7777') && printed[1].includes('MC2610-8888') && printed[2].includes('MC2610-1111') && printed[3].includes('MC2610-0077') && !printed[0].includes('MC2610-1234'), String(printed.length));

  // ═══ The form is the paper form ═════════════════════════════════════════════
  const text = html => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const set = (obj, path, v) => { const keys = path.split('.'); let o = obj; keys.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; }); o[keys[keys.length - 1]] = v; };
  const paths = (sections, older) => sections.flatMap(s => [...s.rows, ...(older ? s.older || [] : [])].flat());
  const sale = { template: SALE_TEMPLATE, payments: [{}] };
  const legacy = { payments: [] };
  for (const [p] of paths(DOCS.CONTRACT_SECTIONS, false)) { set(sale, p, 'Q' + p.replace(/\W/g, '') + 'Q'); set(legacy, p, 'Q' + p.replace(/\W/g, '') + 'Q'); }
  for (const [p] of paths(DOCS.CONTRACT_SECTIONS, true).filter(([p]) => !paths(DOCS.CONTRACT_SECTIONS, false).some(([q]) => q === p))) set(legacy, p, 'Q' + p.replace(/\W/g, '') + 'Q');
  const saleText = text(buildContractHtml(sale)), legacyText = text(buildContractHtml(legacy));
  const unprintedSale = paths(DOCS.CONTRACT_SECTIONS, false).map(([p]) => p).filter(p => !saleText.includes('Q' + p.replace(/\W/g, '') + 'Q'));
  check('every blank the form offers for a car-sale contract is printed on it', unprintedSale.length === 0, unprintedSale.join(', '));
  const unprintedLegacy = paths(DOCS.CONTRACT_SECTIONS, true).map(([p]) => p).filter(p => !legacyText.includes('Q' + p.replace(/\W/g, '') + 'Q'));
  check('…and every blank the form offers for a contract on the older wording is printed on that', unprintedLegacy.length === 0, unprintedLegacy.join(', '));
  const onlyOlder = paths(DOCS.CONTRACT_SECTIONS, true).map(([p]) => p).filter(p => !paths(DOCS.CONTRACT_SECTIONS, false).some(([q]) => q === p));
  const leaked = onlyOlder.filter(p => saleText.includes('Q' + p.replace(/\W/g, '') + 'Q'));
  check('the fields only the older wording has are not on a car-sale contract (its form does not offer them)', leaked.length === 0, leaked.join(', '));
  const seen = new Set(); const dup = [];
  for (const [p] of paths(DOCS.CONTRACT_SECTIONS, true)) { if (seen.has(p)) dup.push(p); seen.add(p); }
  check('no blank is offered twice', dup.length === 0, dup.join(', '));

  // ═══ Each grant is its own ══════════════════════════════════════════════════
  // A member with one grant and no other may do exactly what that grant is for: every route names the one it needs.
  const NEEDS = [['GET', '/contracts', 'view'], ['GET', '/contracts/9999', 'view'], ['GET', '/contracts/new/defaults', 'create'], ['POST', '/contracts', 'create'],
    ['PUT', '/contracts/9999', 'edit'], ['DELETE', '/contracts/9999', 'delete'], ['POST', '/contracts/pdf', 'export'], ['POST', '/contracts/9999/pdf', 'export']];
  const wrong = [];
  for (const [m, p, need] of NEEDS) {
    for (const g of Object.keys(lone)) {
      const r = await call(m, E + p, { token: lone[g], body: m === 'GET' || m === 'DELETE' ? undefined : (/pdf$/.test(p) ? { data: fx.contract } : { buyer: 'x' }) });
      const refused = r.status === 403;
      if (g === need ? refused : !refused) wrong.push(`${m} ${p} for a member who may only ${g}: ${r.status}`);
    }
  }
  check('each route is for the one grant that names it: view reads, create makes and asks for the starting form, edit changes, delete deletes, export renders — and a member with any other single grant is refused', wrong.length === 0, wrong.slice(0, 4).join('; '));

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
