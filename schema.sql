-- ============================================================
--  MotoLinker Task Bot — Supabase Schema
--  Run this in your Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id             BIGSERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT DEFAULT '',
  channel_id     TEXT NOT NULL,
  channel_name   TEXT NOT NULL,
  assignee_id    TEXT NOT NULL,
  due_date       DATE NOT NULL,
  priority       TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  milestone      TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo', 'in_progress', 'done')),
  created_by           TEXT NOT NULL,
  slack_list_record_id TEXT DEFAULT '',
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Run this if the table already exists:
-- ALTER TABLE tasks ADD COLUMN IF NOT EXISTS slack_list_record_id TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tasks_channel_id  ON tasks (channel_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks (status);

-- ============================================================
--  Hours Logs
-- ============================================================

CREATE TABLE IF NOT EXISTS hours_logs (
  id          BIGSERIAL PRIMARY KEY,
  task_id     BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  hours       NUMERIC(6,2) NOT NULL CHECK (hours > 0),
  description TEXT DEFAULT '',
  logged_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hours_task_id ON hours_logs (task_id);
CREATE INDEX IF NOT EXISTS idx_hours_user_id ON hours_logs (user_id);

-- ============================================================
--  Requests
-- ============================================================

CREATE TABLE IF NOT EXISTS requests (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  category    TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_review', 'approved', 'rejected')),
  priority    TEXT NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('high', 'medium', 'low')),
  created_by  TEXT NOT NULL DEFAULT 'dashboard',
  assigned_to TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status);

-- ============================================================
--  Auto-update updated_at trigger
-- ============================================================

-- search_path pinned to '' (all refs resolve via pg_catalog) to satisfy the
-- Supabase linter (function_search_path_mutable) and prevent search_path hijacking.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tasks
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Apply trigger to requests
DROP TRIGGER IF EXISTS requests_updated_at ON requests;
CREATE TRIGGER requests_updated_at
  BEFORE UPDATE ON requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
--  Employees (portal users)
-- ============================================================

CREATE TABLE IF NOT EXISTS employees (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email         TEXT DEFAULT '',
  slack_user_id TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
--  Run these if tables already exist (migrations)
-- ============================================================

-- Completion date on tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Category column on requests
ALTER TABLE requests ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';

-- Employee portal columns on hours_logs
ALTER TABLE hours_logs ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE hours_logs ADD COLUMN IF NOT EXISTS task_description TEXT DEFAULT '';
ALTER TABLE hours_logs ADD COLUMN IF NOT EXISTS log_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE hours_logs ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL;

-- Employee portal section permissions
ALTER TABLE employees ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"requests":true,"drive":true,"sheets":true,"pdfscraper":false,"email":false,"viewAllRequests":false,"quotation":false,"leads":false,"deals":false}'::jsonb;

-- Employee job title
ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_title TEXT DEFAULT '';

-- Tasks channel columns no longer required (Slack removed)
ALTER TABLE tasks ALTER COLUMN channel_id   DROP NOT NULL;
ALTER TABLE tasks ALTER COLUMN channel_name DROP NOT NULL;

-- Chat message enhancements
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at  TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_url   TEXT DEFAULT NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_name  TEXT DEFAULT NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_size  INT  DEFAULT NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_type  TEXT DEFAULT NULL;

-- Chat reply (quoted message) support
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id     BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_sender TEXT DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_body   TEXT DEFAULT '';

-- ============================================================
--  Chat
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_rooms (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('direct','group')),
  name       TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_updated ON chat_rooms(updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_room_members (
  room_id     BIGINT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  member_key  TEXT NOT NULL,
  member_name TEXT NOT NULL,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, member_key)
);

CREATE INDEX IF NOT EXISTS idx_chat_room_members_key ON chat_room_members(member_key);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  room_id     BIGINT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_key  TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at DESC);

-- search_path pinned to '' (table refs schema-qualified) to satisfy the
-- Supabase linter (function_search_path_mutable) and prevent search_path hijacking.
CREATE OR REPLACE FUNCTION chat_room_touch()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.chat_rooms SET updated_at = NOW() WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_touch ON chat_messages;
CREATE TRIGGER chat_messages_touch
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_room_touch();

