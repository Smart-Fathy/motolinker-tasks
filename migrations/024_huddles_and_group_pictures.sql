-- 024: meeting threads for huddles, and a picture for every group
--
-- A huddle used to leave nothing behind: the roster lives in the server's memory and
-- the call itself is peer to peer. Now each huddle is a session — from its first join
-- to its last leave — and carries a thread, the text the people in the call write to
-- each other. The thread outlives the call:
--
--   huddle_sessions      one row per huddle: the room, who started it, when it ran
--   huddle_participants  everyone who was ever in it, once each. A guest pulled into
--                        the call from outside the conversation keeps the thread of
--                        the meeting they were in through this row — never the room's
--                        messages, which they were never given
--   huddle_messages      the thread itself
--
-- Who may read and write a thread is decided by the server (src/routes/huddles.js):
-- anyone in the conversation, and anyone in huddle_participants for that session.
--
-- chat_rooms.avatar_url is the group's picture. It replaces the emoji icon wherever a
-- group is drawn; the icon column stays, and is still shown for a group that has no
-- picture yet.
--
-- Nothing here is needed for the app to boot or for a huddle to connect: without it a
-- call works as before, the thread panel says the migration is missing, and setting a
-- group picture answers 409 saying the same.
--
-- Apply by hand against the Supabase project, like every other file in this
-- directory. Idempotent.

CREATE TABLE IF NOT EXISTS public.huddle_sessions (
  id          BIGSERIAL PRIMARY KEY,
  room_id     BIGINT NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  host_key    TEXT NOT NULL,                       -- who started it: 'admin' | 'employee_<id>'
  host_name   TEXT NOT NULL DEFAULT '',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ                          -- NULL while it runs
);
-- "The huddles in this conversation", newest first, and "the one still open here".
CREATE INDEX IF NOT EXISTS idx_huddle_sessions_room ON public.huddle_sessions (room_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.huddle_participants (
  session_id  BIGINT NOT NULL REFERENCES public.huddle_sessions(id) ON DELETE CASCADE,
  member_key  TEXT NOT NULL,
  member_name TEXT NOT NULL DEFAULT '',
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, member_key)
);
-- "The huddles I was in", for a guest who is not in the conversation.
CREATE INDEX IF NOT EXISTS idx_huddle_participants_member ON public.huddle_participants (member_key, session_id DESC);

CREATE TABLE IF NOT EXISTS public.huddle_messages (
  id          BIGSERIAL PRIMARY KEY,
  session_id  BIGINT NOT NULL REFERENCES public.huddle_sessions(id) ON DELETE CASCADE,
  room_id     BIGINT NOT NULL,
  sender_key  TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_huddle_messages_session ON public.huddle_messages (session_id, created_at);

ALTER TABLE IF EXISTS public.chat_rooms ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';

-- Same posture as every other table: RLS on with no policies, so only the service
-- role the server uses can read or write them.
ALTER TABLE IF EXISTS public.huddle_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.huddle_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.huddle_messages     ENABLE ROW LEVEL SECURITY;
