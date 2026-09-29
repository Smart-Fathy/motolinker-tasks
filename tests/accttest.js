// The Accounting section: the arithmetic, then the page.
//
// Every figure the section shows — and every figure its AI is handed — comes
// from src/lib/finance.js, which is pure so it can be fed fixtures here. The
// browser half opens both portals against stubbed endpoints and checks the
// things a reader would notice first: the colourful brain in the rail, the page
// rendering its tabs, buttons hidden for an employee without the grant, and
// the AI drawer saying plainly that no key is set.
const fs = require('fs'), path = require('path'), http = require('http');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fin = require(process.cwd() + '/src/lib/finance.js');
const gem = require(process.cwd() + '/src/lib/gemini.js');

// ── Aging ─────────────────────────────────────────────────────────────────────
check('aging: not due is current', fin.agingBucket(0) === 'current');
check('aging: 1 and 30 are the first bucket', fin.agingBucket(1) === '1_30' && fin.agingBucket(30) === '1_30');
check('aging: 31/60/61/90/91 land where the labels say',
  fin.agingBucket(31) === '31_60' && fin.agingBucket(60) === '31_60' && fin.agingBucket(61) === '61_90'
  && fin.agingBucket(90) === '61_90' && fin.agingBucket(91) === '90_plus');
check('days overdue: no due date is not overdue', fin.daysOverdue('', 5000, '2026-09-29') === 0);
check('days overdue: nothing owed is not overdue', fin.daysOverdue('2026-01-01', 0, '2026-09-29') === 0);
check('days overdue: counts whole days past the date', fin.daysOverdue('2026-09-01', 100, '2026-09-29') === 28);

// ── One sale ──────────────────────────────────────────────────────────────────
{
  const legacy = fin.salePosition({ id: 1, client: 'A', price_list: 1000000, discounted: 950000, down_payment: 200000, remaining: 750000, remaining_due: '2026-08-30' }, [], '2026-09-29');
  check('a sale with no payment rows reads off its own columns', legacy.legacy === true && legacy.received === 200000 && legacy.outstanding === 750000, JSON.stringify(legacy));
  check('…against the discounted price, and is overdue by the calendar', legacy.agreed_price === 950000 && legacy.days_overdue === 30 && legacy.bucket === '1_30');
  const rows = [
    { kind: 'down_payment', direction: 'in', amount: 300000, currency: 'EGP', fx_rate: 1, amount_base: 300000, paid_on: '2026-09-02' },
    { kind: 'instalment', direction: 'in', amount: 2000, currency: 'USD', fx_rate: 50, amount_base: 100000, paid_on: '2026-09-10' },
    { kind: 'refund', direction: 'out', amount: 50000, currency: 'EGP', fx_rate: 1, amount_base: 50000, paid_on: '2026-09-12' },
    { kind: 'freight', direction: 'out', amount: 80000, currency: 'EGP', fx_rate: 1, amount_base: 80000, paid_on: '2026-09-12' },
  ];
  const led = fin.salePosition({ id: 2, client: 'B', price_list: 1000000, down_payment: 999999, remaining: 1 }, rows, '2026-09-29');
  check('a sale with rows ignores its legacy columns', led.legacy === false && led.received === 400000 && led.refunded === 50000, JSON.stringify(led));
  check('…freight is cost, not settlement, and the balance is price − net', led.outstanding === 650000 && led.last_payment_on === '2026-09-12');
  // The production path injects the ledger's own summary(); the fallback must agree with it.
  const injected = fin.salePosition({ id: 2, price_list: 1000000 }, rows, '2026-09-29', {
    paymentSummary: (list, price) => ({ received: 400000, refunded: 50000, outstanding: price - 350000, last_payment_on: '2026-09-12' }),
  });
  check('an injected summary is used verbatim', injected.received === 400000 && injected.outstanding === 650000);
}

