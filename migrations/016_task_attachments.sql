-- Files attached to a task at creation.
--
-- One JSONB array rather than the four flat columns task_comments, chat_messages
-- and request_comments use, because a task takes several files where a comment
-- takes one. Follows the shape already set by tasks.assignee_ids (schema.sql:418)
-- and tasks.calendar_events (004_task_calendar_nav.sql).
--
-- Each element is the object /api/*/chat/upload already returns:
--   { "url": "...", "name": "...", "size": 12345, "type": "image/png" }
-- so commentAttachHtml() renders it with no change, and no new storage bucket,
-- multer instance or URL shape is introduced.
--
-- Idempotent, like every migration here. Safe to re-run.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Rows created before this column existed read as NULL, and the client maps over
-- the value; normalise them so no caller has to guard.
UPDATE tasks SET attachments = '[]'::jsonb WHERE attachments IS NULL;
