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
const sessions         = new Map(); // admin sessions
const employeeSessions = new Map(); // employee portal sessions
let gmailTokens = null;
let driveTokens = null;
const employeeDriveTokens = new Map();
const pendingDriveAuth = new Map();

// Car Sync config (in-memory, survives restarts via env)
let carSyncConfig = {
  sheetId:    process.env.CARSYNC_SHEET_ID    || '',
  wpUrl:      process.env.CARSYNC_WP_URL      || '',
  wpUsername: process.env.CARSYNC_WP_USER     || '',
  wpPassword: process.env.CARSYNC_WP_PASS     || '',
  wpPostType: process.env.CARSYNC_WP_TYPE     || 'listing',
  mapping:    {},   // { wpField: columnIndex }
  lastSync:   null, // { at, created, updated, errors }
};

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

// ─── Pinned Task Board ────────────────────────────────────────────────────────
// One pinned message per channel showing all tasks, auto-updated on any change.
const taskBoardCache = new Map(); // channelId → message ts

async function buildTaskBoardBlocks(channelId, channelName) {
  const { data: tasks } = await supabase.from('tasks').select('*')
    .eq('channel_id', channelId)
    .order('due_date', { ascending: true });
  if (!tasks || tasks.length === 0) return null;

  const users = await getSlackUsers().catch(() => ({}));
  const grouped = { todo: [], in_progress: [], done: [] };
  tasks.forEach(t => { if (grouped[t.status]) grouped[t.status].push(t); });

  const line = t => {
    const name = users[t.assignee_id]?.displayName || users[t.assignee_id]?.name || t.assignee_id;
    return `${priorityEmoji(t.priority)} *${t.title}* — ${name} · Due \`${t.due_date}\`${t.milestone ? ` · 🏁 ${t.milestone}` : ''}`;
  };

  const updated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📋 Task Board — ${channelName}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${tasks.length} task(s) total · Last updated ${updated}` }] },
    { type: 'divider' },
  ];

  if (grouped.todo.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*⏳ To Do (${grouped.todo.length})*\n${grouped.todo.map(t => `• ${line(t)}`).join('\n')}` } });
    blocks.push({ type: 'divider' });
  }
  if (grouped.in_progress.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*▶️ In Progress (${grouped.in_progress.length})*\n${grouped.in_progress.map(t => `• ${line(t)}`).join('\n')}` } });
    blocks.push({ type: 'divider' });
  }
  if (grouped.done.length) {
    const doneList = grouped.done.slice(0, 5).map(t => `• ✅ ~~${t.title}~~`).join('\n');
    const extra = grouped.done.length > 5 ? `\n_…and ${grouped.done.length - 5} more_` : '';
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*✅ Done (${grouped.done.length})*\n${doneList}${extra}` } });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    block_id: `board_actions_${channelId}`,
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: '🔄 Update a Task' },
      value: channelId,
      action_id: 'update_task_button',
      style: 'primary',
    }],
  });

  return blocks;
}

async function updateChannelTaskBoard(channelId, channelName) {
  try {
    const blocks = await buildTaskBoardBlocks(channelId, channelName);
    if (!blocks) return;
    const text = `📋 Task Board — ${channelName}`;

    if (taskBoardCache.has(channelId)) {
      await slackClient.chat.update({ channel: channelId, ts: taskBoardCache.get(channelId), blocks, text });
    } else {
      const result = await slackClient.chat.postMessage({ channel: channelId, text, blocks });
      if (result.ok && result.ts) {
        taskBoardCache.set(channelId, result.ts);
        try { await slackClient.pins.add({ channel: channelId, timestamp: result.ts }); } catch (_) {}
      }
    }
  } catch (e) { console.warn(`updateChannelTaskBoard ${channelName}:`, e.message); }
}

