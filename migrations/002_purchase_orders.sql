-- ═══════════════════════════════════════════════════════════════════════════════
--  Purchase Orders
--  Apply against the CRM Supabase project (uodeaytgsvebjknoucjm).
--  Safe to re-run: every statement is IF NOT EXISTS / additive.
-- ═══════════════════════════════════════════════════════════════════════════════

-- One row per purchase order. The vehicle lines live in `items` (JSONB array),
-- one object per row of the ordering sheet:
--   { client, consignee, units, brand, model, trim, color, year, accessories,
--     payment_term, pi_price, status, vin, file_link }
-- status ∈ send_to_supplier | in_preparation | in_logistics | delivered
CREATE TABLE IF NOT EXISTS purchase_orders (
  id           BIGSERIAL PRIMARY KEY,
  po_number    TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  supplier     TEXT DEFAULT '',
  po_date      DATE,
  currency     TEXT NOT NULL DEFAULT 'USD',
  notes        TEXT DEFAULT '',
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_id  BIGINT DEFAULT NULL,   -- attach to a lead, like quotations/contracts
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | confirmed | closed
  created_by   TEXT DEFAULT 'dashboard',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_customer ON purchase_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created  ON purchase_orders (created_at DESC);

ALTER TABLE IF EXISTS public.purchase_orders ENABLE ROW LEVEL SECURITY;
