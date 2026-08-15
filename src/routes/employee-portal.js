// Employee Portal
// Lifted out of index.js unchanged. src/ctx.js explains the context object.
const ctx = require('../ctx');
const { GOOGLE_CLIENT_ID, PUBLIC_DIR, SMTP_FROM, autoCreateSaleForWonDeal, createMailer, crypto, employeeSessions, express, generateToken, hashPassword, inventorySearch, multer, path, pendingDriveAuth, receiver, requireAuth, requireEmployeeAuth, supabase, verifyPassword } = ctx.need('GOOGLE_CLIENT_ID', 'PUBLIC_DIR', 'SMTP_FROM', 'autoCreateSaleForWonDeal', 'createMailer', 'crypto', 'employeeSessions', 'express', 'generateToken', 'hashPassword', 'inventorySearch', 'multer', 'path', 'pendingDriveAuth', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase', 'verifyPassword');
// Provided by another module, so resolved through the context rather than
// captured at require time — load order between feature modules is not fixed.
const autoNorm = (...a) => ctx.autoNorm(...a);
const createNotification = (...a) => ctx.createNotification(...a);
const requestCtx = (...a) => ctx.requestCtx(...a);
// Defined in index.js alongside the auth guards; see the note there on why it
// reaches empCan through the context.
const requirePerm = (...a) => ctx.requirePerm(...a);
const runAutomations = (...a) => ctx.runAutomations(...a);

// ─── Employee Portal ──────────────────────────────────────────────────────────
// PUBLIC_DIR, not __dirname: this file lives in src/routes, so joining its own
// directory resolved to src/routes/public and the portal answered 404.
receiver.router.get('/employee', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'employee.html')));

