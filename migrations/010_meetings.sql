-- 010: scheduled meetings
--
-- Until now "Meet" was a link launcher — meet.google.com/new in a new tab, no
-- record, nothing on anyone's calendar. Meetings are rows now: scheduled with
-- attendees from either portal, synced onto every attendee's Google Calendar
-- through the same token machinery tasks use, with a Meet link minted by the
-- company calendar when none is supplied.
--
-- attendee_ids mirrors tasks.assignee_ids (employee ids as strings);
-- calendar_events mirrors tasks.calendar_events (per-target event ids, so a
-- reschedule PATCHes instead of duplicating and a cancellation can clean up).
--
-- Apply by hand against the Supabase project. Idempotent.

CREATE TABLE IF NOT EXISTS public.meetings (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  duration_min INT DEFAULT 30,
  attendee_ids JSONB DEFAULT '[]'::jsonb,
  meet_link TEXT DEFAULT '',
  calendar_events JSONB DEFAULT '{}'::jsonb,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_starts ON public.meetings (starts_at);

ALTER TABLE IF EXISTS public.meetings ENABLE ROW LEVEL SECURITY;
