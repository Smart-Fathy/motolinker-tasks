-- 008 — Cache what a pasted link actually is
--
-- Chat linkifies URLs and shows a preview card built from the page's Open Graph
-- tags. Fetching that page is an outbound request, so it is cached here rather than
-- repeated for every person who scrolls past the same message: one link in a busy
-- room is one fetch, not one per reader.
--
-- Keyed by a hash of the URL rather than the URL itself, because a URL can be longer
-- than an index will comfortably take.

CREATE TABLE IF NOT EXISTS link_previews (
  url_hash    TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  domain      TEXT DEFAULT '',
  title       TEXT DEFAULT '',
  description TEXT DEFAULT '',
  site_name   TEXT DEFAULT '',
  image       TEXT DEFAULT '',
  fetched_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_link_previews_fetched ON link_previews (fetched_at);
ALTER TABLE IF EXISTS public.link_previews ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE link_previews IS
  'Open Graph metadata for links pasted in chat. Refetched when older than 7 days.';
