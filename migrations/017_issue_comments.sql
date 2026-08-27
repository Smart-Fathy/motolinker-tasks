-- Issue conversation: the CTO answers the ticket, the reporter answers back.
-- Mirrors request_comments so the portal's comment thread renders both the same way.
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

-- Who closed it and when, so the reporter's "solved" notice can name them.
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS resolved_by TEXT DEFAULT '';