// ── The pack ──────────────────────────────────────────────────────────────────
const FIX = {
  sales: [
    { id: 1, client: 'Ahmed', brand: 'BYD', model: 'Seal', price_list: 1200000, discounted: 0, down_payment: 0, remaining: 0, remaining_due: '2026-09-15', reservation_date: '2026-09-01' },
    { id: 2, client: 'Mona', brand: 'BYD', model: 'Atto', price_list: 900000, discounted: 850000, down_payment: 100000, remaining: 750000, remaining_due: '2026-06-01', reservation_date: '2026-05-20' },
    { id: 3, client: 'Settled Co', brand: 'BYD', model: 'Han', price_list: 500000, down_payment: 0, remaining: 0, created_at: '2026-09-05T10:00:00Z' },
  ],
  payments: [
    { id: 1, sale_id: 1, kind: 'down_payment', direction: 'in', amount: 400000, currency: 'EGP', fx_rate: 1, amount_base: 400000, paid_on: '2026-09-03' },
    { id: 2, sale_id: 1, kind: 'instalment', direction: 'in', amount: 100000, currency: 'EGP', fx_rate: 1, amount_base: 100000, paid_on: '2026-09-20' },
    { id: 3, sale_id: 3, kind: 'final', direction: 'in', amount: 500000, currency: 'EGP', fx_rate: 1, amount_base: 500000, paid_on: '2026-09-06' },
    { id: 4, sale_id: 1, kind: 'refund', direction: 'out', amount: 20000, currency: 'EGP', fx_rate: 1, amount_base: 20000, paid_on: '2026-09-21' },
    { id: 5, unit_id: 7, kind: 'supplier', direction: 'out', amount: 5000, currency: 'USD', fx_rate: 48, amount_base: 240000, paid_on: '2026-09-08' },
    { id: 6, kind: 'freight', direction: 'out', amount: 30000, currency: 'EGP', fx_rate: 1, amount_base: 30000, paid_on: '2026-09-09' },
    { id: 7, kind: 'customs', direction: 'out', amount: 60000, currency: 'EGP', fx_rate: 1, amount_base: 60000, paid_on: '2026-08-28' },   // outside the range
    { id: 8, sale_id: 2, kind: 'instalment', direction: 'in', amount: 50000, currency: 'EGP', fx_rate: 1, amount_base: 50000, paid_on: '2026-07-01' }, // outside, but counts for the position
  ],
  purchaseOrders: [
    { id: 11, po_number: 'PO-1', supplier: 'Yu Motors', currency: 'USD', po_date: '2026-09-02', status: 'confirmed', items: [{ pi_price: 20000, units: 2 }, { pi_price: 5000 }] },
    { id: 12, po_number: 'PO-2', supplier: 'Uniland', currency: 'USD', po_date: '2026-03-02', status: 'closed', items: [{ pi_price: 1000, units: 1 }] },
  ],
  expenses: [
    { id: 1, category: 'rent', amount: 50000, currency: 'EGP', fx_rate: 1, amount_base: 50000, spent_on: '2026-09-01' },
    { id: 2, category: 'marketing', amount: 1000, currency: 'USD', fx_rate: 49, amount_base: 49000, spent_on: '2026-09-15' },
    { id: 3, category: 'nonsense', amount: 1000, currency: 'EGP', fx_rate: 1, amount_base: 1000, spent_on: '2026-09-16' },
    { id: 4, category: 'marketing', amount: 30000, currency: 'EGP', fx_rate: 1, amount_base: 30000, spent_on: '2026-07-10' },  // prior window
    { id: 5, category: 'rent', amount: 50000, currency: 'EGP', fx_rate: 1, amount_base: 50000, spent_on: '2026-06-01' },       // prior window
  ],
  units: [{ id: 7, po_id: 11 }],
};
const pack = fin.buildFinancePack(FIX, { from: '2026-09-01', to: '2026-09-30' }, { today: '2026-09-29' });
check('cash in is every in-payment in range', pack.cash.in === 1000000, String(pack.cash.in));
check('cash out is every out-payment in range, the refund included', pack.cash.out === 290000, String(pack.cash.out));
check('net cash follows', pack.cash.net === 710000);
check('revenue on a cash basis excludes the refund', pack.revenue.cash === 980000, String(pack.revenue.cash));
check('agreed revenue is the sales reserved in range, at the agreed price', pack.revenue.agreed === 1700000 && pack.revenue.sales_reserved === 2, JSON.stringify(pack.revenue));
check('cogs is supplier + freight + customs inside the range only', pack.cogs.total === 270000 && pack.cogs.customs === 0, JSON.stringify(pack.cogs));
check('gross margin and its percentage', pack.gross_margin.amount === 710000 && pack.gross_margin.pct === 72.45, JSON.stringify(pack.gross_margin));
check('opex sums the base amounts and files an unknown category under other',
  pack.opex.total === 100000 && pack.opex.by_category.find(c => c.category === 'other').amount === 1000, JSON.stringify(pack.opex.by_category));
