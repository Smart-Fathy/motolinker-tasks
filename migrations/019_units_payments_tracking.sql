-- 019: the vehicle unit, the money that moves against it, and the box it ships in
--
-- Three gaps this closes, in the order they depend on each other.
--
-- 1. THE UNIT. A physical vehicle had no row of its own. `stock_vehicles` is one
--    row per make+model+trim with its units in a JSONB array; `sales.vin` is a
--    loose string; PO lines carry VINs inside `items`. So the thing the whole
--    business talks about — "where is chassis 7337230" — could not be pointed at,
--    costed, or joined to anything. `vehicle_units` is that row. Nothing is moved
--    into it by this migration: the existing shapes keep working, and a unit is
--    linked back to the stock row, the PO and the sale it came from.
--
-- 2. THE MONEY. `sales` holds price_list / down_payment / remaining as three flat
--    numbers, so there is no payment history, no receipt, and no way to age a
--    debt. `payments` is an append-style ledger: one row per instalment actually
--    received (or paid out to a supplier), each carrying the rate it was booked
--    at. Purchases are in USD and sales are in EGP, so a payment that does not
--    record its own rate cannot be reconciled later — amount_base is stored, not
--    recomputed, because the rate on the day is a fact and today's rate is not.
--
-- 3. THE BOX. Vehicles arrive in containers, and the team is tracking them by
--    pasting screenshots out of a carrier site. `shipment_containers` holds what
--    those screens show — container, type, latest move, POD ETA, vessel, IMO,
--    load and discharge ports, ATD and reported ETA — plus a port-call log.
--    `source` is 'manual' when a person typed it and the provider's name when a
--    sync filled it in, so a hand-corrected row is never silently overwritten.
--
-- Apply by hand against Supabase, like every other file here. Idempotent.

