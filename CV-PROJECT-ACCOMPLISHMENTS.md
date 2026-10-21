# MotoLinker Internal Platform — CV Material

Everything shipped in this repository, written up so you can lift it straight into a CV,
LinkedIn profile, or portfolio page. Section 2 is copy-paste ready; sections 3–5 are the
source material behind it.

---

## 1. The project in one line

**A full internal business platform for an automotive import/sales company** — CRM, sales
pipeline, procurement, document generation, task management, and an in-house team
communication suite — delivered as a single Node.js service with two web portals.

It began as a Slack task bot and was rebuilt into a standalone product: Slack was removed
entirely and replaced with a first-party admin dashboard and employee portal, then extended
over ~5 months into a 34-table, 250-endpoint system covering the company's whole operation.

---

## 2. Ready-to-paste CV entries

### A. One-liner (for a skills summary or profile headline)

> Built and shipped MotoLinker — a full-stack internal business platform (CRM, sales
> pipeline, procurement, PDF document generation, task management, real-time chat with
> WebRTC calling) on Node.js, Express and Supabase/PostgreSQL: ~250 REST endpoints,
> 34 database tables, two role-based web portals, ~25k lines of code.

### B. Compact — 5 bullets (best for a one-page CV)

**MotoLinker Internal Platform** — Full-stack Developer · 2026
*Node.js · Express · Supabase (PostgreSQL) · JavaScript · Puppeteer · WebRTC · Google APIs*

- Designed and shipped a company-wide internal platform replacing Slack-based workflows —
  ~250 REST endpoints across 34 PostgreSQL tables, serving an admin dashboard (26 modules)
  and an employee portal (17 modules) used daily by the sales, logistics and procurement teams.
- Built the CRM and sales engine: lead capture from the public website, phone-normalised
  de-duplication, user-configurable lead columns, tolerant CSV import/export, a drag-and-drop
  deals kanban, a 360° customer profile with activity timeline and follow-up reminders, and a
  customisable report builder with cross-tab analysis and CSV export.
- Implemented a granular authorisation model — per-section, per-action permissions plus
  row-level data scoping (own-records-only, by deal stage, by lead status) enforced server-side,
  with an admin approval queue that gates every destructive action employees take.
- Automated document production with Puppeteer: bilingual (English/Arabic) quotations,
  contracts, purchase orders and RFQs rendered to branded PDFs with multi-currency pricing,
  live exchange rates, vehicle imagery and one-click attachment to the originating lead.
- Delivered the real-time layer end to end: Server-Sent Events for notifications, chat and
  presence; an in-app messenger with groups, file sharing and typing indicators; WebRTC mesh
  huddles (voice, video, screen share, up to 6 peers) signalled over the existing SSE stream
  with TURN credentials served per-request for rotation without redeploy.

### C. Full project section — 10 bullets (for a detailed CV, portfolio, or interview sheet)

**MotoLinker Internal Platform** — Full-stack Developer · Jul 2026 – Aug 2026
*Node.js · Express · Supabase/PostgreSQL · Vanilla JS SPAs · Puppeteer · WebRTC · SSE · Google
OAuth & Workspace APIs · Web Push/PWA · Gemini API*

- **Product ownership.** Took a Slack-only task bot and re-architected it into a standalone
  internal platform — removed the Slack dependency entirely and shipped two purpose-built
  portals (admin + employee) covering CRM, deals, procurement, inventory, documents, HR
  workflows and internal comms. 50+ feature releases merged to production over the period.
- **Backend & data model.** Single Node.js/Express service exposing ~250 REST endpoints over a
  34-table PostgreSQL schema on Supabase, with incremental SQL migrations for every schema change.
- **Authentication & authorisation.** Session auth with `scrypt` password hashing and per-user
  salts, cryptographically random session tokens, email-based password reset, and Google OAuth
  sign-in for employees. Built a two-dimensional permission model — per-action grants
  (view/create/edit/delete/import/export, per module) combined with row-level data scope
  (assigned-only, allowed deal stages, allowed lead statuses) — enforced in the API, not just the
  UI, and backward-compatible with the legacy flat permission format.
