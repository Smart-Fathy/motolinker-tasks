// Where tracking data comes from: the carrier feed, and the AIS feed.
//
// TWO DIFFERENT PRODUCTS, bought separately, so two adapters.
//
//   container  — "where is my box, and when does it land". Terminal49 by
//                default; `generic` for any other vendor with a GET-by-number
//                URL. Milestones change a few times a voyage.
//   position   — "where is the ship right now". AIS, from a vendor like
//                VesselFinder or Datalastic. Changes continuously, and mid-ocean
//                fixes come from satellites and are commonly hours old.
//
// Nothing here throws. Every function answers { ok:false, reason } instead,
// because "no tracking vendor configured" is a normal state for this app —
// typing the card in by hand is supported, not a fallback — and a vendor being
// down must never take a page with it.
//
// src/ctx.js explains the context object.
const ctx = require('../ctx');

const TIMEOUT_MS = 12000;

// What went wrong, in a word the UI can act on.
//
// The distinction that matters here is between "your key is wrong" and "your key
// is right but your PLAN does not include this". Terminal49's free Developer Key
// authenticates fine and may create tracking requests; reading a container back
// needs a paid plan, and it says so in a 401 rather than a 402. Reporting that as
// an auth failure would send somebody hunting for a key that is not broken.
function classify(status, text) {
  const t = String(text || '').toLowerCase();
  if (/paid plan|billing|upgrade|subscription|not included in your plan/.test(t)) return 'plan-required';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'provider-down';
  return 'error';
}

// One fetch with a deadline. A tracking site that hangs must not hang the person
// watching a spinner in a modal.
async function getJson(url, headers, opts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), (opts && opts.timeout) || TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: (opts && opts.method) || 'GET',
      headers: { Accept: 'application/json', ...(headers || {}) },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ac.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    if (!r.ok) {
      // A vendor's own message is the useful part, but it is a JSON blob and the
      // UI must never shout one at a salesperson. So it is CLASSIFIED here into
      // a code the client turns into a sentence, and the raw text rides along as
      // `detail` for a tooltip and the logs.
      const detail = json && (json.errors || json.error || json.message);
      const text = String(JSON.stringify(detail) || '').slice(0, 400);
      return { ok: false, status: r.status, code: classify(r.status, text), detail: text,
        reason: `provider returned ${r.status}` };
    }
    if (!json) return { ok: false, reason: 'provider did not return JSON' };
    return { ok: true, json };
  } catch (e) {
    return { ok: false, code: e.name === 'AbortError' ? 'timeout' : 'unreachable',
      reason: e.name === 'AbortError' ? 'provider timed out' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Generic vendor ───────────────────────────────────────────────────────────
// Any API with a GET-by-container-number URL. The response is flattened and read
// through an alias table, so a vendor swap is configuration rather than code.
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

// Vendors nest their answer differently ({data:{…}}, {container:{…}}, a bare
// object), so one shallow flatten means the alias table does not have to know.
// Arrays are skipped on purpose: an events list is handled separately below, and
// descending into it would let the last port call overwrite the shipment's own
// fields.
function flatten(obj, depth, out) {
  const acc = out || {};
  if (!obj || typeof obj !== 'object' || (depth || 0) > 3) return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, (depth || 0) + 1, acc);
    else if (!(k in acc)) acc[k] = v;
  }
  return acc;
}

function readAliases(flat) {
  const out = {};
  for (const [field, names] of Object.entries(FIELD_ALIASES)) {
    for (const n of names) {
      if (flat[n] != null && flat[n] !== '') { out[field] = flat[n]; break; }
    }
  }
  return out;
}

function readEvents(payload) {
  const events = (payload && (payload.events || payload.moves || payload.port_calls))
    || (payload && payload.data && (payload.data.events || payload.data.moves));
  if (!Array.isArray(events)) return null;
  return events.map(e => ({
    at: e.at || e.date || e.timestamp || e.event_time || '',
    event: e.event || e.description || e.status || e.activity || '',
    place: e.place || e.location || e.port || e.facility || '',
    vessel: e.vessel || e.vessel_name || '',
  }));
}

function mapProviderPayload(payload) {
  const out = readAliases(flatten(payload, 0, {}));
  const moves = readEvents(payload);
  if (moves) out.moves = moves;
  return out;
}