check('the prior window averages the three months before the range',
  pack.opex.prior.total === 80000 && pack.opex.prior.by_category.find(c => c.category === 'marketing').avg_per_month === 10000, JSON.stringify(pack.opex.prior));
check('net result = margin − opex', pack.net_result === 610000);
check('one month in range gives one bar', pack.cash.by_month.length === 1 && pack.cash.by_month[0].month === '2026-09');
{
  const r = pack.receivables;
  const ahmed = r.rows.find(x => x.client === 'Ahmed'), mona = r.rows.find(x => x.client === 'Mona');
  check('receivables are as of today, from every payment of the sale', ahmed.outstanding === 720000 && ahmed.days_overdue === 14 && ahmed.bucket === '1_30', JSON.stringify(ahmed));
  check('…a sale paid off does not appear', !r.rows.some(x => x.client === 'Settled Co') && pack.counts.sales_settled === 1);
  check('…and an old debt ages past 90 days', mona.outstanding === 800000 && mona.bucket === '90_plus', JSON.stringify(mona));
  check('aging totals add up to the outstanding figure', r.outstanding === 1520000 && r.overdue === 1520000
    && r.aging['1_30'].amount === 720000 && r.aging['90_plus'].amount === 800000, JSON.stringify(r.aging));
}
{
  const p = pack.payables;
  const po1 = p.purchase_orders.find(x => x.po_number === 'PO-1');
  check('a PO total is Σ pi_price × units in its own currency', po1.pi_total === 45000 && po1.units === 3 && po1.currency === 'USD');
  check('paid is known only through a linked unit', po1.paid_base === 240000 && p.purchase_orders.find(x => x.po_number === 'PO-2').paid_base === null);
  check('money out by kind is sorted largest first', p.out_by_kind[0].kind === 'supplier' && p.out_by_kind[0].amount === 240000);
  check('the indicative USD rate is the latest one booked', p.indicative_usd_rate.rate === 49 && p.indicative_usd_rate.as_of === '2026-09-15', JSON.stringify(p.indicative_usd_rate));
  check('top suppliers come from the POs in range', pack.top_suppliers.length === 1 && pack.top_suppliers[0].supplier === 'Yu Motors');
}
check('top clients rank cash received', pack.top_clients[0].client === 'Ahmed' && pack.top_clients[0].received === 500000, JSON.stringify(pack.top_clients));
{
  const empty = fin.buildFinancePack({}, { from: '2026-09-01', to: '2026-09-30' }, { today: '2026-09-29' });
  const flat = JSON.stringify(empty);
  check('an empty book is zeros, never NaN or null where a number belongs', !/NaN/.test(flat) && empty.cash.in === 0 && empty.gross_margin.pct === 0 && empty.receivables.rows.length === 0);
  const trimmed = fin.trimPack(pack);
  check('the model is handed a trimmed pack that still carries the definitions', Array.isArray(trimmed.definitions) && trimmed.definitions.length > 5 && trimmed.generated_at === undefined);
}

