// The assistant on every page.
//
// One drawer and one insight card, whichever section is open. The server side
// is this file: it loads the section's rows under the caller's own permissions
// and data scope, turns them into a pack of figures (src/lib/sections.js —
// deterministic code), hands the pack to the model, and lets the model call
// back into three tools: section_query (rows and figures beyond the pack),
// calculate (exact arithmetic) and propose_action (an action for the PERSON to
// confirm — nothing is written until they press Confirm, and the confirmed
// action then runs through the same checks and the same side effects as the
// manual path: permission, scope, activity log, notification, automations).
//
// The Accounting page keeps its own finance assistant; chat for that section
// is delegated to it (ctx.accountingChat) so the drawer is one drawer.
//
// src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } =
  ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
// Registered on the context by modules that load before this one (employee
// portal, automation, notifications, columns, reports) — resolved when called.
const requirePerm = (...a) => ctx.requirePerm(...a);
const empCan = (...a) => ctx.empCan(...a);
const empHasScope = (...a) => ctx.empHasScope(...a);
const scopedQuotedIds = (...a) => ctx.scopedQuotedIds(...a);
const customerInScope = (...a) => ctx.customerInScope(...a);
const dealInScope = (...a) => ctx.dealInScope(...a);
const fetchEmployeeTasks = (...a) => ctx.fetchEmployeeTasks(...a);
const logLeadActivity = (...a) => ctx.logLeadActivity(...a);
const createNotification = (...a) => ctx.createNotification(...a);
const notifyEmployeeTaskAssigned = (...a) => ctx.notifyEmployeeTaskAssigned(...a);
const syncTaskToCalendar = (...a) => ctx.syncTaskToCalendar(...a);
const runAutomations = (...a) => ctx.runAutomations(...a);
const taskCtx = (...a) => ctx.taskCtx(...a);
const leadCtx = (...a) => ctx.leadCtx(...a);
const dealCtx = (...a) => ctx.dealCtx(...a);
const columnOptionKeys = (...a) => ctx.columnOptionKeys(...a);

const { LEADS_ENUM_DEFAULTS } = require('../lib/constants');
const S = require('../lib/sections');
const fin = require('../lib/finance');
const { aiCall, aiConverse, aiConfigured, aiState, detectLang, parseAiJson } = require('../lib/llm');

const today = () => new Date().toISOString().slice(0, 10);
const dayShift = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const BUSY = {
  en: 'The assistant is busy right now — please try again in a few seconds.',
  ar: 'المساعد مشغول حالياً — من فضلك حاول مرة أخرى بعد بضع ثوانٍ.',
};
const langOf = (v, text) => (v === 'ar' || v === 'en') ? v : detectLang(text || '');
const ACCOUNTING_CHIPS = { en: ['Summarise this month', 'Who should we chase first?', 'Forecast next month\'s cash'], ar: ['لخّص هذا الشهر', 'بمن نبدأ التحصيل؟'] };

// ── Who may use which section ────────────────────────────────────────────────
function allowed(section, emp) {
  const s = S.SECTIONS[section];
  if (!s) return false;
  if (s.admin) return !emp;
  if (!emp || !s.gate) return true;
  return empCan(emp, s.gate.section, s.gate.action);
}
function resolveSection(raw, emp) {
  const wanted = S.sectionForPage(raw);
  if (wanted === 'accounting') return (!emp || empCan(emp, 'accounting', 'ai')) ? 'accounting' : 'home';
  return allowed(wanted, emp) ? wanted : 'home';
}
function canAct(emp) { return !emp || empCan(emp, 'assistant', 'act'); }