async function genericLookup(containerNo) {
  const tpl = process.env.CONTAINER_TRACKING_URL;
  const key = process.env.CONTAINER_TRACKING_KEY;
  if (!tpl) return { ok: false, code: 'not-configured', reason: 'not-configured' };
  const url = tpl.includes('{container}')
    ? tpl.replace('{container}', encodeURIComponent(containerNo))
    : tpl + encodeURIComponent(containerNo);
  const headers = {};
  if (key) headers[process.env.CONTAINER_TRACKING_HEADER || 'Authorization'] = key;
  const r = await getJson(url, headers);
  if (!r.ok) return r;
  return { ok: true, fields: mapProviderPayload(r.json), raw: r.json };
}

// ── Terminal49 ───────────────────────────────────────────────────────────────
// https://api.terminal49.com/v2, JSON:API, `Authorization: Token <key>`.
//
// Two things make this more than an alias entry.
//
// 1. JSON:API puts everything under data[].attributes with related records in a
//    sibling `included` array, and `data` is an ARRAY — which the generic
//    flatten above deliberately does not descend into. So it is unwrapped here.
//
// 2. The facts are split across two records. The CONTAINER knows its number and
//    equipment; the SHIPMENT it belongs to knows the vessel, the ports and the
//    ETA. Both are needed to fill one of our cards, so the shipment is pulled
//    out of `included` and merged underneath the container.
//
// Field names are the documented ones where they are documented, and the
// generic alias table runs underneath as a safety net for the rest. The whole
// payload is kept in `raw`, so refining this against a real response is reading
// one stored row rather than guessing again.
const T49_BASE = 'https://api.terminal49.com/v2';

function t49Headers() {
  return { Authorization: `Token ${process.env.CONTAINER_TRACKING_KEY}`,
           'Content-Type': 'application/json' };
}

// data may be an object or an array; `included` carries related records.
function t49Records(json) {
  const data = json && json.data;
  const list = Array.isArray(data) ? data : (data ? [data] : []);
  return { list, included: (json && json.included) || [] };
}

function t49Related(rec, included, type) {
  const rel = rec && rec.relationships && rec.relationships[type];
  const ref = rel && rel.data;
  if (!ref) return null;
  const id = Array.isArray(ref) ? (ref[0] && ref[0].id) : ref.id;
  if (!id) return null;
  return included.find(x => x.id === id && x.type === type) || null;
}

// "40' HIGH CUBE" out of the three fields Terminal49 splits it across, so the
// card reads the way the carrier's own screen does.
function t49EquipmentLabel(a) {
  if (!a) return '';
  const len = a.equipment_length;
  const height = String(a.equipment_height || '').toLowerCase();
  const kind = String(a.equipment_type || '').toLowerCase();
  const parts = [];
  if (len) parts.push(`${len}'`);
  if (height === 'high_cube' || height === 'high cube') parts.push('HIGH CUBE');
  else if (kind === 'reefer') parts.push('REEFER');
  else if (kind === 'open_top') parts.push('OPEN TOP');
  else if (kind === 'flat_rack') parts.push('FLAT RACK');
  else if (kind) parts.push('DRY');
  return parts.join(' ').trim();
}

