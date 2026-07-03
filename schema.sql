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

-- Notification setting for deal-contacted alert
INSERT INTO quotation_settings (key, value) VALUES ('contact_notify_employee_id', '')
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
