-- 012: configurable fields on the documents themselves
--
-- The column engine reached line items and registers but not the documents
-- above them: an RFQ's Status, a PO's header block. Those are fields too, and
-- an admin can now add their own beside them — "Shipping agent", "Bank",
-- whatever this company needs on every RFQ.
--
-- Only two tables need storage. Contracts and quotations already carry a `data`
-- JSONB and keep their extras inside it; stock keeps its own. Sales and
-- suppliers got theirs in 009.
--
-- Apply by hand against the Supabase project, like every other file in this
-- directory. Idempotent — and the server tolerates its absence: a write that
-- carries custom_fields against a database without the column retries without
-- it (src/ctx.js writeOptional) rather than losing the record.

ALTER TABLE IF EXISTS public.rfqs            ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS public.purchase_orders ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
