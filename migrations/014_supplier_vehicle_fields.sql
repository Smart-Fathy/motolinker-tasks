-- 014: configurable fields on the supplier catalogue
--
-- The grid under a supplier's Vehicles tab was the last one with a frozen column
-- list: brand, model, trim, year, availability, FOB price, lead time,
-- accessories, and nothing else. It reads its columns from the shared engine now
-- like every other grid, and this is where an admin-added field's value lives.
--
-- Apply by hand against the Supabase project, like every other file here. The
-- server tolerates its absence (src/ctx.js writeOptional): a save on a database
-- without this column keeps everything except the extra fields. Idempotent.

ALTER TABLE IF EXISTS public.supplier_vehicles ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
