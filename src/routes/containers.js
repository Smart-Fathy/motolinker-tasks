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
const dateOrNull = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);
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
      po_id: b.po_id == null || b.po_id === '' ? null : (Number(b.po_id) || null),
      supplier: str(b.supplier, 120),
      notes: str(b.notes, 2000),
    },
    check: seen,
  };
}

// ── Provider adapter ─────────────────────────────────────────────────────────
// Deliberately vendor-neutral. CONTAINER_TRACKING_URL is a template holding
// {container}; the key rides in whichever header CONTAINER_TRACKING_HEADER
// names (default Authorization). Whatever JSON comes back is flattened and read
// through the alias table below, so a new provider is a config change rather
// than a code change — and when nothing is configured this reports that plainly
// instead of failing, because manual entry is a supported way to work, not a
// fallback.
const FIELD_ALIASES = {
  container_type: ['container_type', 'containerType', 'type', 'equipment_type', 'size_type'],
  carrier: ['carrier', 'scac', 'shipping_line', 'line'],
  bl_number: ['bl_number', 'bill_of_lading', 'bol', 'blNumber'],
  latest_move: ['latest_move', 'last_event', 'lastLocation', 'current_location', 'location'],
  latest_move_at: ['latest_move_at', 'last_event_at', 'updated_at', 'last_seen'],
  pod_eta: ['pod_eta', 'podEta', 'eta_pod', 'destination_eta'],
  vessel_name: ['vessel_name', 'vessel', 'vesselName', 'ship_name'],
  vessel_imo: ['vessel_imo', 'imo', 'imo_number', 'vesselImo'],
  pol_code: ['pol_code', 'pol', 'origin_code', 'port_of_loading_code'],
  pol_name: ['pol_name', 'origin', 'port_of_loading'],
  pod_code: ['pod_code', 'pod', 'destination_code', 'port_of_discharge_code'],
  pod_name: ['pod_name', 'destination', 'port_of_discharge'],
  atd: ['atd', 'actual_departure', 'departure_at', 'actualDeparture'],
  eta: ['eta', 'arrival_eta', 'reported_eta', 'estimated_arrival'],
};

// Providers nest their answer differently ({data:{…}}, {container:{…}}, a bare
// object). One shallow flatten means the alias table does not have to know.
function flatten(obj, depth, out) {
  const acc = out || {};
  if (!obj || typeof obj !== 'object' || (depth || 0) > 3) return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, (depth || 0) + 1, acc);
    else if (!(k in acc)) acc[k] = v;
  }
  return acc;
}

function mapProviderPayload(payload) {
  const flat = flatten(payload, 0, {});
  const out = {};
  for (const [field, names] of Object.entries(FIELD_ALIASES)) {
    for (const n of names) {
      if (flat[n] != null && flat[n] !== '') { out[field] = flat[n]; break; }
    }
  }
  const events = (payload && (payload.events || payload.moves || payload.port_calls))
    || (payload && payload.data && (payload.data.events || payload.data.moves));
  if (Array.isArray(events)) {
    out.moves = events.map(e => ({
      at: e.at || e.date || e.timestamp || e.event_time || '',
      event: e.event || e.description || e.status || e.activity || '',
      place: e.place || e.location || e.port || e.facility || '',
      vessel: e.vessel || e.vessel_name || '',
    }));
  }
  return out;
}
ctx.mapContainerPayload = mapProviderPayload;

const PROVIDER_TIMEOUT_MS = 12000;
async function providerLookup(containerNo) {
  const tpl = process.env.CONTAINER_TRACKING_URL;
  const key = process.env.CONTAINER_TRACKING_KEY;
  if (!tpl) return { ok: false, reason: 'not-configured' };
  const url = tpl.includes('{container}')
    ? tpl.replace('{container}', encodeURIComponent(containerNo))
    : tpl + encodeURIComponent(containerNo);
  const headers = { Accept: 'application/json' };
  if (key) headers[process.env.CONTAINER_TRACKING_HEADER || 'Authorization'] = key;

  // A tracking site that hangs must not hang the request that asked for it —
  // the person is looking at a spinner in a modal.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ac.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    if (!r.ok) return { ok: false, reason: `provider returned ${r.status}` };
    if (!json) return { ok: false, reason: 'provider did not return JSON' };
    return { ok: true, fields: mapProviderPayload(json), raw: json };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'provider timed out' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

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

    const prov = await providerLookup(seen.no);
    res.json({
      found: false,
      check: seen,
      // Whatever the provider knew, as a prefill for the create form. Not saved:
      // a lookup is a read, and the person decides whether to start tracking it.
      prefill: prov.ok ? prov.fields : null,
      provider: prov.ok ? 'ok' : prov.reason,
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
    const { data, error } = await supabase.from('shipment_containers').insert(row).select().single();
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
    const { data, error } = await supabase.from('shipment_containers').update(row).eq('id', req.params.id).select().single();
    if (error) return dbFail(res, error, 'Container tracking');
    res.json({ ...data, check });
  });

  // Pull the latest from the provider onto an existing box.
  receiver.router.post(`${base}/containers/:id/refresh`, guard, requirePerm('stock', 'tracking'), async (req, res) => {
    const cur = await supabase.from('shipment_containers').select('*').eq('id', req.params.id).single();
    if (cur.error) return dbFail(res, cur.error, 'Container tracking');

    const prov = await providerLookup(cur.data.container_no);
    if (!prov.ok) return res.status(200).json({ ok: false, reason: prov.reason, container: cur.data });

    const built = containerBuildRow({ ...cur.data, ...prov.fields });
    if (built.error) return res.status(200).json({ ok: false, reason: built.error, container: cur.data });
    const patch = mergeSynced(cur.data, built.row);
    if (!Object.keys(patch).length) {
      return res.json({ ok: true, changed: 0, container: cur.data });
    }
    const now = new Date().toISOString();
    patch.source = process.env.CONTAINER_TRACKING_NAME || 'provider';
    patch.last_synced_at = now;
    patch.updated_at = now;
    patch.raw = prov.raw && typeof prov.raw === 'object' ? prov.raw : {};
    const { data, error } = await supabase.from('shipment_containers').update(patch).eq('id', cur.data.id).select().single();
    if (error) return dbFail(res, error, 'Container tracking');
    res.json({ ok: true, changed: Object.keys(patch).length, container: data });
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

module.exports = { containerBuildRow, mapProviderPayload, mergeSynced, sanitizeMoves };
