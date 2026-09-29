// The assistant on every page: the section library, then the page.
//
// src/lib/sections.js is pure, so the packs, queries and action checks are
// asserted on fixtures. The browser half opens both portals against stubbed
// endpoints and checks what a person meets: the brain in the header, the
// insight card at the top of Leads, the drawer reading that section, and a
// proposed action that does nothing until Confirm is pressed.
const fs = require('fs'), path = require('path'), http = require('http');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = require(process.cwd() + '/src/lib/sections.js');
const T = '2026-09-29';

// ── Leads ─────────────────────────────────────────────────────────────────────
{
  const p = S.buildPack('leads', {
    customers: [
      { id: 1, name: 'Ahmed', phone: '0100', lead_status: 'hot', source: 'fb_ad', created_at: '2026-09-01T00:00:00Z', assigned_to: 2, been_contacted: true },
      { id: 2, name: 'Mona', phone: '0111', lead_status: 'cold', source: 'website', created_at: '2026-09-28T00:00:00Z' },
      { id: 3, name: 'Omar', phone: '0122', lead_status: 'warm', source: 'fb_ad', created_at: '2026-08-01T00:00:00Z', assigned_to: 2 },
    ],
    activities: [{ customer_id: 1, type: 'call', created_at: '2026-09-05T00:00:00Z' }, { customer_id: 3, type: 'note', created_at: '2026-09-27T00:00:00Z' }],
    followups: [{ id: 9, customer_id: 1, due_at: '2026-09-20T10:00:00Z', status: 'pending', note: 'call back' }, { id: 10, customer_id: 3, due_at: '2026-09-29T15:00:00Z', status: 'pending' }],
    employees: [{ id: 2, name: 'Sara' }],
  }, { today: T });
  check('leads: counts by status and source, new this week, unassigned', p.counts.hot === 1 && p.counts.warm === 1 && p.counts.new_7d === 1 && p.counts.unassigned === 1 && p.counts.by_source[0].source === 'fb_ad', JSON.stringify(p.counts));
  check('leads: a hot lead silent for 24 days is stale, the warm one seen two days ago is not', p.stale.count === 1 && p.stale.rows[0].name === 'Ahmed' && p.stale.rows[0].days_silent === 24, JSON.stringify(p.stale));
  check('leads: follow-ups overdue and due today', p.followups.overdue === 1 && p.followups.today === 1 && p.followups.rows[0].client === 'Ahmed', JSON.stringify(p.followups));
  check('leads: per rep', p.by_rep[0].name === 'Sara' && p.by_rep[0].leads === 2 && p.by_rep[0].hot === 1, JSON.stringify(p.by_rep));
  check('leads: a query finds by phone and refuses an empty search', S.sectionQuery('leads', p, 'find_lead', { q: '0111' }).rows[0].name === 'Mona' && !!S.sectionQuery('leads', p, 'find_lead', {}).error);
  check('leads: lead_detail carries its follow-ups and activity', S.sectionQuery('leads', p, 'lead_detail', { customer_id: 1 }).followups.length === 1 && S.sectionQuery('leads', p, 'lead_detail', { customer_id: 99 }).error);
  check('leads: an unknown query names the choices', /Choose one of: leads_by_status/.test(S.sectionQuery('leads', p, 'drop', {}).error));
  const trimmed = S.trimSectionPack(p);
  check('the model never sees the private row caches', !Object.keys(trimmed).some(k => k.startsWith('_')) && trimmed.counts.total === 3);
}
// ── Deals ─────────────────────────────────────────────────────────────────────
{
  const p = S.buildPack('deals', {
    deals: [
      { id: 1, title: 'Seal for Ahmed', stage: 'negotiating', budget_egp: 1000000, created_at: '2026-07-01T00:00:00Z', assigned_to: '2', customers: { name: 'Ahmed' } },
      { id: 2, title: 'Atto for Mona', stage: 'lead', budget_egp: 800000, created_at: '2026-09-20T00:00:00Z' },
      { id: 3, title: 'Han', stage: 'won', budget_egp: 500000, created_at: '2026-08-01T00:00:00Z', closed_at: '2026-09-10T00:00:00Z' },
      { id: 4, title: 'Lost one', stage: 'lost', budget_egp: 100, created_at: '2026-08-01T00:00:00Z', closed_at: '2026-08-15T00:00:00Z' },
    ],
    sales: [{ id: 7, client: 'Ahmed', brand: 'BYD', model: 'Seal', price_list: 1000000, down_payment: 300000, remaining: 700000 }, { id: 8, client: 'Paid', price_list: 500000, down_payment: 500000, remaining: 0 }],
    employees: [{ id: 2, name: 'Sara' }],
  }, { today: T });
  check('deals: pipeline by stage and open value', p.pipeline.find(x => x.stage === 'negotiating').value === 1000000 && p.open.count === 2 && p.open.value === 1800000, JSON.stringify(p.open));
  check('deals: weighted pipeline uses the stage probabilities', p.open.weighted === 830000, String(p.open.weighted));
  check('deals: this month won, and the win rate', p.this_month.won === 1 && p.this_month.won_value === 500000 && p.win_rate === 50, JSON.stringify(p.this_month));
  check('deals: a deal open since July is stuck', p.stuck.count === 1 && p.stuck.rows[0].title === 'Seal for Ahmed' && p.stuck.rows[0].rep === 'Sara');
  check('deals: sales still owing', p.sales.open === 1 && p.sales.settled === 1 && p.sales.outstanding === 700000, JSON.stringify(p.sales));
  check('deals: stage filter is validated', !!S.sectionQuery('deals', p, 'deals_by_stage', { stage: 'bogus' }).error && S.sectionQuery('deals', p, 'deals_by_stage', { stage: 'won' }).count === 1);
}
// ── Documents, suppliers, stock ───────────────────────────────────────────────
{
  const po = S.buildPack('purchaseorders', { purchase_orders: [
    { id: 1, po_number: 'PO-1', supplier: 'Yu Motors', currency: 'USD', status: 'confirmed', po_date: '2026-08-01', items: [{ pi_price: 20000, units: 2, status: 'in_logistics' }, { pi_price: 5000, status: 'delivered' }] },
    { id: 2, po_number: 'PO-2', supplier: 'Uniland', currency: 'USD', status: 'closed', po_date: '2026-03-01', items: [{ pi_price: 1000 }] },
  ] }, { today: T });
  const lineStatus = Object.fromEntries(po.line_status.map(x => [x.status, x.count]));
  check('purchase orders: PI totals, units, line statuses and open value by currency', po.recent[0].pi_total === 45000 && po.recent[0].units === 3 && po.open_pi_total_by_currency.USD === 45000
    && lineStatus.in_logistics === 1 && lineStatus.delivered === 1 && lineStatus.send_to_supplier === 1, JSON.stringify(po.line_status));
  check('purchase orders: the oldest open order is aged', po.oldest_open[0].po_number === 'PO-1' && po.oldest_open[0].days_open === 59, JSON.stringify(po.oldest_open[0]));
  check('purchase orders: po_detail by number', S.sectionQuery('purchaseorders', po, 'po_detail', { po_number: 'PO-2' }).po.status === 'closed');
  const sup = S.buildPack('suppliers', { suppliers: [{ id: 1, name: 'Yu Motors', country: 'China' }, { id: 2, name: 'Uniland' }],
    supplier_vehicles: [{ supplier_id: 1, brand: 'BYD', model: 'Seal', fob_price: 21000, currency: 'USD' }, { supplier_id: 2, brand: 'BYD', model: 'Seal', fob_price: 19500, currency: 'USD', lead_time: '45 days' }],
    purchase_orders: [{ id: 1, supplier_id: 1, supplier: 'Yu Motors', currency: 'USD', status: 'confirmed', items: [{ pi_price: 20000, units: 2 }] }] }, { today: T });
  check('suppliers: orders and PI value per supplier, catalogue coverage', sup.rows[0].name === 'Yu Motors' && sup.rows[0].pi_total_by_currency.USD === 40000 && sup.rows[0].catalogue === 1, JSON.stringify(sup.rows[0]));
  check('suppliers: the cheapest offer per model wins', sup.catalogue.cheapest_per_model[0].supplier === 'Uniland' && S.sectionQuery('suppliers', sup, 'cheapest_offer', { model: 'seal' }).rows[0].fob_price === 19500);
  const st = S.buildPack('stock', { stock_vehicles: [{ id: 1, make: 'BYD', model: 'Seal', price: 1200000, units: [{ vin: 'VIN1', status: 'in_logistics', colour: 'White' }, { vin: 'VIN2', status: 'delivered', consignee: 'Ahmed', price_list: 1250000 }] }],
    containers: [{ id: 5, container_no: 'MSCU1234567', status: 'in_transit', vessel_name: 'MSC X', pod_eta: '2026-10-03', units: [{ vin: 'VIN1' }] }, { id: 6, container_no: 'OLD', status: 'closed' }] }, { today: T });
  check('stock: units, list value, unassigned and status split', st.totals.units === 2 && st.totals.list_value === 2450000 && st.totals.unassigned === 1 && st.models[0].by_status.length === 2, JSON.stringify(st.totals));
  check('stock: a container arriving within 7 days, and a VIN traced to it', st.containers.arriving_7d.length === 1 && S.sectionQuery('stock', st, 'find_vin', { vin: 'vin1' }).containers[0].container_no === 'MSCU1234567');
  const q = S.buildPack('quotation', { quotations: [{ id: 1, quote_id: 'Q-1', data: { name: 'Ahmed', vehicleModel: 'BYD Seal', items: [{ priceUsd: 20000, unit: 2 }], logistics: [{ priceUsd: 1500 }] }, created_at: '2026-09-02T00:00:00Z' }] }, { today: T });
  check('quotation: an indicative USD total from the saved lines', q.recent[0].usd_total_indicative === 41500 && q.this_month === 1 && q.by_vehicle[0].vehicle === 'BYD Seal');
}
// ── Tasks, hours, requests, meetings, issues, home ────────────────────────────
{
  const p = S.buildPack('tasks', { tasks: [
    { id: 1, title: 'Call supplier', status: 'todo', priority: 'high', due_date: '2026-09-20', assignee_ids: ['2'] },
    { id: 2, title: 'Send PI', status: 'in_progress', priority: 'medium', due_date: '2026-09-29', assignee_id: '2' },
    { id: 3, title: 'Done thing', status: 'done', priority: 'low', due_date: '2026-09-01' },
    { id: 4, title: 'Later', status: 'todo', priority: 'low', due_date: '2026-10-03' },
  ], employees: [{ id: 2, name: 'Sara' }] }, { today: T });
  check('tasks: overdue, due today and this week, load per assignee', p.overdue.count === 1 && p.overdue.rows[0].days_overdue === 9 && p.due_today.length === 1 && p.due_week.length === 1 && p.by_assignee[0].assignee === 'Sara' && p.by_assignee[0].overdue === 1, JSON.stringify(p.by_assignee));
  // "Due this week" in a question includes today; the pack keeps today apart from the rest of the week.
  check('tasks: the query filters compose', S.sectionQuery('tasks', p, 'tasks', { overdue: true, assignee: 'sara' }).count === 1 && S.sectionQuery('tasks', p, 'tasks', { due: 'week' }).count === 2 && p.due_week.length === 1);
  const hrs = S.buildPack('hours', { hours: [{ hours: 4, log_date: '2026-09-28', employee_id: 2 }, { hours: 3.5, log_date: '2026-09-01', employee_id: 2 }], employees: [{ id: 2, name: 'Sara' }] }, { today: T });
  check('hours: last 7 and 30 days, by employee', hrs.total_7d === 4 && hrs.total_30d === 7.5 && hrs.by_employee[0].hours_7d === 4);
  const rq = S.buildPack('requests', { requests: [{ id: 1, title: 'Leave', category: 'HR', status: 'pending', created_at: '2026-09-01T00:00:00Z' }, { id: 2, title: 'Laptop', status: 'approved', created_at: '2026-09-20T00:00:00Z' }] }, { today: T });
  check('requests: the oldest pending one is aged', rq.pending.count === 1 && rq.pending.oldest[0].age_days === 28);
  const home = S.buildPack('home', { tasks: [{ id: 1, title: 'x', status: 'todo', due_date: '2026-09-20' }], followups: [{ id: 1, customer_id: 1, due_at: '2026-09-29T09:00:00Z', status: 'pending' }], deals: [{ stage: 'quoted', budget_egp: 100 }], customers: [{ id: 1, lead_status: 'hot', created_at: '2026-09-28T00:00:00Z' }], requests: [{ status: 'pending' }], meetings: [{ title: 'Standup', starts_at: '2026-09-29T08:00:00Z' }] }, { today: T });
  check('home: an overview across sections', home.tasks.overdue === 1 && home.followups.today === 1 && home.deals.open === 1 && home.leads.hot === 1 && home.requests_pending === 1 && home.meetings_today.length === 1, JSON.stringify(home));
}
// ── Every section on an empty book ────────────────────────────────────────────
{
  const bad = Object.keys(S.SECTIONS).filter(k => { const p = S.buildPack(k, {}, { today: T }); return !p || /NaN/.test(JSON.stringify(S.trimSectionPack(p))); });
  check('every section builds on empty input without NaN', bad.length === 0, bad.join(','));
  check('every section declares chips in both languages, an insight task and a gate or admin flag',
    Object.values(S.SECTIONS).every(s => Array.isArray(s.chips.en) && Array.isArray(s.chips.ar) && s.task && (s.gate || s.gate === null) && Object.keys(s.queries).length));
  check('pages map onto sections; accounting keeps its own', S.sectionForPage('customers') === 'leads' && S.sectionForPage('rfqs') === 'rfq' && S.sectionForPage('whatsapp') === 'home' && S.sectionForPage('accounting') === 'accounting' && S.sectionForPage('') === 'home');
}
// ── Actions ───────────────────────────────────────────────────────────────────
{
  const fu = S.validateAction('create_followup', { customer_id: '12', days: 3, note: 'x'.repeat(600) });
  check('action: a follow-up from days-from-today, note capped, permission named', fu.args.customer_id === 12 && /^\d{4}-\d{2}-\d{2}$/.test(fu.args.due_at) && fu.args.note.length === 500 && fu.perm.section === 'leads' && fu.perm.action === 'edit', JSON.stringify(fu));
  check('action: a follow-up without a lead or date is refused', /customer_id/.test(S.validateAction('create_followup', {}).error) && /due_at/.test(S.validateAction('create_followup', { customer_id: 1 }).error));
  const task = S.validateAction('create_task', { title: 'Call', due_date: '2026-10-01', priority: 'urgent', assignee_ids: ['3', 'x', 4] });
  check('action: a task keeps a valid date, defaults a bad priority, and cleans assignees', task.args.priority === 'medium' && task.args.assignee_ids.join(',') === '3,4' && task.perm.section === 'tasks', JSON.stringify(task.args));
  check('action: a status is normalised', S.validateAction('set_lead_status', { customer_id: 1, status: 'Immediate Delivery' }).args.status === 'immediate_delivery');
  check('action: a deal cannot be proposed straight into won', S.validateAction('create_deal', { customer_id: 1, title: 'x', stage: 'won' }).args.stage === 'lead');
  check('action: notify only to me, admin or an employee id', S.validateAction('notify', { title: 't', to: 'everyone' }).error && S.validateAction('notify', { title: 't', to: '7' }).args.to === '7' && S.validateAction('notify', { title: 't' }).args.to === 'me');
  check('action: an unknown type names the choices', /Choose one of: create_followup/.test(S.validateAction('drop_table', {}).error));
  check('each section only offers actions the registry knows', Object.values(S.SECTIONS).every(s => s.actions.every(a => S.ACTIONS[a])));
}