// ── Named queries ─────────────────────────────────────────────────────────────
check('finance_query refuses an unknown query', /Unknown query/.test(fin.financeQuery(FIX, pack, 'drop_table', {}).error || ''));
check('finance_query validates dates', /YYYY-MM-DD/.test(fin.financeQuery(FIX, pack, 'sum_payments', { from: 'yesterday' }).error || ''));
check('sum_payments filters by direction and kind', fin.financeQuery(FIX, pack, 'sum_payments', { direction: 'out', kind: 'supplier' }).amount_base === 240000);
check('sum_expenses filters by category', fin.financeQuery(FIX, pack, 'sum_expenses', { category: 'marketing' }).amount_base === 49000);
check('overdue_receivables honours min_days', fin.financeQuery(FIX, pack, 'overdue_receivables', { min_days: 30 }).count === 1);
check('sale_position needs a name or an id', !!fin.financeQuery(FIX, pack, 'sale_position', {}).error
  && fin.financeQuery(FIX, pack, 'sale_position', { client: 'mon' }).rows[0].client === 'Mona');
check('limit is clamped to 1–50', fin.financeQuery(FIX, pack, 'top_receivables', { limit: 999 }).rows.length === 2);

// ── The calculator ────────────────────────────────────────────────────────────
check('calc: thousands separators and a percent literal', fin.safeCalc('1,200 + 5%') === 1200.05);
check('calc: pct with comma-separated thousands in both arguments', fin.safeCalc('pct(250,000, 1,000,000)') === 25);
check('calc: precedence and unary minus', fin.safeCalc('-(2^3)*2 + 10/4') === -13.5);
check('calc: named functions', fin.safeCalc('round(avg(10, 20, 33), 1)') === 21 && fin.safeCalc('max(1,2) + min(5, 3)') === 5);
for (const bad of ['process.exit(1)', 'require("fs")', '(2+3', '2..3', '1 2', 'x'.repeat(201), '', '1/0', 'pow(2,3)']) {
  let threw = false; try { fin.safeCalc(bad); } catch (_) { threw = true; }
  check('calc rejects ' + JSON.stringify(bad.slice(0, 16)), threw);
}

// ── An expense row ────────────────────────────────────────────────────────────
check('expense: amount must be positive', /greater than zero/.test(fin.expenseBuildRow({ amount: 0 }).error));
check('expense: a USD amount needs its rate', /USD expense needs the rate/.test(fin.expenseBuildRow({ amount: 10, currency: 'usd' }).error));
{
  const { row } = fin.expenseBuildRow({ amount: '1,000', currency: 'EGP', fx_rate: 99, category: 'wat', spent_on: 'soon', receipt: { url: 'http://evil', name: 'x' }, method: 'cash', description: 'a'.repeat(400) });
  check('expense: EGP forces rate 1, unknown category is other, a bad date is today, an http receipt is dropped',
    row.fx_rate === 1 && row.amount_base === 1000 && row.category === 'other' && /^\d{4}-\d{2}-\d{2}$/.test(row.spent_on)
    && !row.receipt.url && row.method === 'cash' && row.description.length === 300, JSON.stringify(row));
  const usd = fin.expenseBuildRow({ amount: 100, currency: 'USD', fx_rate: 48.5, receipt: { url: 'https://x/y.pdf', name: 'y.pdf', size: 10, type: 'application/pdf' } }).row;
  check('expense: the base figure is stored from the stated rate', usd.amount_base === 4850 && usd.receipt.url === 'https://x/y.pdf');
}

// ── Periods ───────────────────────────────────────────────────────────────────
check('period: this month', JSON.stringify(fin.reportRangeFor('this_month', { today: '2026-09-29' })).includes('"from":"2026-09-01","to":"2026-09-30"'));
check('period: last month', fin.reportRangeFor('last_month', { today: '2026-01-15' }).from === '2025-12-01');
check('period: the quarter', fin.reportRangeFor('quarter', { today: '2026-09-29' }).label === 'Q3 2026');
check('period: custom needs both dates in order, else this month', fin.reportRangeFor('custom', { today: '2026-09-29', from: '2026-09-10', to: '2026-09-01' }).period === 'this_month'
  && fin.reportRangeFor('custom', { from: '2026-01-01', to: '2026-02-01' }).label === '2026-01-01 → 2026-02-01');

