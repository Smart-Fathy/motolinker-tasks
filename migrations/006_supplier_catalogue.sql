-- 006 — Supplier catalogue, documents, and a real link from purchases to suppliers
--
-- A supplier was a name and a phone number. Now it also holds what it offers
-- (supplier_vehicles), the paperwork behind it (supplier_docs), and — the point of
-- the exercise — a traceable link from the cars we actually bought back to who
-- supplied them, so "how many from X, at what price, at what lead time" is answered
-- from real purchases rather than quoted prices.

-- ── What a supplier offers ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_vehicles (
  id           BIGSERIAL PRIMARY KEY,
  supplier_id  BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  brand        TEXT NOT NULL DEFAULT '',
  model        TEXT NOT NULL DEFAULT '',
  trim         TEXT DEFAULT '',
  model_year   INT  DEFAULT NULL,
  availability TEXT DEFAULT '',          -- e.g. Pre-order | Available | Not available
  fob_price    NUMERIC(14,2) DEFAULT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  lead_time    TEXT DEFAULT '',          -- free text: "4 to 6 weeks + 7 days"
  accessories  TEXT DEFAULT '',
  notes        TEXT DEFAULT '',
  created_by   TEXT DEFAULT 'dashboard',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_vehicles_supplier ON supplier_vehicles (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_vehicles_model    ON supplier_vehicles (brand, model);
ALTER TABLE IF EXISTS public.supplier_vehicles ENABLE ROW LEVEL SECURITY;

-- ── Supplier paperwork (stored in Google Drive; we keep the reference) ────────
CREATE TABLE IF NOT EXISTS supplier_docs (
  id            BIGSERIAL PRIMARY KEY,
  supplier_id   BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  drive_file_id TEXT DEFAULT '',
  web_link      TEXT DEFAULT '',
  mime_type     TEXT DEFAULT '',
  size_bytes    BIGINT DEFAULT 0,
  uploaded_by   TEXT DEFAULT 'dashboard',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_docs_supplier ON supplier_docs (supplier_id);
ALTER TABLE IF EXISTS public.supplier_docs ENABLE ROW LEVEL SECURITY;

-- ── Purchases point at a supplier record, not a typed-in name ────────────────
-- The column already exists on some deployments (added earlier without a foreign
-- key). ADD COLUMN IF NOT EXISTS would skip the whole statement there, constraint
-- and all, so the reference is added separately and guarded on its own.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id BIGINT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu USING (constraint_name)
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND kcu.table_name = 'purchase_orders'
       AND kcu.column_name = 'supplier_id'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders (supplier_id);

-- Backfill by exact name, case- and whitespace-insensitive. Deliberately strict:
-- a wrong link here silently misattributes purchase history, which is worse than
-- leaving it null for someone to set by hand. Anything unmatched is reported below.
UPDATE purchase_orders po
   SET supplier_id = s.id
  FROM suppliers s
 WHERE po.supplier_id IS NULL
   AND NULLIF(TRIM(po.supplier), '') IS NOT NULL
   AND LOWER(TRIM(po.supplier)) = LOWER(TRIM(s.name));

-- Same for the per-unit supplier written inside stock_vehicles.units.
-- jsonb rebuild: each unit gains supplier_id where its supplier name matches exactly.
UPDATE stock_vehicles sv
   SET units = (
     SELECT jsonb_agg(
       CASE
         WHEN NULLIF(TRIM(u->>'supplier'), '') IS NOT NULL
          AND (u->>'supplier_id') IS NULL
          AND m.id IS NOT NULL
         THEN u || jsonb_build_object('supplier_id', m.id)
         ELSE u
       END ORDER BY ord)
       FROM jsonb_array_elements(sv.units) WITH ORDINALITY AS t(u, ord)
       LEFT JOIN suppliers m ON LOWER(TRIM(m.name)) = LOWER(TRIM(t.u->>'supplier'))
   )
 WHERE COALESCE(jsonb_array_length(COALESCE(sv.units, '[]'::jsonb)), 0) > 0;

-- ── What did not match, for someone to fix by hand ───────────────────────────
-- Run these after applying; both should ideally return no rows.
--
--   SELECT id, po_number, supplier FROM purchase_orders
--    WHERE supplier_id IS NULL AND NULLIF(TRIM(supplier), '') IS NOT NULL;
--
--   SELECT sv.id, sv.make, sv.model, u->>'vin' AS vin, u->>'supplier' AS supplier
--     FROM stock_vehicles sv, jsonb_array_elements(sv.units) u
--    WHERE NULLIF(TRIM(u->>'supplier'), '') IS NOT NULL
--      AND (u->>'supplier_id') IS NULL;

COMMENT ON TABLE supplier_vehicles IS 'What a supplier offers — quoted prices and lead times.';
COMMENT ON TABLE supplier_docs     IS 'Supplier paperwork; the file itself lives in Google Drive.';
