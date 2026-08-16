-- 013: one Drive folder per client
--
-- Quotations, RFQs, purchase orders and contracts are already stored against a
-- lead, but only as rows: sending a client their paperwork meant re-generating
-- each PDF by hand. The lead profile can now create a Drive folder holding all
-- of it, and this is where the folder is remembered — its id and link, which
-- documents have already been filed (so a second sync uploads only what is new),
-- and which employees the admin has allowed to open it.
--
--   { "id": "<drive folder id>", "link": "https://drive.google.com/…",
--     "name": "Ahmed Kamal — 0101234567", "created_at": "…",
--     "docs":    { "quotation:12": { "fileId": "…", "name": "…", "at": "…" } },
--     "viewers": [2, 7] }
--
-- An empty viewers list means admins only — the deliberate default, because the
-- folder holds identity documents. Apply by hand, like every other file here.
-- Idempotent.

ALTER TABLE IF EXISTS public.customers ADD COLUMN IF NOT EXISTS client_folder JSONB DEFAULT '{}'::jsonb;
