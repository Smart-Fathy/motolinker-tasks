-- 011: weekly availability
--
-- Each user marks the upcoming week — per day: available (with optional hours),
-- partial, or off — so anyone on the platform can see whether a colleague can
-- be contacted right now, before pinging them. One row per person per week;
-- member_key follows the presence convention ('admin' | 'employee_<id>') so the
-- admin participates like everyone else.
--
-- days is a 7-slot array (Monday first):
--   [{ "status": "available"|"partial"|"off", "from": "10:00", "to": "18:00", "note": "" }, ...]
--
-- Apply by hand against the Supabase project. Idempotent.

CREATE TABLE IF NOT EXISTS public.availability_weeks (
  member_key TEXT NOT NULL,
  week_start DATE NOT NULL,
  days JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (member_key, week_start)
);

ALTER TABLE IF EXISTS public.availability_weeks ENABLE ROW LEVEL SECURITY;