// ── AI plumbing ───────────────────────────────────────────────────────────────
check('parseAiJson: a fenced object', JSON.stringify(gem.parseAiJson('```json\n{"a":1}\n```')) === '{"a":1}');
check('parseAiJson: prose before the object', gem.parseAiJson('Sure! Here it is: {"highlights":["x"]} hope it helps').highlights[0] === 'x');
check('parseAiJson: not JSON is null, not a throw', gem.parseAiJson('no braces here') === null && gem.parseAiJson('{broken') === null);
check('gemini: without a key the call reports noKey rather than throwing', (async () => {
  const saved = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  const r = await gem.geminiCall({ systemText: 'x', contents: [] });
  if (saved) process.env.GEMINI_API_KEY = saved;
  return r.ok === false && r.noKey === true;
}));
{
  const html = fin.buildFinanceReportHtml({ lang: 'ar', period_label: 'سبتمبر 2026', pack, narrative: '## الملخص\n- **نقطة** <b>x</b>' }, { logoUrl: 'https://example.com/l.png' });
  check('report html: Arabic is right-to-left, markdown is rendered and escaped',
    /dir="rtl"/.test(html) && /<h2>الملخص<\/h2>/.test(html) && /<strong>نقطة<\/strong> &lt;b&gt;x&lt;\/b&gt;/.test(html) && /example.com\/l.png/.test(html));
  const plain = fin.buildFinanceReportHtml({ lang: 'en', pack, narrative: '' });
  check('report html: no narrative says so instead of leaving a hole', /No AI narrative/.test(plain) && /1,520,000/.test(plain));
}

// ── The page, in both portals ─────────────────────────────────────────────────
const PERMS = { accounting: true, accountingActions: { view: true, edit: false, export: true, ai: true } };
function api(pathname) {
  if (/auth\/check$/.test(pathname)) return { ok: true };
  if (/employee\/check$/.test(pathname)) return { ok: true, id: 2, name: 'Sara', username: 'sara', permissions: PERMS };
  if (/accounting\/overview$/.test(pathname)) return {
    range: { from: '2026-09-01', to: '2026-09-30', label: 'September 2026' }, kpis: pack ? {
      cash_in: pack.cash.in, cash_out: pack.cash.out, net_cash: pack.cash.net, receivables_outstanding: pack.receivables.outstanding,
      receivables_overdue: pack.receivables.overdue, landed_costs: pack.cogs.total, expenses: pack.opex.total,
      gross_margin: pack.gross_margin.amount, gross_margin_pct: pack.gross_margin.pct, net_result: pack.net_result } : {},
    cash_by_month: pack.cash.by_month, top_clients: pack.top_clients, counts: pack.counts, warnings: [], ai: false };
  if (/accounting\/receivables$/.test(pathname)) return { range: { from: '2026-09-01', to: '2026-09-30', label: 'September 2026' }, as_of: '2026-09-29', ...pack.receivables, buckets: fin.AGING_BUCKETS, settled: 1, warnings: [] };
  if (/accounting\/payables$/.test(pathname)) return { range: pack.range, ...pack.payables, cogs: pack.cogs, top_suppliers: pack.top_suppliers, warnings: [] };
  if (/accounting\/expenses$/.test(pathname)) return { range: pack.range, rows: FIX.expenses.slice(0, 3), categories: [{ key: 'rent', label: 'Rent' }, { key: 'marketing', label: 'Marketing' }, { key: 'other', label: 'Other' }],
    methods: ['cash', 'bank_transfer'], currencies: ['EGP', 'USD'], ...pack.opex, warnings: [] };
  if (/accounting\/ledger$/.test(pathname)) return { range: pack.range, rows: [], kinds: [], totals: { in: 0, out: 0 }, warnings: [] };
  if (/accounting\/reports$/.test(pathname)) return [];
  if (/accounting\/ai\/(status|insights)$/.test(pathname)) return { ai: false };
  if (/\/ai\/sections$/.test(pathname)) return { ai: false, act: true, pages: {}, sections: [
    { key: 'home', label: 'Home', chips: { en: ['What needs my attention today?'], ar: ['ما الذي يحتاج انتباهي اليوم؟'] }, actions: [] },
    { key: 'accounting', label: 'Accounting', chips: { en: ['Summarise this month', 'Who should we chase first?'], ar: ['لخّص هذا الشهر'] }, actions: [] } ] };
  if (/\/ai\/(status|insights)$/.test(pathname)) return { ai: false };
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
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(api(u.pathname)) });
    }
    if (u.pathname === route) return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(file, 'utf8') });
    const f = path.join('public', u.pathname.replace(/^\//, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ct = f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : undefined;
      return req.respond({ status: 200, ...(ct ? { contentType: ct } : {}), body: fs.readFileSync(f) });
    }
    req.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(k => { localStorage.setItem(k, 'test-token'); localStorage.removeItem('ml_acct_tab'); localStorage.removeItem('ml_acct_period'); }, tokenKey);
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle2' });
  await sleep(700);
  return { page, errs };
}