-- ── 1. The vehicle unit ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_units (
  id             BIGSERIAL PRIMARY KEY,
  -- Nullable and only unique when present: a unit is ordered, and often shipped,
  -- long before anyone knows its chassis number. A partial index does what a
  -- UNIQUE constraint cannot — allow many NULLs, refuse a duplicate VIN.
  vin            TEXT,
  make           TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  trim           TEXT DEFAULT '',
  model_year     INT,
  colour         TEXT DEFAULT '',
  colour_int     TEXT DEFAULT '',
  engine_no      TEXT DEFAULT '',

  -- Where it is in its life. Ordered → produced → shipped → landed → cleared →
  -- in stock → allocated to a customer → delivered. `cancelled` is the way out.
  status         TEXT NOT NULL DEFAULT 'ordered',

  -- Where it came from
  supplier_id    BIGINT,
  supplier       TEXT DEFAULT '',
  po_id          BIGINT,
  stock_id       BIGINT,

  -- Where it is going
  customer_id    BIGINT,
  deal_id        BIGINT,
  sale_id        BIGINT,

  -- Cost. purchase_cost is in purchase_ccy; fx_rate converts it to the base
  -- currency at the moment of booking. Landed cost is the sum of all of it and
  -- is computed on read rather than stored, so correcting one component cannot
  -- leave a stale total behind.
  purchase_ccy   TEXT NOT NULL DEFAULT 'USD',
  purchase_cost  NUMERIC(14,2) NOT NULL DEFAULT 0,
  fx_rate        NUMERIC(14,6) NOT NULL DEFAULT 0,
  freight_cost   NUMERIC(14,2) NOT NULL DEFAULT 0,
  customs_cost   NUMERIC(14,2) NOT NULL DEFAULT 0,
  clearing_cost  NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,

  ordered_on     DATE,
  shipped_on     DATE,
  arrived_on     DATE,
  delivered_on   DATE,

  location       TEXT DEFAULT '',
  notes          TEXT DEFAULT '',
  -- Whatever the admin added through the Columns editor, same as PO lines and
  -- stock units (see ctx.gridExtras).
  custom_fields  JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_by     TEXT DEFAULT 'dashboard',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_units_vin_uq
  ON public.vehicle_units (vin) WHERE vin IS NOT NULL AND vin <> '';
CREATE INDEX IF NOT EXISTS vehicle_units_status_idx   ON public.vehicle_units (status);
CREATE INDEX IF NOT EXISTS vehicle_units_customer_idx ON public.vehicle_units (customer_id);
CREATE INDEX IF NOT EXISTS vehicle_units_sale_idx     ON public.vehicle_units (sale_id);
CREATE INDEX IF NOT EXISTS vehicle_units_po_idx       ON public.vehicle_units (po_id);

-- ── 2. The payments ledger ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id           BIGSERIAL PRIMARY KEY,
  -- A payment hangs off the sale it settles, and optionally off the exact unit.
  -- Both are nullable so a deposit taken before the sale row exists is still
  -- recordable against the customer.
  sale_id      BIGINT,
  unit_id      BIGINT,
  customer_id  BIGINT,

  -- 'in' is money from the customer, 'out' is money to a supplier or a
  -- forwarder. One table, because a unit's cash position is both.
  direction    TEXT NOT NULL DEFAULT 'in',
  kind         TEXT NOT NULL DEFAULT 'instalment',
  method       TEXT DEFAULT '',

  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'EGP',
  -- The rate used on the day, and the base-currency figure it produced. Stored,
  -- not derived: re-deriving it later would rewrite history every time the rate
  -- moves, which for an importer is every week.
  fx_rate      NUMERIC(14,6) NOT NULL DEFAULT 1,
  amount_base  NUMERIC(14,2) NOT NULL DEFAULT 0,

  paid_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  reference    TEXT DEFAULT '',
  -- {url,name,size,type} from the shared upload route — the receipt or transfer
  -- slip. Same shape and the same server-side check as a task attachment.
  receipt      JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes        TEXT DEFAULT '',

  recorded_by  TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_sale_idx     ON public.payments (sale_id);
CREATE INDEX IF NOT EXISTS payments_unit_idx     ON public.payments (unit_id);
CREATE INDEX IF NOT EXISTS payments_customer_idx ON public.payments (customer_id);
CREATE INDEX IF NOT EXISTS payments_paid_on_idx  ON public.payments (paid_on DESC);

-- ── 3. Container tracking ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipment_containers (
  id             BIGSERIAL PRIMARY KEY,
  -- ISO 6346: four letters then seven digits, stored upper-case with no spaces.
  container_no   TEXT NOT NULL UNIQUE,
  container_type TEXT DEFAULT '',
  bl_number      TEXT DEFAULT '',
  carrier        TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'in_transit',

  -- The container card: where it was last seen and when it is due.
  latest_move    TEXT DEFAULT '',
  latest_move_at TIMESTAMPTZ,
  pod_eta        DATE,

  -- The voyage card: the ship and the leg it is on.
  vessel_name    TEXT DEFAULT '',
  vessel_imo     TEXT DEFAULT '',
  pol_code       TEXT DEFAULT '',
  pol_name       TEXT DEFAULT '',
  pod_code       TEXT DEFAULT '',
  pod_name       TEXT DEFAULT '',
  atd            TIMESTAMPTZ,
  eta            TIMESTAMPTZ,

  -- Port call log: [{ at, event, place, vessel }] newest first.
  moves          JSONB NOT NULL DEFAULT '[]'::jsonb,

  po_id          BIGINT,
  supplier       TEXT DEFAULT '',
  notes          TEXT DEFAULT '',

  -- 'manual' when a person typed the row, otherwise the provider that filled it.
  -- A sync refuses to clobber fields a person edited after the last sync.
  source         TEXT NOT NULL DEFAULT 'manual',
  last_synced_at TIMESTAMPTZ,
  raw            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_by     TEXT DEFAULT 'dashboard',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shipment_containers_status_idx ON public.shipment_containers (status);
CREATE INDEX IF NOT EXISTS shipment_containers_eta_idx    ON public.shipment_containers (pod_eta);

-- Which vehicles are in which box. A 40' high cube carries several, and a unit
-- can in principle be re-stuffed, so this is a join table rather than a column.
CREATE TABLE IF NOT EXISTS public.container_units (
  container_id BIGINT NOT NULL REFERENCES public.shipment_containers(id) ON DELETE CASCADE,
  unit_id      BIGINT NOT NULL REFERENCES public.vehicle_units(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (container_id, unit_id)
);
CREATE INDEX IF NOT EXISTS container_units_unit_idx ON public.container_units (unit_id);
