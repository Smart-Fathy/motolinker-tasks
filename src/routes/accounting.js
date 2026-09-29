// The Accounting section: money in, money out, what the company spends on
// itself, and a finance AI that reads all of it.
//
// Every figure here is computed by src/lib/finance.js from the ledger, the sales
// register, purchase orders and the expenses table — deterministic code. The
// model (src/lib/gemini.js) is handed those figures and narrates, prioritises
// and suggests; when it needs a number that is not in the pack it calls back
// into the same code through two tools, `finance_query` and `calculate`, so an
// answer can always be traced to arithmetic that ran here.
//
// COMPANY-WIDE, ON PURPOSE. The CRM sections scope an employee to their own
// leads and deals (empReportScope); an accountant's job is the whole book, so
// nothing here is scoped by ownership. The `accounting` permission is the gate,
// and it is off for everyone until an admin grants it.
//
// src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } =
  ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Registered on the context by modules that load before this one (payments,
// reports, contracts) — resolved when called, the way every module does it.
const requirePerm = (...a) => ctx.requirePerm(...a);
const paymentSummary = (...a) => ctx.paymentSummary(...a);
const csvSerialize = (...a) => ctx.csvSerialize(...a);
const renderQuotationPdf = (...a) => ctx.renderQuotationPdf(...a);

const { BRAND_LOGO_URL, EXPENSE_CATEGORIES, PAYMENT_KINDS, PAYMENT_METHODS, PAYMENT_DIRECTIONS,
  CURRENCIES, BASE_CURRENCY } = require('../lib/constants');
const fin = require('../lib/finance');
const { geminiCall, geminiConfigured, geminiState, detectLang, parseAiJson } = require('../lib/gemini');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MISSING_RE = /(does not exist|could not find the table|schema cache)/i;

// The two tables from 022 are applied by hand, so a deploy can land before the
// SQL does. Reads degrade (loadFinanceData); writes say what to apply.
function acctDbFail(res, error, what) {
  const msg = String((error && (error.message || error.details)) || 'Database error');
  if (MISSING_RE.test(msg) && /expenses|accounting_reports/.test(msg)) {
    return res.status(503).json({ error: `${what} is not set up yet — apply migrations/022_accounting.sql.`, migration: '022' });
  }
  return res.status(500).json({ error: msg });
}

// ── Reading the book ─────────────────────────────────────────────────────────
async function safeSelect(run, label, warnings) {
  try {
    const { data, error } = await run();
    if (error) { warnings.push(`${label}: ${error.message || 'query failed'}`); return []; }
    return data || [];
  } catch (e) { warnings.push(`${label}: ${e.message}`); return []; }
}
// Capped rather than paged: a few thousand rows a year, and an unbounded select
// against Supabase is how a page hangs. Receivables need EVERY payment of every
// open sale, which is why payments are not filtered to the range here.
const PAYMENT_COLS = 'id,sale_id,unit_id,customer_id,direction,kind,method,amount,currency,fx_rate,amount_base,paid_on,reference,notes,recorded_by';
async function loadFinanceData(from) {
  const warnings = [];
  const sixBack = fin.addMonths(String(from || fin.dayOf(new Date().toISOString())).slice(0, 7), -6) + '-01';
  const [sales, payments, purchaseOrders, expenses, units] = await Promise.all([
    safeSelect(() => supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(2000), 'sales', warnings),
    safeSelect(() => supabase.from('payments').select(PAYMENT_COLS).order('paid_on', { ascending: false }).limit(5000), 'payments', warnings),
    safeSelect(() => supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(1000), 'purchase orders', warnings),
    (async () => {
      try {
        const { data, error } = await supabase.from('expenses').select('*').gte('spent_on', sixBack).order('spent_on', { ascending: false }).limit(5000);
        if (error) {
          warnings.push(MISSING_RE.test(error.message || '') ? 'expenses table missing — apply migrations/022_accounting.sql' : 'expenses: ' + error.message);
          return [];
        }
        return data || [];
      } catch (e) { warnings.push('expenses: ' + e.message); return []; }
    })(),
    safeSelect(() => supabase.from('vehicle_units').select('id,po_id').limit(2000), 'vehicle units', warnings),
  ]);
  return { sales, payments, purchaseOrders, expenses, units, warnings };
}

// ?period=this_month|last_month|quarter|ytd|custom&from&to → a range.
function rangeOf(q) {
  const src = q || {};
  const from = DATE_RE.test(String(src.from || '')) ? String(src.from) : '';
  const to = DATE_RE.test(String(src.to || '')) ? String(src.to) : '';
  const period = src.period ? String(src.period) : (from && to ? 'custom' : 'this_month');
  return fin.reportRangeFor(period, { from, to });
}

// The pack is what every tab and every AI call reads, and five tabs opening in
// a row must not mean five scans of the ledger. Sixty seconds, cleared on any
// write, keyed by range.
const _packCache = new Map();
const PACK_TTL = 60 * 1000;
async function packFor(range) {
  const key = `${range.from}|${range.to}`;
  const hit = _packCache.get(key);
  if (hit && Date.now() - hit.at < PACK_TTL) return hit;
  const data = await loadFinanceData(range.from);
  const pack = fin.buildFinancePack(data, range, { helpers: { paymentSummary } });
  const entry = { at: Date.now(), data, pack };
  _packCache.set(key, entry);
  return entry;
}
function invalidate() { _packCache.clear(); _aiCache.clear(); }

// ── The finance AI ───────────────────────────────────────────────────────────
const BUSY = {
  en: 'The finance AI is busy right now (free-tier rate limit) — please try again in a few seconds.',
  ar: 'المساعد المالي مشغول حالياً (تجاوز حد الاستخدام المجاني) — من فضلك حاول مرة أخرى بعد بضع ثوانٍ.',
};
const langOf = (v, text) => (v === 'ar' || v === 'en') ? v : detectLang(text || '');

function acctSystemPrompt(lang, pack, tab, task) {
  const L = lang === 'ar' ? 'Arabic — clear Modern Standard Arabic, Western digits for numbers' : 'English';
  return [
    'You are the MotoLinker finance assistant. MotoLinker imports and sells cars: it buys from suppliers in USD and sells to customers in EGP. The base currency for every total is EGP.',
    `Today is ${pack.today}. The figures below cover ${pack.range.from} to ${pack.range.to}; receivables are as of today.`,
    'SOURCE OF TRUTH: the FINANCE PACK (JSON) below and the results of your tools. Never invent, extrapolate or estimate a figure. If a number is not in the pack and cannot be fetched with finance_query, say so and name the nearest figure that is.',
    'ARITHMETIC: never do sums in your head. Use the calculate tool for every computation — percentages, differences, projections, what-if scenarios — and show the key working in one short line, e.g. "12% × 1,250,000 = 150,000". Use finance_query for any filtered figure that is not already in the pack.',
    'FORMAT: thousands separators and the currency ("EGP 1,250,000"). USD figures stay in USD; convert only with the indicative rate in the pack and say that you did.',
    'DEFINITIONS (from the pack): ' + pack.definitions.join(' | '),
    'AGING BUCKETS: current = not yet due or no due date; 1_30, 31_60, 61_90, 90_plus = days past the due date.',
    `LANGUAGE: answer in ${L}.`,
    'SCOPE: finance and this system only. You are not a tax or legal adviser — say so if asked and suggest consulting one. If the pack has no movements, say so and suggest recording payments and expenses first.',
    task ? 'TASK: ' + task : '',
    tab ? `The user is looking at the "${tab}" tab of the Accounting section.` : '',
    '',
    'FINANCE PACK:',
    JSON.stringify(pack),
  ].filter(Boolean).join('\n');
}

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'finance_query',
      description: 'Read a filtered figure from the company book for the current period (or another from/to). Use it when the pack does not already carry the number.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', enum: fin.QUERY_NAMES, description: 'Which figure to read.' },
          from: { type: 'STRING', description: 'YYYY-MM-DD; defaults to the pack range.' },
          to: { type: 'STRING', description: 'YYYY-MM-DD; defaults to the pack range.' },
          direction: { type: 'STRING', enum: ['in', 'out'], description: 'sum_payments only.' },
          kind: { type: 'STRING', description: 'sum_payments only: reservation, down_payment, instalment, final, refund, supplier, freight, customs.' },
          category: { type: 'STRING', description: 'sum_expenses only: ' + EXPENSE_CATEGORIES.map(c => c.key).join(', ') },
          client: { type: 'STRING', description: 'sale_position only: part of the client name.' },
          sale_id: { type: 'INTEGER', description: 'sale_position only.' },
          supplier: { type: 'STRING', description: 'po_list only: part of the supplier name.' },
          min_days: { type: 'INTEGER', description: 'overdue_receivables only: minimum days overdue.' },
          limit: { type: 'INTEGER', description: 'Rows to return, 1–50.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'calculate',
      description: 'Exact arithmetic. Supports + - * / ^ ( ), numbers with commas, a trailing % (5% = 0.05), and pct(part, whole), round(x, decimals), min(...), max(...), sum(...), avg(...), abs(x). Use it for EVERY computation.',
      parameters: { type: 'OBJECT', properties: { expression: { type: 'STRING' } }, required: ['expression'] },
    },
  ],
}];

