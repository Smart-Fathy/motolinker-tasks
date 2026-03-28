const { App, ExpressReceiver, LogLevel } = require('@slack/bolt');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// ─── App Init ────────────────────────────────────────────────────────────────
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  logLevel: LogLevel.INFO,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CHIEFS_CHANNEL_ID = process.env.CHIEFS_CHANNEL_ID;

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function isChief(client, userId) {
  try {
    const res = await client.conversations.members({ channel: CHIEFS_CHANNEL_ID });
    return res.members.includes(userId);
  } catch {
    return false;
  }
}

function priorityEmoji(p) {
  return { high: '🔴', medium: '🟡', low: '🟢' }[p] ?? '⚪';
}

function statusLabel(s) {
  return {
    todo: '⏳ To Do',
    in_progress: '▶️ In Progress',
    done: '✅ Done',
  }[s] ?? '⏳ To Do';
}

function buildTaskBlocks(task) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📋 New Task Assigned to Your Channel' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${task.title}*\n${task.description || '_No description provided._'}`,
      },
    },
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
        {
          type: 'button',
          text: { type: 'plain_text', text: '▶️ Start Progress' },
          value: String(task.id),
          action_id: 'status_in_progress',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Mark Done' },
          value: String(task.id),
          action_id: 'status_done',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔄 Reset to To Do' },
          value: String(task.id),
          action_id: 'status_todo',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Created by <@${task.created_by}> · Use \`/task-list\` to see all your channel tasks`,
        },
      ],
    },
  ];
}

// ─── /task-create ─────────────────────────────────────────────────────────────
app.command('/task-create', async ({ command, ack, client, respond }) => {
  await ack();

  const chief = await isChief(client, command.user_id);
  if (!chief) {
    await respond({
      response_type: 'ephemeral',
      text: '🚫 Only *chiefs channel* members can create tasks.',
    });
    return;
  }

  // Fetch available channels (exclude chiefs)
  const { channels } = await client.conversations.list({
    types: 'public_channel,private_channel',
    limit: 200,
  });

  const channelOptions = channels
    .filter((ch) => ch.id !== CHIEFS_CHANNEL_ID && !ch.is_archived)
    .map((ch) => ({
      text: { type: 'plain_text', text: `#${ch.name}` },
      value: ch.id,
    }));

  await client.views.open({
    trigger_id: command.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'create_task_modal',
      title: { type: 'plain_text', text: '📋 Create New Task' },
      submit: { type: 'plain_text', text: '✅ Create Task' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        // Title
        {
          type: 'input',
          block_id: 'task_title',
          label: { type: 'plain_text', text: '📝 Task Title' },
          element: {
            type: 'plain_text_input',
            action_id: 'title_input',
            placeholder: { type: 'plain_text', text: 'e.g. Create Q2 marketing report...' },
            max_length: 150,
          },
        },
        // Description
        {
          type: 'input',
          block_id: 'task_description',
          label: { type: 'plain_text', text: '📄 Description' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Describe what needs to be done...' },
            max_length: 1000,
          },
        },
        // Assign to Channel
        {
          type: 'input',
          block_id: 'assigned_channel',
          label: { type: 'plain_text', text: '📢 Assign to Channel' },
          element: {
            type: 'static_select',
            action_id: 'channel_select',
            placeholder: { type: 'plain_text', text: 'Select target channel...' },
            options: channelOptions.length > 0 ? channelOptions : [
              { text: { type: 'plain_text', text: 'No channels found' }, value: 'none' },
            ],
          },
        },
        // Assignee User
        {
          type: 'input',
          block_id: 'assignee',
          label: { type: 'plain_text', text: '👤 Assignee' },
          element: {
            type: 'users_select',
            action_id: 'user_select',
            placeholder: { type: 'plain_text', text: 'Select team member...' },
          },
        },
        // Due Date
        {
          type: 'input',
          block_id: 'due_date',
          label: { type: 'plain_text', text: '📅 Due Date' },
          element: {
            type: 'datepicker',
            action_id: 'date_input',
            placeholder: { type: 'plain_text', text: 'Pick a due date' },
          },
        },
        // Priority
        {
          type: 'input',
          block_id: 'priority',
          label: { type: 'plain_text', text: '🚦 Priority' },
          element: {
            type: 'static_select',
            action_id: 'priority_select',
            initial_option: { text: { type: 'plain_text', text: '🟡 Medium' }, value: 'medium' },
            options: [
              { text: { type: 'plain_text', text: '🔴 High' }, value: 'high' },
              { text: { type: 'plain_text', text: '🟡 Medium' }, value: 'medium' },
              { text: { type: 'plain_text', text: '🟢 Low' }, value: 'low' },
            ],
          },
        },
        // Milestone
        {
          type: 'input',
          block_id: 'milestone',
          label: { type: 'plain_text', text: '🏁 Milestone' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'milestone_input',
            placeholder: { type: 'plain_text', text: 'e.g. Q2 Launch, Phase 1, Sprint 3...' },
            max_length: 100,
          },
        },
      ],
    },
  });
});

