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
signalling does, and it rides the notification SSE stream, which every portal page
keeps open from login on. Each frame carries an id, and the server keeps the last
minute per person, so a stream that reconnects (the host cuts every one at 15
minutes) is sent whatever it missed.

Participants can turn the camera on, mute the mic, share a screen and pull other
members of the conversation into the call. Turning the camera or a screen share on
mid-call is a track swap on a slot reserved before the first offer, so it takes
effect without renegotiating.

### The host

Whoever starts a huddle is its host, and every roster marks them (`host: true` on their
entry), so each tile can say so. The host can **remove** someone (the button on their
tile): the server takes them out of the roster, revokes a guest's grant, tells them
(`removed`) and drops them from everyone else's roster at once (`left`, `removed: true`).
They then stay out until the huddle ends or **the host** invites them again: their joins,
pings and offers are refused with `removed: true` (the page says why), nobody else's
invite brings them back, and the live list does not offer them the call. A member keeps
the conversation; only the call is closed to them.

If the host leaves, or is swept as silent, whoever has been in the call longest is host
until they return. The role comes back to whoever started it, so a reload doesn't hand
the call over for good. After a server restart the host is read back from the huddle's
session (below).

### Reactions

The smiley button offers eight reactions (👍 👏 ❤️ 😂 🎉 😮 🙌 ✋). The one picked floats up
over the sender's tile on everyone's screen in the call, the sender's included. The server
accepts only those eight, at most eight per person per five seconds, and passes them only
to the people in the call. They are deliberately **not** kept for a stream that
reconnects: replayed a minute late, a reaction is a reaction to nothing.

### Meeting threads

Every huddle is a session — from its first join to its last leave — with a **thread**:
what the people in the call write to each other (links, notes, decisions). It arrives
live for everyone in the call (the button counts what is new) and is kept after the call
ends. The history is under the speech-bubble button above the conversation list, and a
conversation's info panel lists its last few huddles.

Who can read and add to a thread: everyone in the conversation, and everyone who was in
the call — so a guest pulled in from outside keeps the thread of the meeting they were in,
though never the room's messages. Someone the host removed can't write in the thread of
the call they were removed from while it runs.

Sessions survive a restart: a client that rejoins after one carries on the open session
(and its host and start time) rather than starting another, and a session a crash left
open is closed — as of its last message — when the next huddle starts in that room.

Needs `migrations/024_huddles_and_group_pictures.sql` (also in `schema.sql`). Without it
calls work exactly as before; the thread panel and the history say which migration is
missing (`503`, `migration: "024"`).

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

- **Roster is in-memory.** Who is in a call right now, the host's removals and the
  reaction limits live only in the server's memory. A server restart forgets the roster
  but not the calls, which are peer to peer: clients see the new boot id and rejoin by
  themselves. What is persisted is the meeting — its session, who was in it and its
  thread (above).
- **Leaving is detected.** A closing tab sends a leave beacon, and every participant
  pings every 15 s; anyone silent for 90 s is dropped from the roster. Dropped pairs
  restart ICE (bounded, then the person is told), and a pair whose other end
  reloaded is rebuilt from scratch.
- **Every tab gets the signalling.** Two tabs or devices each hold their own stream;
  take the call in whichever one you like.
- **Tabs still on an older bundle** (open since before a deploy) join without a session
  id, never ping and never leave on their own. The server drops one once its login
  has had no old-bundle tab open for 3 minutes (it sees their notification streams;
  this bundle's are marked `?hd=2`), or once everyone else in the call is on this
  bundle and none of them has reached it for 10 minutes, counted from its join or the
  last report — current participants report who they're connected to in their ping,
  and a working connection always keeps it. The second rule catches a closed tab whose
  login keeps another old tab open. It is slow because an old tab hears signalling only
  on its Chat page, so a live one on another page can't be reached for a while.
  Current pages keep their end of a dropped old tab's connection for another 10
  minutes, out of sight, and keep offering; if it answers, their ping puts it back. A
  call made only of old tabs is left alone. When someone's entry is replaced (a
  reload, another device), old tabs are shown a roster without them first, so they
  drop their dead connection and dial the new page; a current page whose place an old
  tab takes is told, and steps aside.
