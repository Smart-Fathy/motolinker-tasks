const { createClient } = require('@supabase/supabase-js');
const crypto     = require('crypto');
const path       = require('path');
const express    = require('express');
const multer     = require('multer');
const webpush    = require('web-push');
const nodemailer = require('nodemailer');

// ─── App Init ─────────────────────────────────────────────────────────────────
// Plain Express server (Slack integration removed). `receiver.router` is kept as
// an alias so the existing route registrations stay unchanged.
const expressApp = express();
const receiver = { router: expressApp, app: expressApp };

const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ─── Website inventory (separate Supabase project) — live vehicle search ────────
// Read-only client to the marketing site's DB so sales can attach a real vehicle
// to a lead. Configured via env; when unset the vehicle picker degrades to plain
// free-text. Column mapping is heuristic with env overrides so it works without
// hard-coding the site's schema.
let _inventoryClient = null, _inventoryClientTried = false;
function inventoryDb() {
  if (_inventoryClientTried) return _inventoryClient;
  _inventoryClientTried = true;
  const url = process.env.INVENTORY_SUPABASE_URL, key = process.env.INVENTORY_SUPABASE_KEY;
  if (url && key) { try { _inventoryClient = createClient(url, key); } catch (e) { console.warn('[inventory] client init failed:', e.message); } }
  return _inventoryClient;
}
const INVENTORY_TABLE = process.env.INVENTORY_TABLE || 'vehicles';
const INVENTORY_NAME_COLS = (process.env.INVENTORY_NAME_COL || 'name,title,vehicle,full_name').split(',').map(s => s.trim()).filter(Boolean);
const INVENTORY_PRICE_COLS = (process.env.INVENTORY_PRICE_COL || 'price,price_egp,selling_price,cash_price,amount,base_price').split(',').map(s => s.trim()).filter(Boolean);
const INVENTORY_SUBTITLE_COLS = (process.env.INVENTORY_SUBTITLE_COLS || 'brand,make,model,year,trim,variant,condition').split(',').map(s => s.trim()).filter(Boolean);
const INVENTORY_SEARCH_COLS = (process.env.INVENTORY_SEARCH_COLS || '').split(',').map(s => s.trim()).filter(Boolean); // if set → server-side .or() filter
const INVENTORY_IMAGE_COL = process.env.INVENTORY_IMAGE_COL || 'image_url';
const INVENTORY_GALLERY_COL = process.env.INVENTORY_GALLERY_COL || 'gallery';
function invFirstVal(row, cols) { for (const c of cols) { if (row[c] != null && row[c] !== '') return row[c]; } return null; }
function invMapRow(row) {
  const id = row.id ?? row.uuid ?? row.slug ?? invFirstVal(row, INVENTORY_NAME_COLS) ?? null;
  let name = invFirstVal(row, INVENTORY_NAME_COLS);
  if (!name) name = [row.brand || row.make, row.model, row.year, row.trim || row.variant].filter(Boolean).join(' ').trim() || ('#' + id);
  const priceRaw = invFirstVal(row, INVENTORY_PRICE_COLS);
  const priceNum = priceRaw != null ? Number(String(priceRaw).replace(/[^\d.]/g, '')) : null;
  const price = (priceNum != null && isFinite(priceNum) && priceNum > 0) ? priceNum : null;
  const subtitle = [...new Set(INVENTORY_SUBTITLE_COLS.map(c => row[c]).filter(v => v != null && v !== '' && String(v) !== String(name)))].join(' · ');
  // Images: main image_url + gallery (array of URL strings or objects with url/src).
  const galVal = row[INVENTORY_GALLERY_COL];
  const mainImg = row[INVENTORY_IMAGE_COL] || null;
  const gallery = Array.isArray(galVal) ? galVal.map(g => typeof g === 'string' ? g : (g && (g.url || g.src || g.image_url))).filter(Boolean) : [];
  const images = [...new Set([...(mainImg ? [mainImg] : []), ...gallery])].slice(0, 5); // main first, deduped
  return { id, name: String(name), price, subtitle, image: mainImg || images[0] || null, images };
}
async function inventorySearch(q, limit = 20) {
  const db = inventoryDb();
  if (!db) return { configured: false, items: [] };
  const term = String(q || '').replace(/[,()*"\\%]/g, ' ').trim();
  try {
    let query = db.from(INVENTORY_TABLE).select('*').limit(term ? 400 : 50);
    if (term && INVENTORY_SEARCH_COLS.length) {
      query = db.from(INVENTORY_TABLE).select('*').or(INVENTORY_SEARCH_COLS.map(c => `${c}.ilike.%${term}%`).join(',')).limit(limit);
    }
    const { data, error } = await query;
    if (error) { console.warn('[inventory] query error:', error.message); return { configured: true, items: [], error: error.message }; }
    let items = (data || []).map(invMapRow).filter(x => x.name);
    // When no server-side filter, match the term against name+subtitle client-side.
    if (term && !INVENTORY_SEARCH_COLS.length) {
      const t = term.toLowerCase();
      items = items.filter(x => (x.name + ' ' + x.subtitle).toLowerCase().includes(t));
    }
    return { configured: true, items: items.slice(0, limit) };
  } catch (e) { console.warn('[inventory] search failed:', e.message); return { configured: true, items: [], error: e.message }; }
}

// ─── VAPID (Web Push) ─────────────────────────────────────────────────────────
let vapidKeys = null; // { publicKey, privateKey } — from env, DB, or generated

async function loadOrCreateVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    try {
      const { data } = await supabase.from('google_tokens').select('tokens').eq('user_key', 'vapid').single();
      if (data?.tokens?.publicKey && data?.tokens?.privateKey) vapidKeys = data.tokens;
    } catch (_) {}
    if (!vapidKeys) {
      vapidKeys = webpush.generateVAPIDKeys();
      await saveGoogleToken('vapid', vapidKeys);
      console.log('[VAPID] Generated and persisted a new key pair');
    }
  }
  webpush.setVapidDetails('mailto:admin@motolinker.com', vapidKeys.publicKey, vapidKeys.privateKey);
  console.log('[VAPID] Web push configured');
}
const upload      = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ADMIN_USERNAME       = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER;

function createMailer() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// ─── Session Store ────────────────────────────────────────────────────────────
const sessions         = new Map(); // admin sessions
const employeeSessions = new Map(); // employee portal sessions
let gmailTokens = null;
let driveTokens = null;
const employeeDriveTokens  = new Map();
const employeeEmailTokens  = new Map();
const pendingDriveAuth     = new Map();

// ─── Google Token Persistence ─────────────────────────────────────────────────
async function loadGoogleTokens() {
  try {
    const { data } = await supabase.from('google_tokens').select('user_key, tokens');
    if (!data) return;
    for (const row of data) {
      const t = row.tokens;
      if (row.user_key === 'admin_gmail') gmailTokens = t;
      else if (row.user_key === 'admin_drive') driveTokens = t;
      else if (row.user_key.endsWith('_drive')) {
        const id = parseInt(row.user_key);
        if (!isNaN(id)) employeeDriveTokens.set(id, t);
      } else if (row.user_key.endsWith('_gmail')) {
        const id = parseInt(row.user_key);
        if (!isNaN(id)) employeeEmailTokens.set(id, t);
      }
    }
    if (data.length) console.log(`[tokens] Loaded ${data.length} Google token(s) from DB`);
  } catch (e) { console.warn('[tokens] Could not load from DB:', e.message); }
}

async function saveGoogleToken(userKey, tokens) {
  try {
    await supabase.from('google_tokens')
      .upsert({ user_key: userKey, tokens, updated_at: new Date().toISOString() }, { onConflict: 'user_key' });
  } catch (e) { console.warn('[tokens] Could not save to DB:', e.message); }
}

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    return crypto.scryptSync(password, salt, 64).toString('hex') === hash;
  } catch { return false; }
}

