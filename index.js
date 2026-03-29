const { App, ExpressReceiver, LogLevel } = require('@slack/bolt');
const { createClient } = require('@supabase/supabase-js');
const { WebClient }    = require('@slack/web-api');
const crypto  = require('crypto');
const path    = require('path');
const express = require('express');
const multer  = require('multer');

// ─── App Init ─────────────────────────────────────────────────────────────────
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  logLevel: LogLevel.INFO,
});

const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const upload      = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const CHIEFS_CHANNEL_ID    = process.env.CHIEFS_CHANNEL_ID;
const ADMIN_USERNAME       = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// ─── Session Store ────────────────────────────────────────────────────────────
const sessions = new Map();
let gmailTokens = null; // { access_token, refresh_token, email, name, expiry_date }

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function requireAuth(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.query._t;
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Slack Data Cache ─────────────────────────────────────────────────────────
let _usersCache = null, _usersCacheAt = 0;
let _chCache    = null, _chCacheAt    = 0;

async function getSlackUsers() {
  if (_usersCache && Date.now() - _usersCacheAt < 300_000) return _usersCache;
  try {
    const { members = [] } = await slackClient.users.list({ limit: 200 });
    _usersCache = {};
    members.forEach(u => {
      if (u.is_bot || u.deleted || u.id === 'USLACKBOT') return;
      _usersCache[u.id] = {
        id: u.id,
        name: u.real_name || u.profile?.display_name || u.name,
        displayName: u.profile?.display_name || u.real_name || u.name,
        avatar: u.profile?.image_48 || '',
        email: u.profile?.email || '',
        title: u.profile?.title || '',
      };
    });
    _usersCacheAt = Date.now();
  } catch (e) { console.error('getSlackUsers:', e.message); if (!_usersCache) _usersCache = {}; }
  return _usersCache;
}

async function getSlackChannels() {
  if (_chCache && Date.now() - _chCacheAt < 300_000) return _chCache;
  try {
    const { channels = [] } = await slackClient.conversations.list({ types: 'public_channel,private_channel', limit: 200 });
    _chCache = channels.filter(c => !c.is_archived && c.id !== CHIEFS_CHANNEL_ID)
                       .map(c => ({ id: c.id, name: `#${c.name}` }));
    _chCacheAt = Date.now();
  } catch (e) { console.error('getSlackChannels:', e.message); if (!_chCache) _chCache = []; }
  return _chCache;
}

// ─── Slack Workflow Webhook ───────────────────────────────────────────────────
// Set SLACK_TASKS_WEBHOOK_URL in Railway env vars to enable.
// Create a Slack workflow: "From a webhook" → map fields → "Add to list" action.
const SLACK_TASKS_WEBHOOK_URL = process.env.SLACK_TASKS_WEBHOOK_URL;

async function notifySlackWebhook(task, action = 'created') {
  if (!SLACK_TASKS_WEBHOOK_URL) { console.warn('SLACK_TASKS_WEBHOOK_URL not set — skipping webhook'); return; }
  try {
    const users = await getSlackUsers().catch(() => ({}));
    const assigneeName = users[task.assignee_id]?.name || task.assignee_id;
    const payload = {
      task_id:      String(task.id),
      title:        task.title || '',
      status:       task.status || 'todo',
      assignee:     assigneeName,
      assignee_id:  task.assignee_id || '',
      due_date:     task.due_date || '',
      priority:     task.priority || 'medium',
      channel_name: task.channel_name || '',
      channel_id:   task.channel_id || '',
      milestone:    task.milestone || '',
      description:  task.description || '',
      action,
    };
    console.log(`notifySlackWebhook [${action}] task #${task.id}: ${task.title}`);
    const resp = await fetch(SLACK_TASKS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    console.log(`webhook response [${resp.status}]:`, text);
  } catch (e) { console.warn('notifySlackWebhook:', e.message); }
}

// Keep these as aliases so all existing call sites still work
const addTaskToSlackList    = task => notifySlackWebhook(task, 'created');
const updateTaskInSlackList = task => notifySlackWebhook(task, 'updated');
const removeTaskFromSlackList = task => notifySlackWebhook(task, 'deleted');

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function isChief(client, userId) {
  try {
    const res = await client.conversations.members({ channel: CHIEFS_CHANNEL_ID });
    return res.members.includes(userId);
  } catch { return false; }
}

function priorityEmoji(p) { return { high: '🔴', medium: '🟡', low: '🟢' }[p] ?? '⚪'; }

function statusLabel(s) {
  return { todo: '⏳ To Do', in_progress: '▶️ In Progress', done: '✅ Done' }[s] ?? '⏳ To Do';
}

function buildTaskBlocks(task) {
  return [
    { type: 'header', text: { type: 'plain_text', text: '📋 New Task Assigned to Your Channel' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${task.title}*\n${task.description || '_No description provided._'}` } },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*👤 Assignee:*\n<@${task.assignee_id}>` },
        { type: 'mrkdwn', text: `*📅 Due Date:*\n${task.due_date}` },
        { type: 'mrkdwn', text: `*${priorityEmoji(task.priority)} Priority:*\n${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}` },
        { type: 'mrkdwn', text: `*🏁 Milestone:*\n${task.milestone || 'N/A'}` },
        { type: 'mrkdwn', text: `*📊 Status:*\n${statusLabel(task.status)}` },
        { type: 'mrkdwn', text: `*🆔 Task ID:*\n\`#${task.id}\`` },
      ],
    },
    { type: 'divider' },
    {
      type: 'actions',
      block_id: `task_actions_${task.id}`,
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '▶️ Start Progress' }, value: String(task.id), action_id: 'status_in_progress', style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: '✅ Mark Done' },      value: String(task.id), action_id: 'status_done',        style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: '🔄 Reset to To Do' }, value: String(task.id), action_id: 'status_todo' },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Created by <@${task.created_by}> · Use \`/task-list\` to see all your channel tasks` }] },
  ];
}

