-- ═══════════════════════════════════════════════════════════════════════════════
--  Task → Google Calendar event link
--  Apply against the CRM Supabase project (uodeaytgsvebjknoucjm).
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Google Calendar event created for this task, so edits patch the same event
-- instead of creating duplicates.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS calendar_event_id TEXT DEFAULT NULL;

-- The sidebar layout (order + custom labels) is stored in the existing
-- quotation_settings key/value table under the key 'nav_config' — no DDL needed.
