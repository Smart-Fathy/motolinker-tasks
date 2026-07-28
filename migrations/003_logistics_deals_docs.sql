-- ═══════════════════════════════════════════════════════════════════════════════
--  Logistics & Shipping, Deals stage rename + Sales, RFQ documents
--  Apply against the CRM Supabase project (uodeaytgsvebjknoucjm).
--  Safe to re-run: additive / idempotent throughout.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Inventory & Logistics: individual physical units per model row ─────────
-- units = [{ consignee, colour, vin, status, price_list, discounted, logistics, supplier }]
-- When units are present they are authoritative for `quantity` (same contract as `colors`).
ALTER TABLE stock_vehicles ADD COLUMN IF NOT EXISTS units JSONB DEFAULT '[]'::jsonb;

-- ── 2. Suppliers register ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  contact    TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  country    TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  created_by TEXT DEFAULT 'dashboard',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (name);
ALTER TABLE IF EXISTS public.suppliers ENABLE ROW LEVEL SECURITY;

-- ── 3. RFQ (Request for Quotation) ────────────────────────────────────────────
-- items = [{ brand, model, trim, colour, year, accessories, lead_time, fob_price, cif_price }]
CREATE TABLE IF NOT EXISTS rfqs (
  id                 BIGSERIAL PRIMARY KEY,
  rfq_no             TEXT UNIQUE NOT NULL,
  title              TEXT NOT NULL DEFAULT '',
  supplier_id        BIGINT DEFAULT NULL,
  supplier_name      TEXT DEFAULT '',
  supplier_contact   TEXT DEFAULT '',
  supplier_address   TEXT DEFAULT '',
  supplier_country   TEXT DEFAULT '',
  issuer             TEXT DEFAULT '',
  rfq_date           DATE,
  items              JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_terms      TEXT DEFAULT '',
  delivery_location  TEXT DEFAULT '',
  service_provider   TEXT DEFAULT '',
  contact            TEXT DEFAULT '',
  documents_required TEXT DEFAULT '',
  customer_id        BIGINT DEFAULT NULL,
  status             TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | answered | closed
  created_by         TEXT DEFAULT 'dashboard',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rfqs_customer ON rfqs (customer_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_created  ON rfqs (created_at DESC);
ALTER TABLE IF EXISTS public.rfqs ENABLE ROW LEVEL SECURITY;

-- ── 4. Deals: Contacted → Inquiry, plus inquiry fields ────────────────────────
ALTER TABLE deals ADD COLUMN IF NOT EXISTS inquiry_details TEXT DEFAULT '';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS est_value NUMERIC(14,2) DEFAULT NULL;

-- Drop the CHECK first so existing rows can be migrated, then re-add with the new list.
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_stage_check;
UPDATE deals SET stage = 'inquiry' WHERE stage = 'contacted';
ALTER TABLE deals ADD CONSTRAINT deals_stage_check
  CHECK (stage IN ('lead','inquiry','quoted','negotiating','won','lost'));
ALTER TABLE deals ALTER COLUMN stage SET DEFAULT 'lead';

-- ── 5. Sales (one sold car; created when a deal is Won) ───────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id               BIGSERIAL PRIMARY KEY,
  deal_id          BIGINT UNIQUE DEFAULT NULL,
  customer_id      BIGINT DEFAULT NULL,
  client           TEXT DEFAULT '',
  consignee        TEXT DEFAULT '',
  brand            TEXT DEFAULT '',
  model            TEXT DEFAULT '',
  trim             TEXT DEFAULT '',
  colour           TEXT DEFAULT '',
  vin              TEXT DEFAULT '',
  status           TEXT DEFAULT 'send_to_supplier',
  sales_name       TEXT DEFAULT '',
  price_list       NUMERIC(14,2) DEFAULT 0,
  down_payment     NUMERIC(14,2) DEFAULT 0,
  discounted       NUMERIC(14,2) DEFAULT 0,
  remaining        NUMERIC(14,2) DEFAULT 0,
  remaining_due    DATE,
  reservation_date DATE,
  payment_type     TEXT DEFAULT '',
  delivery_date    DATE,
  client_file      TEXT DEFAULT '',
  created_by       TEXT DEFAULT 'dashboard',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_created  ON sales (created_at DESC);
ALTER TABLE IF EXISTS public.sales ENABLE ROW LEVEL SECURITY;

-- ── 6. Purchase orders: supplier link + delivery terms ────────────────────────
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id        BIGINT DEFAULT NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_contact   TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_address   TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_country   TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS issuer             TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS quote_id           TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS incoterm           TEXT DEFAULT 'FOB';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_location  TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS service_provider   TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS contact            TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS documents_required TEXT DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms      TEXT DEFAULT '';