- Group administration lives next to it: the admin can rename any group, set its
  picture, add and remove members and browse everything shared in the room. An employee
  gets the same controls for groups they created. The server enforces this, not just the
  UI.
- **A group's face is a picture.** It is uploaded (PNG, JPEG, WebP or GIF, up to 5 MB —
  never an SVG, which can carry script, and never an address someone typed), cropped to
  its middle square and scaled down in the browser first, stored in Supabase Storage and
  shown in the list, the conversation's header and the huddle history. Replacing or
  removing it deletes the old file. The emoji icon it replaces is still drawn for a group
  without a picture. The column (`chat_rooms.avatar_url`) arrives with migration 024;
  until then setting one answers 409 saying so.


## 🏷 The workspace's name and picture

The admin renames the workspace and sets its profile picture under **Workspace** at the
bottom of the admin sidebar. Both portals show them — the sidebar, the header, the
team's sign-in page, the page title and the browser tab's icon — and every open page,
in either portal, updates at once: the change is announced on the notification stream
each of them keeps open (`event: workspace`). Each page remembers the last one it saw,
so a renamed workspace doesn't flash its old name while loading.

They are stored in `quotation_settings` (key `workspace_profile`), so this needs no
migration. `GET /api/workspace` is public on purpose — the sign-in page reads it before
anyone has signed in — and returns nothing but the name and the picture's address.
Changing them is the admin's alone (`PUT /api/dashboard/workspace`,
`POST`/`DELETE /api/dashboard/workspace/logo`). The picture follows the same rules as a
group's. This is the app's own name: the company details printed on quotations and
contracts are separate settings and are not changed by it.

## 📁 Where files are stored

Two stores, split by size rather than by feature:

| What | Where | Why |
| --- | --- | --- |
| Chat attachments, avatars, group and workspace pictures, issue screenshots | Supabase Storage | Small, already working, nowhere near the limit |
| Client files on a sale, supplier documents | **Google Drive** | Scans and shipping paperwork are large |

The Supabase free tier is **1 GB total with capped egress** — a few hundred scanned
passports would exhaust it, and the only fix at that point is a paid plan. Workspace
Drive is effectively unlimited, and the Drive OAuth was already wired up for the
Drive/Sheets browser, so nothing new needed connecting.

Uploads land in `MotoLinker / Client Files` and `MotoLinker / Suppliers`, created on
first use. The app stores the Drive link and file id; the file itself never passes
through Supabase. Cap is **25 MB** per file.

That cap is a memory bound, not a Drive limit. Drive's multipart upload wants the whole
file as one body, so the file is buffered in memory for the length of the request — at
100 MB, two concurrent uploads were 200 MB resident, which on a small instance shows up
as a restart rather than an error. 25 MB covers scanned paperwork comfortably. If
genuinely large files are ever needed, the fix is Drive's resumable upload endpoint
(`uploadType=resumable`), which streams in chunks and never holds the whole file —
worth building then, not speculatively.

**If Drive is not connected the upload is refused** with "Connect Google Drive first"
rather than quietly falling back to Supabase — a silent fallback is how a free tier
fills up without anyone noticing. Connect it under Google → My Drive.

Deleting a supplier document removes the row but leaves the file in Drive, so a
mis-click is recoverable.

## 🧠 Accounting — money in, money out, and a finance AI

**Finance → Accounting** in both portals, behind the `accounting` permission (off for
everyone until an admin grants it; the **Accountant** preset in the employee editor is
the usual starting point). Figures are **company-wide** — an accountant's job is the whole
book, so nothing here is scoped to the employee's own leads — and in EGP.

| Tab | What it reads |
| --- | --- |
| Overview | cash in / out / net, receivables, vehicle costs, gross margin, expenses, net result; cash flow by month |
| Receivables | every sale still owed, aged (not yet due, 1–30, 31–60, 61–90, 90+ days) |
| Payables & costs | supplier / freight / customs payments, purchase orders with PI totals, the last USD rate booked |
| Expenses | a new ledger of operating costs — rent, salaries, marketing, … — with receipts |
| Ledger | every payment, filterable, CSV |
| Reports | a period's figures, an AI-written analysis (EN/AR), kept and exportable as PDF |

