// What the Tracking tab deals in: the answers of the server and the checks that tell one from nonsense, and the small things the
// classic page (public/assets/logistics.js) worked out for itself — how a date is written, how far along its leg a ship is, how
// old a fix is, and the sentences a carrier's answer is turned into (a vendor's own error is never put in front of somebody trying
// to find a container). The shapes are packages/contracts' (schemas.js, logistics.js); the checks are written by hand because the
// bundle does not carry zod, and tracking.test.ts holds each one to its schema.
import { CONTAINER_STATUSES, inspectContainerNo } from '@motolinker/contracts/logistics';
import type { schemas } from '@motolinker/contracts';
import type { z } from 'zod';

export {
  CONTAINER_STATUSES,
  CONTAINER_TYPES,
  inspectContainerNo,
} from '@motolinker/contracts/logistics';

export type Container = z.infer<typeof schemas.Container>;
export type ContainerSaved = z.infer<typeof schemas.ContainerSaved>;
export type ContainerBase = z.infer<typeof schemas.ContainerBase>;
export type ContainerCar = z.infer<typeof schemas.ContainerCar>;
export type ContainerMove = z.infer<typeof schemas.ContainerMove>;
export type Lookup = z.infer<typeof schemas.ContainerLookup>;
export type ProviderStatus = z.infer<typeof schemas.ContainerProviderStatus>;
export type Refreshed = z.infer<typeof schemas.ContainerRefreshed>;
export type Registered = z.infer<typeof schemas.ContainerRegistered>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string';
const isTextOrNull = (v: unknown): boolean => v === null || isText(v);
const isTextOrMissing = (v: unknown): boolean => v === undefined || isTextOrNull(v);
/** …where the contract's schema leaves the field out or gives words — never nothing. */
const isTextOrAbsent = (v: unknown): boolean => v === undefined || isText(v);
const isAmount = (v: unknown): boolean => typeof v === 'number' || isText(v);
const isAmountOrMissing = (v: unknown): boolean => v === undefined || v === null || isAmount(v);

const isMove = (v: unknown): v is ContainerMove =>
  isObject(v) && ['at', 'event', 'place', 'vessel'].every(k => isText(v[k]));

function isCar(v: unknown): v is ContainerCar {
  return (
    isObject(v) &&
    isText(v['vin']) &&
    (v['unrecorded'] === undefined || typeof v['unrecorded'] === 'boolean') &&
    (v['stock_id'] === undefined || Number.isInteger(v['stock_id'])) &&
    ['make', 'model', 'trim', 'colour', 'status', 'consignee'].every(
      k => isText(v[k]) || v[k] === undefined,
    )
  );
}

export function isContainerBase(v: unknown): v is ContainerBase {
  return (
    isObject(v) &&
    Number.isInteger(v['id']) &&
    isText(v['container_no']) &&
    isText(v['status']) &&
    [
      'container_type',
      'bl_number',
      'carrier',
      'latest_move',
      'latest_move_at',
      'pod_eta',
      'vessel_name',
      'vessel_imo',
      'pol_code',
      'pol_name',
      'pod_code',
      'pod_name',
      'atd',
      'eta',
      'supplier',
      'notes',
    ].every(k => isTextOrNull(v[k])) &&
    (v['moves'] === null || (Array.isArray(v['moves']) && v['moves'].every(isMove))) &&
    (v['po_id'] === null || Number.isInteger(v['po_id'])) &&
    [
      'source',
      'last_synced_at',
      'created_by',
      'created_at',
      'updated_at',
      'vessel_position_at',
      'vessel_mmsi',
      'position_source',
    ].every(k => isTextOrMissing(v[k])) &&
    ['vessel_lat', 'vessel_lon', 'vessel_course', 'vessel_speed'].every(k =>
      isAmountOrMissing(v[k]),
    )
  );
}

export const isContainer = (v: unknown): v is Container =>
  isContainerBase(v) &&
  Array.isArray((v as unknown as Record<string, unknown>)['units']) &&
  ((v as unknown as Record<string, unknown>)['units'] as unknown[]).every(isCar);
export const isContainerList = (v: unknown): v is Container[] =>
  Array.isArray(v) && v.every(isContainer);