// ─── /task-create ─────────────────────────────────────────────────────────────
app.command('/task-create', async ({ command, ack, client, respond }) => {
  await ack();
  const chief = await isChief(client, command.user_id);
  if (!chief) { await respond({ response_type: 'ephemeral', text: '🚫 Only *chiefs channel* members can create tasks.' }); return; }

  const { channels } = await client.conversations.list({ types: 'public_channel,private_channel', limit: 200 });
  const channelOptions = channels
    .filter(ch => ch.id !== CHIEFS_CHANNEL_ID && !ch.is_archived)
    .map(ch => ({ text: { type: 'plain_text', text: `#${ch.name}` }, value: ch.id }));

  await client.views.open({
    trigger_id: command.trigger_id,
    view: {
      type: 'modal', callback_id: 'create_task_modal',
      title: { type: 'plain_text', text: '📋 Create New Task' },
      submit: { type: 'plain_text', text: '✅ Create Task' },
      close:  { type: 'plain_text', text: 'Cancel' },
      blocks: [
        { type: 'input', block_id: 'task_title', label: { type: 'plain_text', text: '📝 Task Title' }, element: { type: 'plain_text_input', action_id: 'title_input', placeholder: { type: 'plain_text', text: 'e.g. Create Q2 marketing report...' }, max_length: 150 } },
        { type: 'input', block_id: 'task_description', label: { type: 'plain_text', text: '📄 Description' }, optional: true, element: { type: 'plain_text_input', action_id: 'description_input', multiline: true, placeholder: { type: 'plain_text', text: 'Describe what needs to be done...' }, max_length: 1000 } },
        { type: 'input', block_id: 'assigned_channel', label: { type: 'plain_text', text: '📢 Assign to Channel' }, element: { type: 'static_select', action_id: 'channel_select', placeholder: { type: 'plain_text', text: 'Select target channel...' }, options: channelOptions.length > 0 ? channelOptions : [{ text: { type: 'plain_text', text: 'No channels found' }, value: 'none' }] } },
        { type: 'input', block_id: 'assignee', label: { type: 'plain_text', text: '👤 Assignee' }, element: { type: 'users_select', action_id: 'user_select', placeholder: { type: 'plain_text', text: 'Select team member...' } } },
        { type: 'input', block_id: 'due_date', label: { type: 'plain_text', text: '📅 Due Date' }, element: { type: 'datepicker', action_id: 'date_input', placeholder: { type: 'plain_text', text: 'Pick a due date' } } },
        { type: 'input', block_id: 'priority', label: { type: 'plain_text', text: '🚦 Priority' }, element: { type: 'static_select', action_id: 'priority_select', initial_option: { text: { type: 'plain_text', text: '🟡 Medium' }, value: 'medium' }, options: [{ text: { type: 'plain_text', text: '🔴 High' }, value: 'high' }, { text: { type: 'plain_text', text: '🟡 Medium' }, value: 'medium' }, { text: { type: 'plain_text', text: '🟢 Low' }, value: 'low' }] } },
        { type: 'input', block_id: 'milestone', label: { type: 'plain_text', text: '🏁 Milestone' }, optional: true, element: { type: 'plain_text_input', action_id: 'milestone_input', placeholder: { type: 'plain_text', text: 'e.g. Q2 Launch, Phase 1, Sprint 3...' }, max_length: 100 } },
      ],
    },
  });
});

