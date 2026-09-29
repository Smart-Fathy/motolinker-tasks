-- 022: the Accounting section — operating expenses and saved finance reports
--
-- Money already moves through the ledger (019): every customer instalment and
-- every supplier, freight or customs payment is a row. What the company SPENDS
-- on itself — rent, salaries, marketing, utilities, government fees, software —
-- had no row anywhere, so "did we make money this month" could only ever mean
-- "sales minus supplier payments", which is a gross margin, not a result.
--
-- 1. EXPENSES. One row per operating expense, shaped like a payment: the amount
--    in the currency it was paid, the rate it was booked at, and the base-currency
--    figure stored rather than recomputed — the rate on the day is a fact and
--    today's rate is not. `category` is a fixed vocabulary (src/lib/constants.js
--    EXPENSE_CATEGORY_KEYS) so a report can group it; `receipt` carries one
--    uploaded file through the same allowlist a task attachment goes through.
--
-- 2. ACCOUNTING REPORTS. A generated finance report is kept with the exact
--    figures it was written from (`pack`) next to the narrative the AI wrote,
--    so reopening a report months later shows what the numbers WERE, not what
--    the same query says today. `narrative` is empty when no AI key was set —
--    the tables alone are still a report.
--
-- Apply by hand against Supabase, like every other file here. Idempotent.
-- RLS is enabled with no policies, as on every table: only the service key
-- reaches these rows.

CREATE TABLE IF NOT EXISTS public.expenses (
  id           BIGSERIAL PRIMARY KEY,
  spent_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  category     TEXT NOT NULL DEFAULT 'other',
  description  TEXT DEFAULT '',
  vendor       TEXT DEFAULT '',
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'EGP',
  fx_rate      NUMERIC(14,6) NOT NULL DEFAULT 1,
  amount_base  NUMERIC(14,2) NOT NULL DEFAULT 0,
  method       TEXT DEFAULT '',
  reference    TEXT DEFAULT '',
  receipt      JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes        TEXT DEFAULT '',
  recorded_by  TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS expenses_spent_on_idx ON public.expenses (spent_on DESC);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON public.expenses (category);
ALTER TABLE IF EXISTS public.expenses ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.accounting_reports (
  id           BIGSERIAL PRIMARY KEY,
  period_from  DATE NOT NULL,
  period_to    DATE NOT NULL,
  period_label TEXT DEFAULT '',
  lang         TEXT NOT NULL DEFAULT 'en',
  pack         JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative    TEXT DEFAULT '',
  model        TEXT DEFAULT '',
  created_by   TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS accounting_reports_period_idx ON public.accounting_reports (period_from DESC, id DESC);
ALTER TABLE IF EXISTS public.accounting_reports ENABLE ROW LEVEL SECURITY;