- **Approval workflows.** Employee deletions and automation-triggered removals route into an
  admin approval queue rather than executing directly, with de-duplication of pending requests.
- **CRM & pipeline.** Public-website lead capture (CORS form endpoint) with phone normalisation,
  de-duplication and ownership assignment; user-configurable lead columns (rename, retype,
  delete, custom fields); fault-tolerant CSV import that maps renamed headers and resolves
  label collisions; sort-by-any-column, a filter builder, and visible-columns export; a
  drag-and-drop deals kanban with automatic deal creation for hot leads; and a Lead 360° drawer
  with activity timeline, follow-up reminders and attached documents.
- **Document generation.** Server-side PDF pipeline (Puppeteer) producing branded quotations
  (multiple selectable designs, multi-currency with exchange rate, vehicle images, custom spec
  tables), Arabic and English contracts, purchase orders and supplier RFQs — each attachable to
  its lead and viewable in-app.
- **Procurement, inventory & logistics.** Supplier registry, RFQ flow, purchase orders, a
  car-stock module for immediate-delivery inventory with spec cards, colour variants and bulk
  CSV upload, plus a live vehicle picker that searches the marketing site's separate Supabase
  project read-only and carries the selected vehicle's images into a prefilled quotation.
- **Reporting & automation.** A configurable leads report builder (group-by, cross-tab split-by,
  label resolution from each user's column config, all-time totals) alongside sales/revenue
  analytics and CSV export, with per-report permission grants. Built a no-code automation engine
  — trigger → conditions → actions — covering CRM events, tasks, requests, form submissions and
  hours, with templated messages, an hourly sweep for time-based triggers (overdue tasks, lead
  inactivity), a run history, and failure isolation so a bad rule can never break a request.
- **Real-time & communications.** SSE-driven notifications, chat, presence and typing indicators;
  an in-app messenger with direct messages, groups, server-enforced group administration, file
  attachments and message editing; WebRTC mesh huddles for voice, video and screen sharing
  (up to 6 peers) that reuse the chat SSE stream for signalling and pre-reserve media tracks so
  cameras and screen shares start without renegotiation.
- **Third-party integrations.** Google Workspace — Gmail (read & send), Drive, Sheets, Calendar
  (per-employee task sync with event-ID tracking so edits patch rather than duplicate, plus a
  company-invite fallback) and Google Chat (feature-flagged, with every failure mode rendered as
  a recoverable UI state); a WhatsApp inbox via `whatsapp-web.js` with QR pairing, persistent
  sessions, threaded conversations and media; a bilingual AI help assistant on the Gemini API
  with automatic model fallback and rate-limit rollover; Web Push notifications and installable
  PWAs (versioned service-worker caching, offline shell, SSE and API calls deliberately
  un-intercepted); and a `pdf.js` scraper that extracts vehicle trims, prices and specifications
  from Chinese manufacturer spec sheets into structured JSON.

---

## 3. Full inventory of what was built

### Platform & architecture
- Migrated the product off Slack onto two first-party web portals with no loss of workflow.
- Single Node.js/Express service (~6,600 LOC) serving both portals plus every API.
- Supabase/PostgreSQL — 34 tables, plus four numbered incremental migration files.
- Two dependency-light single-page apps (~17,600 LOC of vanilla JS/HTML/CSS, no build step),
  using Chart.js for analytics and Lucide for iconography.
- Read-only secondary Supabase client against the marketing website's database, with heuristic
  column mapping and environment-variable overrides so it works without hard-coding that schema.

### Identity, permissions & governance
- `scrypt` password hashing with per-user salt; random session tokens; password-reset tokens.
- Google OAuth sign-in for the employee portal, matched to existing employee records by email.
- Per-module master switches × per-action grants (leads, deals, quotations, reports).
- Row-level data scoping: assigned-only, allowed deal stages, allowed lead statuses — combined
  with AND semantics and applied to lists, detail views and reports alike.
- Backward-compatible normalisation of the legacy boolean permission shape.
- Deletion-request approval queue for employees and for automations.
- Per-report permission grants (e.g. leads report without revenue figures).

### CRM, deals & sales
- Public form submission endpoint (CORS-enabled) → persisted submissions, phone normalisation,
  lead de-duplication, ownership assignment.
- Configurable lead columns: rename, change type, delete, add custom columns — per user.
- CSV import with tolerant header mapping, renamed-column matching, custom-column precedence on
  label collisions, phone-less row de-duplication, and clear per-row feedback.
- CSV export of the visible column set; click-header sorting; a lead filter builder.
- Lead 360° profile: activity timeline, follow-up reminders, attached quotations and documents,
  reachable from both the leads table and the deals kanban.
- Deals kanban with drag-and-drop stage changes; automatic deal creation for hot leads plus a
  one-time backfill; deal cards open the full lead profile.
- Standalone lead de-duplication tool.
- Sales records and revenue analytics with CSV export.

### Documents (PDF generation)
- Quotation builder: selectable designs, settings and history tabs, multi-currency with exchange
  rate, vehicle images, custom specification tables, rename/edit/duplicate, delete from either
  portal, and attachment to a lead.
- Contracts: branded PDFs with company logo, Arabic and English variants, lead attachment.
- Purchase orders: full section, PDF output, lead attachment, redesigned layout.
- RFQs to suppliers with PDF output.
- Universal document viewer — any file attached to a lead renders as a PDF in-app.

### Procurement, inventory & logistics
- Supplier registry and RFQ workflow.
- Car Stock module for immediate-delivery inventory: spec cards, colour variants, bulk CSV
  upload with a downloadable template.
- Live vehicle picker searching the marketing site's inventory, attaching the vehicle to the
  active "Vehicle Requested" column and carrying its images into the prefilled quotation.
- Logistics & Shipping section with dedicated deal tabs.

### Work management
- Tasks with multiple assignees, priorities, milestones, statuses, due dates and bulk CSV upload.
- Threaded task comments with file attachments and Google-link previews.
- Recurring task templates that generate and assign work on a schedule, with a run-now action.
- Requests assigned to specific employees, with threaded comments.
- Issues/ticketing centre and an in-app "report an issue" flow.
- Working-hours logging and a Top Performers ranking.

### Reporting & automation
- Customisable leads report builder: group-by, cross-tab split-by, enum labels resolved from each
  user's own column configuration, all-time totals, configuration-order status sorting, reordering.
- Sales and revenue analytics dashboard with KPI cards and charts.
- No-code automation engine: trigger → conditions → actions, covering lead/deal/quote events plus
  tasks, requests, form submissions and hours; templated `{{field}}` messages; notify-all;
  destructive actions routed through admin approval; per-rule run history; hourly sweep for
  time-based triggers; tolerant condition matching with an enum value picker; fully isolated from
  the request path so a rule failure can never surface as a user-facing error.

### Real-time & communications
- Server-Sent Events for notifications, chat, presence and WhatsApp status.
- In-app chat: direct messages and groups, file uploads, message edit and delete, an attachments
  browser, typing indicators, presence heartbeats, and user status (emoji + text).
- Server-enforced group administration — admins manage any group, employees manage groups they
  created.
- WebRTC huddles: mesh voice/video/screen-share up to 6 participants, signalled over the existing
  chat SSE stream (no second socket), media never transiting the server, tracks pre-reserved
  before the first offer so enabling camera or screen share needs no renegotiation, configurable
  TURN relay with credentials served per-request so they rotate without a redeploy, and every
  failure surfaced as an explanatory state rather than a hang.

### Integrations
- **Google Calendar** — employees connect their own calendar and have open tasks backfilled
  immediately; event IDs tracked per calendar so title/date/assignee edits patch existing events
  instead of duplicating them; a company-account invite path as fallback; disconnect cleans up.
- **Gmail** — read and send from inside both portals.
- **Google Drive & Sheets** — file browsing and sheet selection.
- **Google Chat** — spaces and messages read and sent as the signed-in user; feature-flagged off
  by default; optional separate OAuth client so the Chat grant can't drag existing scopes into a
  fresh Google review; polled only while the tab is visible; every failure mode (not connected,
  expired, partial permissions, org-blocked, empty) rendered as a panel state.
- **WhatsApp** — inbox via `whatsapp-web.js`: QR pairing, persistent local auth, contact list,
  threaded conversations, sending, read state and media upload, with live status over SSE.
- **Gemini API** — bilingual (English/Arabic) in-app help assistant with a model fallback chain,
  rate-limit rollover, cached live diagnostics, and an admin-only AI status indicator.
- **SMTP/Nodemailer** — transactional email.

### Frontend, PWA & UX
- Two installable PWAs with their own manifests and service workers: versioned cache, offline
  shell, cache-first CDN assets, and deliberate pass-through for `/api` and SSE traffic.
- Web Push notifications with VAPID keys loaded from environment, database, or generated on first
  boot; an icon-generation script for the full icon set.
- Per-user configurable sidebar: reorderable items, drag between sections, renaming, shared layout
  across portals.
- Brand-styled dropdown menus replacing native select popups; a help FAB; a rewritten comment and
  report-issue UI.
- Arabic/RTL support in generated documents and the help assistant.

### Data engineering
- `pdf.js`-based scraper for Autohome (Chinese automotive portal) configuration PDFs: auto-detects
  data column positions, strips headers/footers/sidebars, and emits structured JSON of trims,
  prices and full specification tables.

---

## 4. Skills & technology keywords

**Languages** JavaScript (Node.js, ES modules + CommonJS), SQL (PostgreSQL), HTML5, CSS3

**Backend** Node.js, Express, REST API design, Server-Sent Events, session authentication,
`scrypt` password hashing, OAuth 2.0, multipart uploads (Multer), scheduled jobs, webhook and
event-driven design

**Database** PostgreSQL, Supabase, schema design and normalisation, incremental migrations,
row-level access control, JSONB configuration columns

**Frontend** Vanilla JavaScript SPAs, Chart.js, drag-and-drop interfaces, PWAs, service workers,
offline caching, Web Push, responsive UI, RTL/bilingual interfaces

**Real-time & media** WebRTC (mesh peer connections, track replacement, STUN/TURN), SSE streaming,
presence and typing indicators

**Integrations** Google OAuth, Gmail API, Google Drive API, Google Sheets, Google Calendar API,
Google Chat API, WhatsApp (`whatsapp-web.js`), Gemini API, SMTP/Nodemailer

**Document & data processing** Puppeteer headless-Chrome PDF generation, `pdf.js` text extraction,
CSV import/export with fuzzy header mapping, multi-currency formatting

**Practice** Git, feature-branch workflow, pull-request review, backward-compatible refactoring,
graceful degradation, feature flags, environment-driven configuration

---

## 5. Verifiable metrics

| Metric | Value |
|---|---|
| REST endpoints registered | ~261 |
| PostgreSQL tables | 34 |
| SQL migrations | 4 |
| Admin dashboard modules | 26 |
| Employee portal modules | 17 |
| Backend lines of code | ~6,600 |
| Frontend lines of code | ~17,600 |
| Total lines of code | ~25,750 |
| Feature releases merged | 50+ pull requests |
| Third-party services integrated | 8 (Supabase ×2, Google Workspace ×5, WhatsApp, Gemini) |
| Development period | Jul – Aug 2026 |

---

## 6. A note on framing

The metrics above are all verifiable from this repository, and the numbers are worth using —
"250 endpoints across 34 tables" reads far better than "built a CRM."

On authorship: this codebase was built with heavy AI-assisted development, with you specifying,
reviewing and merging every change. That's worth owning rather than omitting — directing an AI
coding workflow to ship a 25k-line production system is itself a differentiating skill in 2026.
Two options depending on the role:

- **Lead with the outcome** (default above): "Designed and shipped…" — standard framing for
  someone who owned a product end to end.
- **Lead with the method** (strong for AI-forward employers): add a bullet such as
  *"Delivered the entire platform through an AI-assisted development workflow — specifying,
  reviewing and integrating 50+ agent-generated feature releases into production, with schema
  migrations and backward compatibility maintained throughout."*

Pick whichever matches the audience; both are honest.
