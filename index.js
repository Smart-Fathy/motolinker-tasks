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

// ─── Form Submissions (in-memory) ────────────────────────────────────────────
let submissions = []; // { id, name, email, phone, message, car_interest, submitted_at }
let submissionIdSeq = 1;


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
    if (!tasks || tasks.length === 0) return res.json({ total: 0, done: 0, inProgress: 0, todo: 0, highPriority: 0, overdue: 0, byChannel: {}, byPriority: { high: 0, medium: 0, low: 0 }, byEmployee: [], completionRate: 0 });
    const total = tasks.length, done = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length, todo = tasks.filter(t => t.status === 'todo').length;
    const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done').length;
    const today = new Date().toISOString().split('T')[0];
    const overdue = tasks.filter(t => t.due_date < today && t.status !== 'done').length;
    const byChannel = {}, byPriority = { high: 0, medium: 0, low: 0 };
    tasks.forEach(t => {
      if (!byChannel[t.channel_name]) byChannel[t.channel_name] = { todo: 0, in_progress: 0, done: 0, total: 0 };
      byChannel[t.channel_name][t.status]++; byChannel[t.channel_name].total++;
      if (byPriority[t.priority] !== undefined) byPriority[t.priority]++;
    });
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
    res.json({ total, done, inProgress, todo, highPriority, overdue, byChannel, byPriority, byEmployee, completionRate: Math.round((done / total) * 100) });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  // Capture prior assignees to detect (re)assignment
  const { data: prev } = await supabase.from('tasks').select('assignee_id, assignee_ids').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('tasks').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Notify only newly-added assignees
  const before = new Set(taskAssigneeList(prev));
  const added = taskAssigneeList(data).filter(id => !before.has(id));
  if (added.length) notifyEmployeeTaskAssigned({ ...data, assignee_ids: added });
  res.json(data);
});