Every number is computed by `src/lib/finance.js` from the payments ledger, the sales
register, purchase orders and the expenses table. **The model narrates; it never does the
arithmetic.** The finance AI (the colourful brain button) is handed those figures and, when
it needs a number that is not there, calls back into two server tools — a whitelisted
`finance_query` and a `calculate` expression evaluator — so every figure in an answer can
be traced to code that ran here, and the working is shown under the reply.

It uses the same model as the Help bot: Cloudflare Workers AI (`CLOUDFLARE_ACCOUNT_ID` +
`CLOUDFLARE_AI_TOKEN`, the model the motolinkers.com site runs on), with `GEMINI_API_KEY`
as the fallback. Without either, every AI surface says so and the rest of the section
keeps working.

Apply `migrations/022_accounting.sql` (the `expenses` and `accounting_reports` tables).
Until it is applied, reads degrade with a warning and recording an expense answers
503 with `migration: "022"`.

## 🔐 Signing in — sessions, sign-in alerts and two-factor authentication

Everyone has a **Security** panel (the profile menu in the team portal; the sidebar footer
in the admin dashboard). It shows where the account is signed in, its recent sign-ins, and
two-factor authentication.

### A password change ends the other logins

A login is a token, and whoever holds it *is* the account — so the ways a token stops
working matter as much as the way it starts.

| What happens | What it does |
| --- | --- |
| An employee changes their password | every **other** device is signed out; the one making the change stays |
| A "forgot password" reset | **every** device is signed out, and every emailed reset link is spent |
| An administrator sets an employee's password, or deletes the employee | all of that employee's devices are signed out |
| `ADMIN_PASSWORD` is changed and the service redeployed | every admin login ends, including those saved in the `sessions` table (they carry a fingerprint of the password they were opened under) |
| Two-factor is turned on or off | the other devices are signed out |

"Signed out" means all four places a login lives are cleared: the in-memory map, the
`sessions` table that survives a restart, the live notification/chat streams opened with
the token (nothing re-checks an open stream), and the push subscriptions its devices
registered (so a signed-out phone stops receiving notification text; devices that are still
signed in register again on their next page load). This needs **no migration**. A session
in memory is also refused after 30 days; it used to live as long as the process.

The first deploy of this signs the admin out once (admin logins carry the password
fingerprint from now on).

### Sign-in alerts

Every sign-in is recorded (browser, address, method) and the account's owner is told when
it comes from a **browser that account has not signed in from before**: in the app (the
bell), by push to their other devices, and by **email** to the address on the employee
record (the admin's goes to `ADMIN_EMAIL`). The email is the one that matters — an in-app
notice is in front of whoever is signed in, which may be the person it is about. Password
changes and every change to two-factor authentication are announced the same way.

A browser is recognised by an HttpOnly cookie the server sets at sign-in (only its hash is
stored). `LOGIN_ALERTS=all` alerts on every sign-in; `LOGIN_ALERTS=off` records without
alerting. Employees with no email on file get the in-app and push alerts only; email needs
the SMTP settings.

### Two-factor authentication

Opt-in, per person, in both portals. An authenticator app (Google/Microsoft Authenticator,
Authy, 1Password…) gives a 6-digit code that changes every 30 seconds (TOTP, RFC 6238).

- **Turning it on** asks for the password again, shows a QR code, and only goes live once a
  code from the app has been entered. It then shows **ten recovery codes, once**.
- **Signing in** takes the password (or Google) and then the code. A recovery code works in
  its place, once. Signing in with Google does not skip the code.
- **Turning it off, or making new recovery codes,** asks for the password *and* a code.
- A code cannot be used twice, and wrong ones are limited: five tries per sign-in, ten per
  account per 15 minutes. Five wrong codes after a correct password alert the owner — it means
  the password has leaked.
- If the second factor cannot be checked (the database is down), sign-in is refused. It is
  never read as "no second factor".

**Lost phone and recovery codes:** an administrator opens *Employees* and presses **Reset
2FA** on the person (they are signed out everywhere and told). For the admin account itself,
run `node scripts/reset-2fa.js admin` where the app's environment is set (for example
`railway run node scripts/reset-2fa.js admin`), then restart the service if anyone else may
have had access — a running server keeps the logins it already holds in memory.

**Setup**

1. Apply `migrations/023_account_security.sql` (`account_security` and `login_events`).
   Until it is applied nothing breaks: sign-in is exactly as before, the Security panel
   says two-factor is unavailable, and every sign-in counts as a new browser.
