-- 009: persisted sessions + custom_fields for sales and suppliers
--
-- Sessions lived only in two in-memory Maps, so every Railway restart or deploy
-- logged the whole company out at once — and worse, the portals kept the dead
-- token in localStorage, which surfaced as "blank page" and "Google integration
-- says not authorized" (the raw 401 body rendered by a top-level Connect
-- navigation). The server now writes sessions through to this table on login and
-- reads a missing token back on demand, so a restart is invisible to users.
--
-- custom_fields joins sales and suppliers to the JSONB the customers table has
-- had all along, ahead of the ClickUp-style column engine: entities whose extra
-- fields ride an existing JSON payload (PO/RFQ line items, contracts.data) need
-- nothing here.
--
-- Apply by hand against the Supabase project, like every other file in this
-- directory. Idempotent.

CREATE TABLE IF NOT EXISTS public.sessions (
  token      TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,                  -- 'admin' | 'employee'
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Logins are point lookups by token; the only scan is the age-based cleanup.
CREATE INDEX IF NOT EXISTS idx_sessions_created ON public.sessions (created_at);

ALTER TABLE IF EXISTS public.sales     ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS public.suppliers ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS public.sessions ENABLE ROW LEVEL SECURITY;