const isCheck = (v: unknown): boolean =>
  isObject(v) &&
  isText(v['no']) &&
  typeof v['valid'] === 'boolean' &&
  typeof v['checkOk'] === 'boolean' &&
  (v['expected'] === null || Number.isInteger(v['expected']));

export const isSaved = (v: unknown): v is ContainerSaved =>
  isContainerBase(v) && isCheck((v as unknown as Record<string, unknown>)['check']);

export function isLookup(v: unknown): v is Lookup {
  if (!isObject(v) || !isCheck(v['check'])) return false;
  if (v['found'] === true) return isContainer(v['container']);
  return (
    v['found'] === false &&
    (v['prefill'] === null || isObject(v['prefill'])) &&
    isTextOrAbsent(v['provider']) &&
    isText(v['code']) &&
    isTextOrNull(v['detail']) &&
    isText(v['provider_name']) &&
    typeof v['can_register'] === 'boolean'
  );
}

export const isProviderStatus = (v: unknown): v is ProviderStatus =>
  isObject(v) &&
  isText(v['provider']) &&
  typeof v['configured'] === 'boolean' &&
  isText(v['auth_header']) &&
  typeof v['carrier_has_position'] === 'boolean' &&
  isText(v['ais']) &&
  typeof v['webhook_ready'] === 'boolean' &&
  (v['probe'] === undefined || isText(v['probe'])) &&
  (v['reachable'] === undefined || typeof v['reachable'] === 'boolean') &&
  (v['http'] === undefined || v['http'] === null || typeof v['http'] === 'number') &&
  isTextOrMissing(v['detail']);

const isFeed = (v: unknown): boolean =>
  v === null ||
  (isObject(v) &&
    typeof v['ok'] === 'boolean' &&
    isTextOrAbsent(v['code']) &&
    isTextOrAbsent(v['reason']) &&
    isTextOrMissing(v['detail']) &&
    isTextOrAbsent(v['at']));

export const isRefreshed = (v: unknown): v is Refreshed =>
  isObject(v) &&
  typeof v['ok'] === 'boolean' &&
  isFeed(v['carrier']) &&
  isFeed(v['position']) &&
  Number.isInteger(v['changed']) &&
  isContainerBase(v['container']);

export const isRegistered = (v: unknown): v is Registered =>
  isObject(v) &&
  ((v['ok'] === true && isText(v['provider'])) ||
    (v['ok'] === false &&
      isText(v['code']) &&
      isTextOrAbsent(v['reason']) &&
      isTextOrMissing(v['detail'])));

export const isCarLinked = (v: unknown): v is { ok: true; vin: string } =>
  isObject(v) && v['ok'] === true && isText(v['vin']);

// ── Icons ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The icons the tab draws (lucide's names; the shell's table holds them). */
export const TRACK_ICONS = {
  search: 'search',
  add: 'plus',
  plug: 'plug',
  container: 'container',
  type: 'box',
  move: 'map-pin',
  eta: 'timer',
  ship: 'ship',
  here: 'navigation-2',
  end: 'map-pin',
  moves: 'list',
  position: 'radio',
  refresh: 'refresh-cw',
  edit: 'pencil',
  car: 'car-front',
  warn: 'alert-triangle',
  key: 'key-round',
  ok: 'check',
} as const;

// ── Writing things down ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * dd/mm/yyyy, which is what the carrier's card shows and how the team writes a date. Read as a plain date, never through the local
 * timezone: a POD ETA is a calendar day, and shifting it by an hour can move it to the day before.
 */