function runTool(name, args, data, pack) {
  const a = args || {};
  if (name === 'calculate') {
    const expression = String(a.expression || '');
    try { return { expression, result: fin.safeCalc(expression) }; }
    catch (e) { return { expression, error: e.message }; }
  }
  if (name === 'finance_query') return fin.financeQuery(data, pack, a.query, a);
  return { error: 'Unknown tool ' + name };
}

// One conversation with the model, tools included. Bounded: at most four tool
// rounds, then one last call that must answer in words. Returns
// { ok:true, text, model, tool_calls } or the failing geminiCall result.
async function converse({ systemText, history, message, data, pack, generationConfig }) {
  const contents = [];
  for (const h of (Array.isArray(history) ? history.slice(-8) : [])) {
    if (!h || !h.content) continue;
    const role = (h.role === 'bot' || h.role === 'model' || h.role === 'assistant') ? 'model' : 'user';
    contents.push({ role, parts: [{ text: String(h.content).slice(0, 2000) }] });
  }
  contents.push({ role: 'user', parts: [{ text: String(message).slice(0, 4000) }] });
  const gen = { temperature: 0.2, maxOutputTokens: 1500, ...(generationConfig || {}) };
  const toolCalls = [];
  let res = null;
  for (let round = 0; round < 4; round++) {
    res = await geminiCall({ systemText, contents, tools: TOOLS, toolConfig: { functionCallingConfig: { mode: 'AUTO' } }, generationConfig: gen });
    if (!res.ok) return res;
    const calls = (res.parts || []).filter(p => p && p.functionCall);
    if (!calls.length) return { ok: true, text: res.text, model: res.model, tool_calls: toolCalls };
    // The model's turn goes back verbatim (it may carry a thought signature),
    // then one functionResponse per call, in the order they were made.
    contents.push({ role: 'model', parts: res.parts });
    contents.push({
      role: 'user',
      parts: calls.map(p => {
        const { name, args } = p.functionCall;
        const result = runTool(name, args, data, pack);
        toolCalls.push({ name, args: args || {}, result });
        return { functionResponse: { name, response: { result } } };
      }),
    });
  }
  res = await geminiCall({ systemText, contents, tools: TOOLS, toolConfig: { functionCallingConfig: { mode: 'NONE' } }, generationConfig: gen });
  return res.ok ? { ok: true, text: res.text, model: res.model, tool_calls: toolCalls } : res;
}

