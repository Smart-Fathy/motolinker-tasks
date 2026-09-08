-- 020: the container links to the cars the team actually keeps
--
-- 019 built `vehicle_units` as the home for a physical car and hung
-- `container_units` off it by id. In practice that register was never filled in:
-- every car this business owns lives where the team already works, as a unit
-- inside a `stock_vehicles` row, identified by its VIN. So the box on the water
-- could not be linked to a real car — the join pointed at an empty table.
--
-- `container_vehicles` is that link, keyed by the VIN itself: the number the
-- carrier, the customs broker, the paperwork and the customer all use for the
-- same car. It does not care which row the car is described in, which is the
-- point — the description can move without the link breaking.
--
-- Nothing is dropped. `vehicle_units`, `container_units` and `payments.unit_id`
-- stay exactly as they are, holding whatever they hold, so this is additive and
-- reversible by deleting one table.
--
-- Apply by hand against Supabase, like every other file here. Idempotent.

CREATE TABLE IF NOT EXISTS public.container_vehicles (
  container_id BIGINT NOT NULL REFERENCES public.shipment_containers(id) ON DELETE CASCADE,
  -- Stored the way normVin writes it: upper case, letters and digits only. The
  -- car it names may not be recorded anywhere yet, and that is allowed — a VIN
  -- is a fact about a vehicle, not a foreign key into our description of it.
  vin          TEXT NOT NULL,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by    TEXT DEFAULT '',
  PRIMARY KEY (container_id, vin)
);

-- "Which box is this chassis in?" is the question asked from the other side.
CREATE INDEX IF NOT EXISTS container_vehicles_vin_idx ON public.container_vehicles (vin);

-- Same posture as every other table here: RLS on, no policies, reached only by
-- the service key the server holds.
ALTER TABLE public.container_vehicles ENABLE ROW LEVEL SECURITY;
