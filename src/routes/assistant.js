// The assistant on every page.
//
// One panel and one insight card, whichever section is open. The server side
// is this file: it loads the section's rows under the caller's own permissions
// and data scope, turns them into a pack of figures (src/lib/sections.js —
// deterministic code), hands the pack to the model, and lets the model call
// back into tools: section_query (rows and figures beyond the pack),
// other_section (another section's figures), lookup (one lead, deal, supplier
// or VIN followed across every section), search_all (anything by name, number
// or VIN), calculate (exact arithmetic) and propose_action (an action for the
// PERSON to confirm — nothing is written until they press Confirm, and the
// confirmed action then runs through the same checks and the same side effects
// as the manual path: permission, scope, activity log, notification,
// automations). The panel also tells the server what is on screen — the open
// record, tab, search and filters — so "this lead" means the one in front of
// the person, and an open lead/deal/supplier/VIN arrives in the prompt in full.
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
const autoCreateContractForWonDeal = (...a) => ctx.autoCreateContractForWonDeal(...a);
const autoCreateSaleForWonDeal = (...a) => ctx.autoCreateSaleForWonDeal(...a);
const requestCtx = (...a) => ctx.requestCtx(...a);
const normalizePhone = (...a) => ctx.normalizePhone(...a);
const paymentBuildRow = (...a) => ctx.paymentBuildRow(...a);
const { normVin } = require('../lib/vehicles');

const { LEADS_ENUM_DEFAULTS, PAYMENT_KIND_KEYS, EXPENSE_CATEGORY_KEYS } = require('../lib/constants');
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

