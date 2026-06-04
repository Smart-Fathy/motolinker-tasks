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

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
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
ALTER TABLE employees ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"requests":true,"drive":true,"sheets":true,"pdfscraper":false,"email":false,"viewAllRequests":false}'::jsonb;

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

CREATE OR REPLACE FUNCTION chat_room_touch()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_rooms SET updated_at = NOW() WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_messages_touch ON chat_messages;
CREATE TRIGGER chat_messages_touch
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_room_touch();

-- ============================================================
--  Optional: Row Level Security (RLS)
-- ============================================================

-- ALTER TABLE tasks     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE hours_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE requests   ENABLE ROW LEVEL SECURITY;