// ── Loading a section's rows, scoped ─────────────────────────────────────────
async function safeSelect(run, label, warnings) {
  try {
    const { data, error } = await run();
    if (error) { warnings.push(`${label}: ${error.message || 'query failed'}`); return []; }
    return data || [];
  } catch (e) { warnings.push(`${label}: ${e.message}`); return []; }
}
async function scopeLeads(rows, emp) {
  if (!emp) return rows;
  const set = empHasScope(emp) ? await scopedQuotedIds(emp) : null;
  return rows.filter(c => customerInScope(c, emp, set));
}
const CUSTOMER_COLS = 'id,name,phone,email,source,lead_status,car_in_question,budget_lead,budget_max,next_action,been_contacted,assigned_to,lead_date,created_at';
async function loadSection(section, emp) {
  const warnings = [];
  const sel = (run, label) => safeSelect(run, label, warnings);
  const t = today();
  const employees = await sel(() => supabase.from('employees').select('id,name,username,job_title').limit(500), 'employees');
  const out = { employees, warnings };
  switch (section) {
    case 'leads': {
      const customers = await scopeLeads(await sel(() => supabase.from('customers').select(CUSTOMER_COLS).order('created_at', { ascending: false }).limit(2000), 'leads'), emp);
      const ids = new Set(customers.map(c => String(c.id)));
      const since = dayShift(t, -60) + 'T00:00:00Z';
      const activities = await sel(() => supabase.from('lead_activities').select('customer_id,type,body,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(3000), 'lead activity');
      const followups = await sel(() => supabase.from('lead_followups').select('id,customer_id,due_at,note,assigned_to,status').eq('status', 'pending').order('due_at', { ascending: true }).limit(1000), 'follow-ups');
      return { ...out, customers, activities: activities.filter(a => ids.has(String(a.customer_id))), followups: followups.filter(f => ids.has(String(f.customer_id))) };
    }
    case 'deals': {
      let deals = await sel(() => supabase.from('deals').select('*, customers(name,phone,lead_status,assigned_to,car_in_question,budget_lead)').order('created_at', { ascending: false }).limit(2000), 'deals');
      if (emp) deals = deals.filter(d => dealInScope(d, emp));
      const sales = (!emp || empCan(emp, 'deals', 'sales'))
        ? await sel(() => supabase.from('sales').select('id,client,brand,model,status,price_list,discounted,down_payment,remaining,remaining_due,delivery_date').order('created_at', { ascending: false }).limit(500), 'sales') : [];
      let stageProb = null;
      try { const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'stage_probabilities').single(); if (data && data.value) stageProb = JSON.parse(data.value); } catch (_) {}
      return { ...out, deals, sales, stageProb };
    }
    case 'quotation': return { ...out, quotations: await sel(() => supabase.from('quotations').select('id,quote_id,title,data,customer_id,deal_id,created_by,created_at').order('created_at', { ascending: false }).limit(300), 'quotations') };
    case 'contracts': return { ...out, contracts: await sel(() => supabase.from('contracts').select('id,contract_no,title,status,customer_id,deal_id,created_by,created_at').order('created_at', { ascending: false }).limit(300), 'contracts') };
    case 'rfq': return { ...out, rfqs: await sel(() => supabase.from('rfqs').select('id,rfq_no,title,supplier_id,supplier_name,status,rfq_date,items,customer_id,created_at').order('created_at', { ascending: false }).limit(300), 'RFQs') };
    case 'purchaseorders': return { ...out, purchase_orders: await sel(() => supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(500), 'purchase orders') };
    case 'suppliers': return { ...out,
      suppliers: await sel(() => supabase.from('suppliers').select('*').limit(500), 'suppliers'),
      supplier_vehicles: await sel(() => supabase.from('supplier_vehicles').select('*').limit(1000), 'catalogue'),
      purchase_orders: await sel(() => supabase.from('purchase_orders').select('id,po_number,supplier,supplier_id,status,currency,po_date,created_at,items').limit(500), 'purchase orders') };
    case 'stock': {
      const stock_vehicles = await sel(() => supabase.from('stock_vehicles').select('id,make,model,trim,price,units').limit(500), 'stock');
      let containers = [];
      if (!emp || empCan(emp, 'stock', 'tracking')) {
        containers = await sel(() => supabase.from('shipment_containers').select('id,container_no,status,carrier,vessel_name,latest_move,pod_eta,eta,pol_name,pod_name,supplier').order('created_at', { ascending: false }).limit(300), 'containers');
        const links = await sel(() => supabase.from('container_vehicles').select('container_id,vin').limit(2000), 'container vehicles');
        for (const c of containers) c.units = links.filter(l => String(l.container_id) === String(c.id)).map(l => ({ vin: l.vin }));
      }
      return { ...out, stock_vehicles, containers };
    }
    case 'submissions': return { ...out, submissions: await sel(() => supabase.from('form_submissions').select('*').order('created_at', { ascending: false }).limit(300), 'submissions') };
    case 'tasks': return { ...out, tasks: emp ? await fetchEmployeeTasks(emp.id).catch(e => { warnings.push('tasks: ' + e.message); return []; })
      : await sel(() => supabase.from('tasks').select('*').order('due_date', { ascending: true }).limit(2000), 'tasks') };
    case 'hours': return { ...out, hours: emp
      ? await sel(() => supabase.from('hours_logs').select('id,hours,log_date,logged_at,employee_id,task_description,description').eq('employee_id', emp.id).order('log_date', { ascending: false }).limit(500), 'hours')
      : await sel(() => supabase.from('hours_logs').select('id,hours,log_date,logged_at,employee_id,task_description,description').gte('log_date', dayShift(t, -90)).order('log_date', { ascending: false }).limit(2000), 'hours') };
    case 'requests': {
      let requests;
      if (!emp || empCan(emp, 'requests', 'viewAll')) requests = await sel(() => supabase.from('requests').select('*').order('created_at', { ascending: false }).limit(500), 'requests');
      else {
        const mine = await sel(() => supabase.from('requests').select('*').eq('created_by', emp.username).limit(300), 'requests');
        const assigned = await sel(() => supabase.from('requests').select('*').eq('assignee_id', emp.id).limit(300), 'requests');
        const seen = new Set();
        requests = [...mine, ...assigned].filter(r => !seen.has(r.id) && seen.add(r.id));
      }
      return { ...out, requests };
    }
    case 'meet': return { ...out, meetings: await sel(() => supabase.from('meetings').select('*').gte('starts_at', dayShift(t, -1) + 'T00:00:00Z').order('starts_at', { ascending: true }).limit(200), 'meetings') };
    case 'issues': return { ...out, issues: await sel(() => supabase.from('issues').select('id,title,status,reporter_name,created_at,resolved_at').order('created_at', { ascending: false }).limit(300), 'issues') };
    case 'employees': return { ...out,
      tasks: await sel(() => supabase.from('tasks').select('id,title,status,priority,due_date,assignee_id,assignee_ids').neq('status', 'done').limit(2000), 'tasks'),
      hours: await sel(() => supabase.from('hours_logs').select('hours,log_date,logged_at,employee_id').gte('log_date', dayShift(t, -7)).limit(2000), 'hours'),
      customers: await sel(() => supabase.from('customers').select('id,assigned_to,lead_status').limit(2000), 'leads') };
    case 'automations': return { ...out,
      rules: await sel(() => supabase.from('automation_rules').select('*').limit(200), 'automation rules'),
      runs: await sel(() => supabase.from('automation_runs').select('*').gte('created_at', dayShift(t, -7) + 'T00:00:00Z').limit(2000), 'automation runs') };
    case 'home': default: {
      const tasks = emp ? await fetchEmployeeTasks(emp.id).catch(() => []) : await sel(() => supabase.from('tasks').select('id,title,status,priority,due_date,assignee_id,assignee_ids').neq('status', 'done').limit(1000), 'tasks');
      const customers = (!emp || empCan(emp, 'leads', 'view')) ? await scopeLeads(await sel(() => supabase.from('customers').select('id,name,lead_status,assigned_to,created_at').order('created_at', { ascending: false }).limit(2000), 'leads'), emp) : [];
      const ids = new Set(customers.map(c => String(c.id)));
      let followups = (!emp || empCan(emp, 'leads', 'view')) ? await sel(() => supabase.from('lead_followups').select('id,customer_id,due_at,note,assigned_to,status').eq('status', 'pending').order('due_at', { ascending: true }).limit(500), 'follow-ups') : [];
      followups = followups.filter(f => ids.has(String(f.customer_id)) && (!emp || !empHasScope(emp) || String(f.assigned_to) === String(emp.id) || f.assigned_to == null));
      let deals = (!emp || empCan(emp, 'deals', 'view')) ? await sel(() => supabase.from('deals').select('id,stage,budget_egp,assigned_to,customer_id,customers(assigned_to,lead_status)').limit(2000), 'deals') : [];
      if (emp) deals = deals.filter(d => dealInScope(d, emp));
      const requests = (!emp || empCan(emp, 'requests', 'viewAll')) ? await sel(() => supabase.from('requests').select('id,status').in('status', ['pending', 'in_review']).limit(500), 'requests')
        : (emp && empCan(emp, 'requests', 'view') ? await sel(() => supabase.from('requests').select('id,status').eq('created_by', emp.username).in('status', ['pending', 'in_review']).limit(200), 'requests') : []);
      const meetings = (!emp || empCan(emp, 'meet', 'view')) ? await sel(() => supabase.from('meetings').select('id,title,starts_at,attendee_ids,created_by').gte('starts_at', t + 'T00:00:00Z').lte('starts_at', t + 'T23:59:59Z').limit(50), 'meetings') : [];
      return { ...out, tasks, customers, followups, deals, requests, meetings };
    }
  }
}

// One pack per section per person, for sixty seconds — the card and the drawer
// on the same page must not scan the same tables twice.
const _packCache = new Map();
const PACK_TTL = 60 * 1000;
async function packFor(section, req) {
  const emp = req.employee || null;
  const key = `${section}|${ctx.callerIdentity(req).key}`;
  const hit = _packCache.get(key);
  if (hit && Date.now() - hit.at < PACK_TTL) return hit;
  const data = await loadSection(section, emp);
  const pack = S.buildPack(section, data, { today: today() });
  pack.warnings = data.warnings;
  const entry = { at: Date.now(), pack, data };
  _packCache.set(key, entry);
  if (_packCache.size > 400) _packCache.delete(_packCache.keys().next().value);
  return entry;
}
function invalidate() { _packCache.clear(); _aiCache.clear(); }

// ── The model ────────────────────────────────────────────────────────────────
function whoIs(req) {
  const e = req.employee;
  return e ? `${e.name || e.username} (${e.job_title || 'team member'}, employee id ${e.id})` : 'the admin';
}
function systemPrompt({ lang, section, pack, who, act, task }) {
  const s = S.SECTIONS[section] || {};
  const L = lang === 'ar' ? 'Arabic — clear Modern Standard Arabic, Western digits for numbers' : 'English';
  return [
    `You are the MotoLinker assistant, open on the "${s.label || section}" section of a car importer's CRM/ERP (leads, deals, quotations, contracts, RFQs, purchase orders, suppliers, inventory and container tracking, tasks, hours, requests, meetings, issues). The company buys cars in USD and sells in EGP.`,
    `Today is ${pack.today}. The person is ${who}. The figures below cover only what this person is allowed to see.`,
    'SOURCE OF TRUTH: the SECTION PACK (JSON) below and your tool results. Never invent a name, number, date or id. If something is not in the pack, look it up with section_query; if it is still not there, say so plainly.',
    'ARITHMETIC: use the calculate tool for every computation and show the key working in one short line. Thousands separators; name the currency.',
    act ? `ACTIONS: you may PROPOSE these with propose_action: ${(s.actions || []).join(', ')}. A proposal is not an execution — the person confirms it with a button. Never say an action was done; say you have proposed it and what it will do. Use only ids that appear in the pack or in a query result. Propose when the person asks for something to be done or clearly wants it, one proposal per thing.`
      : 'ACTIONS: you cannot take actions for this person; suggest what they could do themselves in the app.',
    'DRAFTS: when asked for a message (WhatsApp, email, reminder), write it ready to send — short, polite, in the language asked for, with the real names and figures from the pack.',
    pack.definitions ? 'DEFINITIONS: ' + pack.definitions.join(' | ') : '',
    `LANGUAGE: answer in ${L}.`,
    'STYLE: short paragraphs or numbered steps, no markdown tables, under 200 words unless asked for detail. This system and the work in it only; not tax or legal advice.',
    task ? 'TASK: ' + task : '',
    '',
    'SECTION PACK:',
    JSON.stringify(pack),
  ].filter(Boolean).join('\n');
}
function toolsFor(section, act) {
  const s = S.SECTIONS[section];
  const decl = [
    {
      name: 'section_query',
      description: 'Look up rows or figures in this section beyond what the pack shows. Free text goes in q; filters are optional.',
      parameters: { type: 'OBJECT', properties: {
        query: { type: 'STRING', enum: Object.keys(s.queries) },
        q: { type: 'STRING', description: 'text to match: a name, phone, title, model, VIN or number' },
        status: { type: 'STRING' }, stage: { type: 'STRING' }, when: { type: 'STRING', enum: ['overdue', 'today', 'week', 'all'] },
        days: { type: 'INTEGER' }, from: { type: 'STRING', description: 'YYYY-MM-DD' }, to: { type: 'STRING', description: 'YYYY-MM-DD' },
        customer_id: { type: 'INTEGER' }, po_number: { type: 'STRING' }, supplier: { type: 'STRING' }, model: { type: 'STRING' }, brand: { type: 'STRING' },
        vin: { type: 'STRING' }, container_no: { type: 'STRING' }, name: { type: 'STRING' }, employee: { type: 'STRING' }, assignee: { type: 'STRING' },
        priority: { type: 'STRING' }, category: { type: 'STRING' }, due: { type: 'STRING', enum: ['today', 'week'] }, overdue: { type: 'BOOLEAN' },
        active: { type: 'BOOLEAN' }, limit: { type: 'INTEGER', description: '1–50' } }, required: ['query'] },
    },
    {
      name: 'calculate',
      description: 'Exact arithmetic: + - * / ^ ( ), numbers with commas, a trailing % (5% = 0.05), pct(part, whole), round(x, decimals), min, max, sum, avg, abs. Separate arguments with a comma and a space.',
      parameters: { type: 'OBJECT', properties: { expression: { type: 'STRING' } }, required: ['expression'] },
    },
  ];
  if (act && (s.actions || []).length) decl.push({
    name: 'propose_action',
    description: 'Propose one action for the person to confirm. Nothing happens until they press Confirm. Give every field the action needs.',
    parameters: { type: 'OBJECT', properties: {
      type: { type: 'STRING', enum: s.actions },
      customer_id: { type: 'INTEGER', description: 'the lead' }, employee_id: { type: 'INTEGER' },
      title: { type: 'STRING' }, body: { type: 'STRING' }, note: { type: 'STRING' }, status: { type: 'STRING', description: 'a lead status key such as hot, warm, cold' },
      due_at: { type: 'STRING', description: 'YYYY-MM-DD, for a follow-up' }, due_date: { type: 'STRING', description: 'YYYY-MM-DD, for a task' }, days: { type: 'INTEGER', description: 'alternative to a date: days from today' },
      priority: { type: 'STRING', enum: ['low', 'medium', 'high'] }, stage: { type: 'STRING' }, car_model: { type: 'STRING' }, budget_egp: { type: 'NUMBER' },
      to: { type: 'STRING', description: 'me, admin, or an employee id' }, activity_type: { type: 'STRING', enum: ['note', 'call', 'whatsapp', 'meeting'] } }, required: ['type'] },
  });
  return [{ functionDeclarations: decl }];
}
function runTool(section, pack, name, args) {
  const a = args || {};
  if (name === 'calculate') {
    const expression = String(a.expression || '');
    try { return { expression, result: fin.safeCalc(expression) }; } catch (e) { return { expression, error: e.message }; }
  }
  if (name === 'section_query') return S.sectionQuery(section, pack, a.query, a);
  if (name === 'propose_action') {
    const s = S.SECTIONS[section];
    if (!s || !(s.actions || []).includes(a.type)) return { error: `"${a.type}" cannot be proposed from the ${section} section` };
    const v = S.validateAction(a.type, a);
    if (v.error) return { error: v.error };
    return { proposed: true, action: { type: v.type, ...v.args }, label: v.label, description: v.description };
  }
  return { error: 'Unknown tool ' + name };
}

const _aiCache = new Map();
const AI_TTL = 10 * 60 * 1000;
async function insightsFor(section, req, lang, refresh) {
  const key = `${section}|${ctx.callerIdentity(req).key}|${lang}`;
  const hit = _aiCache.get(key);
  if (hit && !refresh && Date.now() - hit.at < AI_TTL) return { ...hit.payload, cached: true };
  const { pack } = await packFor(section, req);
  const res = await aiCall({
    systemText: systemPrompt({ lang, section, pack: S.trimSectionPack(pack), who: whoIs(req), act: false, task: S.SECTIONS[section].task }),
    messages: [{ role: 'user', content: lang === 'ar' ? 'حلّل هذا القسم.' : 'Analyse this section.' }],
    json: true, generationConfig: { temperature: 0.2, maxOutputTokens: 1500 },
  });
  if (!res.ok) return { ai: true, ok: false, error: res.error, status: res.status, busy: res.status === 429 ? BUSY[lang] : undefined };
  const parsed = parseAiJson(res.text);
  if (!parsed || typeof parsed !== 'object') return { ai: true, ok: false, error: 'The model did not return JSON', model: res.model };
  const list = v => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).slice(0, 6) : []);
  const payload = { ai: true, ok: true, model: res.model, provider: res.provider, generated_at: new Date().toISOString(), section, label: S.SECTIONS[section].label, lang,
    insights: { highlights: list(parsed.highlights), risks: list(parsed.risks), suggestions: list(parsed.suggestions) }, extra: {} };
  if (Array.isArray(parsed.call_list)) payload.extra.call_list = parsed.call_list.slice(0, 6).map(x => ({ customer_id: Number(x.customer_id) || null, name: String(x.name || ''), why: String(x.why || '') }));
  _aiCache.set(key, { at: Date.now(), payload });
  if (_aiCache.size > 400) _aiCache.delete(_aiCache.keys().next().value);
  return { ...payload, cached: false };
}