export function fmtDate(v: unknown): string {
  const s = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

/** …and a moment as `yyyy-mm-dd hh:mm` in this browser's own time. */
export function fmtDateTime(v: unknown): string {
  if (!v) return '—';
  const t = Date.parse(String(v));
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** What a date-and-time input holds for a moment: `yyyy-mm-ddThh:mm` (it rejects the Z-suffixed form the server keeps). */
export function dtLocal(v: unknown): string {
  const t = Date.parse(String(v || ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Degrees as a chart writes them: 31.2°N reads as a position, -31.2 reads as a number and gets mistaken for a longitude. */
export function dm(v: unknown, axis: 'lat' | 'lon'): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const hemi = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : n >= 0 ? 'E' : 'W';
  return `${Math.abs(n).toFixed(3)}° ${hemi}`;
}

/**
 * How old a fix is, and how much to trust it. Satellite AIS mid-ocean is routinely an hour or more behind, so "live" is a claim
 * worth qualifying on the card rather than in a footnote nobody reads.
 */
export function positionAge(
  at: unknown,
  now = Date.now(),
): { label: string; cls: 'fresh' | 'aging' | 'stale' } {
  const t = Date.parse(String(at || ''));
  if (!Number.isFinite(t)) return { label: 'age unknown', cls: 'stale' };
  const mins = Math.max(0, Math.round((now - t) / 60000));
  const cls = mins <= 90 ? 'fresh' : mins <= 12 * 60 ? 'aging' : 'stale';
  if (mins < 60) return { label: `${mins} min ago`, cls };
  if (mins < 48 * 60) return { label: `${Math.round(mins / 60)} h ago`, cls };
  return { label: `${Math.round(mins / 1440)} d ago`, cls };
}

/**
 * How far along the leg the box is, 0..1. Time-based rather than distance — the departure and the ETA are the only two facts
 * available — and clamped at both ends so a late ship does not draw past the destination.
 */
export function voyageProgress(atd: unknown, eta: unknown, now = Date.now()): number | null {
  const a = Date.parse(String(atd || ''));
  const e = Date.parse(String(eta || ''));
  if (!Number.isFinite(a) || !Number.isFinite(e) || e <= a) return null;
  return Math.max(0, Math.min(1, (now - a) / (e - a)));
}

/** A port call, as the log writes it: an event the carrier has not confirmed ends "(expected)" and is shown as a plan, not a fact. */
export function callOf(m: ContainerMove): { expected: boolean; label: string; where: string } {
  const expected = / \(expected\)$/.test(m.event || '');
  return {
    expected,
    label: String(m.event || '').replace(/ \(expected\)$/, ''),
    where: [m.place, m.vessel].filter(Boolean).join(' · '),
  };
}

/** The status a box is shown with: its own, else the first (a status the list does not have is drawn as the first). */
export function statusOf(key: string) {
  return CONTAINER_STATUSES.find(s => s.key === key) ?? CONTAINER_STATUSES[0]!;
}

/** A hex colour reads its theme token (--h-<hex>) where a look defines one: sunk on a light page, lifted on a dark one. */
export const hueVar = (c: string): string =>
  /^#[0-9a-f]{6}$/i.test(c) ? `var(--h-${c.slice(1).toLowerCase()},${c})` : c;

/** The link out when the map cannot be drawn: where the ship is, on OpenStreetMap. */
export const mapLink = (lat: unknown, lon: unknown): string =>
  `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(lat))}&mlon=${encodeURIComponent(String(lon))}#map=5/${encodeURIComponent(String(lat))}/${encodeURIComponent(String(lon))}`;

// ── What a carrier's answer comes to ────────────────────────────────────────────────────────────────────────────────────────

/** The carrier's own name, as the sentences say it. */
export const carrierName = (provider: string | undefined): string =>
  ({ terminal49: 'Terminal49', safecube: 'Safecube', generic: 'The carrier feed' })[
    provider ?? ''
  ] ?? 'The carrier platform';

/**
 * A vendor's error is a blob and must never be shouted at somebody trying to find a container. The server classifies it; this turns
 * the class into one sentence that says what to do next.
 */
export function whyNotTracked(code: string, name: string): string {
  if (code === 'ok') return 'Prefilled from the carrier.';
  const why: Record<string, string> = {
    'not-configured': 'Automatic lookup is not set up, so enter what the carrier shows.',
    'not-tracked-yet': `${name} is not watching this container yet. Register it below to start.`,
    unknown: 'CONTAINER_TRACKING_PROVIDER is not a name I recognise — check the spelling.',
    'plan-required': `${name} accepted the key, but reading containers back needs a paid plan — the free key may only register them. Register it below and follow it in ${name}, or enter the details by hand.`,
    unauthorized: `${name} did not recognise the key at all. Check CONTAINER_TRACKING_KEY, and that it is the right kind of key.`,
    forbidden: `${name} recognised the key and refused the request — an account, plan or scope limit rather than a wrong key. Test connection says which.`,
    'rate-limited': `${name} is rate-limiting us — try again shortly.`,
    'provider-down': `${name} is not responding right now.`,
    timeout: `${name} did not answer in time.`,
    unreachable: `Could not reach ${name}.`,
    'not-found': `${name} has no record of this container.`,
    'sealine-unknown': `${name} could not work out which shipping line this container belongs to. Set SAFECUBE_SEALINE to the line's SCAC code (MSC is MSCU) and try again.`,
    'bad-number': `${name} rejected the number itself — check it against the bill of lading.`,
  };
  return why[code] ?? 'Carrier lookup unavailable — enter it by hand.';
}

/** What registering a box came to, as a sentence. */
export function registeredSaid(r: Registered): string {
  if (r.ok) {
    return r.provider === 'safecube'
      ? `Registered — ${String(r.status)}. Updates now arrive on their own; nothing to refresh. Save the card below so they have somewhere to land.`
      : `Registered — status ${String(r.status)}. Milestones arrive on the next refresh.`;
  }
  return r.code === 'plan-required'
    ? 'That needs a paid plan on the carrier platform.'
    : r.code === 'unauthorized'
      ? 'The carrier rejected the key.'
      : `Carrier would not take it: ${r.reason ?? ''}`;
}

const SHORT: Record<string, string> = {
  'not-configured': 'no carrier feed set up',
  'not-tracked-yet': 'carrier is not watching this box yet',
  'plan-required': 'carrier reads need a paid plan',
  unauthorized: 'carrier did not recognise the key',
  forbidden: 'carrier recognised the key but refused',
  'rate-limited': 'carrier is rate-limiting us',
  'provider-down': 'carrier is down',
  timeout: 'carrier timed out',
  'no-vessel-id': 'no IMO on this container yet',
  'sealine-unknown': 'carrier could not be auto-detected — set SAFECUBE_SEALINE',
  'bad-number': 'the carrier rejected this container number',
};

/**
 * What a refresh came to: the two feeds reported separately — "the ETA is stale but the dot moved" is a real and common outcome,
 * and one summary line would hide it.
 */
export function refreshSaid(d: Refreshed): { text: string; reload: boolean } {
  const say: string[] = [];
  const carrier = d.carrier;
  if (carrier?.ok) say.push('carrier updated');
  else if (carrier) say.push(SHORT[carrier.code ?? ''] ?? `carrier: ${carrier.reason ?? ''}`);
  const position = d.position;
  if (position?.ok) say.push('position updated');
  else if (position) say.push(SHORT[position.code ?? ''] ?? `position: ${position.reason ?? ''}`);
  if (!d.ok && !d.changed)
    return { text: say.length ? say.join(' · ') : 'Nothing to update.', reload: false };
  return {
    text: d.changed
      ? `${say.join(' · ')} (${d.changed} field${d.changed === 1 ? '' : 's'})`
      : 'Already up to date.',
    reload: true,
  };
}

/**
 * "I added the key — is it working?" as one line: the provider, whether its key was read, what the AIS feed and the webhook are.
 * "Key rejected" is a claim about the KEY, and most of the ways a probe fails say nothing about it, so the accusation is kept for
 * the two codes that actually mean it.
 */
export function providerSaid(d: ProviderStatus): string {
  const parts = [
    d.provider === 'none'
      ? 'No carrier feed is configured'
      : d.provider === 'unknown'
        ? 'CONTAINER_TRACKING_PROVIDER is not a name I recognise'
        : `Provider: ${d.provider}`,
  ];
  if (d.provider !== 'none' && d.provider !== 'unknown') {
    const refused: Record<string, string> = {
      unauthorized: 'key rejected',
      forbidden: 'key accepted, request refused',
    };
    const other: Record<string, string> = {
      timeout: 'carrier did not answer in time',
      unreachable: 'carrier unreachable',
      'rate-limited': 'carrier is rate-limiting us',
      'provider-down': 'carrier is down',
      'plan-required': 'key accepted, reads need a paid plan',
      'sealine-unknown': 'key accepted, carrier not auto-detected',
      'bad-number': 'key accepted, probe number refused',
      'not-configured': 'no key set',
    };
    const probe = d.probe ?? '';
    parts.push(
      d.reachable
        ? 'key accepted'
        : `${refused[probe] ?? other[probe] ?? `check failed (${probe})`}${d.http ? ` — HTTP ${d.http}` : ''}`,
    );
    parts.push(d.carrier_has_position ? 'positions included' : `AIS: ${d.ais}`);
    parts.push(d.webhook_ready ? 'webhook secret set' : 'no webhook secret');
  }
  return parts.join(' · ');
}

/** What the server's diagnosis of a refused key came to (kept loose: it is for a person to read, not for the app to act on). */
export interface Diagnosis {
  ok?: boolean;
  stage?: string;
  reason?: string;
  already?: boolean;
  shape?: string;
  env?: string;
  base?: string;
  attempts?: { shape?: string; base?: string; code?: string; status?: number }[];
  baseAttempts?: { shape?: string; base?: string; code?: string; status?: number }[];
}
export const diagnosisOf = (d: ProviderStatus): Diagnosis | null =>
  isObject(d.auth) ? (d.auth as Diagnosis) : null;

// ── The form ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The words a box needs before it is sent (the server asks for the same). */
export const SAID_BAD_NUMBER =
  'A container number is four letters then seven digits, like MSDU7337230.';

/** What the form holds, as the boxes of the sheet hold it (text all of it, as typed). */
export interface BoxForm {
  container_no: string;
  container_type: string;
  status: string;
  carrier: string;
  bl_number: string;
  latest_move: string;
  pod_eta: string;
  vessel_name: string;
  vessel_imo: string;
  pol_code: string;
  pol_name: string;
  atd: string;
  pod_code: string;
  pod_name: string;
  eta: string;
  vessel_lat: string;
  vessel_lon: string;
  vessel_position_at: string;
  vessel_course: string;
  vessel_speed: string;
  vessel_mmsi: string;
  notes: string;
}

const text = (v: unknown): string => (v == null ? '' : String(v));

/** The form a box starts as: what it holds (or what the carrier prefilled), the status "in transit" where it has none. */
export function formOf(c: Partial<Record<string, unknown>> | undefined): BoxForm {
  const x = c ?? {};
  return {
    container_no: text(x['container_no']),
    container_type: text(x['container_type']),
    status: text(x['status']) || 'in_transit',
    carrier: text(x['carrier']),
    bl_number: text(x['bl_number']),
    latest_move: text(x['latest_move']),
    pod_eta: text(x['pod_eta']).slice(0, 10),
    vessel_name: text(x['vessel_name']),
    vessel_imo: text(x['vessel_imo']),
    pol_code: text(x['pol_code']),
    pol_name: text(x['pol_name']),
    atd: dtLocal(x['atd']),
    pod_code: text(x['pod_code']),
    pod_name: text(x['pod_name']),
    eta: dtLocal(x['eta']),
    vessel_lat: text(x['vessel_lat']),
    vessel_lon: text(x['vessel_lon']),
    vessel_position_at: dtLocal(x['vessel_position_at']),
    vessel_course: text(x['vessel_course']),
    vessel_speed: text(x['vessel_speed']),
    vessel_mmsi: text(x['vessel_mmsi']),
    notes: text(x['notes']),
  };
}

/**
 * What the form sends: the number cleaned, everything else as typed (the server cleans the rest, and a change writes only what it
 * carries — so the port-call log and the purchase order, which the form has no box for, are not in it and are not lost).
 */
export function bodyOf(f: BoxForm): Record<string, string> {
  const seen = inspectContainerNo(f.container_no);
  return { ...f, container_no: seen.no };
}

/** The ISO 6346 warning under a box's number: its check digit is not the one the others call for. */
export function checkWarning(no: string): string | null {
  const seen = inspectContainerNo(no);
  return seen.valid && !seen.checkOk
    ? `Check digit should be ${seen.expected} — worth confirming against the B/L.`
    : null;
}

/** A car that can be put in a box: one the register holds with a VIN. */
export interface FreeCar {
  vin: string;
  make: string;
  model: string;
  trim: string;
  colour: string;
  status: string;
  consignee: string;
}

/** How a car is written in the list of what can be put in a box. */
export const carLabel = (u: FreeCar): string =>
  [u.vin, [u.make, u.model, u.trim].filter(Boolean).join(' '), u.colour, u.consignee]
    .filter(Boolean)
    .join(' · ');

/** What the chip of a car inside a box says when the pointer rests on it. */
export const carTitle = (u: ContainerCar): string =>
  u.unrecorded
    ? 'This VIN is not in the Models tab yet'
    : [u.make, u.model, u.trim, u.colour, u.consignee].filter(Boolean).join(' · ');