// ─── Modal Submission ─────────────────────────────────────────────────────────
app.view('create_task_modal', async ({ ack, body, view, client }) => {
  await ack();
  const v = view.state.values;
  const title       = v.task_title.title_input.value;
  const description = v.task_description.description_input.value ?? '';
  const channelOpt  = v.assigned_channel.channel_select.selected_option;
  const channelId   = channelOpt.value;
  const channelName = channelOpt.text.text;
  const assigneeId  = v.assignee.user_select.selected_user;
  const dueDate     = v.due_date.date_input.selected_date;
  const priority    = v.priority.priority_select.selected_option.value;
  const milestone   = v.milestone.milestone_input.value ?? '';
  const createdBy   = body.user.id;
  if (channelId === 'none') return;

  const { data: task, error } = await supabase.from('tasks')
    .insert({ title, description, channel_id: channelId, channel_name: channelName, assignee_id: assigneeId, due_date: dueDate, priority, milestone, created_by: createdBy, status: 'todo' })
    .select().single();
  if (error) { console.error('Supabase insert error:', error); return; }

  // Add to Slack Lists (best-effort, non-blocking)
  addTaskToSlackList(task).catch(() => {});

  await client.chat.postMessage({ channel: channelId, text: `📋 New task assigned: ${title}`, blocks: buildTaskBlocks(task) });
  try {
    await client.chat.postMessage({ channel: assigneeId, text: `You've been assigned a task: *${title}*`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `👋 Hey! You've been assigned a new task by <@${createdBy}>.\n\n*${title}*\n${description ? `>${description}\n` : ''}\n*${priorityEmoji(priority)} Priority:* ${priority} · *📅 Due:* ${dueDate}${milestone ? ` · *🏁 Milestone:* ${milestone}` : ''}\n\n👉 Check <#${channelId}> to update the task status.` } }] });
  } catch (dmErr) { console.warn('DM to assignee failed:', dmErr.message); }
  await client.chat.postMessage({ channel: CHIEFS_CHANNEL_ID, text: `✅ Task created: ${title}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ Task *#${task.id}* created!\n*${title}* → <@${assigneeId}> in ${channelName}\n${priorityEmoji(priority)} ${priority} · Due: ${dueDate}${milestone ? ` · 🏁 ${milestone}` : ''}` } }] });
});

// ─── Status Actions ───────────────────────────────────────────────────────────
async function handleStatusUpdate(ack, body, action, client, newStatus) {
  await ack();
  const taskId = parseInt(action.value, 10);
  const { data: task } = await supabase.from('tasks').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', taskId).select().single();
  if (!task) return;

  updateTaskInSlackList(task).catch(() => {});

  const updatedBlocks = body.message.blocks.map(block => {
    if (block.type === 'section' && Array.isArray(block.fields)) {
      return { ...block, fields: block.fields.map(f => f.text?.includes('*📊 Status:*') ? { ...f, text: `*📊 Status:*\n${statusLabel(newStatus)}` } : f) };
    }
    return block;
  });
  await client.chat.update({ channel: body.channel.id, ts: body.message.ts, blocks: updatedBlocks, text: body.message.text });
  await client.chat.postMessage({ channel: CHIEFS_CHANNEL_ID, text: `Task #${taskId} status updated`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `📊 Task *#${taskId}* — *${task.title}*\nStatus → *${statusLabel(newStatus)}* by <@${body.user.id}> in <#${body.channel.id}>` } }] });
}

app.action('status_in_progress', p => handleStatusUpdate(p.ack, p.body, p.action, p.client, 'in_progress'));
app.action('status_done',        p => handleStatusUpdate(p.ack, p.body, p.action, p.client, 'done'));
app.action('status_todo',        p => handleStatusUpdate(p.ack, p.body, p.action, p.client, 'todo'));