const addTaskToSlackList     = task => updateChannelTaskBoard(task.channel_id, task.channel_name);
const updateTaskInSlackList  = task => updateChannelTaskBoard(task.channel_id, task.channel_name);
const removeTaskFromSlackList = task => updateChannelTaskBoard(task.channel_id, task.channel_name);

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
  const completedAt = newStatus === 'done' ? new Date().toISOString() : null;
  const { data: task } = await supabase.from('tasks').update({ status: newStatus, completed_at: completedAt, updated_at: new Date().toISOString() }).eq('id', taskId).select().single();
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

// ─── Task Board — Update a Task button ───────────────────────────────────────
app.action('update_task_button', async ({ ack, body, action, client }) => {
  await ack();
  const channelId = action.value;
  const userId    = body.user.id;

  // Show the user's own tasks first, fall back to all non-done channel tasks
  const { data: all } = await supabase.from('tasks').select('*')
    .eq('channel_id', channelId).neq('status', 'done').order('due_date', { ascending: true });
  if (!all || all.length === 0) return; // nothing to update

  const mine  = all.filter(t => t.assignee_id === userId);
  const tasks = mine.length > 0 ? mine : all;

  const taskOptions = tasks.map(t => ({
    text:  { type: 'plain_text', text: `${priorityEmoji(t.priority)} ${t.title.substring(0, 74)}` },
    value: String(t.id),
  }));

  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal', callback_id: 'update_task_modal',
      private_metadata: channelId,
      title:  { type: 'plain_text', text: '🔄 Update Task Status' },
      submit: { type: 'plain_text', text: 'Update' },
      close:  { type: 'plain_text', text: 'Cancel' },
      blocks: [
        { type: 'input', block_id: 'task_select', label: { type: 'plain_text', text: 'Task' },
          element: { type: 'static_select', action_id: 'task_input',
            placeholder: { type: 'plain_text', text: 'Choose a task…' }, options: taskOptions } },
        { type: 'input', block_id: 'status_select', label: { type: 'plain_text', text: 'New Status' },
          element: { type: 'static_select', action_id: 'status_input', options: [
            { text: { type: 'plain_text', text: '⏳ To Do'        }, value: 'todo'        },
            { text: { type: 'plain_text', text: '▶️ In Progress'  }, value: 'in_progress' },
            { text: { type: 'plain_text', text: '✅ Done'         }, value: 'done'        },
          ]}},
      ],
    },
  });
});

