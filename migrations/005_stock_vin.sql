-- 005 — Stock is tracked per VIN
--
-- `units` (each with its own VIN) becomes the only source of truth for how many
-- cars exist. `quantity` and the per-colour counts were summaries; they stop being
-- authoritative here.
--
-- Nothing is generated and nothing is destroyed. The old count is copied into
-- legacy_count purely so a model with no units yet can say "3 cars were recorded
-- here before per-VIN tracking — add their VINs". It is never counted as stock.
--
-- Expect stock totals to read lower immediately after this runs, until VINs are
-- entered. That is deliberate: a number nobody can trace to a car is worse than
-- an honest gap.

ALTER TABLE stock_vehicles ADD COLUMN IF NOT EXISTS legacy_count INT DEFAULT NULL;

-- Snapshot the pre-migration figure once, and only where units are not yet in use.
UPDATE stock_vehicles
   SET legacy_count = GREATEST(
         COALESCE(quantity, 0),
         COALESCE((SELECT SUM(COALESCE((c->>'qty')::int, 0))
                     FROM jsonb_array_elements(COALESCE(colors, '[]'::jsonb)) AS c), 0)
       )
 WHERE legacy_count IS NULL
   AND COALESCE(jsonb_array_length(COALESCE(units, '[]'::jsonb)), 0) = 0;

-- Zero is not worth warning about
UPDATE stock_vehicles SET legacy_count = NULL WHERE legacy_count = 0;

-- quantity is now derived (units.length) and written by the app on every save.
-- Bring existing rows in line so nothing reads a stale total in the meantime.
UPDATE stock_vehicles
   SET quantity = COALESCE(jsonb_array_length(COALESCE(units, '[]'::jsonb)), 0);

COMMENT ON COLUMN stock_vehicles.quantity IS
  'Derived from units.length by the app. Do not write directly.';
COMMENT ON COLUMN stock_vehicles.legacy_count IS
  'Pre-migration count, kept only to prompt for missing VINs. Never counted as stock.';
