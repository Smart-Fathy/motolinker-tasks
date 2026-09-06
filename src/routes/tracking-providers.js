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

// Always trimmed. A key pasted into a hosting provider's variable field can pick
// up a leading or trailing space, and the vendor's answer to that is a 401 —
// which sends somebody hunting for a wrong key rather than a stray character.
const trackingKey = () => String(process.env.CONTAINER_TRACKING_KEY || '').trim();

// How a key is presented. Vendors disagree — API_KEY, x-api-key, apikey,
// Authorization: Bearer — and their docs are the only place the answer lives.
// Since that answer can be discovered with one request each, the candidates are
// listed here and the connection check tries them; the winner is then pinned in
// CONTAINER_TRACKING_HEADER so normal requests only ever send one.
const AUTH_SHAPES = [
  { header: 'API_KEY', prefix: '' },
  { header: 'x-api-key', prefix: '' },
  { header: 'apikey', prefix: '' },
  { header: 'Authorization', prefix: 'Bearer ' },
  { header: 'Authorization', prefix: '' },
];
// A header NAME is an HTTP token: no spaces, no newlines. A value pasted into a
// hosting provider's variable field routinely arrives carrying one of those, and
// the key was already trimmed while the name was not — so `API_KEY ` became a
// header nobody recognises, and setting CONTAINER_TRACKING_HEADER to the value
// it already defaulted to turned a working request into a 401. An unusable name
// falls back to the default rather than being sent, because the default is the
// one thing known to work; providerStatus reports auth_header so what is
// actually being sent stays visible.
const HEADER_TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
function headerName(configured, fallback) {
  const s = String(configured || '').trim();
  return s && HEADER_TOKEN.test(s) ? s : fallback;
}