// Per-tab insight cards. JSON mode, no tools (the two cannot be combined), so
// the prompt names exactly what to compare and the pack carries it precomputed.
const INSIGHT_TASKS = {
  overview: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each, every one quoting a figure from the pack (cash in/out, net, revenue, gross margin, opex, net result, receivables). Suggestions must be concrete actions the accountant can take this week.',
  receivables: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…],"collection_plan":[{"sale_id":0,"client":"","outstanding":0,"days_overdue":0,"why":""}],"reminder":{"en":"","ar":""}}. collection_plan: up to 6 rows from receivables.rows, ordered by urgency (days overdue × outstanding), each "why" one sentence. reminder: a polite payment reminder under 80 words with the placeholders {client}, {amount} and {due}, in English and in Arabic.',
  payables: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…],"cost_analysis":[…]} — up to 4 short sentences each. cost_analysis explains where the money going out went (payables.out_by_kind, cogs, purchase orders by currency) and what it means for margin.',
  expenses: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…],"anomalies":[{"category":"","this_period":0,"prior_avg":0,"note":""}],"categorisation":[…]}. anomalies: compare each opex.by_category amount with the matching opex.prior.by_category avg_per_month (the prior three months) and list categories that moved sharply, with the two figures; an empty array is a valid answer. categorisation: up to 3 suggestions about how expenses are being categorised, or an empty array.',
  reports: 'Return ONLY a JSON object {"highlights":[…],"risks":[…],"suggestions":[…]} — up to 4 short sentences each, every one quoting a figure from the pack.',
};
const _aiCache = new Map();
const AI_TTL = 10 * 60 * 1000;
async function insightsFor(tab, range, lang, refresh) {
  const key = `${tab}|${range.from}|${range.to}|${lang}`;
  const hit = _aiCache.get(key);
  if (hit && !refresh && Date.now() - hit.at < AI_TTL) return { ...hit.payload, cached: true };
  const { pack } = await packFor(range);
  const trimmed = fin.trimPack(pack);
  const res = await geminiCall({
    systemText: acctSystemPrompt(lang, trimmed, tab, INSIGHT_TASKS[tab]),
    contents: [{ role: 'user', parts: [{ text: lang === 'ar' ? 'حلّل أرقام هذه الفترة.' : 'Analyse this period.' }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1800, responseMimeType: 'application/json' },
  });
  if (!res.ok) return { ai: true, ok: false, error: res.error, status: res.status, busy: res.status === 429 ? BUSY[lang] : undefined };
  const parsed = parseAiJson(res.text);
  if (!parsed || typeof parsed !== 'object') return { ai: true, ok: false, error: 'The model did not return JSON', model: res.model };
  const list = v => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).slice(0, 6) : []);
  const payload = {
    ai: true, ok: true, model: res.model, generated_at: new Date().toISOString(), tab, range, lang,
    insights: { highlights: list(parsed.highlights), risks: list(parsed.risks), suggestions: list(parsed.suggestions) },
    extra: {},
  };
  if (tab === 'receivables') {
    payload.extra.collection_plan = (Array.isArray(parsed.collection_plan) ? parsed.collection_plan : []).slice(0, 6);
    const rem = parsed.reminder && typeof parsed.reminder === 'object' ? parsed.reminder : {};
    payload.extra.reminder = { en: String(rem.en || ''), ar: String(rem.ar || '') };
  }
  if (tab === 'payables') payload.extra.cost_analysis = list(parsed.cost_analysis);
  if (tab === 'expenses') {
    payload.extra.anomalies = (Array.isArray(parsed.anomalies) ? parsed.anomalies : []).slice(0, 8);
    payload.extra.categorisation = list(parsed.categorisation);
  }
  _aiCache.set(key, { at: Date.now(), payload });
  return { ...payload, cached: false };
}