function t49Map(container, shipment) {
  const c = (container && container.attributes) || {};
  const s = (shipment && shipment.attributes) || {};
  const pick = (...vals) => vals.find(v => v != null && v !== '') ?? undefined;

  const out = {
    container_type: pick(t49EquipmentLabel(c)),
    carrier: pick(s.shipping_line_scac, s.shipping_line_name, s.scac),
    bl_number: pick(s.bill_of_lading_number, s.ref_numbers && s.ref_numbers[0]),
    pod_eta: pick(s.pod_eta_at, s.pod_eta),
    eta: pick(s.pod_eta_at, s.pod_eta),
    vessel_name: pick(s.pod_vessel_name, s.vessel_name),
    vessel_imo: pick(s.pod_vessel_imo, s.vessel_imo),
    pol_code: pick(s.port_of_lading_locode, s.pol_locode),
    pol_name: pick(s.port_of_lading_name, s.pol_name),
    pod_code: pick(s.port_of_discharge_locode, s.pod_locode),
    pod_name: pick(s.port_of_discharge_name, s.pod_name),
    atd: pick(s.pol_atd_at, s.pol_etd_at),
  };

  // The latest milestone this container has actually reached, newest first. The
  // list is ordered deliberately: arrived-at-POD outranks departed-from-POL, so
  // the card shows where the box IS rather than the first field that had a date.
  const milestones = [
    ['pod_full_out_at',   c.pod_full_out_at,   'Picked up'],
    ['pod_discharged_at', c.pod_discharged_at, 'Discharged'],
    ['pod_arrived_at',    c.pod_arrived_at,    'Arrived'],
    ['pol_atd_at',        s.pol_atd_at,        'Departed'],
  ];
  const hit = milestones.find(m => m[1]);
  if (hit) {
    const place = hit[0] === 'pol_atd_at' ? out.pol_name : out.pod_name;
    out.latest_move = [hit[2], place].filter(Boolean).join(' — ');
    out.latest_move_at = hit[1];
  }

  // Anything the explicit mapping missed still gets a chance through the alias
  // table, on the merged attributes rather than the JSON:API envelope.
  const fallback = readAliases({ ...s, ...c });
  for (const [k, v] of Object.entries(fallback)) {
    if (out[k] == null || out[k] === '') out[k] = v;
  }
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === '') delete out[k];
  return out;
}

async function t49Lookup(containerNo) {
  if (!process.env.CONTAINER_TRACKING_KEY) return { ok: false, code: 'not-configured', reason: 'not-configured' };

  // JSON:API filtering. Overridable because the exact parameter is the one part
  // of this that is worth being able to correct without a deploy.
  const param = process.env.CONTAINER_TRACKING_FILTER || 'filter[number]';
  const url = `${T49_BASE}/containers?${encodeURIComponent(param)}=${encodeURIComponent(containerNo)}&include=shipment`;
  const r = await getJson(url, t49Headers());
  if (!r.ok) return r;

  const { list, included } = t49Records(r.json);
  const container = list.find(x => {
    const n = x && x.attributes && (x.attributes.number || x.attributes.container_number);
    return String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === containerNo;
  }) || list[0];

  if (!container) return { ok: false, code: 'not-tracked-yet', reason: 'not-tracked-yet', raw: r.json };
  const shipment = t49Related(container, included, 'shipment');
  return { ok: true, fields: t49Map(container, shipment), raw: r.json };
}

// Ask Terminal49 to START tracking a box it does not know yet. This is the step
// that has no equivalent in a GET-by-number vendor: T49 tracks what you have
// registered, so the first lookup of a new container registers it and the data
// arrives on a later refresh rather than immediately.
async function t49Register(number, scac, requestType) {
  if (!process.env.CONTAINER_TRACKING_KEY) return { ok: false, code: 'not-configured', reason: 'not-configured' };
  const body = {
    data: {
      type: 'tracking_request',
      attributes: {
        request_type: requestType || 'container',
        request_number: number,
        ...(scac ? { scac } : {}),
      },
    },
  };
  const r = await getJson(`${T49_BASE}/tracking_requests`, t49Headers(), { method: 'POST', body });
  if (!r.ok) return r;
  const rec = (r.json && r.json.data) || {};
  return { ok: true, id: rec.id, status: (rec.attributes && rec.attributes.status) || 'pending', raw: r.json };
}

// ── Safecube (Sinay) ─────────────────────────────────────────────────────────
// https://api.sinay.ai/safecube/api/v1/public/, header `API_KEY`, JSON.
//
// Worth its own adapter for a reason the others do not have: Safecube answers
// BOTH questions in one call. The shipment carries the container milestones AND
// the vessel — name, IMO, MMSI — AND a `location` with lat/lng. So with Safecube
// configured there is no second AIS vendor to buy: the position rides in on the
// same response, and lookupContainer returns it separately so refresh can treat
// it as the fresh observation it is rather than a field to merge.
//
// Like Terminal49 it is a register-then-read platform: POST /shipments starts
// tracking, POST /shipments/search reads back.
const SAFECUBE_BASE = 'https://api.sinay.ai/safecube/api/v1/public';