// ─── /task-list ───────────────────────────────────────────────────────────────
app.command('/task-list', async ({ command, ack, client, respond }) => {
  await ack();
  const channelId = command.channel_id;
  const chief = await isChief(client, command.user_id);
  let query = supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(20);
  if (!chief) query = query.eq('channel_id', channelId);
  const { data: tasks, error } = await query;
  if (error || !tasks || tasks.length === 0) {
    await respond({ response_type: 'ephemeral', text: chief ? '📭 No tasks yet. Use `/task-create`.' : '📭 No tasks in this channel yet.' });
    return;
  }
  const grouped = { todo: [], in_progress: [], done: [] };
  tasks.forEach(t => grouped[t.status]?.push(t));
  const line = t => `${priorityEmoji(t.priority)} *${t.title}* — <@${t.assignee_id}> · Due: \`${t.due_date}\`${t.milestone ? ` · 🏁 ${t.milestone}` : ''}${chief ? ` · <#${t.channel_id}>` : ''}`;
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: chief ? '📊 All Tasks (Chiefs View)' : '📋 Tasks in This Channel' } }];
  if (grouped.todo.length)        { blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*⏳ To Do (${grouped.todo.length})*` } }); grouped.todo.forEach(t => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• ${line(t)}` } })); blocks.push({ type: 'divider' }); }
  if (grouped.in_progress.length) { blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*▶️ In Progress (${grouped.in_progress.length})*` } }); grouped.in_progress.forEach(t => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• ${line(t)}` } })); blocks.push({ type: 'divider' }); }
  if (grouped.done.length)        { blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*✅ Done (${grouped.done.length})*` } }); grouped.done.forEach(t => blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• ${line(t)}` } })); }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Showing ${tasks.length} task(s)` }] });
  await respond({ response_type: 'ephemeral', blocks });
});

// ─── /task-delete ─────────────────────────────────────────────────────────────
app.command('/task-delete', async ({ command, ack, client, respond }) => {
  await ack();
  if (!await isChief(client, command.user_id)) { await respond({ response_type: 'ephemeral', text: '🚫 Only chiefs can delete tasks.' }); return; }
  const taskId = parseInt(command.text.trim(), 10);
  if (!taskId) { await respond({ response_type: 'ephemeral', text: '⚠️ Usage: `/task-delete <task_id>`' }); return; }
  const { data: taskToDelete } = await supabase.from('tasks').select('*').eq('id', taskId).single();
  if (taskToDelete) await removeTaskFromSlackList(taskToDelete).catch(() => {});
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  await respond({ response_type: 'ephemeral', text: error ? `❌ Failed to delete task #${taskId}.` : `🗑️ Task *#${taskId}* deleted.` });
});

// ─── /task-stats ──────────────────────────────────────────────────────────────
app.command('/task-stats', async ({ command, ack, client, respond }) => {
  await ack();
  if (!await isChief(client, command.user_id)) { await respond({ response_type: 'ephemeral', text: '🚫 Only chiefs can view stats.' }); return; }
  const { data: tasks } = await supabase.from('tasks').select('*');
  if (!tasks || tasks.length === 0) { await respond({ response_type: 'ephemeral', text: '📭 No tasks yet.' }); return; }
  const total = tasks.length, done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length, todo = tasks.filter(t => t.status === 'todo').length;
  const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done').length;
  const byChannel = {};
  tasks.forEach(t => { byChannel[t.channel_name] = (byChannel[t.channel_name] || 0) + 1; });
  await respond({ response_type: 'ephemeral', blocks: [
    { type: 'header', text: { type: 'plain_text', text: '📈 Task Statistics' } },
    { type: 'section', fields: [{ type: 'mrkdwn', text: `*📦 Total:*\n${total}` }, { type: 'mrkdwn', text: `*✅ Done:*\n${done} (${Math.round((done/total)*100)}%)` }, { type: 'mrkdwn', text: `*▶️ In Progress:*\n${inProgress}` }, { type: 'mrkdwn', text: `*⏳ To Do:*\n${todo}` }, { type: 'mrkdwn', text: `*🔴 High Priority (open):*\n${highPriority}` }] },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: `*📢 By Channel:*\n${Object.entries(byChannel).map(([ch, c]) => `${ch}: ${c}`).join(' · ')}` } },
  ]});
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Admin Dashboard API ──────────────────────────────────────────────────────
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

