-- ═══════════════════════════════════════════════════════════════════════════════
--  Car Stock specs/colours + Contracts
--  Apply against the CRM Supabase project (uodeaytgsvebjknoucjm).
--  Safe to re-run: every statement is IF NOT EXISTS / additive.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Car Stock: per-car spec sheet + per-colour stock counts ─────────────────
-- specs  : { range_km, motor_ps, power_train, drive_train, transmission,
--            battery, top_speed, fast_charge, seats, body, year }
-- colors : [ { "name": "White", "qty": 3 }, { "name": "Black", "qty": 2 } ]
--          `quantity` stays the single source of truth for total units and is
--          kept in sync with SUM(colors[].qty) whenever colours are supplied.
ALTER TABLE stock_vehicles ADD COLUMN IF NOT EXISTS specs  JSONB DEFAULT '{}'::jsonb;
ALTER TABLE stock_vehicles ADD COLUMN IF NOT EXISTS colors JSONB DEFAULT '[]'::jsonb;

-- ── 2. Contracts (Arabic car import/purchase contract) ────────────────────────
-- One row per generated contract. `data` holds every prefilled field so the
-- contract can be reopened, edited and re-rendered identically.
CREATE TABLE IF NOT EXISTS contracts (
  id           BIGSERIAL PRIMARY KEY,
  contract_no  TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_id  BIGINT DEFAULT NULL,
  deal_id      BIGINT DEFAULT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | signed | cancelled
  created_by   TEXT DEFAULT 'dashboard',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts (customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_deal     ON contracts (deal_id);
CREATE INDEX IF NOT EXISTS idx_contracts_created  ON contracts (created_at DESC);
-- One auto-generated contract per deal (the Won-stage trigger relies on this).
CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_deal_unique ON contracts (deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE IF EXISTS public.contracts ENABLE ROW LEVEL SECURITY;
