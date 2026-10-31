// What the Models tab of Inventory & Logistics deals in: the answers of the server and the checks that tell one from nonsense, the
// columns a car starts with, and the small things the classic page (public/assets/procurement.js) worked out for itself — the
// figures over the register, which cars a search and a status leave, how they are grouped, what colour a name of a colour is.
// The shapes are packages/contracts' (schemas.js, logistics.js); the checks are written by hand because the bundle does not carry
// zod, and model.test.ts holds each one to its schema.
import { PO_LINE_STATUSES } from '@motolinker/contracts/documents';
import { STOCK_UNIT_FIELDS, STOCK_UNIT_NUMBERS } from '@motolinker/contracts/logistics';
import type { schemas } from '@motolinker/contracts';
import type { z } from 'zod';
import { tupleColumns, type Column, type ColumnOption } from '../../columns';

export type Vehicle = z.infer<typeof schemas.StockVehicle>;
/** One car: the eight columns, and whatever the administrator added alongside. */
export type Unit = z.infer<typeof schemas.StockUnit> & Record<string, unknown>;
export type BulkResult = z.infer<typeof schemas.StockBulkResult>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string';
const isTextOrNull = (v: unknown): boolean => v === null || isText(v);
const isTextOrMissing = (v: unknown): boolean => v === undefined || isText(v);
const isAmount = (v: unknown): boolean => typeof v === 'number' || isText(v);
const isAmountOrMissing = (v: unknown): boolean => v === undefined || isAmount(v);
const isCountOrMissing = (v: unknown): boolean =>
  v === undefined || v === null || Number.isInteger(v);

export function isUnit(v: unknown): v is Unit {
  return (
    isObject(v) &&
    ['consignee', 'colour', 'vin', 'status', 'logistics', 'supplier'].every(k =>
      isTextOrMissing(v[k]),
    ) &&
    isAmountOrMissing(v['price_list']) &&
    isAmountOrMissing(v['discounted'])
  );
}

export function isVehicle(v: unknown): v is Vehicle {
  return (
    isObject(v) &&
    Number.isInteger(v['id']) &&
    isText(v['make']) &&
    isText(v['model']) &&
    isTextOrNull(v['trim']) &&
    (v['price'] === null || isAmount(v['price'])) &&
    Number.isInteger(v['quantity']) &&
    (v['units'] === undefined ||
      v['units'] === null ||
      (Array.isArray(v['units']) && v['units'].every(isUnit))) &&
    isTextOrNull(v['notes']) &&
    isCountOrMissing(v['legacy_count']) &&
    (v['created_by'] === undefined || isTextOrNull(v['created_by'])) &&
    (v['created_at'] === undefined || isTextOrNull(v['created_at'])) &&
    (v['updated_at'] === undefined || isTextOrNull(v['updated_at']))
  );
}
export const isVehicleList = (v: unknown): v is Vehicle[] => Array.isArray(v) && v.every(isVehicle);

export const isBulkResult = (v: unknown): v is BulkResult =>
  isObject(v) &&
  Number.isInteger(v['inserted']) &&
  Array.isArray(v['errors']) &&
  v['errors'].every(isText);

// ── Icons ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The icons the screen draws (lucide's names; the shell's table holds them). */
export const STOCK_ICONS = {
  add: 'plus',
  upload: 'upload',
  download: 'download',
  edit: 'pencil',
  remove: 'trash-2',
  warn: 'alert-triangle',
  filter: 'filter',
  group: 'rows-3',
  models: 'car-front',
  tracking: 'ship',
  vin: 'hash',
  colour: 'palette',
  views: { all: 'table', status: 'layout-grid', model: 'car' },
} as const;

// ── The columns ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a car is in its journey: the purchase order line's four, painted in their own colours until the administrator changes them. */
const STATUS_OPTIONS: readonly ColumnOption[] = PO_LINE_STATUSES.map(s => ({
  key: s.key,
  label: s.label,
  color: s.fg,
}));

/** What each car starts with: eight columns, two of them numbers and the Status a dropdown. */
export const STOCK_COLUMNS: readonly Column[] = tupleColumns(STOCK_UNIT_FIELDS, {
  ...Object.fromEntries(STOCK_UNIT_NUMBERS.map(k => [k, 'number' as const])),
  status: 'select',
}).map(c => (c.key === 'status' ? { ...c, options: [...STATUS_OPTIONS] } : c));