function safecubeHeaders() {
  return { API_KEY: process.env.CONTAINER_TRACKING_KEY || '', 'Content-Type': 'application/json' };
}

// Every object in a payload, depth-first. Vendors wrap their lists differently
// ({data:[…]}, {shipments:[…]}, {content:[…]} for a Spring backend), and looking
// for the SHAPE rather than a fixed path survives all of them — and survives the
// wrapper changing, which a fixed path does not.
function everyObject(node, depth, out) {
  const acc = out || [];
  if (!node || typeof node !== 'object' || depth > 8) return acc;
  if (Array.isArray(node)) { node.forEach(x => everyObject(x, depth + 1, acc)); return acc; }
  acc.push(node);
  Object.values(node).forEach(v => everyObject(v, depth + 1, acc));
  return acc;
}

const scNum = v => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

// The container half of a Safecube shipment.
function safecubeMap(sh) {
  if (!sh) return {};
  const v = sh.vessel || {};
  const loc = sh.location || sh.currentLocation || {};
  const pol = sh.pol || sh.portOfLoading || sh.origin || {};
  const pod = sh.pod || sh.portOfDischarge || sh.destination || {};
  const pick = (...vals) => vals.find(x => x != null && x !== '') ?? undefined;

  const out = {
    container_type: pick(sh.containerType, sh.equipmentType, sh.type),
    carrier: pick(sh.carrier, sh.carrierName, sh.shippingLine, sh.scac),
    bl_number: pick(sh.blNumber, sh.billOfLading, sh.bookingNumber),
    pod_eta: pick(sh.eta, sh.podEta, pod.eta),
    eta: pick(sh.eta, sh.podEta, pod.eta),
    vessel_name: pick(v.name, sh.vesselName),
    vessel_imo: pick(v.imo, sh.vesselImo),
    pol_code: pick(pol.locode, pol.unlocode, pol.code),
    pol_name: pick(pol.name, pol.portName),
    pod_code: pick(pod.locode, pod.unlocode, pod.code),
    pod_name: pick(pod.name, pod.portName),
    atd: pick(sh.atd, pol.atd, sh.departureDate),
    latest_move: pick(loc.name, sh.statusLabel, sh.status),
    latest_move_at: pick(sh.lastUpdate, sh.updatedAt, loc.timestamp),
  };
  // Anything the explicit names missed still gets the alias table, run over the
  // flattened shipment rather than the response envelope.
  const fallback = readAliases(flatten(sh, 0, {}));
  for (const [k, val] of Object.entries(fallback)) if (out[k] == null || out[k] === '') out[k] = val;
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === '') delete out[k];
  return out;
}

// The position half. Safecube reports lat/lng on `location`; `routeData` is the
// track it has drawn, whose last point is the most recent fix when `location`
// is absent.
function safecubePosition(sh) {
  if (!sh) return null;
  const v = sh.vessel || {};
  const loc = sh.location || sh.currentLocation || {};
  let lat = scNum(pickCoord(loc, ['lat', 'latitude', 'y']));
  let lon = scNum(pickCoord(loc, ['lng', 'lon', 'longitude', 'x']));

  if (lat == null || lon == null) {
    const route = Array.isArray(sh.routeData) ? sh.routeData : null;
    const last = route && route.length ? route[route.length - 1] : null;
    if (last) {
      lat = scNum(pickCoord(last, ['lat', 'latitude', 'y']));
      lon = scNum(pickCoord(last, ['lng', 'lon', 'longitude', 'x']));
    }
  }
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // Null Island is a broken feed, not a container ship.
  if (lat === 0 && lon === 0) return null;

  const out = {
    vessel_lat: lat,
    vessel_lon: lon,
    vessel_position_at: aisTime(loc.timestamp || loc.date || sh.lastUpdate || sh.updatedAt),
    vessel_course: scNum(loc.course ?? loc.heading ?? v.course),
    vessel_speed: scNum(loc.speed ?? v.speed),
    vessel_mmsi: v.mmsi != null ? String(v.mmsi) : undefined,
    position_source: 'safecube',
  };
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}
function pickCoord(o, names) {
  for (const n of names) if (o && o[n] != null && o[n] !== '') return o[n];
  return undefined;
}