2. Set `MFA_ENCRYPTION_KEY` (any long random string, `openssl rand -hex 32`) **before**
   people turn two-factor on. It seals the secrets in the database so a leaked dump or
   backup does not contain working codes. Without it they are stored readable (and still
   work); do not change or lose the key afterwards, or those accounts need a reset.
3. Optionally `ADMIN_EMAIL` and `LOGIN_ALERTS` (see `.env.example`).

**Guessing is limited** at every sign-in: 5 wrong passwords per username *and address* per
15 minutes, 40 per address, 20 per username from anywhere. The counters are held in memory,
like the sessions' working set, so a restart forgets them.

**Not built:** requiring two-factor for everyone (it is opt-in), and trusting a device so it
skips the code for a while. The in-memory limits and challenges assume one running instance,
as the rest of the app does.

## 🧠 The assistant on every page

The **Ask AI** button in the header (or Ctrl/⌘+K) opens one panel on every page
of both portals. On a desktop it docks beside the page — the page shrinks, nothing
is covered, you keep working while it answers — and it is resizable and remembers
being open; on a phone it rises as a sheet. Every section also carries an **AI
insights** card at the top (highlights, risks, suggestions; fold it with *Hide*,
ask again with *Refresh*). The panel reads whichever section is open — Leads,
Deals, Quotation, Contracts, RFQ, Purchase Orders, Suppliers, Inventory & tracking,
Submissions, Tasks, Hours, Requests, Meetings, Issues, and for the admin Employees
and Automations — and only what the person's own permissions and data scope let
them see.

**It sees what is on screen.** The panel tells the server which record is open (a
lead profile, a deal, a task, a supplier, a purchase order, a container…), the
active tab, the search box and the filters, so "summarise this lead" or "what
about this one?" needs no name — an open lead, deal, supplier or VIN is handed to
the model in full, and a *Looking at* chip in the panel shows what it is reading
(× ignores it).

**It follows records across sections.** From any page the model can call
`lookup` for one lead (activities, follow-ups, deals, quotations, contracts,
sales, payments and what is still owed, purchase orders, RFQs, website
submissions, tasks, a timeline), one deal, one supplier (orders, RFQs, catalogue,
cars in stock, containers) or one VIN (stock unit, container and arrival date,
purchase-order line, sale, payments, customer); `search_all` finds anything by
name, phone, email, number or VIN; `other_section` reads another section's
figures. Each slice loads under its own permission, so a slice the person may not
see is simply absent.

Every figure comes from `src/lib/sections.js`, which turns a section's rows into
a pack the model is handed; the model narrates and, when it needs a number, calls
back into `section_query` and `calculate`, so an answer traces to code that ran
here (the working is shown under the reply).

**In the team chat, @AI answers in the room.** Write `@AI` (or `@assistant`, `@المساعد`)
in any conversation and the assistant replies there, as a sender of its own, for everyone in
the room to read. It reads the recent conversation and answers with the asker's own
permissions and data scope — the same figures they could paste in themselves — and it
never takes actions from chat; it points to the Ask AI panel for those. Typing `@` in the
composer offers it.

**Actions are proposed, never taken.** Ask for something to be done — "schedule a
follow-up with Ahmed on Thursday", "make me a task to chase PO-12" — and the model
proposes it through `propose_action`; it arrives as a card with **Confirm**. Only
that press writes anything, and it runs through the same checks and side effects as
the manual path (permission, scope, activity log, notification, automations) with
the real person as author. Actions today: a follow-up (schedule or close), a task
(create, update, comment), a lead status change or a lead edit, a logged
call/note/WhatsApp/meeting, a lead assignment, a new deal, a deal stage move, a deal
edit or note, a request, logged hours, a recorded payment or expense, linking a
website submission to a lead, and a notification. Each one is the manual route's
twin: a won deal still drafts its contract and opens its sale, a done task still
syncs the calendar and fires its automation.

It is governed by the `assistant` permission (`chat` for the drawer and cards,
`act` for proposals), **on for everyone by default** — an admin can switch it off
per employee. It uses the same provider as the Help bot and the Accounting AI —
Cloudflare Workers AI first, Gemini as the fallback (`src/lib/llm.js`); without
either every surface says so.

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