app.view('update_task_modal', async ({ ack, body, view, client }) => {
  await ack();
  const channelId = view.private_metadata;
  const taskId    = parseInt(view.state.values.task_select.task_input.selected_option.value, 10);
  const newStatus = view.state.values.status_select.status_input.selected_option.value;

  const completedAt2 = newStatus === 'done' ? new Date().toISOString() : null;
  const { data: task } = await supabase.from('tasks')
    .update({ status: newStatus, completed_at: completedAt2, updated_at: new Date().toISOString() })
    .eq('id', taskId).select().single();
  if (!task) return;

  // Refresh the pinned task board
  await updateChannelTaskBoard(channelId, task.channel_name);

  // Notify chiefs
  try {
    await client.chat.postMessage({ channel: CHIEFS_CHANNEL_ID, text: `Task #${taskId} updated`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn',
        text: `📊 Task *#${taskId}* — *${task.title}*\nStatus → *${statusLabel(newStatus)}* by <@${body.user.id}> in <#${channelId}>` } }] });
  } catch (e) { console.warn('Chiefs notify failed:', e.message); }
});

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
    const { data: tasks, error } = await supabase.from('tasks').select('channel_id, channel_name');
    if (error) throw error;
    // Deduplicate channels
    const channels = {};
    tasks.forEach(t => { channels[t.channel_id] = t.channel_name; });
    const channelList = Object.entries(channels);
    res.json({ queued: channelList.length, message: `Posting task boards to ${channelList.length} channel(s) in Slack...` });
    (async () => {
      for (const [channelId, channelName] of channelList) {
        await updateChannelTaskBoard(channelId, channelName);
        await new Promise(r => setTimeout(r, 800));
      }
      console.log(`Task board sync complete: ${channelList.length} channels updated`);
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
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  if (updates.status === 'done' && !updates.completed_at) updates.completed_at = new Date().toISOString();
  if (updates.status && updates.status !== 'done') updates.completed_at = null;
  const { data, error } = await supabase.from('tasks').update(updates).eq('id', req.params.id).select().single();
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
    // Update task board for each affected channel (best-effort)
    const affected = {};
    data.forEach(t => { affected[t.channel_id] = t.channel_name; });
    Object.entries(affected).forEach(([cid, cname]) => updateChannelTaskBoard(cid, cname).catch(() => {}));
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
      if (pending.type === 'employee' && pending.employeeId) {
        employeeDriveTokens.set(pending.employeeId, full);
        return res.redirect('/employee#drive');
      }
      driveTokens = full;
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
    if (refreshed.access_token) gmailTokens = { ...gmailTokens, ...refreshed, expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) };
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

async function getDriveToken(tokens) {
  if (!tokens) throw new Error('Drive not connected');
  if (tokens.refresh_token && Date.now() > (tokens.expiry_date || 0) - 60_000) {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: tokens.refresh_token, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
    const refreshed = await r.json();
    if (refreshed.access_token) Object.assign(tokens, refreshed, { expiry_date: Date.now() + ((refreshed.expires_in || 3600) * 1000) });
  }
  return tokens.access_token;
}

async function listDriveFiles(tokens, mimeType) {
  const token = await getDriveToken(tokens);
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

// ── Car Stock Sync ────────────────────────────────────────────────────────────
async function readSheet(sheetId, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/A1:Z2000`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.values || [];
}

// ── XML-RPC helpers ────────────────────────────────────────────────────────────
function xmlEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function xmlVal(v) {
  if (v === null || v === undefined) return '<string></string>';
  if (typeof v === 'boolean')        return `<boolean>${v ? 1 : 0}</boolean>`;
  if (typeof v === 'number' && Number.isInteger(v)) return `<int>${v}</int>`;
  if (Array.isArray(v))              return `<array><data>${v.map(i => `<value>${xmlVal(i)}</value>`).join('')}</data></array>`;
  if (typeof v === 'object')         return `<struct>${Object.entries(v).map(([k,val]) => `<member><name>${xmlEsc(k)}</name><value>${xmlVal(val)}</value></member>`).join('')}</struct>`;
  return `<string>${xmlEsc(String(v))}</string>`;
}
function xmlCall(method, params) {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${params.map(p => `<param><value>${xmlVal(p)}</value></param>`).join('')}</params></methodCall>`;
}
async function wpXmlRpc(base, method, params) {
  const r = await fetch(`${base}/xmlrpc.php`, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body: xmlCall(method, params) });
  const text = await r.text();
  if (text.includes('<name>faultCode</name>') || text.includes('<name>faultString</name>')) {
    const m = text.match(/<name>faultString<\/name>\s*<value><string>([^<]*)<\/string>/);
    throw new Error(m ? m[1] : 'XML-RPC error');
  }
  return text;
}
function xmlParseInt(text) {
  const m = text.match(/<value><(?:string|int|i4)>(\d+)<\/(?:string|int|i4)><\/value>/);
  return m ? parseInt(m[1]) : null;
}
function xmlParseArray(text) {
  // Minimal: extract all <string> values from an array response
  return [...text.matchAll(/<value><string>([^<]*)<\/string><\/value>/g)].map(m => m[1]);
}

receiver.router.get('/api/carsync/config', requireAuth, (_req, res) => {
  const { lastSync, mapping, sheetId, wpUrl, wpUsername, wpPostType } = carSyncConfig;
  res.json({ sheetId, wpUrl, wpUsername, wpPostType, mapping, lastSync, hasPassword: !!carSyncConfig.wpPassword, driveConnected: !!driveTokens });
});

receiver.router.post('/api/carsync/config', requireAuth, express.json(), (req, res) => {
  const { sheetId, wpUrl, wpUsername, wpPassword, wpPostType, mapping } = req.body;
  if (sheetId    !== undefined) carSyncConfig.sheetId    = sheetId;
  if (wpUrl      !== undefined) carSyncConfig.wpUrl      = wpUrl.replace(/\/$/, '');
  if (wpUsername !== undefined) carSyncConfig.wpUsername = wpUsername;
  if (wpPassword !== undefined) carSyncConfig.wpPassword = wpPassword;
  if (wpPostType !== undefined) carSyncConfig.wpPostType = wpPostType || 'post';
  if (mapping    !== undefined) carSyncConfig.mapping    = mapping;
  res.json({ ok: true });
});

receiver.router.get('/api/carsync/preview', requireAuth, async (_req, res) => {
  try {
    if (!carSyncConfig.sheetId) return res.status(400).json({ error: 'Sheet ID not configured' });
    if (!driveTokens) return res.status(400).json({ error: 'Google Drive not connected' });
    const token = await getDriveToken(driveTokens);
    const rows = await readSheet(carSyncConfig.sheetId, token);
    if (!rows.length) return res.json({ headers: [], rows: [] });
    const [headers, ...data] = rows;
    res.json({ headers, rows: data.slice(0, 8) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

receiver.router.post('/api/carsync/test-wp', requireAuth, express.json(), async (req, res) => {
  const { wpUrl, wpUsername, wpPassword } = req.body;
  if (!wpUrl || !wpUsername || !wpPassword) return res.status(400).json({ error: 'URL, username and password required' });
  try {
    const base = wpUrl.replace(/\/$/, '').replace(/\/wp-admin\/?$/, '');
    await wpXmlRpc(base, 'wp.getProfile', [1, wpUsername, wpPassword]);
    res.json({ ok: true });
  } catch (e) {
    const msg = e.message.toLowerCase();
    if (msg.includes('incorrect') || msg.includes('wrong') || msg.includes('invalid') || msg.includes('login')) {
      res.json({ ok: false, error: 'Invalid credentials — check username and password' });
    } else if (msg.includes('xmlrpc') || msg.includes('405') || msg.includes('disabled')) {
      res.json({ ok: false, error: 'XML-RPC is disabled on this WordPress site. Enable it under Settings → Writing, or use a plugin like "Enable XML-RPC".' });
    } else {
      res.json({ ok: false, error: e.message });
    }
  }
});

receiver.router.post('/api/carsync/run', requireAuth, express.json(), async (req, res) => {
  try {
    const { sheetId, wpUrl, wpUsername, wpPassword, wpPostType, mapping } = carSyncConfig;
    if (!sheetId)    return res.status(400).json({ error: 'Sheet ID not configured' });
    if (!wpUrl)      return res.status(400).json({ error: 'WordPress URL not configured' });
    if (!wpUsername || !wpPassword) return res.status(400).json({ error: 'WordPress credentials not configured' });
    if (!driveTokens) return res.status(400).json({ error: 'Google Drive not connected' });

    const base  = wpUrl.replace(/\/$/, '').replace(/\/wp-admin\/?$/, '');
    const type  = wpPostType || 'listing';
    const token = await getDriveToken(driveTokens);
    const rows  = await readSheet(sheetId, token);
    if (rows.length < 2) return res.json({ created: 0, updated: 0, skipped: 0, errors: [] });

    const [, ...dataRows] = rows;
    const getCol = (row, field) => {
      const idx = mapping[field];
      return (idx !== undefined && idx !== '' && idx !== null) ? (row[idx] || '').toString().trim() : '';
    };

    let created = 0, updated = 0, skipped = 0;
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row   = dataRows[i];
      const title = getCol(row, 'title');
      if (!title) { skipped++; continue; }

      const statusVal = getCol(row, 'status').toLowerCase();
      const wpStatus  = statusVal === 'sold' || statusVal === 'inactive' ? 'draft' : 'publish';

      const customFields = [];
      ['price','make','model','year','mileage','color','vin','stock_number','fuel_type','transmission','body_type'].forEach(f => {
        const v = getCol(row, f);
        if (v) customFields.push({ key: f, value: v });
      });

      const postStruct = {
        post_title:   title,
        post_content: getCol(row, 'description'),
        post_status:  wpStatus,
        post_type:    type,
        custom_fields: customFields,
      };

      // Find existing post by VIN (search via public REST API — no auth required for reads)
      let existingId = null;
      const vin = customFields.find(f => f.key === 'vin')?.value;
      if (vin) {
        try {
          const sr = await fetch(`${base}/wp-json/wp/v2/${type}?search=${encodeURIComponent(vin)}&per_page=1&_fields=id`);
          if (sr.ok) { const sl = await sr.json(); if (Array.isArray(sl) && sl.length) existingId = sl[0].id; }
        } catch (_) {}
      }

      try {
        if (existingId) {
          await wpXmlRpc(base, 'wp.editPost', [1, wpUsername, wpPassword, existingId, postStruct]);
          updated++;
        } else {
          await wpXmlRpc(base, 'wp.newPost', [1, wpUsername, wpPassword, postStruct]);
          created++;
        }
      } catch (e) { errors.push(`Row ${i + 2} (${title}): ${e.message}`); }
    }

    carSyncConfig.lastSync = { at: new Date().toISOString(), created, updated, skipped, errors: errors.slice(0, 20) };
    res.json(carSyncConfig.lastSync);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

receiver.router.get('/api/employee/drive/files',  requireEmployeeAuth, async (req, res) => { try { res.json(await listDriveFiles(employeeDriveTokens.get(req.employee.id))); } catch (e) { res.status(500).json({ error: e.message }); } });
receiver.router.get('/api/employee/drive/sheets', requireEmployeeAuth, async (req, res) => { try { res.json(await listDriveFiles(employeeDriveTokens.get(req.employee.id), 'application/vnd.google-apps.spreadsheet')); } catch (e) { res.status(500).json({ error: e.message }); } });

// ─── Employee Portal ──────────────────────────────────────────────────────────
receiver.router.get('/employee', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'employee.html')));

// Employee Requests
receiver.router.get('/api/employee/requests', requireEmployeeAuth, async (req, res) => {
  const { data, error } = await supabase.from('requests').select('*')
    .eq('created_by', req.employee.username).order('created_at', { ascending: false });
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
  res.json(data);
});

// Employee auth
receiver.router.post('/api/employee/login', express.json(), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const { data: emp } = await supabase.from('employees').select('*').eq('username', username).single();
  if (!emp || !verifyPassword(password, emp.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
  const token = generateToken();
  employeeSessions.set(token, { id: emp.id, name: emp.name, username: emp.username });
  res.json({ token, name: emp.name, username: emp.username, id: emp.id });
});
receiver.router.get('/api/employee/check', requireEmployeeAuth, (req, res) => res.json({ ok: true, ...req.employee }));
receiver.router.post('/api/employee/logout', requireEmployeeAuth, (req, res) => {
  const token = (req.headers['authorization'] || '').slice(7);
  employeeSessions.delete(token);
  res.json({ ok: true });
});

// Employee tasks list (for dropdown — only their assigned, non-done tasks)
receiver.router.get('/api/employee/tasks', requireEmployeeAuth, async (req, res) => {
  try {
    // Get the employee's slack_user_id to match against task assignee_id
    const { data: emp } = await supabase.from('employees').select('slack_user_id').eq('id', req.employee.id).single();
    let query = supabase.from('tasks').select('id, title, channel_name, status').neq('status', 'done').order('created_at', { ascending: false });
    if (emp?.slack_user_id) query = query.eq('assignee_id', emp.slack_user_id);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// All employee tasks (current + completed) for My Tasks page
receiver.router.get('/api/employee/my-tasks', requireEmployeeAuth, async (req, res) => {
  try {
    const { data: emp } = await supabase.from('employees').select('slack_user_id').eq('id', req.employee.id).single();
    if (!emp?.slack_user_id) return res.json([]);
    const { data, error } = await supabase.from('tasks').select('*').eq('assignee_id', emp.slack_user_id).order('due_date', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee marks their own task as done
receiver.router.put('/api/employee/my-tasks/:id', requireEmployeeAuth, express.json(), async (req, res) => {  try {
    const { data: emp } = await supabase.from('employees').select('slack_user_id').eq('id', req.employee.id).single();
    if (!emp?.slack_user_id) return res.status(403).json({ error: 'No Slack user linked to this account' });
    // Verify the task is actually assigned to this employee
    const { data: task } = await supabase.from('tasks').select('id, assignee_id').eq('id', req.params.id).single();
    if (!task || task.assignee_id !== emp.slack_user_id) return res.status(403).json({ error: 'Task not assigned to you' });
    const completedAt = new Date().toISOString();
    const { data, error } = await supabase.from('tasks')
      .update({ status: 'done', completed_at: completedAt, updated_at: completedAt })
      .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Refresh channel task board
    updateChannelTaskBoard(data.channel_id, data.channel_name).catch(() => {});
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Employee channels list (for task creation)
receiver.router.get('/api/employee/channels', requireEmployeeAuth, async (_req, res) => {
  try { res.json(await getSlackChannels()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee creates a new task (assigned to themselves)
receiver.router.post('/api/employee/my-tasks', requireEmployeeAuth, express.json(), async (req, res) => {
  try {
    const { data: emp } = await supabase.from('employees').select('slack_user_id, name').eq('id', req.employee.id).single();
    if (!emp?.slack_user_id) return res.status(403).json({ error: 'No Slack user ID linked to your account. Ask your admin to set it.' });
    const { title, description, channel_id, channel_name, due_date, priority, milestone } = req.body;
    if (!title || !channel_id || !channel_name || !due_date) return res.status(400).json({ error: 'Title, channel and due date are required' });
    const { data: task, error } = await supabase.from('tasks')
      .insert({ title, description: description || '', channel_id, channel_name, assignee_id: emp.slack_user_id, due_date, priority: priority || 'medium', milestone: milestone || '', created_by: req.employee.username, status: 'todo' })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    // Notify channel and update task board
    try {
      await slackClient.chat.postMessage({ channel: channel_id, text: `📋 New task: ${title}`, blocks: buildTaskBlocks(task) });
    } catch (e) { console.warn('Slack notify failed:', e.message); }
    updateChannelTaskBoard(channel_id, channel_name).catch(() => {});
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
  const { data, error } = await supabase.from('employees').select('id, name, username, email, slack_user_id, created_at').order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
receiver.router.post('/api/dashboard/employees', requireAuth, express.json(), async (req, res) => {
  const { name, username, password, email, slack_user_id } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' });
  const { data: existing } = await supabase.from('employees').select('id').eq('username', username).single();
  if (existing) return res.status(409).json({ error: 'Username already taken' });
  const { data, error } = await supabase.from('employees')
    .insert({ name, username, password_hash: hashPassword(password), email: email || '', slack_user_id: slack_user_id || '' })
    .select('id, name, username, email, slack_user_id, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.put('/api/dashboard/employees/:id', requireAuth, express.json(), async (req, res) => {
  const { name, username, password, email, slack_user_id } = req.body;
  const updates = { name, username, email: email || '', slack_user_id: slack_user_id || '', updated_at: new Date().toISOString() };
  if (password) updates.password_hash = hashPassword(password);
  const { data, error } = await supabase.from('employees').update(updates).eq('id', req.params.id)
    .select('id, name, username, email, slack_user_id, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
receiver.router.delete('/api/dashboard/employees/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('employees').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
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