// ── The page, in both portals ─────────────────────────────────────────────────
const PERMS = { leads: true, leadsActions: { view: true, create: true, edit: true }, assistant: true, assistantActions: { chat: true, act: true } };
const SECTIONS = { ai: false, act: true, pages: { customers: 'leads', leads: 'leads' }, sections: [
  { key: 'home', label: 'Home', chips: { en: ['What needs my attention today?'], ar: ['ما الذي يحتاج انتباهي اليوم؟'] }, actions: [] },
  { key: 'leads', label: 'Leads', chips: { en: ['Which hot leads have gone quiet?', 'Who should I call first today?'], ar: ['بمن أتصل أولاً اليوم؟'] }, actions: ['create_followup'] } ] };
const PROPOSAL = { action: { type: 'create_followup', customer_id: 1, due_at: '2026-10-01', note: '', assigned_to: null }, label: 'Schedule a follow-up', description: 'Follow-up for lead #1 on 2026-10-01' };
const posted = [];
function api(pathname, body) {
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { ok: true, id: 2, name: 'Sara', username: 'sara', permissions: PERMS };
  if (/(leads\/columns|columns\/leads)$/.test(pathname)) return { columns: [
    { key: 'name', label: 'Name', type: 'text', builtin: true, visible: true }, { key: 'phone', label: 'Phone', type: 'text', builtin: true, visible: true },
    { key: 'lead_status', label: 'Status', type: 'select', builtin: true, visible: true, options: [{ key: 'cold', label: 'Cold' }, { key: 'hot', label: 'Hot' }] } ] };
  if (/\/ai\/sections$/.test(pathname)) return SECTIONS;
  if (/\/ai\/status$/.test(pathname)) return { ai: false };
  if (/\/ai\/insights$/.test(pathname)) return { ai: true, ok: true, model: 'stub-model', generated_at: '2026-09-29T10:00:00Z', section: 'leads', label: 'Leads',
    insights: { highlights: ['3 hot leads, 1 silent for 24 days'], risks: ['1 follow-up overdue'], suggestions: ['Call Ahmed first'] }, extra: { call_list: [{ customer_id: 1, name: 'Ahmed', why: 'follow-up overdue since 20 Sep' }] } };
  if (/\/ai\/chat$/.test(pathname)) return { ai: true, ok: true, section: 'leads', label: 'Leads', answer: 'Ahmed has been silent 24 days. I have proposed a follow-up for 1 October.', model: 'stub-model',
    tool_calls: [{ name: 'calculate', args: { expression: '24 - 14' }, result: { expression: '24 - 14', result: 10 } }, { name: 'propose_action', args: { type: 'create_followup' }, result: { proposed: true, ...PROPOSAL } }], proposals: [PROPOSAL] };
  if (/\/ai\/actions\/run$/.test(pathname)) { posted.push(body || ''); return { ok: true, type: 'create_followup', message: 'Follow-up scheduled for Ahmed on 2026-10-01.' }; }
  return [];
}
async function openPortal(browser, { route, file, tokenKey, port }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (/unpkg|jsdelivr|fonts\.g/.test(req.url())) return req.respond({ status: 200, contentType: 'text/plain', body: '' });
    if (u.pathname.startsWith('/api/')) {
      if (/events|stream$/.test(u.pathname)) return req.respond({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname, req.postData())) });
    }
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(k => { localStorage.setItem(k, 'test-token'); Object.keys(localStorage).filter(x => x.startsWith('ml_ai_card_')).forEach(x => localStorage.removeItem(x)); }, tokenKey);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' });
  await sleep(700);
  return { page, errs };
}