// ─── Modal Submission ─────────────────────────────────────────────────────────
app.view('create_task_modal', async ({ ack, body, view, client }) => {
  await ack();

  const v = view.state.values;
  const title = v.task_title.title_input.value;
  const description = v.task_description.description_input.value ?? '';
  const channelOption = v.assigned_channel.channel_select.selected_option;
  const channelId = channelOption.value;
  const channelName = channelOption.text.text;
  const assigneeId = v.assignee.user_select.selected_user;
  const dueDate = v.due_date.date_input.selected_date;
  const priority = v.priority.priority_select.selected_option.value;
  const milestone = v.milestone.milestone_input.value ?? '';
  const createdBy = body.user.id;

  if (channelId === 'none') return;

  // ── Save to Supabase ──
  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title,
      description,
      channel_id: channelId,
      channel_name: channelName,
      assignee_id: assigneeId,
      due_date: dueDate,
      priority,
      milestone,
      created_by: createdBy,
      status: 'todo',
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error:', error);
    return;
  }

  // ── Post to assigned channel ──
  await client.chat.postMessage({
    channel: channelId,
    text: `📋 New task assigned: ${title}`,
    blocks: buildTaskBlocks(task),
  });

  // ── DM the assignee ──
  try {
    await client.chat.postMessage({
      channel: assigneeId,
      text: `You've been assigned a task: *${title}*`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `👋 Hey! You've been assigned a new task by <@${createdBy}>.\n\n*${title}*\n${description ? `>${description}\n` : ''}\n*${priorityEmoji(priority)} Priority:* ${priority} · *📅 Due:* ${dueDate}${milestone ? ` · *🏁 Milestone:* ${milestone}` : ''}\n\n👉 Check <#${channelId}> to update the task status.`,
          },
        },
      ],
    });
  } catch (dmErr) {
    console.warn('DM to assignee failed (may not be in workspace):', dmErr.message);
  }

  // ── Notify chiefs channel ──
  await client.chat.postMessage({
    channel: CHIEFS_CHANNEL_ID,
    text: `✅ Task created: ${title}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ Task *#${task.id}* created successfully!\n*${title}* → assigned to <@${assigneeId}> in ${channelName}\n${priorityEmoji(priority)} ${priority} priority · Due: ${dueDate}${milestone ? ` · 🏁 ${milestone}` : ''}`,
        },
      },
    ],
  });
});