function authHeader(defaultHeader, shape) {
  const key = trackingKey();
  if (!key) return {};
  const h = shape ? shape.header : headerName(process.env.CONTAINER_TRACKING_HEADER, defaultHeader);
  const prefix = shape ? shape.prefix : (process.env.CONTAINER_TRACKING_AUTH_PREFIX || '');
  return { [h]: prefix + key };
}

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
  // 401 and 403 are DIFFERENT answers and this used to collapse them, which hid
  // the single most useful fact a vendor gives you:
  //   401 — no credential was recognised. Usually the wrong header name.
  //   403 — the credential WAS recognised, and the answer is still no. The key
  //         is fine; the account, plan, scope or path is not.
  // Safecube returned 403 to API_KEY and 401 to every other header, which
  // identified the header exactly — and read as "all five refused" until this
  // told them apart.
  // Sinay answers a carrier it could not identify with a 400 and a named code.
  // That is not a broken integration — it is one missing parameter — and saying
  // so is the difference between a fix and a support ticket.
  if (/auto_cant_detect|auto_cant_find_info|wrong_sealine|sealine_not_supported|type_not_supported/.test(t)) {
    return 'sealine-unknown';
  }
  if (/wrong_number|bad_request|param:/.test(t)) return 'bad-number';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
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
      // a code the client turns into a sentence, and a readable version rides
      // along as `detail` for a tooltip and the logs.
      //
      // CLASSIFY THE WHOLE BODY, never a field plucked out of it. Vendors put the
      // words that name the problem wherever they like: Terminal49's real
      // free-key refusal is a TOP-LEVEL ARRAY of {detail} objects, Sinay pairs a
      // `code` with a `description`, a gateway answers in HTML with no JSON at
      // all. This used to read three key names and hand classify() whatever it
      // found — which on an array is nothing — so the string worth recognising
      // was thrown away before the classifier ever saw it.
      //
      // That is not hypothetical. 'plan-required' exists precisely for the body
      // Terminal49 returns on a free key, and against that exact captured body it
      // returned 'unauthorized' instead — sending somebody to hunt for a key that
      // was never broken. The suite stayed green because every classify test
      // called classify() directly and none of them came through here.
      const said = String(text || '').replace(/\s+/g, ' ').trim();
      const code = classify(r.status, said);
      // For a HUMAN the vendor's own sentence beats the envelope around it — but
      // only when there is one. JSON.stringify(null) is the string "null", and
      // nothing to say is said as nothing, not as a word meaning nothing.
      const spoken = json && (json.message || json.error || json.errors
        || json.detail || json.description);
      const detail = (spoken == null ? said : String(JSON.stringify(spoken) || '')).slice(0, 400);
      return { ok: false, status: r.status, code, detail, reason: `provider returned ${r.status}` };
    }
    // A 2xx with no body is a legitimate answer, not a failure: 202 Accepted is
    // how Sinay acknowledges an asynchronous registration and 204 is how it
    // confirms a delete. Reporting those as errors would have every successful
    // register read as a failed one. Callers get an empty object rather than
    // null so none of them has to guard a property read.
    if (!json) return { ok: true, json: {}, empty: true, status: r.status };
    return { ok: true, json, status: r.status };
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
  return { ...authHeader('Authorization', { header: process.env.CONTAINER_TRACKING_HEADER || 'Authorization',
                                            prefix: process.env.CONTAINER_TRACKING_AUTH_PREFIX || 'Token ' }),
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
  if (!trackingKey()) return { ok: false, code: 'not-configured', reason: 'not-configured' };

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
  if (!trackingKey()) return { ok: false, code: 'not-configured', reason: 'not-configured' };
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
// Sinay publishes several APIs behind one key and one header (`API_KEY`), and
// they are NOT interchangeable:
//
//   container-tracking/api/v2   GET /shipment — the tracking data. FREE tier.
//   webhook/api/v1              push instead of polling, and the only place a
//                               container can be registered for tracking.
//   safecube/api/v1             Shipment Management — a PREMIUM add-on that
//                               files shipments in Safecube's own web app and
//                               returns share links. It is not tracking at all.
//
// This adapter used to point at safecube/api/v1 and POST /shipments/search,
// which is why a valid key came back 403 on every single request: the key
// authenticated fine, and the account simply is not entitled to the premium
// product. The 403 was the honest answer; the path was the mistake.
const SAFECUBE_BASE = 'https://api.sinay.ai/container-tracking/api/v2';
const SAFECUBE_WEBHOOK_BASE = 'https://api.sinay.ai/webhook/api/v1';
const safecubeBase = () =>
  String(process.env.SAFECUBE_BASE_URL || SAFECUBE_BASE).replace(/\/+$/, '');
const safecubeWebhookBase = () =>
  String(process.env.SAFECUBE_WEBHOOK_BASE_URL || SAFECUBE_WEBHOOK_BASE).replace(/\/+$/, '');

function safecubeHeaders(shape) {
  return { ...authHeader('API_KEY', shape), 'Content-Type': 'application/json' };
}

// Every object in a payload, depth-first. Used by the webhook path, where the
// envelope around the shipment differs by event type and looking for the SHAPE
// survives a wrapper change that a fixed path does not.
function everyObject(node, depth, out) {
  const acc = out || [];
  if (!node || typeof node !== 'object' || depth > 8) return acc;
  if (Array.isArray(node)) { node.forEach(x => everyObject(x, depth + 1, acc)); return acc; }
  acc.push(node);
  Object.values(node).forEach(v => everyObject(v, depth + 1, acc));
  return acc;
}

const scNum = v => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

// Sinay writes longitude as `lng`; the column is vessel_lon. Every coordinate
// crosses that rename exactly once, here, so no caller has to remember it.
function scCoord(o) {
  if (!o) return null;
  const lat = scNum(o.lat);
  const lon = scNum(o.lng != null ? o.lng : o.lon);
  if (lat == null || lon == null) return null;
  return { lat, lon };
}

// DCSA status codes, which every carrier on the platform reports the same way.
// The LAST ACTUAL event is a sharper signal than the headline shippingStatus —
// "IN_TRANSIT" covers everything from gate-in to the quay at the far end, while
// CDD says the box is off the ship.
const SAFECUBE_EVENT_STATUS = {
  CEP: 'booked', CPS: 'booked',
  CGI: 'in_transit', CLL: 'in_transit', VDL: 'in_transit', VAT: 'in_transit',
  CDT: 'in_transit', TSD: 'in_transit', CLT: 'in_transit', VDT: 'in_transit',
  LTS: 'in_transit', BTS: 'in_transit',
  VAD: 'arrived',
  CDD: 'discharged',
  CGO: 'cleared', CDC: 'cleared',
  CER: 'closed',
};
const SAFECUBE_SHIPPING_STATUS = {
  PLANNED: 'booked', IN_TRANSIT: 'in_transit', DELIVERED: 'discharged',
};

// The port-call log. An estimated event is kept but labelled, because a date
// nobody has confirmed sitting unmarked next to confirmed ones is how a plan
// gets read as a fact.
function safecubeMoves(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(e => e && (e.date || e.description)).map(e => ({
    at: e.date,
    event: e.isActual === false ? `${e.description || ''} (expected)`.trim() : (e.description || ''),
    place: (e.location && e.location.name) || '',
    vessel: (e.vessel && e.vessel.name) || '',
  }));
}

// Pick the container this update is about. A BL can carry several boxes, and
// mapping the first one onto a row for a different number would be silently
// wrong rather than loudly wrong.
function safecubeBox(payload, containerNo) {
  const list = (payload && Array.isArray(payload.containers)) ? payload.containers : [];
  if (!list.length) return {};
  const want = String(containerNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (want) {
    const hit = list.find(c => String((c && c.number) || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === want);
    if (hit) return hit;
  }
  return list[0];
}

// The container half of a GET /shipment response (and of a webhook payload,
// which carries the same shipment shape).
function safecubeMap(payload, containerNo) {
  if (!payload) return {};
  const md = payload.metadata || {};
  const route = payload.route || {};
  const box = safecubeBox(payload, containerNo);
  const events = Array.isArray(box.events) ? box.events : [];
  // Chronological, actual only: the last one is where the box is now.
  const actual = events.filter(e => e && e.isActual && e.date)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = actual[actual.length - 1] || null;

  const ais = ((payload.routeData || {}).ais || {}).data || {};
  const vessels = Array.isArray(payload.vessels) ? payload.vessels : [];
  // The ship carrying it now: the one on the last actual event, else the one
  // AIS is following, else the last leg of the plan.
  const v = (last && last.vessel) || ais.vessel || vessels[vessels.length - 1] || {};
  const pol = (route.pol && route.pol.location) || {};
  const pod = (route.pod && route.pod.location) || {};

  const out = {
    container_type: box.sizeType || box.isoCode,
    carrier: md.sealineName || md.sealine,
    // Only a document number belongs in bl_number. When the shipment was looked
    // up by container the shipmentNumber IS the container, and copying it here
    // would invent a bill of lading that does not exist.
    bl_number: (md.shipmentType === 'BL' || md.shipmentType === 'BK') ? md.shipmentNumber : undefined,
    status: (last && SAFECUBE_EVENT_STATUS[last.status]) || SAFECUBE_SHIPPING_STATUS[md.shippingStatus],
    vessel_name: v.name,
    vessel_imo: v.imo,
    vessel_mmsi: v.mmsi != null ? String(v.mmsi) : undefined,
    pol_code: pol.locode,
    pol_name: pol.name,
    pod_code: pod.locode,
    pod_name: pod.name,
    // ATD only once the carrier confirms the departure happened.
    atd: route.pol && route.pol.actual ? route.pol.date : undefined,
    // ETA only while arrival has NOT happened: after it, route.pod.date is an
    // ACTUAL arrival, and writing that into eta shows a delivered box as still
    // due. predictiveEta is Sinay's own model and only appears within three days
    // of arrival, which is exactly when it beats the carrier's number.
    eta: route.pod && !route.pod.actual
      ? (route.pod.predictiveEta || route.pod.date) : undefined,
    // The port belongs in the sentence. "Loaded On Vessel" on its own, at a
    // transhipment in Singapore, reads on a card as though the box had been
    // loaded for the final leg — t49Map has always named the place and this
    // did not.
    latest_move: last
      ? [last.description, (last.location && last.location.name) || '']
          .filter(Boolean).join(' — ') || undefined
      : undefined,
    latest_move_at: last ? last.date : undefined,
    moves: safecubeMoves(events),
  };
  out.pod_eta = out.eta;
  if (Array.isArray(out.moves) && !out.moves.length) delete out.moves;
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === '') delete out[k];
  return out;
}

// The position half. Two positions can be present and they are not the same
// thing: lastVesselPosition is an AIS fix and carries its own timestamp;
// routeData.coordinates is where the CARRIER believes the box is. AIS wins,
// because it is the one with an age on it — and a dot drawn without an age
// implies a precision nobody is paying for.
function safecubePosition(payload) {
  if (!payload) return null;
  const rd = payload.routeData || {};
  const ais = rd.ais || {};
  const d = ais.data || {};
  const fix = (ais.status === 'OK' && d.lastVesselPosition) ? d.lastVesselPosition : null;
  const p = scCoord(fix) || scCoord(rd.coordinates);
  if (!p) return null;
  if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return null;
  // Null Island is a broken feed, not a container ship.
  if (p.lat === 0 && p.lon === 0) return null;

  const v = d.vessel || {};
  const out = {
    vessel_lat: p.lat,
    vessel_lon: p.lon,
    // A carrier coordinate has no timestamp of its own, so it inherits the one
    // on the data it came with rather than pretending to be current.
    vessel_position_at: aisTime(
      (fix && fix.updatedAt) || d.updatedAt || (payload.metadata || {}).updatedAt),
    vessel_mmsi: v.mmsi != null ? String(v.mmsi) : undefined,
    // Course and speed are deliberately absent: this feed does not report them,
    // and a zero would draw a stopped ship pointing north.
    position_source: process.env.CONTAINER_TRACKING_NAME || 'safecube',
  };
  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return out;
}

// Auto-detection of the carrier is the documented default and it does fail —
// on failure the API says so rather than guessing. A SCAC skips the guess
// entirely and is both faster and more reliable, so it is threaded through from
// the caller and can be defaulted for a fleet that ships with one line.
function safecubeQuery(containerNo, sealine) {
  const q = new URLSearchParams({
    shipmentNumber: String(containerNo),
    shipmentType: 'CT',
    route: 'true',   // route segments AND the AIS block ride on this flag
    ais: 'true',
  });
  const line = sealine || process.env.SAFECUBE_SEALINE;
  if (line) q.set('sealine', String(line).toUpperCase().trim());
  return q.toString();
}

async function safecubeLookup(containerNo, sealine) {
  if (!trackingKey()) return { ok: false, code: 'not-configured', reason: 'not-configured' };
  const r = await getJson(`${safecubeBase()}/shipment?${safecubeQuery(containerNo, sealine)}`,
    safecubeHeaders());
  if (!r.ok) return r;

  // A 200 is not automatically data. When the carrier answers "nothing here"
  // Sinay passes that through as a SUCCESS with a message, and treating it as a
  // hit would write an empty shipment over a good row.
  const md = (r.json && r.json.metadata) || {};
  const msg = String((r.json && (r.json.message || r.json.status)) || '').toUpperCase();
  const empty = /HASNT_PROVIDE_INFO|CANCELED_SHIPMENT|CANT_FIND_INFO/.test(msg);
  const hasBox = Array.isArray(r.json && r.json.containers) && r.json.containers.length > 0;
  if (empty || (!hasBox && !md.sealine)) {
    return { ok: false, code: 'not-tracked-yet', reason: 'not-tracked-yet', raw: r.json };
  }
  return {
    ok: true,
    fields: safecubeMap(r.json, containerNo),
    position: safecubePosition(r.json),
    raw: r.json,
  };
}

// Registration lives in the webhook API, not the tracking one: GET /shipment is
// a pull and needs no setup, but push needs the box attached to an endpoint.
// The endpoint id can be pinned, and is otherwise discovered — but only when
// there is exactly one, because picking between several would silently decide
// which of your webhooks receives the milestones.
async function safecubeEndpointId() {
  const pinned = String(process.env.SAFECUBE_ENDPOINT_ID || '').trim();
  if (pinned) return { ok: true, id: pinned };
  const r = await getJson(`${safecubeWebhookBase()}/endpoint`, safecubeHeaders());
  if (!r.ok) return r;
  const list = (r.json && Array.isArray(r.json.data)) ? r.json.data : [];
  if (list.length === 1 && list[0] && list[0].id) return { ok: true, id: list[0].id };
  return { ok: false, code: 'not-configured', raw: r.json,
    reason: list.length
      ? 'several webhook endpoints exist — set SAFECUBE_ENDPOINT_ID to say which one'
      : 'no webhook endpoint exists yet — create one in Safecube first' };
}

async function safecubeRegister(containerNo, sealine) {
  if (!trackingKey()) return { ok: false, code: 'not-configured', reason: 'not-configured' };
  const ep = await safecubeEndpointId();
  if (!ep.ok) return ep;
  const ship = { number: String(containerNo), type: 'CT' };
  const line = sealine || process.env.SAFECUBE_SEALINE;
  if (line) ship.sealine = String(line).toUpperCase().trim();
  const r = await getJson(`${safecubeWebhookBase()}/easy-shipment-asynchronous`,
    safecubeHeaders(), { method: 'POST', body: { [ep.id]: { shipments: [ship] } } });
  if (!r.ok) return r;
  // 202 means accepted, not tracked. What says it worked is the
  // shipment.added.to.endpoint webhook; shipment.in.error says it did not.
  return { ok: true, id: ep.id, status: 'accepted', raw: r.json };
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
  if (trackingKey()) return 'terminal49';
  return 'none';
}

// What the settings currently amount to, for the UI's "test the connection".
function providerStatus() {
  const name = containerProviderName();
  return {
    provider: name,
    configured: name !== 'none' && name !== 'unknown'
      && !!(trackingKey() || process.env.CONTAINER_TRACKING_URL),
    auth_header: process.env.CONTAINER_TRACKING_HEADER || (name === 'terminal49' ? 'Authorization' : 'API_KEY'),
    carrier_has_position: carrierHasPosition(),
    ais: aisConfigured() ? (process.env.AIS_TRACKING_NAME || 'configured') : 'not-configured',
    webhook_ready: !!(process.env.TERMINAL49_WEBHOOK_SECRET || process.env.TRACKING_WEBHOOK_SECRET),
  };
}

// The pull was the half of this integration with no record of what the vendor
// actually said. A webhook that changes nothing prints a line; a lookup that
// returned nothing printed nothing at all — so "the carrier has no data for this
// box", "the carrier refused our key" and "the carrier could not tell which
// shipping line it is" were indistinguishable from outside the process. That
// ambiguity is what sent this integration down two wrong paths, and one line per
// lookup ends it.
//
// The key is never printed. getJson has already reduced the vendor's own error
// body to a truncated `detail`, and that is the part worth keeping.
function lookupWhere(name) {
  if (name === 'safecube') {
    const base = safecubeBase();
    const line = process.env.SAFECUBE_SEALINE;
    return base + (line ? ` sealine=${String(line).toUpperCase().trim()}` : ' sealine=auto');
  }
  if (name === 'terminal49') return T49_BASE;
  return process.env.CONTAINER_TRACKING_URL || '';
}

// The answer alone is not enough to act on. A 403 from the endpoint we mean to
// call is an entitlement; the identical 403 from a base left pointing at a
// vendor's OTHER product is a stale variable, and the two need opposite
// responses. Recording WHERE the request went is what separates them, and
// leaving it out cost a round of guessing at a value nobody could read back.
function logLookup(provider, containerNo, r, where) {
  const head = `[lookup:${provider}] ${containerNo}${where ? ` via ${where}` : ''}`;
  if (r && r.ok) {
    const f = r.fields || {};
    return console.log(`${head} ok — ${Object.keys(f).length} field(s)`
      + `${f.carrier ? `, carrier ${f.carrier}` : ''}`
      + `${r.position ? ', position included' : ', no position'}`);
  }
  const x = r || {};
  console.log(`${head} ${x.code || 'error'}`
    + `${x.status ? ` http ${x.status}` : ''}`
    + `${x.reason && x.reason !== x.code ? ` — ${x.reason}` : ''}`
    + `${x.detail ? ` — ${String(x.detail).slice(0, 300)}` : ''}`);
}

// `scac` is an optional carrier hint. Safecube's auto-detection is documented
// to fail on some numbers, and naming the line skips the guess entirely.
async function lookupContainer(containerNo, scac) {
  const name = containerProviderName();
  const r = await (async () => {
    switch (name) {
      case 'safecube':   return safecubeLookup(containerNo, scac);
      case 'terminal49': return t49Lookup(containerNo);
      case 'generic':    return genericLookup(containerNo);
      default:           return { ok: false, code: 'not-configured', reason: 'not-configured' };
    }
  })();
  // 'not-configured' is a settings state, not an event — logging it would print a
  // line on every page load of an installation that has no provider at all.
  if (!r || r.code !== 'not-configured') logLookup(name, containerNo, r, lookupWhere(name));
  return r;
}

// Registration means different things per vendor and neither is "you cannot read
// until you do this". Terminal49 will not watch a box until it is registered.
// Safecube's tracking API is a pure pull that needs no setup at all — there,
// registering attaches the box to a webhook endpoint so milestones are PUSHED
// instead of waited for. A GET-by-number vendor has nothing to register and
// says so rather than pretending.
async function registerContainer(containerNo, scac) {
  switch (containerProviderName()) {
    case 'safecube':   return safecubeRegister(containerNo, scac);
    case 'terminal49': return t49Register(containerNo, scac, 'container');
    default: return { ok: false, code: 'not-supported',
      reason: 'this provider tracks on lookup — nothing to register' };
  }
}

// Which providers have something to register at all. Kept beside the dispatcher
// above so the UI cannot offer a button the dispatcher would refuse.
const canRegister = () => ['safecube', 'terminal49'].includes(containerProviderName());

// Does the carrier feed also carry the ship's position? Safecube does, which is
// why it needs no second vendor; the others do not.
const carrierHasPosition = () => containerProviderName() === 'safecube';

// Two-stage diagnosis, because a vendor answers two different questions and the
// answers are separable.
//
//   Stage 1 — WHICH HEADER is recognised? A 401 means no credential was seen.
//             Anything else — 403, 404, 422, 200 — means the key was read. So
//             the shape that does NOT return 401 is the right one, even when it
//             is refused for another reason entirely.
//   Stage 2 — WITH that header, which BASE PATH is not refused? Published
//             references disagree about Safecube's /public segment, and a
//             gateway answers 403 to a path it does not know just as readily as
//             404. A 403 on one base and a 404 on another is the path telling
//             you which one exists.
//
// Diagnosis only: normal requests send exactly one header to exactly one base.
async function diagnoseAuth() {
  const name = containerProviderName();
  if (name !== 'safecube' && name !== 'terminal49') {
    return { ok: false, reason: 'auth discovery only applies to the keyed providers' };
  }
  if (!trackingKey()) return { ok: false, reason: 'no key set' };

  const label = sh => (sh.prefix ? `${sh.header}: ${sh.prefix.trim()} <key>` : `${sh.header}: <key>`);
  const headersFor = sh => (name === 'safecube'
    ? { ...authHeader('API_KEY', sh), 'Content-Type': 'application/json' }
    : { ...authHeader('Authorization', sh), 'Content-Type': 'application/json' });
  // TWO probes, because the two stages ask different questions and one endpoint
  // cannot answer both.
  //
  // Stage 1 asks WHICH HEADER is recognised, and 401-or-not is all it needs. For
  // that, Sinay's GET /sealines is ideal: the docs say it is free on the FREE
  // plan, so five candidate shapes cost nothing.
  //
  // Stage 2 asks WHETHER THE THING WE ACTUALLY CALL WORKS, and free-on-the-free
  // plan is exactly the property that makes /sealines incapable of answering it.
  // Using it here reported a green connection while every real lookup came back
  // 403 — and then advised setting a variable to the value it already had, which
  // is worse than saying nothing. Stage 2 calls GET /shipment, the endpoint the
  // app uses. The probe number is ISO 6346's own example, so it passes our
  // validation — and it turns out to be a real, tracked shipment, so this reads
  // one. That is the price of a test that calls the endpoint it is testing.
  const cheapProbe = (base, headers) => (name === 'safecube'
    ? getJson(`${base}/sealines`, headers, { timeout: 8000 })
    : getJson(`${base}/containers?page[size]=1`, headers, { timeout: 8000 }));
  const realProbe = (base, headers) => (name === 'safecube'
    ? getJson(`${base}/shipment?${safecubeQuery('CSQU3054383')}`, headers, { timeout: 8000 })
    : getJson(`${base}/containers?page[size]=1`, headers, { timeout: 8000 }));

  const bases = name === 'safecube'
    ? [...new Set([safecubeBase(), SAFECUBE_BASE])]
    : [T49_BASE];

  // ── Stage 1: the header ────────────────────────────────────────────────────
  const attempts = [];
  let recognised = null;
  for (const shape of AUTH_SHAPES) {
    const r = await cheapProbe(bases[0], headersFor(shape));
    const code = r.ok ? 'ok' : (r.code || 'error');
    attempts.push({ shape: label(shape), status: r.status || null, code, accepted: code !== 'unauthorized' });
    if (code !== 'unauthorized' && !recognised) recognised = { shape, code, status: r.status || null };
  }
  if (!recognised) {
    return { ok: false, stage: 'header', attempts,
      reason: 'every header shape came back 401, so none of them was recognised as a credential — the key itself looks wrong, or is not active yet' };
  }

  // Advice that changes nothing is worse than no advice: acting on it looks like
  // a fix, and a variable set by hand to the value it already defaulted to is one
  // stray keystroke away from breaking auth that worked. Only say "set this" when
  // it would actually differ from what is being sent today.
  const defaultHeader = name === 'safecube' ? 'API_KEY' : 'Authorization';
  const defaultPrefix = name === 'terminal49' ? 'Token ' : '';
  const already = recognised.shape.header === headerName(process.env.CONTAINER_TRACKING_HEADER, defaultHeader)
    && recognised.shape.prefix === (process.env.CONTAINER_TRACKING_AUTH_PREFIX || defaultPrefix);
  const envHeader = already
    ? `nothing to change — ${label(recognised.shape)} is already what this app sends`
    : (recognised.shape.prefix
      ? `CONTAINER_TRACKING_HEADER=${recognised.shape.header} and CONTAINER_TRACKING_AUTH_PREFIX=${JSON.stringify(recognised.shape.prefix)}`
      : `CONTAINER_TRACKING_HEADER=${recognised.shape.header}`);

  // The key was read. If that first base already worked, there is nothing else
  // to find.
  if (recognised.code === 'ok' || recognised.code === 'not-tracked-yet' || recognised.code === 'not-found') {
    return { ok: true, header: recognised.shape.header, prefix: recognised.shape.prefix,
      shape: label(recognised.shape), base: bases[0], env: envHeader, attempts, already };
  }

  // ── Stage 2: the path ──────────────────────────────────────────────────────
  const headers = headersFor(recognised.shape);
  const baseAttempts = [];
  for (const base of bases) {
    const r = await realProbe(base, headers);
    const code = r.ok ? 'ok' : (r.code || 'error');
    baseAttempts.push({ base, status: r.status || null, code });
    if (code === 'ok' || code === 'not-tracked-yet') {
      return { ok: true, header: recognised.shape.header, prefix: recognised.shape.prefix,
        shape: label(recognised.shape), base, attempts, baseAttempts, already,
        env: base === SAFECUBE_BASE ? envHeader : `${envHeader}\nSAFECUBE_BASE_URL=${base}` };
    }
  }

  // Recognised everywhere, refused everywhere: not a header problem and not a
  // path problem. That is the account.
  //
  // Sinay sells its APIs as separate products behind one key, so "refused" is
  // ambiguous in a way worth resolving: a key can be entitled to Webhooks and not
  // to Container Tracking, which is a sentence about a PLAN, versus a key that is
  // dead everywhere, which is a sentence about the KEY. One extra call to a base
  // we already know how to reach separates them, and it is the difference between
  // "buy tracking credits" and "check your key".
  const elsewhere = name === 'safecube' ? await probeWebhookApi(headers) : null;
  return { ok: false, stage: 'permission', attempts, baseAttempts, elsewhere,
    header: recognised.shape.header, shape: label(recognised.shape),
    reason: `the key IS recognised — ${label(recognised.shape)} came back ${recognised.status}, not 401, which means it was read and then refused.`
      + (elsewhere && elsewhere.ok
        ? ` The same key works on Sinay's Webhook API, so the key is fine and this account simply has no Container Tracking access — push will deliver, on-demand lookups will not until that product is added.`
        : ` That is an account, plan or scope limit rather than a wrong key or a wrong header.`) };
}

// Does this key work on a DIFFERENT Sinay product? GET /endpoint on the Webhook
// API is a read that lists what already exists, so it registers nothing and
// tracks nothing — it only answers "is this key alive over there".
async function probeWebhookApi(headers) {
  const r = await getJson(`${safecubeWebhookBase()}/endpoint`, headers, { timeout: 8000 });
  return { ok: !!r.ok, base: safecubeWebhookBase(), status: r.status || null,
    code: r.ok ? 'ok' : (r.code || 'error') };
}

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
  diagnoseAuth, trackingKey, AUTH_SHAPES, logLookup, lookupWhere, canRegister, headerName, authHeader,
  CONTAINER_PROVIDERS,
  lookupPosition, aisConfigured,
  safecubeMap, safecubePosition, safecubeBox, safecubeMoves, safecubeQuery, everyObject,
  // Exported for the tests, which exercise the mapping rather than the network.
  mapProviderPayload, mapAisPayload, aisTime, t49Map, t49Records, t49Related, t49EquipmentLabel, classify,
};
ctx.trackingProviders = module.exports;