(async () => {
  const puppeteer = require('puppeteer');
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: 'new', args: ['--no-sandbox'] });

  for (const portal of [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', leadsPage: 'customers' },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', leadsPage: 'leads' },
  ]) {
    posted.length = 0;
    const { page, errs } = await openPortal(browser, { ...portal, port });
    await page.evaluate(p => navigate(p), portal.leadsPage);
    await sleep(900);
    const head = await page.evaluate(() => {
      const b = document.getElementById('ai-btn');
      return { exists: !!b, shown: !!b && getComputedStyle(b).display !== 'none', brain: !!(b && b.querySelector('svg.ml-brain')), beforeHelp: !!(b && b.nextElementSibling && b.nextElementSibling.id === 'help-btn') };
    });
    check(`${portal.label}: the brain sits in the header beside Help`, head.exists && head.shown && head.brain && head.beforeHelp, JSON.stringify(head));

    const card = await page.evaluate(p => {
      const c = document.getElementById('ai-card-' + p);
      const pageEl = document.getElementById('page-' + p);
      return { exists: !!c, inPage: !!(c && pageEl && pageEl.contains(c)), section: c && c.dataset.section, text: c ? c.textContent.replace(/\s+/g, ' ') : '',
        first: !!(c && c.parentElement && c.parentElement.firstElementChild === c), st: (document.getElementById('ai-card-st-' + p) || {}).textContent || '' };
    }, portal.leadsPage);
    check(`${portal.label}: an insight card heads the Leads page, on the leads section`, card.exists && card.inPage && card.section === 'leads' && card.first, JSON.stringify({ ...card, text: card.text.slice(0, 60) }));
    check(`${portal.label}: …showing highlights, risks, suggestions and who to call first`, /3 hot leads/.test(card.text) && /1 follow-up overdue/.test(card.text) && /Call first/.test(card.text) && /Ahmed/.test(card.text) && /stub-model/.test(card.st), card.text.slice(0, 120));

    const toggled = await page.evaluate(p => { aiCardToggle(p); const c = document.getElementById('ai-card-' + p); const closed = c.classList.contains('collapsed'); aiCardToggle(p); return { closed, reopened: !c.classList.contains('collapsed'), stored: localStorage.getItem('ml_ai_card_' + p) }; }, portal.leadsPage);
    check(`${portal.label}: the card folds and remembers`, toggled.closed && toggled.reopened && toggled.stored === 'open', JSON.stringify(toggled));

    await page.evaluate(() => aiOpen());
    await sleep(600);
    const drawer = await page.evaluate(() => ({
      open: document.getElementById('ai-panel').classList.contains('open'),
      section: (document.getElementById('ai-title-section') || {}).textContent || '',
      status: (document.getElementById('ai-status') || {}).textContent || '',
      chips: [...document.querySelectorAll('#ai-body .ai-chip')].map(c => c.textContent),
      welcome: (document.querySelector('#ai-body .ai-msg.bot') || {}).textContent || '',
    }));
    check(`${portal.label}: the drawer opens on Leads with its chips and the no-key notice`, drawer.open && drawer.section === 'Leads' && drawer.chips.length === 2 && /hot leads/.test(drawer.chips[0]) && /not configured/.test(drawer.status) && /propose things to do/.test(drawer.welcome), JSON.stringify(drawer));

    await page.evaluate(() => { document.getElementById('ai-input').value = 'Who has gone quiet?'; aiSend(); });
    await sleep(800);
    const chat = await page.evaluate(() => {
      const bots = [...document.querySelectorAll('#ai-body .ai-msg.bot')];
      const last = bots[bots.length - 1];
      const action = document.querySelector('#ai-body .ai-action');
      return { answer: last ? last.textContent : '', work: !!(last && last.querySelector('.ai-work')), workText: last ? (last.querySelector('.ai-work code') || {}).textContent || '' : '',
        action: !!action, actionText: action ? action.textContent.replace(/\s+/g, ' ') : '', confirm: !!(action && action.querySelector('button.pri')), posted: 0 };
    });
    check(`${portal.label}: the answer shows its working and a proposed action with a Confirm button`, /silent 24 days/.test(chat.answer) && chat.work && /calculate\(24 - 14\)/.test(chat.workText) && chat.action && /Proposed/.test(chat.actionText) && /lead #1 on 2026-10-01/.test(chat.actionText) && chat.confirm, JSON.stringify(chat));
    check(`${portal.label}: nothing was written before Confirm`, posted.length === 0, String(posted.length));

    await page.evaluate(() => document.querySelector('#ai-body .ai-action button.pri').click());
    await sleep(600);
    const done = await page.evaluate(() => { const a = document.querySelector('#ai-body .ai-action'); return { done: !!(a && a.classList.contains('done')), text: a ? a.textContent.replace(/\s+/g, ' ') : '', buttons: a ? a.querySelectorAll('button').length : -1 }; });
    check(`${portal.label}: Confirm runs the action once, and the card reports the result`, posted.length === 1 && /create_followup/.test(posted[0]) && /"customer_id":1/.test(posted[0]) && done.done && /Follow-up scheduled for Ahmed/.test(done.text) && done.buttons === 0, JSON.stringify({ posted: posted[0], done }));

    await page.evaluate(() => aiClose());
    // Accounting keeps its own cards: no assistant card is mounted there.
    if (portal.label === 'admin') {
      await page.evaluate(() => navigate('accounting'));
      await sleep(500);
      const acct = await page.evaluate(() => ({ card: !!document.getElementById('ai-card-accounting'), own: !!document.querySelector('#acct-root .acct-shell') }));
      check('admin: the Accounting page keeps its own cards, no assistant card is added', !acct.card && acct.own, JSON.stringify(acct));
    }
    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  await browser.close();
  srv.close();
  const passed = results.filter(Boolean).length;
  console.log('\n' + passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