// The search body. Defaulted to the documented shape and overridable, because
// this is the one part of the integration a wrong guess breaks completely and
// correcting it should not need a deploy.
function safecubeSearchBody(containerNo) {
  const tpl = process.env.SAFECUBE_SEARCH_BODY;
  if (tpl) {
    try { return JSON.parse(tpl.replace(/\{container\}/g, containerNo)); }
    catch (_) { /* fall through to the default */ }
  }
  return { containerNumbers: [containerNo] };
}

async function safecubeLookup(containerNo) {
  if (!process.env.CONTAINER_TRACKING_KEY) return { ok: false, code: 'not-configured', reason: 'not-configured' };
  const r = await getJson(`${SAFECUBE_BASE}/shipments/search`, safecubeHeaders(),
    { method: 'POST', body: safecubeSearchBody(containerNo) });
  if (!r.ok) return r;

  const wanted = String(containerNo).toUpperCase();
  const objs = everyObject(r.json, 0, []);
  const norm = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sh = objs.find(o => norm(o.containerNumber || o.container_number || o.containerNo) === wanted)
    || objs.find(o => o.containerNumber || o.container_number || o.containerNo);

  if (!sh) return { ok: false, code: 'not-tracked-yet', reason: 'not-tracked-yet', raw: r.json };
  return { ok: true, fields: safecubeMap(sh), position: safecubePosition(sh), raw: r.json };
}

async function safecubeRegister(containerNo) {
  if (!process.env.CONTAINER_TRACKING_KEY) return { ok: false, code: 'not-configured', reason: 'not-configured' };
  const r = await getJson(`${SAFECUBE_BASE}/shipments`, safecubeHeaders(),
    { method: 'POST', body: { containerNumber: containerNo } });
  if (!r.ok) return r;
  const sh = everyObject(r.json, 0, []).find(o => o.id || o.shipmentId) || {};
  return { ok: true, id: sh.id || sh.shipmentId, status: sh.status || 'created', raw: r.json };
}

// ── Which container provider is in play ──────────────────────────────────────
const CONTAINER_PROVIDERS = ['safecube', 'terminal49', 'generic'];

function containerProviderName() {
  const explicit = String(process.env.CONTAINER_TRACKING_PROVIDER || '').toLowerCase().trim();
  // An unrecognised name is a typo, and silently falling back to a different
  // vendor's endpoint with somebody's key is worse than answering "none".
  if (explicit) return CONTAINER_PROVIDERS.includes(explicit) ? explicit : 'unknown';
  // Nothing named: a URL template can only be the generic adapter. A bare key is
  // ambiguous now that two providers take one, so it keeps the documented
  // default it has always had rather than guessing at the newer vendor.
  if (process.env.CONTAINER_TRACKING_URL) return 'generic';
  if (process.env.CONTAINER_TRACKING_KEY) return 'terminal49';
  return 'none';
}

// What the settings currently amount to, for the UI's "test the connection".
function providerStatus() {
  const name = containerProviderName();
  return {
    provider: name,
    configured: name !== 'none' && name !== 'unknown'
      && !!(process.env.CONTAINER_TRACKING_KEY || process.env.CONTAINER_TRACKING_URL),
    carrier_has_position: carrierHasPosition(),
    ais: aisConfigured() ? (process.env.AIS_TRACKING_NAME || 'configured') : 'not-configured',
    webhook_ready: !!(process.env.TERMINAL49_WEBHOOK_SECRET || process.env.TRACKING_WEBHOOK_SECRET),
  };
}

async function lookupContainer(containerNo) {
  switch (containerProviderName()) {
    case 'safecube':   return safecubeLookup(containerNo);
    case 'terminal49': return t49Lookup(containerNo);
    case 'generic':    return genericLookup(containerNo);
    default:           return { ok: false, code: 'not-configured', reason: 'not-configured' };
  }
}

// Both register-then-read platforms need a box announced before they will watch
// it. A GET-by-number vendor does not, and says so rather than pretending.
async function registerContainer(containerNo, scac) {
  switch (containerProviderName()) {
    case 'safecube':   return safecubeRegister(containerNo);
    case 'terminal49': return t49Register(containerNo, scac, 'container');
    default: return { ok: false, code: 'not-supported',
      reason: 'this provider tracks on lookup — nothing to register' };
  }
}

