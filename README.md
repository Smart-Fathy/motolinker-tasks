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

---

## 📅 Google Calendar — tasks on the assignee's calendar

Two ways a task reaches a calendar, and they work together:

1. **The employee's own calendar (preferred).** Each employee clicks
   *"Add tasks to my Google Calendar"* on **My Tasks** in the employee portal.
   Their task events are then written straight into their calendar — no
   invitation to accept — and their existing open tasks are backfilled
   immediately. Disconnecting removes the events again.
2. **Company invite (fallback).** Anyone who hasn't connected is invited as an
   attendee from a single company account, connected once from **Calendar →
   "Connect for task sync"** in the admin dashboard.

Event ids are tracked per calendar in `tasks.calendar_events`, so editing a
task's title, due date or assignees patches the existing events instead of
creating duplicates. With nothing connected, task creation is unaffected.

Requires the `https://www.googleapis.com/auth/calendar.events` scope on the
OAuth consent screen.

---

## 💬 Google Chat integration

Reads your Chat spaces and messages, and sends as the signed-in user, inside the
app (**Google → Google Chat** in both portals). It is **off by default**.

### Turning it on

**1. Railway environment variables**

| Variable | Value | Notes |
|---|---|---|
| `GOOGLE_CHAT_ENABLED` | `1` | Required. Until set, the nav item stays hidden. |
| `GOOGLE_CHAT_READ` | `1` (default) | `0` requests send-only scopes — avoids the restricted-scope tier. |
| `GOOGLE_CHAT_CLIENT_ID` | *optional* | A separate OAuth client for Chat, so the Chat grant can't drag the existing Gmail/Drive scopes into a fresh Google review. Falls back to `GOOGLE_CLIENT_ID`. |
| `GOOGLE_CHAT_CLIENT_SECRET` | *optional* | Pairs with the above. |

**2. Google Cloud Console** (project behind the client id)

- **Enable the Google Chat API.**
- **Chat API → Configuration**: fill in App name, Avatar URL and Description.
  Required for *sending* — reads work without it.
- **OAuth consent screen**: add the scopes
  `chat.spaces.readonly`, `chat.messages.create` and — only if `GOOGLE_CHAT_READ=1` —
  `chat.messages.readonly`.
- **Set the consent screen audience to Internal** if the Cloud project lives
  inside your Workspace org. This is strongly recommended: it removes app
  verification, the annual CASA security assessment, and the 7-day refresh-token
  expiry that External+Testing imposes.

### Things to know

- **Workspace only.** The Chat API rejects consumer `@gmail.com` accounts outright.
- `chat.messages.readonly` is a **restricted** scope. On an *External* consent
  screen it needs verification plus an annual CASA assessment. *Internal* avoids
  both. Sending (`chat.messages.create`) is only *sensitive*.
- Messages sent from the panel are **text only**, and Chat stamps the app's name
  next to the sender. Neither is changeable.
- **No realtime** — the open space is polled every 20s, and never while the tab
  is hidden. Nothing is cached server-side.
- Spaces only appear once they contain at least one message; brand-new DMs are
  invisible to the API.
- Every failure renders as a state inside the panel (not connected, expired,
  partial permissions, org-blocked, empty) and never breaks the page.

## 🎧 Huddles — in-app voice, video and screen share

Every chat conversation has a huddle button. A huddle is a **mesh** call: each
participant holds one `RTCPeerConnection` per peer, so it is capped at **6 people**
(beyond that an SFU would be needed). Media never touches the server — only the
signalling does, and it rides the chat SSE stream that messages already use, so
there is no second socket to keep alive.

Participants can turn the camera on, mute the mic, share a screen and pull other
members of the conversation into the call. Turning the camera or a screen share on
mid-call is a track swap on a slot reserved before the first offer, so it takes
effect without renegotiating.

### TURN (optional, but recommended)

With no configuration, huddles use Google's public STUN servers and connect fine on
ordinary networks. Corporate firewalls and symmetric NATs need a relay. Two providers
are supported, and `GET /api/{portal}/chat/huddle/ice` picks whichever is configured —
Cloudflare first, then static. Nothing reaches the browser until someone opens a
huddle, so credentials are never sitting in the page source.

**Option A — Cloudflare Realtime TURN (recommended).** 1,000 GB/month free, then
$0.05/GB. In the Cloudflare dashboard go to **Realtime → TURN** and create a TURN key;
you get a key ID and an API token.

| Variable | Example |
| --- | --- |
| `CLOUDFLARE_TURN_KEY_ID` | `a1b2c3…` |
| `CLOUDFLARE_TURN_TOKEN` | *(the API token for that key)* |

Cloudflare deliberately refuses to issue long-lived credentials, so the server mints a
2-hour pair on demand and reuses it until 15 minutes before it expires. If the
Cloudflare API is unreachable the last good credential keeps being served rather than
silently dropping the call to STUN.

**Option B — self-hosted coturn, or any provider with static credentials.**

| Variable | Example |
| --- | --- |
| `TURN_URL` | `turn:relay.example.com:3478,turns:relay.example.com:5349` |
| `TURN_USERNAME` | `motolinker` |
| `TURN_CREDENTIAL` | *(your TURN secret)* |

