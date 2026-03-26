# 📋 MotoLinker Task Bot — Setup Guide

A Slack-native task management system. Chiefs assign tasks from the `#cheifs` channel; each team channel only sees tasks assigned to them.

---

## ✨ Features

| Feature | Detail |
|---|---|
| `/task-create` | Chiefs-only — opens a modal to assign tasks to any channel |
| `/task-list` | Shows tasks for the current channel (chiefs see all) |
| `/task-delete <id>` | Chiefs-only — delete a task by ID |
| `/task-stats` | Chiefs-only — full task overview & stats |
| 🔴🟡🟢 Priority | High / Medium / Low |
| 📊 Status buttons | In-message buttons: To Do → In Progress → Done |
| 📢 Channel isolation | Each channel sees only its own tasks |
| 👤 DM notification | Assignee gets a direct message when assigned |
| 🏁 Milestones | Tag tasks to a sprint or project phase |
| 🔔 Chiefs log | Every creation & status change is logged to `#cheifs` |

---

## 🚀 Step 1 — Create a Supabase Database

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Go to **SQL Editor** and paste the contents of `schema.sql` → click **Run**
3. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (secret) → `SUPABASE_SERVICE_KEY`

---

## 🤖 Step 2 — Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From Scratch**
2. Name it `MotoLinker Tasks` and pick your workspace

### OAuth & Permissions
Go to **OAuth & Permissions → Scopes → Bot Token Scopes** and add:

```
channels:read
channels:join
chat:write
chat:write.public
commands
groups:read
im:write
mpim:write
users:read
```

Click **Install to Workspace** → copy the **Bot User OAuth Token** → `SLACK_BOT_TOKEN`

### Signing Secret
Go to **Basic Information** → copy **Signing Secret** → `SLACK_SIGNING_SECRET`

### Slash Commands
Go to **Slash Commands** → **Create New Command** for each:

| Command | Request URL | Description |
|---|---|---|
| `/task-create` | `https://YOUR_DOMAIN/slack/events` | Create and assign a task |
| `/task-list` | `https://YOUR_DOMAIN/slack/events` | List tasks for this channel |
| `/task-delete` | `https://YOUR_DOMAIN/slack/events` | Delete a task (chiefs only) |
| `/task-stats` | `https://YOUR_DOMAIN/slack/events` | View task statistics (chiefs only) |

### Interactivity & Shortcuts
Go to **Interactivity & Shortcuts** → turn **ON** → set Request URL:
```
https://YOUR_DOMAIN/slack/events
```

---

## ☁️ Step 3 — Deploy to Railway (Recommended, Free)

### Option A: Railway (Easiest)
1. Go to [railway.app](https://railway.app) and create a free account
2. Click **New Project → Deploy from GitHub repo** (push this folder to GitHub first)
3. Add all environment variables from `.env.example`
4. Railway gives you a domain like `https://your-app.railway.app`
5. Use that as `YOUR_DOMAIN` in Slack commands above

### Option B: Render.com (Free)
1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo
3. Set **Start Command**: `node index.js`
4. Add environment variables
5. Use the provided domain

### Option C: Run Locally with ngrok (Testing)
```bash
# Install dependencies
npm install

# Copy env file and fill in your values
cp .env.example .env

# Start the bot
npm start

# In another terminal — expose locally
npx ngrok http 3000
# Use the ngrok HTTPS URL as YOUR_DOMAIN
```

---

## 🔑 Step 4 — Set Your Chiefs Channel ID

1. Open Slack → right-click your `#cheifs` channel → **Copy Link**
2. The link looks like: `https://motolinkers.slack.com/archives/C0123456789`
3. The last part (`C0123456789`) is your `CHIEFS_CHANNEL_ID`
4. Add it to your environment variables

---

## ✅ Step 5 — Test It

1. Go to your `#cheifs` channel in Slack
2. Type `/task-create` — a modal should appear
3. Fill in all fields and submit
4. Check the assigned channel — the task card should appear there
5. The assignee gets a DM
6. `#cheifs` gets a confirmation log

---

## 📖 Usage Examples

### Creating a Task (Chiefs only — in #cheifs channel)
```
/task-create
```
→ Opens modal → fill title, description, channel, assignee, due date, priority, milestone

### Viewing Tasks (Any channel member)
```
/task-list
```
→ Shows only tasks assigned to the current channel

### Chiefs View All Tasks
```
/task-list
```
→ When run by a chief, shows ALL tasks across all channels

### Update Task Status
→ Use the **▶️ Start Progress** / **✅ Mark Done** / **🔄 Reset** buttons directly in the task message

### Delete a Task (Chiefs only)
```
/task-delete 42
```

### View Stats Dashboard (Chiefs only)
```
/task-stats
```

---

## 🏗️ Architecture

```
Chiefs Channel (#cheifs)
    │
    ├── /task-create (modal)
    │       │
    │       ▼
    │   Supabase DB (tasks table)
    │       │
    │       ├──▶ Post task card to #marketing
    │       ├──▶ Post task card to #logistics
    │       ├──▶ DM the assignee
    │       └──▶ Log confirmation to #cheifs
    │
    └── /task-stats, /task-list (all channels)

Channel Members (e.g. #marketing)
    │
    ├── See only their channel's tasks
    ├── Click status buttons (In Progress / Done)
    └── /task-list (filtered to their channel)
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---|---|
| "Only chiefs can create tasks" | Make sure the bot is added to `#cheifs` and `CHIEFS_CHANNEL_ID` is correct |
| Modal doesn't open | Check `trigger_id` — commands must be acknowledged within 3 seconds |
| Bot can't post to channel | Add bot to the channel or enable `chat:write.public` scope |
| Supabase error | Check `SUPABASE_SERVICE_KEY` — must be service_role, not anon key |
| Status buttons don't work | Ensure Interactivity URL is set correctly in Slack App settings |
