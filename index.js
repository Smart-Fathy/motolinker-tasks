const { createClient } = require('@supabase/supabase-js');
const crypto     = require('crypto');
const path       = require('path');
const express    = require('express');
const multer     = require('multer');
const webpush    = require('web-push');
const nodemailer = require('nodemailer');

const { LEADS_ENUM_DEFAULTS, PO_LINE_STATUSES, PO_LINE_STATUS_KEYS, BRAND_LOGO_URL }
  = require('./src/lib/constants');

// ─── App Init ─────────────────────────────────────────────────────────────────
// Plain Express server (Slack integration removed). `receiver.router` is kept as
// an alias so the existing route registrations stay unchanged.
const expressApp = express();
const receiver = { router: expressApp, app: expressApp };
// Exported so tooling can inspect the app without starting it — the route-inventory
// check that guards this restructure walks receiver.app's stack.
module.exports = receiver;

// Shared context for the feature modules under src/routes. index.js hands each
// module its dependencies immediately before requiring it, so what was in scope
// at that point in the file still is.
const ctx = require('./src/ctx');
// The shared vocabulary is read by feature modules through the context.
Object.assign(ctx, { LEADS_ENUM_DEFAULTS, PO_LINE_STATUSES, PO_LINE_STATUS_KEYS, BRAND_LOGO_URL });

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
    vapidKeys = ctx.vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    try {
      const { data } = await supabase.from('google_tokens').select('tokens').eq('user_key', 'vapid').single();
      if (data?.tokens?.publicKey && data?.tokens?.privateKey) vapidKeys = ctx.vapidKeys = data.tokens;
    } catch (_) {}
    if (!vapidKeys) {
      vapidKeys = ctx.vapidKeys = webpush.generateVAPIDKeys();
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
let calendarTokens = null;   // company Google Calendar (task events)
const employeeDriveTokens  = new Map();
const employeeEmailTokens  = new Map();
const employeeCalendarTokens = new Map();   // employee's own Google Calendar
const employeeChatTokens     = new Map();   // employee's Google Chat (spaces/messages)
let adminChatGoogleTokens = null;           // admin's own Google Chat connection
// tasks.calendar_events (migrations/004) stores one event id per target. Without
// it personal event ids can't be remembered, so we fall back to company-invites
// only rather than creating a duplicate event on every sync.
let taskCalendarEventsOk = true;
const pendingDriveAuth     = new Map();

// ─── Google Token Persistence ─────────────────────────────────────────────────
async function loadGoogleTokens() {
  try {
    const { data } = await supabase.from('google_tokens').select('user_key, tokens');
    if (!data) return;
    for (const row of data) {
      const t = row.tokens;
      if (row.user_key === 'admin_gmail') gmailTokens = t;
      else if (row.user_key === 'admin_calendar') calendarTokens = t;
      else if (row.user_key === 'admin_drive') driveTokens = ctx.driveTokens = t;
      else if (row.user_key.endsWith('_drive')) {
        const id = parseInt(row.user_key);
        if (!isNaN(id)) employeeDriveTokens.set(id, t);
      } else if (row.user_key.endsWith('_gmail')) {
        const id = parseInt(row.user_key);
        if (!isNaN(id)) employeeEmailTokens.set(id, t);
      } else if (row.user_key === 'admin_gchat') adminChatGoogleTokens = t;
      else if (row.user_key.endsWith('_calendar')) {
        const id = parseInt(row.user_key);
        if (!isNaN(id)) employeeCalendarTokens.set(id, t);
      } else if (row.user_key.endsWith('_gchat')) {
        const id = parseInt(row.user_key);
        if (!isNaN(id)) employeeChatTokens.set(id, t);
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

// Route guard for the per-action permission model. Mount it after
// requireEmployeeAuth, which is what puts req.employee there:
//
//   receiver.router.get('/api/employee/hours', requireEmployeeAuth, requirePerm('hours', 'view'), …)
//
// empCan is reached through the context at request time rather than captured here,
// because it is defined in src/routes/employee-portal.js — which index.js requires
// a thousand lines below the first route that needs this.
//
// No req.employee means an admin session (chat and huddles mount the same handlers
// behind requireAuth for the dashboard and requireEmployeeAuth for the portal), and
// the admin is not subject to employee permissions. Always mount this behind one of
// the two auth guards; on its own it authorises nothing.
function requirePerm(section, action) {
  return function (req, res, next) {
    if (!req.employee || ctx.empCan(req.employee, section, action)) return next();
    res.status(403).json({ error: 'Not permitted' });
  };
}
ctx.requirePerm = requirePerm;


// ═══════════════════════════════════════════════════════════════════════════════
// ─── Static Assets (PWA icons, manifests, service workers) ───────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// One definition of where the static files are. Modules under src/ have a different
// __dirname, so a route that joined its own would look for src/routes/public — which
// is what took the team portal down after the split. It is on the context, so nobody
// has to work the relative depth out again.
const PUBLIC_DIR = ctx.PUBLIC_DIR = path.join(__dirname, 'public');

receiver.router.use(express.static(PUBLIC_DIR));

receiver.router.get('/sw-employee.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/employee');
  res.sendFile(path.join(PUBLIC_DIR, 'sw-employee.js'));
});
receiver.router.get('/sw-dashboard.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/dashboard');
  res.sendFile(path.join(PUBLIC_DIR, 'sw-dashboard.js'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Admin Dashboard API ──────────────────────────────────════════════════════
// ═══════════════════════════════════════════════════════════════════════════════

receiver.router.get('/', (_req, res) => res.redirect('/dashboard'));
receiver.router.get('/dashboard', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));

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
        if (!ctx.taskAssigneeList(t).some(a => keys.has(a))) return;
        empTotal++;
        if (t.status === 'done') empDone++;
      });
      return { id: e.id, name: e.name, avatar_url: e.avatar_url || '', total: empTotal, done: empDone };
    }).filter(e => e.total > 0).sort((a, b) => b.done - a.done || b.total - a.total);
    res.json({ total, done, inProgress, todo, highPriority, overdue, byPriority, byEmployee, completionRate: Math.round((done / total) * 100) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sales & revenue analytics  → src/routes/reports.js
Object.assign(ctx, { GOOGLE_CLIENT_ID, crypto, driveCanUpload: (...a) => driveCanUpload(...a), driveTokens, express, getCalendarToken, getDriveToken, getEmployeeCalendarToken, multer, parseCSV, receiver, requireAuth, supabase, syncTaskToCalendar, upload });
Object.assign(ctx, require('./src/routes/reports'));
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
    (data || []).forEach(t => ctx.runAutomations('task.created', ctx.taskCtx(t)));
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
      ctx.createNotification(`employee_${e.id}`, {
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
receiver.router.get('/api/employee/tasks/:id/comments', requireEmployeeAuth, requirePerm('tasks', 'view'), (req, res) => listTaskComments(parseInt(req.params.id), res));
receiver.router.post('/api/employee/tasks/:id/comments', requireEmployeeAuth, requirePerm('tasks', 'comment'), express.json(), (req, res) =>
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
      ctx.createNotification(key, {
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
      ctx.createNotification(`employee_${em.id}`, { type: 'request', title: `${authorName} mentioned you in a request`, body: `${reqRow.title}: ${notifBody.slice(0, 140)}`, url: '/employee#requests' }, 'always');
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
receiver.router.get('/api/employee/requests/:id/comments', requireEmployeeAuth, requirePerm('requests', 'view'), async (req, res) => {
  if (!(await employeeMayAccessRequest(req, parseInt(req.params.id)))) return res.status(403).json({ error: 'Not permitted' });
  listRequestComments(parseInt(req.params.id), res);
});
receiver.router.post('/api/employee/requests/:id/comments', requireEmployeeAuth, requirePerm('requests', 'comment'), express.json(), async (req, res) => {
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
        await ctx.createNotification(`employee_${cto.id}`, {
          type: 'issue',
          title: `Issue reported by ${req.employee.name}: ${title || 'System issue'}`,
          body: bodyTxt,
          url: '/employee#issues',
        }, 'always');
      }
    } else {
      await ctx.createNotification('admin', {
        type: 'issue',
        title: `Issue reported by ${req.employee.name}: ${title || 'System issue'}`,
        body: bodyTxt,
        url: '/dashboard#notif',
      }, 'always');
    }
    res.json({ ok: true, file: fileUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Issues center ─────────────────────────────────────────────────────────────
// Granted by permission now, not only by job title. empCan still lets any CTO
// through on their title alone, so this is strictly a widening.

receiver.router.get('/api/employee/issues', requireEmployeeAuth, requirePerm('issues', 'view'), async (_req, res) => {
  const { data, error } = await supabase.from('issues').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.put('/api/employee/issues/:id', requireEmployeeAuth, requirePerm('issues', 'resolve'), express.json(), async (req, res) => {
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
    ctx.createNotification(`employee_${assignee_id}`, { type: 'request', title: 'A request was assigned to you', body: title, url: '/employee#requests' }, 'always');
  }
  ctx.runAutomations('request.created', ctx.requestCtx(data));
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
      ctx.createNotification(`employee_${emp.id}`, {
        type: 'request',
        title: `Request ${labels[data.status] || data.status}`,
        body: data.title,
        url: '/employee#requests',
      }, 'offline');
    }
  }
  // Notify a newly-assigned employee
  if (data?.assignee_id && String(data.assignee_id) !== String(existing?.assignee_id || '')) {
    ctx.createNotification(`employee_${data.assignee_id}`, { type: 'request', title: 'A request was assigned to you', body: data.title, url: '/employee#requests' }, 'always');
  }
  if (existing && data && existing.status !== data.status) ctx.runAutomations('request.status_changed', { ...requestCtx(data), from: existing.status, to: data.status });
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
      // Chat may use its own OAuth client, so the grant doesn't drag the existing
      // Gmail/Drive scopes into a fresh Google review.
      const cid = pending.type === 'gchat' ? CHAT_CLIENT_ID : GOOGLE_CLIENT_ID;
      const csec = pending.type === 'gchat' ? CHAT_CLIENT_SECRET : GOOGLE_CLIENT_SECRET;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, client_id: cid, client_secret: csec, redirect_uri: `${base}/api/email/callback`, grant_type: 'authorization_code' }) });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) throw new Error(tokens.error_description || 'No access token');
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profile = await profileRes.json();
      const full = { ...tokens, email: profile.email, name: profile.name, expiry_date: Date.now() + ((tokens.expires_in || 3600) * 1000) };
      if (pending.type === 'employee-login') {
        // Google login for employee portal — match by email
        // Case-insensitive match (ilike, no wildcards) + limit(1) so mixed-case stored emails work and duplicates don't throw
        // job_title comes along because permissions read it: the Issues centre is
        // still the CTO's by title. Signing in with Google used to drop it, so the
        // same person saw a different portal depending on which button they used.
        const { data: empRows } = await supabase.from('employees').select('id,name,username,permissions,job_title').ilike('email', String(profile.email || '').trim()).limit(1);
        const emp = empRows && empRows[0];
        if (!emp) return res.redirect('/employee?google_login_error=' + encodeURIComponent('No account linked to this Google address. Contact your admin.'));
        const sessionToken = generateToken();
        const permissions = ctx.normEmpPerms(emp.permissions);
        employeeSessions.set(sessionToken, { id: emp.id, name: emp.name, username: emp.username, job_title: emp.job_title || '', permissions });
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
      if (pending.type === 'gchat') {
        const store = chatStore(pending.kind);
        // `tokens.scope` is what Google ACTUALLY granted — granular consent means
        // it can be narrower than what we asked for.
        store.set({ ...full, scope: tokens.scope || '' });
        saveGoogleToken(store.key, store.get());
        return res.redirect(pending.redirect || '/dashboard#gchat');
      }
      if (pending.type === 'employee-calendar' && pending.employeeId) {
        employeeCalendarTokens.set(pending.employeeId, full);
        saveGoogleToken(`${pending.employeeId}_calendar`, full);
        backfillEmployeeCalendar(pending.employeeId);   // best-effort, don't block the redirect
        return res.redirect('/employee#tasks');
      }
      if (pending.type === 'admin-calendar') {
        calendarTokens = full;
        saveGoogleToken('admin_calendar', full);
        return res.redirect('/dashboard#calendar');
      }
      driveTokens = ctx.driveTokens = full;
      saveGoogleToken('admin_drive', full);
      return res.redirect('/dashboard#drive');
    } catch (e) {
      // A misconfigured Cloud project (Chat API not enabled, scope not added to the
      // consent screen) shows up here as invalid_scope. Send the user back to the
      // panel with a readable reason instead of a raw 500 page.
      if (pending.type === 'gchat') {
        const why = /invalid_scope/i.test(e.message)
          ? 'Google rejected the Chat permissions. Enable the Google Chat API and add the chat.* scopes to the OAuth consent screen.'
          : e.message;
        const back = (pending.redirect || '/dashboard#gchat').split('#')[0];
        return res.redirect(`${back}?gchat_error=${encodeURIComponent(why)}#gchat`);
      }
      return res.status(500).send(`OAuth error: ${e.message}`);
    }
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
// Two Drive scopes, deliberately, rather than the one blanket `auth/drive`:
//   drive.readonly — the Drive and Sheets browsers list everything in the account
//   drive.file     — create and write, but only files this app made
// Read-only alone is what shipped, which is why uploading a client file could never
// work: the folder creation in src/routes/suppliers.js came back 403 Insufficient
// Permission no matter how healthy the connection looked on the Drive page.
// `drive.file` is the smallest scope that permits an upload; it cannot touch anything
// the user created themselves, so adding it does not widen what MotoLinker can reach
// beyond the MotoLinker folder it owns.
const DRIVE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_SCOPES = `https://www.googleapis.com/auth/drive.readonly ${DRIVE_UPLOAD_SCOPE} https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`;

// A token minted before the scope above was widened still refreshes happily — the
// refresh token carries the OLD grant, so nothing looks broken until the upload
// itself 403s. Google returns what it actually granted in `scope`, so a stale grant
// is detectable here and can be reported as "reconnect" instead of as a Drive error.
function driveCanUpload(tokens) {
  const granted = String((tokens && tokens.scope) || '');
  if (!granted) return true;   // pre-dates scope recording; let Google be the judge
  return granted.split(/\s+/).some(s => s === DRIVE_UPLOAD_SCOPE || s === 'https://www.googleapis.com/auth/drive');
}

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
  // canUpload, so the Drive page can say that a connection predating the upload
  // scope needs one reconnect — rather than leaving it to be discovered by a client
  // file upload failing months later.
  res.json({ configured: true, connected: true, email: driveTokens.email, name: driveTokens.name, canUpload: driveCanUpload(driveTokens) });
});

receiver.router.get('/api/drive/connect', requireAuth, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'admin' });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${base}/api/email/callback`, response_type: 'code', scope: DRIVE_SCOPES, access_type: 'offline', prompt: 'consent', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/drive/disconnect', requireAuth, (_req, res) => { driveTokens = ctx.driveTokens = null; res.json({ ok: true }); });

receiver.router.get('/api/drive/files',  requireAuth, async (_req, res) => { try { res.json(await listDriveFiles(driveTokens)); } catch (e) { res.status(500).json({ error: e.message }); } });
receiver.router.get('/api/drive/sheets', requireAuth, async (_req, res) => { try { res.json(await listDriveFiles(driveTokens, 'application/vnd.google-apps.spreadsheet')); } catch (e) { res.status(500).json({ error: e.message }); } });


// ═══════════════════════════════════════════════════════════════════════════════
// ─── Google Chat (real spaces + messages, in-app) ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// Reads and sends as the signed-in USER (not a bot), so messages are attributed to
// them. Three hard facts shape this integration:
//   • The Chat API is Google Workspace only — consumer @gmail.com accounts cannot
//     use it at all.
//   • Reading messages needs chat.messages.readonly, which Google classes as a
//     RESTRICTED scope (verification + an annual CASA security assessment) unless
//     the OAuth consent screen is Internal to the Workspace org.
//   • Sending (chat.messages.create) and listing spaces (chat.spaces.readonly) are
//     only "sensitive" — far cheaper to ship.
// So capability is decided at RUNTIME from the scopes Google actually granted,
// never at build time: a partial consent degrades to a read-only or send-only
// panel instead of erroring.
const GOOGLE_CHAT_ENABLED = process.env.GOOGLE_CHAT_ENABLED === '1';
const GOOGLE_CHAT_WANT_READ = process.env.GOOGLE_CHAT_READ !== '0';   // ask for message history
const CHAT_CLIENT_ID     = process.env.GOOGLE_CHAT_CLIENT_ID     || GOOGLE_CLIENT_ID;
const CHAT_CLIENT_SECRET = process.env.GOOGLE_CHAT_CLIENT_SECRET || GOOGLE_CLIENT_SECRET;

const CHAT_SCOPE_SPACES = 'https://www.googleapis.com/auth/chat.spaces.readonly';
const CHAT_SCOPE_SEND   = 'https://www.googleapis.com/auth/chat.messages.create';
const CHAT_SCOPE_READ   = 'https://www.googleapis.com/auth/chat.messages.readonly';
function chatScopes() {
  return [CHAT_SCOPE_SPACES, CHAT_SCOPE_SEND, ...(GOOGLE_CHAT_WANT_READ ? [CHAT_SCOPE_READ] : []),
    'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'].join(' ');
}
// Granular consent means the user can tick some boxes and not others.
function chatCaps(t) {
  const granted = String((t && (t.scope || t.granted_scopes)) || '');
  return {
    spaces: granted.includes('chat.spaces'),
    read:   granted.includes('chat.messages.readonly') || /chat\.messages(\s|$)/.test(granted),
    send:   granted.includes('chat.messages.create') || /chat\.messages(\s|$)/.test(granted),
  };
}

function chatStore(kind) {   // kind: 'admin' | employee id
  return kind === 'admin'
    ? { get: () => adminChatGoogleTokens, set: v => { adminChatGoogleTokens = v; }, key: 'admin_gchat' }
    : { get: () => employeeChatTokens.get(kind), set: v => { v ? employeeChatTokens.set(kind, v) : employeeChatTokens.delete(kind); }, key: `${kind}_gchat` };
}

async function getChatToken(kind) {
  const store = chatStore(kind);
  const t = store.get();
  if (!t) return null;
  if (t.refresh_token && Date.now() > (t.expiry_date || 0) - 60_000) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: t.refresh_token, client_id: CHAT_CLIENT_ID, client_secret: CHAT_CLIENT_SECRET, grant_type: 'refresh_token' }),
    });
    const refreshed = await r.json();
    if (refreshed.access_token) {
      const updated = { ...t, ...refreshed, expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) };
      store.set(updated); saveGoogleToken(store.key, updated);
    } else if (refreshed.error === 'invalid_grant') {
      // Unverified apps in "testing" lose refresh tokens after 7 days — surface it
      // as "reconnect" rather than a dead panel.
      store.set({ ...t, dead: true });
      return null;
    }
  }
  return (store.get() || {}).access_token || null;
}

// Every Chat call funnels through here: never throws, always returns a shape the
// UI can render as a state.
async function chatApi(kind, path, opts) {
  if (!GOOGLE_CHAT_ENABLED || !CHAT_CLIENT_ID) return { error: 'not_configured' };
  const t = chatStore(kind).get();
  if (!t) return { error: 'not_connected' };
  if (t.dead) return { error: 'reconnect' };
  const token = await getChatToken(kind);
  if (!token) return { error: 'reconnect' };
  try {
    const r = await fetch(`https://chat.googleapis.com/v1/${path}`, {
      ...(opts || {}),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...((opts || {}).headers || {}) },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = body.error?.message || `HTTP ${r.status}`;
      if (r.status === 403) return { error: 'forbidden', detail: msg };
      if (r.status === 401) return { error: 'reconnect', detail: msg };
      return { error: 'failed', detail: msg };
    }
    return { data: body };
  } catch (e) { return { error: 'failed', detail: e.message }; }
}