function requireAuth(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query._t;
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireEmployeeAuth(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query._t;
  if (!token || !employeeSessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  req.employee = employeeSessions.get(token);
  next();
}


// ═══════════════════════════════════════════════════════════════════════════════
// ─── Static Assets (PWA icons, manifests, service workers) ───────────────────
// ═══════════════════════════════════════════════════════════════════════════════

receiver.router.use(express.static(path.join(__dirname, 'public')));

receiver.router.get('/sw-employee.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/employee');
  res.sendFile(path.join(__dirname, 'public', 'sw-employee.js'));
});
receiver.router.get('/sw-dashboard.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'sw-dashboard.js'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Admin Dashboard API ──────────────────────────────────════════════════════
// ═══════════════════════════════════════════════════════════════════════════════

receiver.router.get('/', (_req, res) => res.redirect('/dashboard'));
receiver.router.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ── Auth ──────────────────────────────────────────────────────────────────────
receiver.router.post('/api/auth/login', express.json(), (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD environment variable is not set. Add it in your Railway variables.' });
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = generateToken();
    sessions.set(token, { username, createdAt: Date.now() });
    return res.json({ token, username });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

receiver.router.post('/api/auth/logout', requireAuth, (req, res) => {
  const auth = req.headers['authorization'] || '';
  sessions.delete(auth.startsWith('Bearer ') ? auth.slice(7) : req.query._t);
  res.json({ ok: true });
});

receiver.router.get('/api/auth/check', requireAuth, (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query._t;
  res.json({ ok: true, username: sessions.get(token)?.username });
});


// ── Tasks ─────────────────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/tasks', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/dashboard/stats', requireAuth, async (_req, res) => {
  try {
    const { data: tasks, error } = await supabase.from('tasks').select('*');
    if (error) throw error;
    if (!tasks || tasks.length === 0) return res.json({ total: 0, done: 0, inProgress: 0, todo: 0, highPriority: 0, overdue: 0, byPriority: { high: 0, medium: 0, low: 0 }, byEmployee: [], completionRate: 0 });
    const total = tasks.length, done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length, todo = tasks.filter(t => t.status === 'todo').length;
    const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done').length;
    const today = new Date().toISOString().split('T')[0];
    const overdue = tasks.filter(t => t.due_date < today && t.status !== 'done').length;
    const byPriority = { high: 0, medium: 0, low: 0 };
    tasks.forEach(t => { if (byPriority[t.priority] !== undefined) byPriority[t.priority]++; });
    // Per-employee performance: total/done counted for every assignee of each task
    // (multi-assignee aware; matches internal id or legacy slack_user_id)
    const { data: emps } = await supabase.from('employees').select('id,name,slack_user_id,avatar_url');
    const byEmployee = (emps || []).map(e => {
      const keys = new Set([String(e.id), e.slack_user_id].filter(Boolean));
      let empTotal = 0, empDone = 0;
      tasks.forEach(t => {
        if (!taskAssigneeList(t).some(a => keys.has(a))) return;
        empTotal++;
        if (t.status === 'done') empDone++;
      });
      return { id: e.id, name: e.name, avatar_url: e.avatar_url || '', total: empTotal, done: empDone };
    }).filter(e => e.total > 0).sort((a, b) => b.done - a.done || b.total - a.total);
    res.json({ total, done, inProgress, todo, highPriority, overdue, byPriority, byEmployee, completionRate: Math.round((done / total) * 100) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Sales & revenue analytics (read-only aggregation over deals/quotations/hours) ───
const DEFAULT_STAGE_PROB = { lead: 10, inquiry: 25, quoted: 50, negotiating: 75, won: 100, lost: 0 };
const DEAL_STAGES = ['lead', 'inquiry', 'quoted', 'negotiating', 'won', 'lost'];

// Parse ?from&to (YYYY-MM-DD) into an inclusive [startISO, endISO] window; defaults to last 90 days.
function reportRange(q) {
  const to = q.to ? new Date(q.to + 'T23:59:59.999Z') : new Date();
  const from = q.from ? new Date(q.from + 'T00:00:00.000Z') : new Date(to.getTime() - 90 * 86400000);
  return { fromISO: from.toISOString(), toISO: to.toISOString() };
}

async function buildSalesReport(q) {
  const { fromISO, toISO } = reportRange(q);
  const sourceFilter = q.source ? String(q.source) : '';
  // Stage probabilities (weighted pipeline)
  let prob = { ...DEFAULT_STAGE_PROB };
  try {
    const { data: row } = await supabase.from('quotation_settings').select('value').eq('key', 'stage_probabilities').single();
    if (row?.value) prob = { ...prob, ...JSON.parse(row.value) };
  } catch (_) {}
  // Deals joined to their lead's source (for by-source conversion)
  const { data: deals } = await supabase.from('deals').select('id,stage,budget_egp,assigned_to,closed_at,created_at,customer_id,customers(source)');
  // Same scoping contract as buildLeadsReport: employees only aggregate their own.
  const scopedDeals = typeof q.scopeDeals === 'function' ? (deals || []).filter(q.scopeDeals) : (deals || []);
  const inRange = (iso) => iso && iso >= fromISO && iso <= toISO;
  const rows = scopedDeals.filter(d => {
    if (sourceFilter && (d.customers?.source || '') !== sourceFilter) return false;
    // A deal counts for the window if it was created in it, or closed in it.
    return inRange(d.created_at) || inRange(d.closed_at);
  });
  const num = (v) => Number(v) || 0;
  const pipelineByStage = DEAL_STAGES.map(stage => {
    const ds = rows.filter(d => d.stage === stage);
    return { stage, count: ds.length, value: ds.reduce((s, d) => s + num(d.budget_egp), 0) };
  });
  const openStages = ['lead', 'inquiry', 'quoted', 'negotiating'];
  const totalPipeline = pipelineByStage.filter(p => openStages.includes(p.stage)).reduce((s, p) => s + p.value, 0);
  const weightedPipeline = rows.filter(d => openStages.includes(d.stage))
    .reduce((s, d) => s + num(d.budget_egp) * (num(prob[d.stage]) / 100), 0);
  const wonRows = rows.filter(d => d.stage === 'won');
  const lostCount = rows.filter(d => d.stage === 'lost').length;
  const revenueWon = wonRows.reduce((s, d) => s + num(d.budget_egp), 0);
  const winRate = (wonRows.length + lostCount) ? Math.round((wonRows.length / (wonRows.length + lostCount)) * 100) : 0;
  // Funnel: cumulative reach of each stage (a won deal also passed through lead/contacted/…)
  const order = ['lead', 'inquiry', 'quoted', 'negotiating', 'won'];
  const idx = (st) => order.indexOf(st);
  const funnel = order.map(stage => ({
    stage,
    count: rows.filter(d => d.stage !== 'lost' && idx(d.stage) >= idx(stage)).length,
  }));
  // Revenue won by month (from closed_at)
  const byMonth = {};
  wonRows.forEach(d => { if (d.closed_at) { const m = d.closed_at.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + num(d.budget_egp); } });
  const revenueByMonth = Object.keys(byMonth).sort().map(m => ({ month: m, value: byMonth[m] }));
  // Conversion by source
  const srcMap = {};
  rows.forEach(d => {
    const s = d.customers?.source || '(unknown)';
    if (!srcMap[s]) srcMap[s] = { source: s, deals: 0, won: 0, value: 0 };
    srcMap[s].deals++;
    if (d.stage === 'won') { srcMap[s].won++; srcMap[s].value += num(d.budget_egp); }
  });
  const bySource = Object.values(srcMap).sort((a, b) => b.deals - a.deals);
  // Rep leaderboard (won count + value by assigned_to)
  const { data: emps } = await supabase.from('employees').select('id,name');
  const empName = (id) => (emps || []).find(e => String(e.id) === String(id))?.name || (id ? '#' + id : 'Unassigned');
  const repMap = {};
  rows.forEach(d => {
    const key = d.assigned_to || '';
    if (!repMap[key]) repMap[key] = { rep: empName(key), deals: 0, won: 0, value: 0 };
    repMap[key].deals++;
    if (d.stage === 'won') { repMap[key].won++; repMap[key].value += num(d.budget_egp); }
  });
  const byRep = Object.values(repMap).sort((a, b) => b.value - a.value);
  // Quotations generated in range
  const { count: quotesCount } = await supabase.from('quotations').select('id', { count: 'exact', head: true }).gte('created_at', fromISO).lte('created_at', toISO);
  // Hours logged by employee in range
  const { data: hours } = await supabase.from('hours_logs').select('employee_id,hours,log_date').gte('log_date', fromISO.slice(0, 10)).lte('log_date', toISO.slice(0, 10));
  const hoursMap = {};
  (hours || []).forEach(h => { const k = h.employee_id || ''; hoursMap[k] = (hoursMap[k] || 0) + num(h.hours); });
  const hoursByEmployee = Object.keys(hoursMap).map(k => ({ employee: empName(k), hours: Math.round(hoursMap[k] * 10) / 10 })).sort((a, b) => b.hours - a.hours);
  const wonCount = wonRows.length;
  return {
    range: { from: fromISO.slice(0, 10), to: toISO.slice(0, 10) }, source: sourceFilter,
    pipelineByStage, totalPipeline, weightedPipeline: Math.round(weightedPipeline),
    winRate, revenueWon, wonCount, avgDeal: wonCount ? Math.round(revenueWon / wonCount) : 0,
    funnel, revenueByMonth, bySource, byRep, quotesCount: quotesCount || 0, hoursByEmployee, stageProb: prob,
  };
}

receiver.router.get('/api/dashboard/reports/summary', requireAuth, async (req, res) => {
  try { res.json(await buildSalesReport(req.query)); }
  catch (e) { console.error('[reports]', e); res.status(500).json({ error: e.message }); }
});

// Serialize an array of flat objects to RFC-4180 CSV.
function csvSerialize(rows, columns) {
  const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(esc).join(',')];
  for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(','));
  return lines.join('\r\n');
}

// ── Customizable Leads report ─────────────────────────────────────────────────
// Group leads by any dimension (status, origin, budget range, owner, month,
// vehicle, or a custom column) and measure by count or budget. Powers the
// "Custom Leads Report" builder in the Reports page.
function fmtShortNum(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}
function parseBudgetBuckets(str) {
  const def = [500000, 1000000, 1500000, 2000000, 3000000];
  if (!str) return def;
  const nums = [];
  for (const raw of String(str).split(/[,\s]+/)) {
    let t = raw.trim().toLowerCase(); if (!t) continue;
    let mult = 1;
    if (/k$/.test(t)) { mult = 1e3; t = t.slice(0, -1); }
    else if (/m$/.test(t)) { mult = 1e6; t = t.slice(0, -1); }
    const n = parseFloat(t.replace(/[^\d.]/g, ''));
    if (isFinite(n) && n > 0) nums.push(Math.round(n * mult));
  }
  const arr = [...new Set(nums)].sort((a, b) => a - b);
  return arr.length ? arr : def;
}
// Returns [sortKey, label] for a budget value against ascending thresholds.
function budgetBucketOf(v, buckets) {
  if (v == null || v === '' || isNaN(Number(v))) return ['b999', 'No budget'];
  const n = Number(v);
  for (let i = 0; i < buckets.length; i++) {
    if (n < buckets[i]) return ['b' + String(i).padStart(3, '0'), i === 0 ? ('< ' + fmtShortNum(buckets[0])) : (fmtShortNum(buckets[i - 1]) + '–' + fmtShortNum(buckets[i]))];
  }
  return ['b' + String(buckets.length).padStart(3, '0'), fmtShortNum(buckets[buckets.length - 1]) + '+'];
}
function enumLabelMap(field) {
  const m = {};
  (LEADS_ENUM_DEFAULTS[field] || []).forEach(([k, l]) => { m[k] = l; });
  return m;
}
async function buildLeadsReport(q) {
  const GROUPS = ['lead_status', 'source', 'budget', 'next_action', 'been_contacted', 'owner', 'month', 'car_in_question'];
  const validDim = d => GROUPS.includes(d) || (typeof d === 'string' && d.startsWith('cf_'));
  let groupBy = String(q.groupBy || 'lead_status');
  if (!validDim(groupBy)) groupBy = 'lead_status';
  let splitBy = String(q.splitBy || '');
  if (!validDim(splitBy) || splitBy === groupBy) splitBy = '';   // optional 2nd dimension (cross-tab)
  const measure = ['count', 'budget_sum', 'budget_avg'].includes(q.measure) ? q.measure : 'count';
  // Values may be stored as raw labels ("Hot", "Whatsapp") rather than canonical
  // keys, so every enum comparison/grouping normalizes first (autoNorm: lowercase,
  // spaces→_). This is what makes the Hot count and status/origin filters correct.
  const statusFilter = q.status ? autoNorm(q.status) : '';
  const sourceFilter = q.source ? autoNorm(q.source) : '';
  const buckets = parseBudgetBuckets(q.buckets);
  // ALL-TIME by default so totals match the Leads table exactly; the date filter
  // applies only when the user supplies a range.
  const fromDay = q.from ? String(q.from).slice(0, 10) : null;
  const toDay = q.to ? String(q.to).slice(0, 10) : null;

  const { data: all } = await supabase.from('customers')
    .select('id,lead_status,source,budget_lead,budget_max,next_action,been_contacted,assigned_to,car_in_question,lead_date,created_at,custom_fields')
    .limit(50000);
  // Employee reports pass a predicate so totals never include leads outside the
  // caller's data scope. Admin reports pass nothing and see everything.
  const scoped = typeof q.scopeLeads === 'function' ? (all || []).filter(q.scopeLeads) : (all || []);
  const effDay = c => c.lead_date || (c.created_at || '').slice(0, 10);
  let leads = scoped.filter(c => {
    if (!fromDay && !toDay) return true;               // no range → every lead (incl. dateless)
    const d = effDay(c); if (!d) return false;
    if (fromDay && d < fromDay) return false;
    if (toDay && d > toDay) return false;
    return true;
  });
  if (statusFilter) leads = leads.filter(c => autoNorm(c.lead_status || 'cold') === statusFilter);
  if (sourceFilter) leads = leads.filter(c => autoNorm(c.source || '') === sourceFilter);

  // Budget can live in the built-in budget_lead OR a custom "Budget" column
  // (some configs deleted the built-in and use cf_budget). Fall back per lead.
  const colsCfg = await loadLeadsColsConfig();
  const budgetCf = (Array.isArray(colsCfg) ? colsCfg : []).find(c => c && typeof c.key === 'string' && c.key.startsWith('cf_') && !c.deleted && autoNorm(c.label || '') === 'budget')?.key || 'cf_budget';
  const effBudget = c => {
    if (c.budget_lead != null && c.budget_lead !== '' && isFinite(Number(c.budget_lead))) return Number(c.budget_lead);
    const raw = (c.custom_fields || {})[budgetCf];
    if (raw == null || raw === '') return null;
    const b = parseBudget(raw);
    return b && b.min != null ? Number(b.min) : null;
  };

  const { data: emps } = await supabase.from('employees').select('id,name');
  const empName = id => (emps || []).find(e => String(e.id) === String(id))?.name || (id ? '#' + id : 'Unassigned');
  // Label enum values the way the LEADS TABLE does: the user's saved column
  // options win (they may have renamed/replaced options); defaults are only a
  // fallback. Indexed by autoNorm of both option key and label so raws stored
  // either way resolve to the same display name.
  const cfgLabels = (colKey, defaults) => {
    const m = { ...defaults };
    const col = (Array.isArray(colsCfg) ? colsCfg : []).find(c => c && c.key === colKey && !c.deleted);
    (col && Array.isArray(col.options) ? col.options : []).forEach(o => {
      if (!o || o.label == null) return;
      m[autoNorm(o.key)] = o.label;
      m[autoNorm(o.label)] = o.label;
    });
    return m;
  };
  const statusLabels = cfgLabels('lead_status', enumLabelMap('status'));
  const originLabels = cfgLabels('source', enumLabelMap('source'));
  const naLabels = cfgLabels('next_action', enumLabelMap('next_action'));
  const isTrue = v => v === true || v === 'true' || v === 1 || v === '1';

  // [key,label] for ANY dimension — reused for group-by AND split-by. Group
  // identity is the DISPLAYED label (normalized) so a value stored as an option
  // key and the same value stored as its label always land together.
  function dimKeyLabel(dim, c) {
    if (dim.startsWith('cf_')) { const v = (c.custom_fields || {})[dim]; const s = (v == null ? '' : String(v)).trim(); return [s ? autoNorm(s) : '~none', s || '(none)']; }
    switch (dim) {
      case 'lead_status': { const raw = c.lead_status || 'cold'; const label = statusLabels[autoNorm(raw)] || raw; return [autoNorm(label), label]; }
      case 'source': { const raw = c.source || ''; if (!raw) return ['~none', '(no origin)']; const label = originLabels[autoNorm(raw)] || raw; return [autoNorm(label), label]; }
      case 'next_action': { const raw = c.next_action || ''; if (!raw) return ['~none', '(none)']; const label = naLabels[autoNorm(raw)] || raw; return [autoNorm(label), label]; }
      case 'been_contacted': { const b = isTrue(c.been_contacted); return [b ? 'a_yes' : 'b_no', b ? 'Contacted' : 'Not contacted']; }
      case 'owner': { const k = c.assigned_to; return [String(k || '~unassigned'), empName(k)]; }
      case 'month': { const m = (effDay(c) || '').slice(0, 7); return [m || 'zzzz', m || '(no date)']; }
      case 'car_in_question': { const k = (c.car_in_question || '').trim(); return [k ? autoNorm(k) : '~none', k || '(none)']; }
      case 'budget': return budgetBucketOf(effBudget(c), buckets);
      default: { const raw = c.lead_status || 'cold'; const label = statusLabels[autoNorm(raw)] || raw; return [autoNorm(label), label]; }
    }
  }
  const measureVal = (count, budget) => measure === 'count' ? count : measure === 'budget_avg' ? Math.round(budget / (count || 1)) : Math.round(budget);
  const orderEntries = (obj, dim) => {
    const arr = Object.values(obj);
    if (dim === 'budget' || dim === 'month') arr.sort((a, b) => String(a.key).localeCompare(String(b.key)));
    else arr.sort((a, b) => measure === 'count' ? b.count - a.count : b.budget - a.budget);
    return arr;
  };

  let totalCount = 0, totalBudget = 0, hotCount = 0;
  const tally = c => { const b = effBudget(c) || 0; totalCount++; totalBudget += b; if (autoNorm(c.lead_status || 'cold') === 'hot') hotCount++; return b; };
  const totalsOut = () => ({ count: totalCount, budget: Math.round(totalBudget), avg: totalCount ? Math.round(totalBudget / totalCount) : 0 });
  const rangeOut = { from: fromDay || '', to: toDay || '' };

  if (splitBy) {
    // Cross-tab: primary group rows × split-by category columns.
    const map = {};      // primKey -> {key,label,count,budget,sub:{splitKey:{count,budget}}}
    const splitAgg = {}; // splitKey -> {key,label,count,budget}
    for (const c of leads) {
      const b = tally(c);
      const [pk, pl] = dimKeyLabel(groupBy, c);
      const [sk, sl] = dimKeyLabel(splitBy, c);
      if (!map[pk]) map[pk] = { key: pk, label: pl, count: 0, budget: 0, sub: {} };
      map[pk].count++; map[pk].budget += b;
      if (!map[pk].sub[sk]) map[pk].sub[sk] = { count: 0, budget: 0 };
      map[pk].sub[sk].count++; map[pk].sub[sk].budget += b;
      if (!splitAgg[sk]) splitAgg[sk] = { key: sk, label: sl, count: 0, budget: 0 };
      splitAgg[sk].count++; splitAgg[sk].budget += b;
    }
    const splitCats = orderEntries(splitAgg, splitBy).map(s => ({ key: s.key, label: s.label }));
    const rows = orderEntries(map, groupBy).map(r => ({
      label: r.label, count: r.count, value: measureVal(r.count, r.budget),
      cells: splitCats.reduce((o, s) => { const cell = r.sub[s.key]; o[s.key] = cell ? measureVal(cell.count, cell.budget) : 0; return o; }, {}),
    }));
    return { groupBy, splitBy, measure, splitCats, rows, totals: totalsOut(), hotCount, range: rangeOut };
  }

  // Single dimension (unchanged output shape)
  const map = {};
  for (const c of leads) {
    const b = tally(c);
    const [k, label] = dimKeyLabel(groupBy, c);
    if (!map[k]) map[k] = { key: k, label, count: 0, budget: 0 };
    map[k].count++; map[k].budget += b;
  }
  const rows = orderEntries(map, groupBy).map(r => ({ label: r.label, count: r.count, value: measureVal(r.count, r.budget) }));
  return { groupBy, splitBy: '', measure, rows, totals: totalsOut(), hotCount, range: rangeOut };
}
receiver.router.get('/api/dashboard/reports/leads', requireAuth, async (req, res) => {
  try { res.json(await buildLeadsReport(req.query)); }
  catch (e) { console.error('[reports-leads]', e); res.status(500).json({ error: e.message }); }
});

receiver.router.get('/api/dashboard/reports/export.csv', requireAuth, async (req, res) => {
  try {
    const rep = await buildSalesReport(req.query);
    const which = String(req.query.report || 'pipeline');
    let rows = [], cols = null, fname = which;
    if (which === 'pipeline') { rows = rep.pipelineByStage; cols = ['stage', 'count', 'value']; }
    else if (which === 'by_source') { rows = rep.bySource; cols = ['source', 'deals', 'won', 'value']; }
    else if (which === 'by_rep') { rows = rep.byRep; cols = ['rep', 'deals', 'won', 'value']; }
    else if (which === 'revenue_by_month') { rows = rep.revenueByMonth; cols = ['month', 'value']; }
    else if (which === 'hours') { rows = rep.hoursByEmployee; cols = ['employee', 'hours']; }
    else if (which === 'summary') {
      rows = [
        { metric: 'Date range', value: `${rep.range.from} → ${rep.range.to}` },
        { metric: 'Open pipeline (EGP)', value: rep.totalPipeline },
        { metric: 'Weighted pipeline (EGP)', value: rep.weightedPipeline },
        { metric: 'Win rate (%)', value: rep.winRate },
        { metric: 'Revenue won (EGP)', value: rep.revenueWon },
        { metric: 'Deals won', value: rep.wonCount },
        { metric: 'Avg deal (EGP)', value: rep.avgDeal },
        { metric: 'Quotes generated', value: rep.quotesCount },
      ];
      cols = ['metric', 'value'];
    } else { return res.status(400).json({ error: 'Unknown report' }); }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="motolinker-${fname}-${rep.range.from}_${rep.range.to}.csv"`);
    res.send(csvSerialize(rows, cols));
  } catch (e) { console.error('[reports-csv]', e); res.status(500).json({ error: e.message }); }
});


// Normalize the assignee input: accepts assignee_ids (array) and/or assignee_id.
// Returns { primary, list } where primary keeps the legacy single column populated.
function normalizeAssignees(body) {
  let list = Array.isArray(body.assignee_ids) ? body.assignee_ids.map(String).filter(Boolean) : [];
  if (!list.length && body.assignee_id) list = [String(body.assignee_id)];
  list = [...new Set(list)];
  return { primary: list[0] || null, list };
}
function taskAssigneeList(task) {
  const list = Array.isArray(task?.assignee_ids) && task.assignee_ids.length ? task.assignee_ids.map(String) : (task?.assignee_id ? [String(task.assignee_id)] : []);
  return [...new Set(list)];
}

receiver.router.post('/api/dashboard/tasks', requireAuth, express.json(), async (req, res) => {
  const { title, description, due_date, priority, milestone } = req.body;
  const { primary, list } = normalizeAssignees(req.body);
  if (!title || !primary || !due_date || !priority)
    return res.status(400).json({ error: 'Missing required fields: title, assignee(s), due_date, priority' });
  const { data: task, error } = await supabase.from('tasks')
    .insert({ title, description: description || '', channel_id: '', channel_name: '', assignee_id: primary, assignee_ids: list, due_date, priority, milestone: milestone || '', created_by: 'dashboard', status: 'todo' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Notify every assignee via SSE (if portal is open) and push (always)
  notifyEmployeeTaskAssigned(task);
  runAutomations('task.created', taskCtx(task));
  res.json(task);
});

receiver.router.put('/api/dashboard/tasks/:id', requireAuth, express.json(), async (req, res) => {
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  if (updates.status === 'done' && !updates.completed_at) updates.completed_at = new Date().toISOString();
  if (updates.status && updates.status !== 'done') updates.completed_at = null;
  if (updates.assignee_ids !== undefined || updates.assignee_id !== undefined) {
    const { primary, list } = normalizeAssignees(updates);
    updates.assignee_id = primary;
    updates.assignee_ids = list;
  }
  // Capture prior assignees + status to detect (re)assignment and completion
  const { data: prev } = await supabase.from('tasks').select('assignee_id, assignee_ids, status').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('tasks').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Notify only newly-added assignees
  const before = new Set(taskAssigneeList(prev));
  const added = taskAssigneeList(data).filter(id => !before.has(id));
  if (added.length) notifyEmployeeTaskAssigned({ ...data, assignee_ids: added });
  if (data.status === 'done' && prev?.status !== 'done') runAutomations('task.completed', taskCtx(data));
  res.json(data);
});

receiver.router.delete('/api/dashboard/tasks/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Recurring Tasks (templates that auto-generate tasks) ──────────────────────
// Date helpers work on YYYY-MM-DD strings in UTC, matching how the rest of the
// app computes "today" (new Date().toISOString().split('T')[0]).
function rtToday() { return new Date().toISOString().split('T')[0]; }
function rtAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}
function rtWeekday(dateStr) { return new Date(dateStr + 'T00:00:00Z').getUTCDay(); } // 0=Sun..6=Sat
function rtCleanWeekdays(v) {
  const arr = Array.isArray(v) ? v : [];
  return [...new Set(arr.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
}
// Smallest date >= base whose weekday is in the set (base itself counts).
function rtNextWeeklyOnOrAfter(baseStr, weekdays) {
  const wd = rtCleanWeekdays(weekdays);
  if (!wd.length) return null;
  for (let i = 0; i < 7; i++) { const d = rtAddDays(baseStr, i); if (wd.includes(rtWeekday(d))) return d; }
  return null;
}
// Smallest date strictly after `afterStr` whose weekday is in the set.
function rtNextWeeklyAfter(afterStr, weekdays) {
  return rtNextWeeklyOnOrAfter(rtAddDays(afterStr, 1), weekdays);
}
// First run date for a template (on/after start_date, else today).
function rtComputeInitialNextRun(rt) {
  const today = rtToday();
  let base = rt.start_date && rt.start_date > today ? rt.start_date : today;
  if (rt.recurrence_type === 'weekly') return rtNextWeeklyOnOrAfter(base, rt.weekdays);
  return base; // interval: fire on the start date (or today)
}
// Next run date after an instance was generated on `ranOn`.
function rtComputeNextAfterRun(rt, ranOn) {
  if (rt.recurrence_type === 'weekly') return rtNextWeeklyAfter(ranOn, rt.weekdays);
  const step = Math.max(1, parseInt(rt.interval_days, 10) || 1);
  return rtAddDays(ranOn, step);
}
// Validate + normalize a recurring-task body. Returns { row, error }.
function rtBuildRow(body) {
  const title = String(body.title || '').trim();
  const { primary, list } = normalizeAssignees(body);
  const recurrence_type = body.recurrence_type === 'weekly' ? 'weekly' : (body.recurrence_type === 'interval' ? 'interval' : null);
  if (!title) return { error: 'Title is required' };
  if (!primary) return { error: 'At least one assignee is required' };
  if (!recurrence_type) return { error: 'Recurrence type must be "interval" or "weekly"' };
  const priority = ['high', 'medium', 'low'].includes(body.priority) ? body.priority : 'medium';
  let interval_days = null, weekdays = null;
  if (recurrence_type === 'interval') {
    interval_days = parseInt(body.interval_days, 10);
    if (!Number.isInteger(interval_days) || interval_days < 1) return { error: 'Enter a valid number of days (1 or more)' };
  } else {
    weekdays = rtCleanWeekdays(body.weekdays);
    if (!weekdays.length) return { error: 'Pick at least one weekday' };
  }
  const due_offset_days = Math.max(0, parseInt(body.due_offset_days, 10) || 0);
  const start_date = body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date) ? body.start_date : null;
  return { row: {
    title, description: String(body.description || '').trim(),
    assignee_id: primary, assignee_ids: list,
    priority, milestone: String(body.milestone || '').trim(),
    recurrence_type, interval_days, weekdays, due_offset_days, start_date,
  } };
}

receiver.router.get('/api/dashboard/recurring-tasks', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('recurring_tasks').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/recurring-tasks', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = rtBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  row.next_run_date = rtComputeInitialNextRun(row);
  row.created_by = 'dashboard';
  const { data, error } = await supabase.from('recurring_tasks').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.put('/api/dashboard/recurring-tasks/:id', requireAuth, express.json(), async (req, res) => {
  // Active-only toggle: don't require the full recurrence payload.
  if (Object.keys(req.body).length === 1 && typeof req.body.active === 'boolean') {
    const { data, error } = await supabase.from('recurring_tasks').update({ active: req.body.active, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }
  const { row, error: verr } = rtBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  if (typeof req.body.active === 'boolean') row.active = req.body.active;
  row.next_run_date = rtComputeInitialNextRun(row); // recompute schedule from the edited recurrence
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('recurring_tasks').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/recurring-tasks/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('recurring_tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Generate one task instance from a template now (manual trigger).
receiver.router.post('/api/dashboard/recurring-tasks/:id/run-now', requireAuth, async (req, res) => {
  const { data: rt, error } = await supabase.from('recurring_tasks').select('*').eq('id', req.params.id).single();
  if (error || !rt) return res.status(404).json({ error: 'Recurring task not found' });
  const task = await generateRecurringInstance(rt, rtToday(), true);
  if (!task) return res.status(500).json({ error: 'Could not create the task' });
  res.json(task);
});

// Create a task row from a template for a given run date. `force` bypasses the
// once-per-day guard (used by Run now). Advances the template's schedule.
async function generateRecurringInstance(rt, runDate, force) {
  if (!force && rt.last_run_date === runDate) return null; // already generated today
  const list = taskAssigneeList(rt);
  const due_date = rtAddDays(runDate, Math.max(0, rt.due_offset_days || 0));
  const { data: task, error } = await supabase.from('tasks').insert({
    title: rt.title, description: rt.description || '', channel_id: '', channel_name: '',
    assignee_id: rt.assignee_id || (list[0] || null), assignee_ids: list,
    due_date, priority: rt.priority || 'medium', milestone: rt.milestone || '',
    created_by: 'recurring', status: 'todo', recurring_id: rt.id,
  }).select().single();
  if (error) { console.warn('[recurring] task insert failed:', error.message); return null; }
  notifyEmployeeTaskAssigned(task);
  await supabase.from('recurring_tasks').update({
    last_run_date: runDate,
    next_run_date: rtComputeNextAfterRun(rt, runDate),
    updated_at: new Date().toISOString(),
  }).eq('id', rt.id);
  console.log('[recurring] generated task', task.id, 'from template', rt.id);
  return task;
}

// Scheduler tick: generate instances for every active template due on/before today.
async function runRecurringTasks() {
  const today = rtToday();
  const { data: due, error } = await supabase.from('recurring_tasks')
    .select('*').eq('active', true).not('next_run_date', 'is', null).lte('next_run_date', today);
  if (error) { console.warn('[recurring] sweep failed:', error.message); return; }
  for (const rt of due || []) {
    try { await generateRecurringInstance(rt, today, false); }
    catch (e) { console.warn('[recurring] instance error for', rt.id, e.message); }
  }
}
function scheduleRecurringTasks() {
  setTimeout(() => runRecurringTasks().catch(console.error), 35 * 1000); // catch-up shortly after boot
  setInterval(() => runRecurringTasks().catch(console.error), 60 * 60 * 1000); // hourly (guarded once/day)
}

// ─── Car Stock (immediate-delivery inventory) ───────────────────────────────────
// A CRM-owned list of vehicles physically in stock for immediate delivery. One row
// per make+model+trim (a model may carry several trims); `quantity` = units on hand,
// `price` = price per car. Separate from the read-only website inventory picker.
// Spec sheet shown on each car card. Keys are stable; labels drive the UI/CSV.
const STOCK_SPEC_FIELDS = [
  ['range_km',     'Range (KM)'],
  ['motor_ps',     'Motor (PS)'],
  ['power_train',  'Power Train'],
  ['drive_train',  'Drive Train'],
  ['transmission', 'Transmission'],
  ['battery',      'Battery'],
  ['top_speed',    'Top Speed'],
  ['fast_charge',  'Fast Charge'],
  ['seats',        'Seats'],
  ['body',         'Body'],
  ['year',         'Year'],
];
const STOCK_SPEC_KEYS = STOCK_SPEC_FIELDS.map(([k]) => k);
const STOCK_CSV_HEADERS = ['make', 'model', 'trim', 'price', ...STOCK_SPEC_KEYS, 'colors', 'units', 'quantity', 'notes'];

// "White:3 | Black:2" (or "White:3,Black:2") → [{name:'White',qty:3},…]
function parseStockColors(val) {
  if (Array.isArray(val)) {
    return val.map(c => ({
      name: String(c && c.name != null ? c.name : '').trim(),
      qty: Math.max(0, parseInt(String(c && c.qty != null ? c.qty : 0).replace(/[^\d]/g, ''), 10) || 0),
    })).filter(c => c.name);
  }
  const s = String(val || '').trim();
  if (!s) return [];
  return s.split(/[|;,]/).map(part => {
    const [name, qty] = part.split(':');
    return { name: String(name || '').trim(), qty: Math.max(0, parseInt(String(qty || '0').replace(/[^\d]/g, ''), 10) || 0) };
  }).filter(c => c.name);
}

// Individual physical cars held against a model row. Accepts the UI's array form
// or a CSV cell like "VIN123:White:in_logistics | VIN124:Black:delivered".
function parseStockUnits(val) {
  const one = u => ({
    consignee:  String(u.consignee  ?? '').trim(),
    colour:     String(u.colour     ?? u.color ?? '').trim(),
    vin:        String(u.vin        ?? '').trim().toUpperCase(),
    status:     PO_LINE_STATUS_KEYS.includes(u.status) ? u.status : 'send_to_supplier',
    price_list: Number(String(u.price_list ?? '').replace(/[^\d.]/g, '')) || 0,
    discounted: Number(String(u.discounted ?? '').replace(/[^\d.]/g, '')) || 0,
    logistics:  String(u.logistics  ?? '').trim(),
    supplier:   String(u.supplier   ?? '').trim(),
  });
  if (Array.isArray(val)) {
    return val.map(one).filter(u => u.vin || u.consignee || u.colour || u.supplier);
  }
  const s = String(val || '').trim();
  if (!s) return [];
  return s.split(/\s*\|\s*/).map(part => {
    const [vin, colour, status] = part.split(':');
    return one({ vin, colour, status: String(status || '').trim() });
  }).filter(u => u.vin || u.colour);
}

function stockBuildRow(body) {
  const b = body || {};
  const make = String(b.make || '').trim();
  const model = String(b.model || '').trim();
  if (!make) return { error: 'Make is required' };
  if (!model) return { error: 'Model is required' };
  const priceNum = Number(String(b.price ?? '').replace(/[^\d.]/g, ''));

  // Specs may arrive nested (`specs:{…}` from the UI) or flat (CSV columns).
  const srcSpecs = (b.specs && typeof b.specs === 'object') ? b.specs : b;
  const specs = {};
  for (const k of STOCK_SPEC_KEYS) {
    const v = String(srcSpecs[k] ?? '').trim();
    if (v) specs[k] = v;
  }

  const colors = parseStockColors(b.colors);
  const units = parseStockUnits(b.units);
  // Quantity is derived, most specific source first: individual units → colour
  // counts → the manually entered total.
  const qtyNum = parseInt(String(b.quantity ?? '').replace(/[^\d-]/g, ''), 10);
  const quantity = units.length ? units.length
    : colors.length ? colors.reduce((s, c) => s + c.qty, 0)
    : ((isFinite(qtyNum) && qtyNum > 0) ? qtyNum : 0);

  return { row: {
    make, model,
    trim: String(b.trim || '').trim(),
    price: (isFinite(priceNum) && priceNum > 0) ? priceNum : 0,
    quantity,
    specs, colors, units,
    notes: String(b.notes || '').trim(),
  } };
}

// Until migrations/001 has been applied the specs/colors columns may not exist.
// Detect that specific failure and retry without them so Car Stock keeps working.
function isMissingColumnErr(err) {
  const m = String((err && (err.message || err.details)) || '');
  return /column .*(specs|colors|units).* does not exist/i.test(m)
      || /could not find the '(specs|colors|units)' column/i.test(m)
      || err?.code === '42703' || err?.code === 'PGRST204';
}
async function stockWrite(row, id) {
  const run = payload => id
    ? supabase.from('stock_vehicles').update(payload).eq('id', id).select().single()
    : supabase.from('stock_vehicles').insert(payload).select().single();
  let res = await run(row);
  if (res.error && isMissingColumnErr(res.error)) {
    console.warn('[stock] specs/colors columns missing — apply migrations/001. Saving without them.');
    const { specs, colors, units, ...rest } = row;
    res = await run(rest);
  }
  return res;
}

receiver.router.get('/api/dashboard/stock', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('stock_vehicles').select('*').order('make', { ascending: true }).order('model', { ascending: true }).order('trim', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/stock', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = stockBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  row.created_by = 'dashboard';
  const { data, error } = await stockWrite(row, null);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.put('/api/dashboard/stock/:id', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = stockBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  row.updated_at = new Date().toISOString();
  const { data, error } = await stockWrite(row, req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/stock/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('stock_vehicles').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Downloadable sample CSV template for bulk upload.
receiver.router.get('/api/dashboard/stock/template.csv', requireAuth, (_req, res) => {
  // colors = "Name:Qty | Name:Qty"  ·  units = "VIN:Colour:Status | VIN:Colour:Status"
  // Units win over colours for the total quantity; both may be left blank.
  const sample = [
    STOCK_CSV_HEADERS.join(','),
    '"BYD","Seal","Design",1950000,570,530,"EV","RWD","Single-speed","82.5 kWh","180 km/h","150 kW",5,"Sedan",2025,"White:2 | Black:1","LGXC76C41P0123456:White:in_logistics | LGXC76C41P0123457:White:delivered",,"Immediate delivery"',
    '"BYD","Seal","Excellence AWD",2250000,520,530,"EV","AWD","Single-speed","82.5 kWh","180 km/h","150 kW",5,"Sedan",2025,"Grey:1",,1,',
    '"Toyota","Corolla","GLI 1.6",1150000,,,"Petrol","FWD","CVT",,"180 km/h",,5,"Sedan",2024,"White:2 | Silver:2",,4,',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="car-stock-template.csv"');
  res.send('﻿' + sample); // BOM for Excel
});

// Bulk import stock vehicles from a CSV (make,model,trim,price,quantity,notes).
receiver.router.post('/api/dashboard/stock/bulk', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
  const rows = parseCSV(req.file.buffer.toString('utf-8'));
  if (!rows.length) return res.status(400).json({ error: 'CSV has no data rows' });
  const inserts = [], errors = [];
  rows.forEach((row, i) => {
    const { row: built, error } = stockBuildRow(row);
    if (error) { errors.push(`Row ${i + 2}: ${error}`); return; }
    built.created_by = 'dashboard_bulk';
    inserts.push(built);
  });
  if (!inserts.length) return res.json({ inserted: 0, errors });
  let { data, error } = await supabase.from('stock_vehicles').insert(inserts).select();
  if (error && isMissingColumnErr(error)) {
    console.warn('[stock] specs/colors columns missing — apply migrations/001. Importing without them.');
    ({ data, error } = await supabase.from('stock_vehicles')
      .insert(inserts.map(({ specs, colors, units, ...rest }) => rest)).select());
  }
  if (error) return res.status(500).json({ error: error.message });
  res.json({ inserted: data.length, errors });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Suppliers (Logistics & Shipping) ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// The register behind the supplier pickers on RFQs, purchase orders and stock units.
function supplierBuildRow(body) {
  const b = body || {};
  const name = String(b.name || '').trim();
  if (!name) return { error: 'Supplier name is required' };
  return { row: {
    name,
    contact: String(b.contact || '').trim(),
    address: String(b.address || '').trim(),
    country: String(b.country || '').trim(),
    notes:   String(b.notes || '').trim(),
  } };
}

receiver.router.get('/api/dashboard/suppliers', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('suppliers').select('*').order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/suppliers', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = supplierBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  row.created_by = 'dashboard';
  const { data, error } = await supabase.from('suppliers').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.put('/api/dashboard/suppliers/:id', requireAuth, express.json(), async (req, res) => {
  const { row, error: verr } = supplierBuildRow(req.body);
  if (verr) return res.status(400).json({ error: verr });
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('suppliers').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/suppliers/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('suppliers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Sales (one sold car; the Deals → Sales tab) ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const SALE_FIELDS = ['client', 'consignee', 'brand', 'model', 'trim', 'colour', 'vin', 'sales_name', 'payment_type', 'client_file'];
const SALE_MONEY  = ['price_list', 'down_payment', 'discounted', 'remaining'];
const SALE_DATES  = ['remaining_due', 'reservation_date', 'delivery_date'];

function saleBuildRow(body) {
  const b = body || {};
  const row = {};
  for (const k of SALE_FIELDS) row[k] = String(b[k] ?? '').trim();
  for (const k of SALE_MONEY) row[k] = Number(String(b[k] ?? '').replace(/[^\d.]/g, '')) || 0;
  for (const k of SALE_DATES) row[k] = String(b[k] ?? '').trim() || null;
  row.status = PO_LINE_STATUS_KEYS.includes(b.status) ? b.status : 'send_to_supplier';
  row.customer_id = b.customer_id ? parseInt(b.customer_id) : null;
  if (b.deal_id !== undefined) row.deal_id = b.deal_id ? parseInt(b.deal_id) : null;
  // Remaining defaults to what's actually left when the user hasn't typed one.
  if (!row.remaining) row.remaining = Math.max(0, (row.discounted || row.price_list) - row.down_payment);
  return { row };
}

receiver.router.get('/api/dashboard/sales', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('sales').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/sales', requireAuth, express.json(), async (req, res) => {
  const { row } = saleBuildRow(req.body);
  row.created_by = 'dashboard';
  const { data, error } = await supabase.from('sales').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.put('/api/dashboard/sales/:id', requireAuth, express.json(), async (req, res) => {
  const { row } = saleBuildRow(req.body);
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('sales').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/sales/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('sales').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Won deal → open a sales record. Idempotent: one row per deal.
async function autoCreateSaleForWonDeal(deal) {
  if (!deal || deal.stage !== 'won') return null;
  try {
    const { data: existing } = await supabase.from('sales').select('id').eq('deal_id', deal.id).maybeSingle();
    if (existing) return null;
    const cust = deal.customer_id
      ? await supabase.from('customers').select('*').eq('id', deal.customer_id).single().then(r => r.data)
      : null;
    const cf = (cust && cust.custom_fields) || {};
    const car = String(cf.cf_vehicle_offered || deal.car_model || cf.cf_vehicle_requested || (cust && cust.car_in_question) || '').trim();
    const bits = car.split(/\s+/).filter(Boolean);
    const { row } = saleBuildRow({
      deal_id: deal.id, customer_id: deal.customer_id || null,
      client: (cust && cust.name) || '', consignee: (cust && cust.name) || '',
      brand: bits[0] || '', model: bits.slice(1).join(' ') || '',
      colour: cf.cf_color || '', price_list: deal.budget_egp || 0,
    });
    row.created_by = 'auto_won';
    const { data, error } = await supabase.from('sales').insert(row).select().single();
    if (error) { console.warn('[sales] auto-create failed:', error.message); return null; }
    console.log('[sales] opened sale', data.id, 'for won deal', deal.id);
    return data;
  } catch (e) { console.warn('[sales] auto-create error:', e.message); return null; }
}

// ── CSV Bulk Upload ───────────────────────────────────────────────────────────
function normalizeDate(str) {
  if (!str) return str;
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str; // already YYYY-MM-DD
  // DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    // If first part > 12 it must be day; otherwise assume DD/MM (international default)
    if (parseInt(d) > 12) return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    if (parseInt(m) > 12) return `${y}-${d.padStart(2,'0')}-${m.padStart(2,'0')}`;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; // assume DD/MM
  }
  // YYYY/MM/DD
  const ymd = str.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;
  // Fallback: let JS parse it
  const parsed = new Date(str);
  if (!isNaN(parsed)) return parsed.toISOString().split('T')[0];
  return str;
}
function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
  return lines.slice(1).map(line => {
    const vals = []; let cur = '', inQ = false;
    for (const ch of line + ',') {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').replace(/^"|"$/g, '').trim(); });
    return row;
  });
}

receiver.router.post('/api/dashboard/tasks/bulk', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
  const rows = parseCSV(req.file.buffer.toString('utf-8'));
  const inserts = [], errors = [];
  rows.forEach((row, i) => {
    if (!row.title || !row.assignee_id || !row.due_date) {
      errors.push(`Row ${i + 2}: missing required fields (title, assignee_id, due_date)`); return;
    }
    inserts.push({ title: row.title, description: row.description || '', channel_id: '', channel_name: '', assignee_id: String(row.assignee_id), assignee_ids: [String(row.assignee_id)], due_date: normalizeDate(row.due_date), priority: ['high', 'medium', 'low'].includes(row.priority) ? row.priority : 'medium', milestone: row.milestone || '', created_by: 'dashboard_bulk', status: row.status && ['todo','in_progress','done'].includes(row.status) ? row.status : 'todo' });
  });

  if (inserts.length) {
    const { data, error } = await supabase.from('tasks').insert(inserts).select();
    if (error) return res.status(500).json({ error: error.message });
    (data || []).forEach(t => runAutomations('task.created', taskCtx(t)));
    return res.json({ inserted: data.length, errors });
  }
  res.json({ inserted: 0, errors });
});

// ── Task Comments (with @mentions) ────────────────────────────────────────────
async function listTaskComments(taskId, res) {
  const { data, error } = await supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at', { ascending: true }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
}

async function postTaskComment(taskId, authorKey, authorName, payload, res) {
  const p = payload || {};
  const text = String(p.body || '').trim().slice(0, 2000);
  const file_url = String(p.file_url || '');
  if (!text && !file_url) return res.status(400).json({ error: 'Comment is empty' });
  const { data: task } = await supabase.from('tasks').select('id,title').eq('id', taskId).single();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { data, error } = await supabase.from('task_comments')
    .insert({ task_id: taskId, author_key: authorKey, author_name: authorName, body: text,
      file_url, file_name: String(p.file_name || ''), file_size: p.file_size || null, file_type: String(p.file_type || '') })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
  // Notify @mentioned employees (best-effort, after response)
  try {
    const notifBody = text || (file_url ? `📎 ${p.file_name || 'attachment'}` : '');
    const { data: emps } = await supabase.from('employees').select('id,name,username');
    const lower = text.toLowerCase();
    for (const e of emps || []) {
      const mentioned = (e.name && lower.includes('@' + e.name.toLowerCase())) || (e.username && lower.includes('@' + e.username.toLowerCase()));
      if (!mentioned || `employee_${e.id}` === authorKey) continue;
      createNotification(`employee_${e.id}`, {
        type: 'task',
        title: `${authorName} mentioned you in a comment`,
        body: `${task.title}: ${notifBody.slice(0, 140)}`,
        url: '/employee#tasks',
      }, 'always');
    }
  } catch (_) {}
}

receiver.router.get('/api/dashboard/tasks/:id/comments', requireAuth, (req, res) => listTaskComments(parseInt(req.params.id), res));
receiver.router.post('/api/dashboard/tasks/:id/comments', requireAuth, express.json(), (req, res) =>
  postTaskComment(parseInt(req.params.id), 'admin', 'Admin', req.body, res));
receiver.router.get('/api/employee/tasks/:id/comments', requireEmployeeAuth, (req, res) => listTaskComments(parseInt(req.params.id), res));
receiver.router.post('/api/employee/tasks/:id/comments', requireEmployeeAuth, express.json(), (req, res) =>
  postTaskComment(parseInt(req.params.id), `employee_${req.employee.id}`, req.employee.name, req.body, res));

// Coworker names (for @mention autocomplete in comments)
receiver.router.get('/api/employee/coworkers', requireEmployeeAuth, async (_req, res) => {
  const { data, error } = await supabase.from('employees').select('id,name,username,avatar_url').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Request comments (creator ↔ assignee ↔ admin discussion) ──────────────────
async function listRequestComments(reqId, res) {
  const { data, error } = await supabase.from('request_comments').select('*').eq('request_id', reqId).order('created_at', { ascending: true }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
}

async function postRequestComment(reqId, authorKey, authorName, payload, res) {
  const p = payload || {};
  const text = String(p.body || '').trim().slice(0, 2000);
  const file_url = String(p.file_url || '');
  if (!text && !file_url) return res.status(400).json({ error: 'Comment is empty' });
  const { data: reqRow } = await supabase.from('requests').select('id,title,created_by,assignee_id').eq('id', reqId).single();
  if (!reqRow) return res.status(404).json({ error: 'Request not found' });
  const { data, error } = await supabase.from('request_comments')
    .insert({ request_id: reqId, author_key: authorKey, author_name: authorName, body: text,
      file_url, file_name: String(p.file_name || ''), file_size: p.file_size || null, file_type: String(p.file_type || '') })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
  // Notify the other parties (creator, assignee, admin) + @mentions — best-effort
  try {
    const notifBody = text || (file_url ? `📎 ${p.file_name || 'attachment'}` : '');
    const recipients = new Set();
    // creator (employee) — created_by is a username
    if (reqRow.created_by && reqRow.created_by !== 'dashboard') {
      const { data: cEmp } = await supabase.from('employees').select('id').eq('username', reqRow.created_by).single();
      if (cEmp) recipients.add(`employee_${cEmp.id}`);
    } else if (reqRow.created_by === 'dashboard') {
      recipients.add('admin');
    }
    if (reqRow.assignee_id) recipients.add(`employee_${reqRow.assignee_id}`);
    recipients.add('admin'); // admins always follow request threads
    recipients.delete(authorKey); // never notify the author
    for (const key of recipients) {
      createNotification(key, {
        type: 'request',
        title: `${authorName} commented on a request`,
        body: `${reqRow.title}: ${notifBody.slice(0, 140)}`,
        url: key === 'admin' ? '/dashboard#requests' : '/employee#requests',
      }, 'always');
    }
    // @mentions
    const { data: emps } = await supabase.from('employees').select('id,name,username');
    const lower = text.toLowerCase();
    for (const em of emps || []) {
      const mentioned = (em.name && lower.includes('@' + em.name.toLowerCase())) || (em.username && lower.includes('@' + em.username.toLowerCase()));
      if (!mentioned || `employee_${em.id}` === authorKey || recipients.has(`employee_${em.id}`)) continue;
      createNotification(`employee_${em.id}`, { type: 'request', title: `${authorName} mentioned you in a request`, body: `${reqRow.title}: ${notifBody.slice(0, 140)}`, url: '/employee#requests' }, 'always');
    }
  } catch (_) {}
}

// Employee may see/comment on a request only if they created it, it's assigned to
// them, or they have the view-all permission.
async function employeeMayAccessRequest(req, reqId) {
  if (req.employee.permissions?.viewAllRequests === true) return true;
  const { data } = await supabase.from('requests').select('created_by,assignee_id').eq('id', reqId).single();
  if (!data) return false;
  return data.created_by === req.employee.username || String(data.assignee_id || '') === String(req.employee.id);
}

receiver.router.get('/api/dashboard/requests/:id/comments', requireAuth, (req, res) => listRequestComments(parseInt(req.params.id), res));
receiver.router.post('/api/dashboard/requests/:id/comments', requireAuth, express.json(), (req, res) =>
  postRequestComment(parseInt(req.params.id), 'admin', 'Admin', req.body, res));
receiver.router.get('/api/employee/requests/:id/comments', requireEmployeeAuth, async (req, res) => {
  if (!(await employeeMayAccessRequest(req, parseInt(req.params.id)))) return res.status(403).json({ error: 'Not permitted' });
  listRequestComments(parseInt(req.params.id), res);
});
receiver.router.post('/api/employee/requests/:id/comments', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!(await employeeMayAccessRequest(req, parseInt(req.params.id)))) return res.status(403).json({ error: 'Not permitted' });
  postRequestComment(parseInt(req.params.id), `employee_${req.employee.id}`, req.employee.name, req.body, res);
});

// ── Report an Issue (employee → CTO) ──────────────────────────────────────────
const issueUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
receiver.router.post('/api/employee/report-issue', requireEmployeeAuth, issueUpload.single('file'), async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim().slice(0, 150);
    const description = String(req.body?.description || '').trim().slice(0, 2000);
    if (!title && !description) return res.status(400).json({ error: 'Please describe the issue' });
    let fileUrl = '';
    if (req.file) {
      const safe = (req.file.originalname || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      const p = `issues/${Date.now()}_${safe}`;
      const { data, error } = await supabase.storage.from('chat-files').upload(p, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (error) return res.status(500).json({ error: 'Attachment upload failed: ' + error.message });
      const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(data.path);
      fileUrl = urlData?.publicUrl || '';
    }
    const bodyTxt = [description || title, fileUrl ? `Attachment: ${fileUrl}` : ''].filter(Boolean).join('\n');
    // Persist the ticket so the CTO can view/manage it in the Issues center (best-effort)
    try {
      await supabase.from('issues').insert({
        title: title || 'System issue', description, file_url: fileUrl,
        reporter_id: req.employee.id, reporter_name: req.employee.name, status: 'open',
      });
    } catch (e) { console.warn('[issues] persist failed:', e.message); }
    // Route to every employee whose job title is Chief Technical Officer (fallback: admin)
    const { data: ctos } = await supabase.from('employees').select('id,name').ilike('job_title', '%chief technical officer%');
    if (ctos?.length) {
      for (const cto of ctos) {
        await createNotification(`employee_${cto.id}`, {
          type: 'issue',
          title: `Issue reported by ${req.employee.name}: ${title || 'System issue'}`,
          body: bodyTxt,
          url: '/employee#issues',
        }, 'always');
      }
    } else {
      await createNotification('admin', {
        type: 'issue',
        title: `Issue reported by ${req.employee.name}: ${title || 'System issue'}`,
        body: bodyTxt,
        url: '/dashboard#notif',
      }, 'always');
    }
    res.json({ ok: true, file: fileUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Issues center (CTO only) ──────────────────────────────────────────────────
function isCto(req) { return /chief technical officer/i.test(req.employee?.job_title || ''); }

receiver.router.get('/api/employee/issues', requireEmployeeAuth, async (req, res) => {
  if (!isCto(req)) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('issues').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.put('/api/employee/issues/:id', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!isCto(req)) return res.status(403).json({ error: 'Not permitted' });
  const status = req.body?.status === 'resolved' ? 'resolved' : 'open';
  const { data, error } = await supabase.from('issues').update({ status }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Employee profile: status, avatar, username ────────────────────────────────
receiver.router.put('/api/employee/status', requireEmployeeAuth, express.json(), async (req, res) => {
  const status_text  = String(req.body?.text  || '').trim().slice(0, 100);
  const status_emoji = String(req.body?.emoji || '').trim().slice(0, 8);
  const { data, error } = await supabase.from('employees')
    .update({ status_text, status_emoji }).eq('id', req.employee.id)
    .select('status_text,status_emoji').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
receiver.router.post('/api/employee/avatar', requireEmployeeAuth, avatarUpload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.mimetype?.startsWith('image/')) return res.status(400).json({ error: 'Please upload an image' });
    const ext = (req.file.mimetype.split('/')[1] || 'png').split(';')[0].replace(/[^a-z0-9]/gi, '') || 'png';
    const p = `avatars/${req.employee.id}_${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage.from('chat-files').upload(p, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) return res.status(500).json({ error: error.message });
    const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(data.path);
    const avatar_url = urlData?.publicUrl || '';
    await supabase.from('employees').update({ avatar_url }).eq('id', req.employee.id);
    res.json({ avatar_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.put('/api/employee/username', requireEmployeeAuth, express.json(), async (req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-32 characters (letters, numbers, . _ -)' });
  const { data: existing } = await supabase.from('employees').select('id').eq('username', username).neq('id', req.employee.id).limit(1);
  if (existing?.length) return res.status(409).json({ error: 'Username already taken' });
  const { error } = await supabase.from('employees').update({ username }).eq('id', req.employee.id);
  if (error) return res.status(500).json({ error: error.message });
  // Keep the live session in sync
  req.employee.username = username;
  const token = (req.headers['authorization'] || '').slice(7);
  if (token && employeeSessions.has(token)) employeeSessions.set(token, { ...employeeSessions.get(token), username });
  res.json({ ok: true, username });
});

// ── Hours Logs ────────────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/hours', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('hours_logs')
    .select('*, tasks(title, channel_name)').order('logged_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/hours', requireAuth, express.json(), async (req, res) => {
  const { task_id, user_id, hours, description } = req.body;
  if (!task_id || !user_id || !hours) return res.status(400).json({ error: 'task_id, user_id and hours are required' });
  const { data, error } = await supabase.from('hours_logs')
    .insert({ task_id: parseInt(task_id), user_id, hours: parseFloat(hours), description: description || '' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/hours/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('hours_logs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Requests ──────────────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/requests', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('requests').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/requests', requireAuth, express.json(), async (req, res) => {
  const { title, description, priority, assigned_to } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const assignee_id = req.body?.assignee_id ? parseInt(req.body.assignee_id) : null;
  const { data, error } = await supabase.from('requests')
    .insert({ title, description: description || '', priority: priority || 'medium', assigned_to: assigned_to || '', assignee_id, created_by: 'dashboard', status: 'pending' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (assignee_id) {
    createNotification(`employee_${assignee_id}`, { type: 'request', title: 'A request was assigned to you', body: title, url: '/employee#requests' }, 'always');
  }
  runAutomations('request.created', requestCtx(data));
  res.json(data);
});

receiver.router.put('/api/dashboard/requests/:id', requireAuth, express.json(), async (req, res) => {
  const { data: existing } = await supabase.from('requests').select('status,created_by,title,assignee_id').eq('id', req.params.id).single();
  if (req.body.assignee_id !== undefined) req.body.assignee_id = req.body.assignee_id ? parseInt(req.body.assignee_id) : null;
  const { data, error } = await supabase.from('requests')
    .update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Push notify creator if status changed and creator is an employee (not 'dashboard')
  if (existing && data && existing.status !== data.status && existing.created_by && existing.created_by !== 'dashboard') {
    const { data: emp } = await supabase.from('employees').select('id').eq('username', existing.created_by).single();
    if (emp) {
      const labels = { pending: 'Pending', in_review: 'In Review', approved: '✓ Approved', rejected: 'Rejected' };
      createNotification(`employee_${emp.id}`, {
        type: 'request',
        title: `Request ${labels[data.status] || data.status}`,
        body: data.title,
        url: '/employee#requests',
      }, 'offline');
    }
  }
  // Notify a newly-assigned employee
  if (data?.assignee_id && String(data.assignee_id) !== String(existing?.assignee_id || '')) {
    createNotification(`employee_${data.assignee_id}`, { type: 'request', title: 'A request was assigned to you', body: data.title, url: '/employee#requests' }, 'always');
  }
  if (existing && data && existing.status !== data.status) runAutomations('request.status_changed', { ...requestCtx(data), from: existing.status, to: data.status });
  res.json(data);
});

receiver.router.delete('/api/dashboard/requests/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('requests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Gmail / My Email ──────────────────────────────────────────────────────────
receiver.router.get('/api/email/status', requireAuth, (_req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.json({ configured: false });
  if (!gmailTokens)      return res.json({ configured: true, connected: false });
  res.json({ configured: true, connected: true, email: gmailTokens.email, name: gmailTokens.name });
});

receiver.router.get('/api/email/connect', requireAuth, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${base}/api/email/callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    access_type: 'offline',
    prompt: 'consent',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.get('/api/email/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('No code provided');

  // If state matches a pending Drive auth, handle as Drive
  const pending = state ? pendingDriveAuth.get(state) : null;
  if (pending) {
    pendingDriveAuth.delete(state);
    try {
      const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${base}/api/email/callback`, grant_type: 'authorization_code' }) });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) throw new Error(tokens.error_description || 'No access token');
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profile = await profileRes.json();
      const full = { ...tokens, email: profile.email, name: profile.name, expiry_date: Date.now() + ((tokens.expires_in || 3600) * 1000) };
      if (pending.type === 'employee-login') {
        // Google login for employee portal — match by email
        // Case-insensitive match (ilike, no wildcards) + limit(1) so mixed-case stored emails work and duplicates don't throw
        const { data: empRows } = await supabase.from('employees').select('id,name,username,permissions').ilike('email', String(profile.email || '').trim()).limit(1);
        const emp = empRows && empRows[0];
        if (!emp) return res.redirect('/employee?google_login_error=' + encodeURIComponent('No account linked to this Google address. Contact your admin.'));
        const sessionToken = generateToken();
        const permissions = normEmpPerms(emp.permissions);
        employeeSessions.set(sessionToken, { id: emp.id, name: emp.name, username: emp.username, permissions });
        return res.redirect('/employee?emp_token=' + sessionToken);
      }
      if (pending.type === 'employee' && pending.employeeId) {
        employeeDriveTokens.set(pending.employeeId, full);
        saveGoogleToken(`${pending.employeeId}_drive`, full);
        return res.redirect('/employee#drive');
      }
      if (pending.type === 'employee-gmail' && pending.employeeId) {
        employeeEmailTokens.set(pending.employeeId, full);
        saveGoogleToken(`${pending.employeeId}_gmail`, full);
        return res.redirect('/employee#email');
      }
      driveTokens = full;
      saveGoogleToken('admin_drive', full);
      return res.redirect('/dashboard#drive');
    } catch (e) { return res.status(500).send(`OAuth error: ${e.message}`); }
  }

  // Otherwise handle as Gmail
  try {
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${base}/api/email/callback`, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error(tokens.error_description || 'No access token');
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileRes.json();
    gmailTokens = { ...tokens, email: profile.email, name: profile.name, expiry_date: Date.now() + ((tokens.expires_in || 3600) * 1000) };
    saveGoogleToken('admin_gmail', gmailTokens);
    res.redirect('/dashboard#email');
  } catch (e) { res.status(500).send(`OAuth error: ${e.message}`); }
});

receiver.router.get('/api/email/messages', requireAuth, async (_req, res) => {
  if (!gmailTokens) return res.status(400).json({ error: 'Gmail not connected' });
  try {
    // Refresh access token if expired
    if (gmailTokens.refresh_token && Date.now() > (gmailTokens.expiry_date || 0) - 60_000) {
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: gmailTokens.refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
      const refreshed = await r.json();
      if (refreshed.access_token) gmailTokens = { ...gmailTokens, ...refreshed, expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) };
    }
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&labelIds=INBOX', { headers: { Authorization: `Bearer ${gmailTokens.access_token}` } });
    const list = await listRes.json();
    if (!list.messages) return res.json([]);
    const messages = await Promise.all((list.messages || []).map(async m => {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${gmailTokens.access_token}` } });
      const msg = await r.json();
      const h = msg.payload?.headers || [];
      const get = n => h.find(x => x.name === n)?.value || '';
      return { id: m.id, subject: get('Subject') || '(no subject)', from: get('From'), date: get('Date'), snippet: msg.snippet || '', unread: (msg.labelIds || []).includes('UNREAD') };
    }));
    res.json(messages);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/email/disconnect', requireAuth, (_req, res) => {
  gmailTokens = null;
  res.json({ ok: true });
});

// Helper: refresh Gmail token if needed
async function getGmailToken() {
  if (!gmailTokens) throw new Error('Gmail not connected');
  if (gmailTokens.refresh_token && Date.now() > (gmailTokens.expiry_date || 0) - 60_000) {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: gmailTokens.refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
    const refreshed = await r.json();
    if (refreshed.access_token) {
      gmailTokens = { ...gmailTokens, ...refreshed, expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) };
      saveGoogleToken('admin_gmail', gmailTokens);
    }
  }
  return gmailTokens.access_token;
}

// Helper: decode Gmail message body
function decodeGmailBody(payload) {
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  if (payload.parts) {
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    const text = payload.parts.find(p => p.mimeType === 'text/plain');
    const part = html || text;
    if (part?.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf-8');
    for (const p of payload.parts) { if (p.parts) { const nested = decodeGmailBody(p); if (nested) return nested; } }
  }
  return '';
}

// Full email by ID
receiver.router.get('/api/email/messages/:id', requireAuth, async (req, res) => {
  try {
    const token = await getGmailToken();
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
    const msg = await r.json();
    const headers = msg.payload?.headers || [];
    const get = n => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';
    res.json({
      id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds || [],
      subject: get('Subject'), from: get('From'), to: get('To'), date: get('Date'),
      messageId: get('Message-ID'),
      body: decodeGmailBody(msg.payload || {}),
      isHtml: !!(msg.payload?.parts?.find(p => p.mimeType === 'text/html') || msg.payload?.mimeType === 'text/html'),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send / Reply
receiver.router.post('/api/email/send', requireAuth, express.json(), async (req, res) => {
  const { to, subject, body, threadId, inReplyTo } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject and body are required' });
  try {
    const token = await getGmailToken();
    const lines = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8'];
    if (inReplyTo) { lines.push(`In-Reply-To: ${inReplyTo}`); lines.push(`References: ${inReplyTo}`); }
    const raw = Buffer.from(lines.join('\r\n') + '\r\n\r\n' + body).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = { raw };
    if (threadId) payload.threadId = threadId;
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await r.json();
    if (result.error) throw new Error(result.error.message);
    res.json({ ok: true, id: result.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Google Drive / Sheets ─────────────────────────────────────────────────────
const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

async function getDriveToken(tokens, userKey) {
  if (!tokens) throw new Error('Drive not connected');
  if (tokens.refresh_token && Date.now() > (tokens.expiry_date || 0) - 60_000) {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: tokens.refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
    const refreshed = await r.json();
    if (refreshed.access_token) {
      Object.assign(tokens, refreshed, { expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) });
      if (userKey) saveGoogleToken(userKey, tokens);
    }
  }
  return tokens.access_token;
}

async function listDriveFiles(tokens, mimeType, userKey) {
  const token = await getDriveToken(tokens, userKey);
  const q = mimeType ? `mimeType='${mimeType}' and trashed=false` : 'trashed=false';
  const fields = 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink,size)';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime+desc&pageSize=50&fields=${encodeURIComponent(fields)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.files || [];
}

// Admin drive connect
receiver.router.get('/api/drive/status', requireAuth, (_req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.json({ configured: false });
  if (!driveTokens) return res.json({ configured: true, connected: false });
  res.json({ configured: true, connected: true, email: driveTokens.email, name: driveTokens.name });
});

receiver.router.get('/api/drive/connect', requireAuth, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'admin' });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${base}/api/email/callback`, response_type: 'code', scope: DRIVE_SCOPES, access_type: 'offline', prompt: 'consent', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/drive/disconnect', requireAuth, (_req, res) => { driveTokens = null; res.json({ ok: true }); });

receiver.router.get('/api/drive/files',  requireAuth, async (_req, res) => { try { res.json(await listDriveFiles(driveTokens)); } catch (e) { res.status(500).json({ error: e.message }); } });
receiver.router.get('/api/drive/sheets', requireAuth, async (_req, res) => { try { res.json(await listDriveFiles(driveTokens, 'application/vnd.google-apps.spreadsheet')); } catch (e) { res.status(500).json({ error: e.message }); } });

// Employee drive connect
receiver.router.get('/api/employee/drive/status', requireEmployeeAuth, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.json({ configured: false });
  const t = employeeDriveTokens.get(req.employee.id);
  if (!t) return res.json({ configured: true, connected: false });
  res.json({ configured: true, connected: true, email: t.email, name: t.name });
});

receiver.router.get('/api/employee/drive/connect', requireEmployeeAuth, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'employee', employeeId: req.employee.id });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${base}/api/email/callback`, response_type: 'code', scope: DRIVE_SCOPES, access_type: 'offline', prompt: 'consent', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/employee/drive/disconnect', requireEmployeeAuth, (req, res) => { employeeDriveTokens.delete(req.employee.id); res.json({ ok: true }); });

receiver.router.get('/api/employee/drive/files',  requireEmployeeAuth, async (req, res) => { try { res.json(await listDriveFiles(employeeDriveTokens.get(req.employee.id), null, `${req.employee.id}_drive`)); } catch (e) { res.status(500).json({ error: e.message }); } });
receiver.router.get('/api/employee/drive/sheets', requireEmployeeAuth, async (req, res) => { try { res.json(await listDriveFiles(employeeDriveTokens.get(req.employee.id), 'application/vnd.google-apps.spreadsheet', `${req.employee.id}_drive`)); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Employee Email ─────────────────────────────────────────────────────────────
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

receiver.router.get('/api/employee/email/status', requireEmployeeAuth, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.json({ configured: false });
  const t = employeeEmailTokens.get(req.employee.id);
  if (!t) return res.json({ configured: true, connected: false });
  res.json({ configured: true, connected: true, email: t.email, name: t.name });
});

receiver.router.get('/api/employee/email/connect', requireEmployeeAuth, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base  = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'employee-gmail', employeeId: req.employee.id });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${base}/api/email/callback`, response_type: 'code', scope: GMAIL_SCOPES, access_type: 'offline', prompt: 'consent', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/employee/email/disconnect', requireEmployeeAuth, (req, res) => { employeeEmailTokens.delete(req.employee.id); res.json({ ok: true }); });

async function getEmployeeGmailToken(employeeId) {
  const t = employeeEmailTokens.get(employeeId);
  if (!t) throw new Error('Gmail not connected');
  if (t.refresh_token && Date.now() > (t.expiry_date || 0) - 60_000) {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: t.refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
    const refreshed = await r.json();
    if (refreshed.access_token) {
      const updated = { ...t, ...refreshed, expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) };
      employeeEmailTokens.set(employeeId, updated);
      saveGoogleToken(`${employeeId}_gmail`, updated);
    }
  }
  return employeeEmailTokens.get(employeeId).access_token;
}

receiver.router.get('/api/employee/email/messages', requireEmployeeAuth, async (req, res) => {
  try {
    const token   = await getEmployeeGmailToken(req.employee.id);
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&labelIds=INBOX', { headers: { Authorization: `Bearer ${token}` } });
    const list    = await listRes.json();
    if (!list.messages) return res.json([]);
    const messages = await Promise.all((list.messages || []).map(async m => {
      const r   = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${token}` } });
      const msg = await r.json();
      const h   = msg.payload?.headers || [];
      const get = n => h.find(x => x.name === n)?.value || '';
      return { id: m.id, subject: get('Subject') || '(no subject)', from: get('From'), date: get('Date'), snippet: msg.snippet || '', unread: (msg.labelIds || []).includes('UNREAD') };
    }));
    res.json(messages);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.get('/api/employee/email/messages/:id', requireEmployeeAuth, async (req, res) => {
  try {
    const token = await getEmployeeGmailToken(req.employee.id);
    const r   = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
    const msg = await r.json();
    const headers = msg.payload?.headers || [];
    const get = n => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';
    res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds || [], subject: get('Subject'), from: get('From'), to: get('To'), date: get('Date'), messageId: get('Message-ID'), body: decodeGmailBody(msg.payload || {}), isHtml: !!(msg.payload?.parts?.find(p => p.mimeType === 'text/html') || msg.payload?.mimeType === 'text/html') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/employee/email/send', requireEmployeeAuth, express.json(), async (req, res) => {
  const { to, subject, body, threadId, inReplyTo } = req.body || {};
  if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject and body are required' });
  try {
    const token = await getEmployeeGmailToken(req.employee.id);
    const lines = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8'];
    if (inReplyTo) { lines.push(`In-Reply-To: ${inReplyTo}`); lines.push(`References: ${inReplyTo}`); }
    const raw  = Buffer.from(lines.join('\r\n') + '\r\n\r\n' + body).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = { raw };
    if (threadId) payload.threadId = threadId;
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await r.json();
    if (result.error) throw new Error(result.error.message);
    res.json({ ok: true, id: result.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Employee Portal ──────────────────────────────────────────────────────────
receiver.router.get('/employee', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'employee.html')));

// Employee Requests
receiver.router.get('/api/employee/requests', requireEmployeeAuth, async (req, res) => {
  const canViewAll = req.employee.permissions?.viewAllRequests === true;
  try {
    if (canViewAll) {
      const { data, error } = await supabase.from('requests').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return res.json(data || []);
    }
    // Own requests OR requests assigned to me
    const [mine, assigned] = await Promise.all([
      supabase.from('requests').select('*').eq('created_by', req.employee.username),
      supabase.from('requests').select('*').eq('assignee_id', req.employee.id),
    ]);
    if (mine.error) throw mine.error;
    const seen = new Set();
    const all = [...(mine.data || []), ...(assigned.data || [])].filter(r => !seen.has(r.id) && seen.add(r.id));
    all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    res.json(all);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/employee/requests', requireEmployeeAuth, express.json(), async (req, res) => {
  const { title, description, category, priority } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const assignee_id = req.body?.assignee_id ? parseInt(req.body.assignee_id) : null;
  const { data, error } = await supabase.from('requests')
    .insert({ title, description: description || '', priority: priority || 'medium', assigned_to: '', assignee_id, created_by: req.employee.username, status: 'pending', category: category || '' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Notify admin notification center
  createNotification('admin', {
    type: 'request',
    title: 'New employee request',
    body: `${req.employee.name}: ${title}`,
    url: '/dashboard#requests',
  }, 'offline');
  // Notify the assigned employee (if any, and not self)
  if (assignee_id && assignee_id !== req.employee.id) {
    createNotification(`employee_${assignee_id}`, {
      type: 'request',
      title: `${req.employee.name} sent you a request`,
      body: title,
      url: '/employee#requests',
    }, 'always');
  }
  runAutomations('request.created', requestCtx(data));
  res.json(data);
});

// Employee auth
const DEFAULT_PERMISSIONS = { requests: true, drive: true, sheets: true, pdfscraper: false, email: false, viewAllRequests: false, quotation: false, leads: false, deals: false, reports: false };

// ── Advanced permissions: per-action + data scope for CRM sections ────────────
// Backward compatible: legacy flat booleans (e.g. leads:true) normalize to full
// actions + no scope. The rich shape adds <section>Actions objects and a scope.
const PERM_ACTIONS = {
  leads: ['view', 'create', 'edit', 'delete', 'import', 'export'],
  deals: ['view', 'create', 'edit', 'delete', 'move'],
  quotation: ['draft', 'history', 'settings', 'delete', 'attachLead'],
  // Each report is granted individually, so an employee can be given the leads
  // report without the revenue figures (or vice-versa). Reports always obey the
  // employee's data scope — they aggregate only rows that employee may see.
  reports: ['leads', 'sales', 'export'],
};
function normEmpPerms(raw) {
  const p = { ...DEFAULT_PERMISSIONS, ...(raw || {}) };
  for (const [section, actions] of Object.entries(PERM_ACTIONS)) {
    const master = p[section] === true;
    const given = raw && raw[section + 'Actions'] && typeof raw[section + 'Actions'] === 'object' ? raw[section + 'Actions'] : null;
    const out = {};
    for (const a of actions) out[a] = given ? given[a] === true : master; // legacy: master on ⇒ all actions
    p[section + 'Actions'] = out;
  }
  const s = (raw && typeof raw.scope === 'object' && raw.scope) ? raw.scope : {};
  p.scope = {
    assignedOnly: s.assignedOnly === true,
    dealStages: Array.isArray(s.dealStages) ? s.dealStages.filter(x => DEAL_STAGES.includes(x)) : [],
    leadStatuses: Array.isArray(s.leadStatuses) ? s.leadStatuses.map(x => autoNorm(x)).filter(Boolean) : [],
  };
  return p;
}
// Can this employee perform <action> in <section>? Master must be on AND the action allowed.
function empCan(emp, section, action) {
  const p = emp && emp.permissions; if (!p) return false;
  if (p[section] !== true) return false;
  const acts = p[section + 'Actions'];
  return !!(acts && acts[action] === true);
}
function empHasScope(emp) {
  const s = emp && emp.permissions && emp.permissions.scope;
  return !!(s && (s.assignedOnly || (s.dealStages && s.dealStages.length) || (s.leadStatuses && s.leadStatuses.length)));
}
// Set of customers.id that satisfy the employee's dealStages scope (empty scope ⇒ null = no restriction).
async function scopedQuotedIds(emp) {
  const stages = emp?.permissions?.scope?.dealStages || [];
  if (!stages.length) return null;
  const { data } = await supabase.from('deals').select('customer_id').in('stage', stages);
  return new Set((data || []).map(d => d.customer_id));
}
// Is a single customer row visible to this employee under their scope? (AND across dimensions)
function customerInScope(c, emp, stageIdSet) {
  const s = emp?.permissions?.scope; if (!s) return true;
  if (s.assignedOnly && String(c.assigned_to || '') !== String(emp.id)) return false;
  if (s.leadStatuses && s.leadStatuses.length && !s.leadStatuses.includes(autoNorm(c.lead_status || ''))) return false;
  if (s.dealStages && s.dealStages.length && stageIdSet && !stageIdSet.has(c.id)) return false;
  return true;
}
// Deal-row scope: dealStages match the deal's own stage; assignedOnly / leadStatuses
// use the deal's own assignee and the embedded customer's fields.
function dealInScope(d, emp) {
  const s = emp?.permissions?.scope; if (!s) return true;
  if (s.dealStages && s.dealStages.length && !s.dealStages.includes(d.stage)) return false;
  if (s.assignedOnly) {
    const mine = String(d.assigned_to || '') === String(emp.id) || String(d.customers?.assigned_to || '') === String(emp.id);
    if (!mine) return false;
  }
  if (s.leadStatuses && s.leadStatuses.length && !s.leadStatuses.includes(autoNorm(d.customers?.lead_status || ''))) return false;
  return true;
}

// Google login for employee portal
receiver.router.get('/api/employee/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('Google login not configured');
  const base  = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'employee-login' });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${base}/api/email/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/employee/login', express.json(), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const { data: emp } = await supabase.from('employees').select('*').eq('username', username).single();
  if (!emp || !verifyPassword(password, emp.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
  const token = generateToken();
  const permissions = normEmpPerms(emp.permissions);
  employeeSessions.set(token, { id: emp.id, name: emp.name, username: emp.username, job_title: emp.job_title || '', permissions });
  res.json({ token, name: emp.name, username: emp.username, id: emp.id, job_title: emp.job_title || '', permissions, avatar_url: emp.avatar_url || '', status_text: emp.status_text || '', status_emoji: emp.status_emoji || '' });
});
receiver.router.get('/api/employee/check', requireEmployeeAuth, async (req, res) => {
  let profile = {};
  try {
    const { data } = await supabase.from('employees').select('permissions,job_title,avatar_url,status_text,status_emoji,username').eq('id', req.employee.id).single();
    if (data) {
      const permissions = normEmpPerms(data.permissions);
      req.employee.permissions = permissions;
      req.employee.job_title = data.job_title || '';
      req.employee.username = data.username || req.employee.username;
      profile = { avatar_url: data.avatar_url || '', status_text: data.status_text || '', status_emoji: data.status_emoji || '' };
      const token = (req.headers['authorization'] || '').slice(7);
      if (token && employeeSessions.has(token)) {
        const sess = employeeSessions.get(token);
        employeeSessions.set(token, { ...sess, permissions, job_title: data.job_title || '', username: req.employee.username });
      }
    }
  } catch (_) {}
  res.json({ ok: true, ...req.employee, ...profile });
});
receiver.router.post('/api/employee/logout', requireEmployeeAuth, (req, res) => {
  const token = (req.headers['authorization'] || '').slice(7);
  employeeSessions.delete(token);
  res.json({ ok: true });
});

// Change password (authenticated)
receiver.router.post('/api/employee/change-password', requireEmployeeAuth, express.json(), async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const { data: emp } = await supabase.from('employees').select('password_hash').eq('id', req.employee.id).single();
  if (!emp || !verifyPassword(currentPassword, emp.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
  const { error } = await supabase.from('employees').update({ password_hash: hashPassword(newPassword) }).eq('id', req.employee.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Forgot password — send reset link via email
receiver.router.post('/api/employee/forgot-password', express.json(), async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const { data: emp } = await supabase.from('employees').select('id,name,email').eq('email', email.toLowerCase().trim()).single();
  // Always respond OK to avoid email enumeration
  if (!emp) return res.json({ ok: true });
  const mailer = createMailer();
  if (!mailer) return res.status(503).json({ error: 'Email service not configured. Contact your admin.' });
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 3600_000); // 1 hour
  await supabase.from('password_reset_tokens').insert({ employee_id: emp.id, token, expires_at: expiresAt.toISOString() });
  const base = process.env.APP_URL || 'https://your-app-url.com';
  const resetUrl = `${base}/employee?reset=${token}`;
  try {
    await mailer.sendMail({
      from: SMTP_FROM,
      to: emp.email,
      subject: 'MotoLinker — Password Reset',
      html: `<p>Hi ${emp.name},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, ignore this email.</p>`,
    });
  } catch (e) { return res.status(500).json({ error: 'Failed to send email: ' + e.message }); }
  res.json({ ok: true });
});

// Reset password via token
receiver.router.post('/api/employee/reset-password', express.json(), async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const { data: row } = await supabase.from('password_reset_tokens')
    .select('id,employee_id,expires_at,used').eq('token', token).single();
  if (!row || row.used || new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Invalid or expired reset link' });
  await supabase.from('employees').update({ password_hash: hashPassword(newPassword) }).eq('id', row.employee_id);
  await supabase.from('password_reset_tokens').update({ used: true }).eq('id', row.id);
  res.json({ ok: true });
});

// Employee tasks list (for dropdown — only their assigned, non-done tasks)
receiver.router.get('/api/employee/tasks', requireEmployeeAuth, async (req, res) => {
  try {
    const all = await fetchEmployeeTasks(req.employee.id);
    res.json(all.filter(t => t.status !== 'done').map(t => ({ id: t.id, title: t.title, channel_name: t.channel_name, status: t.status })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fetch all tasks assigned to an employee — matches the legacy single assignee_id
// (employee id or old Slack user id) OR membership in the assignee_ids array.
async function fetchEmployeeTasks(employeeId) {
  const { data: emp } = await supabase.from('employees').select('slack_user_id').eq('id', employeeId).single();
  const ids = [String(employeeId), emp?.slack_user_id].filter(Boolean);
  const [single, multi] = await Promise.all([
    supabase.from('tasks').select('*').in('assignee_id', ids),
    supabase.from('tasks').select('*').contains('assignee_ids', [String(employeeId)]),
  ]);
  const seen = new Set();
  const all = [...(single.data || []), ...(multi.data || [])].filter(t => !seen.has(t.id) && seen.add(t.id));
  all.sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
  return all;
}

// All employee tasks (current + completed) for My Tasks page
receiver.router.get('/api/employee/my-tasks', requireEmployeeAuth, async (req, res) => {
  try {
    res.json(await fetchEmployeeTasks(req.employee.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee marks their own task as done
receiver.router.put('/api/employee/my-tasks/:id', requireEmployeeAuth, express.json(), async (req, res) => {  try {
    const { data: emp } = await supabase.from('employees').select('slack_user_id').eq('id', req.employee.id).single();
    const ids = [String(req.employee.id), emp?.slack_user_id].filter(Boolean);
    // Verify the task is actually assigned to this employee (single or multi assignee)
    const { data: task } = await supabase.from('tasks').select('id, assignee_id, assignee_ids, status').eq('id', req.params.id).single();
    const assigned = task && (ids.includes(task.assignee_id) || (Array.isArray(task.assignee_ids) && task.assignee_ids.map(String).includes(String(req.employee.id))));
    if (!assigned) return res.status(403).json({ error: 'Task not assigned to you' });
    const completedAt = new Date().toISOString();
    const { data, error } = await supabase.from('tasks')
      .update({ status: 'done', completed_at: completedAt, updated_at: completedAt })
      .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (task?.status !== 'done') runAutomations('task.completed', taskCtx(data));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee creates a new task (assigned to themselves)
receiver.router.post('/api/employee/my-tasks', requireEmployeeAuth, express.json(), async (req, res) => {
  try {
    const { title, description, due_date, priority, milestone } = req.body;
    if (!title || !due_date) return res.status(400).json({ error: 'Title and due date are required' });
    const { data: task, error } = await supabase.from('tasks')
      .insert({ title, description: description || '', channel_id: '', channel_name: '', assignee_id: String(req.employee.id), assignee_ids: [String(req.employee.id)], due_date, priority: priority || 'medium', milestone: milestone || '', created_by: req.employee.username, status: 'todo' })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    runAutomations('task.created', taskCtx(task));
    res.json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.get('/api/employee/hours', requireEmployeeAuth, async (req, res) => {
  const { data, error } = await supabase.from('hours_logs')
    .select('*, tasks(title, channel_name)')
    .eq('employee_id', req.employee.id)
    .order('logged_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
receiver.router.post('/api/employee/hours', requireEmployeeAuth, express.json(), async (req, res) => {
  const { task_id, task_description, hours, description, log_date } = req.body;
  if (!hours) return res.status(400).json({ error: 'Hours are required' });
  if (!task_id && !task_description) return res.status(400).json({ error: 'Either select a task or type a task name' });
  const insert = {
    employee_id: req.employee.id,
    user_id: req.employee.username,
    hours: parseFloat(hours),
    description: description || '',
    log_date: log_date || new Date().toISOString().split('T')[0],
    task_description: task_description || '',
  };
  if (task_id) insert.task_id = parseInt(task_id);
  const { data, error } = await supabase.from('hours_logs').insert(insert).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Admin: Employee management ────────────────────────────────────────────────
receiver.router.get('/api/dashboard/employees', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('employees').select('id, name, username, email, job_title, slack_user_id, permissions, created_at, avatar_url, status_text, status_emoji').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(e => ({ ...e, permissions: normEmpPerms(e.permissions) })));
});
receiver.router.post('/api/dashboard/employees', requireAuth, express.json(), async (req, res) => {
  const { name, username, password, email, job_title, slack_user_id, permissions } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' });
  const { data: existing } = await supabase.from('employees').select('id').eq('username', username).single();
  if (existing) return res.status(409).json({ error: 'Username already taken' });
  const perms = normEmpPerms(permissions);
  const { data, error } = await supabase.from('employees')
    .insert({ name, username, password_hash: hashPassword(password), email: (email || '').toLowerCase().trim(), job_title: job_title || '', slack_user_id: slack_user_id || '', permissions: perms })
    .select('id, name, username, email, job_title, slack_user_id, permissions, created_at, avatar_url, status_text, status_emoji').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.put('/api/dashboard/employees/:id', requireAuth, express.json(), async (req, res) => {
  const { name, username, password, email, job_title, slack_user_id, permissions } = req.body;
  const updates = { name, username, email: (email || '').toLowerCase().trim(), job_title: job_title || '', slack_user_id: slack_user_id || '', updated_at: new Date().toISOString() };
  if (password) updates.password_hash = hashPassword(password);
  if (permissions) updates.permissions = normEmpPerms(permissions);
  const { data, error } = await supabase.from('employees').update(updates).eq('id', req.params.id)
    .select('id, name, username, email, job_title, slack_user_id, permissions, created_at, avatar_url, status_text, status_emoji').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.delete('/api/dashboard/employees/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('employees').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

receiver.router.get('/api/dashboard/employees-for-tasks', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('employees').select('id,name,slack_user_id').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Website inventory search (attach a vehicle to a lead) ─────────────────────
receiver.router.get('/api/dashboard/inventory/search', requireAuth, async (req, res) => {
  res.json(await inventorySearch(req.query.q, 20));
});
receiver.router.get('/api/employee/inventory/search', requireEmployeeAuth, async (req, res) => {
  const emp = req.employee;
  if (!(empCan(emp, 'leads', 'create') || empCan(emp, 'leads', 'edit') || empCan(emp, 'quotation', 'draft') || empCan(emp, 'quotation', 'attachLead'))) {
    return res.status(403).json({ error: 'Not permitted' });
  }
  res.json(await inventorySearch(req.query.q, 20));
});

// ── Customers ─────────────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/customers', requireAuth, async (req, res) => {
  let query = supabase.from('customers').select('*').order('created_at', { ascending: false });
  // Strip PostgREST-structural chars ( , ( ) * " \ % ) so terms like "Smith, Jr" or "(010)" don't break the .or() filter
  const q = String(req.query.q || '').replace(/[,()*"\\%]/g, ' ').trim();
  if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/customers', requireAuth, express.json(), async (req, res) => {
  const { name, phone, email, source, notes, lead_date, lead_time, lead_status, car_in_question, budget_lead, budget_max, next_action, been_contacted, sales_feedback, inquiry, custom_fields, assigned_to, force } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const phone_norm = normalizePhone(phone);
  // Duplicate guard: a matching normalized phone -> 409 with the existing lead (unless the caller forces).
  if (phone_norm && !force) {
    const { data: dup } = await supabase.from('customers').select('id,name,phone,lead_status').eq('phone_norm', phone_norm).limit(1);
    if (dup && dup.length) return res.status(409).json({ duplicate: true, existing: dup[0] });
  }
  const { data, error } = await supabase.from('customers')
    .insert({ name, phone: phone||'', phone_norm, email: email||'', source: source||'', notes: notes||'', lead_date: lead_date||null, lead_time: lead_time||'', lead_status: lead_status||'cold', car_in_question: car_in_question||'', budget_lead: budget_lead||null, budget_max: budget_max||null, next_action: next_action||'', been_contacted: been_contacted||false, sales_feedback: sales_feedback||'', inquiry: inquiry||'', assigned_to: assigned_to||null, ...(custom_fields && Object.keys(custom_fields).length ? { custom_fields } : {}), created_by: 'dashboard' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(data.id, { type: 'system', body: `Lead created${data.source ? ' · ' + data.source : ''}`, authorKey: 'admin', authorName: 'Admin' });
  // Auto-create deal if status is Hot on creation
  if (data.lead_status === 'hot') {
    supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question||'', budget_egp: data.budget_lead||null, notes: 'Auto-created from Hot lead', created_by: 'system' }).then(()=>{}).catch(()=>{});
  }
  runAutomations('lead.created', leadCtx(data));
  res.json(data);
});

// CSV / Spreadsheet import
const multerCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
function parseCsvLine(line) {
  const values = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; } else if (ch === ',' && !inQuotes) { values.push(current); current = ''; } else { current += ch; }
  }
  values.push(current); return values;
}
function normalizeLeadDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Already ISO (YYYY-MM-DD or YYYY/MM/DD)
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // Day-first or month-first: D-M-YYYY, DD/MM/YYYY, etc. (Egypt → day-first default)
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    let day = parseInt(a, 10), mon = parseInt(b, 10);
    if (day > 12 && mon <= 12) { /* clearly day-first */ }
    else if (mon > 12 && day <= 12) { [day, mon] = [mon, day]; } // clearly month-first
    // else ambiguous → keep day-first
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // Fallback: let Date try, otherwise null
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    // Format from local components (not toISOString) so the server timezone can't shift the date a day
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return null;
}

// Canonicalize a phone number for duplicate detection (Egypt-aware): digits only,
// drop 0020 / leading 20 country code -> local 01XXXXXXXXX form.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = '0' + d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = '0' + d;
  return d;
}

// Parse one budget token ("1700000", "1.7m", "500k", "1,700,000") -> integer or null.
function parseBudgetPart(s) {
  s = String(s == null ? '' : s).trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '').replace(/egp|le|£|\$/g, '');
  if (!s) return null;
  let mult = 1;
  if (/[km]$/.test(s)) { mult = s.endsWith('m') ? 1e6 : 1e3; s = s.slice(0, -1); }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return Math.round(n * mult);
}
// Parse a budget input into { min, max } (max null for a single value). Accepts plain
// numbers, k/m suffixes, comma separators, and ranges ("1700000-2000000", "1.7M to 2M").
function parseBudget(raw) {
  const str = String(raw == null ? '' : raw).trim();
  if (!str) return { min: null, max: null };
  const parts = str.split(/\s*(?:-|–|—|to|:|\/)\s*/i).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    let a = parseBudgetPart(parts[0]), b = parseBudgetPart(parts[parts.length - 1]);
    if (a != null && b != null && a > b) { const t = a; a = b; b = t; }
    return { min: a != null ? a : b, max: (a != null && b != null) ? b : null };
  }
  return { min: parseBudgetPart(str), max: null };
}

// ── Shared leads-CSV parser (used by both admin + employee import routes) ──────
// Tolerant of the column names people actually use: an alias table for built-ins,
// custom-column (cf_*) mapping from the saved config, quote-aware header parsing,
// and BOM-safe. Returns { rows, unmatchedHeaders } (or { error } for bad input).
const CSV_HEADER_ALIASES = {
  name: ['name','full_name','fullname','customer_name','client_name','lead_name','contact_name','الاسم','اسم'],
  phone: ['phone','mobile','mobile_number','phone_number','phoneno','tel','telephone','whatsapp','contact','contact_number','number','رقم','الهاتف','الموبايل'],
  email: ['email','e_mail','mail','email_address','الايميل','البريد'],
  source: ['source','origin','lead_source','channel','المصدر'],
  notes: ['notes','note','comment','comments','remark','remarks','description','ملاحظات','ملاحظة'],
  date: ['date','lead_date','created','created_at','created_date','entry_date','التاريخ'],
  time: ['time','lead_time','الوقت'],
  status: ['status','lead_status','stage','state','الحالة'],
  car: ['car','car_in_question','vehicle','car_model','model','interested_in','car_of_interest','vehicle_requested','requested_vehicle','vehicle_request','car_requested','requested_car','vehicle_of_interest','vehicle_needed','vehicle_model','vehicle_type','السيارة','العربية','الموديل','السياره','المركبة'],
  budget: ['budget','budget_lead','budget_egp','price','amount','value','الميزانية','السعر'],
  next_action: ['next_action','next_step','action','followup_action','الاجراء'],
  been_contacted: ['been_contacted','inquiry','is_contacted','has_been_contacted','تم_التواصل'],
  sales_feedback: ['sales_feedback','feedback','sales_notes'],
  inquiry: ['inquiry','enquiry','question','الاستفسار'],
  assigned_to: ['assigned_to','owner','assignee','rep','sales_rep','salesperson','agent','sales','المسؤول','الموظف'],
};
// Default enum option keys (mirrors LEAD_DEFAULT_COLS) so values canonicalize even
// when the column config has never been customized.
const LEADS_ENUM_DEFAULTS = {
  status: [['cold','Cold'],['warm','Warm'],['hot','Hot'],['immediate_delivery','Immediate Delivery'],['not_interested','Not Interested'],['blacklist','Blacklist']],
  source: [['fb_ad','FB Ad.'],['whatsapp','Whatsapp'],['messenger','Messenger'],['direct_call','Direct Call'],['ig_ads','IG ads'],['website','Website'],['walk_in','Walk-in'],['marketplace','Marketplace']],
  next_action: [['followed_by_sales','Followed By Sales'],['need_follow_up','Need Follow Up'],['closed','Closed'],['no_answer','No Answer']],
};
const CSV_FIELD_TO_COLKEY = { status: 'lead_status', source: 'source', next_action: 'next_action' };
function csvNormHeader(h) {
  return String(h == null ? '' : h).replace(/^﻿/, '').trim().toLowerCase().replace(/^"|"$/g, '').replace(/[\s\-]+/g, '_').replace(/[^\w؀-ۿ]/g, '');
}
function csvSlug(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^\w؀-ۿ]/g, '');
}
// Map an imported enum value to its stored option key (e.g. "Warm"→"warm",
// "FB Ad."→"fb_ad"); keep the raw value when nothing matches.
function canonicalizeLeadEnum(field, raw, cols) {
  const val = String(raw == null ? '' : raw).trim();
  if (!val) return '';
  const col = Array.isArray(cols) ? cols.find(c => c && c.key === CSV_FIELD_TO_COLKEY[field]) : null;
  const opts = (col && Array.isArray(col.options) && col.options.length)
    ? col.options.map(o => [o.key, o.label]) : (LEADS_ENUM_DEFAULTS[field] || []);
  const map = {};
  opts.forEach(([k, label]) => { map[csvSlug(k)] = k; map[csvSlug(label)] = k; });
  return map[csvSlug(val)] || val;
}
async function loadLeadsColsConfig() {
  try {
    const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'leads_columns_config').single();
    if (data?.value) return JSON.parse(data.value);
  } catch (_) {}
  return null;
}
// Maps a built-in leads column key -> the canonical field the row builder fills.
// (Virtual columns next_followup/owner are absent → not importable.)
const BUILTIN_KEY_TO_FIELD = {
  lead_date: 'date', lead_time: 'time', name: 'name', phone: 'phone', email: 'email',
  lead_status: 'status', source: 'source', car_in_question: 'car', budget_lead: 'budget',
  next_action: 'next_action', been_contacted: 'been_contacted', sales_feedback: 'sales_feedback',
  inquiry: 'inquiry', notes: 'notes',
};
function parseLeadsCsv(csvText, cols, employees) {
  const clean = String(csvText || '').replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return { rows: [], unmatchedHeaders: [], error: 'Need header row + at least one data row' };
  const rawHeaders = parseCsvLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
  // Reverse alias lookup: normalized header -> canonical built-in field (default synonyms).
  const aliasLookup = {};
  for (const [field, aliases] of Object.entries(CSV_HEADER_ALIASES)) {
    aliasLookup[csvNormHeader(field)] = field;
    aliases.forEach(a => { aliasLookup[csvNormHeader(a)] = field; });
  }
  // Match against the user's ACTUAL columns (by current label + key) — including
  // built-ins they've RENAMED (e.g. car_in_question labelled "Vehicle Requested").
  // Built-ins registered first, then customs, so a CUSTOM column wins on a label
  // collision — this routes e.g. "Availability" to the user's text cf_availability
  // rather than the built-in been_contacted (a boolean that can't hold the value).
  const labelLookup = {};
  const list = Array.isArray(cols) ? cols : [];
  list.filter(c => c && typeof c.key === 'string' && !c.key.startsWith('cf_') && !c.deleted && BUILTIN_KEY_TO_FIELD[c.key]).forEach(c => {
    const t = { field: BUILTIN_KEY_TO_FIELD[c.key] };
    labelLookup[csvNormHeader(c.key)] = t;
    if (c.label) labelLookup[csvNormHeader(c.label)] = t;
  });
  list.filter(c => c && typeof c.key === 'string' && c.key.startsWith('cf_') && !c.deleted).forEach(c => {
    const t = { cf: c.key };
    labelLookup[csvNormHeader(c.key)] = t;
    labelLookup[csvNormHeader(c.key.replace(/^cf_/, ''))] = t;
    if (c.label) labelLookup[csvNormHeader(c.label)] = t;
  });
  const colMap = rawHeaders.map(h => {
    const n = csvNormHeader(h);
    if (labelLookup[n]) return labelLookup[n];         // existing column (renamed built-in or custom)
    if (aliasLookup[n]) return { field: aliasLookup[n] }; // default synonym
    return { raw: h };
  });
  // assigned_to (name/username/email) -> employee id.
  const empBySlug = {};
  (Array.isArray(employees) ? employees : []).forEach(e => {
    [e.name, e.username, e.email].forEach(v => { const s = csvSlug(v); if (s) empBySlug[s] = e.id; });
  });
  const dataRows = lines.slice(1).map(line => parseCsvLine(line).map(v => (v || '').trim().replace(/^"|"$/g, '')));
  // Headers that match no existing column and no alias — reported, never auto-created.
  const unmatchedHeaders = colMap.map((m, i) => (m.raw != null ? rawHeaders[i] : null)).filter(h => h && h.trim());
  const rows = dataRows.map(vals => {
    const f = {}, cf = {};
    colMap.forEach((m, i) => {
      const v = vals[i] || '';
      if (m.field) { if (f[m.field] == null || f[m.field] === '') f[m.field] = v; }
      else if (m.cf && v) { cf[m.cf] = v; }
    });
    return { f, cf };
  }).filter(x => x.f.name && x.f.name.trim()).map(({ f, cf }) => {
    const phone = f.phone || '';
    const bud = parseBudget(f.budget);
    const aid = empBySlug[csvSlug(f.assigned_to)];
    // Every row carries the SAME keys (custom_fields + assigned_to always present),
    // so the bulk insert's column set — derived from the first row — never omits them.
    return {
      name: f.name.trim(), phone, phone_norm: normalizePhone(phone), email: f.email || '',
      source: canonicalizeLeadEnum('source', f.source, cols),
      notes: f.notes || '', lead_date: normalizeLeadDate(f.date), lead_time: f.time || '',
      lead_status: canonicalizeLeadEnum('status', f.status, cols) || 'cold',
      car_in_question: f.car || '', budget_lead: bud.min, budget_max: bud.max,
      next_action: canonicalizeLeadEnum('next_action', f.next_action, cols),
      been_contacted: /^(true|1|yes|y|x|✓|✔|نعم|صح)$/i.test((f.been_contacted || '').trim()),
      sales_feedback: f.sales_feedback || '', inquiry: f.inquiry || '', created_by: 'csv_import',
      custom_fields: cf, assigned_to: aid || null,
    };
  });
  return { rows, unmatchedHeaders };
}
// Dedup key for a parsed row: normalized phone when present, else a composite of
// name + vehicle + budget + date so phone-less leads don't duplicate on re-import.
function leadDedupKey(r) {
  if (r.phone_norm) return 'p:' + r.phone_norm;
  return 'c:' + csvSlug(r.name) + '|' + csvSlug(r.car_in_question) + '|' + (r.budget_lead == null ? '' : r.budget_lead) + '|' + (r.lead_date || '');
}
// Filter parsed rows against the DB + within the file. Phoned rows dedup on phone;
// phone-less rows dedup on the name+vehicle+budget+date composite (so they don't
// duplicate on re-import). Returns { toInsert, skippedNames }.
async function dedupLeadRows(rows) {
  const existing = new Set();
  const norms = [...new Set(rows.map(r => r.phone_norm).filter(Boolean))];
  for (let i = 0; i < norms.length; i += 200) {
    const { data: ex } = await supabase.from('customers').select('phone_norm').in('phone_norm', norms.slice(i, i + 200));
    (ex || []).forEach(e => { if (e.phone_norm) existing.add('p:' + e.phone_norm); });
  }
  const phonelessNames = [...new Set(rows.filter(r => !r.phone_norm).map(r => r.name).filter(Boolean))];
  for (let i = 0; i < phonelessNames.length; i += 200) {
    const { data: ex } = await supabase.from('customers').select('name,car_in_question,budget_lead,lead_date').in('name', phonelessNames.slice(i, i + 200));
    (ex || []).forEach(e => existing.add(leadDedupKey({ phone_norm: '', name: e.name, car_in_question: e.car_in_question, budget_lead: e.budget_lead, lead_date: e.lead_date })));
  }
  const seen = new Set();
  const skippedNames = [];
  const toInsert = rows.filter(r => {
    const k = leadDedupKey(r);
    if (existing.has(k) || seen.has(k)) { skippedNames.push(r.name); return false; }
    seen.add(k);
    return true;
  });
  // Guard the PostgREST first-row-defines-columns gotcha: every row carries custom_fields.
  toInsert.forEach(r => { if (r.custom_fields == null) r.custom_fields = {}; });
  return { toInsert, skippedNames };
}

// ── Import "update existing leads" (fill blanks) ──────────────────────────────
// Index existing leads that any parsed row could match (phone, else name
// composite), carrying their current values so we can fill only empty fields.
const IMPORT_MATCH_COLS = 'id,name,phone,phone_norm,email,source,notes,lead_date,lead_time,lead_status,car_in_question,budget_lead,budget_max,next_action,been_contacted,sales_feedback,inquiry,assigned_to,custom_fields';
async function loadExistingLeadsByKey(rows) {
  const byKey = new Map();
  const norms = [...new Set(rows.map(r => r.phone_norm).filter(Boolean))];
  for (let i = 0; i < norms.length; i += 200) {
    const { data: ex } = await supabase.from('customers').select(IMPORT_MATCH_COLS).in('phone_norm', norms.slice(i, i + 200));
    (ex || []).forEach(e => { const k = 'p:' + e.phone_norm; if (e.phone_norm && !byKey.has(k)) byKey.set(k, e); });
  }
  const names = [...new Set(rows.filter(r => !r.phone_norm).map(r => r.name).filter(Boolean))];
  for (let i = 0; i < names.length; i += 200) {
    const { data: ex } = await supabase.from('customers').select(IMPORT_MATCH_COLS).in('name', names.slice(i, i + 200));
    (ex || []).forEach(e => { const k = leadDedupKey({ phone_norm: '', name: e.name, car_in_question: e.car_in_question, budget_lead: e.budget_lead, lead_date: e.lead_date }); if (!byKey.has(k)) byKey.set(k, e); });
  }
  return byKey;
}
// Build a patch that ONLY fills fields empty in the CRM — never overwrites data
// already there. Blank sheet cells are ignored. custom_fields merge key-by-key.
const IMPORT_FILL_FIELDS = ['name', 'phone', 'email', 'source', 'notes', 'lead_date', 'lead_time', 'lead_status', 'car_in_question', 'budget_lead', 'budget_max', 'next_action', 'sales_feedback', 'inquiry'];
function fillEmptyPatch(incoming, current) {
  const patch = {}; const isEmpty = v => v == null || v === '';
  for (const k of IMPORT_FILL_FIELDS) { const inc = incoming[k]; if (isEmpty(inc)) continue; if (isEmpty(current[k])) patch[k] = inc; }
  if (incoming.been_contacted && !current.been_contacted) patch.been_contacted = true;
  if (incoming.assigned_to != null && current.assigned_to == null) patch.assigned_to = incoming.assigned_to;
  const incCf = incoming.custom_fields || {}, curCf = current.custom_fields || {};
  const merged = { ...curCf }; let ch = false;
  for (const [k, v] of Object.entries(incCf)) { if (v == null || v === '') continue; if (curCf[k] == null || curCf[k] === '') { merged[k] = v; ch = true; } }
  if (ch) patch.custom_fields = merged;
  if (Object.prototype.hasOwnProperty.call(patch, 'phone')) patch.phone_norm = normalizePhone(patch.phone);
  return patch;
}
// Auto-create a "lead"-stage deal for each Hot lead that doesn't already have
// one — mirrors the single-lead Hot→deal behavior (create/status-change) so
// imported Hot leads show up in Deals without needing a manual status toggle.
// Batched + duplicate-guarded. `leads` need id, name, car_in_question,
// budget_lead, lead_status. Returns the number of deals created.
async function autoCreateDealsForHotLeads(leads) {
  const hot = (leads || []).filter(l => l && l.id && l.lead_status === 'hot');
  if (!hot.length) return 0;
  const ids = hot.map(l => l.id);
  const withDeal = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('deals').select('customer_id').in('customer_id', ids.slice(i, i + 200));
    (data || []).forEach(d => withDeal.add(d.customer_id));
  }
  const toCreate = hot.filter(l => !withDeal.has(l.id)).map(l => ({
    customer_id: l.id,
    title: `${l.name}${l.car_in_question ? ' — ' + l.car_in_question : ''}`,
    stage: 'lead', car_model: l.car_in_question || '', budget_egp: l.budget_lead || null,
    notes: 'Auto-created from Hot lead', created_by: 'system',
  }));
  if (!toCreate.length) return 0;
  const { error } = await supabase.from('deals').insert(toCreate);
  if (error) { console.warn('[import] auto-deal failed:', error.message); return 0; }
  toCreate.forEach(d => logLeadActivity(d.customer_id, { type: 'deal', body: 'Deal auto-created from Hot status', authorKey: 'system', authorName: 'System' }));
  console.log('[import] auto-created', toCreate.length, 'deal(s) for hot leads');
  return toCreate.length;
}

// One-time backfill: Hot leads created before the import→deal fix have no deal.
// Runs once (guarded by a KV flag) shortly after boot so they appear in Deals.
async function backfillHotLeadDeals() {
  try {
    const { data: flag } = await supabase.from('quotation_settings').select('value').eq('key', 'hot_deal_backfill_v1').single();
    if (flag?.value === 'done') return;
    const { data: hotLeads, error } = await supabase.from('customers').select('id,name,car_in_question,budget_lead,lead_status').eq('lead_status', 'hot').limit(5000);
    if (error) { console.warn('[backfill] hot-lead scan failed:', error.message); return; }
    const n = await autoCreateDealsForHotLeads(hotLeads || []);
    await supabase.from('quotation_settings').upsert({ key: 'hot_deal_backfill_v1', value: 'done' }, { onConflict: 'key' });
    console.log('[backfill] hot-lead deals:', n, 'created; marked done');
  } catch (e) { console.warn('[backfill] hot-lead deals error:', e.message); }
}

// Shared import: insert new leads and (when updateExisting) fill blanks on
// matched ones, then auto-create deals for any Hot leads.
// Returns { inserted, updated, skipped, deals }.
async function importLeadRows(rows, updateExisting) {
  if (!updateExisting) {
    const { toInsert, skippedNames } = await dedupLeadRows(rows);
    let deals = 0;
    if (toInsert.length) {
      const { data: created, error } = await supabase.from('customers').insert(toInsert).select('id,name,car_in_question,budget_lead,lead_status');
      if (error) throw new Error(error.message);
      deals = await autoCreateDealsForHotLeads(created);
    }
    return { inserted: toInsert.length, updated: 0, skipped: skippedNames.length, skippedNames, deals };
  }
  const idx = await loadExistingLeadsByKey(rows);
  let updated = 0, skipped = 0;
  const toInsert = [], seen = new Set(), becameHot = [];
  for (const row of rows) {
    const key = leadDedupKey(row);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const cur = idx.get(key);
    if (cur) {
      const patch = fillEmptyPatch(row, cur);
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        const { error } = await supabase.from('customers').update(patch).eq('id', cur.id);
        if (error) throw new Error(error.message);
        updated++;
        // A lead whose (previously empty) status is now filled to Hot gets a deal too.
        if (patch.lead_status === 'hot' && cur.lead_status !== 'hot') {
          becameHot.push({ id: cur.id, name: patch.name || cur.name, car_in_question: patch.car_in_question || cur.car_in_question, budget_lead: patch.budget_lead != null ? patch.budget_lead : cur.budget_lead, lead_status: 'hot' });
        }
      } else skipped++;
    } else {
      toInsert.push({ ...row, custom_fields: row.custom_fields || {} });
    }
  }
  let created = [];
  if (toInsert.length) {
    const { data, error } = await supabase.from('customers').insert(toInsert).select('id,name,car_in_question,budget_lead,lead_status');
    if (error) throw new Error(error.message);
    created = data || [];
  }
  const deals = await autoCreateDealsForHotLeads([...created, ...becameHot]);
  return { inserted: toInsert.length, updated, skipped, skippedNames: [], deals };
}

receiver.router.post('/api/dashboard/customers/import', requireAuth, multerCsv.single('file'), express.json(), async (req, res) => {
  try {
    let csvText = '';
    if (req.file) {
      csvText = req.file.buffer.toString('utf8');
    } else if (req.body?.sheetUrl) {
      const match = req.body.sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) return res.status(400).json({ error: 'Invalid Google Sheets URL' });
      const nodeFetch = require('node-fetch');
      const r = await nodeFetch(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`);
      if (!r.ok) return res.status(400).json({ error: 'Could not fetch spreadsheet — make sure it is publicly accessible.' });
      csvText = await r.text();
    }
    if (!csvText) return res.status(400).json({ error: 'No data to import' });
    const { data: emps } = await supabase.from('employees').select('id,name,username,email');
    const cols = await loadLeadsColsConfig();
    const { rows, unmatchedHeaders, error: parseErr } = parseLeadsCsv(csvText, cols, emps || []);
    if (parseErr) return res.status(400).json({ error: parseErr });
    if (!rows.length) return res.status(400).json({ error: 'No valid rows (Name column is required)' });
    const updateExisting = String(req.body?.updateExisting) === 'true';
    const { inserted, updated, skipped, skippedNames, deals } = await importLeadRows(rows, updateExisting);
    res.json({ count: inserted, inserted, updated, skipped, deals, skippedNames: (skippedNames || []).slice(0, 50), unmatchedHeaders });
  } catch (e) { console.error('[csv-import]', e); res.status(500).json({ error: e.message }); }
});

// Best-effort insert into the lead activity timeline (never blocks the caller)
async function logLeadActivity(customerId, { type = 'note', body = '', meta = {}, authorKey = '', authorName = '' }) {
  if (!customerId) return;
  try {
    await supabase.from('lead_activities').insert({ customer_id: customerId, type, body, meta, author_key: authorKey, author_name: authorName });
  } catch (e) { console.warn('[lead-activity] insert failed:', e.message); }
}

receiver.router.put('/api/dashboard/customers/:id', requireAuth, express.json(), async (req, res) => {
  const { data: prev } = await supabase.from('customers').select('lead_status,been_contacted').eq('id', req.params.id).single();
  const patch = { ...req.body, updated_at: new Date().toISOString() };
  delete patch.force;
  if (Object.prototype.hasOwnProperty.call(patch, 'phone')) patch.phone_norm = normalizePhone(patch.phone);
  const { data, error } = await supabase.from('customers')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Timeline: status change + contacted flip
  if (prev && data.lead_status !== prev.lead_status) {
    logLeadActivity(data.id, { type: 'status_change', body: `Status changed`, meta: { from: prev.lead_status || 'cold', to: data.lead_status || 'cold' }, authorKey: 'admin', authorName: 'Admin' });
  }
  if (prev && !prev.been_contacted && data.been_contacted) {
    logLeadActivity(data.id, { type: 'system', body: 'Marked as contacted', authorKey: 'admin', authorName: 'Admin' });
  }
  // Auto-create deal when status changes to Hot
  if (data.lead_status === 'hot' && prev?.lead_status !== 'hot') {
    try {
      const { data: existing } = await supabase.from('deals').select('id').eq('customer_id', data.id).limit(1);
      if (!existing?.length) {
        await supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question||'', budget_egp: data.budget_lead||null, notes: 'Auto-created from Hot lead', created_by: 'system' });
        logLeadActivity(data.id, { type: 'deal', body: 'Deal auto-created from Hot status', authorKey: 'system', authorName: 'System' });
        console.log('[leads] Auto-created deal for hot lead', data.id);
      }
    } catch (e) { console.warn('[leads] Auto-deal failed:', e.message); }
  }
  if (prev && data.lead_status !== prev.lead_status) runAutomations('lead.status_changed', { ...leadCtx(data), from: prev.lead_status, to: data.lead_status });
  if (prev && !prev.been_contacted && data.been_contacted) runAutomations('lead.contacted', leadCtx(data));
  res.json(data);
});

receiver.router.delete('/api/dashboard/customers/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('customers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── De-dupe tool ──────────────────────────────────────────────────────────────
// Groups leads by the same key the importer uses (phone, else name+car+budget+date).
// The oldest row in each group is the keeper; the rest are offered for removal.
// Preview-only: nothing is deleted until the client POSTs the ids back to /dedupe.
receiver.router.get('/api/dashboard/customers/duplicates', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('customers')
    .select('id,name,phone,phone_norm,car_in_question,budget_lead,lead_date,created_at')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const groups = new Map();
  for (const c of data || []) {
    const k = leadDedupKey({ phone_norm: c.phone_norm, name: c.name, car_in_question: c.car_in_question, budget_lead: c.budget_lead, lead_date: c.lead_date });
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const dupes = [];
  for (const [k, members] of groups) {
    if (members.length < 2) continue;
    members.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id - b.id);
    dupes.push({ key: k, keeper: members[0], remove: members.slice(1) });
  }
  const totalRemove = dupes.reduce((n, g) => n + g.remove.length, 0);
  res.json({ groups: dupes, groupCount: dupes.length, totalRemove });
});

receiver.router.post('/api/dashboard/customers/dedupe', requireAuth, express.json(), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  if (!ids.length) return res.status(400).json({ error: 'No lead ids provided' });
  const { error } = await supabase.from('customers').delete().in('id', ids);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: ids.length });
});

// ── Lead 360° profile: timeline, follow-ups, linked quotations & deals ────────
receiver.router.get('/api/dashboard/customers/:id/profile', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { data: customer, error } = await supabase.from('customers').select('*').eq('id', id).single();
  if (error || !customer) return res.status(404).json({ error: 'Lead not found' });
  const [activities, followups, quotations, deals, contracts, purchaseOrders] = await Promise.all([
    supabase.from('lead_activities').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('lead_followups').select('*').eq('customer_id', id).order('due_at', { ascending: true }),
    supabase.from('quotations').select('id,quote_id,title,created_by,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('deals').select('id,title,stage,budget_egp,created_at').eq('customer_id', id).order('created_at', { ascending: false }),
    supabase.from('contracts').select('id,contract_no,title,status,created_by,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('purchase_orders').select('id,po_number,title,supplier,status,items,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  res.json({
    customer,
    activities: activities.data || [],
    followups: followups.data || [],
    quotations: quotations.data || [],
    deals: deals.data || [],
    contracts: contracts.data || [],
    purchaseOrders: purchaseOrders.data || [],
  });
});

receiver.router.post('/api/dashboard/customers/:id/activities', requireAuth, express.json(), async (req, res) => {
  const type = ['note', 'call', 'whatsapp', 'meeting'].includes(req.body?.type) ? req.body.type : 'note';
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Activity text is required' });
  const { data, error } = await supabase.from('lead_activities')
    .insert({ customer_id: parseInt(req.params.id), type, body, author_key: 'admin', author_name: 'Admin' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.post('/api/dashboard/customers/:id/followups', requireAuth, express.json(), async (req, res) => {
  const due_at = req.body?.due_at;
  if (!due_at || isNaN(new Date(due_at).getTime())) return res.status(400).json({ error: 'A valid due date/time is required' });
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const assigned_to = req.body?.assigned_to ? parseInt(req.body.assigned_to) : null;
  const { data, error } = await supabase.from('lead_followups')
    .insert({ customer_id: parseInt(req.params.id), due_at: new Date(due_at).toISOString(), note, assigned_to, created_by: 'admin' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(data.customer_id, { type: 'follow_up', body: `Follow-up scheduled for ${new Date(data.due_at).toLocaleString()}${note ? ' — ' + note : ''}`, authorKey: 'admin', authorName: 'Admin' });
  res.json(data);
});

receiver.router.put('/api/dashboard/followups/:id', requireAuth, express.json(), async (req, res) => {
  const status = ['done', 'cancelled', 'pending'].includes(req.body?.status) ? req.body.status : 'done';
  const patch = { status, completed_at: status === 'done' ? new Date().toISOString() : null };
  const { data, error } = await supabase.from('lead_followups').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (status !== 'pending') {
    logLeadActivity(data.customer_id, { type: 'follow_up', body: status === 'done' ? 'Follow-up completed' : 'Follow-up cancelled', authorKey: 'admin', authorName: 'Admin' });
  }
  res.json(data);
});

// All pending follow-ups (for the leads-table column and the due chip)
receiver.router.get('/api/dashboard/followups/pending', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('lead_followups')
    .select('id,customer_id,due_at,note,assigned_to').eq('status', 'pending').order('due_at', { ascending: true }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Leads table column configuration (order, visibility, labels, dropdown options,
//    custom columns) — persisted in the quotation_settings KV table ──
receiver.router.get('/api/dashboard/leads/columns', requireAuth, async (_req, res) => {
  const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'leads_columns_config').single();
  let columns = null;
  try { if (data?.value) columns = JSON.parse(data.value); } catch (_) {}
  res.json({ columns });
});

receiver.router.put('/api/dashboard/leads/columns', requireAuth, express.json(), async (req, res) => {
  const columns = req.body?.columns;
  if (!Array.isArray(columns)) return res.status(400).json({ error: 'columns array required' });
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: 'leads_columns_config', value: JSON.stringify(columns) }, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Deals ─────────────────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/deals', requireAuth, async (req, res) => {
  let query = supabase.from('deals').select('*, customers(name,phone,email)').order('created_at', { ascending: false });
  if (req.query.stage) query = query.eq('stage', req.query.stage);
  if (req.query.assigned_to) query = query.eq('assigned_to', req.query.assigned_to);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/dashboard/deals', requireAuth, express.json(), async (req, res) => {
  const { customer_id, title, stage, car_model, budget_egp, notes, assigned_to } = req.body;
  if (!customer_id || !title) return res.status(400).json({ error: 'customer_id and title are required' });
  const { data, error } = await supabase.from('deals')
    .insert({ customer_id, title, stage: stage||'lead', car_model: car_model||'', budget_egp: budget_egp||null, notes: notes||'', assigned_to: assigned_to||'', created_by: 'dashboard' })
    .select('*, customers(name,phone,email)').single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(customer_id, { type: 'deal', body: `Deal created — ${title}`, authorKey: 'admin', authorName: 'Admin' });
  runAutomations('deal.created', dealCtx(data));
  res.json(data);
});

receiver.router.put('/api/dashboard/deals/:id', requireAuth, express.json(), async (req, res) => {
  const { data: prev } = await supabase.from('deals').select('stage').eq('id', req.params.id).single();
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  if ((updates.stage === 'won' || updates.stage === 'lost') && !updates.closed_at) updates.closed_at = new Date().toISOString();
  if (updates.stage && updates.stage !== 'won' && updates.stage !== 'lost') updates.closed_at = null;
  const { data, error } = await supabase.from('deals')
    .update(updates).eq('id', req.params.id).select('*, customers(name,phone,email,car_in_question,budget_lead)').single();
  if (error) return res.status(500).json({ error: error.message });
  // Notify configured employee when deal moves to 'inquiry'
  if (updates.stage === 'inquiry' && prev?.stage !== 'inquiry') {
    try {
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;
      const notifyId = settings.contact_notify_employee_id;
      if (notifyId) {
        const c = data.customers;
        const body = [`Lead: ${c?.name || data.title}`, c?.phone ? `Phone: ${c.phone}` : '', c?.car_in_question ? `Car: ${c.car_in_question}` : '', c?.budget_lead ? `Budget: ${Number(c.budget_lead).toLocaleString()} EGP` : ''].filter(Boolean).join(' · ');
        await createNotification(`employee_${notifyId}`, { type: 'lead', title: 'New lead to quote — ' + (c?.name || data.title), body, url: '/employee#quotation' }, 'always');
      }
    } catch (e) { console.warn('[deals] notify-contacted failed:', e.message); }
  }
  // Timeline: log the stage move on the linked lead
  if (updates.stage && prev?.stage !== updates.stage && data.customer_id) {
    const stageLabels = { lead: 'Lead', inquiry: 'Inquiry', quoted: 'Quoted', negotiating: 'Negotiating', won: 'Won', lost: 'Lost' };
    logLeadActivity(data.customer_id, { type: 'deal', body: `Deal moved to ${stageLabels[updates.stage] || updates.stage} — ${data.title}`, meta: { from: prev?.stage, to: updates.stage }, authorKey: 'admin', authorName: 'Admin' });
  }
  if (updates.stage && prev?.stage !== updates.stage) runAutomations('deal.stage_changed', { ...dealCtx(data), from: prev?.stage, to: updates.stage });
  // Won → draft the Arabic import contract (best-effort, never blocks the move)
  if (updates.stage === 'won' && prev?.stage !== 'won') {
    autoCreateContractForWonDeal(data);
    autoCreateSaleForWonDeal(data);
  }
  res.json(data);
});

receiver.router.delete('/api/dashboard/deals/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('deals').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Deletion requests (employees request; admin approves → actual delete) ───────
receiver.router.get('/api/dashboard/deletion-requests', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('deletion_requests').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
receiver.router.put('/api/dashboard/deletion-requests/:id', requireAuth, express.json(), async (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected' });
  const { data: dr } = await supabase.from('deletion_requests').select('*').eq('id', req.params.id).single();
  if (!dr) return res.status(404).json({ error: 'Not found' });
  if (dr.status !== 'pending') return res.status(409).json({ error: 'Already ' + dr.status });
  if (status === 'approved') {
    const table = dr.entity_type === 'lead' ? 'customers' : 'deals';
    const { error: delErr } = await supabase.from(table).delete().eq('id', dr.entity_id);
    if (delErr) return res.status(500).json({ error: delErr.message });
  }
  const { data: updated, error } = await supabase.from('deletion_requests').update({ status, reviewed_by: 'admin' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  try {
    const { data: emp } = await supabase.from('employees').select('id').eq('username', dr.requested_by).single();
    if (emp) createNotification(`employee_${emp.id}`, {
      type: 'request',
      title: status === 'approved' ? '✓ Deletion approved' : 'Deletion rejected',
      body: `${dr.entity_type === 'lead' ? 'Lead' : 'Deal'} "${dr.entity_label}" — ${status === 'approved' ? 'deleted' : 'kept'}`,
      url: dr.entity_type === 'lead' ? '/employee#leads' : '/employee#deals',
    }, 'always');
  } catch (_) {}
  res.json(updated);
});

// ─── No-code automation engine ──────────────────────────────────────────────────
// Config-driven trigger -> conditions -> actions rules (automation_rules table),
// fired best-effort from the lead/deal/quote mutation seams and an hourly sweep.
// Never throws into a request path.
function leadCtx(c) {
  return {
    entityType: 'lead', entityId: c.id, customerId: c.id, ownerId: c.assigned_to || null,
    fields: { name: c.name, phone: c.phone, source: c.source, lead_status: c.lead_status,
      car_in_question: c.car_in_question, budget_lead: c.budget_lead, been_contacted: c.been_contacted, assigned_to: c.assigned_to },
  };
}
function dealCtx(d) {
  return {
    entityType: 'deal', entityId: d.id, customerId: d.customer_id || null, ownerId: d.assigned_to || null,
    fields: { title: d.title, stage: d.stage, car_model: d.car_model, budget_egp: d.budget_egp,
      assigned_to: d.assigned_to, name: d.customers?.name, phone: d.customers?.phone, car_in_question: d.customers?.car_in_question, budget_lead: d.customers?.budget_lead },
  };
}
// ── Non-CRM automation contexts ──────────────────────────────────────────────
function taskCtx(t) {
  const primary = (Array.isArray(t.assignee_ids) && t.assignee_ids.length ? t.assignee_ids[0] : t.assignee_id) || null;
  return { entityType: 'task', entityId: t.id, customerId: null, ownerId: primary,
    fields: { title: t.title, priority: t.priority, status: t.status, milestone: t.milestone || '', assigned_to: primary, due_date: t.due_date } };
}
function requestCtx(r) {
  return { entityType: 'request', entityId: r.id, customerId: null, ownerId: r.assignee_id || null,
    fields: { title: r.title, priority: r.priority, status: r.status, category: r.category || '', assigned_to: r.assignee_id || null } };
}
function submissionCtx(s, customerId) {
  // The public form already creates/matches the lead (customerId), so lead-scoped
  // actions (assign, follow-up, …) work when it's linked.
  return { entityType: 'submission', entityId: s.id, customerId: customerId || null, ownerId: null,
    fields: { name: s.name, phone: s.phone, email: s.email, car_in_question: s.car_interest, source: s.source, message: s.message } };
}
function hoursCtx(emp) {
  return { entityType: 'hours', entityId: emp.id, customerId: null, ownerId: emp.id, fields: { name: emp.name } };
}
// Deep-link a notification to the right admin page for the entity that fired.
function autoNotifUrl(ctx) {
  switch (ctx.entityType) {
    case 'deal': return '/dashboard#deals';
    case 'task': return '/dashboard#tasks';
    case 'request': return '/dashboard#requests';
    case 'submission': return '/dashboard#submissions';
    case 'hours': return '/dashboard#hours';
    default: return '/dashboard#customers';
  }
}
function autoTmpl(str, ctx) {
  const f = ctx.fields || {};
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (f[k] != null ? String(f[k]) : ''));
}
function autoTarget(a, ctx) {
  const to = a.to || 'admin';
  if (to === 'owner') return ctx.ownerId ? `employee_${ctx.ownerId}` : 'admin';
  if (to === 'employee') return a.employee_id ? `employee_${a.employee_id}` : 'admin';
  return 'admin';
}
// Normalize a value for equality checks so a human-typed condition value matches the
// stored canonical key: "Quoted"→quoted, "Immediate Delivery"→immediate_delivery, "true"→true.
function autoNorm(s) { return String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'); }
function automationMatches(rule, ctx) {
  const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
  const vals = { ...(ctx.fields || {}), from: ctx.from, to: ctx.to };
  return conds.every(c => {
    const cur = vals[c.field], v = c.value;
    switch (c.op) {
      case 'equals': return autoNorm(cur) === autoNorm(v);
      case 'not_equals': return autoNorm(cur) !== autoNorm(v);
      case 'contains': return String(cur ?? '').toLowerCase().includes(String(v ?? '').toLowerCase());
      case 'changed_to': return autoNorm(ctx.to) === autoNorm(v);
      case 'gt': return Number(cur) > Number(v);
      case 'lt': return Number(cur) < Number(v);
      case 'is_empty': return !cur;
      case 'not_empty': return !!cur;
      default: return true;
    }
  });
}
async function autoRoundRobin() {
  const { data: emps } = await supabase.from('employees').select('id').order('id', { ascending: true });
  if (!emps || !emps.length) return null;
  let cursor = 0;
  try { const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'automation_rr_cursor').single(); cursor = parseInt(data?.value || '0', 10) || 0; } catch (_) {}
  const pick = emps[cursor % emps.length].id;
  await supabase.from('quotation_settings').upsert({ key: 'automation_rr_cursor', value: String((cursor + 1) % 1000000) }, { onConflict: 'key' }).then(() => {}).catch(() => {});
  return pick;
}
// Destructive automations don't delete directly — they file a pending deletion_request
// for an admin to approve (same flow as an employee-requested deletion). Returns true if a
// new request was created (false if one is already pending or the entity is gone).
async function autoRequestDeletion(entity_type, entity_id, ruleName) {
  let label = '';
  if (entity_type === 'lead') {
    const { data } = await supabase.from('customers').select('name,phone').eq('id', entity_id).single();
    if (!data) return false;
    label = data.name + (data.phone ? ' · ' + data.phone : '');
  } else {
    const { data } = await supabase.from('deals').select('title, customers(name)').eq('id', entity_id).single();
    if (!data) return false;
    label = data.title + (data.customers?.name ? ' · ' + data.customers.name : '');
  }
  const { data: existing } = await supabase.from('deletion_requests').select('id').eq('entity_type', entity_type).eq('entity_id', entity_id).eq('status', 'pending').limit(1);
  if (existing && existing.length) return false; // already awaiting approval
  await supabase.from('deletion_requests').insert({ entity_type, entity_id, entity_label: label, requested_by: 'automation', reason: `Automation: ${ruleName || 'rule'}`, status: 'pending' });
  return true;
}
async function runAutomationAction(a, ctx, ruleName) {
  switch (a.type) {
    case 'notify': {
      await createNotification(autoTarget(a, ctx), {
        type: 'automation', title: autoTmpl(a.title, ctx) || 'Automation',
        body: autoTmpl(a.body, ctx), url: autoNotifUrl(ctx),
      }, 'always');
      break;
    }
    case 'notify_all': {
      const { data: emps } = await supabase.from('employees').select('id');
      for (const e of (emps || [])) {
        await createNotification(`employee_${e.id}`, {
          type: 'automation', title: autoTmpl(a.title, ctx) || 'Announcement',
          body: autoTmpl(a.body, ctx), url: autoNotifUrl(ctx),
        }, 'always');
      }
      return `notify_all → ${(emps || []).length} employee(s)`;
    }
    case 'create_followup': {
      if (!ctx.customerId) return 'create_followup skipped — not linked to a lead';
      const days = Number(a.days) || 1;
      const assigned = a.assign_to === 'owner' ? (ctx.ownerId || null) : a.assign_to === 'employee' ? (a.employee_id || null) : null;
      await supabase.from('lead_followups').insert({ customer_id: ctx.customerId, due_at: new Date(Date.now() + days * 86400000).toISOString(), note: autoTmpl(a.note, ctx) || 'Automated follow-up', assigned_to: assigned, created_by: 'automation' });
      logLeadActivity(ctx.customerId, { type: 'follow_up', body: `Follow-up scheduled by automation (in ${days}d)`, authorKey: 'system', authorName: 'Automation' });
      break;
    }
    case 'create_task': {
      const days = Number(a.due_days) || 1;
      const aid = a.assignee_id ? String(a.assignee_id) : (a.assign_to === 'owner' && ctx.ownerId ? String(ctx.ownerId) : null);
      const ins = { title: autoTmpl(a.title, ctx) || 'Automated task', priority: a.priority || 'medium', due_date: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10), status: 'todo', created_by: 'automation', channel_id: '', channel_name: '' };
      if (aid) { ins.assignee_id = aid; ins.assignee_ids = [aid]; }
      const { data: t } = await supabase.from('tasks').insert(ins).select().single();
      if (aid && t) { const mk = await memberKeyForAssignee(aid); if (mk) createNotification(mk, { type: 'task', title: 'New task assigned', body: t.title, url: '/employee#tasks' }, 'always'); }
      break;
    }
    case 'create_deal': {
      if (!ctx.customerId) return 'create_deal skipped — not linked to a lead';
      const { data: existing } = await supabase.from('deals').select('id').eq('customer_id', ctx.customerId).limit(1);
      if (!existing?.length) {
        await supabase.from('deals').insert({ customer_id: ctx.customerId, title: autoTmpl(a.title, ctx) || ctx.fields?.name || 'Deal', stage: a.stage || 'lead', car_model: ctx.fields?.car_in_question || '', budget_egp: ctx.fields?.budget_lead || null, notes: 'Created by automation', created_by: 'automation' });
        logLeadActivity(ctx.customerId, { type: 'deal', body: 'Deal created by automation', authorKey: 'system', authorName: 'Automation' });
      }
      break;
    }
    case 'set_lead_status': {
      if (!ctx.customerId || !a.status) return 'set_lead_status skipped — not linked to a lead';
      // Direct update (bypasses the PUT handler) so this never re-triggers automations.
      await supabase.from('customers').update({ lead_status: a.status, updated_at: new Date().toISOString() }).eq('id', ctx.customerId);
      logLeadActivity(ctx.customerId, { type: 'status_change', body: 'Status set by automation', meta: { to: a.status }, authorKey: 'system', authorName: 'Automation' });
      break;
    }
    case 'assign_lead': {
      if (!ctx.customerId) return 'assign_lead skipped — not linked to a lead';
      const empId = a.mode === 'specific' ? (a.employee_id || null) : await autoRoundRobin();
      if (empId) {
        await supabase.from('customers').update({ assigned_to: empId, updated_at: new Date().toISOString() }).eq('id', ctx.customerId);
        logLeadActivity(ctx.customerId, { type: 'system', body: 'Lead assigned by automation', authorKey: 'system', authorName: 'Automation' });
        createNotification(`employee_${empId}`, { type: 'lead', title: 'Lead assigned to you', body: autoTmpl('{{name}} — {{phone}}', ctx), url: '/employee#leads' }, 'always');
      }
      break;
    }
    case 'edit_lead': {
      // Set one or more fields on the lead. Direct update (bypasses the PUT handler) so it never re-triggers automations.
      if (!ctx.customerId) return 'edit_lead skipped — not linked to a lead';
      const updates = Array.isArray(a.updates) ? a.updates : [];
      const patch = { updated_at: new Date().toISOString() };
      for (const u of updates) {
        if (!u || !u.field) continue;
        if (u.field === 'budget_lead') { const b = parseBudget(u.value); patch.budget_lead = b.min; patch.budget_max = b.max; continue; }
        if (u.field === 'been_contacted') { patch.been_contacted = (u.value === true || u.value === 'true' || u.value === '1'); continue; }
        if (u.field === 'assigned_to') { patch.assigned_to = u.value ? parseInt(u.value) : null; continue; }
        if (u.field === 'phone') { patch.phone = u.value || ''; patch.phone_norm = normalizePhone(u.value); continue; }
        patch[u.field] = u.value;
      }
      if (Object.keys(patch).length <= 1) return 'edit_lead skipped — no fields to set';
      await supabase.from('customers').update(patch).eq('id', ctx.customerId);
      logLeadActivity(ctx.customerId, { type: 'system', body: 'Lead profile updated by automation', authorKey: 'system', authorName: 'Automation' });
      break;
    }
    case 'delete_deals': {
      // Files a deletion request per linked deal for admin approval (does not delete directly).
      if (!ctx.customerId) return 'delete_deals skipped — not linked to a lead';
      const { data: deals } = await supabase.from('deals').select('id').eq('customer_id', ctx.customerId);
      let n = 0;
      for (const d of (deals || [])) { if (await autoRequestDeletion('deal', d.id, ruleName)) n++; }
      if (n) {
        createNotification('admin', { type: 'request', title: 'Deletion request — deals', body: `Automation "${ruleName || 'rule'}" asked to remove ${n} deal(s) for ${ctx.fields?.name || 'a lead'} — approval needed`, url: '/dashboard#deletions' }, 'always');
        logLeadActivity(ctx.customerId, { type: 'deal', body: `Deal removal requested by automation — awaiting admin approval`, authorKey: 'system', authorName: 'Automation' });
      }
      return n ? `delete_deals → ${n} deletion request(s) pending approval` : 'delete_deals skipped — no deals or already pending';
    }
    case 'delete_lead': {
      // Files a deletion request for admin approval (does not delete directly).
      if (!ctx.customerId) return 'delete_lead skipped — not linked to a lead';
      const ok = await autoRequestDeletion('lead', ctx.customerId, ruleName);
      if (ok) {
        createNotification('admin', { type: 'request', title: 'Deletion request — lead', body: `Automation "${ruleName || 'rule'}" asked to delete ${ctx.fields?.name || 'a lead'} — approval needed`, url: '/dashboard#deletions' }, 'always');
        logLeadActivity(ctx.customerId, { type: 'system', body: 'Lead deletion requested by automation — awaiting admin approval', authorKey: 'system', authorName: 'Automation' });
      }
      return ok ? 'delete_lead → deletion request pending approval' : 'delete_lead skipped — already pending';
    }
  }
}
async function runAutomationActions(rule, ctx, eventName) {
  const actions = Array.isArray(rule.actions) ? rule.actions : [];
  const done = [];
  for (const a of actions) { const note = await runAutomationAction(a, ctx, rule.name); done.push(note || a.type); }
  await supabase.from('automation_runs').insert({ rule_id: rule.id, event: eventName, entity_type: ctx.entityType, entity_id: ctx.entityId, status: 'ok', detail: done.join(',') }).then(() => {}).catch(() => {});
}
async function runAutomations(eventName, ctx) {
  try {
    const { data: rules } = await supabase.from('automation_rules').select('*').eq('enabled', true).eq('trigger_type', eventName);
    for (const rule of rules || []) {
      try {
        if (!automationMatches(rule, ctx)) continue;
        await runAutomationActions(rule, ctx, eventName);
      } catch (e) {
        console.warn('[automations] rule', rule.id, 'failed:', e.message);
        await supabase.from('automation_runs').insert({ rule_id: rule.id, event: eventName, entity_type: ctx.entityType, entity_id: ctx.entityId, status: 'error', detail: e.message }).then(() => {}).catch(() => {});
      }
    }
  } catch (e) { console.warn('[automations] run failed:', e.message); }
}
// Scheduled trigger: leads with no activity for N days (once per lead per window).
async function runNoActivitySweep() {
  try {
    const { data: rules } = await supabase.from('automation_rules').select('*').eq('enabled', true).eq('trigger_type', 'no_activity_days');
    if (!rules || !rules.length) return;
    const { data: leadsAll } = await supabase.from('customers').select('id,name,phone,source,lead_status,assigned_to,car_in_question,budget_lead').limit(1000);
    const leads = (leadsAll || []).filter(c => !['blacklist', 'not_interested'].includes(c.lead_status));
    for (const rule of rules) {
      const days = Number(rule.trigger_config?.days) || 3;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      for (const c of leads) {
        const { data: la } = await supabase.from('lead_activities').select('created_at').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(1);
        if (la?.[0]?.created_at && la[0].created_at > cutoff) continue;       // recent activity → skip
        const { data: fired } = await supabase.from('automation_runs').select('id').eq('rule_id', rule.id).eq('entity_id', c.id).gte('created_at', cutoff).limit(1);
        if (fired?.length) continue;                                          // already fired this window
        const ctx = leadCtx(c);
        if (!automationMatches(rule, ctx)) continue;
        await runAutomationActions(rule, ctx, 'no_activity_days');
      }
    }
  } catch (e) { console.warn('[automations] no-activity sweep failed:', e.message); }
}
// Scheduled trigger: tasks past their due date and still open (once per task).
async function runTaskOverdueSweep() {
  try {
    const { data: rules } = await supabase.from('automation_rules').select('*').eq('enabled', true).eq('trigger_type', 'task.overdue');
    if (!rules || !rules.length) return;
    const today = new Date().toISOString().split('T')[0];
    const { data: tasks } = await supabase.from('tasks').select('*').lt('due_date', today).neq('status', 'done').limit(2000);
    for (const rule of rules) {
      for (const t of (tasks || [])) {
        const { data: fired } = await supabase.from('automation_runs').select('id').eq('rule_id', rule.id).eq('entity_id', t.id).limit(1);
        if (fired?.length) continue;                       // already fired for this task
        const ctx = taskCtx(t);
        if (!automationMatches(rule, ctx)) continue;
        await runAutomationActions(rule, ctx, 'task.overdue');
      }
    }
  } catch (e) { console.warn('[automations] task-overdue sweep failed:', e.message); }
}
function scheduleAutomationSweep() {
  const sweep = () => { runNoActivitySweep().catch(console.error); runTaskOverdueSweep().catch(console.error); };
  setTimeout(sweep, 60 * 1000);
  setInterval(sweep, 60 * 60 * 1000);
}

// Automation rules CRUD
receiver.router.get('/api/dashboard/automations', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('automation_rules').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
receiver.router.post('/api/dashboard/automations', requireAuth, express.json(), async (req, res) => {
  const { name, trigger_type, trigger_config, conditions, actions, enabled } = req.body || {};
  if (!name || !trigger_type) return res.status(400).json({ error: 'name and trigger_type are required' });
  const { data, error } = await supabase.from('automation_rules').insert({
    name, trigger_type, trigger_config: trigger_config || {}, conditions: conditions || [], actions: actions || [],
    enabled: !!enabled, created_by: 'admin',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.put('/api/dashboard/automations/:id', requireAuth, express.json(), async (req, res) => {
  const patch = { ...req.body, updated_at: new Date().toISOString() };
  delete patch.id; delete patch.created_at;
  const { data, error } = await supabase.from('automation_rules').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.delete('/api/dashboard/automations/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('automation_rules').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
receiver.router.get('/api/dashboard/automations/:id/runs', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('automation_runs').select('*').eq('rule_id', req.params.id).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ─── Chat ─────────────────────────────────────────────────────────────────────
const chatSseClients = new Map(); // key: 'admin' | 'employee_<id>'

function chatBroadcast(memberKeys, eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  memberKeys.forEach(key => {
    const res = chatSseClients.get(key);
    if (res) try { res.write(data); } catch (_) {}
  });
}

function chatCallerIdentity(req) {
  if (req.employee) return { key: `employee_${req.employee.id}`, name: req.employee.name };
  return { key: 'admin', name: 'Admin' };
}

async function sendPushToOfflineMembers(memberKeys, payload) {
  if (!vapidKeys) return;
  const offlineKeys = memberKeys.filter(k => !chatSseClients.has(k));
  if (!offlineKeys.length) return;
  const { data: subs } = await supabase.from('push_subscriptions').select('*').in('member_key', offlineKeys);
  const pushPayload = JSON.stringify(payload);
  for (const sub of subs || []) {
    webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      pushPayload
    ).catch(async err => {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
    });
  }
}

// Like sendPushToOfflineMembers but skips the chat-SSE online filter — used for
// task assignment where we always want to push regardless of chat presence.
async function sendPushAlways(memberKeys, payload) {
  if (!vapidKeys) return;
  const { data: subs } = await supabase.from('push_subscriptions').select('*').in('member_key', memberKeys);
  const pushPayload = JSON.stringify(payload);
  for (const sub of subs || []) {
    webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      pushPayload
    ).catch(async err => {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
    });
  }
}

// ─── Notification Center ────────────────────────────────────────────────────
// Persistent notification SSE: one per logged-in member ('admin' | 'employee_<id>'),
// kept open the whole time the portal is loaded.
const notifSseClients = new Map();

// Create a notification: persist (best-effort), push it live over SSE, and fire push.
// pushMode: 'always' (ignore online filter) | 'offline' (skip if connected) | false (none)
async function createNotification(memberKey, { type = 'general', title, body = '', url = '' }, pushMode = 'offline') {
  if (!memberKey || !title) return null;
  const defaultUrl = url || (memberKey === 'admin' ? '/dashboard' : '/employee');
  let row = { member_key: memberKey, type, title, body, url: defaultUrl, read: false, created_at: new Date().toISOString() };
  try {
    const { data } = await supabase.from('notifications')
      .insert({ member_key: memberKey, type, title, body, url: defaultUrl })
      .select().single();
    if (data) row = data;
  } catch (e) { console.warn('[notif] persist failed:', e.message); }
  // If persistence failed, give the live-only row a synthetic id so the client can still mark it read locally
  if (!row.id) row.id = 'tmp-' + Date.now();
  // Live SSE to an open portal
  const sseRes = notifSseClients.get(memberKey);
  console.log('[notif]', memberKey, type, 'sse=' + !!sseRes);
  if (sseRes) { try { sseRes.write(`event: notification\ndata: ${JSON.stringify(row)}\n\n`); } catch (_) {} }
  // OS push — unique tag per notification so multiple pushes don't collapse in the tray
  const payload = { title, body, url: defaultUrl, tag: 'notif-' + (row.id || Date.now()) };
  if (pushMode === 'always') sendPushAlways([memberKey], payload);
  else if (pushMode === 'offline') sendPushToOfflineMembers([memberKey], payload);
  return row;
}

// Resolve an assignee_id (numeric employee id OR legacy Slack user id) to the
// canonical notification member key `employee_<id>` used by push subs + SSE.
async function memberKeyForAssignee(assigneeId) {
  if (assigneeId == null || assigneeId === '') return null;
  const isNumeric = /^\d+$/.test(String(assigneeId));
  const filter = isNumeric
    ? `id.eq.${assigneeId},slack_user_id.eq.${assigneeId}`
    : `slack_user_id.eq.${assigneeId}`;
  try {
    const { data } = await supabase.from('employees').select('id').or(filter).limit(1);
    if (data && data[0]) return `employee_${data[0].id}`;
  } catch (_) {}
  return `employee_${assigneeId}`;
}

// Notify every assignee of a task (multi-assignee aware; falls back to assignee_id)
async function notifyEmployeeTaskAssigned(task) {
  const list = Array.isArray(task?.assignee_ids) && task.assignee_ids.length ? task.assignee_ids : (task?.assignee_id ? [task.assignee_id] : []);
  for (const aid of [...new Set(list.map(String))]) {
    const key = await memberKeyForAssignee(aid);
    if (!key) continue;
    createNotification(key, {
      type: 'task',
      title: 'New task assigned',
      body: `${task.title} · due ${task.due_date} · ${task.priority} priority`,
      url: '/employee#tasks',
    }, 'always');
  }
}

async function chatListRooms(callerKey) {
  const { data: membership } = await supabase.from('chat_room_members').select('room_id').eq('member_key', callerKey);
  if (!membership?.length) return [];
  const roomIds = membership.map(m => m.room_id);
  const [{ data: rooms }, { data: allMembers }, { data: recentMsgs }] = await Promise.all([
    supabase.from('chat_rooms').select('*').in('id', roomIds).order('updated_at', { ascending: false }),
    supabase.from('chat_room_members').select('*').in('room_id', roomIds),
    supabase.from('chat_messages').select('*').in('room_id', roomIds).order('created_at', { ascending: false }).limit(roomIds.length * 3),
  ]);
  const membersByRoom = {};
  (allMembers || []).forEach(m => {
    if (!membersByRoom[m.room_id]) membersByRoom[m.room_id] = [];
    membersByRoom[m.room_id].push(m);
  });
  const lastMsgByRoom = {};
  (recentMsgs || []).forEach(m => { if (!lastMsgByRoom[m.room_id]) lastMsgByRoom[m.room_id] = m; });
  // Attach profile pictures so the room list can show the peer's avatar
  const avatars = await chatAvatarMap();
  return (rooms || []).map(r => ({
    ...r,
    members: (membersByRoom[r.id] || []).map(m => ({ ...m, member_avatar: avatars[m.member_key] || null })),
    lastMessage: lastMsgByRoom[r.id] || null,
  }));
}

async function chatCreateOrGetDirect(callerKey, callerName, targetKey, targetName) {
  const { data: callerRooms } = await supabase.from('chat_room_members').select('room_id').eq('member_key', callerKey);
  if (callerRooms?.length) {
    const callerRoomIds = callerRooms.map(r => r.room_id);
    const { data: shared } = await supabase.from('chat_room_members').select('room_id').eq('member_key', targetKey).in('room_id', callerRoomIds);
    if (shared?.length) {
      for (const s of shared) {
        const { data: room } = await supabase.from('chat_rooms').select('*').eq('id', s.room_id).eq('type', 'direct').single();
        if (room) return room;
      }
    }
  }
  const { data: room, error: roomErr } = await supabase.from('chat_rooms').insert({ type: 'direct', name: '', created_by: callerKey }).select().single();
  if (roomErr) throw new Error(roomErr.message);
  await supabase.from('chat_room_members').insert([
    { room_id: room.id, member_key: callerKey, member_name: callerName },
    { room_id: room.id, member_key: targetKey, member_name: targetName },
  ]);
  return room;
}

// ── Chat avatars ──────────────────────────────────────────────────────────────
// Messages only store sender_key/sender_name, so resolve the profile picture from
// the employee roster ("employee_<id>" keys; the admin account has none). Cached
// for a minute — chat is polled/streamed constantly and the roster rarely changes.
let _chatAvatars = { at: 0, map: {} };
async function chatAvatarMap() {
  if (Date.now() - _chatAvatars.at < 60000) return _chatAvatars.map;
  const map = {};
  try {
    const { data } = await supabase.from('employees').select('id,avatar_url');
    for (const e of data || []) if (e.avatar_url) map['employee_' + e.id] = e.avatar_url;
  } catch (e) { console.warn('[chat] avatar map failed:', e.message); }
  _chatAvatars = { at: Date.now(), map };
  return map;
}
function withSenderAvatars(rows, map) {
  return (rows || []).map(m => ({ ...m, sender_avatar: map[m.sender_key] || null }));
}

async function chatGetMessages(req, res, callerKey) {
  const roomId = parseInt(req.params.roomId);
  const { data: member } = await supabase.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('member_key', callerKey).single();
  if (!member) return res.status(403).json({ error: 'Not a member of this room' });
  const before = req.query.before;
  let query = supabase.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(50);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(withSenderAvatars((data || []).reverse(), await chatAvatarMap()));
}

async function chatSendMessage(req, res, callerKey, callerName) {
  const roomId = parseInt(req.params.roomId);
  const { body, file_url, file_name, file_size, file_type, reply_to_id, reply_to_sender, reply_to_body, voice_duration } = req.body || {};
  if (!body?.trim() && !file_url) return res.status(400).json({ error: 'Message body or file required' });
  const { data: member } = await supabase.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('member_key', callerKey).single();
  if (!member) return res.status(403).json({ error: 'Not a member of this room' });
  const insert = { room_id: roomId, sender_key: callerKey, sender_name: callerName, body: body?.trim() || '' };
  if (file_url)  { insert.file_url = file_url; insert.file_name = file_name || ''; insert.file_size = file_size || null; insert.file_type = file_type || ''; }
  if (reply_to_id) { insert.reply_to_id = reply_to_id; insert.reply_to_sender = reply_to_sender || ''; insert.reply_to_body = (reply_to_body || '').slice(0, 200); }
  if (voice_duration) insert.voice_duration = parseInt(voice_duration);
  const { data: inserted, error } = await supabase.from('chat_messages').insert(insert).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const msg = { ...inserted, sender_avatar: (await chatAvatarMap())[callerKey] || null };
  const { data: members } = await supabase.from('chat_room_members').select('member_key').eq('room_id', roomId);
  const recipientKeys = (members || []).map(m => m.member_key).filter(k => k !== callerKey);
  // Exclude sender from broadcast — sender already has the message from the HTTP response
  chatBroadcast(recipientKeys, 'message', { roomId, message: msg });
  // Push to members not connected via SSE (app closed / backgrounded)
  sendPushToOfflineMembers(recipientKeys, {
    type: 'chat_message', roomId,
    senderName: callerName,
    body: (msg.file_url && !msg.body) ? '📎 Attachment' : (msg.body || '').slice(0, 80),
  });
  res.json(msg);
}

async function chatEditMsg(req, res, callerKey) {
  const roomId = parseInt(req.params.roomId);
  const msgId  = parseInt(req.params.msgId);
  const { body } = req.body || {};
  if (!body?.trim()) return res.status(400).json({ error: 'Body required' });
  const { data: msg } = await supabase.from('chat_messages').select('*').eq('id', msgId).eq('room_id', roomId).single();
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_key !== callerKey) return res.status(403).json({ error: 'Not your message' });
  const { data: updated, error } = await supabase.from('chat_messages').update({ body: body.trim(), edited_at: new Date().toISOString() }).eq('id', msgId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const { data: members } = await supabase.from('chat_room_members').select('member_key').eq('room_id', roomId);
  chatBroadcast((members || []).map(m => m.member_key), 'edit', { roomId, message: updated });
  res.json(updated);
}

async function chatDeleteMsg(req, res, callerKey) {
  const roomId = parseInt(req.params.roomId);
  const msgId  = parseInt(req.params.msgId);
  const { data: msg } = await supabase.from('chat_messages').select('*').eq('id', msgId).eq('room_id', roomId).single();
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_key !== callerKey) return res.status(403).json({ error: 'Not your message' });
  const ageMins = (Date.now() - new Date(msg.created_at).getTime()) / 60000;
  if (ageMins > 5) return res.status(403).json({ error: 'Cannot delete messages older than 5 minutes' });
  const { error } = await supabase.from('chat_messages').delete().eq('id', msgId);
  if (error) return res.status(500).json({ error: error.message });
  const { data: members } = await supabase.from('chat_room_members').select('member_key').eq('room_id', roomId);
  chatBroadcast((members || []).map(m => m.member_key), 'delete', { roomId, msgId });
  res.json({ ok: true });
}

// SSE — Admin
receiver.router.get('/api/dashboard/chat/events', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(':ok\n\n');
  chatSseClients.set('admin', res);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ka); chatSseClients.delete('admin'); });
});

// SSE — Employee chat
receiver.router.get('/api/employee/chat/events', requireEmployeeAuth, (req, res) => {
  const key = `employee_${req.employee.id}`;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(':ok\n\n');
  chatSseClients.set(key, res);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ka); chatSseClients.delete(key); });
});

// ─── Notification Center streams + REST (both portals) ────────────────────────
function openNotifStream(key, res, reqObj) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(':ok\n\n');
  notifSseClients.set(key, res);
  console.log('[notif-sse] connected', key);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  reqObj.on('close', () => { clearInterval(ka); notifSseClients.delete(key); });
}

async function listNotifications(memberKey, res) {
  try {
    const { data } = await supabase.from('notifications')
      .select('*').eq('member_key', memberKey).order('created_at', { ascending: false }).limit(50);
    const items = data || [];
    res.json({ items, unread: items.filter(n => !n.read).length });
  } catch (_) { res.json({ items: [], unread: 0 }); }
}

async function markNotificationsRead(memberKey, body, res) {
  try {
    let q = supabase.from('notifications').update({ read: true }).eq('member_key', memberKey);
    if (body?.id) q = q.eq('id', body.id);
    else q = q.eq('read', false);
    await q;
    res.json({ ok: true });
  } catch (_) { res.json({ ok: true }); }
}

// Employee
receiver.router.get('/api/employee/notifications/stream', requireEmployeeAuth, (req, res) =>
  openNotifStream(`employee_${req.employee.id}`, res, req));
receiver.router.get('/api/employee/notifications', requireEmployeeAuth, (req, res) =>
  listNotifications(`employee_${req.employee.id}`, res));
receiver.router.post('/api/employee/notifications/read', requireEmployeeAuth, express.json(), (req, res) =>
  markNotificationsRead(`employee_${req.employee.id}`, req.body, res));

// Admin
receiver.router.get('/api/dashboard/notifications/stream', requireAuth, (req, res) =>
  openNotifStream('admin', res, req));
receiver.router.get('/api/dashboard/notifications', requireAuth, (req, res) =>
  listNotifications('admin', res));
receiver.router.post('/api/dashboard/notifications/read', requireAuth, express.json(), (req, res) =>
  markNotificationsRead('admin', req.body, res));

// People lists
receiver.router.get('/api/dashboard/chat/people', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('employees').select('id, name').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(e => ({ key: `employee_${e.id}`, name: e.name, role: 'Employee' })));
});

receiver.router.get('/api/employee/chat/people', requireEmployeeAuth, async (req, res) => {
  const { data, error } = await supabase.from('employees').select('id, name').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json([
    { key: 'admin', name: 'Admin', role: 'Admin' },
    ...(data || []).filter(e => e.id !== req.employee.id).map(e => ({ key: `employee_${e.id}`, name: e.name, role: 'Employee' })),
  ]);
});

// Rooms — list
receiver.router.get('/api/dashboard/chat/rooms', requireAuth, async (_req, res) => {
  try { res.json(await chatListRooms('admin')); } catch (e) { res.status(500).json({ error: e.message }); }
});
receiver.router.get('/api/employee/chat/rooms', requireEmployeeAuth, async (req, res) => {
  try { res.json(await chatListRooms(`employee_${req.employee.id}`)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rooms — direct
receiver.router.post('/api/dashboard/chat/rooms/direct', requireAuth, express.json(), async (req, res) => {
  const { targetKey, targetName } = req.body || {};
  if (!targetKey || !targetName) return res.status(400).json({ error: 'targetKey and targetName required' });
  try { res.json(await chatCreateOrGetDirect('admin', 'Admin', targetKey, targetName)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
receiver.router.post('/api/employee/chat/rooms/direct', requireEmployeeAuth, express.json(), async (req, res) => {
  const { targetKey, targetName } = req.body || {};
  if (!targetKey || !targetName) return res.status(400).json({ error: 'targetKey and targetName required' });
  const { key, name } = chatCallerIdentity(req);
  try { res.json(await chatCreateOrGetDirect(key, name, targetKey, targetName)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Rooms — group (admin only)
receiver.router.post('/api/dashboard/chat/rooms/group', requireAuth, express.json(), async (req, res) => {
  const { name, memberKeys } = req.body || {};
  if (!name || !Array.isArray(memberKeys) || !memberKeys.length) return res.status(400).json({ error: 'name and memberKeys[] required' });
  try {
    const { data: room, error: roomErr } = await supabase.from('chat_rooms').insert({ type: 'group', name, created_by: 'admin' }).select().single();
    if (roomErr) throw new Error(roomErr.message);
    const empIds = memberKeys.filter(k => k.startsWith('employee_')).map(k => parseInt(k.slice(9)));
    const { data: emps } = await supabase.from('employees').select('id, name').in('id', empIds);
    const empNameMap = {};
    (emps || []).forEach(e => { empNameMap[e.id] = e.name; });
    const insertMembers = [
      { room_id: room.id, member_key: 'admin', member_name: 'Admin' },
      ...memberKeys.filter(k => k !== 'admin').map(k => ({
        room_id: room.id,
        member_key: k,
        member_name: k.startsWith('employee_') ? (empNameMap[parseInt(k.slice(9))] || k) : k,
      })),
    ];
    await supabase.from('chat_room_members').insert(insertMembers);
    res.json(room);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Messages
receiver.router.get('/api/dashboard/chat/rooms/:roomId/messages', requireAuth, (req, res) => chatGetMessages(req, res, 'admin'));
receiver.router.get('/api/employee/chat/rooms/:roomId/messages', requireEmployeeAuth, (req, res) => chatGetMessages(req, res, `employee_${req.employee.id}`));
receiver.router.post('/api/dashboard/chat/rooms/:roomId/messages', requireAuth, express.json(), (req, res) => chatSendMessage(req, res, 'admin', 'Admin'));
receiver.router.post('/api/employee/chat/rooms/:roomId/messages', requireEmployeeAuth, express.json(), (req, res) => chatSendMessage(req, res, `employee_${req.employee.id}`, req.employee.name));
// Edit
receiver.router.patch('/api/dashboard/chat/rooms/:roomId/messages/:msgId', requireAuth, express.json(), (req, res) => chatEditMsg(req, res, 'admin'));
receiver.router.patch('/api/employee/chat/rooms/:roomId/messages/:msgId', requireEmployeeAuth, express.json(), (req, res) => chatEditMsg(req, res, `employee_${req.employee.id}`));
// Delete
receiver.router.delete('/api/dashboard/chat/rooms/:roomId/messages/:msgId', requireAuth, (req, res) => chatDeleteMsg(req, res, 'admin'));
receiver.router.delete('/api/employee/chat/rooms/:roomId/messages/:msgId', requireEmployeeAuth, (req, res) => chatDeleteMsg(req, res, `employee_${req.employee.id}`));

// File upload
const chatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function handleChatUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const ext  = req.file.originalname.split('.').pop().toLowerCase();
  const path = `chat/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const { data, error } = await supabase.storage.from('chat-files').upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (error) return res.status(500).json({ error: error.message });
  const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(data.path);
  res.json({ url: urlData.publicUrl, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
}

receiver.router.post('/api/dashboard/chat/upload', requireAuth, chatUpload.single('file'), handleChatUpload);
receiver.router.post('/api/employee/chat/upload',  requireEmployeeAuth, chatUpload.single('file'), handleChatUpload);

// ─── Typing indicator ─────────────────────────────────────────────────────────
async function handleTyping(req, res, callerKey, callerName, roomId) {
  const { data: member } = await supabase.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('member_key', callerKey).single();
  if (!member) return res.status(403).json({ error: 'Not a member' });
  const { data: members } = await supabase.from('chat_room_members').select('member_key').eq('room_id', roomId);
  chatBroadcast((members || []).map(m => m.member_key).filter(k => k !== callerKey), 'typing', { roomId, senderKey: callerKey, senderName: callerName });
  res.json({ ok: true });
}
receiver.router.post('/api/dashboard/chat/rooms/:roomId/typing', requireAuth, (req, res) => handleTyping(req, res, 'admin', 'Admin', parseInt(req.params.roomId)));
receiver.router.post('/api/employee/chat/rooms/:roomId/typing', requireEmployeeAuth, (req, res) => handleTyping(req, res, `employee_${req.employee.id}`, req.employee.name, parseInt(req.params.roomId)));

// ─── Presence ─────────────────────────────────────────────────────────────────
receiver.router.post('/api/employee/presence/heartbeat', requireEmployeeAuth, async (req, res) => {
  const { key } = chatCallerIdentity(req);
  await supabase.from('presence').upsert({ member_key: key, last_seen: new Date().toISOString() });
  res.json({ ok: true });
});
receiver.router.get('/api/employee/presence', requireEmployeeAuth, async (req, res) => {
  const keys = (req.query.keys || '').split(',').filter(Boolean);
  if (!keys.length) return res.json([]);
  const { data } = await supabase.from('presence').select('member_key,last_seen').in('member_key', keys);
  res.json(data || []);
});
receiver.router.post('/api/dashboard/presence/heartbeat', requireAuth, async (req, res) => {
  await supabase.from('presence').upsert({ member_key: 'admin', last_seen: new Date().toISOString() });
  res.json({ ok: true });
});
receiver.router.get('/api/dashboard/presence', requireAuth, async (req, res) => {
  const keys = (req.query.keys || '').split(',').filter(Boolean);
  if (!keys.length) return res.json([]);
  const { data } = await supabase.from('presence').select('member_key,last_seen').in('member_key', keys);
  res.json(data || []);
});

// ─── Push subscriptions ───────────────────────────────────────────────────────
receiver.router.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ key: vapidKeys?.publicKey || '' });
});
receiver.router.post('/api/employee/push/subscribe', requireEmployeeAuth, express.json(), async (req, res) => {
  const { key: callerKey } = chatCallerIdentity(req);
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
  await supabase.from('push_subscriptions').upsert(
    { member_key: callerKey, endpoint, p256dh: keys.p256dh, auth_key: keys.auth },
    { onConflict: 'member_key,endpoint' }
  );
  res.json({ ok: true });
});
receiver.router.delete('/api/employee/push/subscribe', requireEmployeeAuth, express.json(), async (req, res) => {
  const { key: callerKey } = chatCallerIdentity(req);
  const { endpoint } = req.body || {};
  if (endpoint) await supabase.from('push_subscriptions').delete().eq('member_key', callerKey).eq('endpoint', endpoint);
  res.json({ ok: true });
});
receiver.router.post('/api/dashboard/push/subscribe', requireAuth, express.json(), async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
  await supabase.from('push_subscriptions').upsert(
    { member_key: 'admin', endpoint, p256dh: keys.p256dh, auth_key: keys.auth },
    { onConflict: 'member_key,endpoint' }
  );
  res.json({ ok: true });
});
receiver.router.delete('/api/dashboard/push/subscribe', requireAuth, express.json(), async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await supabase.from('push_subscriptions').delete().eq('member_key', 'admin').eq('endpoint', endpoint);
  res.json({ ok: true });
});

// ─── WhatsApp Inbox (whatsapp-web.js) ──────────────────────────────────────────
// Self-contained bridge: one long-lived WhatsApp Web client, linked by QR code.
// Guarded by WHATSAPP_ENABLED so the module is fully inert when not configured.
const waSseClients = new Set();         // Set<res> — admin dashboard SSE listeners
let waClient       = null;              // whatsapp-web.js Client instance
let waInitializing = false;
let waStatus       = 'disconnected';    // 'disconnected' | 'qr' | 'connecting' | 'ready'
let waLastQr       = null;              // data-URL of the current link QR (when status==='qr')

function waBroadcast(eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of waSseClients) { try { res.write(data); } catch (_) {} }
}

function waSetStatus(status, qr) {
  waStatus = status;
  waLastQr = (status === 'qr') ? (qr || waLastQr) : null;
  waBroadcast('whatsapp_status', { status: waStatus, qr: waLastQr });
}

// Upsert a contact by wa_id, returning the row.
async function upsertWaContact(waId, name, preview, incInc) {
  const patch = { wa_id: waId, phone: (waId.split('@')[0] || ''), updated_at: new Date().toISOString() };
  if (name) patch.name = name;
  if (preview !== undefined) { patch.last_message_preview = preview; patch.last_message_at = new Date().toISOString(); }
  // Upsert basic identity first
  const { data: existing } = await supabase.from('whatsapp_contacts').select('*').eq('wa_id', waId).single();
  if (!existing) {
    const { data } = await supabase.from('whatsapp_contacts')
      .insert({ ...patch, name: name || '', unread: incInc ? 1 : 0 }).select().single();
    return data;
  }
  if (incInc) patch.unread = (existing.unread || 0) + 1;
  const { data } = await supabase.from('whatsapp_contacts').update(patch).eq('id', existing.id).select().single();
  return data || existing;
}

async function initWhatsApp() {
  if (waClient || waInitializing) return;
  waInitializing = true;
  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const qrcode = require('qrcode');
    waSetStatus('connecting');
    waClient = new Client({
      authStrategy: new LocalAuth({ dataPath: process.env.WHATSAPP_SESSION_PATH || './.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
               '--no-first-run','--no-zygote','--single-process','--disable-gpu'],
      },
    });

    waClient.on('qr', async (qr) => {
      try { waSetStatus('qr', await qrcode.toDataURL(qr)); }
      catch (e) { console.error('[whatsapp] qr render', e); }
    });
    waClient.on('authenticated', () => waSetStatus('connecting'));
    waClient.on('ready',        () => { console.log('[whatsapp] ready'); waSetStatus('ready'); });
    waClient.on('disconnected', (reason) => { console.warn('[whatsapp] disconnected', reason); waClient = null; waSetStatus('disconnected'); });
    waClient.on('message', (msg) => handleWaIncoming(msg).catch(e => console.error('[whatsapp] incoming', e)));

    await waClient.initialize();
  } catch (e) {
    console.error('[whatsapp] init failed', e);
    waClient = null;
    waSetStatus('disconnected');
  } finally {
    waInitializing = false;
  }
}

async function handleWaIncoming(msg) {
  // Only handle 1:1 chats (ignore groups, status broadcasts, newsletters)
  if (msg.from === 'status@broadcast' || msg.from.endsWith('@g.us') || msg.from.endsWith('@newsletter')) return;
  if (msg.isStatus) return;

  let contactName = '';
  try { const c = await msg.getContact(); contactName = c.pushname || c.name || c.verifiedName || ''; } catch (_) {}

  // Download media (images/docs) → existing chat-files bucket
  let media_url = null, media_type = null;
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.data) {
        const ext  = (media.mimetype.split('/')[1] || 'bin').split(';')[0];
        const path = `whatsapp/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
        const buf  = Buffer.from(media.data, 'base64');
        const { data: up, error } = await supabase.storage.from('chat-files').upload(path, buf, { contentType: media.mimetype, upsert: false });
        if (!error) { media_url = supabase.storage.from('chat-files').getPublicUrl(up.path).data.publicUrl; media_type = media.mimetype; }
      }
    } catch (e) { console.error('[whatsapp] media download', e); }
  }

  const preview = msg.body ? msg.body.slice(0, 80) : (media_type ? '📎 Attachment' : '');
  const contact = await upsertWaContact(msg.from, contactName, preview, true);
  if (!contact) return;

  const { data: saved } = await supabase.from('whatsapp_messages').insert({
    contact_id: contact.id, wa_message_id: msg.id?._serialized || null, direction: 'in',
    body: msg.body || '', media_url, media_type, status: 'received',
    ts: new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
  }).select().single();

  waBroadcast('whatsapp_message', { contact, message: saved });
  sendPushToOfflineMembers(['admin'], {
    type: 'whatsapp_message', senderName: `WhatsApp · ${contact.name || contact.phone}`,
    body: preview || 'New message', roomId: contact.id,
  }).catch(() => {});
}

async function sendWaMessage(waId, body) {
  if (!waClient || waStatus !== 'ready') throw new Error('WhatsApp is not connected');
  const sent = await waClient.sendMessage(waId, body);
  const contact = await upsertWaContact(waId, '', body.slice(0, 80), false);
  const { data: saved } = await supabase.from('whatsapp_messages').insert({
    contact_id: contact.id, wa_message_id: sent?.id?._serialized || null, direction: 'out',
    body, status: 'sent', ts: new Date().toISOString(),
  }).select().single();
  waBroadcast('whatsapp_message', { contact, message: saved });
  return { contact, message: saved };
}

// ── WhatsApp routes (admin only) ──
receiver.router.get('/api/dashboard/whatsapp/events', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(':ok\n\n');
  waSseClients.add(res);
  const ka = setInterval(() => { try { res.write(':ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(ka); waSseClients.delete(res); });
});

receiver.router.get('/api/dashboard/whatsapp/status', requireAuth, (_req, res) => {
  res.json({ enabled: process.env.WHATSAPP_ENABLED === 'true', status: waStatus, qr: waLastQr });
});

receiver.router.post('/api/dashboard/whatsapp/connect', requireAuth, (_req, res) => {
  if (process.env.WHATSAPP_ENABLED !== 'true') return res.status(400).json({ error: 'WhatsApp is disabled (set WHATSAPP_ENABLED=true)' });
  initWhatsApp().catch(e => console.error('[whatsapp] connect', e));
  res.json({ ok: true, status: waStatus });
});

receiver.router.post('/api/dashboard/whatsapp/logout', requireAuth, async (_req, res) => {
  try {
    if (waClient) { try { await waClient.logout(); } catch (_) {} try { await waClient.destroy(); } catch (_) {} }
  } finally {
    waClient = null;
    waSetStatus('disconnected');
  }
  res.json({ ok: true });
});

receiver.router.get('/api/dashboard/whatsapp/contacts', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('whatsapp_contacts').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/dashboard/whatsapp/contacts/:id/messages', requireAuth, async (req, res) => {
  // Pure read — no state mutation (clearing unread is an explicit POST .../read to avoid a lost-update race)
  const { data, error } = await supabase.from('whatsapp_messages').select('*').eq('contact_id', req.params.id).order('created_at', { ascending: true }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Explicit mark-conversation-read (called when the admin opens/focuses a conversation)
receiver.router.post('/api/dashboard/whatsapp/contacts/:id/read', requireAuth, async (req, res) => {
  const { error } = await supabase.from('whatsapp_contacts').update({ unread: 0 }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

receiver.router.post('/api/dashboard/whatsapp/contacts/:id/messages', requireAuth, express.json(), async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body is required' });
  const { data: contact } = await supabase.from('whatsapp_contacts').select('*').eq('id', req.params.id).single();
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  try {
    const result = await sendWaMessage(contact.wa_id, body);
    res.json(result.message);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

receiver.router.post('/api/dashboard/whatsapp/send', requireAuth, express.json(), async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/[^\d]/g, '');
  const body  = (req.body?.body || '').trim();
  if (!phone || !body) return res.status(400).json({ error: 'phone and body are required' });
  try {
    const result = await sendWaMessage(`${phone}@c.us`, body);
    res.json(result);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Quotation Draft ──────────────────────────────────────────────────────────
const quotationImgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  },
});

function getIsoWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function generateQuoteId() {
  const now  = new Date();
  const week = String(getIsoWeek(now)).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 90) + 10);
  const year = String(now.getFullYear()).slice(-2);
  return `MT${week}W${rand}Y${year}`;
}

// ── Employee CRM (gated by the leads/deals permission; delete goes via approval) ──
receiver.router.get('/api/employee/leads', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'leads', 'view')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const stageIdSet = await scopedQuotedIds(req.employee);
  res.json((data || []).filter(c => customerInScope(c, req.employee, stageIdSet)));
});

// Read the shared leads column config (read-only; config editing stays admin-only)
receiver.router.get('/api/employee/leads/columns', requireEmployeeAuth, async (req, res) => {
  if (!(empCan(req.employee, 'leads', 'view') || empCan(req.employee, 'quotation', 'attachLead'))) return res.status(403).json({ error: 'Not permitted' });
  const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'leads_columns_config').single();
  let columns = null; try { if (data?.value) columns = JSON.parse(data.value); } catch (_) {}
  res.json({ columns });
});

receiver.router.post('/api/employee/leads', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'create')) return res.status(403).json({ error: 'Not permitted' });
  const { name, phone, email, source, notes, lead_date, lead_time, lead_status, car_in_question, budget_lead, budget_max, next_action, been_contacted, sales_feedback, inquiry, assigned_to, custom_fields, force } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const phone_norm = normalizePhone(phone);
  if (phone_norm && !force) {
    const { data: dup } = await supabase.from('customers').select('id,name,phone,lead_status').eq('phone_norm', phone_norm).limit(1);
    if (dup && dup.length) return res.status(409).json({ duplicate: true, existing: dup[0] });
  }
  const { data, error } = await supabase.from('customers')
    .insert({ name, phone: phone||'', phone_norm, email: email||'', source: source||'', notes: notes||'', lead_date: lead_date||null, lead_time: lead_time||'', lead_status: lead_status||'cold', car_in_question: car_in_question||'', budget_lead: budget_lead||null, budget_max: budget_max||null, next_action: next_action||'', been_contacted: been_contacted||false, sales_feedback: sales_feedback||'', inquiry: inquiry||'', assigned_to: assigned_to||null, custom_fields: custom_fields||{}, created_by: req.employee.username })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(data.id, { type: 'system', body: `Lead created${data.source ? ' · ' + data.source : ''}`, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  if (data.lead_status === 'hot') {
    supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question||'', budget_egp: data.budget_lead||null, notes: 'Auto-created from Hot lead', created_by: 'system' }).then(()=>{}).catch(()=>{});
  }
  runAutomations('lead.created', leadCtx(data));
  res.json(data);
});

receiver.router.put('/api/employee/leads/:id', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const { data: prev } = await supabase.from('customers').select('lead_status,been_contacted').eq('id', req.params.id).single();
  const patch = { ...req.body, updated_at: new Date().toISOString() };
  delete patch.force; delete patch.created_by; delete patch.id;
  if (Object.prototype.hasOwnProperty.call(patch, 'phone')) patch.phone_norm = normalizePhone(patch.phone);
  const { data, error } = await supabase.from('customers').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const author = { authorKey: `employee_${req.employee.id}`, authorName: req.employee.name };
  if (prev && data.lead_status !== prev.lead_status) logLeadActivity(data.id, { type: 'status_change', body: 'Status changed', meta: { from: prev.lead_status || 'cold', to: data.lead_status || 'cold' }, ...author });
  if (prev && !prev.been_contacted && data.been_contacted) logLeadActivity(data.id, { type: 'system', body: 'Marked as contacted', ...author });
  if (data.lead_status === 'hot' && prev?.lead_status !== 'hot') {
    try {
      const { data: existing } = await supabase.from('deals').select('id').eq('customer_id', data.id).limit(1);
      if (!existing?.length) {
        await supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question||'', budget_egp: data.budget_lead||null, notes: 'Auto-created from Hot lead', created_by: 'system' });
        logLeadActivity(data.id, { type: 'deal', body: 'Deal auto-created from Hot status', authorKey: 'system', authorName: 'System' });
      }
    } catch (e) { console.warn('[emp-leads] auto-deal failed:', e.message); }
  }
  if (prev && data.lead_status !== prev.lead_status) runAutomations('lead.status_changed', { ...leadCtx(data), from: prev.lead_status, to: data.lead_status });
  if (prev && !prev.been_contacted && data.been_contacted) runAutomations('lead.contacted', leadCtx(data));
  res.json(data);
});

receiver.router.get('/api/employee/deals', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'deals', 'view')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('deals').select('*, customers(name,phone,email,lead_status,assigned_to)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).filter(d => dealInScope(d, req.employee)));
});

receiver.router.post('/api/employee/deals', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'deals', 'create')) return res.status(403).json({ error: 'Not permitted' });
  const { customer_id, title, stage, car_model, budget_egp, notes, assigned_to } = req.body;
  if (!customer_id || !title) return res.status(400).json({ error: 'customer_id and title are required' });
  const { data, error } = await supabase.from('deals')
    .insert({ customer_id, title, stage: stage||'lead', car_model: car_model||'', budget_egp: budget_egp||null, notes: notes||'', assigned_to: assigned_to||'', created_by: req.employee.username })
    .select('*, customers(name,phone,email)').single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(customer_id, { type: 'deal', body: `Deal created — ${title}`, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  runAutomations('deal.created', dealCtx(data));
  res.json(data);
});

receiver.router.put('/api/employee/deals/:id', requireEmployeeAuth, express.json(), async (req, res) => {
  // A pure stage change needs 'move'; any other field edit needs 'edit'.
  {
    const keys = Object.keys(req.body || {});
    const onlyStage = keys.length && keys.every(k => k === 'stage');
    const allowed = onlyStage ? (empCan(req.employee, 'deals', 'move') || empCan(req.employee, 'deals', 'edit')) : empCan(req.employee, 'deals', 'edit');
    if (!allowed) return res.status(403).json({ error: 'Not permitted' });
  }
  const { data: prev } = await supabase.from('deals').select('stage').eq('id', req.params.id).single();
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  delete updates.created_by; delete updates.id;
  if ((updates.stage === 'won' || updates.stage === 'lost') && !updates.closed_at) updates.closed_at = new Date().toISOString();
  if (updates.stage && updates.stage !== 'won' && updates.stage !== 'lost') updates.closed_at = null;
  const { data, error } = await supabase.from('deals')
    .update(updates).eq('id', req.params.id).select('*, customers(name,phone,email,car_in_question,budget_lead)').single();
  if (error) return res.status(500).json({ error: error.message });
  if (updates.stage === 'inquiry' && prev?.stage !== 'inquiry') {
    try {
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {}; for (const row of settingsRows || []) settings[row.key] = row.value;
      const notifyId = settings.contact_notify_employee_id;
      if (notifyId) {
        const c = data.customers;
        const body = [`Lead: ${c?.name || data.title}`, c?.phone ? `Phone: ${c.phone}` : '', c?.car_in_question ? `Car: ${c.car_in_question}` : '', c?.budget_lead ? `Budget: ${Number(c.budget_lead).toLocaleString()} EGP` : ''].filter(Boolean).join(' · ');
        await createNotification(`employee_${notifyId}`, { type: 'lead', title: 'New lead to quote — ' + (c?.name || data.title), body, url: '/employee#quotation' }, 'always');
      }
    } catch (e) { console.warn('[emp-deals] notify-contacted failed:', e.message); }
  }
  if (updates.stage && prev?.stage !== updates.stage && data.customer_id) {
    const stageLabels = { lead: 'Lead', inquiry: 'Inquiry', quoted: 'Quoted', negotiating: 'Negotiating', won: 'Won', lost: 'Lost' };
    logLeadActivity(data.customer_id, { type: 'deal', body: `Deal moved to ${stageLabels[updates.stage] || updates.stage} — ${data.title}`, meta: { from: prev?.stage, to: updates.stage }, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  }
  if (updates.stage && prev?.stage !== updates.stage) runAutomations('deal.stage_changed', { ...dealCtx(data), from: prev?.stage, to: updates.stage });
  // Won → draft the Arabic import contract (best-effort, never blocks the move)
  if (updates.stage === 'won' && prev?.stage !== 'won') {
    autoCreateContractForWonDeal(data);
    autoCreateSaleForWonDeal(data);
  }
  res.json(data);
});

// Employee-initiated deletion requests (admin approves → the record is actually deleted)
receiver.router.post('/api/employee/deletion-requests', requireEmployeeAuth, express.json(), async (req, res) => {
  const { entity_type, entity_id, reason } = req.body || {};
  if (!['lead', 'deal'].includes(entity_type) || !entity_id) return res.status(400).json({ error: 'entity_type (lead|deal) and entity_id are required' });
  const permOk = entity_type === 'lead' ? empCan(req.employee, 'leads', 'delete') : empCan(req.employee, 'deals', 'delete');
  if (!permOk) return res.status(403).json({ error: 'Not permitted' });
  let label = '';
  if (entity_type === 'lead') {
    const { data } = await supabase.from('customers').select('name,phone').eq('id', entity_id).single();
    if (!data) return res.status(404).json({ error: 'Lead not found' });
    label = data.name + (data.phone ? ' · ' + data.phone : '');
  } else {
    const { data } = await supabase.from('deals').select('title, customers(name)').eq('id', entity_id).single();
    if (!data) return res.status(404).json({ error: 'Deal not found' });
    label = data.title + (data.customers?.name ? ' · ' + data.customers.name : '');
  }
  const { data: existing } = await supabase.from('deletion_requests').select('id').eq('entity_type', entity_type).eq('entity_id', entity_id).eq('status', 'pending').limit(1);
  if (existing && existing.length) return res.json({ ok: true, duplicate: true });
  const { data: row, error } = await supabase.from('deletion_requests')
    .insert({ entity_type, entity_id, entity_label: label, requested_by: req.employee.username, reason: String(reason || '').slice(0, 500), status: 'pending' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  createNotification('admin', { type: 'request', title: `Deletion request — ${entity_type}`, body: `${req.employee.name} asked to delete "${label}"${reason ? ' — ' + reason : ''}`, url: '/dashboard#deletions' }, 'always').catch(() => {});
  res.json({ ok: true, id: row.id });
});
receiver.router.get('/api/employee/deletion-requests', requireEmployeeAuth, async (req, res) => {
  const { data, error } = await supabase.from('deletion_requests').select('*').eq('requested_by', req.employee.username).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── Employee Lead 360° profile: timeline, follow-ups, linked quotations & deals ──
receiver.router.get('/api/employee/customers/:id/profile', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'leads', 'view')) return res.status(403).json({ error: 'Not permitted' });
  const id = parseInt(req.params.id);
  const { data: customer, error } = await supabase.from('customers').select('*').eq('id', id).single();
  if (error || !customer) return res.status(404).json({ error: 'Lead not found' });
  if (empHasScope(req.employee) && !customerInScope(customer, req.employee, await scopedQuotedIds(req.employee))) return res.status(403).json({ error: 'Not permitted' });
  const [activities, followups, quotations, deals, contracts, purchaseOrders] = await Promise.all([
    supabase.from('lead_activities').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(200),
    supabase.from('lead_followups').select('*').eq('customer_id', id).order('due_at', { ascending: true }),
    supabase.from('quotations').select('id,quote_id,title,created_by,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('deals').select('id,title,stage,budget_egp,created_at').eq('customer_id', id).order('created_at', { ascending: false }),
    supabase.from('contracts').select('id,contract_no,title,status,created_by,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('purchase_orders').select('id,po_number,title,supplier,status,items,created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  res.json({
    customer,
    activities: activities.data || [],
    followups: followups.data || [],
    quotations: quotations.data || [],
    deals: deals.data || [],
    contracts: contracts.data || [],
    purchaseOrders: purchaseOrders.data || [],
  });
});

receiver.router.post('/api/employee/customers/:id/activities', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const type = ['note', 'call', 'whatsapp', 'meeting'].includes(req.body?.type) ? req.body.type : 'note';
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Activity text is required' });
  const { data, error } = await supabase.from('lead_activities')
    .insert({ customer_id: parseInt(req.params.id), type, body, author_key: `employee_${req.employee.id}`, author_name: req.employee.name })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.post('/api/employee/customers/:id/followups', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const due_at = req.body?.due_at;
  if (!due_at || isNaN(new Date(due_at).getTime())) return res.status(400).json({ error: 'A valid due date/time is required' });
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const assigned_to = req.body?.assigned_to ? parseInt(req.body.assigned_to) : null;
  const { data, error } = await supabase.from('lead_followups')
    .insert({ customer_id: parseInt(req.params.id), due_at: new Date(due_at).toISOString(), note, assigned_to, created_by: req.employee.username })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  logLeadActivity(data.customer_id, { type: 'follow_up', body: `Follow-up scheduled for ${new Date(data.due_at).toLocaleString()}${note ? ' — ' + note : ''}`, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  res.json(data);
});

receiver.router.put('/api/employee/followups/:id', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const status = ['done', 'cancelled', 'pending'].includes(req.body?.status) ? req.body.status : 'done';
  const patch = { status, completed_at: status === 'done' ? new Date().toISOString() : null };
  const { data, error } = await supabase.from('lead_followups').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (status !== 'pending') {
    logLeadActivity(data.customer_id, { type: 'follow_up', body: status === 'done' ? 'Follow-up completed' : 'Follow-up cancelled', authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
  }
  res.json(data);
});

receiver.router.get('/api/employee/followups/pending', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'leads', 'view')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('lead_followups')
    .select('id,customer_id,due_at,note,assigned_to').eq('status', 'pending').order('due_at', { ascending: true }).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Write the shared leads column config (gated by the leads permission; config is global)
receiver.router.put('/api/employee/leads/columns', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'edit')) return res.status(403).json({ error: 'Not permitted' });
  const columns = req.body?.columns;
  if (!Array.isArray(columns)) return res.status(400).json({ error: 'columns array required' });
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: 'leads_columns_config', value: JSON.stringify(columns) }, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// CSV / Google-Sheets import (mirrors the admin importer; deduped on normalized phone)
receiver.router.post('/api/employee/customers/import', requireEmployeeAuth, multerCsv.single('file'), express.json(), async (req, res) => {
  if (!empCan(req.employee, 'leads', 'import')) return res.status(403).json({ error: 'Not permitted' });
  try {
    let csvText = '';
    if (req.file) {
      csvText = req.file.buffer.toString('utf8');
    } else if (req.body?.sheetUrl) {
      const match = req.body.sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) return res.status(400).json({ error: 'Invalid Google Sheets URL' });
      const nodeFetch = require('node-fetch');
      const r = await nodeFetch(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`);
      if (!r.ok) return res.status(400).json({ error: 'Could not fetch spreadsheet — make sure it is publicly accessible.' });
      csvText = await r.text();
    }
    if (!csvText) return res.status(400).json({ error: 'No data to import' });
    const { data: emps } = await supabase.from('employees').select('id,name,username,email');
    const cols = await loadLeadsColsConfig();
    const { rows, unmatchedHeaders, error: parseErr } = parseLeadsCsv(csvText, cols, emps || []);
    if (parseErr) return res.status(400).json({ error: parseErr });
    if (!rows.length) return res.status(400).json({ error: 'No valid rows (Name column is required)' });
    const updateExisting = String(req.body?.updateExisting) === 'true';
    const { inserted, updated, skipped, skippedNames, deals } = await importLeadRows(rows, updateExisting);
    res.json({ count: inserted, inserted, updated, skipped, deals, skippedNames: (skippedNames || []).slice(0, 50), unmatchedHeaders });
  } catch (e) { console.error('[emp-csv-import]', e); res.status(500).json({ error: e.message }); }
});

// ── Quotation Settings ────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/quotation/settings', requireAuth, async (_req, res) => {
  const { data } = await supabase.from('quotation_settings').select('key,value');
  const settings = {};
  for (const row of data || []) settings[row.key] = row.value;
  res.json(settings);
});

receiver.router.put('/api/dashboard/quotation/settings', requireAuth, express.json(), async (req, res) => {
  const entries = Object.entries(req.body || {}).map(([key, value]) => ({ key, value: String(value) }));
  if (!entries.length) return res.json({ ok: true });
  const { error } = await supabase.from('quotation_settings').upsert(entries, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Quotation History ─────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/quotations', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('quotations').select('id,quote_id,title,created_by,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/dashboard/quotations/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('quotations').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Re-render a saved quotation to PDF straight from its stored data, so it can be
// viewed from the lead profile without loading it back into the draft form.
receiver.router.post('/api/dashboard/quotations/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { data: row, error } = await supabase.from('quotations').select('*').eq('id', req.params.id).single();
    if (error || !row) return res.status(404).json({ error: 'Quotation not found' });
    const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
    const settings = {};
    for (const s of settingsRows || []) settings[s.key] = s.value;
    const d = row.data || {};
    const html = buildQuotationHtml({ ...d, template: quoteTheme(d.template).key, settings });
    const pdf = await renderQuotationPdf(html);
    res.json({ pdf: Buffer.from(pdf).toString('base64'), name: row.quote_id || 'quotation' });
  } catch (e) {
    console.error('[quotation-pdf]', e);
    res.status(500).json({ error: e.message });
  }
});

receiver.router.delete('/api/dashboard/quotations/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('quotations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Employee quotation settings — read + write (shared, company-wide; gated by the quotation permission)
receiver.router.get('/api/employee/quotation/settings', requireEmployeeAuth, async (req, res) => {
  // Reading settings is needed to build a draft, so draft OR settings access suffices.
  if (!(empCan(req.employee, 'quotation', 'draft') || empCan(req.employee, 'quotation', 'settings'))) return res.status(403).json({ error: 'Not permitted' });
  const { data } = await supabase.from('quotation_settings').select('key,value');
  const settings = {};
  for (const row of data || []) settings[row.key] = row.value;
  res.json(settings);
});

receiver.router.put('/api/employee/quotation/settings', requireEmployeeAuth, express.json(), async (req, res) => {
  if (!empCan(req.employee, 'quotation', 'settings')) return res.status(403).json({ error: 'Not permitted' });
  const entries = Object.entries(req.body || {}).map(([key, value]) => ({ key, value: String(value) }));
  if (!entries.length) return res.json({ ok: true });
  const { error } = await supabase.from('quotation_settings').upsert(entries, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Employee history shows ALL quotations (shared), matching the admin dashboard.
receiver.router.get('/api/employee/quotations', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'quotation', 'history')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('quotations').select('id,quote_id,title,created_by,created_at').order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/employee/quotations/:id', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'quotation', 'history')) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('quotations').select('*').eq('id', req.params.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Any employee with quotation access can delete any quotation from the shared history.
receiver.router.delete('/api/employee/quotations/:id', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'quotation', 'delete')) return res.status(403).json({ error: 'Not permitted' });
  const { error } = await supabase.from('quotations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

receiver.router.get('/api/dashboard/quotation/newid', requireAuth, (_req, res) => {
  res.json({ id: generateQuoteId() });
});

function fmtNum(n) {
  const v = parseFloat(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('en-US');
}

function calcEgp(priceUsd, units, exchange) {
  const p = parseFloat(priceUsd);
  const u = parseFloat(units) || 1;
  const e = parseFloat(exchange) || 1;
  if (!isFinite(p)) return null;
  return Math.round(p * u * e);
}

// HTML-escape any user/DB-derived value before interpolating into the quotation HTML.
function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Contracts (Arabic "عقد شراء وإستيراد سيارة لحساب الغير") ──────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Faithful reproduction of the company's signed paper contract: 6 A4 pages, RTL
// Arabic, company footer on every page. Every blank in the paper form is a field
// here — supplied values are printed inline, blanks fall back to dotted leaders.

function generateContractNo() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `MC${y}${m}-${rand}`;
}

const AR_WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// Build the default (prefilled) contract payload from a lead + deal + settings.
function contractDefaults({ customer, deal, settings, vehicle }) {
  const s = settings || {};
  const c = customer || {};
  const d = deal || {};
  const cf = c.custom_fields || {};
  const now = new Date();
  const amount = d.budget_egp || cf.cf_vehicle_price || '';
  // The lead's requested vehicle is free text ("BYD Seal Design") — split it so
  // make/model land in their own rows, exactly like the paper form.
  const carText = String(vehicle || cf.cf_vehicle_offered || cf.cf_vehicle_requested || c.car_in_question || '').trim();
  const carBits = carText.split(/\s+/).filter(Boolean);
  return {
    contractDate: { day: AR_WEEKDAYS[now.getDay()], d: String(now.getDate()).padStart(2, '0'), m: String(now.getMonth() + 1).padStart(2, '0'), y: String(now.getFullYear()) },
    company: {
      name: s.company_name || 'MotoLinkers',
      commercialReg: s.company_commercial_reg || '282378',
      taxId: s.company_tax_id || '773934006',
      address: s.company_address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo',
      repIn: s.company_rep || '',
    },
    rep: { name: s.company_rep || '', nationalId: '', idDate: '', nationality: 'مصري', religion: '', address: '', role: 'مدير الشركة' },
    buyer: {
      name: c.name || '', nationalId: cf.cf_national_id || '', idDate: '',
      nationality: 'مصري', religion: 'مسلم', address: c.address || cf.cf_address || '',
    },
    vehicle: {
      make: carBits[0] || '', model: carBits.slice(1).join(' ') || '',
      color: cf.cf_color || '', year: cf.cf_year || '', notes: '',
    },
    importCountry: 'الصين',
    total: amount ? String(amount) : '', totalWords: '',
    payments: [
      { amount: '', when: 'فور التوقيع علي هذا العقد', label: '' },
      { amount: '', when: 'في موعد أقصاه خمسة عشر يوما من تاريخ توقيع هذا العقد', label: 'دفعة الشحن' },
      { amount: '', when: 'عند وصول السيارة الي الموانئ المصرية', label: 'دفعة ضريبه القيمة المضافة' },
      { amount: '', when: 'عند استلام السيارة', label: '' },
    ],
    lateFee: '', lateFeeWords: '',
    deliveryDeadline: '',
  };
}

function buildContractHtml(data) {
  const v = data || {};
  const cd = v.contractDate || {};
  const co = v.company || {}, rp = v.rep || {}, by = v.buyer || {}, ve = v.vehicle || {};
  const pays = Array.isArray(v.payments) ? v.payments : [];

  // A filled blank prints the value (underlined); an empty one keeps the leader
  // dots so the printed contract can still be completed by hand.
  const f = (val, dots = 30) => {
    const t = String(val ?? '').trim();
    return t ? `<u class="fill">${escHtml(t)}</u>` : `<span class="dots">${'.'.repeat(dots)}</span>`;
  };

  const FOOT = `
    <div class="foot">
      <img class="foot-logo" src="${BRAND_LOGO_URL}">
      <div class="foot-lines">
        <div>info@motolinkers.com &nbsp; www.motolinkers.com &nbsp; Tax ID: ${escHtml(co.taxId || '773934006')}</div>
        <div>${escHtml(co.address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo')}</div>
        <div>+2 010 000 78104 &nbsp; REGISTRATION No: ${escHtml(co.commercialReg || '282378')}</div>
      </div>
    </div>`;

  const page = inner => `<section class="page"><div class="content">${inner}</div>${FOOT}</section>`;

  const p1 = `
    <div class="brandbar"><img src="${BRAND_LOGO_URL}"></div>
    <h1>عقد شراء وإستيراد سيارة لحساب الغير</h1>
    <p>إنه في يوم ${f(cd.day, 10)} الموافق ${f(cd.d, 5)} / ${f(cd.m, 5)} / ${f(cd.y, 6)} ، حرر بين كلا من -:</p>
    <p><b>أولا -:</b> شركة / ${f(co.name, 44)} ، ( ش . م . م ) ، سجل تجاري رقم ${f(co.commercialReg, 30)} ،
       بطاقة ضريبية رقم : ${f(co.taxId, 30)} ، ومقرها : ${f(co.address, 46)}
       ويمثلها في هذا العقد ${f(co.repIn || rp.name, 40)}</p>
    <p>الســــيد / ${f(rp.name, 46)} ، ويحمل بطاقة رقم قومي ${f(rp.nationalId, 34)} ،
       صادرة بتاريخ ${f(rp.idDate, 14)} ، ${f(rp.nationality, 10)} الجنسية ، ${f(rp.religion, 10)} الديانة ،
       ومقيم: ${f(rp.address, 40)} ، وذلك بصفه ${f(rp.role, 16)} عن الشركة بموجب تفويض خاص بذلك .</p>
    <p class="ref">( ويشار إليه في هذا العقد بالطرف الأول – المستورد – صاحب الترخيص - البائع )</p>
    <p><b>ثانيا :</b> الســــيد / ${f(by.name, 40)} ، ويحمل بطاقة رقم قومي ${f(by.nationalId, 34)} ،
       صادرة بتاريخ ${f(by.idDate, 14)} ، ${f(by.nationality, 10)} الجنسية ، ${f(by.religion, 10)} الديانة ،
       ومقيم: ${f(by.address, 40)}</p>
    <p class="ref">( ويشار إليه في هذا العقد بالطرف الثاني – المشتري )</p>
    <p>أقر المتعاقدان علي أهليتهما للتصرف وأتفقا علي ما يأتي :</p>`;

  const p2 = `
    <h2>تمهيد</h2>
    <p>حيث أن الطرف الأول هي شركة منشأة طبقا لقوانين جمهورية مصر العربية ، ومتخصصة ومرخص لها بإستيراد وتجارة السيارات من الخارج لداخل مصر ، ولما كان الطرف الثاني يرغب في إستيراد سيارة طبقا للمواصفات الموضحة بالبند الثاني من هذا العقد من خارج جمهورية مصر العربية عن طريق الطرف الأول ، علي أن يتم الإستيراد تحت مسئولية الطرف الأول ولحساب الطرف الثاني ، مع استيفاء كافة النواحي القانونية لتملك الطرف الثاني السيارة مقابل حصول الطرف الأول علي المقابل المذكور بالبند الثالث من هذا العقد ، وبعد أن أقر الطرف الأول بصحة الأوراق ، وتلاقت إرادة الطرفين بعد أن أقرا بأهليتهما الكاملة للتعاقد ، وإتفقا علي ما يلي :</p>
    <h2>البنـد الأول</h2>
    <p>يعتبر التمهيد الوارد بهذا العقد ، وكذا كافة المستندات الخاصة بالشركة الطرف الأول ، وكذا بصفة أطراف هذا العقد في التوقيع عليه ، وكافة المستندات الخاصة بعملية إستيراد وشراء وبيع وترخيص السيارة موضوع هذا العقد جزءاً لا يتجزأ من هذا العقد ومكملا ومتمما لبنوده ، ويقر الطرفان بان هذا العقد يعد عقد وكاله بالعمولة لاستيراد سيارة لحساب الطرف الثاني وفقا لاحكام قانون التجارة المصري والقانون المدني ، ويقتصر دور الطرف الاول علي القيام باجراءات التعاقد مع الموردين والشحن والتخليص الجمركي .</p>
    <h2>البنـد الثاني</h2>
    <p>إتفق طرفي هذا العقد علي أن يقوم الطرف الأول بما له من خبرة وإمكانية في إستيراد السيارة الأتي بيانها لحساب الطرف الثاني طبقا للمواصفات الموضحة فيما بعد ، وذلك علي النحو التالي :</p>`;

  const p3 = `
    <table class="carbox">
      <tr><th>ماركة السيارة:</th><td>${f(ve.make, 34)}</td></tr>
      <tr><th>موديل السيارة:</th><td>${f(ve.model, 34)}</td></tr>
      <tr><th>اللون:</th><td>${f(ve.color, 34)}</td></tr>
      <tr><th>سنة الصنع:</th><td>${f(ve.year, 34)}</td></tr>
      <tr><th>ملاحظات:</th><td>${f(ve.notes, 34)}</td></tr>
    </table>
    <p>علي أن يتم الإستيراد من دولة : ${f(v.importCountry, 24)} ، وعلي ان يحرر ملحق للعقد بالمواصفات الكاملة السيارة عقب التعاقد عليها ويوقع من الطرفين ويلتزم الطرف الأول بما يحتويه من مواصفات لتسليمها للطرف الثاني وعليه فالطرف الأول وحده منفرداً من له الحق في التواصل مع المورد والإتفاق علي كافة المواصفات السالف بيانها او المتفق عليها لاحقا، كما له الحق في التواصـل مع شركة الشحن أو وكيل الشحن فى بلد المورد لاستلام المنتجات من مخزن أو مصنع المورد ونقلها الى ميناء الشحن، والتواصل مع الخط الملاحى للقيام بعملية الشحن حتى ميناء الوصول، والتواصـل مع المستخلص الجمركى لانهاء اجراءات التخليص الجمركى داخل جمهورية مصر العربية وتسليمها للطرف الثاني .</p>
    <p>ويقر الطرف الثاني أن تفاصيل ومواصفات السيارة السالف بيانها قد تم تحديدها وفق رغبته وتعليماته بشكل نهائي ، وبناء عليها سيقوم الطرف الأول بإجراء المفاوضات اللازمة مع الموردين لإستيرادها ، وكذلك إتخاذ كل ما من شأنه إتمام عملية الإستيراد الشخصي ، كما يقر الطرف الثاني بأن تلك التفاصيل تعد غير قابلة لآية تعديلات إلا إذا أجازها الطرف الأول .</p>`;

  const p4 = `
    <h2>البنـد الثالث</h2>
    <p>إتفق طرفا هذا العقد علي أن يلتزم الطرف الثاني بأن يسدد للطرف الأول نظير قيام الأخير بعملية شراء وشحن وإستيراد السيارة لحساب الطرف الثاني، وسداد رسوم الجمارك والتخليص وإتمام إجراءات دخول السيارة إلي داخل مصر مبلغاً قدره ${f(v.total, 20)} ( فقط ${f(v.totalWords, 50)} لا غير ) ، أو ما يعادله بالجنيه المصري وهذا المبلغ يشمل ثمن شراء وإستيراد السيارة وعمولة الطرف الأول بالإضافة إلي كافة الرسوم والضرائب والجمارك في دولة المورد أو داخل مصر ، وكذلك أجور الشحن والنقل والتأمين وكافة التكاليف الناشئة عن إستيراد وجلب السيارة لتسليمها للطرف الثاني وتدفع علي النحو التالي :</p>
    <ul class="pays">
      ${pays.map(p => `<li>مبلغ قدره ${f(p.amount, 22)} جنيه يتم سداده ${escHtml(p.when || '')}${p.label ? ` ( ${escHtml(p.label)} )` : ''} .</li>`).join('')}
    </ul>
    <p>في حال حدوث اي تعديل في الرسوم الجمركية او الضرائب او القرارات المنظمة للاستيراد او سعر الصرف الرسمي للعملات الاجنبية قبل انهاء اجراءات الافراج الجمركي ، يلتزم الطرف الثاني بسداد اي فروق مالية ناتجة عن ذلك .</p>
    <p>وفي حالة تخلف الطرف الثاني عن سداد أي دفعة من الدفعات سالفة البيان في مواعيدها دون مبرر أو سبب مشروع فإنه يلتزم بأن يدفع للطرف الأول قدره ${f(v.lateFee, 30)} جنيه ( فقط وقدره ${f(v.lateFeeWords, 26)} مصريا لا غير ) عن كل يوم تأخير .</p>
    <h2>البنـد الرابع</h2>
    <p>إتفق الطرفان على أن يتم تنفيذ العقد واستيراد السيارة وتسليمها للطرف الثاني بعد انهاء كافة الإجراءات القانونية في موعد غايته ${f(v.deliveryDeadline, 22)} من تاريخ تحرير هذا العقد شرط سداد الإلتزامات المالية من المشتري في مواعيدها، ما لم تحدث أي ظروف قهرية خارجة عن إرادة الطرف الأول وتعيق تنفيذ هذا الإلتزام كظروف الحرب أو تعطيل الخطوط اللوجستية أو الكوارث الطبيعية .</p>
    <p>علي أن يسمح بالتأخير عن الموعد سالف الذكر لمدة اقصاها شهر من انتهاء الموعد المتفق عليه ثم يلتزم الطرف الأول بغرامة تأخير قدرها 0.1% من إجمالي قيمة السيارة عن كل يوم تأخير في التسليم .</p>`;

  const p5 = `
    <h2>البنـد الخامس</h2>
    <p><b>يلتزم الطرف الأول بالأتي:</b></p>
    <ol class="terms">
      <li>بإستيراد السيارة بناء علي طلب الطرف الثاني ووفقا لتعليماته الواردة بالبند الثاني من هذا العقد ، ويضمن أن يسلم الطرف الثاني السيارة طبقا لتلك المواصفات داخل جمهورية مصر العربية .</li>
      <li>بالحصول علي وإستخراج كافة التراخيص وأذونات الإستيراد من الجهات المختصة بجمهورية مصر العربية علي أن تندرج كافة الرسوم والمصاريف ضمن المبلغ المتفق عليه والمذكور بالبند الثالث من هذا العقد .</li>
      <li>بتسليم الطرف الثاني السيارة واستيفاء الأوراق اللازمة بالجمرك لتسجيلها ونقل ملكيتها باسم الطرف الثاني والمحافظة عليها وقت تسليمها .</li>
      <li>يقر الطرف الأول بصحة جميع الأوراق الخاصة بالسيارة ومطابقتها للشروط والمواصفات المتفق عليها الواردة بكتالوج السيارة .</li>
      <li>يقر الطرف الأول بإلتزامه بتسليم السيارة للطرف الثاني دون وجود أي عيوب ظاهرة او غير ظاهرة بالسيارة وخاصة تغيير هيكل السيارة أو وجود بارومة أو أجراء تعديل على الماتور أو الشاسيه أو تغيير الفتيس أو تعديله .</li>
    </ol>
    <p><b>يلتزم الطرف الثاني بالأتي :</b></p>
    <ol class="terms">
      <li>بسداد المبلغ المذكور بالبند الثالث من هذا العقد طبقا للقيم والدفعات والمواعيد المتفق عليها في هذا العقد .</li>
      <li>بإستلام السيارة خلال أسبوع من الموعد المتفق عليه بالبند الرابع من هذا العقد عقب إخطاره من الطرف الأول رسميا بذلك .</li>
      <li>في حال إمتناع الطرف الثاني عن إستلام السيارة المستوردة لحسابه في الموعد المحدد أو الذي يتم إخطاره به بأي وسيلة كانت فإنه يلتزم بآية نفقات أو أجور أو تكاليف أو أرضيات لتخزين السيارة لحين تسليمها له بما لا يتجاوز 0.1% من ثمن السيارة يوميا .</li>
      <li>يلتزم الطرف الثاني بتعويض الطرف الأول عن آية أضرار تصيبه من جراء تأخره عن إستلام السيارة . وفي جميع الأحوال يلتزم الطرف الثاني بتبعية هلاك السيارة إذا وقعت بعد تاريخ إمتناعه عن الإستلام ، وتكون السيارة تحت مسئولية الطرف الثاني أمام جهات الإختصاص داخل جمهورية مصر العربية من تاريخ إستلامها .</li>
      <li>يلتزم الطرف الثاني بأن يتسلم السيارة بشخصه أو من ينوب عنه بموجب توكيل رسمي بذلك . ولا يتم التعامل بأي تفويضات أو غير ذلك من المستندات .</li>
    </ol>`;

  const p6 = `
    <h2>البنـد السادس</h2>
    <p>في حال تراجع الطرف الثاني عن إتمام تنفيذ هذا العقد عقب توقيعه وقبل شحن السيارة محل هذا التعاقد ، فإنه يلزم بأن يدفع للطرف الأول مبلغا وقدره 10% من قيمه السيارة بدون الشحن والجمارك كشرط جزائي نهائي غير قابل للنقض أو التخفيض وغير خاضع لرقابة القضاء ، وهذا المبلغ نظير أتعابه وعمولته وآية مصاريف يكون الطرف الأول قد تكبدها في سبيل تنفيذ هذا العقد. ولا يجوز الغاء التعاقد بعد شحن السيارة .</p>
    <h2>البنـد السابع</h2>
    <p>كل نزاع ينشأ بين الطرفين خاصا بتنفيذ أي شرط من شروط هذا العقد يكون الفصل فيه من اختصاص محكمة شمال القاهرة الإبتدائية وجزئياتها ويقر الطرفان بأن عنوانيهما الموضح بأول هذا العقد هو محل إقامتهما وأية مراسلات أو إعلانات عليه تكون صحيحة ومنتجة قانونا وفي حالة تغير أي من الطرفين محل إقامته يلتزم بإخطار الطرف الآخر بموجب إنذار علي يد محضر أو بخطاب موصي عليه بعلم الوصول .</p>
    <h2>البنـد الثامن</h2>
    <p>يخضع هذا العقد ويتم تفسيره طبقاً لقوانين جمهورية مصر العربية ، ويمثل هذا العقد كامل الاتفاقات ما بين الطرفين ، ويحل محل أي اتفاق آخر أو تفاهم بينهما في هذا الخصوص سواء بالكتابة أو شفوياً ، ولا يجوز تعديل أي بند من بنود هذا العقد إلا بطريق الكتابة وتوقيع أطرافه الموضحين بأول هذا العقد .</p>
    <h2>البند التاسع</h2>
    <p>تحرر هذا العقد من عشرة بنود يقر كل من الطرفين بعلمه بكل ما جاء بها من شروط وأحكام ولا يجوز الرجوع فيها بعد توقيعه علي العقد وتحرر هذا العقد من نسختين بيد كل طرف نسخة للعمل بموجبها .</p>
    <table class="sign">
      <tr>
        <td>
          <div class="sig-h">الطـرف الثانـي</div>
          <div>الاسم : ${f(by.name, 18)}</div>
          <div>الرقم القومي : ${f(by.nationalId, 18)}</div>
          <div>التوقيع : <span class="dots">..................</span></div>
        </td>
        <td>
          <div class="sig-h">الطـرف الأول</div>
          <div>الاسم : ${f(rp.name, 18)}</div>
          <div>الرقم القومي : ${f(rp.nationalId, 18)}</div>
          <div>التوقيع : <span class="dots">..................</span></div>
        </td>
      </tr>
    </table>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:'Noto Naskh Arabic','Amiri','Traditional Arabic',serif; color:#111; direction:rtl; }
  .page { width:210mm; height:297mm; padding:18mm 16mm 24mm; position:relative; page-break-after:always; overflow:hidden; }
  .page:last-child { page-break-after:auto; }
  .content { font-size:12.5pt; line-height:2.0; text-align:justify; }
  .brandbar { text-align:center; margin:0 0 8mm; }
  .brandbar img { max-height:20mm; width:auto; display:inline-block; }
  h1 { font-size:17pt; text-align:center; margin:0 0 12mm; text-decoration:underline; }
  h2 { font-size:13.5pt; margin:6mm 0 2mm; text-decoration:underline; }
  p  { margin:0 0 3.5mm; }
  .ref { text-align:center; font-weight:700; }
  .fill { text-decoration:underline; font-weight:700; }
  .dots { letter-spacing:1px; color:#444; }
  .carbox { width:100%; border-collapse:collapse; margin:0 0 6mm; }
  .carbox th, .carbox td { border:1px solid #333; padding:2.6mm 3mm; font-size:12.5pt; text-align:right; }
  .carbox th { width:34%; background:#f3f3f3; font-weight:700; }
  ul.pays, ol.terms { margin:0 0 3.5mm; padding-right:7mm; }
  ul.pays li, ol.terms li { margin-bottom:2mm; }
  .sign { width:100%; margin-top:12mm; border-collapse:collapse; }
  .sign td { width:50%; vertical-align:top; padding:4mm; line-height:2.2; }
  .sig-h { font-weight:700; text-decoration:underline; margin-bottom:3mm; }
  .foot { position:absolute; left:16mm; right:16mm; bottom:8mm; border-top:1px solid #c9922a;
          padding-top:2mm; font-family:Arial,Helvetica,sans-serif; direction:ltr;
          font-size:7.6pt; color:#555; line-height:1.5;
          display:flex; align-items:center; gap:4mm; }
  .foot-logo { height:10mm; width:auto; flex-shrink:0; }
  .foot-lines { flex:1; text-align:center; }
</style></head><body>
${page(p1)}${page(p2)}${page(p3)}${page(p4)}${page(p5)}${page(p6)}
</body></html>`;
}

// ── Contract routes ───────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/contracts', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('contracts')
    .select('id,contract_no,title,status,customer_id,deal_id,created_by,created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/dashboard/contracts/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Contract not found' });
  res.json(data);
});

// Prefill payload for a brand-new contract (optionally seeded from a lead/deal).
receiver.router.get('/api/dashboard/contracts/new/defaults', requireAuth, async (req, res) => {
  try {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id) : null;
    const dealId = req.query.deal_id ? parseInt(req.query.deal_id) : null;
    const [cust, deal, settingsRows] = await Promise.all([
      customerId ? supabase.from('customers').select('*').eq('id', customerId).single().then(r => r.data) : null,
      dealId ? supabase.from('deals').select('*').eq('id', dealId).single().then(r => r.data) : null,
      supabase.from('quotation_settings').select('key,value').then(r => r.data),
    ]);
    const settings = {};
    for (const row of settingsRows || []) settings[row.key] = row.value;
    res.json({ contract_no: generateContractNo(), data: contractDefaults({ customer: cust, deal, settings }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/dashboard/contracts', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  const b = req.body || {};
  const row = {
    contract_no: String(b.contract_no || '').trim() || generateContractNo(),
    title: String(b.title || '').trim(),
    data: b.data && typeof b.data === 'object' ? b.data : {},
    customer_id: b.customer_id ? parseInt(b.customer_id) : null,
    deal_id: b.deal_id ? parseInt(b.deal_id) : null,
    status: ['draft', 'signed', 'cancelled'].includes(b.status) ? b.status : 'draft',
    created_by: 'dashboard',
  };
  const { data, error } = await supabase.from('contracts').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
  // Timeline: show the contract on the attached lead's 360° profile
  if (data.customer_id) {
    logLeadActivity(data.customer_id, {
      type: 'note', body: `Contract generated — ${data.contract_no}`,
      meta: { contract_id: data.id, contract_no: data.contract_no },
      authorKey: 'admin', authorName: 'Admin',
    });
  }
});

receiver.router.put('/api/dashboard/contracts/:id', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  const b = req.body || {};
  const upd = { updated_at: new Date().toISOString() };
  if (b.title != null) upd.title = String(b.title).trim();
  if (b.data && typeof b.data === 'object') upd.data = b.data;
  if (['draft', 'signed', 'cancelled'].includes(b.status)) upd.status = b.status;
  if (b.customer_id !== undefined) upd.customer_id = b.customer_id ? parseInt(b.customer_id) : null;
  const { data, error } = await supabase.from('contracts').update(upd).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/contracts/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('contracts').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Render the Arabic contract to PDF (reuses the quotation Puppeteer renderer).
receiver.router.post('/api/dashboard/contracts/pdf', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const payload = (req.body && req.body.data) || {};
    const html = buildContractHtml(payload);
    const pdf = await renderQuotationPdf(html);
    res.json({ pdf: Buffer.from(pdf).toString('base64') });
  } catch (e) {
    console.error('[contract-pdf]', e);
    res.status(500).json({ error: e.message });
  }
});

// Render a saved contract by id (used by the lead profile's document viewer).
receiver.router.post('/api/dashboard/contracts/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { data: row, error } = await supabase.from('contracts').select('*').eq('id', req.params.id).single();
    if (error || !row) return res.status(404).json({ error: 'Contract not found' });
    const pdf = await renderQuotationPdf(buildContractHtml(row.data || {}));
    res.json({ pdf: Buffer.from(pdf).toString('base64'), name: row.contract_no || 'contract' });
  } catch (e) {
    console.error('[contract-pdf-id]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Auto-generate a contract when a deal reaches the Won stage ────────────────
// Idempotent: one contract per deal (guarded by idx_contracts_deal_unique and an
// explicit lookup so re-entering Won never produces duplicates).
async function autoCreateContractForWonDeal(deal) {
  if (!deal || deal.stage !== 'won') return null;
  try {
    const { data: existing } = await supabase.from('contracts').select('id').eq('deal_id', deal.id).maybeSingle();
    if (existing) return null;
    const [cust, settingsRows] = await Promise.all([
      deal.customer_id ? supabase.from('customers').select('*').eq('id', deal.customer_id).single().then(r => r.data) : null,
      supabase.from('quotation_settings').select('key,value').then(r => r.data),
    ]);
    const settings = {};
    for (const row of settingsRows || []) settings[row.key] = row.value;
    const data = contractDefaults({ customer: cust, deal, settings, vehicle: deal.vehicle || deal.title });
    const title = `عقد — ${(cust && cust.name) || deal.title || ''}`.trim();
    const { data: row, error } = await supabase.from('contracts').insert({
      contract_no: generateContractNo(), title, data,
      customer_id: deal.customer_id || null, deal_id: deal.id,
      status: 'draft', created_by: 'auto_won',
    }).select().single();
    if (error) { console.warn('[contract] auto-create failed:', error.message); return null; }
    console.log('[contract] auto-generated', row.contract_no, 'for won deal', deal.id);
    if (deal.customer_id) {
      logLeadActivity(deal.customer_id, {
        type: 'note', body: `Contract ${row.contract_no} generated automatically (deal won)`,
        meta: { contract_id: row.id, contract_no: row.contract_no }, authorKey: 'system', authorName: 'System',
      });
    }
    createNotification('admin', {
      type: 'deal', title: 'Contract ready',
      body: `${title} — ${row.contract_no}`, url: '/dashboard#contracts',
    }, 'always');
    return row;
  } catch (e) { console.warn('[contract] auto-create error:', e.message); return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Purchase Orders ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Mirrors the ordering sheet: one PO holds many vehicle lines, each with its own
// client/consignee, spec, PI price, tracking status, VIN and client-file link.

const PO_LINE_STATUSES = [
  { key: 'send_to_supplier', label: 'SEND TO SUPPLIER',      bg: '#dbe4ff', fg: '#2f3f8f' },
  { key: 'in_preparation',   label: 'Car in Preparation',    bg: '#f3ddf7', fg: '#7b2d8e' },
  { key: 'in_logistics',     label: 'In Logistics',          bg: '#fdecc8', fg: '#8a5a00' },
  { key: 'delivered',        label: 'Car Delivered to moto', bg: '#d7f2d9', fg: '#1e6b2a' },
];
const PO_LINE_STATUS_KEYS = PO_LINE_STATUSES.map(s => s.key);
function poLineStatus(key) {
  return PO_LINE_STATUSES.find(s => s.key === key) || PO_LINE_STATUSES[0];
}
const PO_STATUSES = ['draft', 'sent', 'confirmed', 'closed'];

function generatePoNumber() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `PO${y}${m}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

// Normalize one vehicle line from the UI / import.
function poBuildItem(raw) {
  const r = raw || {};
  const num = (v, def = 0) => {
    const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
    return isFinite(n) && n > 0 ? n : def;
  };
  return {
    client:       String(r.client || '').trim(),
    consignee:    String(r.consignee || '').trim(),
    units:        Math.max(1, parseInt(String(r.units ?? '1').replace(/[^\d]/g, ''), 10) || 1),
    brand:        String(r.brand || '').trim(),
    model:        String(r.model || '').trim(),
    trim:         String(r.trim || '').trim(),
    color:        String(r.color || '').trim(),
    year:         String(r.year || '').trim(),
    accessories:  String(r.accessories || '').trim(),
    payment_term: String(r.payment_term || '').trim(),
    pi_price:     num(r.pi_price),
    status:       PO_LINE_STATUS_KEYS.includes(r.status) ? r.status : 'send_to_supplier',
    vin:          String(r.vin || '').trim(),
    file_link:    String(r.file_link || '').trim(),
  };
}

function poBuildRow(body) {
  const b = body || {};
  const items = (Array.isArray(b.items) ? b.items : []).map(poBuildItem)
    .filter(it => it.client || it.brand || it.model || it.vin);
  return {
    po_number: String(b.po_number || '').trim() || generatePoNumber(),
    title:     String(b.title || '').trim(),
    supplier:  String(b.supplier || '').trim(),
    po_date:   String(b.po_date || '').trim() || null,
    currency:  String(b.currency || 'USD').trim() || 'USD',
    notes:     String(b.notes || '').trim(),
    items,
    customer_id: b.customer_id ? parseInt(b.customer_id) : null,
    status:    PO_STATUSES.includes(b.status) ? b.status : 'draft',
    // Letterhead fields (supplier block + delivery terms) — see buildPurchaseOrderHtml
    supplier_id:        b.supplier_id ? parseInt(b.supplier_id) : null,
    supplier_contact:   String(b.supplier_contact || '').trim(),
    supplier_address:   String(b.supplier_address || '').trim(),
    supplier_country:   String(b.supplier_country || '').trim(),
    issuer:             String(b.issuer || '').trim(),
    quote_id:           String(b.quote_id || '').trim(),
    incoterm:           String(b.incoterm || 'FOB').trim(),
    delivery_location:  String(b.delivery_location || '').trim(),
    service_provider:   String(b.service_provider || '').trim(),
    contact:            String(b.contact || '').trim(),
    documents_required: String(b.documents_required || '').trim(),
    payment_terms:      String(b.payment_terms || '').trim(),
  };
}
function poTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.pi_price) || 0) * (Number(it.units) || 1), 0);
}

receiver.router.get('/api/dashboard/purchase-orders', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('purchase_orders')
    .select('id,po_number,title,supplier,po_date,currency,status,customer_id,items,created_by,created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/dashboard/purchase-orders/new/defaults', requireAuth, async (req, res) => {
  try {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id) : null;
    const cust = customerId
      ? await supabase.from('customers').select('*').eq('id', customerId).single().then(r => r.data)
      : null;
    // Seed the first line from the lead so the sheet opens partly filled.
    const item = poBuildItem({});
    if (cust) {
      const cf = cust.custom_fields || {};
      const car = String(cf.cf_vehicle_offered || cf.cf_vehicle_requested || cust.car_in_question || '').trim();
      const bits = car.split(/\s+/).filter(Boolean);
      item.client = cust.name || '';
      item.consignee = cust.name || '';
      item.brand = bits[0] || '';
      item.model = bits.slice(1).join(' ') || '';
      item.color = cf.cf_color || '';
      item.year = cf.cf_year || '';
    }
    res.json({
      po_number: generatePoNumber(),
      po_date: new Date().toISOString().slice(0, 10),
      currency: 'USD',
      items: [item],
      customer_id: customerId || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.get('/api/dashboard/purchase-orders/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('purchase_orders').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Purchase order not found' });
  res.json(data);
});

receiver.router.post('/api/dashboard/purchase-orders', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  const row = poBuildRow(req.body);
  row.created_by = 'dashboard';
  const { data, error } = await supabase.from('purchase_orders').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
  if (data.customer_id) {
    logLeadActivity(data.customer_id, {
      type: 'note', body: `Purchase order created — ${data.po_number}`,
      meta: { purchase_order_id: data.id, po_number: data.po_number },
      authorKey: 'admin', authorName: 'Admin',
    });
  }
});

receiver.router.put('/api/dashboard/purchase-orders/:id', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  const row = poBuildRow(req.body);
  row.updated_at = new Date().toISOString();
  delete row.po_number; // immutable once issued
  const { data, error } = await supabase.from('purchase_orders').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/purchase-orders/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('purchase_orders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

receiver.router.post('/api/dashboard/purchase-orders/pdf', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
    const settings = {};
    for (const r of settingsRows || []) settings[r.key] = r.value;
    const html = buildPurchaseOrderHtml({ ...req.body, ...poBuildRow(req.body), settings });
    const pdf = await renderQuotationPdf(html);   // portrait A4, like the paper form
    res.json({ pdf: Buffer.from(pdf).toString('base64') });
  } catch (e) {
    console.error('[po-pdf]', e);
    res.status(500).json({ error: e.message });
  }
});

// Render a saved purchase order by id (used by the lead profile's document viewer).
receiver.router.post('/api/dashboard/purchase-orders/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { data: row, error } = await supabase.from('purchase_orders').select('*').eq('id', req.params.id).single();
    if (error || !row) return res.status(404).json({ error: 'Purchase order not found' });
    const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
    const settings = {};
    for (const s of settingsRows || []) settings[s.key] = s.value;
    const pdf = await renderQuotationPdf(buildPurchaseOrderHtml({ ...row, settings }));
    res.json({ pdf: Buffer.from(pdf).toString('base64'), name: row.po_number || 'purchase-order' });
  } catch (e) {
    console.error('[po-pdf-id]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Shared letterhead chrome for supplier-facing documents (RFQ + PO) ─────────
// Both reproduce the company's real forms: logo, title, ID/Date/Issuer box, a
// Supplier Details block, the item grid, then Payment and Delivery Terms.
function docChromeCss(T) {
  const GOLD = T.accent, INK = T.ink, SOFT = T.soft;
  return `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:Arial,Helvetica,sans-serif; font-size:9.5px; color:${INK}; background:#fff; }
  .page { width:794px; min-height:1123px; padding:22px 26px 96px; position:relative; }
  .head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:10px; }
  .head img { max-height:44px; width:auto; display:block; }
  .title { font-family:${T.titleFont}; font-size:20px; font-weight:900; letter-spacing:${T.titleSpacing};
           color:${INK}; text-align:center; flex:1; padding-top:8px; }
  table.meta { border-collapse:collapse; }
  table.meta td { border:1px solid ${GOLD}; padding:3px 9px; font-size:9px; }
  table.meta .k { background:${SOFT}; font-weight:700; white-space:nowrap; }
  table.meta .v { font-weight:700; color:#c00; min-width:108px; }
  .sec { margin-top:12px; border:1px solid ${GOLD}; }
  .sec-h { background:${SOFT}; font-family:${T.titleFont}; font-weight:800; font-size:11px;
           padding:5px 10px; border-bottom:1px solid ${GOLD}; }
  .sec-b { padding:8px 10px; line-height:1.9; }
  table.kv { width:100%; border-collapse:collapse; }
  table.kv td { border:1px solid ${GOLD}; padding:4px 9px; font-size:9.5px; }
  table.kv td:first-child { width:26%; font-weight:700; background:#fafafa; }
  table.grid { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:12px; }
  table.grid th { background:${INK}; color:#fff; font-family:${T.titleFont}; font-size:8.5px;
                  padding:6px 4px; border:1px solid ${GOLD}; text-align:center; }
  table.grid td { border:1px solid ${GOLD}; padding:6px 5px; vertical-align:middle; word-wrap:break-word; min-height:26px; }
  td.c { text-align:center; } td.r { text-align:right; }
  td.acc { font-size:8px; line-height:1.5; text-align:center; font-weight:700; color:${INK}; }
  .tot td { background:${SOFT}; font-weight:800; font-size:10.5px; }
  .red { color:#c00; font-weight:700; }
  .foot { position:absolute; left:26px; right:26px; bottom:14px; display:flex; align-items:flex-end;
          justify-content:space-between; gap:12px; font-size:7.6px; color:#333; line-height:1.65;
          border-top:2px solid ${GOLD}; padding-top:7px; }
  .foot img { max-height:30px; width:auto; }`;
}
function docFooterHtml(s) {
  return `<div class="foot">
    <div>
      <div><b>Address:</b> ${escHtml(s.company_address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo')}</div>
      <div><b>Email:</b> ${escHtml(s.company_email || 'info@motolinkers.com')}</div>
      <div><b>Website:</b> ${escHtml(s.company_website || 'Motolinkers.com')}</div>
      <div><b>Phone:</b> ${escHtml(s.company_phone || '+2 010 000 78104')}</div>
      <div><b>TAX ID:</b> ${escHtml(s.company_tax_id || '773934006')}</div>
      <div><b>Registration No:</b> ${escHtml(s.company_reg_no || '282378')}</div>
    </div>
    <img src="${BRAND_LOGO_URL}">
  </div>`;
}
function docSupplierBlock(d) {
  return `<div class="sec">
    <div class="sec-h">Supplier Details</div>
    <table class="kv">
      <tr><td>Name</td><td>${escHtml(d.supplier_name || d.supplier || '')}</td></tr>
      <tr><td>Contact</td><td>${escHtml(d.supplier_contact || '')}</td></tr>
      <tr><td>Address</td><td>${escHtml(d.supplier_address || '')}</td></tr>
      <tr><td>Country of Origin</td><td>${escHtml(d.supplier_country || '')}</td></tr>
    </table>
  </div>`;
}
const DOC_DEFAULT_PAYMENT_TERMS =
  '30% deposit to confirm the order\n70% balance due after the vehicle arrives in XXXXX (VIN code and PDI vehicle video and document to be provided for confirmation)';
const DOC_DEFAULT_DOCUMENTS =
  'MSDS / UN3.8 / Commercial Invoice / Shipping order / Packing List / Temporary Licence and Plate / Sales contract / Export Licence / SGS PDI or Certificate of Conformity (CoC) / CIF ONLY ( B/L / Telex Release / Insurance Policy)';
const DOC_DEFAULT_ACCESSORIES =
  'English system , wall mount charging cable , floor mats, tires repairing kit , electric pump';

// Highlight the placeholder tokens the team fills in by hand, like the paper form.
function docRedify(text) {
  return escHtml(text).replace(/\n/g, '<br>')
    .replace(/(X{3,}\s*(?:Port)?|CIF ONLY[^<]*)/gi, m => `<span class="red">${m}</span>`);
}
function docTermsHtml(d, opts) {
  const o = opts || {};
  return `
  <div class="sec">
    <div class="sec-h">Payment Terms</div>
    <div class="sec-b">${docRedify(d.payment_terms || DOC_DEFAULT_PAYMENT_TERMS)}</div>
  </div>
  <div class="sec">
    <div class="sec-h">Delivery Terms</div>
    <table class="kv">
      ${o.incoterm ? `<tr><td>Incoterm</td><td class="red">${escHtml(d.incoterm || 'FOB')}</td></tr>` : ''}
      <tr><td>Delivery Location</td><td class="red">${escHtml(d.delivery_location || '')}</td></tr>
      <tr><td>Service Provider</td><td class="red">${escHtml(d.service_provider || '')}</td></tr>
      <tr><td>Contact</td><td class="red">${escHtml(d.contact || '')}</td></tr>
      <tr><td>Documents Required</td><td>${docRedify(d.documents_required || DOC_DEFAULT_DOCUMENTS)}</td></tr>
    </table>
  </div>`;
}

// A4 portrait Purchase Order on company letterhead (matches the printed form).
function buildPurchaseOrderHtml(po) {
  const s = po.settings || {};
  const T = quoteTheme(po.template);
  const money = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const items = po.items || [];
  const cur = escHtml(po.currency || 'USD');
  // Always print at least 5 rows so the form looks like the paper original.
  const padded = items.concat(Array.from({ length: Math.max(0, 5 - items.length) }, () => null));
  const rows = padded.map((it, i) => {
    if (!it) return `<tr><td class="c">&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
    const qty = Number(it.units) || 1;
    const price = Number(it.pi_price) || 0;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${escHtml(it.client)}</td>
      <td class="c">${escHtml(it.brand)}</td>
      <td>${escHtml(it.model)}</td>
      <td>${escHtml(it.trim)}</td>
      <td>${escHtml(it.color)}</td>
      <td class="c">${escHtml(it.year)}</td>
      <td class="acc">${escHtml(it.accessories || DOC_DEFAULT_ACCESSORIES).replace(/\n/g, '<br>')}</td>
      <td class="c">${qty}</td>
      <td class="r">${price ? cur + ' ' + money(price) : ''}</td>
      <td class="r">${price ? cur + ' ' + money(price * qty) : ''}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">${T.fontLink}
<style>${docChromeCss(T)}</style></head><body>
<div class="page">
  <div class="head">
    <img src="${BRAND_LOGO_URL}">
    <div class="title">Purchase Order</div>
    <table class="meta">
      <tr><td class="k">ID</td><td class="v">${escHtml(po.quote_id || po.po_number || '')}</td></tr>
      <tr><td class="k">Date</td><td class="v">${escHtml(po.po_date || '')}</td></tr>
      <tr><td class="k">Issuer</td><td class="v">${escHtml(po.issuer || '')}</td></tr>
    </table>
  </div>

  ${docSupplierBlock(po)}

  <table class="grid">
    <colgroup>
      <col style="width:26px"><col style="width:86px"><col style="width:52px"><col style="width:62px">
      <col style="width:52px"><col style="width:86px"><col style="width:34px"><col style="width:132px">
      <col style="width:30px"><col style="width:72px"><col style="width:78px">
    </colgroup>
    <thead><tr>
      <th>No</th><th>CLIENT</th><th>BRAND</th><th>MODEL</th><th>TRIM</th><th>COLOR EXT / INT</th>
      <th>YEAR</th><th>ACCESSORIES / REMARKS</th><th>QTY</th><th>PRICE</th><th>TOTAL</th>
    </tr></thead>
    <tbody>
      ${rows}
      <tr class="tot"><td colspan="10" class="r">TOTAL</td><td class="r">${cur} ${money(poTotal(items))}</td></tr>
    </tbody>
  </table>

  ${po.notes ? `<div class="sec"><div class="sec-h">Notes</div><div class="sec-b">${escHtml(po.notes).replace(/\n/g, '<br>')}</div></div>` : ''}
  ${docTermsHtml(po, { incoterm: true })}

  ${docFooterHtml(s)}
</div>
</body></html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── RFQ — Request for Quotation (sent to suppliers) ───────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const RFQ_STATUSES = ['draft', 'sent', 'answered', 'closed'];

function generateRfqNo() {
  const now = new Date();
  const week = String(getIsoWeek(now)).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `MT${week}W${rand}Y${String(now.getFullYear()).slice(-2)}`;
}

function rfqBuildItem(raw) {
  const r = raw || {};
  const money = v => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;
  return {
    brand:       String(r.brand || '').trim(),
    model:       String(r.model || '').trim(),
    trim:        String(r.trim || '').trim(),
    colour:      String(r.colour || r.color || '').trim(),
    year:        String(r.year || '').trim(),
    accessories: String(r.accessories || '').trim() || DOC_DEFAULT_ACCESSORIES,
    lead_time:   String(r.lead_time || '').trim(),
    fob_price:   money(r.fob_price),
    cif_price:   money(r.cif_price),
  };
}

function rfqBuildRow(body) {
  const b = body || {};
  const items = (Array.isArray(b.items) ? b.items : []).map(rfqBuildItem)
    .filter(it => it.brand || it.model || it.trim || it.fob_price || it.cif_price);
  return {
    rfq_no:  String(b.rfq_no || '').trim() || generateRfqNo(),
    title:   String(b.title || '').trim(),
    supplier_id:      b.supplier_id ? parseInt(b.supplier_id) : null,
    supplier_name:    String(b.supplier_name || '').trim(),
    supplier_contact: String(b.supplier_contact || '').trim(),
    supplier_address: String(b.supplier_address || '').trim(),
    supplier_country: String(b.supplier_country || '').trim(),
    issuer:   String(b.issuer || '').trim(),
    rfq_date: String(b.rfq_date || '').trim() || null,
    items,
    payment_terms:      String(b.payment_terms || '').trim(),
    delivery_location:  String(b.delivery_location || '').trim(),
    service_provider:   String(b.service_provider || '').trim(),
    contact:            String(b.contact || '').trim(),
    documents_required: String(b.documents_required || '').trim(),
    customer_id: b.customer_id ? parseInt(b.customer_id) : null,
    status: RFQ_STATUSES.includes(b.status) ? b.status : 'draft',
  };
}

receiver.router.get('/api/dashboard/rfqs', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('rfqs')
    .select('id,rfq_no,title,supplier_name,issuer,rfq_date,status,customer_id,items,created_by,created_at')
    .order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Prefill a new RFQ from a lead — same contract as the contract/PO defaults.
receiver.router.get('/api/dashboard/rfqs/new/defaults', requireAuth, async (req, res) => {
  try {
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id) : null;
    const cust = customerId
      ? await supabase.from('customers').select('*').eq('id', customerId).single().then(r => r.data)
      : null;
    const item = rfqBuildItem({});
    if (cust) {
      const cf = cust.custom_fields || {};
      const car = String(cf.cf_vehicle_offered || cf.cf_vehicle_requested || cust.car_in_question || '').trim();
      const bits = car.split(/\s+/).filter(Boolean);
      item.brand = bits[0] || '';
      item.model = bits.slice(1).join(' ') || '';
      item.colour = cf.cf_color || '';
      item.year = cf.cf_year || '';
    }
    // Eight blank lines, matching the printed form.
    const items = [item, ...Array.from({ length: 7 }, () => rfqBuildItem({}))];
    res.json({
      rfq_no: generateRfqNo(),
      rfq_date: new Date().toISOString().slice(0, 10),
      items,
      payment_terms: DOC_DEFAULT_PAYMENT_TERMS,
      documents_required: DOC_DEFAULT_DOCUMENTS,
      customer_id: customerId || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.get('/api/dashboard/rfqs/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('rfqs').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'RFQ not found' });
  res.json(data);
});

receiver.router.post('/api/dashboard/rfqs', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  const row = rfqBuildRow(req.body);
  row.created_by = 'dashboard';
  const { data, error } = await supabase.from('rfqs').insert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
  if (data.customer_id) {
    logLeadActivity(data.customer_id, {
      type: 'note', body: `RFQ created — ${data.rfq_no}`,
      meta: { rfq_id: data.id, rfq_no: data.rfq_no }, authorKey: 'admin', authorName: 'Admin',
    });
  }
});

receiver.router.put('/api/dashboard/rfqs/:id', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  const row = rfqBuildRow(req.body);
  row.updated_at = new Date().toISOString();
  delete row.rfq_no;   // immutable once issued
  const { data, error } = await supabase.from('rfqs').update(row).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.delete('/api/dashboard/rfqs/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('rfqs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

async function rfqSettings() {
  const { data } = await supabase.from('quotation_settings').select('key,value');
  const settings = {};
  for (const r of data || []) settings[r.key] = r.value;
  return settings;
}

receiver.router.post('/api/dashboard/rfqs/pdf', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const html = buildRfqHtml({ ...rfqBuildRow(req.body), settings: await rfqSettings() });
    res.json({ pdf: Buffer.from(await renderQuotationPdf(html)).toString('base64') });
  } catch (e) { console.error('[rfq-pdf]', e); res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/dashboard/rfqs/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { data: row, error } = await supabase.from('rfqs').select('*').eq('id', req.params.id).single();
    if (error || !row) return res.status(404).json({ error: 'RFQ not found' });
    const html = buildRfqHtml({ ...row, settings: await rfqSettings() });
    res.json({ pdf: Buffer.from(await renderQuotationPdf(html)).toString('base64'), name: row.rfq_no || 'rfq' });
  } catch (e) { console.error('[rfq-pdf-id]', e); res.status(500).json({ error: e.message }); }
});

// A4 portrait Request for Quotation on company letterhead.
function buildRfqHtml(r) {
  const s = r.settings || {};
  const T = quoteTheme(r.template);
  const money = n => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const items = Array.isArray(r.items) ? r.items : [];
  const padded = items.concat(Array.from({ length: Math.max(0, 8 - items.length) }, () => null));
  const rows = padded.map(it => {
    const v = it || {};
    return `<tr>
      <td>${escHtml(v.brand || '')}</td>
      <td>${escHtml(v.model || '')}</td>
      <td>${escHtml(v.trim || '')}</td>
      <td>${escHtml(v.colour || '')}</td>
      <td class="c">${escHtml(v.year || '')}</td>
      <td class="acc">${escHtml(v.accessories || DOC_DEFAULT_ACCESSORIES).replace(/\n/g, '<br>')}</td>
      <td class="c">${escHtml(v.lead_time || '')}</td>
      <td class="r">${v.fob_price ? money(v.fob_price) : ''}</td>
      <td class="r">${v.cif_price ? money(v.cif_price) : ''}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">${T.fontLink}
<style>${docChromeCss(T)}</style></head><body>
<div class="page">
  <div class="head">
    <img src="${BRAND_LOGO_URL}">
    <div class="title">Request for Quotation</div>
    <table class="meta">
      <tr><td class="k">ID</td><td class="v">${escHtml(r.rfq_no || '')}</td></tr>
      <tr><td class="k">Date</td><td class="v">${escHtml(r.rfq_date || '')}</td></tr>
      <tr><td class="k">Issuer</td><td class="v">${escHtml(r.issuer || '')}</td></tr>
    </table>
  </div>

  ${docSupplierBlock(r)}

  <table class="grid">
    <colgroup>
      <col style="width:66px"><col style="width:62px"><col style="width:44px"><col style="width:76px">
      <col style="width:34px"><col style="width:150px"><col style="width:60px"><col style="width:62px">
      <col style="width:88px">
    </colgroup>
    <thead><tr>
      <th>BRAND</th><th>MODEL</th><th>TRIM</th><th>COLOR EXT / INT</th><th>YEAR</th>
      <th>ACCESSORIES / REMARKS</th><th>LEAD TIME</th><th>FOB PRICE</th><th>CIF PRICE (RoRo)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${docTermsHtml(r, { incoterm: false })}

  ${docFooterHtml(s)}
</div>
</body></html>`;
}

// Render quotation HTML to a PDF buffer via Puppeteer, blocking any resource
// load that isn't an inline data: URL or https: (prevents file:// LFI and
// internal http:// SSRF from authored/injected markup).
async function renderQuotationPdf(html, opts) {
  const { landscape = false } = opts || {};
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', r => {
      const u = r.url();
      if (u.startsWith('data:') || u.startsWith('https:')) r.continue();
      else r.abort();
    });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    return await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  } finally {
    await browser.close();
  }
}

// Company logo used on every generated document (quotation + contract).
const BRAND_LOGO_URL = 'https://images.motolinkers.com/avatar-11-max-reev/motolinkers-logo-black-text-preview.png';

// Selectable quotation looks. Both render the SAME structure — only the palette
// and typography differ — so switching a quote between them never moves content.
const QUOTE_THEMES = {
  classic: {
    key: 'classic', label: 'Classic — navy & gold',
    accent: '#c9922a', ink: '#1B2D6B', soft: '#f5e9c8',
    zebra: '#fdfaf3', meta: '#cc3300',
    titleFont: 'Arial, sans-serif', titleSpacing: '2px', fontLink: '',
  },
  brand: {
    key: 'brand', label: 'Brand — charcoal & gold',
    accent: '#c9a35e', ink: '#1b1b1f', soft: '#f7efdf',
    zebra: '#faf7f0', meta: '#a07e3f',
    titleFont: "'Cormorant Garamond', Georgia, serif", titleSpacing: '4px',
    fontLink: '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&display=swap" rel="stylesheet">',
  },
};
function quoteTheme(key) { return QUOTE_THEMES[key] || QUOTE_THEMES.classic; }

function buildQuotationHtml(data) {
  const { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings } = data;
  const s = settings || {};
  const exRate = parseFloat(exchange) || 1;
  const T = quoteTheme(data.template);

  // Calculate totals
  let grandTotal = 0;
  const itemRows = (items || []).map(item => {
    const isFree  = !item.priceUsd || String(item.priceUsd).trim().toLowerCase() === 'free';
    const egp     = isFree ? null : calcEgp(item.priceUsd, item.unit || 1, exRate);
    if (egp !== null) grandTotal += egp;
    return { ...item, egp };
  });

  const logisticsRows = (logistics || []).map(row => {
    const egp = calcEgp(row.priceUsd, 1, exRate);
    if (egp !== null) grandTotal += egp;
    return { ...row, egp };
  });

  const GOLD   = T.accent;   // accent / hairlines
  const NAVY   = T.ink;      // primary ink + header fills
  const LGOLD  = T.soft;     // soft fill behind labels & totals

  const imgSection = imageDataUrls && imageDataUrls.length
    ? `<tr><td colspan="4" style="padding:10px 0;border:1px solid ${GOLD};border-top:none">
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          ${imageDataUrls.map(src => `<img src="${escHtml(src)}" style="height:130px;max-width:220px;object-fit:contain;border-radius:4px;border:1px solid ${GOLD}">`).join('')}
        </div>
       </td></tr>`
    : '';

  const vehicleRow = vehicleModel
    ? `<tr><td colspan="4" style="text-align:center;font-size:17px;font-weight:700;color:${T.meta};padding:10px 8px;border:1px solid ${GOLD};border-bottom:none">${escHtml(vehicleModel)}</td></tr>`
    : '';

  const itemRowsHtml = itemRows.map((item, i) => {
    const isFree = item.egp === null;
    const bg = i % 2 === 1 ? `background:${T.zebra}` : '';
    return `<tr style="${bg}">
      <td style="padding:7px 10px;border:1px solid ${GOLD};color:${NAVY}">${escHtml(item.name || '')}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${escHtml(item.unit || 1)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${isFree ? 'Free' : fmtNum(item.priceUsd)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${isFree ? 'Free' : fmtNum(item.egp)}</td>
    </tr>`;
  }).join('');

  const logRowsHtml = logisticsRows.map((row, i) => {
    const bg = i % 2 === 1 ? `background:${T.zebra}` : '';
    return `<tr style="${bg}">
      <td colspan="2" style="padding:7px 10px;border:1px solid ${GOLD};color:${NAVY}">${escHtml(row.label)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${fmtNum(row.priceUsd)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${fmtNum(row.egp)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">${T.fontLink}
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: ${NAVY}; background: #fff; padding: 0; }
  .page { width: 794px; min-height: 1123px; padding: 24px 28px 80px; position: relative; }

  .logo-text { font-size: 22px; font-weight: 900; letter-spacing: 1px; color: ${NAVY}; }
  .logo-link { color: ${GOLD}; }

  .header-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .quotation-title { font-family: ${T.titleFont}; font-size: 24px; font-weight: 900;
    letter-spacing: ${T.titleSpacing}; color: ${NAVY}; text-align: center; }
  .section-label, .col-header, .total-row td, .ks-label, .meta-label { font-family: ${T.titleFont}; }

  .meta-table { border-collapse: collapse; width: 100%; }
  .meta-table td { padding: 3px 8px; border: 1px solid ${GOLD}; font-size: 10px; }
  .meta-label { font-weight: 700; color: ${NAVY}; background: ${LGOLD}; white-space: nowrap; }
  .meta-val   { font-weight: 700; color: ${T.meta}; min-width: 120px; }

  .section-label { font-weight: 700; font-size: 11px; color: ${NAVY}; padding: 6px 10px;
    border: 1px solid ${GOLD}; background: #fff; margin-top: 10px; }

  .main-table { width: 100%; border-collapse: collapse; }
  .col-header { background: ${NAVY}; color: #fff; font-weight: 700; font-size: 11px;
    padding: 7px 10px; text-align: center; border: 1px solid ${GOLD}; }
  .col-header-left { text-align: left; }

  .total-row td { font-weight: 700; color: ${NAVY}; background: ${LGOLD}; padding: 8px 10px;
    border: 1px solid ${GOLD}; font-size: 12px; }

  .key-specs-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .ks-label { font-weight: 700; background: ${LGOLD}; padding: 6px 10px; border: 1px solid ${GOLD}; white-space: nowrap; color: ${NAVY}; }
  .ks-val   { padding: 6px 10px; border: 1px solid ${GOLD}; color: ${NAVY}; }

  .payment-box { border: 1px solid ${GOLD}; padding: 10px 14px; font-size: 10px; line-height: 1.8; color: ${NAVY}; }
  .payment-title { font-weight: 700; margin-bottom: 4px; }

  .footer { position: absolute; bottom: 16px; left: 28px; right: 28px;
    border-top: 2px solid ${GOLD}; padding-top: 8px;
    display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #888; }
  .footer-brand { font-weight: 700; color: ${NAVY}; font-size: 10px; }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <table class="header-table">
    <tr>
      <td style="width:35%;vertical-align:middle">
        <img src="${BRAND_LOGO_URL}" style="max-height:60px;width:auto;display:block">
      </td>
      <td style="width:30%;text-align:center;vertical-align:middle">
        <div class="quotation-title">QUOTATION</div>
      </td>
      <td style="width:35%;vertical-align:top">
        <table class="meta-table">
          <tr><td class="meta-label">ID</td><td class="meta-val">${escHtml(id || '')}</td></tr>
          <tr><td class="meta-label">DATE</td><td class="meta-val">${escHtml(date || '')}</td></tr>
          <tr><td class="meta-label">VALID TO</td><td class="meta-val">${escHtml(validTo || '')}</td></tr>
          <tr><td class="meta-label">NAME</td><td class="meta-val">${escHtml(name || '')}</td></tr>
        </table>
      </td>
    </tr>
  </table>
  <div style="border-top: 2px solid ${GOLD}; margin-bottom: 10px"></div>

  <!-- VEHICLE + IMAGES -->
  <table class="main-table">
    ${vehicleRow}
    ${imgSection}
  </table>

  <!-- PRICING BREAKDOWN -->
  <div class="section-label">PRICING BREAKDOWN</div>
  <table class="main-table">
    <thead>
      <tr>
        <th class="col-header col-header-left" style="width:50%">ITEM</th>
        <th class="col-header" style="width:10%">UNIT</th>
        <th class="col-header" style="width:20%">PRICE USD</th>
        <th class="col-header" style="width:20%">TOTAL EGP</th>
      </tr>
    </thead>
    <tbody>${itemRowsHtml}</tbody>
  </table>

  <!-- LOGISTICS PRICING BREAKDOWN -->
  <div class="section-label" style="margin-top:0;border-top:none">LOGISTICS PRICING BREAKDOWN</div>
  <table class="main-table">
    <thead>
      <tr>
        <th class="col-header col-header-left" colspan="2" style="width:60%">ITEM</th>
        <th class="col-header" style="width:20%">PRICE USD</th>
        <th class="col-header" style="width:20%">TOTAL EGP</th>
      </tr>
    </thead>
    <tbody>
      ${logRowsHtml}
      <tr class="total-row">
        <td colspan="3">Total Price Breakdown in EGP</td>
        <td style="text-align:center">${fmtNum(grandTotal)}</td>
      </tr>
    </tbody>
  </table>

  <!-- KEY SPECS (left) + PAYMENT TERMS / CURRENCY / EXCHANGE (right) -->
  ${(() => {
    const leftContent = [
      issuer ? `<div><strong>Issuer:</strong> ${escHtml(issuer)}</div>` : '',
      ...(customSpecs || []).map(sp => sp.key ? `<div><strong>${escHtml(sp.key)}:</strong> ${escHtml(sp.val || '')}</div>` : `<div>${escHtml(sp.val || '')}</div>`),
    ].filter(Boolean).join('');
    const rightBox = `
      <div style="width:46%;border:1px solid ${GOLD};padding:12px 16px;font-size:10.5px;line-height:2;color:${NAVY};${leftContent ? '' : 'margin-left:auto'}">
        <div style="font-weight:700;margin-bottom:4px">Payment terms</div>
        ${(s.payment_terms || '50% Down payment operations start\n30% Upon shipping from supplier\n20% Upon Custom clearances').split('\n').map(l => `<div style="padding-left:14px">${escHtml(l)}</div>`).join('')}
        <div style="margin-top:8px;border-top:1px solid ${GOLD};padding-top:6px">
          <div><strong>Currency:</strong> ${escHtml(currency || 'EGP')}</div>
          <div><strong>Exchange:</strong> ${fmtNum(exchange)}</div>
        </div>
      </div>`;
    return `
  <div style="margin-top:14px">
    <div class="section-label" style="margin-top:0">KEY SPECS</div>
    <div style="display:flex;gap:14px;align-items:stretch">
      ${leftContent ? `<div style="flex:1;border:1px solid ${GOLD};padding:12px 16px;font-size:10.5px;line-height:2;color:${NAVY}">${leftContent}</div>` : ''}
      ${rightBox}
    </div>
  </div>`;
  })()}

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-brand">${escHtml(s.company_name || 'MOTOLINKERS')}</div>
    <div>This quotation is valid until ${escHtml(validTo || '—')} | ${escHtml(s.footer_note || 'Confidential')}</div>
    <div>${escHtml(id || '')}</div>
  </div>

  <!-- COMPANY CONTACT FOOTER -->
  <div style="border:2px solid ${NAVY};border-radius:8px;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:16px">
    <div style="display:flex;flex-direction:column;gap:3px;font-size:9px;color:#333;line-height:1.5">
      <div><strong>Address:</strong> ${escHtml(s.company_address || 'Office (ACO2), Floor (4), Building No. (100), Al-Mirghani Street - Heliopolis - Cairo')}</div>
      <div><strong>Email:</strong> ${escHtml(s.company_email || 'info@motolinkers.com')} &nbsp;|&nbsp; <strong>Website:</strong> ${escHtml(s.company_website || 'Motolinkers.com')} &nbsp;|&nbsp; <strong>Phone:</strong> ${escHtml(s.company_phone || '+2 010 000 78104')}</div>
      ${s.company_tax_id ? `<div><strong>TAX ID:</strong> ${escHtml(s.company_tax_id)} &nbsp;|&nbsp; <strong>Registration No:</strong> ${escHtml(s.company_reg_no || '')}</div>` : `<div><strong>TAX ID:</strong> 773934006 &nbsp;|&nbsp; <strong>Registration No:</strong> 282378</div>`}
    </div>
    <div style="margin-left:20px;flex-shrink:0">
      <img src="${BRAND_LOGO_URL}" style="max-height:45px;width:auto;display:block">
    </div>
  </div>

</div>
</body></html>`;
}

receiver.router.post('/api/dashboard/quotation/generate', requireAuth,
  quotationImgUpload.array('images', 5), async (req, res) => {
    try {
      const { id, date, validTo, name, vehicleModel, items: itemsJson, logistics: logisticsJson, currency, exchange, issuer, customSpecs: customSpecsJson } = req.body;
      const items       = JSON.parse(itemsJson       || '[]');
      const logistics   = JSON.parse(logisticsJson   || '[]');
      const customSpecs = JSON.parse(customSpecsJson || '[]');
      let existingImages = [];
      try { existingImages = JSON.parse(req.body.existingImages || '[]'); } catch (_) {}
      const files       = req.files || [];
      const uploaded    = files.map(f => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);
      // Keep previously-saved images (restored on edit/duplicate) + any newly uploaded, capped at 5.
      const imageDataUrls = [...(Array.isArray(existingImages) ? existingImages : []), ...uploaded].slice(0, 5);

      // Load company settings from DB
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;

      const template = quoteTheme(req.body.template).key;
      const html = buildQuotationHtml({ id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings, template });

      const pdfBuffer = await renderQuotationPdf(html);

      res.json({ pdf: Buffer.from(pdfBuffer).toString('base64') });
      // Save/update the quotation record (best-effort). Images are persisted in `data` so edit/duplicate can restore them.
      const custId = req.body.customer_id ? parseInt(req.body.customer_id) : null;
      const pk = req.body.quotation_pk ? parseInt(req.body.quotation_pk) : null;
      const record = {
        title: `${vehicleModel || 'Quotation'} — ${name || ''}`.trim(),
        data: { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, customSpecs, imageDataUrls, template },
        customer_id: custId,
      };
      if (pk) {
        supabase.from('quotations').update(record).eq('id', pk).select().single().then(({ data: qrow }) => {
          if (custId && qrow) logLeadActivity(custId, { type: 'quote', body: `Quotation updated — ${qrow.title}`, meta: { quotation_id: qrow.id, quote_id: qrow.quote_id }, authorKey: 'admin', authorName: 'Admin' });
        }).catch(() => {});
      } else {
        supabase.from('quotations').insert({ ...record, quote_id: id || generateQuoteId(), created_by: 'dashboard' }).select().single().then(({ data: qrow }) => {
          if (custId && qrow) logLeadActivity(custId, { type: 'quote', body: `Quotation generated — ${qrow.title}`, meta: { quotation_id: qrow.id, quote_id: qrow.quote_id }, authorKey: 'admin', authorName: 'Admin' });
          if (qrow) runAutomations('quote.generated', { entityType: 'quote', entityId: qrow.id, customerId: custId, ownerId: null, fields: { name: name || '', vehicleModel: vehicleModel || '', title: qrow.title } });
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[quotation-gen]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ─── Employee Quotation Draft ──────────────────────────────────────────────────
receiver.router.get('/api/employee/quotation/newid', requireEmployeeAuth, (req, res) => {
  if (!empCan(req.employee, 'quotation', 'draft')) return res.status(403).json({ error: 'Not permitted' });
  res.json({ id: generateQuoteId() });
});

// Slim, scope-aware lead list for the quotation/deal lead-picker — usable WITHOUT
// the Leads section (needs quotation "attach to a lead" OR leads view).
receiver.router.get('/api/employee/lead-options', requireEmployeeAuth, async (req, res) => {
  const emp = req.employee;
  if (!(empCan(emp, 'quotation', 'attachLead') || empCan(emp, 'leads', 'view') || empCan(emp, 'deals', 'create'))) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('customers').select('id,name,phone,lead_status,assigned_to').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const stageIdSet = await scopedQuotedIds(emp);
  res.json((data || []).filter(c => customerInScope(c, emp, stageIdSet)).map(c => ({ id: c.id, name: c.name, phone: c.phone })));
});

// ── Employee reports ──────────────────────────────────────────────────────────
// Granted per report (leads / sales / export). Every figure is restricted to the
// employee's data scope, so a rep limited to their own leads sees only their own
// totals — never company-wide numbers.
async function empReportScope(emp) {
  const stageIdSet = await scopedQuotedIds(emp);
  return {
    scopeLeads: c => customerInScope(c, emp, stageIdSet),
    scopeDeals: d => dealInScope(d, emp),
  };
}

receiver.router.get('/api/employee/reports/leads', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'reports', 'leads')) return res.status(403).json({ error: 'Not permitted' });
  try {
    const scope = await empReportScope(req.employee);
    res.json(await buildLeadsReport({ ...req.query, ...scope }));
  } catch (e) { console.error('[emp-reports-leads]', e); res.status(500).json({ error: e.message }); }
});

receiver.router.get('/api/employee/reports/summary', requireEmployeeAuth, async (req, res) => {
  if (!empCan(req.employee, 'reports', 'sales')) return res.status(403).json({ error: 'Not permitted' });
  try {
    const scope = await empReportScope(req.employee);
    res.json(await buildSalesReport({ ...req.query, ...scope }));
  } catch (e) { console.error('[emp-reports-summary]', e); res.status(500).json({ error: e.message }); }
});

// CSV export of the leads report — needs both the report itself and export rights.
receiver.router.get('/api/employee/reports/leads-export.csv', requireEmployeeAuth, async (req, res) => {
  const emp = req.employee;
  if (!(empCan(emp, 'reports', 'leads') && empCan(emp, 'reports', 'export'))) return res.status(403).json({ error: 'Not permitted' });
  try {
    const scope = await empReportScope(emp);
    const rep = await buildLeadsReport({ ...req.query, ...scope });
    const rows = (rep.rows || []).map(r => ({ label: r.label, leads: r.count, value: r.value }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-report-${rep.groupBy}.csv"`);
    res.send('﻿' + csvSerialize(rows, ['label', 'leads', 'value']));
  } catch (e) { console.error('[emp-reports-csv]', e); res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/employee/quotation/generate', requireEmployeeAuth,
  quotationImgUpload.array('images', 5), async (req, res) => {
    try {
      if (!empCan(req.employee, 'quotation', 'draft')) return res.status(403).json({ error: 'Not permitted' });
      const { id, date, validTo, name, vehicleModel, items: itemsJson, logistics: logisticsJson, currency, exchange, issuer, customSpecs: customSpecsJson } = req.body;
      const items       = JSON.parse(itemsJson       || '[]');
      const logistics   = JSON.parse(logisticsJson   || '[]');
      const customSpecs = JSON.parse(customSpecsJson || '[]');
      let existingImages = [];
      try { existingImages = JSON.parse(req.body.existingImages || '[]'); } catch (_) {}
      const files       = req.files || [];
      const uploaded    = files.map(f => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);
      const imageDataUrls = [...(Array.isArray(existingImages) ? existingImages : []), ...uploaded].slice(0, 5);

      // Load company settings from DB
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;

      const template = quoteTheme(req.body.template).key;
      const html = buildQuotationHtml({ id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings, template });

      const pdfBuffer = await renderQuotationPdf(html);

      res.json({ pdf: Buffer.from(pdfBuffer).toString('base64') });
      // Save/update the quotation record (best-effort). Images persisted in `data` for edit/duplicate.
      let custId = req.body.customer_id ? parseInt(req.body.customer_id) : null;
      // Scope guard: an employee without full leads view can only attach to a lead
      // that is inside their scope — otherwise silently drop the link (quote still generates).
      if (custId && !empCan(req.employee, 'leads', 'view')) {
        const { data: tgt } = await supabase.from('customers').select('id,lead_status,assigned_to').eq('id', custId).single();
        if (!tgt || !customerInScope(tgt, req.employee, await scopedQuotedIds(req.employee))) custId = null;
      }
      const pk = req.body.quotation_pk ? parseInt(req.body.quotation_pk) : null;
      const record = {
        title: `${vehicleModel || 'Quotation'} — ${name || ''}`.trim(),
        data: { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, customSpecs, imageDataUrls, template },
        customer_id: custId,
      };
      if (pk) {
        supabase.from('quotations').update(record).eq('id', pk).select().single().then(({ data: qrow }) => {
          if (custId && qrow) logLeadActivity(custId, { type: 'quote', body: `Quotation updated — ${qrow.title}`, meta: { quotation_id: qrow.id, quote_id: qrow.quote_id }, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
        }).catch(() => {});
      } else {
        supabase.from('quotations').insert({ ...record, quote_id: id || generateQuoteId(), created_by: req.employee.username }).select().single().then(({ data: qrow }) => {
          if (custId && qrow) logLeadActivity(custId, { type: 'quote', body: `Quotation generated — ${qrow.title}`, meta: { quotation_id: qrow.id, quote_id: qrow.quote_id }, authorKey: `employee_${req.employee.id}`, authorName: req.employee.name });
          if (qrow) runAutomations('quote.generated', { entityType: 'quote', entityId: qrow.id, customerId: custId, ownerId: null, fields: { name: name || '', vehicleModel: vehicleModel || '', title: qrow.title } });
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[emp-quotation-gen]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ─── Help Bot (bilingual EN/AR support assistant) ───────────────────────────────
// Hybrid: instant curated FAQ, with an optional Google Gemini (free tier) fallback
// when GEMINI_API_KEY is set. Never throws — always returns some answer.
const HELP_FAQ = [
  { keys: ['add lead','new lead','create lead','اضافة عميل','إضافة عميل','عميل جديد','ليد جديد'],
    en: 'To add a lead: open Leads → click "Add Lead", fill in the name (required), phone, status, budget, etc., then Save. To add many at once use "Import CSV" (upload a .csv file or paste a public Google Sheets link).',
    ar: 'لإضافة عميل: افتح قسم Leads ثم اضغط "Add Lead"، واملأ الاسم (مطلوب) والهاتف والحالة والميزانية ثم احفظ. ولإضافة عدة عملاء دفعة واحدة استخدم "Import CSV" (ارفع ملف .csv أو الصق رابط Google Sheets عام).' },
  { keys: ['lead 360','360','profile','timeline','follow up','follow-up','activity','بروفايل','ملف العميل','متابعة','نشاط','الجدول الزمني'],
    en: 'Click a lead\'s name to open the Lead 360° drawer: the activity timeline, follow-ups (schedule and mark done), and linked quotations and deals. Use "Log" to record a call, note, WhatsApp or meeting.',
    ar: 'اضغط على اسم العميل لفتح بطاقة Lead 360°: الجدول الزمني للنشاط، والمتابعات (جدولة وإتمام)، وعروض الأسعار والصفقات المرتبطة. استخدم "Log" لتسجيل مكالمة أو ملاحظة أو واتساب أو اجتماع.' },
  { keys: ['column','columns','add column','delete column','custom field','عمود','أعمدة','حذف عمود','حقل مخصص'],
    en: 'In Leads, click any column header to Rename, Change type, Edit dropdown options, Hide, Move, or Delete it — including built-in columns. Use the "Columns" button to show/hide columns and "+" to add a custom one.',
    ar: 'في قسم Leads، اضغط على رأس أي عمود لإعادة التسمية أو تغيير النوع أو تعديل خيارات القائمة أو الإخفاء أو النقل أو الحذف — بما في ذلك الأعمدة الأساسية. استخدم زر "Columns" لإظهار/إخفاء الأعمدة و"+" لإضافة عمود مخصص.' },
  { keys: ['deal','deals','pipeline','stage','kanban','صفقة','صفقات','مرحلة','خط الأنابيب'],
    en: 'Deals is a kanban pipeline. Drag a card between stages (Lead → Contacted → Quoted → Negotiating → Won/Lost), or open a card to edit it. Create one with "Add Deal".',
    ar: 'قسم Deals عبارة عن لوحة كانبان. اسحب البطاقة بين المراحل (Lead ← Contacted ← Quoted ← Negotiating ← Won/Lost)، أو افتح البطاقة لتعديلها. أنشئ صفقة عبر "Add Deal".' },
  { keys: ['edit quotation','update quotation','تعديل عرض','تعديل عرض سعر'],
    en: 'To edit a saved quotation: open Quotation → History → "Edit". It loads into the draft (including its images); clicking Generate then updates that same quotation instead of creating a new one. "Duplicate" makes a copy with a new ID.',
    ar: 'لتعديل عرض سعر محفوظ: افتح Quotation ثم History ثم "Edit". سيُحمَّل في المسودة (مع صوره)؛ والضغط على Generate يحدّث نفس العرض بدلاً من إنشاء عرض جديد. أما "Duplicate" فينشئ نسخة برقم جديد.' },
  { keys: ['quotation','quote','pdf','عرض سعر','عرض السعر','كوتيشن','عرض الأسعار'],
    en: 'Open Quotation to build a PDF: fill the ID, customer, vehicle, items, logistics and exchange rate, add up to 5 images, then click "Generate PDF". Saved quotes live under History where you can Edit, Duplicate or Delete them.',
    ar: 'افتح قسم Quotation لإنشاء ملف PDF: املأ الرقم والعميل والسيارة والبنود والشحن وسعر الصرف، أضف حتى 5 صور، ثم اضغط "Generate PDF". تظهر العروض المحفوظة في History حيث يمكنك تعديلها أو نسخها أو حذفها.' },
  { keys: ['automation','automations','rule','trigger','أتمتة','قاعدة','تشغيل تلقائي','مشغل'],
    en: 'Automations (admin) run "when X happens, do Y". Pick a trigger (e.g. a deal\'s stage changes), optional conditions, then actions (notify, assign lead, edit lead, set status, create follow-up/task/deal, or request a deletion). Turn the rule on to activate it.',
    ar: 'الأتمتة (للمدير) تعمل بمبدأ "عند حدوث X نفّذ Y". اختر مُشغّلاً (مثل تغيّر مرحلة الصفقة)، وشروطاً اختيارية، ثم إجراءات (إشعار، إسناد عميل، تعديل عميل، ضبط الحالة، إنشاء متابعة/مهمة/صفقة، أو طلب حذف). فعِّل القاعدة لتشغيلها.' },
  { keys: ['task','tasks','مهمة','مهام'],
    en: 'Tasks lets you create and assign work with due dates, priorities and multiple assignees, and comment on each task. Employees see their items under "My Tasks".',
    ar: 'قسم Tasks يتيح إنشاء المهام وإسنادها مع تواريخ استحقاق وأولويات ومسؤولين متعددين، والتعليق على كل مهمة. يرى الموظفون مهامهم في "My Tasks".' },
  { keys: ['hours','log hours','timesheet','ساعات','تسجيل ساعات','دوام'],
    en: 'Use Hours / Log Hours to record time spent; admins review totals under Hours Logs.',
    ar: 'استخدم Hours / Log Hours لتسجيل الوقت المستغرق؛ ويراجع المديرون الإجماليات في Hours Logs.' },
  { keys: ['request','requests','vacation','leave','طلب','طلبات','اجازة','إجازة'],
    en: 'Requests handles internal requests (e.g. leave). Submit one from Requests; admins can assign and comment, and you get notified on updates.',
    ar: 'قسم Requests يدير الطلبات الداخلية (مثل الإجازات). قدّم طلباً من Requests؛ ويمكن للمديرين إسناده والتعليق عليه، وتصلك إشعارات بالتحديثات.' },
  { keys: ['delete lead','delete deal','remove lead','deletion','approve deletion','حذف','طلب حذف','حذف عميل','حذف صفقة'],
    en: 'Employees can\'t delete leads/deals directly — clicking Delete sends a request to an admin, who approves it on the "Deletion Requests" page before the record is actually removed.',
    ar: 'لا يستطيع الموظفون حذف العملاء/الصفقات مباشرة — الضغط على Delete يرسل طلباً للمدير، الذي يوافق عليه من صفحة "Deletion Requests" قبل حذف السجل فعلياً.' },
  { keys: ['permission','permissions','access','grant','صلاحية','صلاحيات','وصول','منح صلاحية'],
    en: 'Admins set each employee\'s access under Employees → edit an employee → toggle sections (leads, deals, quotation, etc.). Hidden sections won\'t appear in that employee\'s portal.',
    ar: 'يحدد المديرون صلاحيات كل موظف من Employees ثم تعديل الموظف ثم تفعيل الأقسام (leads، deals، quotation، إلخ). الأقسام المخفية لن تظهر في بوابة ذلك الموظف.' },
  { keys: ['import','csv','sheet','spreadsheet','استيراد','اكسل','شيت','جدول'],
    en: 'In Leads → "Import CSV" you can upload a .csv file or paste a public Google Sheets URL. Columns like name/phone/status/origin/car/budget are matched automatically and duplicate phone numbers are skipped.',
    ar: 'من Leads ثم "Import CSV" يمكنك رفع ملف .csv أو لصق رابط Google Sheets عام. تتم مطابقة الأعمدة مثل name/phone/status/origin/car/budget تلقائياً ويتم تجاهل أرقام الهاتف المكررة.' },
  { keys: ['chat','message','دردشة','شات','رسالة','مراسلة'],
    en: 'Chat is the internal team messaging — direct and group rooms, file sharing and push notifications.',
    ar: 'قسم Chat هو المراسلة الداخلية للفريق — محادثات فردية وجماعية ومشاركة ملفات وإشعارات فورية.' },
  { keys: ['notification','notifications','اشعار','إشعار','إشعارات','تنبيه'],
    en: 'Notifications lists your alerts (mentions, assignments, approvals, follow-up reminders). Enable browser/push notifications to receive them on your device.',
    ar: 'قسم Notifications يعرض تنبيهاتك (الإشارات والإسنادات والموافقات وتذكيرات المتابعة). فعّل إشعارات المتصفح/الهاتف لتصلك على جهازك.' },
  // ── Section overviews (bare-word queries) — kept LAST so specific entries above match first ──
  { keys: ['lead','leads','عملاء','العملاء','ليدز'],
    en: 'Leads is your database of potential customers. Add or import leads, edit any cell inline, configure columns, and click a lead\'s name to open its 360° profile (activity, follow-ups, quotations, deals). Ask me "how to add a lead", "import leads", or "lead columns" for steps.',
    ar: 'قسم Leads هو قاعدة بيانات عملائك المحتملين. أضف أو استورد العملاء، عدّل أي خلية مباشرةً، خصّص الأعمدة، واضغط على اسم العميل لفتح ملفه 360° (النشاط، المتابعات، عروض الأسعار، الصفقات). اسألني "كيف أضيف عميل" أو "استيراد العملاء" أو "أعمدة العملاء" للخطوات.' },
  { keys: ['deal','deals','صفقة','صفقات','الصفقات'],
    en: 'Deals is your sales pipeline as a kanban board (Lead → Contacted → Quoted → Negotiating → Won/Lost). Drag cards between stages or open one to edit. Ask "how to add a deal" for steps.',
    ar: 'قسم Deals هو مسار المبيعات على شكل لوحة كانبان (Lead ← Contacted ← Quoted ← Negotiating ← Won/Lost). اسحب البطاقات بين المراحل أو افتح بطاقة لتعديلها. اسأل "كيف أضيف صفقة" للخطوات.' },
];
function helpDetectLang(text) { return /[؀-ۿ]/.test(String(text || '')) ? 'ar' : 'en'; }
function helpFaqMatch(message, lang) {
  const m = String(message || '').toLowerCase();
  if (!m.trim()) return null;
  for (const item of HELP_FAQ) {
    if (item.keys.some(k => m.includes(k.toLowerCase()))) return lang === 'ar' ? item.ar : item.en;
  }
  return null;
}
function helpSystemPrompt(identity) {
  const id = identity || {};
  const who = id.role === 'admin'
    ? `an ADMIN with full access to the admin dashboard. Their admin username is "${id.username || 'admin'}".`
    : `a TEAM member using the employee (Team) portal. Their name is "${id.name || ''}", username "${id.username || ''}"${id.job_title ? `, job title "${id.job_title}"` : ''}.`;
  const perms = (id.role !== 'admin' && id.permissions)
    ? `The sections they are allowed to use: ${Object.keys(id.permissions).filter(k => id.permissions[k] === true).join(', ') || '(basic only)'}.`
    : '';
  return [
    'You are the MotoLinker Help Bot, a friendly in-app support assistant for a car-sales CRM (leads, deals, quotations, tasks).',
    `The person asking is ${who}`,
    perms,
    'Answer ONLY questions about how to use this system, plus simple questions about the user themselves (e.g. their username/name/role — use the identity above).',
    'Be concise and practical: prefer short numbered steps that name the exact on-screen section and button. If something is not possible, say so plainly and give the closest alternative.',
    'Reply in the SAME language as the user (Arabic or English). For Arabic use clear Modern Standard Arabic.',
    '',
    'SECTIONS:',
    '- Leads: a table with configurable columns — click a column header to Rename / Change type / Edit dropdown options / Hide / Move / Delete (any column, built-in too); "Columns" button toggles visibility; "+" adds a custom column. Inline-edit a cell by clicking it. "Add Lead" adds one; "Import CSV" bulk-imports a .csv file or a public Google Sheets link (dedupes by phone). Click a lead name to open the Lead 360° drawer: activity timeline (Log a call/note/whatsapp/meeting), follow-ups (schedule + mark done), linked quotations and deals.',
    '- Deals: a kanban pipeline with stages Lead, Contacted, Quoted, Negotiating, Won, Lost. Drag a card between stages, or open it to edit. "Add Deal" creates one.',
    '- Quotation: build a PDF (ID, customer/lead, vehicle, items, logistics, exchange rate, up to 5 images). "Generate PDF" saves it to History. In History: Edit (loads it back and updates the SAME quote incl. its images), Duplicate (a copy with a new ID), Delete.',
    '- Tasks (assign work with due date/priority/multiple assignees + comments), Hours (log time), Requests (internal requests with assignment + comments).',
    '- Chat (team messaging), Notifications, Submissions (website-form leads), Reports (analytics).',
    '- Deletion Requests (admin): employees can\'t delete leads/deals directly — their Delete files a request an admin approves here. Permissions are set per employee under Employees.',
    '',
    'AUTOMATIONS (admin only — the Automations section): each rule is WHEN a trigger fires / ONLY IF optional conditions match / THEN actions run. Turn the rule ON to activate it.',
    'Triggers: a lead is created; a lead\'s status changes; a lead is marked contacted; a deal is created; a deal\'s stage changes; a quotation is generated; a lead has no activity for N days.',
    'Condition fields: source, lead_status, stage, been_contacted, budget_lead, budget_egp, name, car_in_question, and "to" (the new value on a change). Operators: is, is not, contains, changed to, >, <, is empty, is not empty. For status/stage/origin the value is a dropdown of the real options.',
    'IMPORTANT LIMITATION: conditions can only match the NEW/current value (e.g. lead_status is "warm", or "to" is "warm") — there is NO "from/previous value" field. So a rule like "status changes to Warm FROM Hot" can only be built as: trigger = "a lead\'s status changes", condition = lead_status is Warm. It cannot restrict what the previous status was. Tell the user this explicitly when they ask for a from→to rule.',
    'Actions: Send a notification (admin / lead owner / specific rep); Create a follow-up; Create a task; Create a deal; Set lead status; Assign the lead to a rep (round-robin or specific); Edit the lead profile (set fields); Remove the lead from deals (needs admin approval); Delete the lead (needs admin approval). Notification title/body support {{name}} and {{phone}} placeholders. Lead-scoped actions on a quotation trigger only run if the quote is linked to a lead.',
    '',
    'If a question is truly outside this system, say so briefly and point to the closest relevant section.',
  ].filter(Boolean).join('\n');
}
// Candidate models: env override first, then current free-tier fallbacks. gemini-2.0-flash was shut
// down 2026-06-01, so defaults target the live Flash / Flash-Lite models. Self-heals on 404 or 429.
const GEMINI_MODELS = (() => {
  const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const list = [primary, 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
  return [...new Set(list)];
})();
// Cached result of the most recent real Gemini call, so the admin status line never spends quota.
let _helpAiState = { ok: null, model: null, error: null, status: null, at: 0 };
async function geminiGenerate(model, key, systemText, contents) {
  const body = { system_instruction: { parts: [{ text: systemText }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 800 } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const raw = await r.text();
  let json = null; try { json = JSON.parse(raw); } catch (_) {}
  if (!r.ok) {
    const err = new Error(json?.error?.message || raw.slice(0, 300) || ('HTTP ' + r.status));
    err.status = r.status; err.notFound = r.status === 404 || /not found|not supported/i.test(err.message);
    return { ok: false, err };
  }
  const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
  return { ok: true, text: text || '' };
}
// Returns { ok, text, model } on success, or { ok:false, noKey?, error, status } on failure. Never throws.
async function helpCallGemini(systemText, history, message) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, noKey: true };
  const contents = [];
  for (const h of (Array.isArray(history) ? history.slice(-8) : [])) {
    if (!h || !h.content) continue;
    const role = (h.role === 'bot' || h.role === 'model' || h.role === 'assistant') ? 'model' : 'user';
    contents.push({ role, parts: [{ text: String(h.content).slice(0, 2000) }] });
  }
  contents.push({ role: 'user', parts: [{ text: String(message).slice(0, 2000) }] });
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await geminiGenerate(model, key, systemText, contents);
      if (res.ok) { _helpAiState = { ok: true, model, error: null, status: null, at: Date.now() }; return { ok: true, text: res.text, model }; }
      lastErr = res.err;
      console.warn(`[help] gemini ${model} failed: ${res.err.status || ''} ${res.err.message}`);
      // Roll to the next model when this one is missing/unsupported (404) OR rate-limited (429 —
      // each model has an independent free-tier bucket). Stop on other errors (400/403/5xx).
      if (!res.err.notFound && res.err.status !== 429) break;
    } catch (e) { lastErr = e; console.warn(`[help] gemini ${model} threw: ${e.message}`); break; }
  }
  const result = { ok: false, error: lastErr ? lastErr.message : 'unknown error', status: lastErr?.status };
  _helpAiState = { ok: false, model: null, error: result.error, status: result.status, at: Date.now() };
  return result;
}
// Live health check for the admin status line: actually pings the model.
async function helpGeminiPing() {
  if (!process.env.GEMINI_API_KEY) return { ai: false, ok: false };
  const res = await helpCallGemini('You are a health check. Reply with the single word OK.', [], 'ping');
  return res.ok ? { ai: true, ok: true, model: res.model } : { ai: true, ok: false, error: res.error, status: res.status };
}
async function handleHelpChat(req, res, identity) {
  try {
    const message = String(req.body?.message || '').slice(0, 4000);
    if (!message.trim()) return res.status(400).json({ error: 'message required' });
    const lang = (req.body?.lang === 'ar' || req.body?.lang === 'en') ? req.body.lang : helpDetectLang(message);
    let aiError = null;
    // AI-FIRST: when a key is configured, let the model answer (it has the full system prompt + identity).
    if (process.env.GEMINI_API_KEY) {
      const ai = await helpCallGemini(helpSystemPrompt(identity), req.body?.history, message);
      if (ai.ok && ai.text) return res.json({ answer: ai.text, source: 'ai' });
      if (!ai.noKey) { aiError = ai.error; console.warn('[help] AI unavailable, falling back to FAQ:', ai.error); }
      // Rate-limited on every model → tell the user plainly (+ a guide answer if one matches).
      if (ai.status === 429) {
        const faqRl = helpFaqMatch(message, lang);
        const busy = lang === 'ar'
          ? 'المساعد الذكي مشغول حالياً (تجاوز حد الاستخدام المجاني) — من فضلك حاول مرة أخرى بعد بضع ثوانٍ.'
          : 'The AI assistant is busy right now (free-tier rate limit) — please try again in a few seconds.';
        return res.json({ answer: busy + (faqRl ? '\n\n' + faqRl : ''), source: 'ratelimit' });
      }
    }
    // Fallback: curated FAQ, then a generic pointer.
    const faq = helpFaqMatch(message, lang);
    if (faq) return res.json({ answer: faq, source: 'faq' });
    const fallback = lang === 'ar'
      ? 'لم أجد إجابة جاهزة لسؤالك. يمكنك السؤال عن: العملاء (Leads)، الصفقات (Deals)، عروض الأسعار (Quotation)، المهام (Tasks)، الطلبات (Requests)، الأتمتة (Automations)، الاستيراد، أو الصلاحيات — أو اذكر اسم القسم الذي تحتاج مساعدة فيه.'
      : "I couldn't find a ready answer. Try asking about: Leads, Deals, Quotation, Tasks, Requests, Automations, Import, or Permissions — or name the section you need help with.";
    const out = { answer: fallback, source: 'fallback' };
    if (identity.role === 'admin' && aiError) out.debug = 'AI error: ' + aiError; // admin-only diagnostics
    return res.json(out);
  } catch (e) {
    console.error('[help-chat]', e);
    res.status(500).json({ error: e.message });
  }
}
receiver.router.post('/api/dashboard/help/chat', requireAuth, express.json(), (req, res) => handleHelpChat(req, res, { role: 'admin', username: ADMIN_USERNAME, name: 'Admin' }));
receiver.router.post('/api/employee/help/chat', requireEmployeeAuth, express.json(), (req, res) => handleHelpChat(req, res, { role: 'employee', ...req.employee }));
// Admin-only: is the AI (Gemini) configured AND working? Uses the cached result of the last real
// call (updated on every chat) so opening the panel never spends quota; only pings live if nothing
// has been observed in the last 10 minutes.
receiver.router.get('/api/dashboard/help/status', requireAuth, async (_req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.json({ ai: false, ok: false });
  const fresh = _helpAiState.at && (Date.now() - _helpAiState.at < 10 * 60 * 1000);
  if (fresh) return res.json({ ai: true, ok: _helpAiState.ok, model: _helpAiState.model, error: _helpAiState.error, status: _helpAiState.status, tested: true });
  try { res.json({ ...(await helpGeminiPing()), tested: true }); }
  catch (e) { res.json({ ai: true, ok: false, error: e.message, tested: true }); }
});

// ─── Form Submissions ─────────────────────────────────────────────────────────
// Public endpoint — no auth required (customers submit from the website).
// Every submission is persisted AND turned into a lead (deduped on normalized phone),
// so inbound inquiries land in the CRM instead of vanishing.
// CORS is open on THIS route only so the marketing website can POST the form
// straight from the browser (any other origin). All other /api routes stay same-origin.
function submissionCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '86400');
}
receiver.router.options('/api/submissions', (_req, res) => { submissionCors(res); res.sendStatus(204); });
receiver.router.post('/api/submissions', express.json(), async (req, res) => {
  submissionCors(res);
  const { name, email, phone, message, car_interest, source } = req.body || {};
  if (!name || (!email && !phone)) return res.status(400).json({ error: 'Name and a phone or email are required' });
  const cleanName = String(name).trim();
  const cleanEmail = email ? String(email).trim() : '';
  const cleanPhone = phone ? String(phone).trim() : '';
  const cleanMsg = message ? String(message).trim() : '';
  const cleanCar = car_interest ? String(car_interest).trim() : '';
  const src = (source ? String(source).trim() : '') || 'website';
  const phone_norm = normalizePhone(cleanPhone);
  try {
    let customerId = null, isNew = false;
    if (phone_norm) {
      const { data: existing } = await supabase.from('customers').select('id').eq('phone_norm', phone_norm).limit(1);
      if (existing && existing.length) customerId = existing[0].id;
    }
    if (customerId) {
      // Known lead re-inquired — fill any blanks, then log it to the timeline (no duplicate lead).
      const patch = {};
      if (cleanEmail) patch.email = cleanEmail;
      if (cleanCar) patch.car_in_question = cleanCar;
      if (Object.keys(patch).length) await supabase.from('customers').update(patch).eq('id', customerId);
      logLeadActivity(customerId, { type: 'system', body: `Re-inquiry via ${src}${cleanMsg ? ' — ' + cleanMsg : ''}`, meta: { source: src }, authorKey: 'system', authorName: 'System' });
    } else {
      const { data: lead } = await supabase.from('customers').insert({
        name: cleanName, phone: cleanPhone, phone_norm, email: cleanEmail,
        source: src, lead_status: 'warm', car_in_question: cleanCar,
        inquiry: cleanMsg, notes: cleanMsg, created_by: 'web_form',
      }).select().single();
      if (lead) {
        customerId = lead.id; isNew = true;
        logLeadActivity(customerId, { type: 'system', body: `Lead created · ${src}`, meta: { source: src }, authorKey: 'system', authorName: 'System' });
      }
    }
    // Persist the raw submission (audit trail), linked to the lead it created/matched.
    const { data: sub } = await supabase.from('form_submissions').insert({
      name: cleanName, email: cleanEmail, phone: cleanPhone, message: cleanMsg,
      car_interest: cleanCar, source: src, customer_id: customerId,
    }).select().single();
    createNotification('admin', {
      type: 'lead',
      title: isNew ? `New website lead: ${cleanName}` : `Re-inquiry: ${cleanName}`,
      body: [cleanPhone && `Phone: ${cleanPhone}`, cleanCar && `Interest: ${cleanCar}`, cleanMsg].filter(Boolean).join(' · ') || 'New website submission',
      url: customerId ? '/dashboard#customers' : '/dashboard#submissions',
    }, 'always').catch(() => {});
    if (sub) runAutomations('submission.created', submissionCtx(sub, customerId));
    res.json({ ok: true, id: sub?.id, customer_id: customerId, lead_created: isNew });
  } catch (e) {
    console.error('[submissions]', e);
    res.status(500).json({ error: e.message });
  }
});

// Admin — list all submissions (with the linked lead name)
receiver.router.get('/api/submissions', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('form_submissions')
    .select('*, customers(name)').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map(s => ({ ...s, submitted_at: s.created_at, lead_name: s.customers?.name || '' })));
});

// Admin — delete a submission
receiver.router.delete('/api/submissions/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('form_submissions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

async function sendDueDateReminders() {
  if (!vapidKeys) return;
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const [{ data: dueTomorrow }, { data: overdue }] = await Promise.all([
    supabase.from('tasks').select('id,title,assignee_id,assignee_ids').eq('due_date', tomorrow).neq('status', 'done'),
    supabase.from('tasks').select('id,title,assignee_id,assignee_ids').lt('due_date', today).neq('status', 'done'),
  ]);
  const remind = async (t, title) => {
    for (const aid of taskAssigneeList(t)) {
      const key = await memberKeyForAssignee(aid);
      if (key) createNotification(key, { type: 'reminder', title, body: t.title, url: '/employee#tasks' }, 'offline');
    }
  };
  for (const t of dueTomorrow || []) await remind(t, 'Task due tomorrow');
  for (const t of overdue || []) await remind(t, 'Overdue task');
}

function scheduleDueDateReminders() {
  const now    = new Date();
  const next9  = new Date(now);
  next9.setHours(9, 0, 0, 0);
  if (next9 <= now) next9.setDate(next9.getDate() + 1);
  setTimeout(() => {
    sendDueDateReminders().catch(console.error);
    setInterval(() => sendDueDateReminders().catch(console.error), 24 * 60 * 60 * 1000);
  }, next9 - now);
}

async function sendHoursLogReminder() {
  const today = new Date().toISOString().split('T')[0];
  const [{ data: allEmps }, { data: logsToday }] = await Promise.all([
    supabase.from('employees').select('id,name'),
    supabase.from('hours_logs').select('employee_id').eq('log_date', today),
  ]);
  const loggedIds = new Set((logsToday || []).map(l => l.employee_id));
  for (const emp of allEmps || []) {
    if (loggedIds.has(emp.id)) continue;
    if (vapidKeys) createNotification(`employee_${emp.id}`, {
      type: 'hours',
      title: 'Log your hours',
      body: "Please log today's working hours before you leave.",
      url: '/employee#log',
    }, 'offline');
    runAutomations('hours.not_logged', hoursCtx(emp)); // let admins customize what happens
  }
}

function scheduleHoursLogReminder() {
  const hour = parseInt(process.env.HOURS_REMINDER_UTC_HOUR || '15', 10);
  const now  = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(() => {
    sendHoursLogReminder().catch(console.error);
    setInterval(() => sendHoursLogReminder().catch(console.error), 24 * 60 * 60 * 1000);
  }, next - now);
}

// ─── Lead follow-up reminders ─────────────────────────────────────────────────
// Fires within ~5 minutes of a follow-up's due time: notifies the assigned
// employee (or admin when unassigned) once per follow-up.
async function sendFollowupReminders() {
  if (!vapidKeys) return;
  try {
    const { data: due } = await supabase.from('lead_followups')
      .select('*, customers(name,phone)')
      .eq('status', 'pending').eq('reminded', false)
      .lte('due_at', new Date().toISOString())
      .limit(50);
    for (const f of due || []) {
      const leadName = f.customers?.name || 'a lead';
      const key = f.assigned_to ? `employee_${f.assigned_to}` : 'admin';
      const url = f.assigned_to ? '/employee#leads' : '/dashboard#customers';
      await createNotification(key, {
        type: 'followup',
        title: `Follow-up due: ${leadName}`,
        body: [f.note, f.customers?.phone ? `Phone: ${f.customers.phone}` : ''].filter(Boolean).join(' · ') || 'Scheduled follow-up is due now.',
        url,
      }, 'always');
      await supabase.from('lead_followups').update({ reminded: true }).eq('id', f.id);
    }
  } catch (e) { console.warn('[followups] reminder pass failed:', e.message); }
}

function scheduleFollowupReminders() {
  setTimeout(() => sendFollowupReminders().catch(console.error), 20 * 1000); // first pass shortly after boot
  setInterval(() => sendFollowupReminders().catch(console.error), 5 * 60 * 1000);
}

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
  await loadGoogleTokens();
  await loadOrCreateVapidKeys();
  scheduleDueDateReminders();
  scheduleHoursLogReminder();
  scheduleFollowupReminders();
  scheduleAutomationSweep();
  scheduleRecurringTasks();
  setTimeout(() => backfillHotLeadDeals().catch(console.error), 15 * 1000); // one-time: deals for pre-existing Hot leads
  if (process.env.WHATSAPP_ENABLED === 'true') initWhatsApp().catch(console.error);
  const port = process.env.PORT || 3000;
  receiver.app.listen(port, () => {
    console.log(`⚡️  MotoLinker running on port ${port}`);
  });
  console.log(`📊  Admin dashboard → http://localhost:${port}/dashboard`);
  if (!ADMIN_PASSWORD) console.warn('⚠️   ADMIN_PASSWORD is not set — dashboard login will fail!');
})();