receiver.router.delete('/api/dashboard/tasks/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

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

async function postTaskComment(taskId, authorKey, authorName, body, res) {
  const text = String(body || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Comment is empty' });
  const { data: task } = await supabase.from('tasks').select('id,title').eq('id', taskId).single();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { data, error } = await supabase.from('task_comments')
    .insert({ task_id: taskId, author_key: authorKey, author_name: authorName, body: text })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
  // Notify @mentioned employees (best-effort, after response)
  try {
    const { data: emps } = await supabase.from('employees').select('id,name,username');
    const lower = text.toLowerCase();
    for (const e of emps || []) {
      const mentioned = (e.name && lower.includes('@' + e.name.toLowerCase())) || (e.username && lower.includes('@' + e.username.toLowerCase()));
      if (!mentioned || `employee_${e.id}` === authorKey) continue;
      createNotification(`employee_${e.id}`, {
        type: 'task',
        title: `${authorName} mentioned you in a comment`,
        body: `${task.title}: ${text.slice(0, 140)}`,
        url: '/employee#tasks',
      }, 'always');
    }
  } catch (_) {}
}

receiver.router.get('/api/dashboard/tasks/:id/comments', requireAuth, (req, res) => listTaskComments(parseInt(req.params.id), res));
receiver.router.post('/api/dashboard/tasks/:id/comments', requireAuth, express.json(), (req, res) =>
  postTaskComment(parseInt(req.params.id), 'admin', 'Admin', req.body?.body, res));
receiver.router.get('/api/employee/tasks/:id/comments', requireEmployeeAuth, (req, res) => listTaskComments(parseInt(req.params.id), res));
receiver.router.post('/api/employee/tasks/:id/comments', requireEmployeeAuth, express.json(), (req, res) =>
  postTaskComment(parseInt(req.params.id), `employee_${req.employee.id}`, req.employee.name, req.body?.body, res));

// Coworker names (for @mention autocomplete in comments)
receiver.router.get('/api/employee/coworkers', requireEmployeeAuth, async (_req, res) => {
  const { data, error } = await supabase.from('employees').select('id,name,username,avatar_url').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
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
  const { data, error } = await supabase.from('requests')
    .insert({ title, description: description || '', priority: priority || 'medium', assigned_to: assigned_to || '', created_by: 'dashboard', status: 'pending' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

receiver.router.put('/api/dashboard/requests/:id', requireAuth, express.json(), async (req, res) => {
  const { data: existing } = await supabase.from('requests').select('status,created_by,title').eq('id', req.params.id).single();
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
        const permissions = { requests:true, drive:true, sheets:true, pdfscraper:false, email:false, viewAllRequests:false, quotation:false, leads:false, deals:false, ...(emp.permissions || {}) };
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
  let query = supabase.from('requests').select('*').order('created_at', { ascending: false });
  if (!canViewAll) query = query.eq('created_by', req.employee.username);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.post('/api/employee/requests', requireEmployeeAuth, express.json(), async (req, res) => {
  const { title, description, category, priority } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const { data, error } = await supabase.from('requests')
    .insert({ title, description: description || '', priority: priority || 'medium', assigned_to: '', created_by: req.employee.username, status: 'pending', category: category || '' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Notify admin notification center
  if (data) {
    createNotification('admin', {
      type: 'request',
      title: 'New employee request',
      body: `${req.employee.name}: ${title}`,
      url: '/dashboard#requests',
    }, 'offline');
  }
  res.json(data);
});

// Employee auth
const DEFAULT_PERMISSIONS = { requests: true, drive: true, sheets: true, pdfscraper: false, email: false, viewAllRequests: false, quotation: false, leads: false, deals: false };

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
  const permissions = { ...DEFAULT_PERMISSIONS, ...(emp.permissions || {}) };
  employeeSessions.set(token, { id: emp.id, name: emp.name, username: emp.username, job_title: emp.job_title || '', permissions });
  res.json({ token, name: emp.name, username: emp.username, id: emp.id, job_title: emp.job_title || '', permissions, avatar_url: emp.avatar_url || '', status_text: emp.status_text || '', status_emoji: emp.status_emoji || '' });
});
receiver.router.get('/api/employee/check', requireEmployeeAuth, async (req, res) => {
  let profile = {};
  try {
    const { data } = await supabase.from('employees').select('permissions,job_title,avatar_url,status_text,status_emoji,username').eq('id', req.employee.id).single();
    if (data) {
      const permissions = { ...DEFAULT_PERMISSIONS, ...(data.permissions || {}) };
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
    const { data: task } = await supabase.from('tasks').select('id, assignee_id, assignee_ids').eq('id', req.params.id).single();
    const assigned = task && (ids.includes(task.assignee_id) || (Array.isArray(task.assignee_ids) && task.assignee_ids.map(String).includes(String(req.employee.id))));
    if (!assigned) return res.status(403).json({ error: 'Task not assigned to you' });
    const completedAt = new Date().toISOString();
    const { data, error } = await supabase.from('tasks')
      .update({ status: 'done', completed_at: completedAt, updated_at: completedAt })
      .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
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
  res.json((data || []).map(e => ({ ...e, permissions: { ...DEFAULT_PERMISSIONS, ...(e.permissions || {}) } })));
});
receiver.router.post('/api/dashboard/employees', requireAuth, express.json(), async (req, res) => {
  const { name, username, password, email, job_title, slack_user_id, permissions } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' });
  const { data: existing } = await supabase.from('employees').select('id').eq('username', username).single();
  if (existing) return res.status(409).json({ error: 'Username already taken' });
  const perms = { ...DEFAULT_PERMISSIONS, ...(permissions || {}) };
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
  if (permissions) updates.permissions = { ...DEFAULT_PERMISSIONS, ...permissions };
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
  const { name, phone, email, source, notes, lead_date, lead_time, lead_status, car_in_question, budget_lead, next_action, been_contacted, sales_feedback, inquiry, custom_fields } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const { data, error } = await supabase.from('customers')
    .insert({ name, phone: phone||'', email: email||'', source: source||'', notes: notes||'', lead_date: lead_date||null, lead_time: lead_time||'', lead_status: lead_status||'cold', car_in_question: car_in_question||'', budget_lead: budget_lead||null, next_action: next_action||'', been_contacted: been_contacted||false, sales_feedback: sales_feedback||'', inquiry: inquiry||'', ...(custom_fields && Object.keys(custom_fields).length ? { custom_fields } : {}), created_by: 'dashboard' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Auto-create deal if status is Hot on creation
  if (data.lead_status === 'hot') {
    supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question||'', budget_egp: data.budget_lead||null, notes: 'Auto-created from Hot lead', created_by: 'system' }).then(()=>{}).catch(()=>{});
  }
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
    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return res.status(400).json({ error: 'Need header row + at least one data row' });
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, '').replace(/ /g, '_'));
    const toInsert = lines.slice(1).map(line => {
      const vals = parseCsvLine(line);
      const r = {};
      headers.forEach((h, i) => { r[h] = (vals[i] || '').trim().replace(/^"|"$/g, ''); });
      return r;
    }).filter(r => r.name).map(r => ({
      name: r.name, phone: r.phone||'', email: r.email||'', source: r.origin||r.source||'',
      notes: r.notes||'', lead_date: normalizeLeadDate(r.date), lead_time: r.time||'',
      lead_status: r.status||'cold', car_in_question: r.car||r.car_in_question||'',
      budget_lead: r.budget ? (parseInt(String(r.budget).replace(/[^0-9]/g, ''), 10) || null) : null,
      next_action: r.next_action||'', been_contacted: /^(true|1|yes|y)$/i.test((r.been_contacted||'').trim()),
      sales_feedback: r.sales_feedback||'', inquiry: r.inquiry||'', created_by: 'csv_import',
    }));
    if (!toInsert.length) return res.status(400).json({ error: 'No valid rows (Name column is required)' });
    const { error } = await supabase.from('customers').insert(toInsert);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ count: toInsert.length });
  } catch (e) { console.error('[csv-import]', e); res.status(500).json({ error: e.message }); }
});

receiver.router.put('/api/dashboard/customers/:id', requireAuth, express.json(), async (req, res) => {
  const { data: prev } = await supabase.from('customers').select('lead_status').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('customers')
    .update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Auto-create deal when status changes to Hot
  if (data.lead_status === 'hot' && prev?.lead_status !== 'hot') {
    try {
      const { data: existing } = await supabase.from('deals').select('id').eq('customer_id', data.id).limit(1);
      if (!existing?.length) {
        await supabase.from('deals').insert({ customer_id: data.id, title: `${data.name}${data.car_in_question ? ' — ' + data.car_in_question : ''}`, stage: 'lead', car_model: data.car_in_question||'', budget_egp: data.budget_lead||null, notes: 'Auto-created from Hot lead', created_by: 'system' });
        console.log('[leads] Auto-created deal for hot lead', data.id);
      }
    } catch (e) { console.warn('[leads] Auto-deal failed:', e.message); }
  }
  res.json(data);
});

receiver.router.delete('/api/dashboard/customers/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('customers').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
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
  // Notify configured employee when deal moves to 'contacted'
  if (updates.stage === 'contacted' && prev?.stage !== 'contacted') {
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
  res.json(data);
});

receiver.router.delete('/api/dashboard/deals/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('deals').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
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
  return (rooms || []).map(r => ({ ...r, members: membersByRoom[r.id] || [], lastMessage: lastMsgByRoom[r.id] || null }));
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

async function chatGetMessages(req, res, callerKey) {
  const roomId = parseInt(req.params.roomId);
  const { data: member } = await supabase.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('member_key', callerKey).single();
  if (!member) return res.status(403).json({ error: 'Not a member of this room' });
  const before = req.query.before;
  let query = supabase.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(50);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).reverse());
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
  const { data: msg, error } = await supabase.from('chat_messages').insert(insert).select().single();
  if (error) return res.status(500).json({ error: error.message });
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

// ── Employee read-only CRM (gated by admin permission) ──────────────────────────
receiver.router.get('/api/employee/leads', requireEmployeeAuth, async (req, res) => {
  if (req.employee.permissions?.leads !== true) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/employee/deals', requireEmployeeAuth, async (req, res) => {
  if (req.employee.permissions?.deals !== true) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('deals').select('*, customers(name,phone,email)').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
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

// Employee quotation settings (read-only)
receiver.router.get('/api/employee/quotation/settings', requireEmployeeAuth, async (req, res) => {
  if (req.employee.permissions?.quotation !== true) return res.status(403).json({ error: 'Not permitted' });
  const { data } = await supabase.from('quotation_settings').select('key,value');
  const settings = {};
  for (const row of data || []) settings[row.key] = row.value;
  res.json(settings);
});

receiver.router.get('/api/employee/quotations', requireEmployeeAuth, async (req, res) => {
  if (req.employee.permissions?.quotation !== true) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('quotations').select('id,quote_id,title,created_by,created_at').eq('created_by', req.employee.username).order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

receiver.router.get('/api/employee/quotations/:id', requireEmployeeAuth, async (req, res) => {
  if (req.employee.permissions?.quotation !== true) return res.status(403).json({ error: 'Not permitted' });
  const { data, error } = await supabase.from('quotations').select('*').eq('id', req.params.id).eq('created_by', req.employee.username).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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

// Render quotation HTML to a PDF buffer via Puppeteer, blocking any resource
// load that isn't an inline data: URL or https: (prevents file:// LFI and
// internal http:// SSRF from authored/injected markup).
async function renderQuotationPdf(html) {
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
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  } finally {
    await browser.close();
  }
}

function buildQuotationHtml(data) {
  const { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings } = data;
  const s = settings || {};
  const exRate = parseFloat(exchange) || 1;

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

  const GOLD   = '#c9922a';
  const NAVY   = '#1B2D6B';
  const LGOLD  = '#f5e9c8';

  const imgSection = imageDataUrls && imageDataUrls.length
    ? `<tr><td colspan="4" style="padding:10px 0;border:1px solid ${GOLD};border-top:none">
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          ${imageDataUrls.map(src => `<img src="${escHtml(src)}" style="height:130px;max-width:220px;object-fit:contain;border-radius:4px;border:1px solid ${GOLD}">`).join('')}
        </div>
       </td></tr>`
    : '';

  const vehicleRow = vehicleModel
    ? `<tr><td colspan="4" style="text-align:center;font-size:17px;font-weight:700;color:#cc3300;padding:10px 8px;border:1px solid ${GOLD};border-bottom:none">${escHtml(vehicleModel)}</td></tr>`
    : '';

  const itemRowsHtml = itemRows.map((item, i) => {
    const isFree = item.egp === null;
    const bg = i % 2 === 1 ? `background:#fdfaf3` : '';
    return `<tr style="${bg}">
      <td style="padding:7px 10px;border:1px solid ${GOLD};color:${NAVY}">${escHtml(item.name || '')}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${escHtml(item.unit || 1)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${isFree ? 'Free' : fmtNum(item.priceUsd)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${isFree ? 'Free' : fmtNum(item.egp)}</td>
    </tr>`;
  }).join('');

  const logRowsHtml = logisticsRows.map((row, i) => {
    const bg = i % 2 === 1 ? `background:#fdfaf3` : '';
    return `<tr style="${bg}">
      <td colspan="2" style="padding:7px 10px;border:1px solid ${GOLD};color:${NAVY}">${escHtml(row.label)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${fmtNum(row.priceUsd)}</td>
      <td style="padding:7px 10px;border:1px solid ${GOLD};text-align:center;color:${NAVY}">${fmtNum(row.egp)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: ${NAVY}; background: #fff; padding: 0; }
  .page { width: 794px; min-height: 1123px; padding: 24px 28px 80px; position: relative; }

  .logo-text { font-size: 22px; font-weight: 900; letter-spacing: 1px; color: ${NAVY}; }
  .logo-link { color: ${GOLD}; }

  .header-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .quotation-title { font-size: 24px; font-weight: 900; letter-spacing: 2px; color: ${NAVY}; text-align: center; }

  .meta-table { border-collapse: collapse; width: 100%; }
  .meta-table td { padding: 3px 8px; border: 1px solid ${GOLD}; font-size: 10px; }
  .meta-label { font-weight: 700; color: ${NAVY}; background: ${LGOLD}; white-space: nowrap; }
  .meta-val   { font-weight: 700; color: #cc3300; min-width: 120px; }

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
        <img src="https://images.motolinkers.com/avatar-11-max-reev/motolinkers-logo-black-text-preview.png" style="max-height:60px;width:auto;display:block">
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

  <!-- KEY SPECS (left) + PAYMENT TERMS (bottom right) -->
  <div style="margin-top:14px">
    <div class="section-label" style="margin-top:0">KEY SPECS</div>
    <div style="display:flex;gap:14px;align-items:stretch">
      <!-- Left: spec keys -->
      <div style="flex:1;border:1px solid ${GOLD};padding:12px 16px;font-size:10.5px;line-height:2;color:${NAVY}">
        <div><strong>Currency:</strong> ${escHtml(currency || 'EGP')}</div>
        <div><strong>Exchange:</strong> ${fmtNum(exchange)}</div>
        ${issuer ? `<div><strong>Issuer:</strong> ${escHtml(issuer)}</div>` : ''}
        ${(customSpecs || []).map(sp => sp.key ? `<div><strong>${escHtml(sp.key)}:</strong> ${escHtml(sp.val || '')}</div>` : `<div>${escHtml(sp.val || '')}</div>`).join('')}
      </div>
      <!-- Right: payment terms -->
      <div style="width:46%;border:1px solid ${GOLD};padding:12px 16px;font-size:10.5px;line-height:2;color:${NAVY}">
        <div style="font-weight:700;margin-bottom:4px">Payment terms</div>
        ${(s.payment_terms || '50% Down payment operations start\n30% Upon shipping from supplier\n20% Upon Custom clearances').split('\n').map(l => `<div style="padding-left:14px">${escHtml(l)}</div>`).join('')}
      </div>
    </div>
  </div>

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
      <img src="https://images.motolinkers.com/avatar-11-max-reev/motolinkers-logo-black-text-preview.png" style="max-height:45px;width:auto;display:block">
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
      const files       = req.files || [];
      const imageDataUrls = files.map(f => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);

      // Load company settings from DB
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;

      const html = buildQuotationHtml({ id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings });

      const pdfBuffer = await renderQuotationPdf(html);

      res.json({ pdf: Buffer.from(pdfBuffer).toString('base64') });
      // Save quotation record (best-effort)
      supabase.from('quotations').insert({
        quote_id: id || generateQuoteId(),
        title: `${vehicleModel || 'Quotation'} — ${name || ''}`.trim(),
        data: { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, customSpecs },
        created_by: 'dashboard'
      }).then(() => {}).catch(() => {});
    } catch (e) {
      console.error('[quotation-gen]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ─── Employee Quotation Draft ──────────────────────────────────────────────────
receiver.router.get('/api/employee/quotation/newid', requireEmployeeAuth, (req, res) => {
  if (req.employee.permissions?.quotation !== true) return res.status(403).json({ error: 'Not permitted' });
  res.json({ id: generateQuoteId() });
});

receiver.router.post('/api/employee/quotation/generate', requireEmployeeAuth,
  quotationImgUpload.array('images', 5), async (req, res) => {
    try {
      if (req.employee.permissions?.quotation !== true) return res.status(403).json({ error: 'Not permitted' });
      const { id, date, validTo, name, vehicleModel, items: itemsJson, logistics: logisticsJson, currency, exchange, issuer, customSpecs: customSpecsJson } = req.body;
      const items       = JSON.parse(itemsJson       || '[]');
      const logistics   = JSON.parse(logisticsJson   || '[]');
      const customSpecs = JSON.parse(customSpecsJson || '[]');
      const files       = req.files || [];
      const imageDataUrls = files.map(f => `data:${f.mimetype};base64,${f.buffer.toString('base64')}`);

      // Load company settings from DB
      const { data: settingsRows } = await supabase.from('quotation_settings').select('key,value');
      const settings = {};
      for (const row of settingsRows || []) settings[row.key] = row.value;

      const html = buildQuotationHtml({ id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, imageDataUrls, customSpecs, settings });

      const pdfBuffer = await renderQuotationPdf(html);

      res.json({ pdf: Buffer.from(pdfBuffer).toString('base64') });
      // Save quotation record (best-effort) so the employee's history is populated
      supabase.from('quotations').insert({
        quote_id: id || generateQuoteId(),
        title: `${vehicleModel || 'Quotation'} — ${name || ''}`.trim(),
        data: { id, date, validTo, name, vehicleModel, items, logistics, currency, exchange, issuer, customSpecs },
        created_by: req.employee.username
      }).then(() => {}).catch(() => {});
    } catch (e) {
      console.error('[emp-quotation-gen]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

// ─── Form Submissions ─────────────────────────────────────────────────────────
// Public endpoint — no auth required (customers submit from the website)
receiver.router.post('/api/submissions', express.json(), async (req, res) => {
  const { name, email, phone, message, car_interest } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

  const sub = {
    id: submissionIdSeq++,
    name: String(name).trim(),
    email: String(email).trim(),
    phone: phone ? String(phone).trim() : '',
    message: message ? String(message).trim() : '',
    car_interest: car_interest ? String(car_interest).trim() : '',
    submitted_at: new Date().toISOString(),
  };
  submissions.unshift(sub);


  res.json({ ok: true, id: sub.id });
});

// Admin — list all submissions
receiver.router.get('/api/submissions', requireAuth, (_req, res) => {
  res.json(submissions);
});

// Admin — delete a submission
receiver.router.delete('/api/submissions/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const idx = submissions.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  submissions.splice(idx, 1);
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
  if (!vapidKeys) return;
  const today = new Date().toISOString().split('T')[0];
  const [{ data: allEmps }, { data: logsToday }] = await Promise.all([
    supabase.from('employees').select('id'),
    supabase.from('hours_logs').select('employee_id').eq('log_date', today),
  ]);
  const loggedIds = new Set((logsToday || []).map(l => l.employee_id));
  for (const emp of allEmps || []) {
    if (!loggedIds.has(emp.id)) {
      createNotification(`employee_${emp.id}`, {
        type: 'hours',
        title: 'Log your hours',
        body: "Please log today's working hours before you leave.",
        url: '/employee#log',
      }, 'offline');
    }
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

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
  await loadGoogleTokens();
  await loadOrCreateVapidKeys();
  scheduleDueDateReminders();
  scheduleHoursLogReminder();
  if (process.env.WHATSAPP_ENABLED === 'true') initWhatsApp().catch(console.error);
  const port = process.env.PORT || 3000;
  receiver.app.listen(port, () => {
    console.log(`⚡️  MotoLinker running on port ${port}`);
  });
  console.log(`📊  Admin dashboard → http://localhost:${port}/dashboard`);
  if (!ADMIN_PASSWORD) console.warn('⚠️   ADMIN_PASSWORD is not set — dashboard login will fail!');
})();