// Employee Requests
receiver.router.get('/api/employee/requests', requireEmployeeAuth, requirePerm('requests', 'view'), async (req, res) => {
  const canViewAll = empCan(req.employee, 'requests', 'viewAll');
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

receiver.router.post('/api/employee/requests', requireEmployeeAuth, requirePerm('requests', 'create'), express.json(), async (req, res) => {
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
// Defaults for an employee whose record predates a section. Everything the whole
// team has always had is `true` here, so adding a section to the model never
// silently takes it away from people who already had it; anything sensitive
// (email, CRM, reports, the issues centre) stays opt-in.
const DEFAULT_PERMISSIONS = {
  // Day to day
  requests: true, tasks: true, hours: true,
  // Google
  drive: true, sheets: true, calendar: true, meet: true, email: false, gchat: false,
  // Talking to each other
  chat: true,
  // Inventory, operations and procurement — off until someone is given them
  stock: true,
  suppliers: false, rfq: false, purchaseorders: false, contracts: false, submissions: false,
  // Tools and CRM
  pdfscraper: false, quotation: false, leads: false, deals: false, reports: false,
  // System
  issues: false,
  // Legacy flat flag, kept because normEmpPerms still reads it — see PERM_LEGACY
  viewAllRequests: false,
};

// ── Advanced permissions: per-action + data scope, for every section ──────────
// Backward compatible: legacy flat booleans (e.g. leads:true) normalize to full
// actions + no scope. The rich shape adds <section>Actions objects and a scope.
//
// An action earns its place here only if something actually enforces it — a route
// guard, a nav item or a button. A checkbox that governs nothing is worse than no
// checkbox, because the admin believes they have turned something off.
const PERM_ACTIONS = {
  // Day to day
  requests: ['view', 'create', 'comment', 'viewAll'],
  tasks: ['view', 'create', 'edit', 'comment'],
  // Two nav items, one section: "Log Hours" writes, "Hours Log" reads. A rep who
  // must file their hours but should not read the team's gets log without view.
  hours: ['log', 'view'],
  // Google. `connect` is separate from `view` because connecting binds a personal
  // Google account to the workplace account — a different decision from browsing.
  drive: ['view', 'connect'],
  sheets: ['view'],
  email: ['view', 'send', 'connect'],
  calendar: ['view', 'connect'],
  // Meet has no actions on purpose. The page opens meet.google.com and touches no
  // endpoint of ours, so access is the only thing there is to grant — and a `view`
  // checkbox here would be one nothing enforces.
  meet: [],
  gchat: ['view', 'send'],
  // In-app chat. `edit`/`delete` are for one's own messages; huddles and uploads
  // are the two things a chat member can do that cost bandwidth or leave files.
  chat: ['view', 'send', 'edit', 'delete', 'upload', 'huddle'],
  // Inventory. Read-only from the portal: there is no stock page there, only the
  // vehicle picker in the lead and quotation forms and two Home widgets — which
  // were ungated, so every employee saw the company's stock counts on Home.
  stock: ['view'],
  // Operations and procurement. The handlers are the dashboard's own, mounted a
  // second time under /api/employee — so these actions are the only difference
  // between what an employee may do here and what the admin may.
  suppliers: ['view', 'create', 'edit', 'delete', 'catalogue', 'docs'],
  rfq: ['view', 'create', 'edit', 'delete', 'export'],
  purchaseorders: ['view', 'create', 'edit', 'delete', 'export'],
  contracts: ['view', 'create', 'edit', 'delete', 'export'],
  // The website writes these; a person only reads one or bins it.
  submissions: ['view', 'delete'],
  // CRM
  leads: ['view', 'create', 'edit', 'delete', 'import', 'export'],
  deals: ['view', 'create', 'edit', 'delete', 'move'],
  quotation: ['draft', 'history', 'settings', 'delete', 'attachLead'],
  // Each report is granted individually, so an employee can be given the leads
  // report without the revenue figures (or vice-versa). Reports always obey the
  // employee's data scope — they aggregate only rows that employee may see.
  reports: ['leads', 'sales', 'export'],
  // System
  issues: ['view', 'resolve'],
};

// Where "the master switch is on" is the wrong default for an action, because the
// action used to be governed by a flag of its own. Without this, turning Requests
// on — which it is for everyone — would hand every employee the whole company's
// requests, since requests.viewAll would inherit the master's `true`.
const PERM_LEGACY = {
  'requests.viewAll': p => p.viewAllRequests === true,
};

function normEmpPerms(raw) {
  const p = { ...DEFAULT_PERMISSIONS, ...(raw || {}) };
  for (const [section, actions] of Object.entries(PERM_ACTIONS)) {
    const master = p[section] === true;
    const given = raw && raw[section + 'Actions'] && typeof raw[section + 'Actions'] === 'object' ? raw[section + 'Actions'] : null;
    const out = {};
    for (const a of actions) {
      const legacy = PERM_LEGACY[section + '.' + a];
      // legacy: master on ⇒ all actions, except where an older flag said otherwise
      out[a] = given ? given[a] === true : (legacy ? master && legacy(p) : master);
    }
    p[section + 'Actions'] = out;
  }
  // Keep the flat flag in step with the action, so anything still reading it — a
  // saved automation, an old client cached in a service worker — sees one answer.
  p.viewAllRequests = p.requestsActions.viewAll === true;
  const s = (raw && typeof raw.scope === 'object' && raw.scope) ? raw.scope : {};
  p.scope = {
    assignedOnly: s.assignedOnly === true,
    dealStages: Array.isArray(s.dealStages) ? s.dealStages.filter(x => ctx.DEAL_STAGES.includes(x)) : [],
    leadStatuses: Array.isArray(s.leadStatuses) ? s.leadStatuses.map(x => autoNorm(x)).filter(Boolean) : [],
  };
  return p;
}
// Can this employee perform <action> in <section>? Master must be on AND the action allowed.
function empCan(emp, section, action) {
  const p = emp && emp.permissions; if (!p) return false;
  // The Issues centre belonged to the CTO by job title before it had a permission.
  // Honouring that here means nobody loses it the moment the section gains a
  // switch; the switch is now how anyone *else* is given it.
  if (section === 'issues' && /chief technical officer/i.test(emp.job_title || '')) return true;
  if (p[section] !== true) return false;
  const acts = p[section + 'Actions'];
  return !!(acts && acts[action] === true);
}
// ── What the admin's editor renders ───────────────────────────────────────────
// Grouped and labelled next to the model rather than in dashboard.js, and served
// over an endpoint, so the editor is generated from the same list the server
// enforces. Add a section to PERM_ACTIONS and it appears in the admin UI; it
// cannot be forgotten there, and it cannot show up as a bare camelCase key.
const PERM_GROUPS = [
  { group: 'Day to day', sections: ['requests', 'tasks', 'hours'] },
  { group: 'Google',     sections: ['drive', 'sheets', 'email', 'calendar', 'meet', 'gchat'] },
  { group: 'Chat',       sections: ['chat'] },
  { group: 'Inventory',  sections: ['stock'] },
  { group: 'Operations', sections: ['suppliers', 'rfq', 'purchaseorders', 'contracts', 'submissions'] },
  { group: 'Tools',      sections: ['quotation'] },
  { group: 'CRM',        sections: ['leads', 'deals', 'reports'] },
  { group: 'System',     sections: ['issues'] },
];
const PERM_SECTION_LABELS = {
  requests: 'Requests', tasks: 'My Tasks', hours: 'Hours',
  drive: 'My Drive', sheets: 'My Sheets', email: 'My Email',
  calendar: 'Calendar', meet: 'Meet', gchat: 'Google Chat',
  chat: 'Team chat', quotation: 'Quotation', stock: 'Inventory',
  suppliers: 'Suppliers', rfq: 'RFQ', purchaseorders: 'Purchase orders',
  contracts: 'Sales contracts', submissions: 'Website submissions',
  leads: 'Leads', deals: 'Deals', reports: 'Reports', issues: 'Issues centre',
};
// Keyed "section.action" where the plain word would mislead, and by the bare word
// otherwise. Reports has no generic actions at all — each one names a report.
const PERM_ACTION_LABELS = {
  view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete',
  comment: 'Comment', connect: 'Connect account', send: 'Send',
  import: 'Import', export: 'Export', move: 'Move between stages',
  upload: 'Upload files', huddle: 'Start huddles', resolve: 'Resolve',
  draft: 'Draft quotations', history: 'Quotation history', settings: 'Quotation settings',
  attachLead: 'Attach to a lead',
  'requests.viewAll': "See everyone's requests",
  'hours.log': 'Log own hours', 'hours.view': 'Read the hours log',
  'chat.edit': 'Edit own messages', 'chat.delete': 'Delete own messages',
  'reports.leads': 'Leads report', 'reports.sales': 'Sales & revenue report',
  'reports.export': 'Export report data',
  'quotation.delete': 'Delete quotations',
  'issues.view': 'Open the issues centre',
  'stock.view': 'See stock levels and look vehicles up',
  'suppliers.catalogue': 'Manage the vehicle catalogue',
  'suppliers.docs': 'Supplier documents',
  'rfq.export': 'Generate the PDF',
  'purchaseorders.export': 'Generate the PDF',
  'contracts.export': 'Generate the PDF',
  'submissions.delete': 'Delete a submission',
};
function permCatalogue() {
  return PERM_GROUPS.map(g => ({
    group: g.group,
    sections: g.sections.filter(s => PERM_ACTIONS[s]).map(s => ({
      key: s,
      label: PERM_SECTION_LABELS[s] || s,
      defaultOn: DEFAULT_PERMISSIONS[s] === true,
      actions: PERM_ACTIONS[s].map(a => ({
        key: a,
        label: PERM_ACTION_LABELS[s + '.' + a] || PERM_ACTION_LABELS[a] || a,
      })),
    })),
  }));
}
receiver.router.get('/api/dashboard/permissions/catalogue', requireAuth,
  (_req, res) => res.json({ groups: permCatalogue(), stages: ctx.DEAL_STAGES }));

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
  const sess = { id: emp.id, name: emp.name, username: emp.username, job_title: emp.job_title || '', permissions };
  employeeSessions.set(token, sess);
  ctx.saveSession(token, 'employee', sess);
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
  ctx.dropSession(token);
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
receiver.router.get('/api/employee/tasks', requireEmployeeAuth, requirePerm('tasks', 'view'), async (req, res) => {
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
receiver.router.get('/api/employee/my-tasks', requireEmployeeAuth, requirePerm('tasks', 'view'), async (req, res) => {
  try {
    res.json(await fetchEmployeeTasks(req.employee.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee marks their own task as done
receiver.router.put('/api/employee/my-tasks/:id', requireEmployeeAuth, requirePerm('tasks', 'edit'), express.json(), async (req, res) => {  try {
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
receiver.router.post('/api/employee/my-tasks', requireEmployeeAuth, requirePerm('tasks', 'create'), express.json(), async (req, res) => {
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

receiver.router.get('/api/employee/hours', requireEmployeeAuth, requirePerm('hours', 'view'), async (req, res) => {
  const { data, error } = await supabase.from('hours_logs')
    .select('*, tasks(title, channel_name)')
    .eq('employee_id', req.employee.id)
    .order('logged_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
receiver.router.post('/api/employee/hours', requireEmployeeAuth, requirePerm('hours', 'log'), express.json(), async (req, res) => {
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
receiver.router.get('/api/employee/inventory/search', requireEmployeeAuth, requirePerm('stock', 'view'), async (req, res) => {
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

// No-code automation engine  → src/routes/automation.js
Object.assign(ctx, { express, logLeadActivity, normalizePhone, parseBudget, path, receiver, requireAuth, supabase });
Object.assign(ctx, require('./automation'));

module.exports = { DEFAULT_PERMISSIONS, PERM_ACTIONS, backfillHotLeadDeals, customerInScope, dealInScope, empCan, empHasScope, importLeadRows, loadLeadsColsConfig, logLeadActivity, multerCsv, normEmpPerms, normalizePhone, parseBudget, parseLeadsCsv, scopedQuotedIds };
