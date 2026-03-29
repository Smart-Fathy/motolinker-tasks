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
--  Optional: Row Level Security (RLS)
-- ============================================================

-- ALTER TABLE tasks     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE hours_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE requests   ENABLE ROW LEVEL SECURITY;