/** The status options the screen shows: the Status column's own while it is shown, else the four it starts with. */
export function statusOptions(shown: readonly Column[]): readonly ColumnOption[] {
  const col = shown.find(c => c.key === 'status');
  return (col && col.options) || STATUS_OPTIONS;
}

/** How a status is written and painted; one that is not among the options is written as it is, and none as "Unassigned". */
export function statusMeta(
  options: readonly ColumnOption[],
  key: string | undefined,
): { label: string; color: string } {
  const hit = options.find(o => o.key === key);
  return {
    label: hit ? hit.label : key || 'Unassigned',
    color: (hit && hit.color) || 'var(--muted)',
  };
}

/**
 * A colour name is not a colour. Known names get their paint; anything else falls back to a neutral chip rather than guessing
 * wrong.
 */
export function swatch(name: unknown): string {
  const n = String(name || '').toLowerCase();
  if (/black|obsidian|raven|attitude/.test(n)) return '#1c1c1f';
  if (/white|mineral|carrara|eminent|pearl/.test(n)) return '#f2f0ea';
  if (/silver|grey|gray/.test(n)) return '#b9b3a4';
  if (/blue|navarra|denim/.test(n)) return '#5a78c8';
  if (/red|rosso/.test(n)) return '#ef4444';
  if (/green/.test(n)) return '#10b981';
  if (/brown|bronze|beige/.test(n)) return '#c98b5e';
  return 'rgba(255,255,255,.25)';
}

// ── The register ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A figure with its thousands separated, in this browser's own way. */
export const thousands = (n: unknown): string => (Number(n) || 0).toLocaleString();
/** …and in Egyptian pounds. */
export const egp = (n: unknown): string => thousands(n) + ' EGP';

/** The cars a model row holds (a row from before the cars were recorded has none). */
export const unitsOf = (v: Vehicle): readonly Unit[] => (Array.isArray(v.units) ? v.units : []);

/** One car with the model row it is held under — the flat register. */
export interface Row {
  u: Unit;
  v: Vehicle;
  /** which of the model's cars this is (a car has no id of its own) */
  at: number;
}
export function rowsOf(vehicles: readonly Vehicle[]): Row[] {
  return vehicles.flatMap(v => unitsOf(v).map((u, at) => ({ u, v, at })));
}

/** What a car is worth: its own list price, else the model's. */
export const priceOf = ({ u, v }: Row): number => Number(u.price_list) || Number(v.price) || 0;

/** The cars an older save counted but never named: a model with no cars keeps the count it was given. */
export const legacyOf = (v: Vehicle): number =>
  unitsOf(v).length ? 0 : parseInt(String(v.legacy_count ?? ''), 10) || 0;

export interface Segment {
  label: string;
  n: number;
  color: string;
}
export interface Summary {
  total: number;
  /** distinct makes and models (trims are not told apart) */
  models: number;
  value: number;
  /** cars an older save counted and nobody named */
  legacy: number;
  /** where the cars are, by status, in the order of the options — those with none left out */
  segments: Segment[];
}