function chatStatusPayload(kind) {
  const t = chatStore(kind).get();
  if (!GOOGLE_CHAT_ENABLED || !CHAT_CLIENT_ID) return { configured: false };
  if (!t) return { configured: true, connected: false };
  if (t.dead) return { configured: true, connected: false, reconnect: true, email: t.email };
  return { configured: true, connected: true, email: t.email, name: t.name, caps: chatCaps(t) };
}

// Register the six Chat routes for one audience (admin or employee).
function mountChatRoutes(base, guard, kindOf, redirect) {
  receiver.router.get(`${base}/status`, guard, requirePerm('gchat', 'view'), (req, res) => res.json(chatStatusPayload(kindOf(req))));

  receiver.router.get(`${base}/connect`, guard, requirePerm('gchat', 'view'), (req, res) => {
    if (!GOOGLE_CHAT_ENABLED) return res.status(400).send('Google Chat is not enabled (set GOOGLE_CHAT_ENABLED=1)');
    if (!CHAT_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
    const b = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const state = crypto.randomBytes(16).toString('hex');
    pendingDriveAuth.set(state, { type: 'gchat', kind: kindOf(req), redirect });
    const params = new URLSearchParams({ client_id: CHAT_CLIENT_ID, redirect_uri: `${b}/api/email/callback`, response_type: 'code', scope: chatScopes(), access_type: 'offline', prompt: 'consent', state });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  receiver.router.post(`${base}/disconnect`, guard, requirePerm('gchat', 'view'), (req, res) => {
    const store = chatStore(kindOf(req));
    store.set(null); saveGoogleToken(store.key, null);
    res.json({ ok: true });
  });

  receiver.router.get(`${base}/spaces`, guard, requirePerm('gchat', 'view'), async (req, res) => {
    const r = await chatApi(kindOf(req), 'spaces?pageSize=100');
    if (r.error) return res.json({ spaces: [], error: r.error, detail: r.detail });
    // Chat returns nothing at all for an empty list
    const spaces = (r.data.spaces || []).map(sp => ({
      name: sp.name,
      title: sp.displayName || (sp.spaceType === 'DIRECT_MESSAGE' ? 'Direct message' : 'Untitled space'),
      type: sp.spaceType || sp.type || '',
    }));
    res.json({ spaces });
  });

  receiver.router.get(`${base}/messages`, guard, requirePerm('gchat', 'view'), async (req, res) => {
    const space = String(req.query.space || '');
    if (!/^spaces\/[A-Za-z0-9_-]+$/.test(space)) return res.json({ messages: [], error: 'bad_space' });
    const r = await chatApi(kindOf(req), `${space}/messages?pageSize=50&orderBy=${encodeURIComponent('createTime desc')}`);
    if (r.error) return res.json({ messages: [], error: r.error, detail: r.detail });
    const messages = (r.data.messages || []).map(m => ({
      id: m.name,
      text: m.text || '',
      senderName: m.sender?.displayName || '',
      senderId: m.sender?.name || '',
      createTime: m.createTime || '',
    })).reverse();   // oldest first, like the in-app chat
    res.json({ messages });
  });

  receiver.router.post(`${base}/messages`, guard, requirePerm('gchat', 'send'), express.json(), async (req, res) => {
    const space = String(req.body?.space || '');
    const text = String(req.body?.text || '').trim().slice(0, 4000);
    if (!/^spaces\/[A-Za-z0-9_-]+$/.test(space)) return res.status(400).json({ error: 'bad_space' });
    if (!text) return res.status(400).json({ error: 'empty' });
    const r = await chatApi(kindOf(req), `${space}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
    if (r.error) return res.json({ ok: false, error: r.error, detail: r.detail });
    res.json({ ok: true, id: r.data.name });
  });
}

mountChatRoutes('/api/dashboard/gchat', requireAuth, () => 'admin', '/dashboard#gchat');
mountChatRoutes('/api/employee/gchat', requireEmployeeAuth, req => req.employee.id, '/employee#gchat');

// ─── Sidebar layout (admin-arranged nav) ──────────────────────────────────────
// Order + custom labels for the dashboard sidebar, stored as JSON in the existing
// quotation_settings KV table (same pattern as leads_columns_config). The nav
// itself stays static HTML; the client just reorders/relabels it on load, so an
// empty or stale config always falls back to the shipped layout.
receiver.router.get('/api/dashboard/nav-config', requireAuth, async (_req, res) => {
  try {
    const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'nav_config').single();
    res.json(data?.value ? JSON.parse(data.value) : { groups: [] });
  } catch (_) { res.json({ groups: [] }); }
});

// The team portal reads the same layout (read-only) so one arrangement drives both.
receiver.router.get('/api/employee/nav-config', requireEmployeeAuth, async (_req, res) => {
  try {
    const { data } = await supabase.from('quotation_settings').select('value').eq('key', 'nav_config').single();
    res.json(data?.value ? JSON.parse(data.value) : { groups: [] });
  } catch (_) { res.json({ groups: [] }); }
});

receiver.router.put('/api/dashboard/nav-config', requireAuth, express.json({ limit: '256kb' }), async (req, res) => {
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
  const clean = groups.map(g => ({
    key: String(g?.key || '').trim(),
    label: String(g?.label || '').trim().slice(0, 40),
    hidden: g?.hidden === true,
    items: (Array.isArray(g?.items) ? g.items : []).map(it => ({
      id: String(it?.id || '').trim(),
      label: String(it?.label || '').trim().slice(0, 40),
      hidden: it?.hidden === true,
    })).filter(it => it.id),
  })).filter(g => g.key);
  const { error } = await supabase.from('quotation_settings')
    .upsert({ key: 'nav_config', value: JSON.stringify({ groups: clean }) }, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, groups: clean });
});

receiver.router.delete('/api/dashboard/nav-config', requireAuth, async (_req, res) => {
  const { error } = await supabase.from('quotation_settings').delete().eq('key', 'nav_config');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Home dashboards  → src/routes/home.js
Object.assign(ctx, { express, receiver, requireAuth, requireEmployeeAuth, supabase });
require('./src/routes/home');
// ─── Google Calendar (task events) ────────────────────────────────────────────
// One company account creates task events and invites the assignee, so nothing
// has to be set up per employee. Everything here is best-effort: a Calendar
// outage must never stop a task from being created.
const CALENDAR_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

receiver.router.get('/api/calendar/status', requireAuth, (_req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.json({ configured: false });
  if (!calendarTokens) return res.json({ configured: true, connected: false });
  res.json({ configured: true, connected: true, email: calendarTokens.email, name: calendarTokens.name });
});

receiver.router.get('/api/calendar/connect', requireAuth, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'admin-calendar' });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${base}/api/email/callback`, response_type: 'code', scope: CALENDAR_SCOPES, access_type: 'offline', prompt: 'consent', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/calendar/disconnect', requireAuth, (_req, res) => {
  calendarTokens = null;
  saveGoogleToken('admin_calendar', null);
  res.json({ ok: true });
});

async function getCalendarToken() {
  if (!calendarTokens) return null;
  if (calendarTokens.refresh_token && Date.now() > (calendarTokens.expiry_date || 0) - 60_000) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: calendarTokens.refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }),
    });
    const refreshed = await r.json();
    if (refreshed.access_token) {
      calendarTokens = { ...calendarTokens, ...refreshed, expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) };
      saveGoogleToken('admin_calendar', calendarTokens);
    }
  }
  return calendarTokens.access_token;
}