// Does the carrier feed also carry the ship's position? Safecube does, which is
// why it needs no second vendor; the others do not.
const carrierHasPosition = () => containerProviderName() === 'safecube';

// ── AIS: where the ship is ───────────────────────────────────────────────────
// A different vendor and a different key from container tracking, because they
// are different products. The URL template takes {imo} and/or {mmsi}; vendors
// index on both and neither is derivable from the other.
const AIS_ALIASES = {
  lat:   ['lat', 'latitude', 'LAT', 'Latitude', 'y'],
  lon:   ['lon', 'lng', 'longitude', 'LON', 'Longitude', 'x'],
  at:    ['timestamp', 'last_position_epoch', 'last_position_time', 'time', 'position_time', 'updated_at', 'received_at'],
  course:['course', 'cog', 'COURSE', 'heading', 'true_heading'],
  speed: ['speed', 'sog', 'SPEED'],
  mmsi:  ['mmsi', 'MMSI'],
  name:  ['name', 'shipname', 'vessel_name', 'SHIPNAME'],
};

// AIS vendors report time as an ISO string, as unix seconds, or as unix
// milliseconds. Seconds and milliseconds are told apart by magnitude: anything
// below ~1e11 cannot be a plausible millisecond timestamp in this century.
function aisTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    const ms = n < 1e11 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function mapAisPayload(payload) {
  const flat = flatten(payload, 0, {});
  // Some vendors answer with a one-element array of positions.
  const arr = payload && (Array.isArray(payload) ? payload
    : Array.isArray(payload.data) ? payload.data
    : Array.isArray(payload.positions) ? payload.positions : null);
  const src = arr && arr.length ? flatten(arr[0], 0, { ...flat }) : flat;

  const read = names => {
    for (const n of names) if (src[n] != null && src[n] !== '') return src[n];
    return undefined;
  };
  const lat = Number(read(AIS_ALIASES.lat));
  const lon = Number(read(AIS_ALIASES.lon));
  // Out-of-range coordinates are how a vendor says "no fix" — and 0,0 is Null
  // Island, which is a bug rather than a position for a container ship.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (lat === 0 && lon === 0) return null;

  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  const out = {
    vessel_lat: lat,
    vessel_lon: lon,
    vessel_position_at: aisTime(read(AIS_ALIASES.at)),
    vessel_course: num(read(AIS_ALIASES.course)),
    vessel_speed: num(read(AIS_ALIASES.speed)),
    vessel_mmsi: read(AIS_ALIASES.mmsi) != null ? String(read(AIS_ALIASES.mmsi)) : undefined,
  };
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

async function lookupPosition({ imo, mmsi }) {
  const tpl = process.env.AIS_TRACKING_URL;
  if (!tpl) return { ok: false, code: 'not-configured', reason: 'not-configured' };
  if (!imo && !mmsi) return { ok: false, code: 'no-vessel-id', reason: 'no IMO or MMSI on this container' };
  const url = tpl
    .replace('{imo}', encodeURIComponent(imo || ''))
    .replace('{mmsi}', encodeURIComponent(mmsi || ''));
  const headers = {};
  const key = process.env.AIS_TRACKING_KEY;
  if (key) headers[process.env.AIS_TRACKING_HEADER || 'Authorization'] = key;
  const r = await getJson(url, headers);
  if (!r.ok) return r;
  const fields = mapAisPayload(r.json);
  if (!fields) return { ok: false, code: 'no-fix', reason: 'no position in the response', raw: r.json };
  fields.position_source = process.env.AIS_TRACKING_NAME || 'ais';
  return { ok: true, fields, raw: r.json };
}

const aisConfigured = () => !!process.env.AIS_TRACKING_URL;

module.exports = {
  lookupContainer, registerContainer, containerProviderName, carrierHasPosition, providerStatus,
  CONTAINER_PROVIDERS,
  lookupPosition, aisConfigured,
  safecubeMap, safecubePosition, safecubeSearchBody, everyObject,
  // Exported for the tests, which exercise the mapping rather than the network.
  mapProviderPayload, mapAisPayload, aisTime, t49Map, t49Records, t49Related, t49EquipmentLabel, classify,
};
ctx.trackingProviders = module.exports;
