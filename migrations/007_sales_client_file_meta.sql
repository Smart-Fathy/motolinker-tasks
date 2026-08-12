-- 007 — Record what a client file actually is, not just where it points
--
-- The Drive upload added in Phase 3 writes sales.client_file_meta alongside the
-- link: { fileId, name, size, mimeType, webViewLink }. The column was never
-- created, so every upload succeeded against Drive and then failed on the row
-- update — the file landed in Drive, the user saw an error, and the reference was
-- lost. This adds the column.
--
-- client_file itself is unchanged and still holds the URL, so existing rows and
-- the Sales table link keep working untouched.

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_file_meta JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN sales.client_file_meta IS
  'Drive file reference for client_file: fileId, name, size, mimeType, webViewLink.';