// All-day event on the due date, with the assignees invited by email.
// Employees can connect their own calendar so task events land directly on it
// instead of arriving as an invitation from the company account.
receiver.router.get('/api/employee/calendar/status', requireEmployeeAuth, requirePerm('calendar', 'view'), (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.json({ configured: false });
  const t = employeeCalendarTokens.get(req.employee.id);
  if (!t) return res.json({ configured: true, connected: false });
  res.json({ configured: true, connected: true, email: t.email, name: t.name });
});

receiver.router.get('/api/employee/calendar/connect', requireEmployeeAuth, requirePerm('calendar', 'connect'), (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'employee-calendar', employeeId: req.employee.id });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${base}/api/email/callback`, response_type: 'code', scope: CALENDAR_SCOPES, access_type: 'offline', prompt: 'consent', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/employee/calendar/disconnect', requireEmployeeAuth, requirePerm('calendar', 'connect'), async (req, res) => {
  const id = req.employee.id;
  res.json({ ok: true });
  // Remove the events we put there while the token is still valid, otherwise they
  // linger forever and the employee also starts getting company invites (R3).
  try {
    const token = await getEmployeeCalendarToken(id);
    if (token) {
      const { data: rows } = await supabase.from('tasks').select('id,calendar_events').not('calendar_events', 'is', null);
      for (const t of rows || []) {
        const ev = t.calendar_events && t.calendar_events[String(id)];
        if (!ev) continue;
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ev)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
        const rest = { ...t.calendar_events }; delete rest[String(id)];
        await supabase.from('tasks').update({ calendar_events: rest }).eq('id', t.id);
      }
    }
  } catch (e) { console.warn('[calendar] disconnect cleanup failed:', e.message); }
  employeeCalendarTokens.delete(id);
  saveGoogleToken(`${id}_calendar`, null);
});

// R2: when someone connects, put their existing open tasks on the new calendar
// straight away instead of waiting for the next edit. Routed through
// syncTaskToCalendar so it PATCHes known events rather than duplicating them.
async function backfillEmployeeCalendar(employeeId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: tasks } = await supabase.from('tasks')
      .select('*').neq('status', 'done').gte('due_date', today).limit(200);
    const mine = (tasks || []).filter(t => ctx.taskAssigneeList(t).map(String).includes(String(employeeId)));
    console.log('[calendar] backfilling', mine.length, 'task(s) for employee', employeeId);
    for (const t of mine) await syncTaskToCalendar(t);
  } catch (e) { console.warn('[calendar] backfill failed:', e.message); }
}

async function getEmployeeCalendarToken(employeeId) {
  const t = employeeCalendarTokens.get(employeeId);
  if (!t) return null;
  if (t.refresh_token && Date.now() > (t.expiry_date || 0) - 60_000) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: t.refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }),
    });
    const refreshed = await r.json();
    if (refreshed.access_token) {
      const updated = { ...t, ...refreshed, expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) };
      employeeCalendarTokens.set(employeeId, updated);
      saveGoogleToken(`${employeeId}_calendar`, updated);
    }
  }
  return (employeeCalendarTokens.get(employeeId) || {}).access_token || null;
}

// Shared event body for a task.
function taskEventBody(task, attendees) {
  const day = String(task.due_date).slice(0, 10);      // tolerate a timestamp
  const end = new Date(day + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 1);            // Google's all-day end is exclusive
  const body = {
    summary: `[Task] ${task.title || 'Task'}`,
    description: [task.description || '', task.milestone ? `Milestone: ${task.milestone}` : '', `Priority: ${task.priority || 'medium'}`]
      .filter(Boolean).join('\n'),
    start: { date: day },
    end: { date: end.toISOString().slice(0, 10) },
  };
  if (attendees && attendees.length) body.attendees = attendees;
  return body;
}

// Create or patch one event on a given calendar. Returns the event id, or null.
async function upsertCalendarEvent(token, body, existingId, invite) {
  const q = invite ? '?sendUpdates=all' : '';
  const url = existingId
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existingId)}${q}`
    : `https://www.googleapis.com/calendar/v3/calendars/primary/events${q}`;
  const r = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ev = await r.json();
  if (!r.ok) {
    // A 404/410 means the event was deleted in Google — drop the stale id so the
    // next sync recreates it instead of failing forever.
    if (existingId && (r.status === 404 || r.status === 410)) return { gone: true };
    console.warn('[calendar] event write failed:', ev.error?.message || r.status);
    return null;
  }
  return { id: ev.id };
}