-- ============================================================
--  Push Subscriptions (web push — one row per device per user)
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  member_key TEXT NOT NULL,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth_key   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (member_key, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_member_key ON push_subscriptions (member_key);

-- ============================================================
--  Presence (heartbeat-based; "online" = last_seen < 45 s ago)
-- ============================================================

CREATE TABLE IF NOT EXISTS presence (
  member_key TEXT PRIMARY KEY,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Voice duration column on messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS voice_duration INT DEFAULT NULL;

-- ============================================================
--  Password Reset Tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens (token);

-- ============================================================
--  Google OAuth Tokens (persisted across server restarts)
-- ============================================================
CREATE TABLE IF NOT EXISTS google_tokens (
  user_key   TEXT PRIMARY KEY,
  tokens     JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
--  Quotation Settings (editable company info / footer)
-- ============================================================

CREATE TABLE IF NOT EXISTS quotation_settings (
  id         BIGSERIAL PRIMARY KEY,
  key        TEXT UNIQUE NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO quotation_settings (key, value) VALUES
  ('company_name',    'MotoLinkers'),
  ('company_address', ''),
  ('company_phone',   ''),
  ('company_email',   ''),
  ('company_website', ''),
  ('company_tax_id',  ''),
  ('payment_terms',   '50% deposit / 30% on arrival / 20% on delivery'),
  ('footer_note',     'Confidential')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
--  Quotations (saved generation history)
-- ============================================================

CREATE TABLE IF NOT EXISTS quotations (
  id           BIGSERIAL PRIMARY KEY,
  quote_id     TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  data         JSONB NOT NULL,
  pdf_url      TEXT DEFAULT '',
  created_by   TEXT NOT NULL,
  customer_id  BIGINT DEFAULT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotations_created_by ON quotations (created_by);
CREATE INDEX IF NOT EXISTS idx_quotations_created_at ON quotations (created_at DESC);

-- ============================================================
--  Customers (CRM)
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT DEFAULT '',
  email      TEXT DEFAULT '',
  source     TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
--  Deals (CRM pipeline)
-- ============================================================

CREATE TABLE IF NOT EXISTS deals (
  id          BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  stage       TEXT NOT NULL DEFAULT 'lead'
                CHECK (stage IN ('lead','contacted','quoted','negotiating','won','lost')),
  car_model   TEXT DEFAULT '',
  budget_egp  NUMERIC(14,2) DEFAULT NULL,
  notes       TEXT DEFAULT '',
  assigned_to TEXT DEFAULT '',
  created_by  TEXT NOT NULL,
  closed_at   TIMESTAMPTZ DEFAULT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_customer ON deals (customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage    ON deals (stage);

CREATE TRIGGER deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Link quotation to customer/deal (run as migration if quotations table already exists):
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS deal_id BIGINT REFERENCES deals(id) ON DELETE SET NULL;

-- ============================================================
--  WhatsApp Inbox (whatsapp-web.js bridge)
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id                   BIGSERIAL PRIMARY KEY,
  wa_id                TEXT UNIQUE NOT NULL,      -- e.g. '201234567890@c.us'
  phone                TEXT DEFAULT '',
  name                 TEXT DEFAULT '',
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT DEFAULT '',
  unread               INT DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_last ON whatsapp_contacts (last_message_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id            BIGSERIAL PRIMARY KEY,
  contact_id    BIGINT NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  wa_message_id TEXT,                              -- WhatsApp msg id (dedupe)
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  body          TEXT DEFAULT '',
  media_url     TEXT DEFAULT NULL,                 -- Supabase storage URL
  media_type    TEXT DEFAULT NULL,
  status        TEXT DEFAULT 'sent',               -- sent/delivered/read (outgoing)
  ts            TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_msgs_contact ON whatsapp_messages (contact_id, created_at);

DROP TRIGGER IF EXISTS whatsapp_contacts_updated_at ON whatsapp_contacts;
CREATE TRIGGER whatsapp_contacts_updated_at
  BEFORE UPDATE ON whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
--  Notification Center (bell + counter, both portals)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  member_key  TEXT NOT NULL,            -- 'admin' | 'employee_<id>'
  type        TEXT DEFAULT 'general',   -- task | request | reminder | submission | general
  title       TEXT NOT NULL,
  body        TEXT DEFAULT '',
  url         TEXT DEFAULT '',
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_member ON notifications (member_key, created_at DESC);

-- ============================================================
--  Leads / Customers — extended columns (run as migration)
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_date       DATE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_time       TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_status     TEXT DEFAULT 'cold';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS car_in_question TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS budget_lead     BIGINT DEFAULT NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS budget_max      BIGINT DEFAULT NULL;  -- upper bound when budget is a range (budget_lead holds the lower bound / single value)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS next_action     TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS been_contacted  BOOLEAN DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_feedback  TEXT DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS inquiry         TEXT DEFAULT '';

-- Values for admin-defined custom lead columns (keyed by column key, e.g. {"cf_deposit": "5000"})
ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

-- Employee profile: custom status + avatar
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status_text  TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status_emoji TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar_url   TEXT DEFAULT '';

-- Multiple assignees per task (array of employee ids as strings; assignee_id keeps the first for compat)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_ids JSONB DEFAULT NULL;

-- Files attached to a task at creation. One JSONB array rather than the four flat
-- columns task_comments uses, because a task takes several files where a comment
-- takes one. Each element is what /api/*/chat/upload returns:
--   { url, name, size, type }
-- See migrations/016_task_attachments.sql.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Task comments (with @mentions)
CREATE TABLE IF NOT EXISTS task_comments (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_key TEXT NOT NULL,          -- 'admin' or 'employee_<id>'
  author_name TEXT DEFAULT '',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at);
ALTER TABLE IF EXISTS public.task_comments ENABLE ROW LEVEL SECURITY;
-- Optional file attachment on a comment (mirrors chat_messages)
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS file_url  TEXT DEFAULT '';
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS file_name TEXT DEFAULT '';
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT '';

-- Issue tickets reported from the employee portal (viewed/managed by the CTO)
CREATE TABLE IF NOT EXISTS issues (
  id BIGSERIAL PRIMARY KEY,
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  file_url TEXT DEFAULT '',
  reporter_id BIGINT,
  reporter_name TEXT DEFAULT '',
  status TEXT DEFAULT 'open',            -- open | resolved
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.issues ENABLE ROW LEVEL SECURITY;

-- Who closed an issue and when, so the reporter's "solved" notice can name them.
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_by TEXT DEFAULT '';

-- Issue conversation: the CTO answers the ticket, the reporter answers back.
CREATE TABLE IF NOT EXISTS issue_comments (
  id BIGSERIAL PRIMARY KEY,
  issue_id BIGINT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_key TEXT NOT NULL,            -- 'admin' or 'employee_<id>'
  author_name TEXT DEFAULT '',
  body TEXT DEFAULT '',
  file_url  TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  file_size BIGINT,
  file_type TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_comments ON issue_comments(issue_id, created_at);
ALTER TABLE IF EXISTS public.issue_comments ENABLE ROW LEVEL SECURITY;

-- Lead 360°: activity timeline (auto-logged + manual entries per lead)
CREATE TABLE IF NOT EXISTS lead_activities (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note',   -- note|call|whatsapp|meeting|status_change|quote|deal|follow_up|system
  body TEXT DEFAULT '',
  meta JSONB DEFAULT '{}'::jsonb,
  author_key TEXT DEFAULT '',          -- 'admin' or 'employee_<id>'
  author_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_activities ON lead_activities(customer_id, created_at DESC);
ALTER TABLE IF EXISTS public.lead_activities ENABLE ROW LEVEL SECURITY;

-- Lead 360°: scheduled follow-ups (reminder fires when due_at passes)
CREATE TABLE IF NOT EXISTS lead_followups (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  note TEXT DEFAULT '',
  assigned_to BIGINT,                  -- employee id; NULL -> reminder goes to admin
  status TEXT DEFAULT 'pending',       -- pending | done | cancelled
  reminded BOOLEAN DEFAULT FALSE,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lead_followups_due ON lead_followups(status, due_at);
ALTER TABLE IF EXISTS public.lead_followups ENABLE ROW LEVEL SECURITY;

-- Quotations belong to a lead (customer_id also in the CREATE for fresh installs)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS customer_id BIGINT DEFAULT NULL;

-- Requests: assign to a specific employee + threaded comments
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assignee_id BIGINT;
CREATE TABLE IF NOT EXISTS request_comments (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_key TEXT NOT NULL,            -- 'admin' or 'employee_<id>'
  author_name TEXT DEFAULT '',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_request_comments ON request_comments(request_id, created_at);
ALTER TABLE IF EXISTS public.request_comments ENABLE ROW LEVEL SECURITY;
-- Optional file attachment on a comment (mirrors chat_messages)
ALTER TABLE request_comments ADD COLUMN IF NOT EXISTS file_url  TEXT DEFAULT '';
ALTER TABLE request_comments ADD COLUMN IF NOT EXISTS file_name TEXT DEFAULT '';
ALTER TABLE request_comments ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE request_comments ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT '';

-- Notification setting for deal-contacted alert
INSERT INTO quotation_settings (key, value) VALUES ('contact_notify_employee_id', '')
  ON CONFLICT (key) DO NOTHING;

-- ============================================================
--  Capture & dedup + lead ownership (run as migration)
-- ============================================================

-- Canonical (digits-only, Egypt-normalized) phone for duplicate detection.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_norm  TEXT DEFAULT '';
-- Lead owner (sales rep). employee id; NULL -> unassigned.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_to BIGINT;
-- Backfill phone_norm from existing phones (strip non-digits, drop 0020/20 country code -> local 01…).
UPDATE customers SET phone_norm = (
  CASE
    WHEN regexp_replace(phone, '\D', '', 'g') LIKE '0020%' THEN substring(regexp_replace(phone, '\D', '', 'g') from 5)
    WHEN regexp_replace(phone, '\D', '', 'g') LIKE '20%' AND length(regexp_replace(phone, '\D', '', 'g')) = 12 THEN '0' || substring(regexp_replace(phone, '\D', '', 'g') from 3)
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10 AND regexp_replace(phone, '\D', '', 'g') LIKE '1%' THEN '0' || regexp_replace(phone, '\D', '', 'g')
    ELSE regexp_replace(phone, '\D', '', 'g')
  END)
WHERE (phone_norm IS NULL OR phone_norm = '') AND phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_customers_phone_norm ON customers (phone_norm) WHERE phone_norm <> '';

-- Website / external form submissions (persisted; each may link to the lead it created/updated)
CREATE TABLE IF NOT EXISTS form_submissions (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT DEFAULT '',
  email        TEXT DEFAULT '',
  phone        TEXT DEFAULT '',
  message      TEXT DEFAULT '',
  car_interest TEXT DEFAULT '',
  source       TEXT DEFAULT 'website',
  customer_id  BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions (created_at DESC);
ALTER TABLE IF EXISTS public.form_submissions ENABLE ROW LEVEL SECURITY;

-- ============================================================
--  No-code automation engine (run as migration)
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_rules (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  enabled        BOOLEAN DEFAULT FALSE,
  trigger_type   TEXT NOT NULL,                    -- lead.created | lead.status_changed | lead.contacted | deal.created | deal.stage_changed | quote.generated | no_activity_days
  trigger_config JSONB DEFAULT '{}'::jsonb,        -- e.g. { "days": 3 } for no_activity_days
  conditions     JSONB DEFAULT '[]'::jsonb,        -- [ { field, op, value } ]
  actions        JSONB DEFAULT '[]'::jsonb,        -- [ { type, ...params } ]
  created_by     TEXT DEFAULT 'admin',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.automation_rules ENABLE ROW LEVEL SECURITY;

-- Audit log of automation firings (also used to de-dup scheduled no_activity_days rules)
CREATE TABLE IF NOT EXISTS automation_runs (
  id          BIGSERIAL PRIMARY KEY,
  rule_id     BIGINT REFERENCES automation_rules(id) ON DELETE CASCADE,
  event       TEXT DEFAULT '',
  entity_type TEXT DEFAULT '',
  entity_id   BIGINT,
  status      TEXT DEFAULT 'ok',                   -- ok | error
  detail      TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON automation_runs (rule_id, entity_id, created_at DESC);
ALTER TABLE IF EXISTS public.automation_runs ENABLE ROW LEVEL SECURITY;

-- Employee-requested deletions of a lead/deal, approved (and performed) by an admin
CREATE TABLE IF NOT EXISTS deletion_requests (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('lead', 'deal')),
  entity_id    BIGINT NOT NULL,
  entity_label TEXT DEFAULT '',
  requested_by TEXT NOT NULL,                 -- employee username
  reason       TEXT DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests (status, created_at DESC);
DROP TRIGGER IF EXISTS deletion_requests_updated_at ON deletion_requests;
CREATE TRIGGER deletion_requests_updated_at BEFORE UPDATE ON deletion_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE IF EXISTS public.deletion_requests ENABLE ROW LEVEL SECURITY;

-- Per-stage win probability for weighted-pipeline analytics (JSON string in the KV settings table)
INSERT INTO quotation_settings (key, value) VALUES
  ('stage_probabilities', '{"lead":10,"contacted":25,"quoted":50,"negotiating":75,"won":100,"lost":0}')
  ON CONFLICT (key) DO NOTHING;

-- ============================================================
--  Row Level Security (RLS)
-- ============================================================
--  All database access happens server-side through the Express API using the
--  Supabase SERVICE ROLE key (SUPABASE_SERVICE_KEY), which has BYPASSRLS and is
--  therefore unaffected by these settings. The browser never talks to Supabase
--  directly (no anon key, no supabase-js, no Realtime).
--
--  Enabling RLS with NO policies makes the auto-generated PostgREST API (reachable
--  with the public anon key) deny-all for every table — closing the data-exposure
--  hole flagged by the Supabase linter (rls_disabled_in_public /
--  sensitive_columns_exposed) without affecting the app.
--
--  Idempotent: ENABLE ROW LEVEL SECURITY is a no-op if already enabled.

ALTER TABLE IF EXISTS public.tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hours_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.requests              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.employees             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_rooms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_room_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chat_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.push_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.presence              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.google_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.quotation_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.quotations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.deals                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.whatsapp_contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.whatsapp_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.form_submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.automation_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.automation_runs       ENABLE ROW LEVEL SECURITY;

-- ============================================================
--  Recurring Tasks (templates that auto-generate tasks on a schedule)
-- ============================================================
--  A recurring_tasks row is a TEMPLATE. A background scheduler materializes a
--  real row in `tasks` each time the template is due (every N days, or on chosen
--  weekdays), assigned to the chosen employee(s). Generated tasks carry
--  recurring_id so instances can be traced/de-duped. Templates never delete tasks.

CREATE TABLE IF NOT EXISTS recurring_tasks (
  id              BIGSERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  assignee_id     TEXT,
  assignee_ids    JSONB DEFAULT NULL,
  priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  milestone       TEXT DEFAULT '',
  recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('interval','weekly')),
  interval_days   INT,                    -- for recurrence_type='interval' (every N days)
  weekdays        JSONB DEFAULT NULL,     -- for recurrence_type='weekly': array of 0..6 (0=Sunday)
  due_offset_days INT NOT NULL DEFAULT 0, -- generated task's due_date = run date + this
  start_date      DATE,                   -- don't generate before this (optional)
  next_run_date   DATE,                   -- next date the scheduler will generate an instance
  last_run_date   DATE,                   -- last date an instance was generated (de-dupe guard)
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      TEXT DEFAULT 'dashboard',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_tasks_active_next ON recurring_tasks (active, next_run_date);

-- Link generated task instances back to their template:
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_id BIGINT DEFAULT NULL;

-- Weekly availability (migration 011). One row per person per week; member_key
-- follows the presence convention ('admin' | 'employee_<id>'). days is a 7-slot
-- array, MONDAY FIRST — the recurring engine counts weekdays Sunday-first, so
-- every conversion between the two goes through dayIndexOf in
-- src/routes/availability.js and nowhere else.
--   [{ "status": "available"|"partial"|"off", "from": "10:00", "to": "18:00", "note": "" }, ...]
CREATE TABLE IF NOT EXISTS public.availability_weeks (
  member_key TEXT NOT NULL,
  week_start DATE NOT NULL,
  days JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (member_key, week_start)
);
ALTER TABLE IF EXISTS public.availability_weeks ENABLE ROW LEVEL SECURITY;

-- A template can respect the assignees' weekly availability: a generated task
-- whose due date lands on a day someone marked off moves to the next day they
-- all work. NULL due_shifted_from means it was not moved.
ALTER TABLE recurring_tasks ADD COLUMN IF NOT EXISTS respect_availability BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_shifted_from DATE;

ALTER TABLE IF EXISTS public.recurring_tasks ENABLE ROW LEVEL SECURITY;

-- ── Car Stock (immediate-delivery inventory) ──────────────────────────────────
-- Vehicles physically in stock for immediate delivery. One row per make+model+trim
-- (a model may have several trims → several rows). `quantity` = units on hand.
CREATE TABLE IF NOT EXISTS stock_vehicles (
  id          BIGSERIAL PRIMARY KEY,
  make        TEXT NOT NULL,
  model       TEXT NOT NULL,
  trim        TEXT DEFAULT '',
  price       NUMERIC DEFAULT 0,        -- price per car
  quantity    INT NOT NULL DEFAULT 0,   -- units in stock
  notes       TEXT DEFAULT '',
  created_by  TEXT DEFAULT 'dashboard',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_vehicles_make_model ON stock_vehicles (make, model);
ALTER TABLE IF EXISTS public.stock_vehicles ENABLE ROW LEVEL SECURITY;

-- Spec sheet + per-colour stock counts (see migrations/001_…):
--   specs  = { range_km, motor_ps, power_train, drive_train, transmission,
--              battery, top_speed, fast_charge, seats, body, year }
--   colors = [ { "name": "White", "qty": 3 }, … ]  (quantity = SUM of qty)
ALTER TABLE stock_vehicles ADD COLUMN IF NOT EXISTS specs  JSONB DEFAULT '{}'::jsonb;
ALTER TABLE stock_vehicles ADD COLUMN IF NOT EXISTS colors JSONB DEFAULT '[]'::jsonb;

-- ── Contracts (Arabic car import/purchase contract) ───────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id           BIGSERIAL PRIMARY KEY,
  contract_no  TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_id  BIGINT DEFAULT NULL,
  deal_id      BIGINT DEFAULT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | signed | cancelled
  created_by   TEXT DEFAULT 'dashboard',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts (customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_deal     ON contracts (deal_id);
CREATE INDEX IF NOT EXISTS idx_contracts_created  ON contracts (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_deal_unique ON contracts (deal_id) WHERE deal_id IS NOT NULL;
ALTER TABLE IF EXISTS public.contracts ENABLE ROW LEVEL SECURITY;

-- ── Purchase Orders ───────────────────────────────────────────────────────────
-- Vehicle lines live in `items` (JSONB array), one object per sheet row:
--   { client, consignee, units, brand, model, trim, color, year, accessories,
--     payment_term, pi_price, status, vin, file_link }
CREATE TABLE IF NOT EXISTS purchase_orders (
  id           BIGSERIAL PRIMARY KEY,
  po_number    TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  supplier     TEXT DEFAULT '',
  po_date      DATE,
  currency     TEXT NOT NULL DEFAULT 'USD',
  notes        TEXT DEFAULT '',
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_id  BIGINT DEFAULT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | confirmed | closed
  created_by   TEXT DEFAULT 'dashboard',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_customer ON purchase_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created  ON purchase_orders (created_at DESC);
ALTER TABLE IF EXISTS public.purchase_orders ENABLE ROW LEVEL SECURITY;

-- ═══ From migrations/003_logistics_deals_docs.sql ═══════════════════════════
--  Logistics & Shipping, Deals stage rename + Sales, RFQ documents

-- ── 1. Inventory & Logistics: individual physical units per model row ─────────
-- units = [{ consignee, colour, vin, status, price_list, discounted, logistics, supplier }]
-- When units are present they are authoritative for `quantity` (same contract as `colors`).
ALTER TABLE stock_vehicles ADD COLUMN IF NOT EXISTS units JSONB DEFAULT '[]'::jsonb;

-- ── 2. Suppliers register ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  contact    TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  country    TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  created_by TEXT DEFAULT 'dashboard',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (name);
ALTER TABLE IF EXISTS public.suppliers ENABLE ROW LEVEL SECURITY;

-- ── 3. RFQ (Request for Quotation) ────────────────────────────────────────────
-- items = [{ brand, model, trim, colour, year, accessories, lead_time, fob_price, cif_price }]
CREATE TABLE IF NOT EXISTS rfqs (
  id                 BIGSERIAL PRIMARY KEY,
  rfq_no             TEXT UNIQUE NOT NULL,
  title              TEXT NOT NULL DEFAULT '',
  supplier_id        BIGINT DEFAULT NULL,
  supplier_name      TEXT DEFAULT '',
  supplier_contact   TEXT DEFAULT '',
  supplier_address   TEXT DEFAULT '',
  supplier_country   TEXT DEFAULT '',
  issuer             TEXT DEFAULT '',
  rfq_date           DATE,
  items              JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_terms      TEXT DEFAULT '',
  delivery_location  TEXT DEFAULT '',
  service_provider   TEXT DEFAULT '',
  contact            TEXT DEFAULT '',
  documents_required TEXT DEFAULT '',
  customer_id        BIGINT DEFAULT NULL,
  status             TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | answered | closed
  created_by         TEXT DEFAULT 'dashboard',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rfqs_customer ON rfqs (customer_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_created  ON rfqs (created_at DESC);
ALTER TABLE IF EXISTS public.rfqs ENABLE ROW LEVEL SECURITY;

-- ── 4. Deals: Contacted → Inquiry, plus inquiry fields ────────────────────────
ALTER TABLE deals ADD COLUMN IF NOT EXISTS inquiry_details TEXT DEFAULT '';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS est_value NUMERIC(14,2) DEFAULT NULL;

-- Drop the CHECK first so existing rows can be migrated, then re-add with the new list.
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_stage_check;
UPDATE deals SET stage = 'inquiry' WHERE stage = 'contacted';
ALTER TABLE deals ADD CONSTRAINT deals_stage_check
  CHECK (stage IN ('lead','inquiry','quoted','negotiating','won','lost'));
ALTER TABLE deals ALTER COLUMN stage SET DEFAULT 'lead';

-- ── 5. Sales (one sold car; created when a deal is Won) ───────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id               BIGSERIAL PRIMARY KEY,
  deal_id          BIGINT UNIQUE DEFAULT NULL,
  customer_id      BIGINT DEFAULT NULL,
  client           TEXT DEFAULT '',
  consignee        TEXT DEFAULT '',
  brand            TEXT DEFAULT '',
  model            TEXT DEFAULT '',
  trim             TEXT DEFAULT '',
  colour           TEXT DEFAULT '',
  vin              TEXT DEFAULT '',
  status           TEXT DEFAULT 'send_to_supplier',
  sales_name       TEXT DEFAULT '',
  price_list       NUMERIC(14,2) DEFAULT 0,
  down_payment     NUMERIC(14,2) DEFAULT 0,
  discounted       NUMERIC(14,2) DEFAULT 0,
  remaining        NUMERIC(14,2) DEFAULT 0,
  remaining_due    DATE,
  reservation_date DATE,
  payment_type     TEXT DEFAULT '',
  delivery_date    DATE,
  client_file      TEXT DEFAULT '',
  -- Drive reference for client_file (see migrations/007)
  client_file_meta JSONB DEFAULT '{}'::jsonb,
  created_by       TEXT DEFAULT 'dashboard',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_created  ON sales (created_at DESC);
ALTER TABLE IF EXISTS public.sales ENABLE ROW LEVEL SECURITY;

-- ── 6. Purchase orders: supplier link + delivery terms ────────────────────────
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id        BIGINT DEFAULT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_contact   TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_address   TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_country   TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS issuer             TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS quote_id           TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS incoterm           TEXT DEFAULT 'FOB';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_location  TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS service_provider   TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS contact            TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS documents_required TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms      TEXT DEFAULT '';

-- ═══ From migrations/004_task_calendar_nav.sql ══════════════════════════════
-- Google Calendar event created for a task, so edits patch the same event.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS calendar_event_id TEXT DEFAULT NULL;
-- Sidebar layout (order + custom labels) lives in quotation_settings under 'nav_config'.
-- Per-target calendar event ids: { "<employeeId>": eventId, "company": eventId }.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS calendar_events JSONB DEFAULT '{}'::jsonb;

-- ═══ From migrations/019_units_payments_tracking.sql ════════════════════════
-- The physical vehicle as a row of its own, the money that moves against it,
-- and the container it ships in. migrations/019 carries the reasoning; this is
-- here so a fresh install (README step 1) creates them too.

-- One row per physical vehicle. Linked back to the stock row, PO and sale it
-- came from, so it coexists with the older shapes rather than replacing them.
CREATE TABLE IF NOT EXISTS public.vehicle_units (
  id             BIGSERIAL PRIMARY KEY,
  vin            TEXT,
  make           TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  trim           TEXT DEFAULT '',
  model_year     INT,
  colour         TEXT DEFAULT '',
  colour_int     TEXT DEFAULT '',
  engine_no      TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'ordered',
  supplier_id    BIGINT,
  supplier       TEXT DEFAULT '',
  po_id          BIGINT,
  stock_id       BIGINT,
  customer_id    BIGINT,
  deal_id        BIGINT,
  sale_id        BIGINT,
  purchase_ccy   TEXT NOT NULL DEFAULT 'USD',
  purchase_cost  NUMERIC(14,2) NOT NULL DEFAULT 0,
  fx_rate        NUMERIC(14,6) NOT NULL DEFAULT 0,
  freight_cost   NUMERIC(14,2) NOT NULL DEFAULT 0,
  customs_cost   NUMERIC(14,2) NOT NULL DEFAULT 0,
  clearing_cost  NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
  ordered_on     DATE,
  shipped_on     DATE,
  arrived_on     DATE,
  delivered_on   DATE,
  location       TEXT DEFAULT '',
  notes          TEXT DEFAULT '',
  custom_fields  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by     TEXT DEFAULT 'dashboard',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Partial, not a UNIQUE constraint: many units have no VIN yet, and a plain
-- UNIQUE would refuse the second one.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_units_vin_uq
  ON public.vehicle_units (vin) WHERE vin IS NOT NULL AND vin <> '';
CREATE INDEX IF NOT EXISTS vehicle_units_status_idx   ON public.vehicle_units (status);
CREATE INDEX IF NOT EXISTS vehicle_units_customer_idx ON public.vehicle_units (customer_id);
CREATE INDEX IF NOT EXISTS vehicle_units_sale_idx     ON public.vehicle_units (sale_id);
CREATE INDEX IF NOT EXISTS vehicle_units_po_idx       ON public.vehicle_units (po_id);
ALTER TABLE IF EXISTS public.vehicle_units ENABLE ROW LEVEL SECURITY;

-- One row per movement of money. amount_base is stored with the rate it was
-- booked at, never recomputed — the rate on the day is a fact.
CREATE TABLE IF NOT EXISTS public.payments (
  id           BIGSERIAL PRIMARY KEY,
  sale_id      BIGINT,
  unit_id      BIGINT,
  customer_id  BIGINT,
  direction    TEXT NOT NULL DEFAULT 'in',
  kind         TEXT NOT NULL DEFAULT 'instalment',
  method       TEXT DEFAULT '',
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'EGP',
  fx_rate      NUMERIC(14,6) NOT NULL DEFAULT 1,
  amount_base  NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  reference    TEXT DEFAULT '',
  receipt      JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes        TEXT DEFAULT '',
  recorded_by  TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_sale_idx     ON public.payments (sale_id);
CREATE INDEX IF NOT EXISTS payments_unit_idx     ON public.payments (unit_id);
CREATE INDEX IF NOT EXISTS payments_customer_idx ON public.payments (customer_id);
CREATE INDEX IF NOT EXISTS payments_paid_on_idx  ON public.payments (paid_on DESC);
ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;

-- What the carrier's container and voyage cards show, plus a port call log.
CREATE TABLE IF NOT EXISTS public.shipment_containers (
  id             BIGSERIAL PRIMARY KEY,
  container_no   TEXT NOT NULL UNIQUE,
  container_type TEXT DEFAULT '',
  bl_number      TEXT DEFAULT '',
  carrier        TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'in_transit',
  latest_move    TEXT DEFAULT '',
  latest_move_at TIMESTAMPTZ,
  pod_eta        DATE,
  vessel_name    TEXT DEFAULT '',
  vessel_imo     TEXT DEFAULT '',
  pol_code       TEXT DEFAULT '',
  pol_name       TEXT DEFAULT '',
  pod_code       TEXT DEFAULT '',
  pod_name       TEXT DEFAULT '',
  atd            TIMESTAMPTZ,
  eta            TIMESTAMPTZ,
  moves          JSONB NOT NULL DEFAULT '[]'::jsonb,
  po_id          BIGINT,
  supplier       TEXT DEFAULT '',
  notes          TEXT DEFAULT '',
  source         TEXT NOT NULL DEFAULT 'manual',
  last_synced_at TIMESTAMPTZ,
  raw            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by     TEXT DEFAULT 'dashboard',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shipment_containers_status_idx ON public.shipment_containers (status);
CREATE INDEX IF NOT EXISTS shipment_containers_eta_idx    ON public.shipment_containers (pod_eta);
ALTER TABLE IF EXISTS public.shipment_containers ENABLE ROW LEVEL SECURITY;

-- Which vehicles are in which box. Deleting a container drops the links and
-- leaves the vehicles alone.
CREATE TABLE IF NOT EXISTS public.container_units (
  container_id BIGINT NOT NULL REFERENCES public.shipment_containers(id) ON DELETE CASCADE,
  unit_id      BIGINT NOT NULL REFERENCES public.vehicle_units(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (container_id, unit_id)
);
CREATE INDEX IF NOT EXISTS container_units_unit_idx ON public.container_units (unit_id);
ALTER TABLE IF EXISTS public.container_units ENABLE ROW LEVEL SECURITY;

-- ═══ From migrations/020_vessel_position.sql ════════════════════════════════
-- Where the ship actually is. AIS is a separate feed from container tracking —
-- a different vendor and a different key — so the columns are separate and
-- carry their own timestamp: a satellite fix mid-ocean is commonly hours old,
-- and a dot without its age on it claims a precision nobody is paying for.
ALTER TABLE public.shipment_containers
  ADD COLUMN IF NOT EXISTS vessel_lat         NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS vessel_lon         NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS vessel_position_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vessel_course      NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS vessel_speed       NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS position_source    TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS vessel_mmsi        TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS shipment_containers_position_at_idx
  ON public.shipment_containers (vessel_position_at DESC NULLS LAST);
