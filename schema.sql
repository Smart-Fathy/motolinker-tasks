-- ============================================================
--  MotoLinker Task Bot — Supabase Schema
--  Run this in your Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id             BIGSERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT DEFAULT '',
  channel_id     TEXT NOT NULL,          -- Slack channel ID (e.g. C0123ABCDEF)
  channel_name   TEXT NOT NULL,          -- Display name (e.g. #marketing)
  assignee_id    TEXT NOT NULL,          -- Slack user ID
  due_date       DATE NOT NULL,
  priority       TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  milestone      TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo', 'in_progress', 'done')),
  created_by     TEXT NOT NULL,          -- Slack user ID of the chief who created
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast channel-based lookups (each channel fetches its own tasks)
CREATE INDEX IF NOT EXISTS idx_tasks_channel_id ON tasks (channel_id);

-- Index for assignee lookups
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks (assignee_id);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================
--  Optional: Row Level Security (RLS)
--  Enable if you want extra DB-level protection.
--  The bot uses a service key so it bypasses RLS by default.
-- ============================================================

-- ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