(async () => {
  const puppeteer = require('puppeteer');
  const srv = http.createServer((_q, s) => { s.writeHead(404); s.end(); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await puppeteer.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: 'new', args: ['--no-sandbox'] });

  for (const portal of [
    { label: 'admin', route: '/dashboard', file: 'public/dashboard.html', tokenKey: 'ml_admin_token', canEdit: true },
    { label: 'team', route: '/employee', file: 'public/employee.html', tokenKey: 'ml_emp_token', canEdit: false },
  ]) {
    const { page, errs } = await openPortal(browser, { ...portal, port });
    const nav = await page.evaluate(() => {
      const item = document.getElementById('nav-accounting');
      const svg = item && item.querySelector('.nav-icon svg.ml-brain');
      return {
        exists: !!item, group: item && item.closest('.nav-group') && item.closest('.nav-group').dataset.group,
        shown: !!item && getComputedStyle(item).display !== 'none',
        stroke: svg && svg.getAttribute('stroke'), grads: document.querySelectorAll('#ml-ai-grad').length,
        size: svg ? svg.getBoundingClientRect().width : 0,
        chip: item && getComputedStyle(item.querySelector('.nav-icon')).backgroundImage,
        heading: (() => { const g = item && item.closest('.nav-group'); const l = g && g.querySelector('.nav-group-label'); return l ? l.textContent.trim() : null; })(),
      };
    });
    check(`${portal.label}: the Accounting item sits in the Finance group and is shown`, nav.exists && nav.group === 'finance' && nav.shown && nav.heading === 'Finance', JSON.stringify(nav));
    check(`${portal.label}: its icon is a brain stroked with the shared gradient`, nav.stroke === 'url(#ml-ai-grad)' && nav.size > 0, JSON.stringify(nav));
    check(`${portal.label}: the gradient is defined exactly once`, nav.grads === 1, String(nav.grads));
    check(`${portal.label}: the chip behind the brain is a gradient, not the group tint`, /linear-gradient/.test(nav.chip || ''), String(nav.chip));

    await page.evaluate(() => navigate('accounting'));
    await sleep(700);
    const pageState = await page.evaluate(() => ({
      active: document.getElementById('page-accounting').classList.contains('active'),
      tabs: document.querySelectorAll('.acct-tab').length,
      kpis: document.querySelectorAll('#acct-pane-overview .acct-kpi').length,
      label: (document.getElementById('acct-range-label') || {}).textContent,
      aiBtn: !!document.getElementById('acct-ai-btn'),
      headerBrain: !!document.querySelector('#acct-root .acct-title svg.ml-brain'),
      insights: (document.getElementById('acct-ins-body-overview') || {}).textContent || '',
    }));
    check(`${portal.label}: the page opens with six tabs and the overview KPIs`, pageState.active && pageState.tabs === 6 && pageState.kpis === 8, JSON.stringify(pageState));
    check(`${portal.label}: the range label comes from the server`, pageState.label === 'September 2026', String(pageState.label));
    check(`${portal.label}: the brain heads the page and the AI button is offered`, pageState.headerBrain && pageState.aiBtn);
    check(`${portal.label}: with no key the insight card says so`, /not configured/.test(pageState.insights), pageState.insights.slice(0, 60));

    await page.evaluate(() => acctTab('expenses'));
    await sleep(600);
    const exp = await page.evaluate(() => ({
      active: document.getElementById('acct-pane-expenses').classList.contains('active'),
      overviewHidden: getComputedStyle(document.getElementById('acct-pane-overview')).display === 'none',
      rows: document.querySelectorAll('#acct-pane-expenses .acct-table tbody tr').length,
      editButtons: document.querySelectorAll('#acct-pane-expenses [data-perm="accounting.edit"]').length,
    }));
    check(`${portal.label}: switching tabs shows one pane and renders the rows`, exp.active && exp.overviewHidden && exp.rows === 3, JSON.stringify(exp));
    check(`${portal.label}: expense buttons are ${portal.canEdit ? 'drawn for the admin' : 'withheld without accounting.edit'}`,
      portal.canEdit ? exp.editButtons >= 1 : exp.editButtons === 0, String(exp.editButtons));

    await page.evaluate(() => { acctTab('receivables'); });
    await sleep(600);
    const recv = await page.evaluate(() => {
      const before = [...document.querySelectorAll('#acct-recv-table tbody tr td:first-child')].map(td => td.textContent.trim());
      acctSort('client');
      const after = [...document.querySelectorAll('#acct-recv-table tbody tr td:first-child')].map(td => td.textContent.trim());
      return { before, after, aging: document.querySelectorAll('#acct-pane-receivables .acct-row').length };
    });
    check(`${portal.label}: receivables list largest first and re-sort by column`,
      recv.before[0].startsWith('Mona') && recv.after[0].startsWith('Ahmed') && recv.aging === 5, JSON.stringify(recv));

    // The page's brain button opens the one global drawer, on the Accounting section.
    await page.evaluate(() => acctAiOpen());
    await sleep(600);
    const ai = await page.evaluate(() => ({
      open: document.getElementById('ai-panel').classList.contains('open'),
      section: (document.getElementById('ai-title-section') || {}).textContent || '',
      status: (document.getElementById('ai-status') || {}).textContent || '',
      brain: !!document.querySelector('#ai-panel svg.ml-brain'),
      chips: document.querySelectorAll('#ai-body .ai-chip').length,
      localDrawer: !!document.getElementById('acai-panel'),
    }));
    check(`${portal.label}: the brain opens the global drawer on Accounting, with the brain and the no-key notice`,
      ai.open && ai.section === 'Accounting' && ai.brain && /not configured/.test(ai.status) && ai.chips >= 2 && !ai.localDrawer, JSON.stringify(ai));
    await page.evaluate(() => aiClose());

    if (portal.label === 'admin') {
      // The favourites row clones the icon's markup: the brain must survive the
      // clone without a second copy of the gradient.
      const fav = await page.evaluate(async () => {
        _navFavs = ['accounting', 'tasks'];
        renderNavFavs();
        await new Promise(r => setTimeout(r, 50));
        const f = document.getElementById('fav-accounting');
        const svg = f && f.querySelector('svg.ml-brain');
        return { exists: !!f, stroke: svg && svg.getAttribute('stroke'), grads: document.querySelectorAll('#ml-ai-grad').length,
          chip: f && getComputedStyle(f.querySelector('.nav-icon')).backgroundImage };
      });
      check('admin: a favourited Accounting keeps its gradient brain, and the gradient stays defined once',
        fav.exists && fav.stroke === 'url(#ml-ai-grad)' && fav.grads === 1 && /linear-gradient/.test(fav.chip || ''), JSON.stringify(fav));
    }
    check(`${portal.label}: no page errors`, !errs.length, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  await browser.close();
  srv.close();
  // The one async check above.
  const settled = await Promise.all(results.map(r => (r && typeof r.then === 'function') ? r : Promise.resolve(r)));
  const passed = settled.filter(Boolean).length;
  console.log('\n' + passed + '/' + settled.length + ' passed');
  process.exit(passed === settled.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