// ─── Status Update Actions ────────────────────────────────────────────────────
async function handleStatusUpdate(ack, body, action, client, newStatus) {
  await ack();

  const taskId = parseInt(action.value, 10);

  const { data: task } = await supabase
    .from('tasks')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .select()
    .single();

  if (!task) return;

  // Update the original message
  const updatedBlocks = body.message.blocks.map((block) => {
    if (block.type === 'section' && Array.isArray(block.fields)) {
      return {
        ...block,
        fields: block.fields.map((field) =>
          field.text?.includes('*📊 Status:*')
            ? { ...field, text: `*📊 Status:*\n${statusLabel(newStatus)}` }
            : field
        ),
      };
    }
    return block;
  });

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    blocks: updatedBlocks,
    text: body.message.text,
  });

  // Notify chiefs of status change
  const updaterName = body.user.id;
  await client.chat.postMessage({
    channel: CHIEFS_CHANNEL_ID,
    text: `Task #${taskId} status updated`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📊 Task *#${taskId}* — *${task.title}*\nStatus updated to *${statusLabel(newStatus)}* by <@${updaterName}> in <#${body.channel.id}>`,
        },
      },
    ],
  });
}

app.action('status_in_progress', (p) =>
  handleStatusUpdate(p.ack, p.body, p.action, p.client, 'in_progress')
);
app.action('status_done', (p) =>
  handleStatusUpdate(p.ack, p.body, p.action, p.client, 'done')
);
app.action('status_todo', (p) =>
  handleStatusUpdate(p.ack, p.body, p.action, p.client, 'todo')
);

// ─── /task-list ───────────────────────────────────────────────────────────────
app.command('/task-list', async ({ command, ack, client, respond }) => {
  await ack();

  const channelId = command.channel_id;
  const chief = await isChief(client, command.user_id);

  let query = supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!chief) {
    query = query.eq('channel_id', channelId);
  }

  const { data: tasks, error } = await query;

  if (error || !tasks || tasks.length === 0) {
    await respond({
      response_type: 'ephemeral',
      text: chief
        ? '📭 No tasks created yet. Use `/task-create` to add one.'
        : '📭 No tasks assigned to this channel yet.',
    });
    return;
  }

  // Group by status
  const grouped = { todo: [], in_progress: [], done: [] };
  tasks.forEach((t) => grouped[t.status]?.push(t));

  const makeTaskLine = (t) =>
    `${priorityEmoji(t.priority)} *${t.title}* — <@${t.assignee_id}> · Due: \`${t.due_date}\`${t.milestone ? ` · 🏁 ${t.milestone}` : ''}${chief ? ` · <#${t.channel_id}>` : ''}`;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: chief ? '📊 All Tasks Overview (Chiefs View)' : '📋 Tasks in This Channel',
      },
    },
  ];

  if (grouped.todo.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*⏳ To Do (${grouped.todo.length})*` } });
    grouped.todo.forEach((t) =>
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• ${makeTaskLine(t)}` } })
    );
    blocks.push({ type: 'divider' });
  }

  if (grouped.in_progress.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*▶️ In Progress (${grouped.in_progress.length})*` } });
    grouped.in_progress.forEach((t) =>
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• ${makeTaskLine(t)}` } })
    );
    blocks.push({ type: 'divider' });
  }

  if (grouped.done.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*✅ Done (${grouped.done.length})*` } });
    grouped.done.forEach((t) =>
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• ${makeTaskLine(t)}` } })
    );
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `Showing ${tasks.length} task(s) · Use \`/task-create\` to add more` }],
  });

  await respond({ response_type: 'ephemeral', blocks });
});

// ─── /task-delete ─────────────────────────────────────────────────────────────
app.command('/task-delete', async ({ command, ack, client, respond }) => {
  await ack();

  const chief = await isChief(client, command.user_id);
  if (!chief) {
    await respond({ response_type: 'ephemeral', text: '🚫 Only chiefs can delete tasks.' });
    return;
  }

  const taskId = parseInt(command.text.trim(), 10);
  if (!taskId) {
    await respond({ response_type: 'ephemeral', text: '⚠️ Usage: `/task-delete <task_id>`' });
    return;
  }

  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) {
    await respond({ response_type: 'ephemeral', text: `❌ Failed to delete task #${taskId}.` });
    return;
  }

  await respond({ response_type: 'ephemeral', text: `🗑️ Task *#${taskId}* has been deleted.` });
});

