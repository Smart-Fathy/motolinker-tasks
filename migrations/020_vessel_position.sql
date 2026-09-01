-- 020: where the ship actually is
--
-- 019 drew the voyage as a progress bar interpolated between ATD and ETA, which
-- is honest but is not a position. A real fix comes from AIS — the transponder
-- every merchant ship broadcasts — and AIS is a SEPARATE feed from container
-- tracking, bought from a different vendor. So the columns are separate too, and
-- carry their own timestamp and source.
--
-- The timestamp is the point. Mid-ocean positions come from satellite AIS and
-- are commonly minutes to hours old, so a dot with no age on it implies a
-- precision nobody is paying for. Every screen that draws the dot also draws
-- how old it is, and that needs vessel_position_at to be stored, not inferred
-- from updated_at (which moves whenever anyone edits the row).
--
-- Apply by hand against Supabase, like every other file here. Idempotent.

ALTER TABLE public.shipment_containers
  -- WGS84 decimal degrees. 6 places is ~10cm, far finer than AIS needs, but it
  -- costs nothing and means a position is never rounded on the way in.
  ADD COLUMN IF NOT EXISTS vessel_lat         NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS vessel_lon         NUMERIC(9,6),
  -- When the ship reported it, NOT when we fetched it. These differ by hours on
  -- a satellite fix and the difference is what the UI has to show.
  ADD COLUMN IF NOT EXISTS vessel_position_at TIMESTAMPTZ,
  -- Course over ground in degrees and speed over ground in knots, both as the
  -- transponder reported them. Course points the marker; speed is how the crew
  -- sanity-check a fix that looks wrong.
  ADD COLUMN IF NOT EXISTS vessel_course      NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS vessel_speed       NUMERIC(5,1),
  -- Which AIS vendor supplied it, so a position can be traced back and a vendor
  -- swap is visible in the data rather than only in the environment.
  ADD COLUMN IF NOT EXISTS position_source    TEXT DEFAULT '',
  -- AIS is keyed by MMSI as often as by IMO, and the two are not derivable from
  -- each other. Carriers publish IMO; AIS vendors index both.
  ADD COLUMN IF NOT EXISTS vessel_mmsi        TEXT DEFAULT '';

-- Finding the boxes whose position is stale enough to be worth refreshing.
CREATE INDEX IF NOT EXISTS shipment_containers_position_at_idx
  ON public.shipment_containers (vessel_position_at DESC NULLS LAST);