`TURN_URL` accepts a comma-separated list. This also acts as the fallback if
Cloudflare is configured but unavailable and there is no cached credential.

With neither configured, a call that cannot find a path says so ("this network needs a
TURN relay") instead of hanging.

### Checking the relay actually works

Credentials being issued does not prove the relay is reachable — a revoked key, a
blocked port or a typo'd token all still produce a well-formed config, and on a
friendly network peer-to-peer succeeds so the relay is never exercised. The **signal
icon in the chat panel header** (admin dashboard) settles it: it gathers ICE
candidates with `iceTransportPolicy: 'relay'`, which discards host and reflexive
candidates, so any candidate at all means the relay answered.

- `Relay OK via cloudflare — udp, tcp` — working, and which transports got through
- `No relay reachable…` — credentials were issued but nothing came back
- `No TURN configured — provider: none` — the variables never reached the process

Worth clicking once after setting the variables, and again if anyone reports a call
that won't connect.

### Things to know

- **Roster is in-memory.** A server restart ends any call in progress; nothing about
  a huddle is persisted.
- **One SSE connection per user.** Opening the portal in a second tab moves
  signalling to that tab — start the huddle where you intend to take it.
- Group administration lives next to it: the admin can rename any group, add and
  remove members and browse everything shared in the room. An employee gets the
  same controls for groups they created. The server enforces this, not just the UI.


## 📁 Where files are stored

Two stores, split by size rather than by feature:

| What | Where | Why |
| --- | --- | --- |
| Chat attachments, avatars, issue screenshots | Supabase Storage | Small, already working, nowhere near the limit |
| Client files on a sale, supplier documents | **Google Drive** | Scans and shipping paperwork are large |

The Supabase free tier is **1 GB total with capped egress** — a few hundred scanned
passports would exhaust it, and the only fix at that point is a paid plan. Workspace
Drive is effectively unlimited, and the Drive OAuth was already wired up for the
Drive/Sheets browser, so nothing new needed connecting.

Uploads land in `MotoLinker / Client Files` and `MotoLinker / Suppliers`, created on
first use. The app stores the Drive link and file id; the file itself never passes
through Supabase. Cap is **100 MB** per file.

**If Drive is not connected the upload is refused** with "Connect Google Drive first"
rather than quietly falling back to Supabase — a silent fallback is how a free tier
fills up without anyone noticing. Connect it under Google → My Drive.

Deleting a supplier document removes the row but leaves the file in Drive, so a
mis-click is recoverable.

## 🚗 Stock is tracked per VIN

Every car in inventory is its own record with its own VIN, colour, status, price and
supplier. There is no "quantity" field to type in any more — the number in stock *is*
the number of cars listed, so every figure traces back to a specific vehicle.

Applying `migrations/005_stock_vin.sql` **will lower your stock totals**, on purpose.
A model that previously read "5 in stock" with no individual cars recorded now reads 0
and shows *"5 cars were recorded here before VIN tracking — add them to bring this
model back into stock."* Nothing is deleted and nothing is invented; the old figure is
kept solely to prompt for what to enter.

`migrations/006_supplier_catalogue.sql` links purchase orders and stock units to
supplier records by exact name match, case-insensitively. Anything it cannot match
confidently is left unlinked rather than guessed — the file ends with two queries that
list exactly what needs setting by hand.


## 🗂 Repository layout

```
index.js              boot, config, auth, Google tokens, chat/notifications core
src/ctx.js            the shared context feature modules pull their deps from
src/lib/constants.js  domain vocabulary used across features
src/routes/*.js       one module per feature (stock, suppliers, rfq, huddles, …)
public/*.html         page markup only
public/assets/*.{css,js}   the portals' styles and application code
tools/route-inventory.js   dumps every registered route, in order
tests/                browser, unit and migration suites
```

`index.js` hands each feature module its dependencies immediately before requiring
it, so whatever was in scope at that point in the file still is. Modules pull them
with `ctx.need(...)`, which throws naming the key if something is missing — a typo
becomes a boot failure rather than a mystery crash on some request later. A handful
of helpers are registered by a module that loads after the one using them; those are
looked up when called instead, and say so in a comment.

### Route order is load-bearing

`/huddle/ice` must stay ahead of `/huddle/:roomId`, and there are other pairs like
it, so the split had to preserve registration *order*, not just the set of routes.
`tools/routes.snapshot.txt` was captured before the split and is byte-identical to
what the modular version registers:

```
node tools/route-inventory.js out.txt && diff tools/routes.snapshot.txt out.txt
```

`bash tests/run.sh` runs every suite and finishes with that check. Regenerate the
snapshot only when routes genuinely change, and say so in the commit.

### Tests

```
bash tests/run.sh
```

They drive the shipped code rather than a copy: the browser suites slice the real
module out of `public/assets/*.js` (and the real stylesheet, since some behaviour is
CSS), the WebRTC suite runs three peers with fake media devices, and the migration
suite applies the real SQL to a throwaway Postgres and asserts the resulting rows.
The relay suite needs a local coturn on `127.0.0.1:3478` for its success case.
