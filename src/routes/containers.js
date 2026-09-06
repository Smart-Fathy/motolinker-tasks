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
// A DATE column. A person's date picker sends YYYY-MM-DD, but every carrier feed
// sends a full ISO timestamp for the same field, and the old strict regex refused
// those outright — so pod_eta came back NULL from every sync, on every provider,
// while the eta timestamp beside it saved fine. The damage was not only a blank
// column: the container list is ordered by pod_eta, so a synced box sorted after
// every hand-typed one instead of by when it actually arrives. A timestamp is
// narrowed to the date the vendor wrote rather than thrown away; anything that is
// not one of those two shapes is still refused.
function dateOrNull(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    // Take the date the VENDOR wrote, not the date that instant falls on in UTC.
    // Sinay reports port local time, so an Alexandria arrival of
    // 2026-09-25T00:00:00+03:00 is the 25th at the quay and 2026-09-24T21:00Z as
    // an instant — and converting first put "24/09" in the POD ETA column of a
    // box the carrier says lands on the 25th. `eta` keeps the exact instant and
    // is rendered in the reader's zone; this column answers "which day does it
    // arrive", and that is a question about the port's calendar.
    return Number.isFinite(Date.parse(s)) ? s.slice(0, 10) : null;
  }
  return null;
}
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
    .map(m => ({
      at: tsOrNull(m.at) || dateOrNull(m.at) || '',
      event: str(m.event, 120),
      place: str(m.place, 120),
      vessel: str(m.vessel, 120),
    }))
    .filter(m => m.at || m.event || m.place)
    // Sort BEFORE the cap. Carriers send their events oldest-first, so capping
    // first kept the sixty oldest and threw away everything recent — the exact
    // opposite of a log whose point is where the box is now.
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, MOVES_MAX);
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
      // A code the client turns into a sentence, so a vendor's JSON error is
      // never rendered at somebody trying to find a container.
      code: prov.ok ? 'ok' : (prov.code || 'error'),
      detail: prov.ok ? null : (prov.detail || null),
      provider_name: providers.containerProviderName(),
      // Registering is a SEPARATE permission from reading — on Terminal49's free
      // key it is the only one that works. So the offer stands whenever the box
      // was not found and the provider supports registration, rather than only
      // when the read succeeded enough to say "not tracked yet". Conditioning it
      // on the read is what hid the one button that would have worked. The
      // provider module decides who supports it, so this cannot offer a button
      // the dispatcher would refuse.
      can_register: !prov.ok && providers.canRegister(),
    });
  });

  // What the tracking settings currently amount to, and — with ?probe=1 — a real
  // call to prove it. Two rounds of "I added the key, is it working?" is what
  // this exists to end: the answer is a button rather than another deploy.
  receiver.router.get(`${base}/containers/provider-status`, guard, requirePerm('stock', 'tracking'), async (req, res) => {
    const status = providers.providerStatus();
    if (String(req.query.probe || '') !== '1') return res.json(status);
    // CSQU3054383 is the ISO 6346 specification's own example number, chosen so
    // the probe passes our validation. It is NOT fictional — the first live run
    // came back with real Hapag-Lloyd tracking data — so this reads one real
    // shipment. That costs a shipment against a metered plan, once per month per
    // number, which is the price of a connection test that actually calls the
    // endpoint it is testing. It registers nothing and writes nothing; the point
    // is the vendor's REPLY, not the data.
    const probe = await providers.lookupContainer('CSQU3054383');
    const reachable = probe.ok || probe.code === 'not-tracked-yet' || probe.code === 'not-found';
    const out = {
      ...status,
      probe: probe.ok ? 'ok' : (probe.code || 'error'),
      // not-tracked-yet means the vendor answered us properly and simply does
      // not watch that box — which is exactly what a working key looks like.
      reachable,
      http: probe.status || null,
      detail: probe.ok ? null : (probe.detail || probe.reason || null),
    };
    // A refused key is the one failure where the app can find the answer itself:
    // the vendor's docs name the header, and if they are unreachable the key is
    // still here to try each candidate with. One request per shape, and only
    // ever from this check — never as a retry on a normal request.
    // Also on 'forbidden'. A refused-but-recognised key is the case the diagnosis
    // was built for — it is the one that separates "your key is wrong" from "your
    // key is fine and this account cannot read containers" — and gating it on 401
    // alone meant the one situation worth diagnosing never got diagnosed.
    if (probe.code === 'unauthorized' || probe.code === 'forbidden') {
      out.auth = await providers.diagnoseAuth();
    }
    res.json(out);
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
    // A PUT carries the FORM, not the row, and containerBuildRow always emits
    // every column — moves as [], po_id as null, supplier as ''. Writing all of
    // that back erased the three things the form has no input for: the port-call
    // log a sync had just filled, the purchase order somebody linked, and the
    // supplier. Correcting one ETA destroyed the timeline. Only the columns the
    // request actually carried are written; the rest keep whatever they hold.
    const patch = {};
    for (const k of Object.keys(row)) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) patch[k] = row[k];
    }
    patch.container_no = row.container_no;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await ctx.writeOptional(
      r => supabase.from('shipment_containers').update(r).eq('id', req.params.id).select().single(), patch, POSITION_COLUMNS);
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
      out.carrier = { ok: false, code: prov.code || 'error', reason: prov.reason, detail: prov.detail || null };
    }

    // 2. The position. A fresh observation every time, so it is NOT put through
    //    mergeSynced — there is no hand-edited ETA to protect, and refusing to
    //    move the dot because someone renamed the vessel would be the wrong kind
    //    of careful. An older fix than the one already stored is still
    //    discarded, because vendors do re-serve stale positions.
    //
    //    Safecube returns the position on the same shipment as the milestones,
    //    so when the carrier already answered there is nothing to buy and
    //    nothing to call: prefer what it gave us over a second round trip.
    const carrierPos = prov.ok && prov.position ? { ok: true, fields: prov.position } : null;
    if (carrierPos || providers.aisConfigured()) {
      const pos = carrierPos
        || await providers.lookupPosition({ imo: cur.data.vessel_imo, mmsi: cur.data.vessel_mmsi });
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
        out.position = { ok: false, code: pos.code || 'error', reason: pos.reason };
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

  // Ask the carrier's platform to start watching a box. On Terminal49 that is
  // the step between "never heard of it" and data arriving on a later refresh.
  // On Safecube reads already work without it — there this attaches the box to
  // a webhook endpoint, so milestones arrive when they happen rather than when
  // somebody opens the page.
  receiver.router.post(`${base}/containers/register`, guard, requirePerm('stock', 'tracking'), express.json(), async (req, res) => {
    const seen = inspectContainerNo(req.body && req.body.container_no);
    if (!seen.valid) return res.status(400).json({ error: 'A container number is four letters then seven digits, like MSDU7337230.' });
    const r = await providers.registerContainer(seen.no, str((req.body || {}).scac, 8).toUpperCase());
    if (!r.ok) return res.status(200).json({ ok: false, code: r.code || 'error', reason: r.reason, detail: r.detail || null });
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

// ── Tracking webhooks ────────────────────────────────────────────────────────
// The push half of the integration, and the one both platforms recommend:
// rather than polling every box, the vendor posts here when a milestone lands.
// Terminal49 and Safecube both send one, and the route serves either — the
// payload is read by SHAPE rather than by a per-vendor path, so a second vendor
// needed a mapper, not a second endpoint.
//
// PUBLIC by necessity — Terminal49 has no session with us — so it is guarded by
// a secret in the path that we generate and paste into their dashboard. Compared
// in constant time, because a plain === on a secret leaks its prefix to anyone
// willing to time the responses. When no secret is configured the route answers
// 404 rather than 403: an endpoint that says "wrong secret" has confirmed it is
// worth attacking.
//
// It only ever UPDATES containers we already track. A webhook may not create
// rows — otherwise anyone who learns the URL can fill the table — and an event
// for a box we do not know is acknowledged and dropped, because returning an
// error would make Terminal49 retry something we will never want.
const crypto = require('crypto');

function webhookSecretOk(given) {
  // TRACKING_WEBHOOK_SECRET is the name to use now that more than one vendor
  // posts here; the Terminal49-specific one keeps working so an already-
  // registered webhook does not break on this deploy.
  const want = process.env.TRACKING_WEBHOOK_SECRET || process.env.TERMINAL49_WEBHOOK_SECRET || '';
  if (!want) return false;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(want);
  // timingSafeEqual throws on a length mismatch, which would itself be a timing
  // signal, so the lengths are compared first and the result is folded in.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Pull every container-shaped record out of a Terminal49 payload, wherever it
// sits. The event envelope differs by event type, so this looks for the shape
// rather than a fixed path.
function webhookContainers(payload) {
  const out = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) { node.forEach(x => walk(x, depth + 1)); return; }
    // JSON:API wraps the number under attributes and names the type; a bare
    // containerNumber counts too, for the generic adapter.
    const a = node.attributes || {};
    const num = (node.type === 'container' && (a.number || a.container_number))
      || node.containerNumber || node.container_number || node.containerNo;
    if (num && !seen.has(node.id || num)) {
      seen.add(node.id || num);
      out.push(node);
    }
    Object.values(node).forEach(v => walk(v, depth + 1));
  };
  walk(payload, 0);
  return out;
}

// The two vendors disagree about what a webhook delivery IS, and flattening
// that difference here keeps the write half below a single path.
//
// Safecube (via Svix) posts a whole SHIPMENT — one metadata block, one route,
// and the containers inside it. Reading a container out of it in isolation
// would throw away the route, the vessel and the position, which live on the
// shipment and not on the box. Terminal49 posts JSON:API records where the
// container IS the unit and the shipment is a sibling to be looked up.
//
// A bill of lading can carry several boxes, so each is mapped against its own
// events rather than against whichever happened to be first.
function webhookUpdates(vendor, payload) {
  const out = [];
  const seen = new Set();
  const add = (no, fields, position) => {
    if (!no || seen.has(no)) return;
    seen.add(no);
    out.push({ no, fields, position });
  };

  if (vendor === 'safecube') {
    const ships = providers.everyObject(payload, 0, [])
      .filter(o => o && Array.isArray(o.containers) && o.containers.length);
    for (const sh of ships) {
      for (const box of sh.containers) {
        add(normContainerNo(box && box.number),
          () => providers.safecubeMap(sh, normContainerNo(box && box.number)),
          () => providers.safecubePosition(sh));
      }
    }
    return out;
  }

  const all = (payload.included || []).concat(payload.data ? [].concat(payload.data) : []);
  for (const rec of webhookContainers(payload)) {
    const a = rec.attributes || {};
    const shipment = providers.t49Related(rec, all, 'shipment')
      || all.find(x => x && x.type === 'shipment') || null;
    add(normContainerNo(a.number || a.container_number
      || rec.containerNumber || rec.container_number || rec.containerNo),
      () => providers.t49Map(rec, shipment), () => null);
  }
  return out;
}

// A delivery that changes nothing looks exactly like success from the vendor's
// side — 200 back, webhook stays green, and nothing here moves. Three different
// causes produce it, and without a line in the log they are indistinguishable:
// the event genuinely carries no container, the container is one we do not
// track, or the payload is shaped differently than webhookContainers expects.
// The last one is the only bug, so an unmatched delivery prints a truncated
// sample to identify the shape. Carrier milestones, not credentials — the
// secret is in the URL path and never in the body.
function logWebhook(vendor, payload, numbers, matched) {
  const head = `[webhook:${vendor}] ${numbers.length} container(s) in payload, ${matched} matched`;
  if (matched) return console.log(`${head} — ${numbers.join(', ')}`);
  const sample = JSON.stringify(payload);
  console.log(`${head}${numbers.length ? ` — ${numbers.join(', ')} (not tracked here)` : ''}`
    + `\n[webhook:${vendor}] keys: ${Object.keys(payload).join(', ') || '(none)'}`
    + `\n[webhook:${vendor}] body: ${sample.length > 2000 ? `${sample.slice(0, 2000)}…[${sample.length}b]` : sample}`);
}

async function handleTrackingWebhook(vendor, req, res) {
  if (!webhookSecretOk(req.params.secret)) return res.sendStatus(404);

  const payload = req.body || {};
  const found = webhookUpdates(vendor, payload);
  if (!found.length) {
    logWebhook(vendor, payload, [], 0);
    return res.json({ ok: true, matched: 0, note: 'no container in this event' });
  }

  let matched = 0;
  const numbers = [];
  for (const upd of found) {
    const no = upd.no;
    numbers.push(no);
    const cur = await supabase.from('shipment_containers').select('*').eq('container_no', no).maybeSingle();
    // Not ours: acknowledge so it is not retried forever, and change nothing.
    if (cur.error || !cur.data) continue;

    const mapped = upd.fields();
    const position = upd.position();
    const built = containerBuildRow({ ...cur.data, ...mapped });
    if (built.error) continue;

    // Same hand-edit guard as a pull: a milestone arriving by push must not
    // overwrite an ETA somebody corrected off a phone call either.
    const patch = mergeSynced(cur.data, built.row);
    // A pushed position is a fresh observation, same as a pulled one, so it goes
    // on outside the hand-edit guard.
    if (position) Object.assign(patch, position);
    if (!Object.keys(patch).length) { matched++; continue; }
    const now = new Date().toISOString();
    patch.source = process.env.CONTAINER_TRACKING_NAME || vendor;
    patch.last_synced_at = now;
    patch.updated_at = now;
    patch.raw = payload;
    await ctx.writeOptional(
      r => supabase.from('shipment_containers').update(r).eq('id', cur.data.id).select().single(),
      patch, POSITION_COLUMNS);
    matched++;
  }
  logWebhook(vendor, payload, numbers, matched);
  res.json({ ok: true, matched });
}

receiver.router.post('/api/webhooks/terminal49/:secret', express.json({ limit: '256kb' }),
  (req, res) => handleTrackingWebhook('terminal49', req, res));
receiver.router.post('/api/webhooks/safecube/:secret', express.json({ limit: '256kb' }),
  (req, res) => handleTrackingWebhook('safecube', req, res));

receiver.router.delete('/api/dashboard/containers/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('shipment_containers').delete().eq('id', req.params.id);
  if (error) return dbFail(res, error, 'Container tracking');
  res.json({ ok: true });
});

// mapProviderPayload moved to tracking-providers.js with the rest of the vendor
// plumbing; re-exported so callers and tests have one place to reach it from.
module.exports = { containerBuildRow, mergeSynced, sanitizeMoves, webhookUpdates,
  mapProviderPayload: providers.mapProviderPayload, providers };