const REPORT_TASK = {
  en: 'Write a finance report for the period in markdown with EXACTLY these four headings, in this order: "## Executive summary", "## Highlights", "## Risks", "## Recommendations". Use bullet points under the last three. Quote figures from the pack with thousands separators. Between 250 and 450 words. No tables.',
  ar: 'اكتب تقريراً مالياً عن الفترة بصيغة ماركداون بهذه العناوين الأربعة بالضبط وبهذا الترتيب: "## الملخص التنفيذي"، "## أبرز النقاط"، "## المخاطر"، "## التوصيات". استخدم نقاطاً تحت العناوين الثلاثة الأخيرة. اقتبس الأرقام من الحزمة مع فواصل الآلاف. بين 250 و450 كلمة. بدون جداول.',
};

// ── Routes ───────────────────────────────────────────────────────────────────
function mountAccounting(base, guard) {
  const view = requirePerm('accounting', 'view');
  const edit = requirePerm('accounting', 'edit');
  const exportPerm = requirePerm('accounting', 'export');
  const ai = requirePerm('accounting', 'ai');
  const fail = (res, e, tag) => { console.error(`[accounting${tag ? ':' + tag : ''}]`, e); res.status(500).json({ error: e.message }); };

  receiver.router.get(`${base}/accounting/overview`, guard, view, async (req, res) => {
    try {
      const range = rangeOf(req.query);
      const { pack } = await packFor(range);
      res.json({
        range: { ...range }, base_currency: pack.base_currency, today: pack.today,
        kpis: {
          cash_in: pack.cash.in, cash_out: pack.cash.out, net_cash: pack.cash.net,
          revenue_cash: pack.revenue.cash, revenue_agreed: pack.revenue.agreed,
          receivables_outstanding: pack.receivables.outstanding, receivables_overdue: pack.receivables.overdue,
          landed_costs: pack.cogs.total, expenses: pack.opex.total,
          gross_margin: pack.gross_margin.amount, gross_margin_pct: pack.gross_margin.pct, net_result: pack.net_result,
        },
        cash_by_month: pack.cash.by_month, opex_by_month: pack.opex.by_month,
        top_clients: pack.top_clients, counts: pack.counts, warnings: pack.warnings, ai: geminiConfigured(),
      });
    } catch (e) { fail(res, e, 'overview'); }
  });

  receiver.router.get(`${base}/accounting/receivables`, guard, view, async (req, res) => {
    try {
      const range = rangeOf(req.query);
      const { pack } = await packFor(range);
      res.json({ range: { ...range }, as_of: pack.today, base_currency: pack.base_currency, ...pack.receivables,
        buckets: fin.AGING_BUCKETS, settled: pack.counts.sales_settled, warnings: pack.warnings });
    } catch (e) { fail(res, e, 'receivables'); }
  });

  receiver.router.get(`${base}/accounting/payables`, guard, view, async (req, res) => {
    try {
      const range = rangeOf(req.query);
      const { pack } = await packFor(range);
      res.json({ range: { ...range }, base_currency: pack.base_currency, ...pack.payables, cogs: pack.cogs,
        top_suppliers: pack.top_suppliers, warnings: pack.warnings });
    } catch (e) { fail(res, e, 'payables'); }
  });

  receiver.router.get(`${base}/accounting/expenses`, guard, view, async (req, res) => {
    try {
      const range = rangeOf(req.query);
      const { pack, data } = await packFor(range);
      const cat = String(req.query.category || '');
      const rows = data.expenses.filter(e => fin.inRange(fin.dayOf(e.spent_on), range.from, range.to) && (!cat || e.category === cat));
      res.json({ range: { ...range }, base_currency: pack.base_currency, rows, categories: EXPENSE_CATEGORIES,
        methods: PAYMENT_METHODS, currencies: CURRENCIES, ...pack.opex, warnings: pack.warnings });
    } catch (e) { fail(res, e, 'expenses'); }
  });

  receiver.router.post(`${base}/accounting/expenses`, guard, edit, express.json(), async (req, res) => {
    const { row, error: verr } = fin.expenseBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.recorded_by = ctx.callerIdentity(req).key;
    const { data, error } = await supabase.from('expenses').insert(row).select().single();
    if (error) return acctDbFail(res, error, 'The expenses ledger');
    invalidate();
    res.json(data);
  });

  receiver.router.put(`${base}/accounting/expenses/:id`, guard, edit, express.json(), async (req, res) => {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: 'Bad expense id' });
    const { row, error: verr } = fin.expenseBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('expenses').update(row).eq('id', id).select().single();
    if (error) return acctDbFail(res, error, 'The expenses ledger');
    invalidate();
    res.json(data);
  });

  receiver.router.delete(`${base}/accounting/expenses/:id`, guard, edit, async (req, res) => {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: 'Bad expense id' });
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) return acctDbFail(res, error, 'The expenses ledger');
    invalidate();
    res.json({ ok: true });
  });

  // The whole ledger, newest first, with the sale it belongs to named. This is
  // the page the payments module said "a receivables report will read".
  receiver.router.get(`${base}/accounting/ledger`, guard, view, async (req, res) => {
    try {
      const range = rangeOf(req.query);
      const { data } = await packFor(range);
      const dir = String(req.query.direction || '');
      const kind = String(req.query.kind || '');
      const saleById = new Map(data.sales.map(s => [String(s.id), s]));
      const rows = data.payments
        .filter(p => fin.inRange(fin.dayOf(p.paid_on), range.from, range.to)
          && (!PAYMENT_DIRECTIONS.includes(dir) || p.direction === dir) && (!kind || p.kind === kind))
        .slice(0, 2000)
        .map(p => {
          const s = saleById.get(String(p.sale_id));
          return { ...p, amount_base: fin.round2(fin.num(p.amount_base) || fin.num(p.amount) * (fin.num(p.fx_rate) || 1)),
            client: s ? String(s.client || '') : (p.customer_id ? 'Customer #' + p.customer_id : ''),
            vehicle: s ? [s.brand, s.model].filter(Boolean).join(' ') : '' };
        });
      res.json({ range: { ...range }, base_currency: BASE_CURRENCY, rows, kinds: PAYMENT_KINDS,
        totals: { in: fin.round2(rows.filter(r => r.direction === 'in').reduce((t, r) => t + r.amount_base, 0)),
          out: fin.round2(rows.filter(r => r.direction === 'out').reduce((t, r) => t + r.amount_base, 0)) },
        warnings: data.warnings });
    } catch (e) { fail(res, e, 'ledger'); }
  });

  receiver.router.get(`${base}/accounting/pack`, guard, view, async (req, res) => {
    try { res.json((await packFor(rangeOf(req.query))).pack); } catch (e) { fail(res, e, 'pack'); }
  });

  // Named export.csv so the smoke run leaves it alone (it skips /export paths).
  receiver.router.get(`${base}/accounting/export.csv`, guard, exportPerm, async (req, res) => {
    try {
      const range = rangeOf(req.query);
      const { pack, data } = await packFor(range);
      const which = String(req.query.report || 'ledger');
      let rows = [], cols = null;
      if (which === 'ledger') {
        const saleById = new Map(data.sales.map(s => [String(s.id), s]));
        rows = data.payments.filter(p => fin.inRange(fin.dayOf(p.paid_on), range.from, range.to)).map(p => ({
          paid_on: p.paid_on, direction: p.direction, kind: p.kind, method: p.method, amount: p.amount, currency: p.currency,
          fx_rate: p.fx_rate, amount_base: p.amount_base, client: (saleById.get(String(p.sale_id)) || {}).client || '',
          sale_id: p.sale_id || '', reference: p.reference || '', notes: p.notes || '', recorded_by: p.recorded_by || '' }));
        cols = ['paid_on', 'direction', 'kind', 'method', 'amount', 'currency', 'fx_rate', 'amount_base', 'client', 'sale_id', 'reference', 'notes', 'recorded_by'];
      } else if (which === 'expenses') {
        rows = data.expenses.filter(e => fin.inRange(fin.dayOf(e.spent_on), range.from, range.to)).map(e => ({
          spent_on: e.spent_on, category: e.category, description: e.description || '', vendor: e.vendor || '', amount: e.amount,
          currency: e.currency, fx_rate: e.fx_rate, amount_base: e.amount_base, method: e.method || '', reference: e.reference || '', notes: e.notes || '' }));
        cols = ['spent_on', 'category', 'description', 'vendor', 'amount', 'currency', 'fx_rate', 'amount_base', 'method', 'reference', 'notes'];
      } else if (which === 'receivables') {
        rows = pack.receivables.rows;
        cols = ['sale_id', 'client', 'vehicle', 'vin', 'agreed_price', 'received', 'refunded', 'outstanding', 'due', 'days_overdue', 'bucket', 'last_payment_on', 'legacy'];
      } else if (which === 'cash_by_month') { rows = pack.cash.by_month; cols = ['month', 'in', 'out', 'net']; }
      else if (which === 'opex') { rows = pack.opex.by_category; cols = ['category', 'label', 'count', 'amount']; }
      else if (which === 'summary' || which === 'pack') {
        rows = [
          { metric: 'Period', value: `${range.from} → ${range.to}` },
          { metric: 'Cash in (EGP)', value: pack.cash.in }, { metric: 'Cash out (EGP)', value: pack.cash.out }, { metric: 'Net cash (EGP)', value: pack.cash.net },
          { metric: 'Revenue, cash basis (EGP)', value: pack.revenue.cash }, { metric: 'Revenue, agreed (EGP)', value: pack.revenue.agreed },
          { metric: 'Cost of vehicles (EGP)', value: pack.cogs.total }, { metric: 'Gross margin (EGP)', value: pack.gross_margin.amount },
          { metric: 'Gross margin (%)', value: pack.gross_margin.pct }, { metric: 'Operating expenses (EGP)', value: pack.opex.total },
          { metric: 'Net result (EGP)', value: pack.net_result }, { metric: 'Receivables outstanding (EGP)', value: pack.receivables.outstanding },
          { metric: 'Receivables overdue (EGP)', value: pack.receivables.overdue },
        ];
        cols = ['metric', 'value'];
      } else return res.status(400).json({ error: 'Unknown report' });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="motolinker-accounting-${which}-${range.from}_${range.to}.csv"`);
      res.send(csvSerialize(rows, cols));
    } catch (e) { fail(res, e, 'csv'); }
  });

  // ── Saved reports ──
  receiver.router.get(`${base}/accounting/reports`, guard, view, async (_req, res) => {
    const { data, error } = await supabase.from('accounting_reports')
      .select('id,period_from,period_to,period_label,lang,model,created_by,created_at,narrative')
      .order('created_at', { ascending: false }).limit(100);
    if (error) return acctDbFail(res, error, 'Saved reports');
    res.json((data || []).map(r => ({ ...r, narrative: undefined, summary: String(r.narrative || '').replace(/^#+\s.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 180) })));
  });

  receiver.router.get(`${base}/accounting/reports/:id`, guard, view, async (req, res) => {
    const id = Number(req.params.id);
    if (!(id > 0)) return res.status(400).json({ error: 'Bad report id' });
    const { data, error } = await supabase.from('accounting_reports').select('*').eq('id', id).single();
    if (error || !data) return error ? acctDbFail(res, error, 'Saved reports') : res.status(404).json({ error: 'Report not found' });
    res.json(data);
  });

  // Generate: the pack is computed and saved whatever happens; the narrative is
  // the AI's and is empty when there is no key, so a report always exists.
  receiver.router.post(`${base}/accounting/reports`, guard, ai, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      const range = rangeOf({ period: b.period, from: b.from, to: b.to });
      const lang = (b.lang === 'ar') ? 'ar' : 'en';
      const { pack, data } = await packFor(range);
      let narrative = '', model = '', aiResult = null;
      if (geminiConfigured()) {
        aiResult = await converse({
          systemText: acctSystemPrompt(lang, fin.trimPack(pack), 'reports', REPORT_TASK[lang]),
          history: [], message: lang === 'ar' ? 'اكتب التقرير.' : 'Write the report.', data, pack,
          generationConfig: { temperature: 0.3, maxOutputTokens: 2500 },
        });
        if (aiResult.ok) { narrative = aiResult.text; model = aiResult.model; }
      }
      const row = { period_from: range.from, period_to: range.to, period_label: range.label, lang, pack, narrative, model,
        created_by: ctx.callerIdentity(req).key };
      const { data: saved, error } = await supabase.from('accounting_reports').insert(row).select().single();
      if (error) return acctDbFail(res, error, 'Saved reports');
      const out = { ai: geminiConfigured(), ok: true, row: saved };
      if (aiResult && !aiResult.ok) { out.ok = false; out.error = aiResult.error; out.status = aiResult.status; if (aiResult.status === 429) out.busy = BUSY[lang]; }
      res.json(out);
    } catch (e) { fail(res, e, 'report'); }
  });

  receiver.router.post(`${base}/accounting/reports/:id/pdf`, guard, exportPerm, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!(id > 0)) return res.status(400).json({ error: 'Bad report id' });
      const { data: row, error } = await supabase.from('accounting_reports').select('*').eq('id', id).single();
      if (error || !row) return res.status(404).json({ error: 'Report not found' });
      const pdf = await renderQuotationPdf(fin.buildFinanceReportHtml(row, { logoUrl: BRAND_LOGO_URL }));
      res.json({ pdf: Buffer.from(pdf).toString('base64'), name: `finance-report-${row.period_from}_${row.period_to}` });
    } catch (e) { fail(res, e, 'report-pdf'); }
  });

  // Deleting a report is the admin's alone — it is the record of what the
  // numbers were on the day.
  if (base === '/api/dashboard') {
    receiver.router.delete(`${base}/accounting/reports/:id`, guard, async (req, res) => {
      const id = Number(req.params.id);
      if (!(id > 0)) return res.status(400).json({ error: 'Bad report id' });
      const { error } = await supabase.from('accounting_reports').delete().eq('id', id);
      if (error) return acctDbFail(res, error, 'Saved reports');
      res.json({ ok: true });
    });
  }

  // ── The finance AI ──
  receiver.router.get(`${base}/accounting/ai/status`, guard, view, (_req, res) => {
    if (!geminiConfigured()) return res.json({ ai: false, ok: false });
    res.json({ ai: true, ...geminiState() });
  });

  receiver.router.post(`${base}/accounting/ai/insights`, guard, ai, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      const tab = INSIGHT_TASKS[b.tab] ? b.tab : 'overview';
      if (!geminiConfigured()) return res.json({ ai: false, tab });
      const lang = langOf(b.lang, '') || 'en';
      res.json(await insightsFor(tab, rangeOf(b), lang, b.refresh === true));
    } catch (e) { fail(res, e, 'insights'); }
  });

  receiver.router.post(`${base}/accounting/ai/chat`, guard, ai, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      const message = String(b.message || '').slice(0, 4000);
      if (!message.trim()) return res.status(400).json({ error: 'message required' });
      if (!geminiConfigured()) return res.json({ ai: false });
      const lang = langOf(b.lang, message);
      const range = rangeOf(b);
      const { pack, data } = await packFor(range);
      const task = 'Answer the question in short paragraphs or numbered steps, under 200 words unless asked for detail. No markdown tables.';
      const out = await converse({
        systemText: acctSystemPrompt(lang, fin.trimPack(pack), String(b.tab || ''), task),
        history: b.history, message, data, pack,
      });
      if (!out.ok) {
        if (out.noKey) return res.json({ ai: false });
        return res.json({ ai: true, ok: false, error: out.error, status: out.status, busy: out.status === 429 ? BUSY[lang] : undefined });
      }
      res.json({ ai: true, ok: true, answer: out.text, model: out.model, tool_calls: out.tool_calls, lang });
    } catch (e) { fail(res, e, 'chat'); }
  });
}
mountAccounting('/api/dashboard', requireAuth);
mountAccounting('/api/employee', requireEmployeeAuth);

module.exports = { mountAccounting };
