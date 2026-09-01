// Container tracking.
//
// The team follows arriving vehicles by opening a carrier's site, then pasting
// screenshots into chat. Everything on those screens is structured data — the
// container and its type, where it was last seen, the POD ETA, the ship and its
// IMO, the load and discharge ports, the actual departure and the reported
// arrival — so it lives here instead, attached to the units inside the box.
//
// TWO WAYS IN, on purpose:
//   · A person enters the container number and fills the card in. This works
//     today, needs no account with anybody, and is what the team is already
//     doing by hand.
//   · A provider fills it in, when CONTAINER_TRACKING_URL and _KEY are set.
//     Nothing here depends on a particular vendor: the adapter takes whatever
//     JSON comes back and maps it through one table of aliases.
//
// A sync never overwrites a field a person edited after the last sync — see
// mergeSynced. Getting that backwards would mean the ETA someone corrected off
// a phone call is silently replaced by the stale one the carrier still shows.
//
// src/ctx.js explains the context object.
const ctx = require('../ctx');
const { express, receiver, requireAuth, requireEmployeeAuth, supabase } =
  ctx.need('express', 'receiver', 'requireAuth', 'requireEmployeeAuth', 'supabase');
const requirePerm = (...a) => ctx.requirePerm(...a);

const { CONTAINER_STATUS_KEYS, CONTAINER_TYPES, inspectContainerNo, normContainerNo } = require('../lib/constants');
const { dbFail } = require('./vehicle-units');

const str = (v, max) => String(v ?? '').trim().slice(0, max || 200);

// The columns migrations/020 adds. Migrations here are applied by hand, so a
// deploy can land ahead of the SQL — and a write that fails wholesale because of
// one absent optional column would break the tracking that already works. This
// is the ctx.writeOptional contract: try with them, retry once without.
const POSITION_COLUMNS = ['vessel_lat', 'vessel_lon', 'vessel_position_at',
  'vessel_course', 'vessel_speed', 'vessel_mmsi', 'position_source'];
const dateOrNull = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);
// A coordinate, or null. Out of range is not a coordinate, and 0,0 — Null
// Island, in the Gulf of Guinea — is what a broken feed reports rather than
// where a container ship is.
function coord(v, limit) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < -limit || n > limit) return null;
  return n;
}
function numOrNull(v, min, max) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}
function tsOrNull(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// The port call log. Newest first, capped — a long-haul box accumulates a lot of
// events and this column is read on every list.
const MOVES_MAX = 60;
function sanitizeMoves(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(m => m && typeof m === 'object')
    .slice(0, MOVES_MAX)
    .map(m => ({
      at: tsOrNull(m.at) || dateOrNull(m.at) || '',
      event: str(m.event, 120),
      place: str(m.place, 120),
      vessel: str(m.vessel, 120),
    }))
    .filter(m => m.at || m.event || m.place)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function containerBuildRow(body) {
  const b = body || {};
  const seen = inspectContainerNo(b.container_no);
  if (!seen.valid) {
    return { error: 'A container number is four letters then seven digits, like MSDU7337230.' };
  }
  const type = CONTAINER_TYPES.includes(b.container_type) ? b.container_type : str(b.container_type, 40);
  return {
    row: {
      container_no: seen.no,
      container_type: type,
      bl_number: str(b.bl_number, 60),
      carrier: str(b.carrier, 80),
      status: CONTAINER_STATUS_KEYS.includes(b.status) ? b.status : 'in_transit',
      latest_move: str(b.latest_move, 160),
      latest_move_at: tsOrNull(b.latest_move_at),
      pod_eta: dateOrNull(b.pod_eta),
      vessel_name: str(b.vessel_name, 120),
      // An IMO number is exactly seven digits; anything else is a typo or a
      // vessel name that ended up in the wrong box.
      vessel_imo: String(b.vessel_imo || '').replace(/\D/g, '').slice(0, 7),
      pol_code: str(b.pol_code, 12).toUpperCase(),
      pol_name: str(b.pol_name, 120),
      pod_code: str(b.pod_code, 12).toUpperCase(),
      pod_name: str(b.pod_name, 120),
      atd: tsOrNull(b.atd),
      eta: tsOrNull(b.eta),
      moves: sanitizeMoves(b.moves),
      // Where the ship is. Written by the AIS sync, and by hand when somebody has
      // a position from the agent — hence the same validation either way.
      vessel_lat: coord(b.vessel_lat, 90),
      vessel_lon: coord(b.vessel_lon, 180),
      vessel_position_at: tsOrNull(b.vessel_position_at),
      vessel_course: numOrNull(b.vessel_course, 0, 360),
      vessel_speed: numOrNull(b.vessel_speed, 0, 60),
      vessel_mmsi: String(b.vessel_mmsi || '').replace(/\D/g, '').slice(0, 9),
      position_source: str(b.position_source, 40),
      po_id: b.po_id == null || b.po_id === '' ? null : (Number(b.po_id) || null),
      supplier: str(b.supplier, 120),
      notes: str(b.notes, 2000),
    },
    check: seen,
  };
}

// ── Providers ────────────────────────────────────────────────────────────────
// Both feeds live in src/routes/tracking-providers.js: the carrier one that
// answers "where is my box" (Terminal49 by default) and the AIS one that answers
// "where is the ship". They are separate vendors and separate keys, so they are
// separate adapters, and either can be absent without affecting the other.
const providers = require('./tracking-providers');

// Which of the synced fields may land on the stored row.
//
// The rule: a sync fills blanks always, and overwrites a value only when nobody
// has touched the row since the last sync. `updated_at` moving past
// `last_synced_at` is what "a person edited this" looks like from here, and it
// is the difference between tracking that helps and tracking that undoes your
// corrections.
function mergeSynced(existing, fields) {
  const cur = existing || {};
  const editedByHand = cur.last_synced_at
    && cur.updated_at
    && Date.parse(cur.updated_at) > Date.parse(cur.last_synced_at) + 1000;
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null || v === '') continue;
    const blank = cur[k] == null || cur[k] === '' || (Array.isArray(cur[k]) && !cur[k].length);
    if (blank || !editedByHand) out[k] = v;
  }
  return out;
}
ctx.mergeSyncedContainer = mergeSynced;