/** The figures over the whole register, before a single row: how many cars, where they are, what they are worth. */
export function summaryOf(vehicles: readonly Vehicle[], options: readonly ColumnOption[]): Summary {
  const all = rowsOf(vehicles);
  const models = new Set(
    vehicles.map(v => `${(v.make || '').toLowerCase()}|${(v.model || '').toLowerCase()}`),
  );
  const counts = new Map<string, number>();
  for (const { u } of all) {
    const k = u.status || '';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const segments: Segment[] = options.map(o => ({
    label: o.label,
    n: counts.get(o.key) || 0,
    color: o.color || 'var(--muted)',
  }));
  if (counts.get(''))
    segments.push({ label: 'Unassigned', n: counts.get('') || 0, color: 'var(--muted)' });
  return {
    total: all.length,
    models: models.size,
    value: all.reduce((sum, r) => sum + priceOf(r), 0),
    legacy: vehicles.reduce((sum, v) => sum + legacyOf(v), 0),
    segments: segments.filter(s => s.n > 0),
  };
}

/** The cars a search and a status leave: the search matches the make, model, trim and VIN; a status is exact. */
export function matching(rows: readonly Row[], term: string, status: string): Row[] {
  const t = term.trim().toLowerCase();
  const hit = ({ u, v }: Row) =>
    !t || `${v.make} ${v.model} ${v.trim ?? ''} ${u.vin || ''}`.toLowerCase().includes(t);
  return rows.filter(r => hit(r) && (!status || r.u.status === status));
}

/** The cars under a supplier's name, the names in order (a car with no supplier is under "No supplier"). */
export function bySupplier(rows: readonly Row[]): [string, Row[]][] {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.u.supplier || 'No supplier';
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export interface Lane {
  key: string;
  label: string;
  color: string;
  rows: Row[];
  value: number;
  /** a whole percent of the cars shown */
  share: number;
}
/** By status: a lane for each status option, then one for the cars with none (only where there are some). */
export function lanesOf(rows: readonly Row[], options: readonly ColumnOption[]): Lane[] {
  const total = rows.length || 1;
  return [
    ...options.map(o => ({ key: o.key, label: o.label, color: o.color || 'var(--muted)' })),
    { key: '', label: 'Unassigned', color: 'var(--muted)' },
  ]
    .map(o => {
      const list = rows.filter(r => (r.u.status || '') === o.key);
      return {
        ...o,
        rows: list,
        value: list.reduce((sum, r) => sum + priceOf(r), 0),
        share: Math.round((list.length / total) * 100),
      };
    })
    .filter(l => l.rows.length || l.key !== '');
}

/**
 * By model: the models a search and a status leave. A model is matched on its own words as well as through its cars — one
 * recorded before the cars were named has none, and would vanish the moment anything was typed, which is exactly the model the
 * unmatched-cars notice sends you to.
 */
export function cardsOf(
  vehicles: readonly Vehicle[],
  rows: readonly Row[],
  term: string,
  status: string,
): Vehicle[] {
  const t = term.trim().toLowerCase();
  const keep = new Set(rows.map(r => r.v.id));
  return vehicles.filter(v => {
    if (status && !keep.has(v.id)) return false;
    if (!t) return true;
    return (
      `${v.make || ''} ${v.model || ''} ${v.trim || ''}`.toLowerCase().includes(t) || keep.has(v.id)
    );
  });
}

/** The cars of a model that have no VIN yet. */
export const withoutVin = (v: Vehicle): number =>
  unitsOf(v).filter(u => !String(u.vin || '').trim()).length;

/** A model's cars as one cell of the unit table writes a value: a number with its thousands, a tick, else the words or a dash. */
export function cellText(col: Pick<Column, 'type'>, value: unknown): string {
  if (col.type === 'checkbox') return value === true || value === 'true' ? '✓' : '—';
  if (col.type === 'number') return Number(value) ? Number(value).toLocaleString() : '—';
  return value == null || value === '' ? '—' : String(value);
}

// ── The views ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type View = 'all' | 'status' | 'model';
export const VIEW_KEY = 'ml_stock_view';
export const VIEWS: readonly [View, string][] = [
  ['all', 'All vehicles'],
  ['status', 'By status'],
  ['model', 'By model'],
];

export function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'status' || v === 'model' ? v : 'all';
  } catch {
    return 'all';
  }
}
export function saveView(v: View): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* (a browser that will not keep it: the view is not remembered) */
  }
}

// ── The form ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The words a model needs before it is sent (the server asks for the same two, make first). */
export const SAID_NEED_MAKE_AND_MODEL = 'Make and Model are required.';

/** What the form sends: the model's words, the price as typed, and the cars exactly as the grid holds them. */
export interface VehicleBody {
  make: string;
  model: string;
  trim: string;
  price: string;
  notes: string;
  units: Record<string, unknown>[];
}

/** The words of what is wrong with a form, if something is. */
export const problemWith = (f: Pick<VehicleBody, 'make' | 'model'>): string | null =>
  f.make.trim() && f.model.trim() ? null : SAID_NEED_MAKE_AND_MODEL;

/** What a model's heading says in the confirmation of its deletion. */
export const nameOf = (v: Pick<Vehicle, 'make' | 'model' | 'trim'> | undefined): string =>
  v ? `${v.make} ${v.model} ${v.trim || ''}`.trim() : 'this vehicle';