// ── Confirmed actions ────────────────────────────────────────────────────────
// Every case mirrors the manual route for the same thing — same table, same
// side effects — with the real caller as the author.
async function runAction(req, raw) {
  const emp = req.employee || null;
  const v = S.validateAction(raw && raw.type, raw);
  if (v.error) return { status: 400, body: { error: v.error } };
  if (emp && v.perm && !empCan(emp, v.perm.section, v.perm.action)) return { status: 403, body: { error: 'Not permitted' } };
  const who = ctx.callerIdentity(req);
  const author = { authorKey: who.key, authorName: who.name };
  const createdBy = emp ? emp.username : 'dashboard';
  const a = v.args;
  let customer = null;
  if (S.ACTIONS[v.type].needsCustomer) {
    const { data, error } = await supabase.from('customers').select('*').eq('id', a.customer_id).single();
    if (error || !data) return { status: 404, body: { error: 'Lead not found' } };
    if (emp && empHasScope(emp)) {
      const set = await scopedQuotedIds(emp);
      if (!customerInScope(data, emp, set)) return { status: 403, body: { error: 'That lead is outside your scope' } };
    }
    customer = data;
  }
  const done = (message, result) => ({ status: 200, body: { ok: true, type: v.type, message, result } });
  const dbErr = e => ({ status: 500, body: { error: e.message || 'Database error' } });
  switch (v.type) {
    case 'create_followup': {
      const { data, error } = await supabase.from('lead_followups').insert({
        customer_id: a.customer_id, due_at: new Date(a.due_at + 'T09:00:00Z').toISOString(), note: a.note,
        assigned_to: a.assigned_to || (emp ? emp.id : null), created_by: emp ? emp.username : 'admin',
      }).select().single();
      if (error) return dbErr(error);
      logLeadActivity(a.customer_id, { type: 'follow_up', body: `Follow-up scheduled for ${a.due_at}${a.note ? ' — ' + a.note : ''}`, ...author });
      invalidate();
      return done(`Follow-up scheduled for ${customer.name} on ${a.due_at}.`, data);
    }
    case 'create_task': {
      const list = emp ? [String(emp.id)] : [...new Set([...(a.assignee_ids || []), ...(a.assignee_id ? [a.assignee_id] : [])])];
      if (!list.length) return { status: 400, body: { error: 'Say who the task is for (an employee id).' } };
      const { data: task, error } = await supabase.from('tasks').insert({
        title: a.title, description: a.description, channel_id: '', channel_name: '', assignee_id: list[0], assignee_ids: list,
        due_date: a.due_date, priority: a.priority, milestone: '', created_by: createdBy, status: 'todo', attachments: [],
      }).select().single();
      if (error) return dbErr(error);
      if (!emp) { try { notifyEmployeeTaskAssigned(task); } catch (_) {} }
      try { const p = syncTaskToCalendar(task); if (p && p.catch) p.catch(() => {}); } catch (_) {}
      try { runAutomations('task.created', taskCtx(task)); } catch (_) {}
      invalidate();
      return done(`Task "${a.title}" created, due ${a.due_date}.`, task);
    }
    case 'set_lead_status': {
      const allowedKeys = await columnOptionKeys('leads', 'lead_status', LEADS_ENUM_DEFAULTS.status.map(s => s[0]));
      if (!allowedKeys.includes(a.status)) return { status: 400, body: { error: `"${a.status}" is not a lead status. Use one of: ${allowedKeys.join(', ')}` } };
      const from = customer.lead_status || 'cold';
      if (from === a.status) return done(`${customer.name} is already "${a.status}".`, customer);
      const { data, error } = await supabase.from('customers').update({ lead_status: a.status, updated_at: new Date().toISOString() }).eq('id', a.customer_id).select().single();
      if (error) return dbErr(error);
      logLeadActivity(data.id, { type: 'status_change', body: 'Status changed', meta: { from, to: a.status }, ...author });
      // Same rule as the manual edit: a lead turning Hot gets a deal opened.
      if (a.status === 'hot') {
        try {
          const { data: existing } = await supabase.from('deals').select('id').eq('customer_id', data.id).limit(1);
          if (!existing || !existing.length) {
            await supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question || '', budget_egp: data.budget_lead || null, notes: 'Auto-created from Hot lead', created_by: 'system' });
            logLeadActivity(data.id, { type: 'deal', body: 'Deal auto-created from Hot status', authorKey: 'system', authorName: 'System' });
          }
        } catch (e) { console.warn('[assistant] auto-deal failed:', e.message); }
      }
      try { runAutomations('lead.status_changed', { ...leadCtx(data), from, to: a.status }); } catch (_) {}
      invalidate();
      return done(`${customer.name}: ${from} → ${a.status}.`, data);
    }
    case 'log_activity': {
      await logLeadActivity(a.customer_id, { type: a.type, body: a.body, ...author });
      invalidate();
      return done(`${a.type === 'note' ? 'Note' : a.type[0].toUpperCase() + a.type.slice(1)} logged on ${customer.name}.`, { customer_id: a.customer_id, type: a.type });
    }
    case 'assign_lead': {
      const { data: target } = await supabase.from('employees').select('id,name').eq('id', a.employee_id).single();
      if (!target) return { status: 404, body: { error: 'No employee with that id' } };
      const { data, error } = await supabase.from('customers').update({ assigned_to: a.employee_id, updated_at: new Date().toISOString() }).eq('id', a.customer_id).select().single();
      if (error) return dbErr(error);
      logLeadActivity(data.id, { type: 'system', body: `Assigned to ${target.name}`, ...author });
      try { createNotification(`employee_${target.id}`, { type: 'lead', title: 'Lead assigned to you', body: data.name || '', url: '/employee#leads' }, 'always'); } catch (_) {}
      invalidate();
      return done(`${customer.name} assigned to ${target.name}.`, data);
    }
    case 'create_deal': {
      const { data, error } = await supabase.from('deals').insert({
        customer_id: a.customer_id, title: a.title, stage: a.stage, car_model: a.car_model || customer.car_in_question || '',
        budget_egp: a.budget_egp != null ? a.budget_egp : (customer.budget_lead || null), notes: '', assigned_to: emp ? String(emp.id) : '', created_by: createdBy,
      }).select().single();
      if (error) return dbErr(error);
      logLeadActivity(a.customer_id, { type: 'deal', body: `Deal created: ${a.title}`, ...author });
      try { runAutomations('deal.created', dealCtx({ ...data, customers: customer })); } catch (_) {}
      invalidate();
      return done(`Deal "${a.title}" opened for ${customer.name}.`, data);
    }
    case 'notify': {
      let key = a.to === 'me' ? who.key : a.to === 'admin' ? 'admin' : `employee_${a.to}`;
      // A team member can nudge themselves or the admin; only the admin reaches a colleague this way.
      if (emp && key !== who.key && key !== 'admin') return { status: 403, body: { error: 'You can send a note to yourself or to the admin.' } };
      const url = key === 'admin' ? '/dashboard' : '/employee';
      await createNotification(key, { type: 'assistant', title: a.title, body: a.body, url }, 'always');
      return done(`Notification sent to ${key === who.key ? 'you' : key === 'admin' ? 'the admin' : key.replace('employee_', 'employee #')}.`, { to: key });
    }
  }
  return { status: 400, body: { error: 'Unhandled action' } };
}

