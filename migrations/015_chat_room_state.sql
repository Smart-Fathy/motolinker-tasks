-- 015: a conversation you can put away, and a group with a face
--
-- Two things people asked for that the chat had no room for.
--
-- Archiving and hiding are PER MEMBER, which is the whole point: putting a
-- conversation away must not take it off the other person's screen. They live on
-- chat_room_members, one row per person per room, so each side has its own
-- answer. Hiding is not deleting — the messages stay, and a new one brings the
-- conversation back, which is what everybody expects from "delete" in a chat.
--
-- The icon is the group's, shared by everyone in it: an emoji, so setting one
-- needs no upload, no storage and no moderation.
--
-- Apply by hand against the Supabase project. Idempotent.

ALTER TABLE IF EXISTS public.chat_room_members ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE IF EXISTS public.chat_room_members ADD COLUMN IF NOT EXISTS hidden_at   TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE IF EXISTS public.chat_rooms        ADD COLUMN IF NOT EXISTS icon        TEXT DEFAULT '';