// ── Read ──────────────────────────────────────────────────────────────────────
function withUnits(row, links, units) {
  const ids = (links || []).filter(l => l.container_id === row.id).map(l => l.unit_id);
  return { ...row, units: (units || []).filter(u => ids.includes(u.id)) };
}

function mountContainerReads(base, guard) {
  receiver.router.get(`${base}/containers`, guard, requirePerm('stock', 'tracking'), async (req, res) => {
    let q = supabase.from('shipment_containers').select('*');
    const status = String(req.query.status || '').trim();
    if (CONTAINER_STATUS_KEYS.includes(status)) q = q.eq('status', status);
    const search = normContainerNo(req.query.q);
    if (search) q = q.ilike('container_no', `%${search}%`);
    const { data, error } = await q.order('pod_eta', { ascending: true, nullsFirst: false }).limit(500);
    if (error) return dbFail(res, error, 'Container tracking');

    const rows = data || [];
    if (!rows.length) return res.json([]);
    // Two extra reads rather than N: the vehicles in every box on the page.
    let links = [], units = [];
    try {
      const l = await supabase.from('container_units').select('container_id,unit_id').in('container_id', rows.map(r => r.id));
      links = l.data || [];
      if (links.length) {
        const u = await supabase.from('vehicle_units').select('id,vin,make,model,trim,colour,status,customer_id')
          .in('id', [...new Set(links.map(x => x.unit_id))]);
        units = u.data || [];
      }
    } catch (_) { /* register not applied yet — the boxes still list */ }
    res.json(rows.map(r => withUnits(r, links, units)));
  });

  // Look one up by its number. This is the entry point the team asked for: type
  // the container in, get the card. It answers for a box we already track and,
  // when a provider is configured, for one we do not — so the first thing a
  // person does with a new container is find it, not fill a form in.
  receiver.router.get(`${base}/containers/lookup/:no`, guard, requirePerm('stock', 'tracking'), async (req, res) => {
    const seen = inspectContainerNo(req.params.no);
    if (!seen.valid) return res.status(400).json({ error: 'A container number is four letters then seven digits, like MSDU7337230.', check: seen });

    const { data, error } = await supabase.from('shipment_containers').select('*').eq('container_no', seen.no).maybeSingle();
    if (error && !/no rows/i.test(String(error.message || ''))) return dbFail(res, error, 'Container tracking');
    if (data) {
      let links = [], units = [];
      try {
        const l = await supabase.from('container_units').select('container_id,unit_id').eq('container_id', data.id);
        links = l.data || [];
        if (links.length) {
          const u = await supabase.from('vehicle_units').select('*').in('id', links.map(x => x.unit_id));
          units = u.data || [];
        }
      } catch (_) { /* register not applied yet */ }
      return res.json({ found: true, check: seen, container: withUnits(data, links, units) });
    }

    const prov = await providers.lookupContainer(seen.no);
    res.json({
      found: false,
      check: seen,
      // Whatever the provider knew, as a prefill for the create form. Not saved:
      // a lookup is a read, and the person decides whether to start tracking it.
      prefill: prov.ok ? prov.fields : null,
      provider: prov.ok ? 'ok' : prov.reason,
      provider_name: providers.containerProviderName(),
      // Terminal49 only answers for boxes it has been asked to track, so a first
      // lookup legitimately comes back empty. That is an offer to register it,
      // not a failure, and the UI needs to tell those two apart.
      can_register: prov.reason === 'not-tracked-yet' && providers.containerProviderName() === 'terminal49',
    });
  });

  receiver.router.get(`${base}/containers/:id`, guard, requirePerm('stock', 'tracking'), async (req, res) => {
    const { data, error } = await supabase.from('shipment_containers').select('*').eq('id', req.params.id).single();
    if (error) return dbFail(res, error, 'Container tracking');
    let links = [], units = [];
    try {
      const l = await supabase.from('container_units').select('container_id,unit_id').eq('container_id', data.id);
      links = l.data || [];
      if (links.length) {
        const u = await supabase.from('vehicle_units').select('*').in('id', links.map(x => x.unit_id));
        units = u.data || [];
      }
    } catch (_) { /* register not applied yet */ }
    res.json(withUnits(data, links, units));
  });
}
mountContainerReads('/api/dashboard', requireAuth);
mountContainerReads('/api/employee', requireEmployeeAuth);