// Put a task on each assignee's calendar.
//  • Assignees who connected their own Google Calendar get the event written
//    straight into it (no invitation to accept).
//  • Anyone left over is invited from the company account, if one is connected.
// Event ids are tracked per target in tasks.calendar_events so re-syncing patches
// the same events rather than creating duplicates.
async function syncTaskToCalendar(task) {
  try {
    if (!task || !task.due_date) return;
    const ids = ctx.taskAssigneeList(task);
    if (!ids.length) return;
    const numIds = ids.map(Number).filter(n => !isNaN(n));
    const { data: emps } = await supabase.from('employees').select('id,name,email').in('id', numIds);

    // Existing ids: { "<employeeId>": eventId, company: eventId }. Older rows may
    // only have the flat calendar_event_id (always a company event).
    const prior = (task.calendar_events && typeof task.calendar_events === 'object') ? { ...task.calendar_events } : {};
    if (task.calendar_event_id && !prior.company) prior.company = task.calendar_event_id;
    const next = { ...prior };
    let changed = false;

    const personal = new Set();
    for (const emp of emps || []) {
      // One employee's failure must never stop the others, nor the company fallback.
      try {
        if (!taskCalendarEventsOk) break;
        const token = await getEmployeeCalendarToken(emp.id);
        if (!token) continue;
        const key = String(emp.id);
        const r = await upsertCalendarEvent(token, taskEventBody(task, null), next[key], false);
        if (r && r.gone) { delete next[key]; changed = true; continue; }
        if (!r) continue;
        personal.add(emp.id);
        if (next[key] !== r.id) { next[key] = r.id; changed = true; }
        console.log('[calendar] task', task.id, '→ own calendar of employee', emp.id);
      } catch (e) { console.warn('[calendar] employee', emp.id, 'sync failed:', e.message); }
    }

    // Retire events for people who are no longer assignees (R4) — otherwise the
    // event lingers on a calendar for a task they've been taken off.
    const stillAssigned = new Set((emps || []).map(e => String(e.id)));
    for (const key of Object.keys(next)) {
      if (key === 'company' || stillAssigned.has(key)) continue;
      try {
        const token = await getEmployeeCalendarToken(Number(key));
        if (token) await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(next[key])}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      } catch (_) {}
      delete next[key]; changed = true;
    }

    // Whoever hasn't connected gets invited from the company account instead.
    const invitees = (emps || []).filter(e => e.email && !personal.has(e.id)).map(e => ({ email: e.email }));
    if (invitees.length) {
      const token = await getCalendarToken();
      if (token) {
        const r = await upsertCalendarEvent(token, taskEventBody(task, invitees), next.company, true);
        if (r && r.gone) { delete next.company; changed = true; }
        else if (r) {
          if (next.company !== r.id) { next.company = r.id; changed = true; }
          console.log('[calendar] task', task.id, '→ company invite to', invitees.length, 'assignee(s)');
        }
      }
    } else if (next.company) {
      // Everyone now has their own calendar — retire the shared invite.
      const token = await getCalendarToken();
      if (token) {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(next.company)}?sendUpdates=all`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      }
      delete next.company; changed = true;
    }

    if (changed) {
      const patch = { calendar_events: next, calendar_event_id: next.company || null };
      const { error } = await supabase.from('tasks').update(patch).eq('id', task.id);
      // Older databases without calendar_events still get the company id stored.
      if (error && /calendar_events/i.test(error.message || '')) {
        taskCalendarEventsOk = false;   // degrade to company-invites only (see migrations/004)
        console.warn('[calendar] tasks.calendar_events missing — apply migrations/004. Falling back to company invites.');
        await supabase.from('tasks').update({ calendar_event_id: next.company || null }).eq('id', task.id);
      }
    }
  } catch (e) { console.warn('[calendar] sync error:', e.message); }
}

// Employee drive connect
receiver.router.get('/api/employee/drive/status', requireEmployeeAuth, requirePerm('drive', 'view'), (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.json({ configured: false });
  const t = employeeDriveTokens.get(req.employee.id);
  if (!t) return res.json({ configured: true, connected: false });
  res.json({ configured: true, connected: true, email: t.email, name: t.name, canUpload: driveCanUpload(t) });
});

receiver.router.get('/api/employee/drive/connect', requireEmployeeAuth, requirePerm('drive', 'connect'), (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'employee', employeeId: req.employee.id });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${base}/api/email/callback`, response_type: 'code', scope: DRIVE_SCOPES, access_type: 'offline', prompt: 'consent', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/employee/drive/disconnect', requireEmployeeAuth, requirePerm('drive', 'connect'), (req, res) => { employeeDriveTokens.delete(req.employee.id); res.json({ ok: true }); });

receiver.router.get('/api/employee/drive/files',  requireEmployeeAuth, requirePerm('drive', 'view'), async (req, res) => { try { res.json(await listDriveFiles(employeeDriveTokens.get(req.employee.id), null, `${req.employee.id}_drive`)); } catch (e) { res.status(500).json({ error: e.message }); } });
receiver.router.get('/api/employee/drive/sheets', requireEmployeeAuth, requirePerm('sheets', 'view'), async (req, res) => { try { res.json(await listDriveFiles(employeeDriveTokens.get(req.employee.id), 'application/vnd.google-apps.spreadsheet', `${req.employee.id}_drive`)); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── Employee Email ─────────────────────────────────────────────────────────────
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

receiver.router.get('/api/employee/email/status', requireEmployeeAuth, requirePerm('email', 'view'), (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.json({ configured: false });
  const t = employeeEmailTokens.get(req.employee.id);
  if (!t) return res.json({ configured: true, connected: false });
  res.json({ configured: true, connected: true, email: t.email, name: t.name });
});

receiver.router.get('/api/employee/email/connect', requireEmployeeAuth, requirePerm('email', 'connect'), (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).send('GOOGLE_CLIENT_ID not configured');
  const base  = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const state = crypto.randomBytes(16).toString('hex');
  pendingDriveAuth.set(state, { type: 'employee-gmail', employeeId: req.employee.id });
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: `${base}/api/email/callback`, response_type: 'code', scope: GMAIL_SCOPES, access_type: 'offline', prompt: 'consent', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

receiver.router.post('/api/employee/email/disconnect', requireEmployeeAuth, requirePerm('email', 'connect'), (req, res) => { employeeEmailTokens.delete(req.employee.id); res.json({ ok: true }); });

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

receiver.router.get('/api/employee/email/messages', requireEmployeeAuth, requirePerm('email', 'view'), async (req, res) => {
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

receiver.router.get('/api/employee/email/messages/:id', requireEmployeeAuth, requirePerm('email', 'view'), async (req, res) => {
  try {
    const token = await getEmployeeGmailToken(req.employee.id);
    const r   = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
    const msg = await r.json();
    const headers = msg.payload?.headers || [];
    const get = n => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value || '';
    res.json({ id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds || [], subject: get('Subject'), from: get('From'), to: get('To'), date: get('Date'), messageId: get('Message-ID'), body: decodeGmailBody(msg.payload || {}), isHtml: !!(msg.payload?.parts?.find(p => p.mimeType === 'text/html') || msg.payload?.mimeType === 'text/html') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/employee/email/send', requireEmployeeAuth, requirePerm('email', 'send'), express.json(), async (req, res) => {
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

// Employee Portal  → src/routes/employee-portal.js
Object.assign(ctx, { GOOGLE_CLIENT_ID, SMTP_FROM, autoCreateSaleForWonDeal, createMailer, crypto, employeeSessions, express, generateToken, hashPassword, inventorySearch, multer, path, pendingDriveAuth, receiver, requireAuth, requireEmployeeAuth, supabase, verifyPassword });
Object.assign(ctx, require('./src/routes/employee-portal'));
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

// Notification Center ─  → src/routes/notifications.js
Object.assign(ctx, { chatBroadcast, chatSseClients, receiver, requireAuth, requireEmployeeAuth, sendPushAlways, sendPushToOfflineMembers, supabase });
Object.assign(ctx, require('./src/routes/notifications'));
// Notification Center streams  → src/routes/notif-streams.js
Object.assign(ctx, { chatCallerIdentity, express, receiver, requireAuth, requireEmployeeAuth, supabase });
Object.assign(ctx, require('./src/routes/notif-streams'));
// Group administration + huddles  → src/routes/huddles.js
Object.assign(ctx, { chatBroadcast, chatCallerIdentity, crypto, express, multer, path, receiver, requireAuth, requireEmployeeAuth, supabase, upload });
require('./src/routes/huddles');
Object.assign(ctx, require('./src/routes/link-preview'));
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

// WhatsApp Inbox  → src/routes/whatsapp.js
Object.assign(ctx, { crypto, express, path, receiver, requireAuth, sendPushToOfflineMembers, supabase });
Object.assign(ctx, require('./src/routes/whatsapp'));
// Quotation Draft  → src/routes/quotations.js
Object.assign(ctx, { autoCreateSaleForWonDeal, express, multer, receiver, requireAuth, requireEmployeeAuth, supabase });
Object.assign(ctx, require('./src/routes/quotations'));
// Employee Quotation Draft  → src/routes/employee-quote.js
Object.assign(ctx, { ADMIN_USERNAME, express, receiver, requireAuth, requireEmployeeAuth, supabase, upload, vapidKeys });
Object.assign(ctx, require('./src/routes/employee-quote'));
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
      await ctx.createNotification(key, {
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
  ctx.scheduleDueDateReminders();
  ctx.scheduleHoursLogReminder();
  scheduleFollowupReminders();
  ctx.scheduleAutomationSweep();
  ctx.scheduleRecurringTasks();
  setTimeout(() => ctx.backfillHotLeadDeals().catch(console.error), 15 * 1000); // one-time: deals for pre-existing Hot leads
  if (process.env.WHATSAPP_ENABLED === 'true') ctx.initWhatsApp().catch(console.error);
  const port = process.env.PORT || 3000;
  receiver.app.listen(port, () => {
    console.log(`⚡️  MotoLinker running on port ${port}`);
  });
  console.log(`📊  Admin dashboard → http://localhost:${port}/dashboard`);
  if (!ADMIN_PASSWORD) console.warn('⚠️   ADMIN_PASSWORD is not set — dashboard login will fail!');
})();