// ── Slack data ────────────────────────────────────────────────────────────────
receiver.router.get('/api/dashboard/users', requireAuth, async (_req, res) => {
  try { res.json(await getSlackUsers()); } catch (e) { res.status(500).json({ error: e.message }); }
});
receiver.router.get('/api/dashboard/channels', requireAuth, async (_req, res) => {
  try { res.json(await getSlackChannels()); } catch (e) { res.status(500).json({ error: e.message }); }
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
    if (!tasks || tasks.length === 0) return res.json({ total: 0, done: 0, inProgress: 0, todo: 0, highPriority: 0, overdue: 0, byChannel: {}, byPriority: { high: 0, medium: 0, low: 0 }, completionRate: 0 });
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
    res.json({ total, done, inProgress, todo, highPriority, overdue, byChannel, byPriority, completionRate: Math.round((done / total) * 100) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/dashboard/tasks/sync-lists', requireAuth, async (_req, res) => {
  try {
    const { data: tasks, error } = await supabase.from('tasks').select('*').or('slack_list_record_id.is.null,slack_list_record_id.eq.');
    if (error) throw error;
    res.json({ queued: tasks.length, message: `Syncing ${tasks.length} tasks to Slack Lists in the background...` });
    // Run sync after responding so the request doesn't time out
    (async () => {
      let synced = 0, failed = 0;
      for (const task of tasks) {
        try { await addTaskToSlackList(task); synced++; } catch { failed++; }
        await new Promise(r => setTimeout(r, 300)); // avoid rate limits
      }
      console.log(`Slack Lists backfill complete: ${synced} synced, ${failed} failed`);
    })();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/dashboard/tasks', requireAuth, express.json(), async (req, res) => {
  const { title, description, channel_id, channel_name, assignee_id, due_date, priority, milestone } = req.body;
  if (!title || !channel_id || !channel_name || !assignee_id || !due_date || !priority)
    return res.status(400).json({ error: 'Missing required fields: title, channel_id, channel_name, assignee_id, due_date, priority' });
  const { data: task, error } = await supabase.from('tasks')
    .insert({ title, description: description || '', channel_id, channel_name, assignee_id, due_date, priority, milestone: milestone || '', created_by: 'dashboard', status: 'todo' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  // Best-effort Slack notifications and Lists sync
  addTaskToSlackList(task).catch(() => {});
  try {
    await slackClient.chat.postMessage({ channel: channel_id, text: `📋 New task: ${title}`, blocks: buildTaskBlocks(task) });
    await slackClient.chat.postMessage({ channel: CHIEFS_CHANNEL_ID, text: `✅ Task #${task.id} created via dashboard: ${title}` });
  } catch (e) { console.warn('Slack notify failed:', e.message); }
  res.json(task);
});

receiver.router.put('/api/dashboard/tasks/:id', requireAuth, express.json(), async (req, res) => {
  const { data, error } = await supabase.from('tasks').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  updateTaskInSlackList(data).catch(() => {});
  res.json(data);
});

receiver.router.delete('/api/dashboard/tasks/:id', requireAuth, async (req, res) => {
  const { data: taskToRemove } = await supabase.from('tasks').select('*').eq('id', req.params.id).single();
  if (taskToRemove) await removeTaskFromSlackList(taskToRemove).catch(() => {});
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
  const channels = await getSlackChannels();
  const channelMap = {};
  channels.forEach(c => { channelMap[c.name] = c.id; channelMap[c.name.replace('#', '')] = c.id; });

  const inserts = [], errors = [];
  rows.forEach((row, i) => {
    const chId = channelMap[row.channel_name] || channelMap['#' + row.channel_name] || row.channel_id;
    if (!row.title || !chId || !row.assignee_id || !row.due_date) {
      errors.push(`Row ${i + 2}: missing required fields (title, channel_name, assignee_id, due_date)`); return;
    }
    const chName = row.channel_name.startsWith('#') ? row.channel_name : '#' + row.channel_name;
    inserts.push({ title: row.title, description: row.description || '', channel_id: chId, channel_name: chName, assignee_id: row.assignee_id, due_date: normalizeDate(row.due_date), priority: ['high', 'medium', 'low'].includes(row.priority) ? row.priority : 'medium', milestone: row.milestone || '', created_by: 'dashboard_bulk', status: row.status && ['todo','in_progress','done'].includes(row.status) ? row.status : 'todo' });
  });

  if (inserts.length) {
    const { data, error } = await supabase.from('tasks').insert(inserts).select();
    if (error) return res.status(500).json({ error: error.message });
    // Sync all inserted tasks to Slack Lists (best-effort)
    for (const task of data) { addTaskToSlackList(task).catch(() => {}); }
    return res.json({ inserted: data.length, errors });
  }
  res.json({ inserted: 0, errors });
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
  const { data, error } = await supabase.from('requests')
    .update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
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
  if (!req.query.code) return res.status(400).send('No code provided');
  try {
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: req.query.code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${base}/api/email/callback`, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error(tokens.error_description || 'No access token');
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileRes.json();
    gmailTokens = { ...tokens, email: profile.email, name: profile.name, expiry_date: Date.now() + ((tokens.expires_in || 3600) * 1000) };
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

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️  MotoLinker Task Bot running on port ${port}`);
  console.log(`📊  Admin dashboard → http://localhost:${port}/dashboard`);
  if (!ADMIN_PASSWORD) console.warn('⚠️   ADMIN_PASSWORD is not set — dashboard login will fail!');
})();