// ── Routes ───────────────────────────────────────────────────────────────────
function mountAssistant(base, guard) {
  const chat = requirePerm('assistant', 'chat');
  const act = requirePerm('assistant', 'act');
  const fail = (res, e, tag) => { console.error(`[assistant${tag ? ':' + tag : ''}]`, e); res.status(500).json({ error: e.message }); };

  // What this person may ask about: the sections their permissions reach, with
  // the chips the drawer shows and whether actions may be proposed.
  receiver.router.get(`${base}/ai/sections`, guard, chat, (req, res) => {
    const emp = req.employee || null;
    const sections = Object.entries(S.SECTIONS).filter(([k]) => allowed(k, emp))
      .map(([k, s]) => ({ key: k, label: s.label, chips: s.chips, actions: canAct(emp) ? s.actions : [] }));
    if (!emp || empCan(emp, 'accounting', 'ai')) sections.push({ key: 'accounting', label: 'Accounting', chips: ACCOUNTING_CHIPS, actions: [] });
    res.json({ ai: aiConfigured(), act: canAct(emp), sections, pages: S.PAGE_TO_SECTION });
  });

  receiver.router.get(`${base}/ai/status`, guard, chat, (_req, res) => {
    if (!aiConfigured()) return res.json({ ai: false, ok: false });
    res.json({ ai: true, ...aiState() });
  });

  // The pack itself — what the model is told. Handy for checking a figure.
  receiver.router.get(`${base}/ai/context`, guard, chat, async (req, res) => {
    try {
      const section = resolveSection(req.query.section || req.query.page, req.employee || null);
      if (section === 'accounting') return res.json({ section, note: 'The Accounting section carries its own pack under /accounting/pack.' });
      const { pack } = await packFor(section, req);
      res.json(S.trimSectionPack(pack));
    } catch (e) { fail(res, e, 'context'); }
  });

  receiver.router.post(`${base}/ai/insights`, guard, chat, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      const section = resolveSection(b.section || b.page, req.employee || null);
      if (section === 'accounting') return res.json({ ai: aiConfigured(), ok: false, section, note: 'The Accounting page carries its own insight cards.' });
      if (!aiConfigured()) return res.json({ ai: false, section });
      res.json(await insightsFor(section, req, langOf(b.lang, '') || 'en', b.refresh === true));
    } catch (e) { fail(res, e, 'insights'); }
  });

  receiver.router.post(`${base}/ai/chat`, guard, chat, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      const message = String(b.message || '').slice(0, 4000);
      if (!message.trim()) return res.status(400).json({ error: 'message required' });
      const emp = req.employee || null;
      const section = resolveSection(b.section || b.page, emp);
      const lang = langOf(b.lang, message);
      if (!aiConfigured()) return res.json({ ai: false, section });
      if (section === 'accounting') {
        if (typeof ctx.accountingChat !== 'function') return res.json({ ai: true, ok: false, error: 'The finance assistant is not loaded' });
        const out = await ctx.accountingChat({ message, history: b.history, lang, tab: b.tab, period: b.period, from: b.from, to: b.to });
        return res.json({ section, ...out });
      }
      const { pack } = await packFor(section, req);
      const trimmed = S.trimSectionPack(pack);
      const act = canAct(emp);
      const out = await aiConverse({
        systemText: systemPrompt({ lang, section, pack: trimmed, who: whoIs(req), act }),
        history: b.history, message, tools: toolsFor(section, act),
        runTool: (name, args) => runTool(section, pack, name, args),
      });
      if (!out.ok) return res.json({ ai: true, ok: false, section, error: out.error, status: out.status, busy: out.status === 429 ? BUSY[lang] : undefined });
      const proposals = (out.tool_calls || []).filter(c => c.name === 'propose_action' && c.result && c.result.proposed)
        .map(c => ({ action: c.result.action, label: c.result.label, description: c.result.description }));
      res.json({ ai: true, ok: true, section, label: S.SECTIONS[section].label, answer: out.text, model: out.model, provider: out.provider, tool_calls: out.tool_calls, proposals, lang });
    } catch (e) { fail(res, e, 'chat'); }
  });

  // A proposal the person confirmed. Validated again here — the client's copy
  // of it is just a display — then run with the manual path's checks.
  receiver.router.post(`${base}/ai/actions/run`, guard, act, express.json(), async (req, res) => {
    try {
      const b = req.body || {};
      const raw = (b.action && typeof b.action === 'object') ? b.action : b;
      if (!raw || !raw.type) return res.status(400).json({ error: 'action.type required' });
      const out = await runAction(req, raw);
      res.status(out.status).json(out.body);
    } catch (e) { fail(res, e, 'action'); }
  });
}
mountAssistant('/api/dashboard', requireAuth);
mountAssistant('/api/employee', requireEmployeeAuth);

module.exports = { mountAssistant };