// ── One record, followed across every section ────────────────────────────────
// Each slice loads under its own permission (a slice the person may not see
// arrives empty) and the lead itself under the caller's data scope, so a 360
// never shows more than the pages themselves would.
const may = (emp, section, action) => !emp || empCan(emp, section, action);
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const ilikeSafe = q => String(q || '').replace(/[,()*"\\%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
async function load360Lead(id, emp, opts) {
  if (!may(emp, 'leads', 'view')) return { error: 'You cannot view leads' };
  const { data: customer } = await supabase.from('customers').select('*').eq('id', id).maybeSingle();
  if (!customer) return { error: 'No lead with that id' };
  if (emp && empHasScope(emp)) { const set = await scopedQuotedIds(emp); if (!customerInScope(customer, emp, set)) return { error: 'That lead is outside your scope' }; }
  const compact = !!(opts && opts.compact);
  const warnings = []; const sel = (run, label) => safeSelect(run, label, warnings);
  const employees = await sel(() => supabase.from('employees').select('id,name,username,job_title').limit(500), 'employees');
  const [activities, followups, deals, quotations, contracts, sales, purchase_orders, rfqs, submissions] = await Promise.all([
    sel(() => supabase.from('lead_activities').select('type,body,meta,author_name,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(compact ? 12 : 40), 'activity'),
    sel(() => supabase.from('lead_followups').select('id,due_at,note,status,assigned_to,completed_at').eq('customer_id', id).order('due_at', { ascending: false }).limit(20), 'follow-ups'),
    may(emp, 'deals', 'view') ? sel(() => supabase.from('deals').select('*, customers(assigned_to,lead_status)').eq('customer_id', id).order('created_at', { ascending: false }).limit(20), 'deals') : [],
    may(emp, 'quotation', 'history') ? sel(() => supabase.from('quotations').select('id,quote_id,title,data,created_by,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(10), 'quotations') : [],
    may(emp, 'contracts', 'view') ? sel(() => supabase.from('contracts').select('id,contract_no,title,status,deal_id,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(10), 'contracts') : [],
    may(emp, 'deals', 'sales') ? sel(() => supabase.from('sales').select('id,deal_id,client,brand,model,trim,vin,status,price_list,discounted,down_payment,remaining,remaining_due,delivery_date').eq('customer_id', id).limit(10), 'sales') : [],
    may(emp, 'purchaseorders', 'view') ? sel(() => supabase.from('purchase_orders').select('id,po_number,title,supplier,supplier_id,status,currency,po_date,created_at,items,incoterm,payment_terms').eq('customer_id', id).order('created_at', { ascending: false }).limit(10), 'purchase orders') : [],
    may(emp, 'rfq', 'view') ? sel(() => supabase.from('rfqs').select('id,rfq_no,title,supplier_name,status,rfq_date,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(10), 'RFQs') : [],
    may(emp, 'submissions', 'view') ? sel(() => supabase.from('form_submissions').select('id,car_interest,source,message,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(10), 'submissions') : [],
  ]);
  const scopedDeals = emp ? deals.filter(d => dealInScope(d, emp)) : deals;
  let payments = [];
  if (may(emp, 'deals', 'payments')) {
    const saleIds = sales.map(x => Number(x.id)).filter(Boolean);
    payments = await sel(() => supabase.from('payments').select('id,sale_id,direction,kind,amount,currency,fx_rate,amount_base,paid_on,method,reference')
      .or(`customer_id.eq.${Number(id)}${saleIds.length ? ',sale_id.in.(' + saleIds.join(',') + ')' : ''}`).order('paid_on', { ascending: false }).limit(60), 'payments');
  }
  let tasks = [];
  const nameQ = ilikeSafe(customer.name);
  if (may(emp, 'tasks', 'view') && nameQ.length >= 3) {
    tasks = emp ? (await fetchEmployeeTasks(emp.id).catch(() => [])).filter(x => String(x.title || '').toLowerCase().includes(nameQ.toLowerCase())).slice(0, 10)
      : await sel(() => supabase.from('tasks').select('id,title,status,priority,due_date,assignee_id,assignee_ids,created_at').ilike('title', `%${nameQ}%`).limit(10), 'tasks');
  }
  const view = S.buildLead360({ customer, employees, activities, followups, deals: scopedDeals, quotations, contracts, sales, payments, purchase_orders, rfqs, submissions, tasks }, { today: today() });
  if (warnings.length) view.warnings = warnings;
  return view;
}
async function load360Deal(id, emp, opts) {
  if (!may(emp, 'deals', 'view')) return { error: 'You cannot view deals' };
  const { data: deal } = await supabase.from('deals').select('*, customers(*)').eq('id', id).maybeSingle();
  if (!deal) return { error: 'No deal with that id' };
  if (emp && !dealInScope(deal, emp)) return { error: 'That deal is outside your scope' };
  const compact = !!(opts && opts.compact);
  const cid = Number(deal.customer_id) || 0;
  const warnings = []; const sel = (run, label) => safeSelect(run, label, warnings);
  const employees = await sel(() => supabase.from('employees').select('id,name,username,job_title').limit(500), 'employees');
  const [activities, followups, quotations, contracts, sales, other_deals] = await Promise.all([
    cid ? sel(() => supabase.from('lead_activities').select('type,body,meta,author_name,created_at').eq('customer_id', cid).order('created_at', { ascending: false }).limit(compact ? 10 : 30), 'activity') : [],
    cid ? sel(() => supabase.from('lead_followups').select('id,due_at,note,status,assigned_to').eq('customer_id', cid).eq('status', 'pending').order('due_at', { ascending: true }).limit(10), 'follow-ups') : [],
    (cid && may(emp, 'quotation', 'history')) ? sel(() => supabase.from('quotations').select('id,quote_id,title,data,created_by,created_at').eq('customer_id', cid).order('created_at', { ascending: false }).limit(5), 'quotations') : [],
    may(emp, 'contracts', 'view') ? sel(() => supabase.from('contracts').select('id,contract_no,title,status,deal_id,created_at').or(`deal_id.eq.${Number(id)}${cid ? ',customer_id.eq.' + cid : ''}`).order('created_at', { ascending: false }).limit(5), 'contracts') : [],
    may(emp, 'deals', 'sales') ? sel(() => supabase.from('sales').select('id,deal_id,client,brand,model,trim,vin,status,price_list,discounted,down_payment,remaining,remaining_due,delivery_date').eq('deal_id', id).limit(3), 'sales') : [],
    cid ? sel(() => supabase.from('deals').select('*, customers(assigned_to,lead_status)').eq('customer_id', cid).order('created_at', { ascending: false }).limit(10), 'deals') : [],
  ]);
  let payments = [];
  if (may(emp, 'deals', 'payments') && sales.length) payments = await sel(() => supabase.from('payments').select('id,sale_id,direction,kind,amount,currency,fx_rate,amount_base,paid_on,method,reference').in('sale_id', sales.map(x => x.id)).order('paid_on', { ascending: false }).limit(40), 'payments');
  const view = S.buildDeal360({ deal, customer: deal.customers, employees, activities, followups, quotations, contracts, sales, payments, other_deals: emp ? other_deals.filter(d => dealInScope(d, emp)) : other_deals }, { today: today() });
  if (warnings.length) view.warnings = warnings;
  return view;
}
async function load360Supplier(args, emp) {
  if (!may(emp, 'suppliers', 'view')) return { error: 'You cannot view suppliers' };
  const a = args || {};
  let supplier = null;
  if (num(a.supplier_id) > 0) supplier = (await supabase.from('suppliers').select('*').eq('id', num(a.supplier_id)).maybeSingle()).data;
  else {
    const q = ilikeSafe(a.name || a.q);
    if (!q) return { error: 'Give supplier_id or a name' };
    const { data } = await supabase.from('suppliers').select('*').ilike('name', `%${q}%`).limit(5);
    if (data && data.length === 1) supplier = data[0];
    else if (data && data.length > 1) return { error: 'Several suppliers match — give supplier_id', candidates: data.map(x => ({ supplier_id: x.id, name: x.name, country: x.country })) };
  }
  if (!supplier) return { error: 'No supplier matches' };
  const id = Number(supplier.id), nameQ = ilikeSafe(supplier.name);
  const warnings = []; const sel = (run, label) => safeSelect(run, label, warnings);
  const [purchase_orders, rfqs, supplier_vehicles, docs, stockRows] = await Promise.all([
    may(emp, 'purchaseorders', 'view') ? sel(() => supabase.from('purchase_orders').select('id,po_number,title,supplier,supplier_id,status,currency,po_date,created_at,items,incoterm,payment_terms').or(`supplier_id.eq.${id}${nameQ ? ',supplier.ilike.%' + nameQ + '%' : ''}`).order('created_at', { ascending: false }).limit(30), 'purchase orders') : [],
    may(emp, 'rfq', 'view') ? sel(() => supabase.from('rfqs').select('id,rfq_no,title,status,rfq_date,created_at,items').or(`supplier_id.eq.${id}${nameQ ? ',supplier_name.ilike.%' + nameQ + '%' : ''}`).order('created_at', { ascending: false }).limit(20), 'RFQs') : [],
    may(emp, 'suppliers', 'catalogue') ? sel(() => supabase.from('supplier_vehicles').select('brand,model,trim,model_year,fob_price,currency,lead_time,availability').eq('supplier_id', id).limit(60), 'catalogue') : [],
    may(emp, 'suppliers', 'docs') ? sel(() => supabase.from('supplier_docs').select('id').eq('supplier_id', id).limit(200), 'docs') : [],
    may(emp, 'stock', 'browse') ? sel(() => supabase.from('stock_vehicles').select('id,make,model,trim,units').limit(500), 'stock') : [],
  ]);
  const stock_units = [];
  for (const row of stockRows) for (const u of (Array.isArray(row.units) ? row.units : [])) {
    if ((u.supplier_id && String(u.supplier_id) === String(id)) || (nameQ && String(u.supplier || '').toLowerCase().includes(nameQ.toLowerCase()))) stock_units.push({ ...u, model: [row.make, row.model, row.trim].filter(Boolean).join(' ') });
  }
  let containers = [];
  if (may(emp, 'stock', 'tracking')) {
    const poIds = purchase_orders.map(x => Number(x.id)).filter(Boolean);
    containers = await sel(() => supabase.from('shipment_containers').select('container_no,status,vessel_name,pod_name,pod_eta,eta,latest_move').or(`${nameQ ? 'supplier.ilike.%' + nameQ + '%' : 'id.eq.0'}${poIds.length ? ',po_id.in.(' + poIds.join(',') + ')' : ''}`).order('created_at', { ascending: false }).limit(15), 'containers');
  }
  const view = S.buildSupplier360({ supplier, purchase_orders, rfqs, supplier_vehicles, docs_count: docs.length, stock_units, containers }, { today: today() });
  if (warnings.length) view.warnings = warnings;
  return view;
}
async function load360Vehicle(vinRaw, emp) {
  const v = normVin(vinRaw);
  if (!v || v.length < 5) return { error: 'Give a VIN, or at least its last 5 characters' };
  const warnings = []; const sel = (run, label) => safeSelect(run, label, warnings);
  const hit = (a, b) => normVin(a) === v || (String(normVin(a)).length >= v.length && String(normVin(a)).endsWith(v)) || String(normVin(a)).includes(v);
  let stock = null;
  if (may(emp, 'stock', 'browse')) {
    const rows = await sel(() => supabase.from('stock_vehicles').select('id,make,model,trim,price,units').limit(500), 'stock');
    for (const row of rows) { for (const u of (Array.isArray(row.units) ? row.units : [])) if (u.vin && hit(u.vin)) { stock = { row, unit: u }; break; } if (stock) break; }
  }
  const vin = (stock && normVin(stock.unit.vin)) || v;
  let container = null;
  if (may(emp, 'stock', 'tracking')) {
    const links = await sel(() => supabase.from('container_vehicles').select('container_id,vin').ilike('vin', `%${vin}%`).limit(3), 'container links');
    if (links.length) container = (await supabase.from('shipment_containers').select('container_no,status,carrier,vessel_name,pol_name,pod_name,latest_move,pod_eta,eta').eq('id', links[0].container_id).maybeSingle()).data || null;
  }
  const sales = may(emp, 'deals', 'sales') ? await sel(() => supabase.from('sales').select('id,deal_id,customer_id,client,brand,model,trim,vin,status,price_list,discounted,down_payment,remaining,remaining_due,delivery_date').ilike('vin', `%${vin}%`).limit(3), 'sales') : [];
  const payments = (sales.length && may(emp, 'deals', 'payments')) ? await sel(() => supabase.from('payments').select('id,sale_id,direction,kind,amount,currency,fx_rate,amount_base,paid_on,method,reference').eq('sale_id', sales[0].id).order('paid_on', { ascending: false }).limit(20), 'payments') : [];
  let purchase_order = null;
  if (may(emp, 'purchaseorders', 'view')) {
    const pos = await sel(() => supabase.from('purchase_orders').select('id,po_number,supplier,status,po_date,created_at,items').order('created_at', { ascending: false }).limit(500), 'purchase orders');
    purchase_order = pos.find(po => (Array.isArray(po.items) ? po.items : []).some(it => it && it.vin && hit(it.vin))) || null;
  }
  let customer = null, deal = null;
  const sale = sales[0];
  if (sale && sale.customer_id && may(emp, 'leads', 'view')) {
    const c = (await supabase.from('customers').select('id,name,phone,lead_status,assigned_to').eq('id', sale.customer_id).maybeSingle()).data;
    if (c && (!emp || !empHasScope(emp) || customerInScope(c, emp, await scopedQuotedIds(emp)))) customer = c;
  }
  if (sale && sale.deal_id && may(emp, 'deals', 'view')) {
    const d = (await supabase.from('deals').select('*, customers(assigned_to,lead_status)').eq('id', sale.deal_id).maybeSingle()).data;
    if (d && (!emp || dealInScope(d, emp))) deal = d;
  }
  const employees = await sel(() => supabase.from('employees').select('id,name').limit(500), 'employees');
  const view = S.buildVehicle360({ vin, stock, container, sales, payments, purchase_order, customer, deal, employees }, { today: today() });
  if (!stock && !container && !sales.length && !purchase_order) view.note = 'Nothing in stock, containers, sales or purchase orders carries that VIN.';
  if (warnings.length) view.warnings = warnings;
  return view;
}
// Everything the person may see, searched by name, phone, email, number or VIN.
async function searchAll(qRaw, emp) {
  const q = ilikeSafe(qRaw);
  if (q.length < 2) return { error: 'Give at least two characters to search for' };
  const like = `%${q}%`, warnings = []; const sel = (run, label) => safeSelect(run, label, warnings);
  const d = {};
  const jobs = [];
  if (may(emp, 'leads', 'view')) jobs.push(sel(() => supabase.from('customers').select('id,name,phone,email,lead_status,car_in_question,assigned_to').or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like},car_in_question.ilike.${like}`).limit(20), 'leads').then(rows => scopeLeads(rows, emp)).then(rows => { d.customers = rows; }));
  if (may(emp, 'deals', 'view')) jobs.push(sel(() => supabase.from('deals').select('id,title,stage,budget_egp,customer_id,car_model,assigned_to,customers(assigned_to,lead_status)').or(`title.ilike.${like},car_model.ilike.${like}`).limit(20), 'deals').then(rows => { d.deals = emp ? rows.filter(x => dealInScope(x, emp)) : rows; }));
  if (may(emp, 'quotation', 'history')) jobs.push(sel(() => supabase.from('quotations').select('id,quote_id,title,customer_id,created_at').or(`quote_id.ilike.${like},title.ilike.${like}`).limit(10), 'quotations').then(rows => { d.quotations = rows; }));
  if (may(emp, 'contracts', 'view')) jobs.push(sel(() => supabase.from('contracts').select('id,contract_no,title,status,customer_id').or(`contract_no.ilike.${like},title.ilike.${like}`).limit(10), 'contracts').then(rows => { d.contracts = rows; }));
  if (may(emp, 'rfq', 'view')) jobs.push(sel(() => supabase.from('rfqs').select('id,rfq_no,title,supplier_name,status').or(`rfq_no.ilike.${like},title.ilike.${like},supplier_name.ilike.${like}`).limit(10), 'RFQs').then(rows => { d.rfqs = rows; }));
  if (may(emp, 'purchaseorders', 'view')) jobs.push(sel(() => supabase.from('purchase_orders').select('id,po_number,title,supplier,status').or(`po_number.ilike.${like},title.ilike.${like},supplier.ilike.${like}`).limit(10), 'purchase orders').then(rows => { d.purchase_orders = rows; }));
  if (may(emp, 'suppliers', 'view')) jobs.push(sel(() => supabase.from('suppliers').select('id,name,country').or(`name.ilike.${like},country.ilike.${like}`).limit(10), 'suppliers').then(rows => { d.suppliers = rows; }));
  if (may(emp, 'stock', 'browse')) jobs.push(sel(() => supabase.from('stock_vehicles').select('id,make,model,trim,units').limit(500), 'stock').then(rows => {
    const ql = q.toLowerCase(), vq = normVin(q);
    const units = [];
    for (const row of rows) { const model = [row.make, row.model, row.trim].filter(Boolean).join(' '); const modelHit = model.toLowerCase().includes(ql);
      for (const u of (Array.isArray(row.units) ? row.units : [])) if (modelHit || (vq.length >= 4 && normVin(u.vin).includes(vq)) || String(u.consignee || '').toLowerCase().includes(ql)) units.push({ ...u, model }); }
    d.stock_units = units.slice(0, 30); }));
  if (may(emp, 'stock', 'tracking')) jobs.push(sel(() => supabase.from('shipment_containers').select('container_no,status,pod_eta,eta').ilike('container_no', like).limit(10), 'containers').then(rows => { d.containers = rows; }));
  if (may(emp, 'tasks', 'view')) jobs.push((emp ? fetchEmployeeTasks(emp.id).catch(() => []).then(rows => rows.filter(x => String(x.title || '').toLowerCase().includes(q.toLowerCase())))
    : sel(() => supabase.from('tasks').select('id,title,status,due_date').ilike('title', like).limit(15), 'tasks')).then(rows => { d.tasks = rows; }));
  if (may(emp, 'requests', 'view')) jobs.push(sel(() => supabase.from('requests').select('id,title,status,category,created_by,assignee_id').ilike('title', like).limit(15), 'requests').then(rows => { d.requests = (emp && !empCan(emp, 'requests', 'viewAll')) ? rows.filter(r => r.created_by === emp.username || String(r.assignee_id) === String(emp.id)) : rows; }));
  if (may(emp, 'issues', 'view')) jobs.push(sel(() => supabase.from('issues').select('id,title,status').ilike('title', like).limit(10), 'issues').then(rows => { d.issues = rows; }));
  if (may(emp, 'meet', 'view')) jobs.push(sel(() => supabase.from('meetings').select('id,title,starts_at').ilike('title', like).order('starts_at', { ascending: false }).limit(10), 'meetings').then(rows => { d.meetings = rows; }));
  jobs.push(sel(() => supabase.from('employees').select('id,name,username,job_title').or(`name.ilike.${like},username.ilike.${like}`).limit(10), 'employees').then(rows => { d.employees = rows; }));
  if (may(emp, 'submissions', 'view')) jobs.push(sel(() => supabase.from('form_submissions').select('id,name,phone,email,car_interest,customer_id').or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`).limit(10), 'submissions').then(rows => { d.submissions = rows; }));
  await Promise.all(jobs);
  const out = S.buildSearch(d, q, { today: today() });
  if (warnings.length) out.warnings = warnings;
  return out;
}
async function lookup(args, emp) {
  const a = args || {};
  const kind = String(a.kind || '').toLowerCase();
  if (kind === 'lead') { const id = num(a.customer_id || a.id); return id > 0 ? load360Lead(id, emp) : (a.q || a.name) ? searchAll(a.q || a.name, emp) : { error: 'Give customer_id (find it with search_all)' }; }
  if (kind === 'deal') { const id = num(a.deal_id || a.id); return id > 0 ? load360Deal(id, emp) : { error: 'Give deal_id (find it with search_all)' }; }
  if (kind === 'supplier') return load360Supplier({ supplier_id: a.supplier_id || a.id, name: a.name || a.q }, emp);
  if (kind === 'vehicle' || kind === 'vin' || kind === 'car') return load360Vehicle(a.vin || a.q || a.id, emp);
  return { error: 'kind must be lead, deal, supplier or vehicle' };
}

// ── What is on the person's screen ───────────────────────────────────────────
// The panel sends it with every message: the page, an open record, the tab,
// the search box and the filters. It is sanitised here and turned into a line
// of the prompt, and an open lead/deal/supplier/VIN is fetched in full so
// "summarise this one" needs no tool round.
const SCREEN_KINDS = ['lead', 'deal', 'task', 'supplier', 'purchase_order', 'rfq', 'contract', 'quotation', 'container', 'vehicle', 'stock_model', 'request', 'issue', 'meeting', 'submission', 'expense', 'employee', 'sale', 'automation', 'report'];
const strn = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
function cleanScreen(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = { page: strn(raw.page, 40), tab: strn(raw.tab, 40), search: strn(raw.search, 80), view: strn(raw.view, 40) };
  const r = raw.record;
  if (r && typeof r === 'object' && SCREEN_KINDS.includes(String(r.kind))) s.record = { kind: String(r.kind), id: strn(r.id, 40), title: strn(r.title, 120), sub: strn(r.sub, 120) };
  if (raw.filters && typeof raw.filters === 'object' && !Array.isArray(raw.filters)) {
    s.filters = {};
    for (const [k, v] of Object.entries(raw.filters).slice(0, 10)) { const val = strn(Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object' ? JSON.stringify(v) : v), 60); if (val && val !== 'all' && val !== 'any') s.filters[strn(k, 30)] = val; }
    if (!Object.keys(s.filters).length) delete s.filters;
  }
  if (Array.isArray(raw.selected)) { s.selected = raw.selected.slice(0, 10).map(x => ({ kind: strn(x && x.kind, 20), id: strn(x && x.id, 40), title: strn(x && x.title, 80) })).filter(x => x.id); if (!s.selected.length) delete s.selected; }
  return (s.record || s.search || s.filters || s.tab || s.selected || s.view) ? s : null;
}
const KIND_WORDS = { lead: 'lead', deal: 'deal', task: 'task', supplier: 'supplier', purchase_order: 'purchase order', rfq: 'RFQ', contract: 'contract', quotation: 'quotation', container: 'container', vehicle: 'vehicle (VIN)', stock_model: 'stock model', request: 'request', issue: 'issue', meeting: 'meeting', submission: 'website submission', expense: 'expense', employee: 'employee', sale: 'sale', automation: 'automation rule', report: 'report' };
function describeScreen(sc) {
  if (!sc) return '';
  const bits = [];
  if (sc.record) bits.push(`the ${KIND_WORDS[sc.record.kind] || sc.record.kind} ${sc.record.id ? '#' + sc.record.id + ' ' : ''}${sc.record.title ? '"' + sc.record.title + '"' : ''}${sc.record.sub ? ' (' + sc.record.sub + ')' : ''} is OPEN in front of them — "this", "this one", "here", "it" mean that record`);
  if (sc.tab) bits.push(`tab "${sc.tab}"`);
  if (sc.view) bits.push(`view "${sc.view}"`);
  if (sc.search) bits.push(`the list is filtered by the search "${sc.search}"`);
  if (sc.filters) bits.push('filters ' + Object.entries(sc.filters).map(([k, v]) => `${k}=${v}`).join(', '));
  if (sc.selected) bits.push(`${sc.selected.length} row(s) ticked: ` + sc.selected.map(x => `${x.kind || 'row'} #${x.id}${x.title ? ' ' + x.title : ''}`).join('; '));
  return bits.length ? 'SCREEN: ' + bits.join('; ') + '.' : '';
}
// The open record in full, when it is one the 360 loaders know; otherwise the
// matching row of this section's pack, which is small and already scoped.
async function focusFor(sc, req, pack) {
  const r = sc && sc.record;
  if (!r) return null;
  const emp = req.employee || null;
  try {
    if (r.kind === 'lead' && num(r.id) > 0) return await load360Lead(num(r.id), emp, { compact: true });
    if (r.kind === 'deal' && num(r.id) > 0) return await load360Deal(num(r.id), emp, { compact: true });
    if (r.kind === 'supplier' && num(r.id) > 0) return await load360Supplier({ supplier_id: num(r.id) }, emp);
    if (r.kind === 'vehicle' && r.id) return await load360Vehicle(r.id, emp);
    if (r.kind === 'sale' && num(r.id) > 0 && may(emp, 'deals', 'sales')) {
      const { data: sale } = await supabase.from('sales').select('id,deal_id,customer_id').eq('id', num(r.id)).maybeSingle();
      if (sale && sale.deal_id) return await load360Deal(sale.deal_id, emp, { compact: true });
      if (sale && sale.customer_id) return await load360Lead(sale.customer_id, emp, { compact: true });
    }
  } catch (e) { return { error: e.message }; }
  const rows = [...(pack && Array.isArray(pack._rows) ? pack._rows : []), ...(pack && Array.isArray(pack._containers) ? pack._containers : []), ...(pack && Array.isArray(pack.models) ? pack.models : [])];
  const row = rows.find(x => x && (String(x.id) === r.id || String(x.po_number) === r.id || String(x.rfq_no) === r.id || String(x.contract_no) === r.id || String(x.quote_id) === r.id || String(x.container_no) === r.id));
  return row ? { kind: r.kind, record: row } : null;
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
function rosterOf(employees) {
  const list = (Array.isArray(employees) ? employees : []).slice(0, 40).map(e => `${e.id}: ${e.name || e.username}${e.job_title ? ' — ' + e.job_title : ''}`);
  return list.length ? 'TEAM (employee id: name — title): ' + list.join('; ') + '.' : '';
}
const VOCAB = [
  'lead statuses: cold, warm, hot, immediate_delivery, not_interested, blacklist',
  'deal stages, in order: lead → inquiry → quoted → negotiating → won | lost',
  'a sale is what a won deal becomes; payments (in) and refunds (out) settle it; outstanding = agreed price − paid + refunded',
  'purchase-order line statuses: send_to_supplier → in_preparation → in_logistics → delivered; a container carries VINs from a PO to the port (pod_eta is the arrival date)',
  `payment kinds: ${PAYMENT_KIND_KEYS.join(', ')}`, `expense categories: ${EXPENSE_CATEGORY_KEYS.join(', ')}`,
  'task statuses: todo, in_progress, done; priorities low, medium, high; request statuses pending, in_review, approved, rejected',
].join(' | ');
function systemPrompt({ lang, section, pack, who, act, task, roster, screen, focus }) {
  const s = S.SECTIONS[section] || {};
  const L = lang === 'ar' ? 'Arabic — clear Modern Standard Arabic, Western digits for numbers' : 'English';
  return [
    `You are the MotoLinker assistant, open on the "${s.label || section}" section of a car importer's CRM/ERP (leads, deals, quotations, contracts, RFQs, purchase orders, suppliers, inventory and container tracking, tasks, hours, requests, meetings, issues, accounting). The company buys cars in USD and sells in EGP.`,
    `Today is ${pack.today}. The person is ${who}. The figures below cover only what this person is allowed to see.`,
    'SOURCE OF TRUTH: the SECTION PACK (JSON) below, the FOCUS record if one is given, and your tool results. Never invent a name, number, date or id. If something is not there, fetch it with a tool; if it is still not there, say so plainly.',
    'TOOLS: section_query reads more of THIS section; other_section reads another section\'s figures (its "overview" or one of its queries); lookup follows ONE lead, deal, supplier or VIN across every section (activities, follow-ups, deals, quotes, contracts, sales, payments, POs, RFQs, containers, tasks); search_all finds anything by name, phone, email, number or VIN and returns ids. Chain them: search_all → lookup → answer or propose_action. Prefer a lookup over a guess; one tool call per fact is fine, do not repeat the same call.',
    'ARITHMETIC: use the calculate tool for every computation and show the key working in one short line. Thousands separators; name the currency.',
    'VOCABULARY: ' + VOCAB,
    roster || '',
    describeScreen(screen),
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
    focus ? '' : null,
    focus ? 'FOCUS (the open record, in full):' : null,
    focus ? JSON.stringify(focus) : null,
  ].filter(x => x !== null && x !== '' && x !== undefined).join('\n');
}
const LOOKUP_KINDS = ['lead', 'deal', 'supplier', 'vehicle'];
function otherSections(section, emp) { return Object.keys(S.SECTIONS).filter(k => k !== section && allowed(k, emp)); }
function toolsFor(section, act, emp) {
  const s = S.SECTIONS[section];
  const others = otherSections(section, emp);
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
      name: 'other_section',
      description: `Figures or rows from ANOTHER section of the app (this panel is open on "${s.label}"). query "overview" returns that section's summary; or name one of its queries — ` + others.map(k => `${k}: ${Object.keys(S.SECTIONS[k].queries).join('/')}`).join('; ') + '.',
      parameters: { type: 'OBJECT', properties: {
        section: { type: 'STRING', enum: others.length ? others : ['home'] }, query: { type: 'STRING', description: '"overview" or a query name of that section' },
        q: { type: 'STRING' }, status: { type: 'STRING' }, stage: { type: 'STRING' }, when: { type: 'STRING' }, days: { type: 'INTEGER' }, from: { type: 'STRING' }, to: { type: 'STRING' },
        customer_id: { type: 'INTEGER' }, po_number: { type: 'STRING' }, supplier: { type: 'STRING' }, model: { type: 'STRING' }, vin: { type: 'STRING' }, container_no: { type: 'STRING' }, name: { type: 'STRING' }, employee: { type: 'STRING' }, limit: { type: 'INTEGER' } }, required: ['section', 'query'] },
    },
    {
      name: 'lookup',
      description: 'The full picture of ONE record, followed across every section this person may see, from any page. kind lead (+customer_id): profile, activities, follow-ups, deals, quotations, contracts, sales, payments and outstanding, purchase orders, RFQs, website submissions, tasks, timeline. kind deal (+deal_id): the deal, its lead, stage history, contract, sale, payments. kind supplier (+supplier_id or name): orders, RFQs, catalogue, cars in stock, containers. kind vehicle (+vin): stock unit, container and arrival date, purchase-order line, sale, payments, customer.',
      parameters: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: LOOKUP_KINDS }, customer_id: { type: 'INTEGER' }, deal_id: { type: 'INTEGER' }, supplier_id: { type: 'INTEGER' }, name: { type: 'STRING', description: 'supplier name when the id is unknown' }, vin: { type: 'STRING', description: 'full VIN or its last characters' } }, required: ['kind'] },
    },
    {
      name: 'search_all',
      description: 'Find anything by name, phone, email, document number, model or VIN across leads, deals, quotations, contracts, RFQs, purchase orders, suppliers, stock, containers, tasks, requests, issues, meetings, employees and website submissions — only what this person may see. Returns short hits with ids; follow with lookup for the full picture.',
      parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } }, required: ['q'] },
    },
    {
      name: 'calculate',
      description: 'Exact arithmetic: + - * / ^ ( ), numbers with commas, a trailing % (5% = 0.05), pct(part, whole), round(x, decimals), min, max, sum, avg, abs. Separate arguments with a comma and a space.',
      parameters: { type: 'OBJECT', properties: { expression: { type: 'STRING' } }, required: ['expression'] },
    },
  ];
  if (act && (s.actions || []).length) decl.push({
    name: 'propose_action',
    description: 'Propose one action for the person to confirm. Nothing happens until they press Confirm. Give every field the action needs; use ids from the pack, FOCUS or a tool result. Actions: ' + s.actions.map(a => `${a} (${S.ACTIONS[a].label})`).join(', ') + '.',
    parameters: { type: 'OBJECT', properties: {
      type: { type: 'STRING', enum: s.actions },
      customer_id: { type: 'INTEGER', description: 'the lead' }, deal_id: { type: 'INTEGER' }, task_id: { type: 'INTEGER' }, followup_id: { type: 'INTEGER' }, sale_id: { type: 'INTEGER' }, submission_id: { type: 'INTEGER' }, employee_id: { type: 'INTEGER', description: 'assignee / who' },
      title: { type: 'STRING' }, body: { type: 'STRING', description: 'note, comment, message or description text' }, note: { type: 'STRING' }, description: { type: 'STRING' },
      status: { type: 'STRING', description: 'lead status (hot, warm, cold…), task status (todo, in_progress, done) or follow-up status (done, cancelled)' }, stage: { type: 'STRING', description: 'deal stage' },
      due_at: { type: 'STRING', description: 'YYYY-MM-DD, for a follow-up' }, due_date: { type: 'STRING', description: 'YYYY-MM-DD, for a task' }, days: { type: 'INTEGER', description: 'alternative to a date: days from today' },
      priority: { type: 'STRING', enum: ['low', 'medium', 'high'] }, category: { type: 'STRING', description: 'request category, or expense category' },
      name: { type: 'STRING' }, phone: { type: 'STRING' }, email: { type: 'STRING' }, source: { type: 'STRING' }, car_model: { type: 'STRING' }, next_action: { type: 'STRING' }, been_contacted: { type: 'BOOLEAN' },
      budget_egp: { type: 'NUMBER' }, budget_max: { type: 'NUMBER' }, est_value: { type: 'NUMBER' },
      amount: { type: 'NUMBER' }, currency: { type: 'STRING', description: 'EGP, USD…' }, fx_rate: { type: 'NUMBER', description: 'EGP per 1 unit of a foreign currency' }, kind: { type: 'STRING', description: 'payment kind: ' + PAYMENT_KIND_KEYS.join(', ') }, direction: { type: 'STRING', enum: ['in', 'out'] }, method: { type: 'STRING' }, paid_on: { type: 'STRING', description: 'YYYY-MM-DD' }, spent_on: { type: 'STRING', description: 'YYYY-MM-DD' }, vendor: { type: 'STRING' }, reference: { type: 'STRING' },
      hours: { type: 'NUMBER' }, task_description: { type: 'STRING' }, log_date: { type: 'STRING', description: 'YYYY-MM-DD' },
      to: { type: 'STRING', description: 'me, admin, or an employee id' }, activity_type: { type: 'STRING', enum: ['note', 'call', 'whatsapp', 'meeting'] } }, required: ['type'] },
  });
  return [{ functionDeclarations: decl }];
}
const TOOL_BUDGET = 5000;
async function runTool(section, pack, name, args, req) {
  const a = args || {};
  const emp = (req && req.employee) || null;
  if (name === 'calculate') {
    const expression = String(a.expression || '');
    try { return { expression, result: fin.safeCalc(expression) }; } catch (e) { return { expression, error: e.message }; }
  }
  if (name === 'section_query') return S.capJson(S.sectionQuery(section, pack, a.query, a), TOOL_BUDGET);
  if (name === 'other_section') {
    const other = String(a.section || '').toLowerCase();
    if (!S.SECTIONS[other]) return { error: 'Unknown section. Choose one of: ' + otherSections(section, emp).join(', ') };
    if (!allowed(other, emp)) return { error: `You cannot read the ${other} section` };
    const { pack: p2 } = await packFor(other, req);
    const query = String(a.query || 'overview');
    if (query === 'overview') return S.capJson(S.trimSectionPack(p2), TOOL_BUDGET);
    return S.capJson(S.sectionQuery(other, p2, query, a), TOOL_BUDGET);
  }
  if (name === 'lookup') return S.capJson(await lookup(a, emp), TOOL_BUDGET);
  if (name === 'search_all') return S.capJson(await searchAll(a.q, emp), TOOL_BUDGET);
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
    systemText: systemPrompt({ lang, section, pack: S.capJson(S.trimSectionPack(pack), 20000), who: whoIs(req), act: false, task: S.SECTIONS[section].task }),
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
  const permOk = !emp || !v.perm || empCan(emp, v.perm.section, v.perm.action) || (v.type === 'set_deal_stage' && empCan(emp, 'deals', 'edit'));
  if (!permOk) return { status: 403, body: { error: 'Not permitted' } };
  if (emp && v.type === 'link_submission' && !empCan(emp, 'leads', 'edit')) return { status: 403, body: { error: 'Not permitted' } };
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
    // ── The second wave ──
    case 'edit_lead': {
      // The manual PUT: patch the columns given, keep phone_norm in step, log
      // a contacted flip and run its automation. The status has its own action.
      const patch = { ...a.fields, updated_at: new Date().toISOString() };
      if (patch.phone !== undefined) patch.phone_norm = normalizePhone(patch.phone);
      const wasContacted = customer.been_contacted === true;
      const { data, error } = await supabase.from('customers').update(patch).eq('id', a.customer_id).select().single();
      if (error) return dbErr(error);
      const changed = Object.keys(a.fields).map(k => `${k}: ${typeof a.fields[k] === 'string' ? a.fields[k].slice(0, 60) : a.fields[k]}`).join(', ');
      logLeadActivity(data.id, { type: 'system', body: `Updated via the assistant — ${changed}`, ...author });
      if (!wasContacted && data.been_contacted === true) {
        logLeadActivity(data.id, { type: 'system', body: 'Marked as contacted', ...author });
        try { runAutomations('lead.contacted', leadCtx(data)); } catch (_) {}
      }
      invalidate();
      return done(`${customer.name} updated: ${changed}.`, data);
    }
    case 'complete_followup': {
      const { data: fu } = await supabase.from('lead_followups').select('id,customer_id,status,note,due_at').eq('id', a.followup_id).maybeSingle();
      if (!fu) return { status: 404, body: { error: 'Follow-up not found' } };
      if (emp && empHasScope(emp)) {
        const { data: c } = await supabase.from('customers').select('*').eq('id', fu.customer_id).maybeSingle();
        if (!c || !customerInScope(c, emp, await scopedQuotedIds(emp))) return { status: 403, body: { error: 'That lead is outside your scope' } };
      }
      if (fu.status === a.status) return done(`That follow-up is already ${a.status}.`, fu);
      const { data, error } = await supabase.from('lead_followups').update({ status: a.status, completed_at: a.status === 'done' ? new Date().toISOString() : null }).eq('id', a.followup_id).select().single();
      if (error) return dbErr(error);
      logLeadActivity(fu.customer_id, { type: 'follow_up', body: a.status === 'done' ? 'Follow-up completed' : 'Follow-up cancelled', ...author });
      invalidate();
      return done(`Follow-up ${a.status}${fu.note ? ' — ' + fu.note.slice(0, 60) : ''}.`, data);
    }
    case 'set_deal_stage': {
      // The manual PUT, step for step: closed_at on won/lost, the quoting
      // notification on inquiry, the timeline entry, the automation, and on
      // won the contract draft and the sale.
      const { data: deal } = await supabase.from('deals').select('*, customers(assigned_to,lead_status)').eq('id', a.deal_id).maybeSingle();
      if (!deal) return { status: 404, body: { error: 'Deal not found' } };
      if (emp && !dealInScope(deal, emp)) return { status: 403, body: { error: 'That deal is outside your scope' } };
      const prev = deal.stage;
      if (prev === a.stage) return done(`"${deal.title}" is already at ${a.stage}.`, deal);
      const updates = { stage: a.stage, updated_at: new Date().toISOString() };
      if ((a.stage === 'won' || a.stage === 'lost') && !deal.closed_at) updates.closed_at = new Date().toISOString();
      if (a.stage !== 'won' && a.stage !== 'lost') updates.closed_at = null;
      const { data, error } = await supabase.from('deals').update(updates).eq('id', a.deal_id).select('*, customers(name,phone,email,car_in_question,budget_lead)').single();
      if (error) return dbErr(error);
      if (a.stage === 'inquiry') {
        try {
          const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
          const settings = {}; for (const row of settingsRows || []) settings[row.key] = row.value;
          const notifyId = settings.contact_notify_employee_id;
          if (notifyId) {
            const c = data.customers;
            const body = [`Lead: ${c?.name || data.title}`, c?.phone ? `Phone: ${c.phone}` : '', c?.car_in_question ? `Car: ${c.car_in_question}` : '', c?.budget_lead ? `Budget: ${Number(c.budget_lead).toLocaleString()} EGP` : ''].filter(Boolean).join('\n');
            await createNotification(`employee_${notifyId}`, { type: 'lead', title: 'New lead to quote — ' + (c?.name || data.title), body, url: '/employee#quotation' }, 'always');
          }
        } catch (e) { console.warn('[assistant] notify-contacted failed:', e.message); }
      }
      if (data.customer_id) {
        const stageLabels = { lead: 'Lead', inquiry: 'Inquiry', quoted: 'Quoted', negotiating: 'Negotiating', won: 'Won', lost: 'Lost' };
        logLeadActivity(data.customer_id, { type: 'deal', body: `Deal moved to ${stageLabels[a.stage] || a.stage} — ${data.title}`, meta: { from: prev, to: a.stage }, ...author });
      }
      try { runAutomations('deal.stage_changed', { ...dealCtx(data), from: prev, to: a.stage }); } catch (_) {}
      if (a.stage === 'won') { try { autoCreateContractForWonDeal(data); } catch (_) {} try { autoCreateSaleForWonDeal(data); } catch (_) {} }
      invalidate();
      return done(`"${data.title}": ${prev} → ${a.stage}${a.stage === 'won' ? ' — the contract draft and the sale are being created' : ''}.`, data);
    }
    case 'edit_deal': {
      const { data: deal } = await supabase.from('deals').select('*, customers(assigned_to,lead_status)').eq('id', a.deal_id).maybeSingle();
      if (!deal) return { status: 404, body: { error: 'Deal not found' } };
      if (emp && !dealInScope(deal, emp)) return { status: 403, body: { error: 'That deal is outside your scope' } };
      const { data, error } = await supabase.from('deals').update({ ...a.fields, updated_at: new Date().toISOString() }).eq('id', a.deal_id).select().single();
      if (error) return dbErr(error);
      const changed = Object.keys(a.fields).map(k => `${k}: ${typeof a.fields[k] === 'string' ? a.fields[k].slice(0, 60) : a.fields[k]}`).join(', ');
      if (data.customer_id) logLeadActivity(data.customer_id, { type: 'deal', body: `Deal updated — ${data.title}: ${changed}`, ...author });
      invalidate();
      return done(`"${data.title}" updated: ${changed}.`, data);
    }
    case 'add_deal_note': {
      // Deals keep one notes column; the note is appended there, dated and
      // signed, and echoed on the lead's timeline where the team reads it.
      const { data: deal } = await supabase.from('deals').select('*, customers(assigned_to,lead_status)').eq('id', a.deal_id).maybeSingle();
      if (!deal) return { status: 404, body: { error: 'Deal not found' } };
      if (emp && !dealInScope(deal, emp)) return { status: 403, body: { error: 'That deal is outside your scope' } };
      const line = `[${today()} ${who.name}] ${a.body}`;
      const notes = (String(deal.notes || '').trim() ? String(deal.notes).trim() + '\n' : '') + line;
      const { data, error } = await supabase.from('deals').update({ notes: notes.slice(-5000), updated_at: new Date().toISOString() }).eq('id', a.deal_id).select().single();
      if (error) return dbErr(error);
      if (data.customer_id) logLeadActivity(data.customer_id, { type: 'note', body: `Deal ${data.title}: ${a.body}`, ...author });
      invalidate();
      return done(`Note added to "${data.title}".`, data);
    }
    case 'update_task': {
      const { data: task } = await supabase.from('tasks').select('*').eq('id', a.task_id).maybeSingle();
      if (!task) return { status: 404, body: { error: 'Task not found' } };
      const f = a.fields;
      if (emp) {
        // The team portal's own rule: a task can only be marked done, and only by an assignee.
        const mine = String(task.assignee_id) === String(emp.id) || (Array.isArray(task.assignee_ids) && task.assignee_ids.map(String).includes(String(emp.id)));
        if (!mine) return { status: 403, body: { error: 'That task is not assigned to you' } };
        if (Object.keys(f).some(k => k !== 'status') || f.status !== 'done') return { status: 403, body: { error: 'From the team portal a task can only be marked done; ask the admin for other changes' } };
      }
      const updates = { ...f, updated_at: new Date().toISOString() };
      if (updates.status === 'done') { if (!task.completed_at) updates.completed_at = new Date().toISOString(); }
      else if (updates.status) updates.completed_at = null;
      if (Array.isArray(f.assignee_ids)) { updates.assignee_ids = [...new Set(f.assignee_ids.map(String))]; updates.assignee_id = updates.assignee_ids[0] || ''; }
      const { data, error } = await supabase.from('tasks').update(updates).eq('id', a.task_id).select().single();
      if (error) return dbErr(error);
      const before = new Set((Array.isArray(task.assignee_ids) && task.assignee_ids.length ? task.assignee_ids : (task.assignee_id ? [task.assignee_id] : [])).map(String));
      const after = new Set((Array.isArray(data.assignee_ids) && data.assignee_ids.length ? data.assignee_ids : (data.assignee_id ? [data.assignee_id] : [])).map(String));
      const added = [...after].filter(x => !before.has(x));
      if (!emp && added.length) { try { notifyEmployeeTaskAssigned({ ...data, assignee_ids: added }); } catch (_) {} }
      if (added.length || [...before].some(x => !after.has(x)) || f.due_date || f.title || f.status) { try { const p = syncTaskToCalendar(data); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
      if (f.status === 'done' && task.status !== 'done') { try { runAutomations('task.completed', taskCtx(data)); } catch (_) {} }
      invalidate();
      const changed = Object.keys(f).map(k => `${k}: ${Array.isArray(f[k]) ? f[k].join('/') : typeof f[k] === 'string' ? f[k].slice(0, 60) : f[k]}`).join(', ');
      return done(`Task "${data.title}" updated: ${changed}.`, data);
    }
    case 'comment_task': {
      const { data: task } = await supabase.from('tasks').select('id,title').eq('id', a.task_id).maybeSingle();
      if (!task) return { status: 404, body: { error: 'Task not found' } };
      const { data, error } = await supabase.from('task_comments').insert({ task_id: a.task_id, author_key: who.key, author_name: who.name, body: a.body, file_url: '', file_name: '', file_size: null, file_type: '' }).select().single();
      if (error) return dbErr(error);
      try {
        const { data: emps } = await supabase.from('employees').select('id,name,username');
        const lower = a.body.toLowerCase();
        for (const e of emps || []) {
          const mentioned = (e.name && lower.includes('@' + e.name.toLowerCase())) || (e.username && lower.includes('@' + e.username.toLowerCase()));
          if (!mentioned || `employee_${e.id}` === who.key) continue;
          createNotification(`employee_${e.id}`, { type: 'task', title: `${who.name} mentioned you in a comment`, body: `${task.title}: ${a.body.slice(0, 140)}`, url: '/employee#tasks' }, 'always');
        }
      } catch (_) {}
      return done(`Comment added to "${task.title}".`, data);
    }
    case 'create_request': {
      const row = { title: a.title, description: a.description, priority: a.priority, assigned_to: '', assignee_id: a.assignee_id, created_by: createdBy, status: 'pending', category: a.category };
      const { data, error } = await supabase.from('requests').insert(row).select().single();
      if (error) return dbErr(error);
      if (emp) { try { createNotification('admin', { type: 'request', title: 'New employee request', body: `${emp.name || emp.username}: ${a.title}`, url: '/dashboard#requests' }, 'offline'); } catch (_) {} }
      if (a.assignee_id && (!emp || String(a.assignee_id) !== String(emp.id))) { try { createNotification(`employee_${a.assignee_id}`, { type: 'request', title: 'Request assigned to you', body: a.title, url: '/employee#requests' }, 'always'); } catch (_) {} }
      try { runAutomations('request.created', requestCtx(data)); } catch (_) {}
      invalidate();
      return done(`Request "${a.title}" filed${a.category ? ' under ' + a.category : ''}.`, data);
    }
    case 'log_hours': {
      if (!emp) return { status: 400, body: { error: 'Hours are logged by the team member themselves, from the team portal' } };
      const row = { employee_id: emp.id, user_id: emp.username, hours: a.hours, description: a.description, log_date: a.log_date, task_description: a.task_description };
      if (a.task_id) row.task_id = a.task_id;
      const { data, error } = await supabase.from('hours_logs').insert(row).select().single();
      if (error) return dbErr(error);
      invalidate();
      return done(`${a.hours}h logged for ${a.log_date}${a.task_description ? ' — ' + a.task_description.slice(0, 60) : ''}.`, data);
    }
    case 'record_payment': {
      // The payments route's own row builder, so the arithmetic, the
      // vocabulary and the currency rule are the same as the manual form.
      let customerId = a.customer_id;
      if (a.sale_id) {
        const { data: sale } = await supabase.from('sales').select('id,customer_id,client').eq('id', a.sale_id).maybeSingle();
        if (!sale) return { status: 404, body: { error: 'Sale not found' } };
        customerId = sale.customer_id || customerId;
      }
      if (emp && empHasScope(emp) && customerId) {
        const { data: c } = await supabase.from('customers').select('*').eq('id', customerId).maybeSingle();
        if (!c || !customerInScope(c, emp, await scopedQuotedIds(emp))) return { status: 403, body: { error: 'That customer is outside your scope' } };
      }
      const built = paymentBuildRow({ ...a, sale_id: a.sale_id, customer_id: customerId || null });
      if (!built || built.error) return { status: 400, body: { error: (built && built.error) || 'Invalid payment' } };
      const row = { ...(built.row || built), sale_id: a.sale_id || null, customer_id: customerId || null, recorded_by: emp ? `employee_${emp.id}` : 'dashboard' };
      const { data, error } = await supabase.from('payments').insert(row).select().single();
      if (error) return dbErr(error);
      if (customerId) logLeadActivity(customerId, { type: 'note', body: `Payment recorded: ${a.direction === 'out' ? '−' : ''}${a.currency} ${a.amount.toLocaleString('en-US')} (${a.kind}) on ${a.paid_on}`, ...author });
      invalidate(); try { if (typeof ctx.accountingInvalidate === 'function') ctx.accountingInvalidate(); } catch (_) {}
      return done(`Recorded ${a.currency} ${a.amount.toLocaleString('en-US')} (${a.kind}, ${a.direction}) on ${a.paid_on}.`, data);
    }
    case 'record_expense': {
      const built = fin.expenseBuildRow(a);
      if (!built || built.error) return { status: 400, body: { error: (built && built.error) || 'Invalid expense' } };
      const { data, error } = await supabase.from('expenses').insert({ ...(built.row || built), recorded_by: who.key }).select().single();
      if (error) return dbErr(error);
      invalidate(); try { if (typeof ctx.accountingInvalidate === 'function') ctx.accountingInvalidate(); } catch (_) {}
      return done(`Expense recorded: ${a.currency} ${a.amount.toLocaleString('en-US')} (${a.category})${a.vendor ? ' — ' + a.vendor : ''} on ${a.spent_on}.`, data);
    }
    case 'link_submission': {
      const { data: sub } = await supabase.from('form_submissions').select('*').eq('id', a.submission_id).maybeSingle();
      if (!sub) return { status: 404, body: { error: 'Submission not found' } };
      const { data, error } = await supabase.from('form_submissions').update({ customer_id: a.customer_id }).eq('id', a.submission_id).select().single();
      if (error) return dbErr(error);
      logLeadActivity(a.customer_id, { type: 'system', body: `Linked website submission #${sub.id}${sub.car_interest ? ' — ' + sub.car_interest : ''}${sub.source ? ' via ' + sub.source : ''}`, ...author });
      invalidate();
      return done(`Submission #${sub.id} linked to ${customer.name}.`, data);
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
        const actions = canAct(emp) ? ['record_expense', 'record_payment'].filter(t => !emp || empCan(emp, S.ACTIONS[t].perm.section, S.ACTIONS[t].perm.action)) : [];
        const out = await ctx.accountingChat({ message, history: b.history, lang, tab: b.tab, period: b.period, from: b.from, to: b.to, actions });
        return res.json({ section, ...out });
      }
      const { pack, data } = await packFor(section, req);
      const screen = cleanScreen(b.screen);
      const focus = await focusFor(screen, req, pack);
      // The default model has a 24k-token window: the pack gives way to the
      // open record, and both give way to the conversation and the tools.
      const trimmed = S.capJson(S.trimSectionPack(pack), focus ? 12000 : 20000);
      const act = canAct(emp);
      const out = await aiConverse({
        systemText: systemPrompt({ lang, section, pack: trimmed, who: whoIs(req), act, roster: rosterOf(data && data.employees), screen, focus: focus ? S.capJson(focus, 8000) : null }),
        history: b.history, message, tools: toolsFor(section, act, emp), maxRounds: 6,
        runTool: (name, args) => runTool(section, pack, name, args, req),
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