// ─── /task-stats ──────────────────────────────────────────────────────────────
app.command('/task-stats', async ({ command, ack, client, respond }) => {
  await ack();

  const chief = await isChief(client, command.user_id);
  if (!chief) {
    await respond({ response_type: 'ephemeral', text: '🚫 Only chiefs can view stats.' });
    return;
  }

  const { data: tasks } = await supabase.from('tasks').select('*');

  if (!tasks || tasks.length === 0) {
    await respond({ response_type: 'ephemeral', text: '📭 No tasks yet.' });
    return;
  }

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const todo = tasks.filter((t) => t.status === 'todo').length;
  const highPriority = tasks.filter((t) => t.priority === 'high' && t.status !== 'done').length;

  // Group by channel
  const byChannel = {};
  tasks.forEach((t) => {
    byChannel[t.channel_name] = (byChannel[t.channel_name] || 0) + 1;
  });

  const channelBreakdown = Object.entries(byChannel)
    .map(([ch, count]) => `${ch}: ${count}`)
    .join(' · ');

  await respond({
    response_type: 'ephemeral',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '📈 Task Statistics' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*📦 Total Tasks:*\n${total}` },
          { type: 'mrkdwn', text: `*✅ Done:*\n${done} (${Math.round((done / total) * 100)}%)` },
          { type: 'mrkdwn', text: `*▶️ In Progress:*\n${inProgress}` },
          { type: 'mrkdwn', text: `*⏳ To Do:*\n${todo}` },
          { type: 'mrkdwn', text: `*🔴 High Priority (open):*\n${highPriority}` },
        ],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*📢 Tasks by Channel:*\n${channelBreakdown}` },
      },
    ],
  });
});

// ─── Admin Dashboard ──────────────────────────────────────────────────────────
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;

function dashboardAuth(req, res, next) {
  if (!DASHBOARD_TOKEN) return next();
  const provided = req.query.token || req.headers['x-dashboard-token'];
  if (provided !== DASHBOARD_TOKEN) {
    return res.status(401).send('Unauthorized — add ?token=<DASHBOARD_TOKEN> to the URL');
  }
  next();
}

receiver.router.get('/', (_req, res) => res.redirect('/dashboard'));

receiver.router.get('/dashboard', dashboardAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

receiver.router.get('/api/dashboard/tasks', dashboardAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

receiver.router.get('/api/dashboard/stats', dashboardAuth, async (_req, res) => {
  try {
    const { data: tasks, error } = await supabase.from('tasks').select('*');
    if (error) throw error;

    if (!tasks || tasks.length === 0) {
      return res.json({
        total: 0, done: 0, inProgress: 0, todo: 0,
        highPriority: 0, overdue: 0,
        byChannel: {}, byPriority: { high: 0, medium: 0, low: 0 },
        completionRate: 0,
      });
    }

    const total      = tasks.length;
    const done       = tasks.filter((t) => t.status === 'done').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const todo       = tasks.filter((t) => t.status === 'todo').length;
    const highPriority = tasks.filter((t) => t.priority === 'high' && t.status !== 'done').length;

    const today  = new Date().toISOString().split('T')[0];
    const overdue = tasks.filter((t) => t.due_date < today && t.status !== 'done').length;

    const byChannel = {};
    tasks.forEach((t) => {
      if (!byChannel[t.channel_name]) {
        byChannel[t.channel_name] = { todo: 0, in_progress: 0, done: 0, total: 0 };
      }
      byChannel[t.channel_name][t.status]++;
      byChannel[t.channel_name].total++;
    });

    const byPriority = { high: 0, medium: 0, low: 0 };
    tasks.forEach((t) => { if (byPriority[t.priority] !== undefined) byPriority[t.priority]++; });

    res.json({
      total, done, inProgress, todo, highPriority, overdue,
      byChannel, byPriority,
      completionRate: Math.round((done / total) * 100),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ MotoLinker Task Bot running on port ${port}`);
  console.log(`📊 Admin dashboard available at http://localhost:${port}/dashboard`);
})();