// ── Write ─────────────────────────────────────────────────────────────────────
function mountContainerWrites(base, guard, who) {
  receiver.router.post(`${base}/containers`, guard, requirePerm('stock', 'tracking'), express.json(), async (req, res) => {
    const { row, error: verr, check } = containerBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.created_by = who(req);
    const { data, error } = await ctx.writeOptional(
      r => supabase.from('shipment_containers').insert(r).select().single(), row, POSITION_COLUMNS);
    if (error) {
      if (/duplicate key/i.test(String(error.message || ''))) {
        return res.status(409).json({ error: `${row.container_no} is already being tracked.` });
      }
      return dbFail(res, error, 'Container tracking');
    }
    // The check digit is reported, never enforced: a number that fails it is
    // usually a typo, but a wrong one printed on a real bill of lading still has
    // to be trackable. The UI shows the warning beside the field.
    res.json({ ...data, check });
  });

  receiver.router.put(`${base}/containers/:id`, guard, requirePerm('stock', 'tracking'), express.json(), async (req, res) => {
    const { row, error: verr, check } = containerBuildRow(req.body);
    if (verr) return res.status(400).json({ error: verr });
    row.updated_at = new Date().toISOString();
    const { data, error } = await ctx.writeOptional(
      r => supabase.from('shipment_containers').update(r).eq('id', req.params.id).select().single(), row, POSITION_COLUMNS);
    if (error) return dbFail(res, error, 'Container tracking');
    res.json({ ...data, check });
  });

  // Pull the latest onto an existing box: the carrier's milestones and the
  // ship's position. They are separate vendors, so each is attempted and
  // reported on its own — having only one of the two configured is a normal
  // setup, and one being down must not hide the other's answer.
  receiver.router.post(`${base}/containers/:id/refresh`, guard, requirePerm('stock', 'tracking'), async (req, res) => {
    const cur = await supabase.from('shipment_containers').select('*').eq('id', req.params.id).single();
    if (cur.error) return dbFail(res, cur.error, 'Container tracking');

    const now = new Date().toISOString();
    const patch = {};
    const out = { ok: false, carrier: null, position: null };

    // 1. The carrier feed, through the hand-edit guard.
    const prov = await providers.lookupContainer(cur.data.container_no);
    if (prov.ok) {
      const built = containerBuildRow({ ...cur.data, ...prov.fields });
      if (built.error) out.carrier = { ok: false, reason: built.error };
      else {
        Object.assign(patch, mergeSynced(cur.data, built.row));
        patch.source = process.env.CONTAINER_TRACKING_NAME || providers.containerProviderName();
        patch.last_synced_at = now;
        patch.raw = prov.raw && typeof prov.raw === 'object' ? prov.raw : {};
        out.carrier = { ok: true };
        out.ok = true;
      }
    } else {
      out.carrier = { ok: false, reason: prov.reason };
    }

    // 2. The AIS feed. A position is a fresh observation every time, so it is
    //    NOT put through mergeSynced — there is no hand-edited ETA to protect,
    //    and refusing to move the dot because someone renamed the vessel would
    //    be the wrong kind of careful. An older fix than the one already stored
    //    is still discarded, because vendors do re-serve stale positions.
    if (providers.aisConfigured()) {
      const pos = await providers.lookupPosition({ imo: cur.data.vessel_imo, mmsi: cur.data.vessel_mmsi });
      if (pos.ok) {
        const had = Date.parse(cur.data.vessel_position_at || '');
        const got = Date.parse(pos.fields.vessel_position_at || '') || Date.now();
        if (!Number.isFinite(had) || got >= had) {
          Object.assign(patch, pos.fields);
          if (!patch.vessel_position_at) patch.vessel_position_at = now;
          out.position = { ok: true, at: patch.vessel_position_at };
          out.ok = true;
        } else {
          out.position = { ok: false, reason: 'the feed returned an older fix than the one already stored' };
        }
      } else {
        out.position = { ok: false, reason: pos.reason };
      }
    }

    if (!Object.keys(patch).length) {
      return res.json({ ...out, changed: 0, container: cur.data });
    }
    patch.updated_at = now;
    const { data, error } = await ctx.writeOptional(
      r => supabase.from('shipment_containers').update(r).eq('id', cur.data.id).select().single(), patch, POSITION_COLUMNS);
    if (error) return dbFail(res, error, 'Container tracking');
    res.json({ ...out, changed: Object.keys(patch).length, container: data });
  });

  // Ask the carrier's platform to start tracking a box it does not know yet.
  // Terminal49 tracks what you have registered, so this is the step between
  // "never heard of it" and data arriving on a later refresh.
  receiver.router.post(`${base}/containers/register`, guard, requirePerm('stock', 'tracking'), express.json(), async (req, res) => {
    const seen = inspectContainerNo(req.body && req.body.container_no);
    if (!seen.valid) return res.status(400).json({ error: 'A container number is four letters then seven digits, like MSDU7337230.' });
    const r = await providers.registerContainer(seen.no, str((req.body || {}).scac, 8).toUpperCase());
    if (!r.ok) return res.status(200).json({ ok: false, reason: r.reason });
    res.json({ ok: true, status: r.status, provider: providers.containerProviderName() });
  });

  // Which vehicles are in the box.
  receiver.router.post(`${base}/containers/:id/units`, guard, requirePerm('stock', 'tracking'), express.json(), async (req, res) => {
    const unitId = Number(req.body && req.body.unit_id);
    if (!(unitId > 0)) return res.status(400).json({ error: 'Pick a vehicle to add.' });
    const { error } = await supabase.from('container_units')
      .upsert({ container_id: Number(req.params.id), unit_id: unitId }, { onConflict: 'container_id,unit_id' });
    if (error) return dbFail(res, error, 'Container tracking');
    res.json({ ok: true });
  });

  receiver.router.delete(`${base}/containers/:id/units/:unitId`, guard, requirePerm('stock', 'tracking'), async (req, res) => {
    const { error } = await supabase.from('container_units').delete()
      .eq('container_id', req.params.id).eq('unit_id', req.params.unitId);
    if (error) return dbFail(res, error, 'Container tracking');
    res.json({ ok: true });
  });
}
mountContainerWrites('/api/dashboard', requireAuth, () => 'dashboard');
mountContainerWrites('/api/employee', requireEmployeeAuth, req => `employee_${req.employee.id}`);

receiver.router.delete('/api/dashboard/containers/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('shipment_containers').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error, 'Container tracking');
  res.json({ ok: true });
});

// mapProviderPayload moved to tracking-providers.js with the rest of the vendor
// plumbing; re-exported so callers and tests have one place to reach it from.
module.exports = { containerBuildRow, mergeSynced, sanitizeMoves,
  mapProviderPayload: providers.mapProviderPayload, providers };
